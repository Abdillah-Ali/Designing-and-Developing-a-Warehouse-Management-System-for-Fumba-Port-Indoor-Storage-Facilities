import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, LogOut, Wifi, WifiOff, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { clearStoredAuthToken } from "@/lib/portal-access";
import {
  SCAN_COOLDOWN_MS,
  getSessionStepKey,
  shouldSuppressDuplicate
} from "@/lib/scanner-workflow";
import { getActiveScanSession, logout, refreshScanSession } from "@/services/api";
import { createScannerSocket } from "@/services/scannerSocket";

const CAMERA_RELEASE_MS = 450;
const SCAN_RESUME_DELAY_MS = 250;
const NOTICE_TIMEOUT_MS = 4200;
const ERROR_NOTICE_TIMEOUT_MS = 5600;

const sendWithAck = (socket, event, payload) => new Promise((resolve, reject) => {
  if (!socket?.connected) {
    reject(new Error("Scanner is not connected."));
    return;
  }

  socket.emit(event, payload, (response) => {
    if (!response?.success) {
      reject(new Error(response?.message || "Scanner request failed."));
      return;
    }

    resolve(response.data);
  });
});

const getScannerScreenKey = (session) => {
  if (!session) return "waiting";
  return `${session.id || "session"}:${session.status || "unknown"}:${getSessionStepKey(session) || "idle"}`;
};

const isPlacementOrRelocationSession = (session) => {
  if (session?.status !== "active") return false;

  const workflowText = [
    session.workflow_type,
    session.workflow_name,
    session.current_step?.workflow_name,
    session.context?.operation_type,
    session.context?.placement_intent
  ].filter(Boolean).join(" ").toLowerCase();

  return workflowText.includes("placement") || workflowText.includes("relocation");
};

function ConnectionBadge({ status }) {
  const connected = status === "Connected";
  const Icon = connected ? Wifi : WifiOff;

  return (
    <div className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold shadow-lg transition-colors ${
      connected
        ? "border-emerald-300/35 bg-emerald-500/12 text-emerald-50"
        : "border-amber-300/40 bg-amber-500/12 text-amber-50"
    }`}>
      <Icon className="h-3.5 w-3.5" />
      {status}
    </div>
  );
}

function ScannerNotice({ notice }) {
  if (!notice) return null;

  const Icon = notice.type === "success"
    ? CheckCircle2
    : notice.type === "info"
      ? Info
      : AlertTriangle;
  const toneClass = {
    success: "border-emerald-300/40 bg-emerald-950/90 text-emerald-50 shadow-emerald-950/30",
    warning: "border-amber-300/45 bg-amber-950/90 text-amber-50 shadow-amber-950/30",
    error: "border-red-300/45 bg-red-950/90 text-red-50 shadow-red-950/30",
    info: "border-sky-300/40 bg-sky-950/90 text-sky-50 shadow-sky-950/30"
  }[notice.type || "warning"];

  return (
    <div className={`scanner-toast mx-auto w-full max-w-lg rounded-xl border px-4 py-3 shadow-2xl ${toneClass}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-5">{notice.title}</div>
          {notice.message && (
            <div className="mt-0.5 text-xs font-medium leading-5 opacity-90">{notice.message}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScannerFrame({ active, cameraState, videoRef }) {
  const cameraRunning = cameraState === "active";
  const placeholder = active
    ? cameraState === "starting"
      ? "Starting camera..."
      : "Camera inactive"
    : "Waiting for scan session";

  return (
    <div className="scanner-frame-shell pointer-events-none relative w-full max-w-[720px] px-3 sm:px-6">
      <div className="scanner-focus-window relative mx-auto aspect-[1.45/1] w-full max-w-[640px] overflow-hidden rounded-[1.35rem] border border-white/20 bg-slate-950 shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
        <video
          ref={videoRef}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${cameraRunning ? "opacity-100" : "opacity-0"}`}
          autoPlay
          muted
          playsInline
        />
        <div className="absolute inset-0 bg-black/12" />
        {!cameraRunning && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950 px-6 text-center">
            <div>
              <div className="mx-auto mb-3 h-2 w-16 rounded-full bg-white/15" />
              <div className="text-sm font-semibold text-white/75">{placeholder}</div>
            </div>
          </div>
        )}
        <span className="scanner-corner scanner-corner-tl" />
        <span className="scanner-corner scanner-corner-tr" />
        <span className="scanner-corner scanner-corner-bl" />
        <span className="scanner-corner scanner-corner-br" />
        <div className="absolute left-8 right-8 top-1/2 h-px -translate-y-1/2 bg-white/35" />
        <div className="absolute inset-x-10 bottom-7 h-1 rounded-full bg-white/80" />
        {active && cameraRunning && <div className="scanner-scanline" />}
      </div>
    </div>
  );
}

function StepIndicator({ session }) {
  const hasSession = Boolean(session);
  const total = hasSession
    ? Math.max(Number(session.total_steps || session.steps?.length || 0), 1)
    : 1;
  const current = session?.status === "completed"
    ? total
    : Math.min(total, Math.max(Number(session?.current_step_index || 0) + 1, 1));
  const statusLabel = !hasSession
    ? "Ready"
    : session.status === "completed"
      ? "Complete"
      : `${current} / ${total}`;

  return (
    <div className="scanner-glass rounded-xl border border-white/12 bg-black/35 p-3 shadow-2xl backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.16em] text-white/65">
        <span>Scan Progress</span>
        <span>{statusLabel}</span>
      </div>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: total }).map((_, index) => {
          const complete = session?.status === "completed" || index < current - 1;
          const active = session?.status === "active" && index === current - 1;
          return (
            <span
              key={`scan-step-${index}`}
              className={`h-2 rounded-full transition-all duration-300 ${
                complete
                  ? "bg-emerald-400"
                  : active
                    ? "bg-white shadow-[0_0_18px_rgba(255,255,255,0.55)]"
                    : "bg-white/20"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

function ScannerPortal() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const keyboardInputRef = useRef(null);
  const streamRef = useRef(null);
  const socketRef = useRef(null);
  const animationRef = useRef(0);
  const detectorRef = useRef(null);
  const scanLockedRef = useRef(false);
  const lastScanRef = useRef({ value: "", at: 0 });
  const lastScannedCodeRef = useRef("");
  const cameraDetectionRef = useRef({ value: "", lastSeenAt: 0 });
  const currentStepKeyRef = useRef("");
  const unlockTimerRef = useRef(0);
  const audioContextRef = useRef(null);
  const noticeTimerRef = useRef(0);
  const lastCameraErrorRef = useRef("");
  const lastSessionErrorRef = useRef("");
  const lastSessionSuccessRef = useRef("");

  const [session, setSession] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("Connecting");
  const [cameraError, setCameraError] = useState("");
  const [cameraState, setCameraState] = useState("inactive");
  const [actionError, setActionError] = useState("");
  const [keyboardValue, setKeyboardValue] = useState("");
  const [notice, setNotice] = useState(null);

  const activeSession = session?.status === "active" ? session : null;
  const completedSession = session?.status === "completed" ? session : null;
  const cameraSessionKey = activeSession
    && connectionStatus === "Connected"
    && isPlacementOrRelocationSession(activeSession)
    ? String(activeSession.id || "")
    : "";
  const screenKey = getScannerScreenKey(session);

  const display = useMemo(() => {
    if (!session) {
      return {
        workflow: "Waiting for Scan Session",
        progress: "No active scanning task assigned.",
        instruction: "Scanner is ready.",
        percent: 0
      };
    }

    if (session.status === "completed") {
      return {
        workflow: session.workflow_name || "Cargo Placement",
        progress: "Placement Completed Successfully",
        instruction: "Placement confirmed.",
        percent: 100
      };
    }

    if (session.status === "cancelled") {
      return {
        workflow: "Waiting for Scan Session",
        progress: "No active scanning task assigned.",
        instruction: "Scanner is ready.",
        percent: 0
      };
    }

    const total = Number(session.total_steps || session.steps?.length || 0);
    const step = Number(session.current_step_index || 0) + 1;

    return {
      workflow: session.workflow_name || session.current_step?.workflow_name || "Scanning",
      progress: total ? `Step ${step} of ${total}` : "Active Scan Session",
      instruction: session.instruction || session.current_step?.instruction || "Scan Barcode",
      percent: total ? ((step - 1) / total) * 100 : 0
    };
  }, [session]);

  const completedResult = completedSession?.context?.result || null;
  const currentStepLabel = activeSession?.current_step?.label || activeSession?.current_step?.name || "";

  const clearNotice = useCallback(() => {
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = 0;
    }
    setNotice(null);
  }, []);

  const showNotice = useCallback((nextNotice, targetSession = null, timeout = NOTICE_TIMEOUT_MS) => {
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
    }

    setNotice({
      id: `${Date.now()}-${nextNotice.type || "notice"}`,
      screenKey: getScannerScreenKey(targetSession),
      ...nextNotice
    });

    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = 0;
    }, timeout);
  }, []);

  const clearScannerInput = useCallback(() => {
    lastScannedCodeRef.current = "";
    setKeyboardValue("");
    if (keyboardInputRef.current) {
      keyboardInputRef.current.value = "";
    }
  }, []);

  const stopCamera = useCallback((options = {}) => {
    if (animationRef.current) {
      window.cancelAnimationFrame(animationRef.current);
      animationRef.current = 0;
    }

    streamRef.current?.getTracks?.().forEach((track) => {
      try {
        track.stop();
      } catch {
      }
    });
    streamRef.current = null;
    cameraDetectionRef.current = { value: "", lastSeenAt: 0 };

    if (videoRef.current) {
      videoRef.current.pause?.();
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute("src");
      videoRef.current.load?.();
    }

    setCameraState("inactive");
    if (options.clearError !== false) {
      setCameraError("");
    }
  }, []);

  const releaseScanLock = useCallback((delay = SCAN_RESUME_DELAY_MS) => {
    if (unlockTimerRef.current) {
      window.clearTimeout(unlockTimerRef.current);
    }
    unlockTimerRef.current = window.setTimeout(() => {
      scanLockedRef.current = false;
      unlockTimerRef.current = 0;
    }, delay);
  }, []);

  const unlockAudio = useCallback(async () => {
    if (typeof window === "undefined") return null;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume().catch(() => {});
    }

    return audioContextRef.current;
  }, []);

  const playScanTone = useCallback((tone = "success") => {
    const context = audioContextRef.current;
    if (!context || context.state !== "running") return;

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startAt = context.currentTime;
    const duration = tone === "success" ? 0.09 : 0.14;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(tone === "success" ? 880 : 220, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(tone === "success" ? 0.2 : 0.12, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration);
  }, []);

  const loadActiveSession = useCallback(async () => {
    try {
      const response = await getActiveScanSession();
      setSession(response.data || null);
      setActionError("");
    } catch (error) {
      const message = error.message || "Unable to check active scan session.";
      setActionError(message);
      showNotice({
        type: "error",
        title: "Scanner Connection",
        message
      }, null, ERROR_NOTICE_TIMEOUT_MS);
    }
  }, [showNotice]);

  const submitBarcode = useCallback(async (value) => {
    const barcode = String(value || "").trim().toUpperCase();
    if (!barcode || !activeSession?.id) return false;

    const now = Date.now();
    if (scanLockedRef.current || shouldSuppressDuplicate(barcode, lastScanRef.current, now)) {
      clearScannerInput();
      return false;
    }

    scanLockedRef.current = true;
    lastScanRef.current = { value: barcode, at: now };
    lastScannedCodeRef.current = barcode;
    clearScannerInput();
    setActionError("");

    try {
      const result = await sendWithAck(socketRef.current, "scanner:submit-scan", {
        sessionId: activeSession.id,
        barcode
      });

      if (result?.session) setSession(result.session);
      const nextSession = result?.session || activeSession;

      if (result?.ignoredDuplicate) {
        setActionError("");
        releaseScanLock();
        return false;
      }

      if (result?.accepted) {
        playScanTone("success");
        setActionError("");
        showNotice({
          type: "success",
          title: result.completed ? "Placement Completed" : "Scan Accepted",
          message: result.completed ? "Placement confirmed automatically." : "Ready for the next barcode."
        }, nextSession);

        if (!result.completed && getSessionStepKey(result.session) === getSessionStepKey(activeSession)) {
          releaseScanLock(SCAN_COOLDOWN_MS);
        }
        return true;
      }

      if (result?.error) {
        setActionError(result.error);
        showNotice({
          type: "error",
          title: "Scan Error",
          message: result.error
        }, nextSession, ERROR_NOTICE_TIMEOUT_MS);
        playScanTone("error");
      }
      releaseScanLock();
      return false;
    } catch (error) {
      const message = error.message || "Scan could not be submitted.";
      setActionError(message);
      showNotice({
        type: "error",
        title: "Scan Error",
        message
      }, activeSession, ERROR_NOTICE_TIMEOUT_MS);
      releaseScanLock();
      return false;
    }
  }, [activeSession, clearScannerInput, playScanTone, releaseScanLock, showNotice]);

  useEffect(() => {
    loadActiveSession();
  }, [loadActiveSession]);

  useEffect(() => {
    const handleInteraction = () => {
      unlockAudio();
    };

    window.addEventListener("pointerdown", handleInteraction, { capture: true });
    window.addEventListener("keydown", handleInteraction, { capture: true });
    window.addEventListener("touchstart", handleInteraction, { capture: true });

    return () => {
      window.removeEventListener("pointerdown", handleInteraction, { capture: true });
      window.removeEventListener("keydown", handleInteraction, { capture: true });
      window.removeEventListener("touchstart", handleInteraction, { capture: true });
      if (unlockTimerRef.current) window.clearTimeout(unlockTimerRef.current);
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
    };
  }, [unlockAudio]);

  useEffect(() => {
    const releaseCamera = () => {
      stopCamera({ clearError: false });
    };

    window.addEventListener("pagehide", releaseCamera);
    window.addEventListener("beforeunload", releaseCamera);

    return () => {
      window.removeEventListener("pagehide", releaseCamera);
      window.removeEventListener("beforeunload", releaseCamera);
      releaseCamera();
    };
  }, [stopCamera]);

  useEffect(() => {
    const socket = createScannerSocket();
    socketRef.current = socket;

    socket.on("connect", () => setConnectionStatus("Connected"));
    socket.on("disconnect", () => setConnectionStatus("Disconnected"));
    socket.on("connect_error", () => setConnectionStatus("Disconnected"));
    socket.on("reconnect_attempt", () => setConnectionStatus("Reconnecting"));

    const handleSessionEvent = (payload = {}) => {
      const nextSession = payload.session || null;
      setSession(nextSession);
      if (payload.scan?.error) {
        setActionError(payload.scan.error);
        showNotice({
          type: "error",
          title: "Scan Error",
          message: payload.scan.error
        }, nextSession, ERROR_NOTICE_TIMEOUT_MS);
      } else if (payload.scan || getSessionStepKey(nextSession) !== currentStepKeyRef.current) {
        setActionError("");
      }
    };

    socket.on("scanner:session-started", handleSessionEvent);
    socket.on("scanner:session-updated", handleSessionEvent);
    socket.on("scanner:session-cancelled", handleSessionEvent);
    socket.on("scanner:session-completed", handleSessionEvent);
    socket.on("scanner:scan-accepted", handleSessionEvent);
    socket.on("scanner:scan-error", handleSessionEvent);
    socket.on("scanner:scan-ignored", handleSessionEvent);
    socket.on("scanner:scan-cancelled", handleSessionEvent);

    socket.connect();

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [showNotice]);

  useEffect(() => {
    if (notice?.screenKey && notice.screenKey !== screenKey) {
      clearNotice();
    }
  }, [clearNotice, notice, screenKey]);

  useEffect(() => {
    const nextStepKey = getSessionStepKey(activeSession);
    const previousStepKey = currentStepKeyRef.current;

    if (nextStepKey !== previousStepKey) {
      currentStepKeyRef.current = nextStepKey;
      clearScannerInput();
      setActionError("");

      if (previousStepKey && nextStepKey) {
        releaseScanLock();
      } else if (!nextStepKey) {
        scanLockedRef.current = false;
      }
    }
  }, [activeSession, clearScannerInput, releaseScanLock]);

  useEffect(() => {
    if (!completedSession) return undefined;

    const cargoId = completedResult?.cargo?.cargo_id || completedSession?.context?.cargo_id;
    const binBarcode = completedResult?.bin?.barcode || completedSession?.context?.scanned_bin_barcode;
    showNotice({
      type: "success",
      title: "Placement Completed",
      message: [cargoId, binBarcode].filter(Boolean).join("  |  ") || "Placement confirmed."
    }, completedSession, 5000);

    const timeout = window.setTimeout(async () => {
      try {
        const response = await refreshScanSession();
        setSession(response.data || null);
      } catch {
        setSession(null);
      }
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, [completedResult, completedSession, showNotice]);

  useEffect(() => {
    if (cameraError && cameraError !== lastCameraErrorRef.current) {
      lastCameraErrorRef.current = cameraError;
      showNotice({
        type: "warning",
        title: "Camera Status",
        message: cameraError
      }, session, ERROR_NOTICE_TIMEOUT_MS);
    }

    if (!cameraError) {
      lastCameraErrorRef.current = "";
    }
  }, [cameraError, session, showNotice]);

  useEffect(() => {
    const sessionError = activeSession?.last_error || "";
    const sessionSuccess = activeSession?.last_success || "";

    if (sessionError && sessionError !== lastSessionErrorRef.current) {
      lastSessionErrorRef.current = sessionError;
      showNotice({
        type: "error",
        title: "Scan Error",
        message: sessionError
      }, activeSession, ERROR_NOTICE_TIMEOUT_MS);
    }

    if (!sessionError) {
      lastSessionErrorRef.current = "";
    }

    if (sessionSuccess && sessionSuccess !== lastSessionSuccessRef.current) {
      lastSessionSuccessRef.current = sessionSuccess;
      showNotice({
        type: "success",
        title: "Scan Updated",
        message: sessionSuccess
      }, activeSession);
    }

    if (!sessionSuccess) {
      lastSessionSuccessRef.current = "";
    }
  }, [activeSession, showNotice]);

  useEffect(() => {
    let cancelled = false;

    const startCamera = async () => {
      stopCamera();

      if (!cameraSessionKey) {
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("Camera access is not supported on this device.");
        return;
      }

      setCameraState("starting");

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });

        if (cancelled || !cameraSessionKey) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        if (!cancelled) {
          setCameraError("");
          setCameraState("active");
        }
      } catch {
        if (!cancelled) {
          stopCamera({ clearError: false });
          setCameraError("Camera permission is required for barcode scanning.");
        }
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [cameraSessionKey, stopCamera]);

  useEffect(() => {
    const canDetect = typeof window !== "undefined" && "BarcodeDetector" in window;
    if (canDetect && !detectorRef.current) {
      detectorRef.current = new window.BarcodeDetector({
        formats: ["code_128", "code_39", "ean_13", "qr_code", "data_matrix"]
      });
    }

    const scanFrame = async () => {
      const video = videoRef.current;
      const detector = detectorRef.current;
      const cameraReady = Boolean(cameraSessionKey && cameraState === "active");

      if (
        detector
        && cameraReady
        && activeSession
        && video
        && video.readyState >= 2
        && !scanLockedRef.current
      ) {
        try {
          const barcodes = await detector.detect(video);
          const rawValue = String(barcodes?.[0]?.rawValue || "").trim().toUpperCase();
          const now = Date.now();
          const previousDetection = cameraDetectionRef.current;

          if (rawValue) {
            if (previousDetection.value !== rawValue) {
              cameraDetectionRef.current = { value: rawValue, lastSeenAt: now };
              submitBarcode(rawValue);
            } else {
              cameraDetectionRef.current = {
                value: previousDetection.value,
                lastSeenAt: now
              };
            }
          } else if (
            previousDetection.value
            && now - previousDetection.lastSeenAt >= CAMERA_RELEASE_MS
          ) {
            cameraDetectionRef.current = { value: "", lastSeenAt: 0 };
          }
        } catch {
        }
      } else if (!cameraReady) {
        cameraDetectionRef.current = { value: "", lastSeenAt: 0 };
      }

      animationRef.current = window.requestAnimationFrame(scanFrame);
    };

    animationRef.current = window.requestAnimationFrame(scanFrame);

    if (cameraSessionKey && !canDetect) {
      setCameraError("Camera barcode detection is not supported by this browser. Hardware scanner input is ready.");
    }

    return () => {
      if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
    };
  }, [activeSession, cameraSessionKey, cameraState, submitBarcode]);

  useEffect(() => {
    keyboardInputRef.current?.focus();
  }, [activeSession]);

  const cancelScan = async () => {
    clearScannerInput();
    cameraDetectionRef.current = { value: "", lastSeenAt: 0 };
    lastScanRef.current = { value: "", at: 0 };
    scanLockedRef.current = true;

    if (!activeSession?.id) {
      await loadActiveSession();
      scanLockedRef.current = false;
      return;
    }

    setActionError("");

    try {
      const result = await sendWithAck(socketRef.current, "scanner:cancel-scan", {
        sessionId: activeSession.id
      });
      setSession(result?.session || null);
      showNotice({
        type: "warning",
        title: "Scan Cancelled",
        message: "Checking for the active task again."
      }, result?.session || null);
      await loadActiveSession();
    } catch (error) {
      const message = error.message || "Cancel scan failed.";
      setActionError(message);
      showNotice({
        type: "error",
        title: "Cancel Failed",
        message
      }, activeSession, ERROR_NOTICE_TIMEOUT_MS);
      await loadActiveSession();
    } finally {
      releaseScanLock();
    }
  };

  const handleLogout = async () => {
    stopCamera();
    await logout();
    clearStoredAuthToken();
    navigate("/", { replace: true });
  };

  const handleKeyboardSubmit = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const barcode = event.currentTarget.value || keyboardValue;
    event.currentTarget.value = "";
    clearScannerInput();
    submitBarcode(barcode);
  };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-slate-950 text-white">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#0f1b2e_0%,#07111f_52%,#050b14_100%)]" />
      <input
        ref={keyboardInputRef}
        value={keyboardValue}
        onChange={(event) => {
          lastScannedCodeRef.current = event.target.value;
          setKeyboardValue(event.target.value);
        }}
        onKeyDown={handleKeyboardSubmit}
        className="absolute left-0 top-0 h-px w-px opacity-0"
        autoComplete="off"
        inputMode="none"
        aria-label="Hardware barcode scanner input"
      />

      <section
        key={screenKey}
        className="scanner-state-enter relative z-10 grid min-h-dvh grid-rows-[auto_auto_1fr_auto] px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)] sm:px-6 sm:pb-6 sm:pt-5"
      >
        <header className="mx-auto w-full max-w-[760px]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200/80">
                {activeSession ? "Active Workflow" : completedSession ? "Workflow Complete" : "Scanner Standby"}
              </div>
              <h1 className="mt-2 truncate text-xl font-semibold leading-tight text-white sm:text-2xl">
                {display.workflow}
              </h1>
            </div>
            <ConnectionBadge status={connectionStatus} />
          </div>

          <div className="mt-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
              Current Instruction
            </div>
            <h2 className="mt-2 text-2xl font-semibold leading-tight text-white sm:text-3xl">
              {display.instruction}
            </h2>
            <p className="mt-3 max-w-xl text-sm font-medium leading-6 text-white/70">
              {activeSession ? currentStepLabel || "Scan the required barcode." : display.progress}
            </p>
          </div>
        </header>

        <div className="flex min-h-[72px] items-center justify-center py-4">
          <ScannerNotice notice={notice} />
        </div>

        <div className="flex min-h-[250px] items-center justify-center py-4 sm:min-h-[300px] sm:py-6">
          <ScannerFrame active={Boolean(activeSession)} cameraState={cameraState} videoRef={videoRef} />
        </div>

        <footer className="mx-auto w-full max-w-[760px] space-y-4">
          <StepIndicator session={activeSession || completedSession} />

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={cancelScan}
              disabled={!activeSession}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-red-300/45 bg-red-950/70 px-4 text-sm font-semibold text-red-50 shadow-lg shadow-red-950/20 backdrop-blur-md transition hover:bg-red-900/80 active:scale-[0.99] disabled:border-white/15 disabled:bg-black/30 disabled:text-white/35 disabled:opacity-100"
            >
              <XCircle className="h-5 w-5" />
              Cancel Scan
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/20 bg-black/55 px-4 text-sm font-semibold text-white shadow-lg shadow-black/20 backdrop-blur-md transition hover:bg-white/10 active:scale-[0.99]"
            >
              <LogOut className="h-5 w-5" />
              Logout
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}

export default ScannerPortal;

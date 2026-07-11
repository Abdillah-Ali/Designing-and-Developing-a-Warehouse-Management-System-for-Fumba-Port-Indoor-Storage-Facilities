import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogOut, XCircle } from "lucide-react";
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

  const [session, setSession] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("Connecting");
  const [cameraError, setCameraError] = useState("");
  const [actionError, setActionError] = useState("");
  const [keyboardValue, setKeyboardValue] = useState("");

  const activeSession = session?.status === "active" ? session : null;
  const completedSession = session?.status === "completed" ? session : null;

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

  const clearScannerInput = useCallback(() => {
    lastScannedCodeRef.current = "";
    setKeyboardValue("");
    if (keyboardInputRef.current) {
      keyboardInputRef.current.value = "";
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
      setActionError(error.message || "Unable to check active scan session.");
    }
  }, []);

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

      if (result?.ignoredDuplicate) {
        setActionError("");
        releaseScanLock();
        return false;
      }

      if (result?.accepted) {
        playScanTone("success");
        setActionError("");

        if (!result.completed && getSessionStepKey(result.session) === getSessionStepKey(activeSession)) {
          releaseScanLock(SCAN_COOLDOWN_MS);
        }
        return true;
      }

      if (result?.error) {
        setActionError(result.error);
        playScanTone("error");
      }
      releaseScanLock();
      return false;
    } catch (error) {
      setActionError(error.message || "Scan could not be submitted.");
      releaseScanLock();
      return false;
    }
  }, [activeSession, clearScannerInput, playScanTone, releaseScanLock]);

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
      audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
    };
  }, [unlockAudio]);

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
      if (payload.scan?.error) setActionError(payload.scan.error);
      else if (payload.scan || getSessionStepKey(nextSession) !== currentStepKeyRef.current) {
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
  }, []);

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

    const timeout = window.setTimeout(async () => {
      try {
        const response = await refreshScanSession();
        setSession(response.data || null);
      } catch {
        setSession(null);
      }
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, [completedSession]);

  useEffect(() => {
    let cancelled = false;

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("Camera access is not supported on this device.");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        setCameraError("");
      } catch {
        setCameraError("Camera permission is required for barcode scanning.");
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

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

      if (
        detector
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
      } else if (!activeSession) {
        cameraDetectionRef.current = { value: "", lastSeenAt: 0 };
      }

      animationRef.current = window.requestAnimationFrame(scanFrame);
    };

    animationRef.current = window.requestAnimationFrame(scanFrame);

    if (!canDetect) {
      setCameraError("Camera barcode detection is not supported by this browser. Hardware scanner input is ready.");
    }

    return () => {
      if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
    };
  }, [activeSession, submitBarcode]);

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
      await loadActiveSession();
    } catch (error) {
      setActionError(error.message || "Cancel scan failed.");
      await loadActiveSession();
    } finally {
      releaseScanLock();
    }
  };

  const handleLogout = async () => {
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
    <main className="relative min-h-dvh overflow-hidden bg-black text-white">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        muted
        playsInline
      />
      <div className="absolute inset-0 bg-black/45" />

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

      <section className="relative z-10 flex min-h-dvh flex-col justify-between p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold leading-tight sm:text-3xl">
              {display.workflow}
            </h1>
            <div className="mt-2 text-sm font-semibold text-white/75">
              {display.progress}
            </div>
            <div className="mt-3 max-w-[720px] text-3xl font-semibold leading-tight sm:text-5xl">
              {display.instruction}
            </div>
          </div>
          <div className={`shrink-0 rounded border px-3 py-2 text-xs font-semibold ${
            connectionStatus === "Connected"
              ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100"
              : "border-amber-400/50 bg-amber-500/15 text-amber-100"
          }`}>
            {connectionStatus}
          </div>
        </div>

        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[34vh] w-[82vw] max-w-[760px] -translate-x-1/2 -translate-y-1/2 border-2 border-white/75">
          <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/70" />
          <div className="absolute inset-x-3 top-3 h-6 border-t-4 border-white" />
          <div className="absolute inset-x-3 bottom-3 h-6 border-b-4 border-white" />
        </div>

        <div className="space-y-4">
          {completedResult && (
            <div className="max-w-xl rounded border border-emerald-400/50 bg-black/70 px-4 py-3 text-sm font-semibold text-emerald-100">
              <div>Placement Completed Successfully</div>
              <div className="mt-2 grid gap-1 text-xs text-emerald-50/90">
                <span>Cargo {completedResult.cargo?.cargo_id || completedSession?.context?.cargo_id}</span>
                <span>Bin {completedResult.bin?.barcode || completedSession?.context?.scanned_bin_barcode}</span>
                <span>Placement confirmed.</span>
              </div>
            </div>
          )}

          {session?.last_success && !completedResult && (
            <div className="text-sm font-semibold text-white/80">
              {session.last_success}
            </div>
          )}

          {(session?.last_error || actionError || cameraError) && (
            <div className="max-w-xl rounded border border-red-400/60 bg-red-950/75 px-4 py-3 text-sm font-semibold text-red-50">
              {session?.last_error || actionError || cameraError}
            </div>
          )}

          <div className="h-2 overflow-hidden rounded bg-white/20">
            <div
              className="h-full bg-emerald-400 transition-[width]"
              style={{ width: `${display.percent}%` }}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={cancelScan}
              disabled={!activeSession}
              className="inline-flex h-12 items-center gap-2 rounded border border-white/35 bg-black/70 px-4 text-sm font-semibold text-white disabled:opacity-40"
            >
              <XCircle className="h-5 w-5" />
              Cancel Scan
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex h-12 items-center gap-2 rounded border border-white/35 bg-black/70 px-4 text-sm font-semibold text-white"
            >
              <LogOut className="h-5 w-5" />
              Logout
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

export default ScannerPortal;

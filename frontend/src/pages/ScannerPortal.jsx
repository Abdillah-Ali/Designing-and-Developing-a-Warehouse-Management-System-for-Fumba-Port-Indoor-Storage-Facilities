import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogOut, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { clearStoredAuthToken } from "@/lib/portal-access";
import { getActiveScanSession, logout, refreshScanSession } from "@/services/api";
import { createScannerSocket } from "@/services/scannerSocket";

const SCAN_COOLDOWN_MS = 1600;

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
    const barcode = String(value || "").trim();
    if (!barcode || !activeSession?.id) return;

    const now = Date.now();
    if (
      scanLockedRef.current
      || (
        lastScanRef.current.value === barcode
        && now - lastScanRef.current.at < SCAN_COOLDOWN_MS
      )
    ) {
      return;
    }

    scanLockedRef.current = true;
    lastScanRef.current = { value: barcode, at: now };
    setActionError("");

    try {
      const result = await sendWithAck(socketRef.current, "scanner:submit-scan", {
        sessionId: activeSession.id,
        barcode
      });
      if (result?.session) setSession(result.session);
      if (result?.error) setActionError(result.error);
    } catch (error) {
      setActionError(error.message || "Scan could not be submitted.");
    } finally {
      window.setTimeout(() => {
        scanLockedRef.current = false;
      }, 900);
    }
  }, [activeSession]);

  useEffect(() => {
    loadActiveSession();
  }, [loadActiveSession]);

  useEffect(() => {
    const socket = createScannerSocket();
    socketRef.current = socket;

    socket.on("connect", () => setConnectionStatus("Connected"));
    socket.on("disconnect", () => setConnectionStatus("Disconnected"));
    socket.on("connect_error", () => setConnectionStatus("Disconnected"));
    socket.on("reconnect_attempt", () => setConnectionStatus("Reconnecting"));

    const handleSessionEvent = (payload = {}) => {
      setSession(payload.session || null);
      if (payload.scan?.error) setActionError(payload.scan.error);
      else setActionError("");
    };

    socket.on("scanner:session-started", handleSessionEvent);
    socket.on("scanner:session-updated", handleSessionEvent);
    socket.on("scanner:session-cancelled", handleSessionEvent);
    socket.on("scanner:session-completed", handleSessionEvent);
    socket.on("scanner:scan-accepted", handleSessionEvent);
    socket.on("scanner:scan-error", handleSessionEvent);
    socket.on("scanner:scan-cancelled", handleSessionEvent);

    socket.connect();

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

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
          const rawValue = barcodes?.[0]?.rawValue;
          if (rawValue) submitBarcode(rawValue);
        } catch {
        }
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
    if (!activeSession?.id) {
      await loadActiveSession();
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
    submitBarcode(keyboardValue);
    setKeyboardValue("");
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
        onChange={(event) => setKeyboardValue(event.target.value)}
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

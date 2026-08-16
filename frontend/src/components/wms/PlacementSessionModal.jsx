import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Radio,
  ScanLine,
  XCircle
} from "lucide-react";
import { EnterpriseModal } from "./EnterpriseModal";
import { ErrorState, StatusBadge } from "./OperationalUi";
import { cancelScanSession, getActiveScanSession } from "@/services/api";
import { createScannerSocket } from "@/services/scannerSocket";
import { readCurrentStepError } from "@/lib/scanner-workflow";
import { getErrorMessage } from "@/lib/wms-operational";

function readSessionStep(session) {
  if (!session || session.status !== "active") return null;
  const stepNumber = Number(session.current_step_index || 0) + 1;
  const total = Number(session.total_steps || session.steps?.length || 0);

  return {
    label: total ? `Step ${stepNumber} of ${total}` : "Active Scan Session",
    instruction: session.instruction || session.current_step?.instruction || "Scan Barcode",
    percent: total ? ((stepNumber - 1) / total) * 100 : 0
  };
}

function Detail({ label, value }) {
  return (
    <div className="rounded border border-border bg-muted/20 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-xs font-semibold">{value || "Not recorded"}</div>
    </div>
  );
}

function PlacementSessionModal({ cargo, open, initialSession, recommendation, onClose, onCompleted }) {
  const completionNotifiedRef = useRef(false);
  const cancellationNotifiedRef = useRef(false);
  const [session, setSession] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("Connecting");
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [operationError, setOperationError] = useState("");

  const step = useMemo(() => readSessionStep(session), [session]);
  const completed = session?.status === "completed";
  const cancelled = session?.status === "cancelled";
  const result = session?.context?.result || null;
  const sessionCargo = session?.context?.scanned_cargo_barcode
    ? {
        cargo_id: session.context.cargo_id,
        barcode: session.context.cargo_barcode,
        cargo_type: session.context.cargo_type,
        placement_status: session.context.placement_status,
        location: session.context.location
      }
    : cargo;
  const currentStepError = useMemo(() => readCurrentStepError(session), [session]);

  useEffect(() => {
    if (!open) {
      setSession(null);
      setOperationError("");
      setCancelling(false);
      setLoading(false);
      return undefined;
    }

    completionNotifiedRef.current = false;
    cancellationNotifiedRef.current = false;
    setSession(initialSession || null);
    setOperationError("");
    setCancelling(false);
    setLoading(false);
  }, [initialSession, open]);

  useEffect(() => {
    if (!open) return undefined;

    const socket = createScannerSocket();
    socket.on("connect", () => setConnectionStatus("Connected"));
    socket.on("disconnect", () => setConnectionStatus("Disconnected"));
    socket.on("connect_error", () => setConnectionStatus("Disconnected"));
    socket.on("reconnect_attempt", () => setConnectionStatus("Reconnecting"));

    const handleSession = (payload = {}) => {
      if (!payload.session) return;
      setSession(payload.session);
    };

    socket.on("scanner:session-started", handleSession);
    socket.on("scanner:session-updated", handleSession);
    socket.on("scanner:session-cancelled", handleSession);
    socket.on("scanner:session-completed", handleSession);
    socket.on("scanner:scan-accepted", handleSession);
    socket.on("scanner:scan-error", handleSession);
    socket.on("scanner:scan-ignored", handleSession);
    socket.on("scanner:scan-cancelled", handleSession);
    socket.connect();

    return () => {
      socket.disconnect();
    };
  }, [open]);

  useEffect(() => {
    if (!open || session?.status !== "active") return undefined;
    const checkServerSession = async () => {
      try {
        const response = await getActiveScanSession();
        const current = response.data || null;
        if (current?.id === session.id) {
          setSession(current);
          return;
        }
        await onCompleted?.();
        onClose?.();
      } catch (error) {
        setOperationError(getErrorMessage(error));
      }
    };
    const handle = window.setInterval(checkServerSession, 5000);
    return () => window.clearInterval(handle);
  }, [onClose, onCompleted, open, session?.id, session?.status]);

  useEffect(() => {
    if (!completed || completionNotifiedRef.current) return;
    completionNotifiedRef.current = true;
    onCompleted?.(session?.context?.result || session);
  }, [completed, onCompleted, session]);

  useEffect(() => {
    if (!cancelled || cancellationNotifiedRef.current) return;
    cancellationNotifiedRef.current = true;

    const closeAfterCancellation = async () => {
      try {
        await onCompleted?.();
      } catch {
      }
      onClose?.();
    };

    closeAfterCancellation();
  }, [cancelled, onClose, onCompleted]);

  const cancelSession = async () => {
    if (loading || cancelling) return;

    if (!session?.id || session.status !== "active") {
      onClose?.();
      return;
    }

    setCancelling(true);
    setOperationError("");

    try {
      const response = await cancelScanSession(session.id);
      setSession(response.data || null);
      cancellationNotifiedRef.current = true;
      try {
        await onCompleted?.();
      } catch {
      }
      onClose?.();
    } catch (cancelError) {
      setOperationError(getErrorMessage(cancelError));
    } finally {
      setCancelling(false);
    }
  };

  const progressPercent = completed ? 100 : step?.percent || 0;

  return (
    <EnterpriseModal
      open={open}
      title={session?.context?.operation_type === "relocation" ? "Cargo Relocation Scanner" : "Cargo Placement Scanner"}
      subtitle="The scanned cargo becomes the active cargo and is validated by the backend in real time."
      size="medium"
      onClose={cancelSession}
      closeOnBackdrop={false}
      closeOnEscape={false}
      footer={(
        <>
          <button
            type="button"
            onClick={cancelSession}
            disabled={cancelling || !session || session.status !== "active"}
            className="inline-flex items-center gap-2 rounded border border-destructive/35 bg-destructive/10 px-4 py-2 text-xs font-semibold text-destructive disabled:opacity-50"
          >
            {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
            {cancelling ? "Cancelling" : "Cancel Session"}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        {operationError && <ErrorState message={operationError} />}

        {recommendation && !completed && (
          <div className="rounded border border-info/35 bg-info/10 px-3 py-3 text-xs text-info">
            <div className="font-semibold">Recommended destination: {recommendation.barcode || recommendation.code}</div>
            <div className="mt-1 text-[11px]">Scan the physical bin to continue. The backend will revalidate it before placement; another compatible bin may also be scanned.</div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Cargo Reference" value={sessionCargo?.cargo_id} />
          <Detail label="Cargo Barcode" value={sessionCargo?.barcode} />
          <Detail label="Cargo Type" value={sessionCargo?.cargo_type} />
          <Detail label="Placement Status" value={sessionCargo?.placement_status} />
          <Detail label="Current Location" value={sessionCargo?.location || cargo?.location || "Not placed"} />
          <Detail label="Scanner Connection" value={connectionStatus} />
        </div>

        <div className="rounded border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Radio className="h-4 w-4" />
                {session?.workflow_name || "Cargo Placement"}
              </div>
              <div className="mt-2 text-lg font-semibold">
                {loading
                  ? "Starting scan session..."
                  : completed
                    ? "Placement Completed"
                    : cancelled
                      ? "Scan Session Cancelled"
                      : step?.instruction || "Waiting for scanner"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {completed
                  ? "The backend confirmed placement automatically."
                  : cancelled
                    ? "The scanner will return to waiting unless another session is active."
                    : step?.label || "Waiting for linked scanner connection."}
              </div>
            </div>
            <StatusBadge tone={completed ? "success" : cancelled ? "destructive" : "info"}>
              {session?.status || "starting"}
            </StatusBadge>
          </div>

          <div className="mt-4 h-2 overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-info transition-[width]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {session?.last_success && !completed && (
          <div className="flex items-center gap-2 rounded border border-success/35 bg-success/10 px-3 py-3 text-xs font-semibold text-success">
            <CheckCircle2 className="h-4 w-4" />
            {session.last_success}
          </div>
        )}

        {currentStepError && (
          <div className="flex items-center gap-2 rounded border border-warning/35 bg-warning/10 px-3 py-3 text-xs font-semibold text-warning">
            <AlertTriangle className="h-4 w-4" />
            {currentStepError}
          </div>
        )}

        {completed && (
          <div className="rounded border border-success/35 bg-success/10 px-3 py-3 text-xs font-semibold text-success">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Placement completed successfully.
            </div>
            <div className="mt-2 grid gap-1 text-[11px]">
              <span>Cargo: {result?.cargo?.cargo_id || session?.context?.cargo_id}</span>
              <span>Bin: {result?.bin?.barcode || session?.context?.scanned_bin_barcode}</span>
              <span>Placement confirmed.</span>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing scanner session...
          </div>
        )}

        {!loading && !session && (
          <div className="flex items-center gap-2 rounded border border-info/35 bg-info/10 px-3 py-3 text-xs font-semibold text-info">
            <ScanLine className="h-4 w-4" />
            No active scan session is assigned.
          </div>
        )}
      </div>
    </EnterpriseModal>
  );
}

export { PlacementSessionModal };

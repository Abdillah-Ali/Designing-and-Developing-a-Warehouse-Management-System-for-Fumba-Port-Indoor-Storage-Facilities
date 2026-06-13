import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { EnterpriseModal } from "./EnterpriseModal";
import { ErrorState } from "./OperationalUi";

function DecisionNotesModal({
  open,
  decision,
  subject,
  busy,
  apiError,
  onClose,
  onSubmit
}) {
  const [notes, setNotes] = useState("");
  const [validationError, setValidationError] = useState("");
  const rejecting = decision === "reject";

  useEffect(() => {
    if (!open) return;
    setNotes("");
    setValidationError("");
  }, [decision, open]);

  const submit = () => {
    if (rejecting && !notes.trim()) {
      setValidationError("Rejection notes are required.");
      return;
    }
    setValidationError("");
    onSubmit?.({ decision_notes: notes.trim() });
  };

  return (
    <EnterpriseModal
      open={open}
      title={`${rejecting ? "Reject" : "Approve"} ${subject?.label || "Request"}`}
      subtitle={`Record the supervisor decision for ${subject?.cargo_id || "this request"}.`}
      onClose={onClose}
      size="compact"
      zIndex={70}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className="rounded border border-border bg-secondary px-4 py-2 text-xs font-semibold">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className={rejecting
              ? "rounded bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground disabled:opacity-50"
              : "rounded bg-success px-4 py-2 text-xs font-semibold text-success-foreground disabled:opacity-50"}
          >
            {busy ? "Submitting..." : rejecting ? "Confirm Rejection" : "Confirm Approval"}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-md border border-border bg-card p-3">
          <div className={rejecting ? "rounded-md bg-destructive/10 p-2 text-destructive" : "rounded-md bg-success/10 p-2 text-success"}>
            {rejecting ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
          </div>
          <p className="text-xs text-muted-foreground">
            This decision and its notes will be recorded in the audit log.
          </p>
        </div>
        {(validationError || apiError) && <ErrorState message={validationError || apiError} />}
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold">
            {rejecting ? "Rejection Notes" : "Approval Notes"}
            {rejecting && <span className="text-destructive"> *</span>}
          </span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="min-h-28 w-full rounded-md border border-input bg-background p-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder={rejecting ? "Explain why this request is being rejected." : "Optional approval notes."}
          />
        </label>
      </div>
    </EnterpriseModal>
  );
}

export { DecisionNotesModal };

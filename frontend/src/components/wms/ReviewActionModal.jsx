import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck } from "lucide-react";
import { EnterpriseModal } from "./EnterpriseModal";
import { cargoCorrectionGroups } from "@/lib/cargo-correction-fields";
import { ErrorState } from "./OperationalUi";

const allCorrectionFields = cargoCorrectionGroups.flatMap((group) =>
  group.fields.map((field) => field.key)
);

function ReviewActionModal({
  open,
  mode,
  cargo,
  busy,
  apiError,
  rejectionConditions = [],
  subjectLabel = "Cargo Registration",
  onClose,
  onSubmit
}) {
  const [comment, setComment] = useState("");
  const [selectedFields, setSelectedFields] = useState([]);
  const [rejectionCode, setRejectionCode] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [correctiveNotes, setCorrectiveNotes] = useState("");
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    if (!open) return;
    setComment("");
    setSelectedFields([]);
    setRejectionCode("");
    setRejectionReason("");
    setCorrectiveNotes("");
    setValidationError("");
  }, [mode, open]);

  const content = useMemo(() => ({
    approve: {
      title: `Approve ${subjectLabel}`,
      subtitle: `Confirm review approval for ${cargo?.cargo_id || "cargo"}.`,
      icon: CheckCircle2
    },
    reject: {
      title: `Reject ${subjectLabel}`,
      subtitle: `Record the rejection condition and operational explanation for ${cargo?.cargo_id || "cargo"}.`,
      icon: AlertTriangle
    },
    correction: {
      title: "Request Registration Correction",
      subtitle: `Tell the registering staff exactly what must change on ${cargo?.cargo_id || "cargo"}.`,
      icon: ClipboardCheck
    }
  }[mode] || {}), [cargo?.cargo_id, mode, subjectLabel]);

  const toggleField = (field) => {
    setSelectedFields((current) => current.includes(field)
      ? current.filter((item) => item !== field)
      : [...current, field]);
  };

  const toggleGroup = (group) => {
    const keys = group.fields.map((field) => field.key);
    const allSelected = keys.every((key) => selectedFields.includes(key));
    setSelectedFields((current) => allSelected
      ? current.filter((key) => !keys.includes(key))
      : [...new Set([...current, ...keys])]);
  };

  const submit = () => {
    setValidationError("");
    if (mode === "correction") {
      if (!comment.trim()) {
        setValidationError("Correction comment is required.");
        return;
      }
      if (selectedFields.length === 0) {
        setValidationError("Select at least one field that requires correction.");
        return;
      }
      onSubmit?.({
        correction_notes: comment.trim(),
        correction_fields: selectedFields
      });
      return;
    }
    if (mode === "reject") {
      if (!rejectionCode || !rejectionReason.trim()) {
        setValidationError("Rejection condition and explanation are required.");
        return;
      }
      onSubmit?.({
        decision_notes: `${rejectionCode}: ${rejectionReason.trim()}`,
        rejection_code: rejectionCode,
        rejection_reason: rejectionReason.trim(),
        corrective_notes: correctiveNotes.trim()
      });
      return;
    }
    onSubmit?.(comment.trim());
  };

  const Icon = content.icon || ClipboardCheck;

  return (
    <EnterpriseModal
      open={open}
      title={content.title}
      subtitle={content.subtitle}
      onClose={onClose}
      size={mode === "correction" ? "large" : "compact"}
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
            className={mode === "reject"
              ? "rounded bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground disabled:opacity-50"
              : mode === "correction"
                ? "rounded bg-warning px-4 py-2 text-xs font-semibold text-warning-foreground disabled:opacity-50"
                : "rounded bg-success px-4 py-2 text-xs font-semibold text-success-foreground disabled:opacity-50"}
          >
            {busy ? "Submitting..." : mode === "correction" ? "Send Correction Request" : mode === "reject" ? "Confirm Rejection" : "Confirm Approval"}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-md border border-border bg-card p-3">
          <div className="rounded-md bg-info/10 p-2 text-info"><Icon className="h-5 w-5" /></div>
          <div className="text-xs text-muted-foreground">
            This action becomes part of the cargo registration approval history.
          </div>
        </div>
        {(validationError || apiError) && <ErrorState message={validationError || apiError} />}

        {mode === "correction" && (
          <>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold">Correction Comment <span className="text-destructive">*</span></span>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                className="min-h-28 w-full rounded-md border border-input bg-background p-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Explain what is wrong, what must be corrected, and any additional instructions."
              />
            </label>
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold">
                  Fields Requiring Correction <span className="text-destructive">*</span>
                  <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                    {selectedFields.length} selected
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedFields(
                    selectedFields.length === allCorrectionFields.length ? [] : allCorrectionFields
                  )}
                  className="rounded border border-border bg-secondary px-2 py-1 text-[10px] font-semibold"
                >
                  {selectedFields.length === allCorrectionFields.length ? "Clear all fields" : "Select all fields"}
                </button>
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                {cargoCorrectionGroups.map((group) => {
                  const groupSelected = group.fields.every((field) => selectedFields.includes(field.key));
                  return (
                    <section key={group.key} className="rounded-md border border-border bg-card">
                      <button
                        type="button"
                        onClick={() => toggleGroup(group)}
                        className="flex w-full items-center justify-between border-b border-border bg-panel-header px-3 py-2 text-left text-xs font-semibold"
                      >
                        {group.label}
                        <span className="text-[10px] text-info">{groupSelected ? "Clear section" : "Select section"}</span>
                      </button>
                      <div className="space-y-1 p-2">
                        {group.fields.map((field) => (
                          <label key={field.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/50">
                            <input
                              type="checkbox"
                              checked={selectedFields.includes(field.key)}
                              onChange={() => toggleField(field.key)}
                              className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                            />
                            {field.label}
                          </label>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {mode === "approve" && (
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold">Approval Notes</span>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Optional review notes."
            />
          </label>
        )}

        {mode === "reject" && (
          <>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold">Rejection Condition <span className="text-destructive">*</span></span>
              <select value={rejectionCode} onChange={(event) => setRejectionCode(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-xs">
                <option value="">Select condition</option>
                {rejectionConditions.map((condition) => (
                  <option key={condition.value} value={condition.value}>{condition.label}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold">Rejection Explanation <span className="text-destructive">*</span></span>
              <textarea value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-xs" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold">Additional Notes</span>
              <textarea value={correctiveNotes} onChange={(event) => setCorrectiveNotes(event.target.value)} className="min-h-20 w-full rounded-md border border-input bg-background p-3 text-xs" />
            </label>
          </>
        )}
      </div>
    </EnterpriseModal>
  );
}

export { ReviewActionModal };

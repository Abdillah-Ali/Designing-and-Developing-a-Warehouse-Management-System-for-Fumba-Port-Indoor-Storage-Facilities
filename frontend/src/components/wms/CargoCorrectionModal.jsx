import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { EnterpriseModal } from "./EnterpriseModal";
import { ErrorState, StatusBadge } from "./OperationalUi";
import {
  cargoCorrectionFieldMap,
  cargoCorrectionGroups,
  correctionValueChanged,
  normalizeCorrectionDisplayValue
} from "@/lib/cargo-correction-fields";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/wms-operational";
import { resubmitCargo, updateCargo } from "@/services/api";

const unchangedMessage = "The selected correction fields have not been updated. Please modify the highlighted fields before resubmitting.";

function buildForm(cargo) {
  return Object.fromEntries(
    Object.keys(cargoCorrectionFieldMap).map((field) => [field, cargo?.[field] ?? ""])
  );
}

function CargoCorrectionModal({ open, cargo, onClose, onCompleted }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isCorrectionRequired = cargo?.registration_status === "Correction Required";
  const selectedFields = useMemo(
    () => isCorrectionRequired && Array.isArray(cargo?.correction_fields)
      ? cargo.correction_fields
      : [],
    [cargo?.correction_fields, isCorrectionRequired]
  );
  const originalValues = cargo?.correction_original_values || {};
  const isRejected = cargo?.registration_status === "Rejected";
  const baselineValues = Object.keys(originalValues).length > 0
    ? originalValues
    : isRejected
      ? buildForm(cargo)
      : {};
  const comparisonFields = selectedFields.length > 0
    ? selectedFields
    : isRejected
      ? Object.keys(baselineValues).filter((field) => cargoCorrectionFieldMap[field])
      : [];

  useEffect(() => {
    if (!open || !cargo) return;
    setForm(buildForm(cargo));
    setError("");
  }, [cargo, open]);

  const comparisons = comparisonFields.map((field) => ({
    field,
    label: cargoCorrectionFieldMap[field]?.label || field,
    original: baselineValues[field],
    updated: form[field],
    changed: correctionValueChanged(field, baselineValues[field], form[field])
  }));
  const unchanged = comparisons.filter((item) => !item.changed);
  const changed = comparisons.filter((item) => item.changed);

  const updateField = (field, value) => {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "cargo_type" && value !== "Hazardous Cargo") next.hazard_class = "";
      return next;
    });
  };

  const submit = async () => {
    if (!isCorrectionRequired && !isRejected) {
      setError("This correction request is no longer active.");
      return;
    }
    if (!isRejected && unchanged.length > 0) {
      setError(unchangedMessage);
      return;
    }
    if (isRejected && changed.length === 0) {
      setError("The rejected registration has not been updated. Please modify the form before resubmitting.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await updateCargo(cargo.id, form);
      await resubmitCargo(cargo.id, "Registration details corrected and resubmitted.");
      await onCompleted?.();
      onClose?.();
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      title={`${isRejected ? "Revise" : "Correct"} Cargo Registration${cargo?.cargo_id ? `: ${cargo.cargo_id}` : ""}`}
      subtitle={isRejected
        ? "Update the original registration using the supervisor's rejection notes, then resubmit it for review."
        : "Requested fields are highlighted. Every highlighted field must be changed before resubmission."}
      onClose={onClose}
      size="review"
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={busy} className="rounded border border-border bg-secondary px-4 py-2 text-xs font-semibold">Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="rounded bg-success px-4 py-2 text-xs font-semibold text-success-foreground disabled:opacity-50">
            {busy ? "Saving and Resubmitting..." : "Save and Resubmit"}
          </button>
        </>
      )}
    >
      {cargo && (
        <div className="space-y-4">
          <section className="rounded-md border border-warning/40 bg-warning/10 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              <div>
                <div className="text-xs font-semibold">{isRejected ? "Supervisor Rejection Notes" : "Supervisor Instructions"}</div>
                <p className="mt-1 text-xs">
                  {cargo.correction_notes || cargo.corrective_notes || cargo.rejection_reason || (isRejected
                    ? "Revise the registration details before resubmitting."
                    : "Update every highlighted field.")}
                </p>
              </div>
            </div>
          </section>
          {error && <ErrorState message={error} />}

          {cargoCorrectionGroups.map((group) => (
            <section key={group.key} className="overflow-hidden rounded-md border border-border bg-card">
              <h3 className="border-b border-border bg-panel-header px-4 py-2.5 text-xs font-semibold">{group.label}</h3>
              <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                {group.fields.map((field) => {
                  const requested = selectedFields.includes(field.key);
                  const changed = requested && correctionValueChanged(field.key, baselineValues[field.key], form[field.key]);
                  const inputClasses = cn(
                    "w-full rounded-md border bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring",
                    field.type === "textarea" ? "min-h-24 py-2" : "h-10",
                    requested ? "border-warning ring-2 ring-warning/20" : "border-input"
                  );
                  return (
                    <label key={field.key} className={cn("space-y-1.5 rounded-md", field.type === "textarea" && "md:col-span-2 xl:col-span-3")}>
                      <span className="flex items-center justify-between gap-2 text-[11px] font-semibold">
                        {field.label}
                        {requested && <StatusBadge tone={changed ? "success" : "warning"}>{changed ? "Changed" : "Correction Required"}</StatusBadge>}
                      </span>
                      {field.type === "select" ? (
                        <select value={form[field.key] ?? ""} onChange={(event) => updateField(field.key, event.target.value)} className={inputClasses}>
                          {!field.options?.includes("") && <option value="">Select {field.label.toLowerCase()}</option>}
                          {(field.options || []).map((option) => <option key={option || "empty"} value={option}>{option || "Not applicable"}</option>)}
                        </select>
                      ) : field.type === "textarea" ? (
                        <textarea value={form[field.key] ?? ""} onChange={(event) => updateField(field.key, event.target.value)} className={inputClasses} />
                      ) : (
                        <input type={field.type || "text"} value={form[field.key] ?? ""} onChange={(event) => updateField(field.key, event.target.value)} className={inputClasses} />
                      )}
                      {requested && (
                        <span className="block text-[10px] text-muted-foreground">
                          Original: <strong className="text-foreground">{normalizeCorrectionDisplayValue(baselineValues[field.key])}</strong>
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </section>
          ))}

          <section className="overflow-hidden rounded-md border border-border bg-card">
            <h3 className="border-b border-border bg-panel-header px-4 py-2.5 text-xs font-semibold">
              {isRejected ? "Revision Comparison" : "Correction Comparison"}
            </h3>
            <div className="overflow-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-4 py-2">Requested Field</th><th className="px-4 py-2">Original Value</th><th className="px-4 py-2">Updated Value</th><th className="px-4 py-2">Status</th></tr>
                </thead>
                <tbody>
                  {comparisons.map((item) => (
                    <tr key={item.field} className="border-t border-border">
                      <td className="px-4 py-2.5 font-semibold">{item.label}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{normalizeCorrectionDisplayValue(item.original)}</td>
                      <td className="px-4 py-2.5">{normalizeCorrectionDisplayValue(item.updated)}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold", item.changed ? "text-success" : "text-warning")}>
                          {item.changed && <CheckCircle2 className="h-3.5 w-3.5" />}
                          {item.changed ? "Changed" : "Still unchanged"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </EnterpriseModal>
  );
}

export { CargoCorrectionModal };

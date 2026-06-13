import { useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  FileText,
  History,
  PackageSearch,
  RefreshCw
} from "lucide-react";
import { EnterpriseModal } from "./EnterpriseModal";
import { ErrorState, LoadingState, StatusBadge } from "./OperationalUi";
import {
  cargoCorrectionFieldMap,
  normalizeCorrectionDisplayValue
} from "@/lib/cargo-correction-fields";
import {
  formatDateTime,
  formatMeasure,
  getErrorMessage,
  statusTone
} from "@/lib/wms-operational";
import { getCargoById, getCargoDocumentContent } from "@/services/api";

const sectionClass = "overflow-hidden rounded-md border border-border bg-card";
const sectionTitleClass = "border-b border-border bg-panel-header px-4 py-2.5 text-xs font-semibold";

function DetailGrid({ items }) {
  return (
    <dl className="grid sm:grid-cols-2 xl:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="border-b border-border/70 px-4 py-3 sm:border-r">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
          <dd className="mt-1 break-words text-xs font-medium text-foreground">{value || "Not recorded"}</dd>
        </div>
      ))}
    </dl>
  );
}

function base64ToBlob(content, type) {
  const binary = window.atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type });
}

function actionLabel(action) {
  return String(action || "")
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function CargoReviewModal({
  open,
  approval,
  busy,
  onClose,
  onApprove,
  onReject,
  onRequestCorrection
}) {
  const [state, setState] = useState({ cargo: null, loading: false, error: "" });
  const [preview, setPreview] = useState({ document: null, data: null, loading: false, error: "" });

  const cargoIdentifier = approval?.cargo_record_id || approval?.cargo_id || "";

  useEffect(() => {
    if (!open || !cargoIdentifier) return;
    let active = true;
    setState({ cargo: null, loading: true, error: "" });
    setPreview({ document: null, data: null, loading: false, error: "" });
    getCargoById(cargoIdentifier)
      .then((response) => {
        if (active) setState({ cargo: response.data, loading: false, error: "" });
      })
      .catch((error) => {
        if (active) setState({ cargo: null, loading: false, error: getErrorMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [cargoIdentifier, open]);

  const cargo = state.cargo;
  const correctionFields = useMemo(
    () => Array.isArray(cargo?.correction_fields) ? cargo.correction_fields : [],
    [cargo?.correction_fields]
  );
  const correctionChanges = cargo?.correction_last_changes || {};
  const correctionReviewFields = correctionFields.length > 0
    ? correctionFields
    : Object.keys(correctionChanges);
  const hasSubmittedCorrections = Object.keys(correctionChanges).length > 0;

  const loadDocument = async (document, action = "preview") => {
    setPreview({ document, data: null, loading: true, error: "" });
    try {
      const response = await getCargoDocumentContent(cargo.id, document.id);
      const data = response.data;
      const blob = base64ToBlob(data.content_base64, data.file_type);
      const url = URL.createObjectURL(blob);
      if (action === "download") {
        const anchor = window.document.createElement("a");
        anchor.href = url;
        anchor.download = data.file_name;
        anchor.click();
        URL.revokeObjectURL(url);
        setPreview((current) => ({ ...current, data, loading: false }));
        return;
      }
      if (action === "open") {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      setPreview({ document, data: { ...data, url }, loading: false, error: "" });
    } catch (error) {
      setPreview({ document, data: null, loading: false, error: getErrorMessage(error) });
    }
  };

  useEffect(() => () => {
    if (preview.data?.url) URL.revokeObjectURL(preview.data.url);
  }, [preview.data?.url]);

  const footer = cargo && (
    <>
      <button type="button" onClick={onClose} disabled={busy} className="rounded border border-border bg-secondary px-4 py-2 text-xs font-semibold">
        Close
      </button>
      <button type="button" onClick={() => onRequestCorrection?.(cargo)} disabled={busy} className="rounded bg-warning px-4 py-2 text-xs font-semibold text-warning-foreground disabled:opacity-50">
        Request Correction
      </button>
      <button type="button" onClick={() => onReject?.(cargo)} disabled={busy} className="rounded bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground disabled:opacity-50">
        Reject
      </button>
      <button type="button" onClick={() => onApprove?.(cargo)} disabled={busy} className="rounded bg-success px-4 py-2 text-xs font-semibold text-success-foreground disabled:opacity-50">
        Approve
      </button>
    </>
  );

  return (
    <EnterpriseModal
      open={open}
      title={`Cargo Registration Review${cargo?.cargo_id ? `: ${cargo.cargo_id}` : ""}`}
      subtitle="Review registration details, documents, corrections, and approval history without leaving the queue."
      onClose={onClose}
      size="review"
      footer={footer}
    >
      {state.loading && <LoadingState label="Loading cargo registration..." />}
      {state.error && <ErrorState message={state.error} />}
      {cargo && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-md bg-info/10 p-2.5 text-info"><PackageSearch className="h-5 w-5" /></div>
              <div>
                <div className="font-mono text-sm font-semibold">{cargo.cargo_id}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{cargo.barcode} · {cargo.reference_number}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={statusTone(cargo.registration_status)}>{cargo.registration_status}</StatusBadge>
              <StatusBadge tone={statusTone(cargo.placement_status)}>{cargo.placement_status}</StatusBadge>
            </div>
          </div>

          {(cargo.correction_notes || correctionReviewFields.length > 0) && (
            <section className="rounded-md border border-info/30 bg-info/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-info">Correction Review Information</div>
                <StatusBadge tone={hasSubmittedCorrections ? "success" : "pending"}>
                  {hasSubmittedCorrections ? "Staff Changes Submitted" : "Awaiting Staff Revision"}
                </StatusBadge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {hasSubmittedCorrections
                  ? "The requested fields were revised and resubmitted. Review the original and updated values below."
                  : cargo.correction_notes || "A correction request is recorded for this registration."}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {correctionReviewFields.map((field) => (
                  <span key={field} className="rounded-full border border-info/30 bg-background px-2 py-1 text-[10px] font-semibold">
                    {cargoCorrectionFieldMap[field]?.label || field}
                  </span>
                ))}
              </div>
            </section>
          )}

          {Object.keys(correctionChanges).length > 0 && (
            <section className={sectionClass}>
              <h3 className={sectionTitleClass}>Latest Staff Corrections</h3>
              <div className="overflow-auto">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr><th className="px-4 py-2">Field</th><th className="px-4 py-2">Original</th><th className="px-4 py-2">Corrected</th><th className="px-4 py-2">Result</th></tr>
                  </thead>
                  <tbody>
                    {Object.entries(correctionChanges).map(([field, change]) => (
                      <tr key={field} className="border-t border-border">
                        <td className="px-4 py-2.5 font-semibold">{change.label || cargoCorrectionFieldMap[field]?.label || field}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{normalizeCorrectionDisplayValue(change.original)}</td>
                        <td className="px-4 py-2.5">{normalizeCorrectionDisplayValue(change.updated)}</td>
                        <td className="px-4 py-2.5"><StatusBadge tone={change.changed ? "success" : "warning"}>{change.changed ? "Changed" : "Not changed"}</StatusBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            <section className={sectionClass}>
              <h3 className={sectionTitleClass}>Cargo Information</h3>
              <DetailGrid items={[
                ["Cargo Type", cargo.cargo_type],
                ["Packaging Type", cargo.packaging_type],
                ["Quantity", cargo.quantity],
                ["Weight", formatMeasure(cargo.weight, "kg")],
                ["Volume", formatMeasure(cargo.volume, "m3")],
                ["Condition", cargo.cargo_condition],
                ["Hazard Class", cargo.hazard_class],
                ["Description", cargo.cargo_description],
                ["Inspection Notes", cargo.inspection_notes]
              ]} />
            </section>
            <section className={sectionClass}>
              <h3 className={sectionTitleClass}>Consignee Information</h3>
              <DetailGrid items={[
                ["Consignee Name", cargo.consignee_name],
                ["Company", cargo.company_name],
                ["Contact Person", cargo.contact_person],
                ["Phone", cargo.phone_number],
                ["Email", cargo.email],
                ["Registered By", cargo.received_by],
                ["Registration Time", formatDateTime(cargo.created_at)],
                ["Warehouse", cargo.warehouse_name || cargo.warehouse_code]
              ]} />
            </section>
            <section className={`${sectionClass} xl:col-span-2`}>
              <h3 className={sectionTitleClass}>Logistics and Storage</h3>
              <DetailGrid items={[
                ["Source of Cargo", cargo.source_of_cargo],
                ["Container Number", cargo.container_number],
                ["Vehicle Number", cargo.vehicle_number],
                ["Delivery Note", cargo.delivery_note_number],
                ["Current Zone", cargo.zone_code],
                ["Current Rack", cargo.rack_code],
                ["Current Level", cargo.level_code],
                ["Current Bin", cargo.bin_barcode],
                ["Location", cargo.location]
              ]} />
            </section>
          </div>

          <section className={sectionClass}>
            <h3 className={sectionTitleClass}>Supporting Documents</h3>
            <div className="grid gap-3 p-3 lg:grid-cols-[360px_1fr]">
              <div className="space-y-2">
                {(cargo.documents || []).length === 0 && <div className="rounded border border-dashed border-border p-5 text-center text-xs text-muted-foreground">No supporting documents were uploaded.</div>}
                {(cargo.documents || []).map((document) => (
                  <div key={document.id} className="flex items-center gap-2 rounded border border-border p-2.5">
                    <FileText className="h-4 w-4 shrink-0 text-info" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold">{document.file_name}</div>
                      <div className="text-[10px] text-muted-foreground">{Math.ceil(Number(document.file_size || 0) / 1024)} KB</div>
                    </div>
                    <button type="button" title="Preview" onClick={() => loadDocument(document)} className="rounded border border-border p-1.5"><PackageSearch className="h-3.5 w-3.5" /></button>
                    <button type="button" title="Open" onClick={() => loadDocument(document, "open")} className="rounded border border-border p-1.5"><ExternalLink className="h-3.5 w-3.5" /></button>
                    <button type="button" title="Download" onClick={() => loadDocument(document, "download")} className="rounded border border-border p-1.5"><Download className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
              <div className="flex min-h-72 items-center justify-center overflow-hidden rounded border border-border bg-muted/20">
                {preview.loading && <div className="flex items-center gap-2 text-xs"><RefreshCw className="h-4 w-4 animate-spin" /> Loading document...</div>}
                {preview.error && <div className="w-full p-4"><ErrorState message={preview.error} /></div>}
                {!preview.loading && !preview.error && !preview.data && <div className="text-xs text-muted-foreground">Select a document to preview it here.</div>}
                {preview.data?.file_type?.startsWith("image/") && <img src={preview.data.url} alt={preview.data.file_name} className="max-h-[520px] max-w-full object-contain" />}
                {preview.data?.file_type === "application/pdf" && <iframe title={preview.data.file_name} src={preview.data.url} className="h-[520px] w-full border-0" />}
                {preview.data && !preview.data.file_type?.startsWith("image/") && preview.data.file_type !== "application/pdf" && (
                  <div className="max-w-sm p-6 text-center text-xs text-muted-foreground">Preview is unavailable for this file type. Use Open or Download to inspect the document.</div>
                )}
              </div>
            </div>
          </section>

          <section className={sectionClass}>
            <h3 className={`${sectionTitleClass} flex items-center gap-2`}><History className="h-4 w-4" /> Approval and Correction History</h3>
            <div className="divide-y divide-border">
              {(cargo.approval_history || []).length === 0 && <div className="p-5 text-center text-xs text-muted-foreground">No approval history is available.</div>}
              {(cargo.approval_history || []).map((entry) => (
                <div key={entry.id} className="grid gap-2 px-4 py-3 md:grid-cols-[190px_1fr_220px]">
                  <div>
                    <div className="text-xs font-semibold">{actionLabel(entry.action)}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">{formatDateTime(entry.performed_at)}</div>
                  </div>
                  <div>
                    <div className="text-xs">{entry.remarks || "No remarks recorded."}</div>
                    {entry.metadata?.correction_field_labels?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {entry.metadata.correction_field_labels.map((label) => <span key={label} className="rounded bg-warning/10 px-2 py-0.5 text-[10px] text-warning">{label}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {entry.performed_by_name || entry.performed_by_username || "System"}
                    {entry.performed_by ? ` · User ID ${entry.performed_by}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </EnterpriseModal>
  );
}

export { CargoReviewModal };

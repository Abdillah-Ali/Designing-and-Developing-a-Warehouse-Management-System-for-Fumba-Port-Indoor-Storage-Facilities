import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, MapPin, ShieldCheck, XCircle } from "lucide-react";
import { EnterpriseModal } from "./EnterpriseModal";
import { ErrorState, StatusBadge } from "./OperationalUi";
import {
  confirmPlacement,
  getBins,
  getLevels,
  getPlacementSettings,
  getRacks,
  getZones,
  validatePlacement
} from "@/services/api";
import { getErrorMessage } from "@/lib/wms-operational";

const inputClass = "mt-1 h-9 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

function recordId(record) {
  return String(record?.id ?? record?.zone_id ?? record?.rack_id ?? record?.level_id ?? record?.bin_id ?? "");
}

function optionLabel(record, fallback) {
  const code = record?.code || record?.zone_code || record?.rack_code || record?.level_code || record?.barcode || record?.bin_barcode;
  const name = record?.name || record?.zone_name || record?.rack_name;
  return [code, name].filter(Boolean).join(" — ") || fallback;
}

function ManualPlacementModal({ cargo, open, onClose, onCompleted }) {
  const [settings, setSettings] = useState({ enabled: false, reasons: [] });
  const [options, setOptions] = useState({ zones: [], racks: [], levels: [], bins: [] });
  const [selection, setSelection] = useState({ zone: "", rack: "", level: "", bin: "", reason: "" });
  const [validation, setValidation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const operationType = cargo?.current_bin_id || ["Placed", "Relocated"].includes(cargo?.placement_status)
    ? "relocation"
    : "placement";
  const payload = useMemo(() => ({
    cargo_id: cargo?.id || cargo?.cargo_id,
    bin_id: selection.bin,
    placement_mode: "manual",
    manual_placement_reason: selection.reason,
    operation_type: operationType
  }), [cargo, operationType, selection.bin, selection.reason]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true);
    setError("");
    setValidation(null);
    setSelection({ zone: "", rack: "", level: "", bin: "", reason: "" });
    setOptions({ zones: [], racks: [], levels: [], bins: [] });
    Promise.all([getPlacementSettings(), getZones()])
      .then(([settingResponse, zoneResponse]) => {
        if (!active) return;
        setSettings({
          enabled: Boolean(settingResponse.data?.manual_placement_enabled),
          reasons: settingResponse.data?.manual_placement_reasons || []
        });
        setOptions((current) => ({ ...current, zones: zoneResponse.data || [] }));
      })
      .catch((loadError) => active && setError(getErrorMessage(loadError)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open || !selection.zone) return undefined;
    let active = true;
    getRacks(selection.zone)
      .then((response) => active && setOptions((current) => ({ ...current, racks: response.data || [] })))
      .catch((loadError) => active && setError(getErrorMessage(loadError)));
    return () => { active = false; };
  }, [open, selection.zone]);

  useEffect(() => {
    if (!open || !selection.rack) return undefined;
    let active = true;
    getLevels(selection.rack)
      .then((response) => active && setOptions((current) => ({ ...current, levels: response.data || [] })))
      .catch((loadError) => active && setError(getErrorMessage(loadError)));
    return () => { active = false; };
  }, [open, selection.rack]);

  useEffect(() => {
    if (!open || !selection.level) return undefined;
    let active = true;
    getBins(selection.level)
      .then((response) => active && setOptions((current) => ({ ...current, bins: response.data || [] })))
      .catch((loadError) => active && setError(getErrorMessage(loadError)));
    return () => { active = false; };
  }, [open, selection.level]);

  const change = (field, value) => {
    setValidation(null);
    setError("");
    setSelection((current) => {
      if (field === "zone") {
        setOptions((items) => ({ ...items, racks: [], levels: [], bins: [] }));
        return { ...current, zone: value, rack: "", level: "", bin: "" };
      }
      if (field === "rack") {
        setOptions((items) => ({ ...items, levels: [], bins: [] }));
        return { ...current, rack: value, level: "", bin: "" };
      }
      if (field === "level") {
        setOptions((items) => ({ ...items, bins: [] }));
        return { ...current, level: value, bin: "" };
      }
      return { ...current, [field]: value };
    });
  };

  const runValidation = async () => {
    if (!selection.bin || !selection.reason) {
      setError("Select a destination bin and an approved fallback reason.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await validatePlacement(payload);
      setValidation(response.data || null);
    } catch (validationError) {
      setValidation(null);
      setError(getErrorMessage(validationError));
    } finally {
      setSaving(false);
    }
  };

  const confirm = async () => {
    if (!validation?.approved) return;
    setSaving(true);
    setError("");
    try {
      const response = await confirmPlacement(payload);
      await onCompleted?.(response);
      onClose?.();
    } catch (confirmationError) {
      setValidation(null);
      setError(getErrorMessage(confirmationError));
    } finally {
      setSaving(false);
    }
  };

  const checks = Object.entries(validation?.checks || {});

  return (
    <EnterpriseModal
      open={open}
      title={`Manual ${operationType === "relocation" ? "Relocation" : "Placement"}`}
      subtitle="Fallback workflow for approved cases where barcode scanning cannot be used."
      size="large"
      onClose={() => !saving && onClose?.()}
      closeOnBackdrop={!saving}
      closeOnEscape={!saving}
      footer={settings.enabled ? (
        <div className="flex w-full justify-end gap-2">
          <button type="button" disabled={saving} onClick={onClose} className="rounded border border-border px-4 py-2 text-xs font-semibold disabled:opacity-50">Cancel</button>
          {!validation?.approved ? (
            <button type="button" disabled={loading || saving} onClick={runValidation} className="inline-flex items-center gap-2 rounded bg-info px-4 py-2 text-xs font-semibold text-info-foreground disabled:opacity-50">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Validate Placement
            </button>
          ) : (
            <button type="button" disabled={saving} onClick={confirm} className="inline-flex items-center gap-2 rounded bg-success px-4 py-2 text-xs font-semibold text-success-foreground disabled:opacity-50">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Confirm {operationType === "relocation" ? "Relocation" : "Placement"}
            </button>
          )}
        </div>
      ) : null}
    >
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        {loading && <div className="flex items-center gap-2 rounded border p-4 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading manual placement settings and storage hierarchy...</div>}
        {!loading && !settings.enabled && (
          <div className="rounded border border-warning/40 bg-warning/10 p-4 text-xs text-warning">Manual placement is currently disabled by a warehouse supervisor or system administrator.</div>
        )}
        {!loading && settings.enabled && (
          <>
            <div className="rounded border border-info/30 bg-info/10 p-3 text-xs text-info">
              <div className="flex items-center gap-2 font-semibold"><MapPin className="h-4 w-4" />Cargo: {cargo?.cargo_id}</div>
              <div className="mt-1">All normal approval, ownership, compatibility, capacity, and warehouse checks still apply.</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs font-semibold">Zone
                <select aria-label="Manual placement zone" className={inputClass} value={selection.zone} onChange={(event) => change("zone", event.target.value)}>
                  <option value="">Select zone</option>{options.zones.map((item) => <option key={recordId(item)} value={recordId(item)}>{optionLabel(item, "Zone")}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold">Rack
                <select aria-label="Manual placement rack" className={inputClass} disabled={!selection.zone} value={selection.rack} onChange={(event) => change("rack", event.target.value)}>
                  <option value="">Select rack</option>{options.racks.map((item) => <option key={recordId(item)} value={recordId(item)}>{optionLabel(item, "Rack")}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold">Level
                <select aria-label="Manual placement level" className={inputClass} disabled={!selection.rack} value={selection.level} onChange={(event) => change("level", event.target.value)}>
                  <option value="">Select level</option>{options.levels.map((item) => <option key={recordId(item)} value={recordId(item)}>{optionLabel(item, "Level")}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold">Bin
                <select aria-label="Manual placement bin" className={inputClass} disabled={!selection.level} value={selection.bin} onChange={(event) => change("bin", event.target.value)}>
                  <option value="">Select bin</option>{options.bins.map((item) => <option key={recordId(item)} value={recordId(item)}>{optionLabel(item, "Bin")} ({item.status || "Unknown"})</option>)}
                </select>
              </label>
            </div>
            <label className="block text-xs font-semibold">Approved fallback reason
              <select aria-label="Manual placement reason" className={inputClass} value={selection.reason} onChange={(event) => change("reason", event.target.value)}>
                <option value="">Select reason</option>{settings.reasons.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
              </select>
            </label>
            {validation && (
              <div className={`rounded border p-4 ${validation.approved ? "border-success/40 bg-success/10" : "border-destructive/40 bg-destructive/10"}`}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {validation.approved ? <CheckCircle2 className="h-5 w-5 text-success" /> : <XCircle className="h-5 w-5 text-destructive" />}
                  {validation.approved ? "Validation passed — confirmation required" : "Validation failed"}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{validation.detail || validation.reason}</p>
                {checks.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{checks.map(([key, check]) => (
                  <div key={key} className="flex items-start gap-2 rounded border border-border bg-background/70 p-2 text-[11px]">
                    <ShieldCheck className={`mt-0.5 h-3.5 w-3.5 ${check?.passed ? "text-success" : "text-destructive"}`} />
                    <div><div className="font-semibold">{key.replace(/([A-Z])/g, " $1")}</div><div className="text-muted-foreground">{check?.message || (check?.passed ? "Passed" : "Failed")}</div></div>
                  </div>
                ))}</div>}
              </div>
            )}
          </>
        )}
      </div>
    </EnterpriseModal>
  );
}

export { ManualPlacementModal };

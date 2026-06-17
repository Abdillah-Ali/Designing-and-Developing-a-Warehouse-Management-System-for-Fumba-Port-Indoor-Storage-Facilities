import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ScanLine,
  Warehouse
} from "lucide-react";
import { EnterpriseModal } from "./EnterpriseModal";
import { ErrorState } from "./OperationalUi";
import {
  confirmPlacement,
  getBins,
  getLevels,
  getPlacementSettings,
  getRacks,
  getZones,
  validatePlacement
} from "@/services/api";
import {
  formatCount,
  formatMeasure,
  getErrorMessage
} from "@/lib/wms-operational";

const inputClass =
  "h-9 w-full rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

const recordId = (record, fallback) => String(record?.id ?? record?.[fallback] ?? "");
const binLabel = (bin) => bin?.bin_barcode || bin?.barcode || bin?.bin_code || bin?.code || "";

function DetailCard({ label, value }) {
  return (
    <div className="rounded border border-border bg-muted/20 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-xs font-semibold">{value || "Not recorded"}</div>
    </div>
  );
}

function PlacementSessionModal({ cargo, open, onClose, onCompleted }) {
  const [mode, setMode] = useState("scan");
  const [settings, setSettings] = useState({
    manual_placement_enabled: false,
    manual_placement_reasons: []
  });
  const [scannedCargo, setScannedCargo] = useState("");
  const [scannedBin, setScannedBin] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [zones, setZones] = useState([]);
  const [racks, setRacks] = useState([]);
  const [levels, setLevels] = useState([]);
  const [bins, setBins] = useState([]);
  const [selectedZone, setSelectedZone] = useState("");
  const [selectedRack, setSelectedRack] = useState("");
  const [selectedLevel, setSelectedLevel] = useState("");
  const [selectedBin, setSelectedBin] = useState("");
  const [loading, setLoading] = useState(false);
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
  const [error, setError] = useState("");
  const [validation, setValidation] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open || !cargo) return undefined;
    let active = true;
    setMode("scan");
    setScannedCargo("");
    setScannedBin("");
    setManualReason("");
    setSelectedZone("");
    setSelectedRack("");
    setSelectedLevel("");
    setSelectedBin("");
    setRacks([]);
    setLevels([]);
    setBins([]);
    setValidation(null);
    setResult(null);
    setError("");

    Promise.all([getPlacementSettings(), getZones()])
      .then(([settingsResponse, zonesResponse]) => {
        if (!active) return;
        const nextSettings = settingsResponse.data || {};
        setSettings(nextSettings);
        setZones(zonesResponse.data || []);
        setManualReason(nextSettings.manual_placement_reasons?.[0]?.value || "");
      })
      .catch((loadError) => {
        if (active) setError(getErrorMessage(loadError));
      });

    return () => {
      active = false;
    };
  }, [cargo, open]);

  const selectedBinRecord = useMemo(
    () => bins.find((bin) => recordId(bin, "bin_id") === selectedBin) || null,
    [bins, selectedBin]
  );

  const resetValidation = () => {
    setValidation(null);
    setResult(null);
    setError("");
  };

  const selectMode = (nextMode) => {
    setMode(nextMode);
    resetValidation();
  };

  const selectZone = async (value) => {
    setSelectedZone(value);
    setSelectedRack("");
    setSelectedLevel("");
    setSelectedBin("");
    setRacks([]);
    setLevels([]);
    setBins([]);
    resetValidation();
    if (!value) return;
    setHierarchyLoading(true);
    try {
      const response = await getRacks(value);
      setRacks(response.data || []);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setHierarchyLoading(false);
    }
  };

  const selectRack = async (value) => {
    setSelectedRack(value);
    setSelectedLevel("");
    setSelectedBin("");
    setLevels([]);
    setBins([]);
    resetValidation();
    if (!value) return;
    setHierarchyLoading(true);
    try {
      const response = await getLevels(value);
      setLevels(response.data || []);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setHierarchyLoading(false);
    }
  };

  const selectLevel = async (value) => {
    setSelectedLevel(value);
    setSelectedBin("");
    setBins([]);
    resetValidation();
    if (!value) return;
    setHierarchyLoading(true);
    try {
      const response = await getBins(value);
      setBins(response.data || []);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setHierarchyLoading(false);
    }
  };

  const buildPayload = () => mode === "scan"
    ? {
        cargo_id: cargo.cargo_id,
        placement_mode: "scan",
        scanned_cargo_barcode: scannedCargo.trim(),
        scanned_bin_barcode: scannedBin.trim()
      }
    : {
        cargo_id: cargo.cargo_id,
        placement_mode: "manual",
        bin_id: selectedBin,
        manual_placement_reason: manualReason
      };

  const canValidate = mode === "scan"
    ? Boolean(scannedCargo.trim() && scannedBin.trim())
    : Boolean(selectedBin && manualReason);

  const runValidation = async () => {
    if (!canValidate) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await validatePlacement(buildPayload());
      setValidation(response.data || null);
    } catch (validationError) {
      setValidation(null);
      setError(getErrorMessage(validationError));
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!validation?.approved) return;
    setLoading(true);
    setError("");
    try {
      const response = await confirmPlacement(buildPayload());
      setResult(response.data || {});
      setValidation(response.data?.validation || validation);
      await onCompleted?.(response.data);
    } catch (confirmationError) {
      setError(getErrorMessage(confirmationError));
    } finally {
      setLoading(false);
    }
  };

  const activeBin = validation?.bin || selectedBinRecord;
  const isRelocation = Boolean(cargo?.current_bin_id);

  return (
    <EnterpriseModal
      open={open}
      title={`${isRelocation ? "Relocate" : "Place"} Cargo: ${cargo?.cargo_id || ""}`}
      subtitle="Scan cargo and bin labels, or use the controlled manual fallback when enabled."
      size="large"
      onClose={onClose}
      footer={(
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border bg-background px-4 py-2 text-xs font-semibold hover:bg-muted"
          >
            {result ? "Done" : "Cancel"}
          </button>
          {!result && (
            <>
              <button
                type="button"
                onClick={runValidation}
                disabled={!canValidate || loading}
                className="rounded border border-info/40 bg-info/10 px-4 py-2 text-xs font-semibold text-info disabled:opacity-50"
              >
                {loading && !validation ? "Validating..." : "Validate Placement"}
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={!validation?.approved || loading}
                className="rounded bg-success px-4 py-2 text-xs font-semibold text-success-foreground disabled:opacity-50"
              >
                {loading && validation ? "Confirming..." : isRelocation ? "Confirm Relocation" : "Confirm Placement"}
              </button>
            </>
          )}
        </>
      )}
    >
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        {result && (
          <div className="flex items-center gap-2 rounded border border-success/40 bg-success/10 px-3 py-3 text-xs font-semibold text-success">
            <CheckCircle2 className="h-4 w-4" />
            {result.relocated ? "Cargo relocated successfully." : "Cargo placed successfully."}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DetailCard label="Cargo ID" value={cargo?.cargo_id} />
          <DetailCard label="Cargo Type" value={cargo?.cargo_type} />
          <DetailCard label="Quantity" value={formatCount(cargo?.quantity)} />
          <DetailCard label="Weight / Volume" value={`${formatMeasure(cargo?.weight, "kg")} / ${formatMeasure(cargo?.volume, "m3")}`} />
          <DetailCard label="Hazard Class" value={cargo?.hazard_class || "Not applicable"} />
          <DetailCard label="Registration" value={cargo?.registration_status} />
          <DetailCard label="Placement" value={cargo?.placement_status} />
          <DetailCard label="Current Location" value={cargo?.location || "Not placed"} />
        </div>

        {!result && (
          <>
            <div className="flex flex-wrap gap-2 rounded border border-border bg-muted/20 p-2">
              <button
                type="button"
                onClick={() => selectMode("scan")}
                className={`inline-flex items-center gap-2 rounded px-3 py-2 text-xs font-semibold ${
                  mode === "scan" ? "bg-info text-info-foreground" : "bg-background text-muted-foreground"
                }`}
              >
                <ScanLine className="h-4 w-4" />
                Scan Placement
              </button>
              {settings.manual_placement_enabled && (
                <button
                  type="button"
                  onClick={() => selectMode("manual")}
                  className={`inline-flex items-center gap-2 rounded px-3 py-2 text-xs font-semibold ${
                    mode === "manual" ? "bg-info text-info-foreground" : "bg-background text-muted-foreground"
                  }`}
                >
                  <Warehouse className="h-4 w-4" />
                  Manual Placement
                </button>
              )}
            </div>

            {mode === "scan" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-[11px] font-semibold">1. Scan Cargo Barcode</span>
                  <input
                    autoFocus
                    className={inputClass}
                    value={scannedCargo}
                    onChange={(event) => {
                      setScannedCargo(event.target.value.toUpperCase());
                      resetValidation();
                    }}
                    placeholder={cargo?.barcode || cargo?.cargo_id}
                  />
                  <span className="block text-[10px] text-muted-foreground">Expected: {cargo?.barcode || cargo?.cargo_id}</span>
                </label>
                <label className="space-y-1.5">
                  <span className="text-[11px] font-semibold">2. Scan Bin Barcode</span>
                  <input
                    className={inputClass}
                    value={scannedBin}
                    onChange={(event) => {
                      setScannedBin(event.target.value.toUpperCase());
                      resetValidation();
                    }}
                    placeholder="BIN-D01-L1-02"
                  />
                  <span className="block text-[10px] text-muted-foreground">The server will load and validate the complete storage hierarchy.</span>
                </label>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-semibold">Manual placement reason</span>
                  <select
                    className={inputClass}
                    value={manualReason}
                    onChange={(event) => {
                      setManualReason(event.target.value);
                      resetValidation();
                    }}
                  >
                    {(settings.manual_placement_reasons || []).map((reason) => (
                      <option key={reason.value} value={reason.value}>{reason.label}</option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-semibold">Zone</span>
                    <select className={inputClass} value={selectedZone} onChange={(event) => selectZone(event.target.value)}>
                      <option value="">Select zone</option>
                      {zones.map((zone) => (
                        <option key={recordId(zone, "zone_id")} value={recordId(zone, "zone_id")}>
                          {zone.zone_code || zone.code} - {zone.zone_name || zone.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-semibold">Rack</span>
                    <select className={inputClass} value={selectedRack} onChange={(event) => selectRack(event.target.value)} disabled={!selectedZone || hierarchyLoading}>
                      <option value="">Select rack</option>
                      {racks.map((rack) => (
                        <option key={recordId(rack, "rack_id")} value={recordId(rack, "rack_id")}>{rack.rack_code || rack.code}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-semibold">Level</span>
                    <select className={inputClass} value={selectedLevel} onChange={(event) => selectLevel(event.target.value)} disabled={!selectedRack || hierarchyLoading}>
                      <option value="">Select level</option>
                      {levels.map((level) => (
                        <option key={recordId(level, "level_id")} value={recordId(level, "level_id")}>{level.level_code || level.code}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-semibold">Bin</span>
                    <select
                      className={inputClass}
                      value={selectedBin}
                      onChange={(event) => {
                        setSelectedBin(event.target.value);
                        resetValidation();
                      }}
                      disabled={!selectedLevel || hierarchyLoading}
                    >
                      <option value="">{hierarchyLoading ? "Loading..." : "Select bin"}</option>
                      {bins.map((bin) => (
                        <option key={recordId(bin, "bin_id")} value={recordId(bin, "bin_id")}>
                          {binLabel(bin)} - {bin.status}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            )}
          </>
        )}

        {(validation || result) && (
          <div className="space-y-3">
            <div className={`rounded border px-3 py-3 text-xs ${
              validation?.approved
                ? "border-success/40 bg-success/10 text-success"
                : "border-destructive/40 bg-destructive/10 text-destructive"
            }`}>
              <div className="flex items-center gap-2 font-semibold">
                {validation?.approved ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                {validation?.reason}
              </div>
              <div className="mt-1">{validation?.detail}</div>
            </div>

            {activeBin && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <DetailCard label="Zone" value={`${activeBin.zone_code || ""} ${activeBin.zone_name || ""}`.trim()} />
                <DetailCard label="Rack / Level" value={`${activeBin.rack_code || ""} / ${activeBin.level_code || ""}`} />
                <DetailCard label="Bin" value={binLabel(activeBin)} />
                <DetailCard label="Bin Status" value={activeBin.status} />
                <DetailCard label="Allowed Cargo" value={activeBin.allowed_cargo_type || "Zone rules"} />
                <DetailCard label="Remaining Weight" value={formatMeasure(activeBin.remaining_weight, "kg")} />
                <DetailCard label="Remaining Volume" value={formatMeasure(activeBin.remaining_volume, "m3")} />
                <DetailCard label="Location" value={activeBin.display_location} />
              </div>
            )}

            <div className="grid gap-2 md:grid-cols-2">
              {Object.entries(validation?.checks || {}).map(([key, check]) => (
                <div key={key} className="flex items-start gap-2 rounded border border-border bg-card px-3 py-2 text-[11px]">
                  {check.passed
                    ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                    : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />}
                  <span>{check.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Processing placement...
          </div>
        )}
      </div>
    </EnterpriseModal>
  );
}

export { PlacementSessionModal };

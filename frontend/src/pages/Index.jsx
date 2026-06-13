import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
import {
  Boxes,
  ClipboardCheck,
  ClipboardList,
  DoorOpen,
  PackageCheck,
  PackagePlus,
  Rows3,
  ScanLine,
  SquareStack,
  Truck,
  UserCircle2,
  Warehouse
} from "lucide-react";
import { AppLayout } from "@/components/wms/AppLayout";
import { BarcodeLabel, printBarcodeLabel } from "@/components/wms/BarcodeLabel";
import { CargoCorrectionModal } from "@/components/wms/CargoCorrectionModal";
import { DetailForm } from "@/components/wms/DetailForm";
import {
  DataTable,
  ErrorState,
  OperationalStatCard,
  PageHeader,
  SectionCard,
  StatusBadge
} from "@/components/wms/OperationalUi";
import {
  formatCount,
  formatDateTime,
  formatMeasure,
  getErrorMessage,
  statusTone
} from "@/lib/wms-operational";
import {
  getBins,
  getCargo,
  getLevels,
  getMyCargoSubmissions,
  getRacks,
  getZones,
  printCargoBarcode,
  requestDispatchAuthorization
} from "@/services/api";

const inputClass =
  "h-9 w-full rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

function readValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function getRecordId(record, fallbackKey) {
  return String(record?.id ?? record?.[fallbackKey] ?? "");
}

function getZoneLabel(record) {
  const code = readValue(record, ["zone_code", "code"]);
  const name = readValue(record, ["zone_name", "name"]);
  if (code && name) return `${code} - ${name}`;
  return code || name || "No zone data";
}

function getRackCode(record) {
  return readValue(record, ["rack_code", "code"]);
}

function getLevelCode(record) {
  return readValue(record, ["level_code", "code"]);
}

function getBinCode(record) {
  return readValue(record, ["bin_barcode", "barcode", "bin_code", "code"]);
}

function readNumber(record, keys) {
  const value = readValue(record, keys);
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatOccupancy(record) {
  const direct = readNumber(record, ["volume_occupancy_percent", "occupancy_percent"]);
  if (direct !== null) return `${direct.toLocaleString()}%`;

  const currentVolume = readNumber(record, ["current_volume_capacity", "current_volume"]);
  const maxVolume = readNumber(record, ["max_volume_capacity", "max_volume"]);

  if (currentVolume !== null && maxVolume && maxVolume > 0) {
    return `${((currentVolume / maxVolume) * 100).toFixed(1)}%`;
  }

  return "No occupancy data";
}

function formatCapacity(record) {
  const currentWeight = readValue(record, ["current_weight_capacity", "current_weight"]);
  const maxWeight = readValue(record, ["max_weight_capacity", "max_weight"]);
  const currentVolume = readValue(record, ["current_volume_capacity", "current_volume"]);
  const maxVolume = readValue(record, ["max_volume_capacity", "max_volume"]);

  if (!currentWeight && !maxWeight && !currentVolume && !maxVolume) return "No capacity data";

  return (
    <div className="space-y-0.5">
      <div>{formatMeasure(currentWeight, "kg")} / {formatMeasure(maxWeight, "kg")}</div>
      <div className="text-muted-foreground">{formatMeasure(currentVolume, "m³")} / {formatMeasure(maxVolume, "m³")}</div>
    </div>
  );
}

function useCargo(status) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const response = await getCargo(status ? { status } : {});
        if (active) setRecords(response.data || []);
      } catch (err) {
        if (active) setError(getErrorMessage(err));
      } finally {
        if (active) setLoading(false);
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [status, refreshKey]);

  return { records, loading, error, refresh: () => setRefreshKey((current) => current + 1) };
}

function DashboardPage() {
  const [cargo, setCargo] = useState([]);
  const [zones, setZones] = useState([]);
  const [cargoLoading, setCargoLoading] = useState(true);
  const [zonesLoading, setZonesLoading] = useState(true);
  const [cargoError, setCargoError] = useState("");
  const [zonesError, setZonesError] = useState("");

  useEffect(() => {
    let active = true;

    const loadCargo = async () => {
      setCargoLoading(true);
      setCargoError("");
      try {
        const response = await getCargo();
        if (active) setCargo(response.data || []);
      } catch (err) {
        if (active) setCargoError(getErrorMessage(err));
      } finally {
        if (active) setCargoLoading(false);
      }
    };

    const loadZones = async () => {
      setZonesLoading(true);
      setZonesError("");
      try {
        const response = await getZones();
        if (active) setZones(response.data || []);
      } catch (err) {
        if (active) setZonesError(getErrorMessage(err));
      } finally {
        if (active) setZonesLoading(false);
      }
    };

    loadCargo();
    loadZones();

    return () => {
      active = false;
    };
  }, []);

  const pendingPlacement = useMemo(
    () => cargo.filter((record) =>
      record.placement_status === "Unplaced"
      && record.registration_status !== "Rejected"
    ),
    [cargo]
  );
  const storedCargo = useMemo(
    () => cargo.filter((record) => ["Placed", "Relocated"].includes(record.placement_status)),
    [cargo]
  );
  const dispatchPending = useMemo(
    () => cargo.filter((record) => record.dispatch_authorization_status === "Pending"),
    [cargo]
  );
  const recentlyStored = useMemo(
    () => cargo.filter((record) => ["Placed", "Relocated"].includes(record.placement_status)).slice(0, 5),
    [cargo]
  );

  return (
    <>
      <PageHeader
        eyebrow="Warehouse Staff"
        title="Operational Dashboard"
        description="Live warehouse work queues and storage readiness for receiving, placement, scanning, tracking, and dispatch preparation."
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <OperationalStatCard
            title="Pending Placement"
            icon={PackagePlus}
            loading={cargoLoading}
            error={cargoError}
            value={pendingPlacement.length}
            emptyTitle="No cargo awaiting placement"
            tone="warning"
          />
          <OperationalStatCard
            title="Awaiting Scan"
            icon={ScanLine}
            loading={cargoLoading}
            error={cargoError}
            value={pendingPlacement.length}
            emptyTitle="No cargo awaiting scan"
            emptyBody="Scanner queue data will appear as placement work is recorded."
            tone="info"
          />
          <OperationalStatCard
            title="Stored Cargo"
            icon={PackageCheck}
            loading={cargoLoading}
            error={cargoError}
            value={storedCargo.length}
            emptyTitle="No stored cargo"
            tone="success"
          />
          <OperationalStatCard
            title="Dispatch Pending"
            icon={ClipboardCheck}
            loading={cargoLoading}
            error={cargoError}
            value={dispatchPending.length}
            emptyTitle="No dispatch approvals pending"
            tone="warning"
          />
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-[1.1fr_1fr]">
          <SectionCard title="Recently Stored Cargo" icon={PackageCheck}>
            <DataTable
              loading={cargoLoading}
              error={cargoError}
              rows={recentlyStored}
              emptyTitle="No recently stored cargo"
              columns={[
                { key: "cargo_id", label: "Cargo ID", className: "font-mono font-semibold" },
                { key: "barcode", label: "Barcode", className: "font-mono text-muted-foreground" },
                { key: "location", label: "Location", render: (row) => row.location || "Not recorded" },
                { key: "status", label: "Placement", render: (row) => <StatusBadge tone={statusTone(row.placement_status)}>{row.placement_status}</StatusBadge> }
              ]}
            />
          </SectionCard>

          <SectionCard title="Warehouse Occupancy Summary" icon={Warehouse}>
            <DataTable
              loading={zonesLoading}
              error={zonesError}
              rows={zones}
              emptyTitle="No occupancy data available"
              columns={[
                { key: "code", label: "Zone", render: (row) => getZoneLabel(row) },
                { key: "occupancy", label: "Occupancy", render: (row) => formatOccupancy(row) },
                { key: "available_bins", label: "Available Bins", render: (row) => formatCount(row.available_bins) },
                { key: "blocked_bins", label: "Blocked Bins", render: (row) => formatCount(row.blocked_bins) }
              ]}
            />
          </SectionCard>
        </div>
      </div>
    </>
  );
}

const placementQueueFilters = [
  "Unplaced",
  "Placed",
  "Pending Review",
  "Approved",
  "Correction Required",
  "Rejected",
  "Relocation Required"
];

function PlacementQueuePage() {
  const navigate = useNavigate();
  const barcodeRef = useRef(null);
  const [records, setRecords] = useState([]);
  const [filter, setFilter] = useState("Unplaced");
  const [selected, setSelected] = useState(null);
  const [printCargo, setPrintCargo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await getCargo({ limit: 500 });
      setRecords(response.data || []);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!printCargo || !barcodeRef.current) return;

    const print = async () => {
      try {
        await printCargoBarcode(printCargo.id);
        if (!printBarcodeLabel(barcodeRef.current)) {
          setError("The browser blocked the print preview window.");
        }
      } catch (printError) {
        setError(getErrorMessage(printError));
      } finally {
        setPrintCargo(null);
      }
    };

    print();
  }, [printCargo]);

  const visibleRecords = useMemo(() => records.filter((record) => {
    if (filter === "Unplaced") {
      return record.placement_status === "Unplaced"
        && record.registration_status !== "Rejected";
    }
    if (filter === "Placed") {
      return ["Placed", "Relocated"].includes(record.placement_status);
    }
    if (filter === "Relocation Required") {
      return record.relocation_required;
    }
    return record.registration_status === filter;
  }), [filter, records]);

  const startPlacement = (cargo) => {
    navigate(`/staff/cargo/placement-scanning?cargo=${encodeURIComponent(cargo.barcode)}`);
  };

  return (
    <>
      <PageHeader
        eyebrow="Cargo Operations"
        title="Placement Queue"
        description="Select registered cargo when warehouse staff are ready to begin the scan-based placement session."
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-3">
          {error && <ErrorState message={error} />}
          <SectionCard title="Queue Filters" icon={ClipboardList}>
            <div className="flex flex-wrap gap-2">
              {placementQueueFilters.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setFilter(item)}
                  className={`rounded border px-3 py-2 text-xs font-semibold ${
                    filter === item
                      ? "border-info bg-info/10 text-info"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title={`${filter} Cargo`} icon={PackagePlus}>
            <DataTable
              loading={loading}
              rows={visibleRecords}
              emptyTitle={`No ${filter.toLowerCase()} cargo in the placement queue`}
              columns={[
                { key: "cargo_id", label: "Cargo ID", className: "font-mono font-semibold" },
                { key: "barcode", label: "Barcode", className: "font-mono" },
                { key: "cargo_type", label: "Cargo Type" },
                { key: "quantity", label: "Quantity", render: (row) => formatCount(row.quantity) },
                { key: "weight", label: "Weight", render: (row) => formatMeasure(row.weight, "kg") },
                { key: "created_at", label: "Registered", render: (row) => formatDateTime(row.created_at) },
                {
                  key: "registration_status",
                  label: "Registration",
                  render: (row) => <StatusBadge tone={statusTone(row.registration_status)}>{row.registration_status}</StatusBadge>
                },
                {
                  key: "placement_status",
                  label: "Placement",
                  render: (row) => <StatusBadge tone={statusTone(row.placement_status)}>{row.placement_status}</StatusBadge>
                },
                {
                  key: "location",
                  label: "Current Location",
                  render: (row) => row.location || "Not placed"
                },
                {
                  key: "actions",
                  label: "Actions",
                  render: (row) => {
                    const canStart = row.registration_status !== "Rejected"
                      && row.placement_status !== "Dispatched"
                      && (row.placement_status === "Unplaced" || row.relocation_required);
                    return (
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={!canStart}
                          onClick={() => startPlacement(row)}
                          className="rounded bg-success px-2 py-1 text-[11px] font-semibold text-success-foreground disabled:opacity-40"
                        >
                          {row.relocation_required ? "Start Relocation" : "Start Placement"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelected(row)}
                          className="rounded border border-info/30 bg-info/10 px-2 py-1 text-[11px] font-semibold text-info"
                        >
                          View Details
                        </button>
                        <button
                          type="button"
                          onClick={() => setPrintCargo(row)}
                          className="rounded border border-border px-2 py-1 text-[11px] font-semibold"
                        >
                          Print Barcode
                        </button>
                        {row.registration_status === "Correction Required" && (
                          <button
                            type="button"
                            onClick={() => setSelected(row)}
                            className="rounded bg-warning px-2 py-1 text-[11px] font-semibold text-warning-foreground"
                          >
                            View Correction
                          </button>
                        )}
                      </div>
                    );
                  }
                }
              ]}
            />
          </SectionCard>

          {selected && (
            <SectionCard title={`Cargo Details: ${selected.cargo_id}`} icon={PackageCheck}>
              <div className="grid gap-3 text-xs md:grid-cols-2 xl:grid-cols-4">
                <div><span className="text-muted-foreground">Consignee:</span> <strong>{selected.consignee_name}</strong></div>
                <div><span className="text-muted-foreground">Volume:</span> <strong>{formatMeasure(selected.volume, "m3")}</strong></div>
                <div><span className="text-muted-foreground">Hazard Class:</span> <strong>{selected.hazard_class || "Not applicable"}</strong></div>
                <div><span className="text-muted-foreground">Current Bin:</span> <strong>{selected.bin_barcode || "Not placed"}</strong></div>
                <div className="md:col-span-2 xl:col-span-4">
                  <span className="text-muted-foreground">Supervisor Message:</span>{" "}
                  <strong>{selected.correction_notes || selected.rejection_reason || "No correction message"}</strong>
                </div>
                {selected.relocation_required && (
                  <div className="md:col-span-2 xl:col-span-4 text-warning">
                    <strong>Relocation required:</strong> {selected.relocation_reason}
                  </div>
                )}
              </div>
            </SectionCard>
          )}
        </div>
        {printCargo && (
          <div className="fixed -left-[10000px] top-0">
            <BarcodeLabel ref={barcodeRef} cargo={printCargo} />
          </div>
        )}
      </div>
    </>
  );
}

function RegistrationReviewsPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await getMyCargoSubmissions();
      setRecords(response.data || []);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const selected = records.find((record) => String(record.id) === selectedId) || null;

  return (
    <>
      <PageHeader
        eyebrow="Cargo Registration"
        title="My Registration Reviews"
        description="Review pending, rejected, and correction-required cargo registrations submitted by your account."
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-3">
          {error && <ErrorState message={error} />}
          <SectionCard title="Registration Review Status" icon={ClipboardCheck}>
            <DataTable
              loading={loading}
              rows={records}
              emptyTitle="No registrations are awaiting review or correction"
              columns={[
                { key: "cargo_id", label: "Cargo ID", className: "font-mono font-semibold" },
                { key: "consignee_name", label: "Consignee" },
                { key: "cargo_type", label: "Cargo Type" },
                {
                  key: "registration_status",
                  label: "Review Status",
                  render: (row) => <StatusBadge tone={statusTone(row.registration_status)}>{row.registration_status}</StatusBadge>
                },
                {
                  key: "review_notes",
                  label: "Supervisor Notes",
                  render: (row) => row.correction_notes || row.corrective_notes || row.rejection_reason || "Awaiting review"
                },
                {
                  key: "action",
                  label: "Action",
                  render: (row) => ["Correction Required", "Rejected"].includes(row.registration_status) ? (
                    <button
                      type="button"
                      onClick={() => setSelectedId(String(row.id))}
                      className="rounded bg-info px-2 py-1 text-[11px] font-semibold text-info-foreground"
                    >
                      {row.registration_status === "Rejected" ? "Revise Registration" : "Correct Details"}
                    </button>
                  ) : <span className="text-[11px] text-muted-foreground">Read only</span>
                }
              ]}
            />
          </SectionCard>
        </div>
      </div>
      <CargoCorrectionModal
        open={Boolean(selected)}
        cargo={selected}
        onClose={() => setSelectedId("")}
        onCompleted={load}
      />
    </>
  );
}

function CargoWorkflowPage({ tab, title, description }) {
  const [searchParams] = useSearchParams();
  return (
    <>
      <PageHeader eyebrow="Cargo Operations" title={title} description={description} />
      <div className="flex-1 min-h-0 overflow-hidden p-3">
        <DetailForm
          initialTab={tab}
          initialCargoBarcode={searchParams.get("cargo") || ""}
        />
      </div>
    </>
  );
}

function HierarchySelector({
  zones,
  racks,
  levels,
  selectedZone,
  selectedRack,
  selectedLevel,
  setSelectedZone,
  setSelectedRack,
  setSelectedLevel,
  needRack,
  needLevel,
  loading
}) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <label className="space-y-1.5">
        <span className="block text-[11px] font-semibold text-foreground/80">Zone</span>
        <select className={inputClass} value={selectedZone} onChange={(event) => setSelectedZone(event.target.value)}>
          <option value="">{loading.zones ? "Loading zones..." : "Select zone"}</option>
          {zones.map((zone) => (
            <option key={getRecordId(zone, "zone_id")} value={getRecordId(zone, "zone_id")}>
              {getZoneLabel(zone)}
            </option>
          ))}
        </select>
      </label>

      {needRack && (
        <label className="space-y-1.5">
          <span className="block text-[11px] font-semibold text-foreground/80">Rack</span>
          <select className={inputClass} value={selectedRack} onChange={(event) => setSelectedRack(event.target.value)} disabled={!selectedZone}>
            <option value="">{loading.racks ? "Loading racks..." : "Select rack"}</option>
            {racks.map((rack) => (
              <option key={getRecordId(rack, "rack_id")} value={getRecordId(rack, "rack_id")}>
                {getRackCode(rack) || "Unnamed rack"}
              </option>
            ))}
          </select>
        </label>
      )}

      {needLevel && (
        <label className="space-y-1.5">
          <span className="block text-[11px] font-semibold text-foreground/80">Level</span>
          <select className={inputClass} value={selectedLevel} onChange={(event) => setSelectedLevel(event.target.value)} disabled={!selectedRack}>
            <option value="">{loading.levels ? "Loading levels..." : "Select level"}</option>
            {levels.map((level) => (
              <option key={getRecordId(level, "level_id")} value={getRecordId(level, "level_id")}>
                {getLevelCode(level) || "Unnamed level"}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function WarehouseStoragePage({ scope }) {
  const [zones, setZones] = useState([]);
  const [racks, setRacks] = useState([]);
  const [levels, setLevels] = useState([]);
  const [bins, setBins] = useState([]);
  const [selectedZone, setSelectedZone] = useState("");
  const [selectedRack, setSelectedRack] = useState("");
  const [selectedLevel, setSelectedLevel] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState({
    zones: true,
    racks: false,
    levels: false,
    bins: false
  });

  useEffect(() => {
    let active = true;

    const loadZones = async () => {
      setLoading((current) => ({ ...current, zones: true }));
      setError("");
      try {
        const response = await getZones();
        if (active) setZones(response.data || []);
      } catch (err) {
        if (active) setError(getErrorMessage(err));
      } finally {
        if (active) setLoading((current) => ({ ...current, zones: false }));
      }
    };

    loadZones();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setRacks([]);
    setLevels([]);
    setBins([]);
    setSelectedRack("");
    setSelectedLevel("");

    if (!selectedZone) return undefined;

    let active = true;
    const loadRacks = async () => {
      setLoading((current) => ({ ...current, racks: true }));
      setError("");
      try {
        const response = await getRacks(selectedZone);
        if (active) setRacks(response.data || []);
      } catch (err) {
        if (active) setError(getErrorMessage(err));
      } finally {
        if (active) setLoading((current) => ({ ...current, racks: false }));
      }
    };

    loadRacks();

    return () => {
      active = false;
    };
  }, [selectedZone]);

  useEffect(() => {
    setLevels([]);
    setBins([]);
    setSelectedLevel("");

    if (!selectedRack) return undefined;

    let active = true;
    const loadLevels = async () => {
      setLoading((current) => ({ ...current, levels: true }));
      setError("");
      try {
        const response = await getLevels(selectedRack);
        if (active) setLevels(response.data || []);
      } catch (err) {
        if (active) setError(getErrorMessage(err));
      } finally {
        if (active) setLoading((current) => ({ ...current, levels: false }));
      }
    };

    loadLevels();

    return () => {
      active = false;
    };
  }, [selectedRack]);

  useEffect(() => {
    setBins([]);

    if (!selectedLevel) return undefined;

    let active = true;
    const loadBins = async () => {
      setLoading((current) => ({ ...current, bins: true }));
      setError("");
      try {
        const response = await getBins(selectedLevel);
        if (active) setBins(response.data || []);
      } catch (err) {
        if (active) setError(getErrorMessage(err));
      } finally {
        if (active) setLoading((current) => ({ ...current, bins: false }));
      }
    };

    loadBins();

    return () => {
      active = false;
    };
  }, [selectedLevel]);

  const config = {
    zones: {
      title: "Zones",
      icon: Boxes,
      rows: zones,
      loading: loading.zones,
      emptyTitle: "No storage data available",
      description: "Readonly zone-level warehouse hierarchy and occupancy information."
    },
    racks: {
      title: "Racks",
      icon: Rows3,
      rows: selectedZone ? racks : [],
      loading: loading.racks,
      emptyTitle: selectedZone ? "No storage data available" : "Select a zone to load racks",
      description: "Readonly rack-level storage structure for the selected warehouse zone."
    },
    levels: {
      title: "Levels",
      icon: SquareStack,
      rows: selectedRack ? levels : [],
      loading: loading.levels,
      emptyTitle: selectedRack ? "No storage data available" : "Select a zone and rack to load levels",
      description: "Readonly level-level storage structure for the selected rack."
    },
    bins: {
      title: "Bins",
      icon: PackageCheck,
      rows: selectedLevel ? bins : [],
      loading: loading.bins,
      emptyTitle: selectedLevel ? "No storage data available" : "Select a zone, rack, and level to load bins",
      description: "Readonly bin-level barcode, status, and capacity information."
    },
    occupancy: {
      title: "Occupancy Status",
      icon: ClipboardCheck,
      rows: zones,
      loading: loading.zones,
      emptyTitle: "No occupancy data available",
      description: "Operational occupancy summary from the live storage hierarchy."
    }
  }[scope];

  const storageColumns = [
    {
      key: "code",
      label: scope === "zones" || scope === "occupancy" ? "Zone" : scope === "racks" ? "Rack" : "Level",
      render: (row) => {
        if (scope === "zones" || scope === "occupancy") return getZoneLabel(row);
        if (scope === "racks") return getRackCode(row) || "No rack data";
        return getLevelCode(row) || "No level data";
      },
      className: "font-mono font-semibold"
    },
    { key: "occupancy", label: "Occupancy", render: (row) => formatOccupancy(row) },
    { key: "capacity", label: "Capacity", render: (row) => formatCapacity(row) },
    { key: "available_bins", label: "Available Bins", render: (row) => formatCount(row.available_bins) },
    { key: "blocked_bins", label: "Blocked Bins", render: (row) => formatCount(row.blocked_bins) },
    { key: "reserved_bins", label: "Reserved Bins", render: (row) => formatCount(row.reserved_bins) }
  ];

  const binColumns = [
    { key: "barcode", label: "Bin Barcode", render: (row) => getBinCode(row), className: "font-mono font-semibold" },
    { key: "status", label: "Status", render: (row) => <StatusBadge tone={statusTone(row.status)}>{row.status || "No data"}</StatusBadge> },
    { key: "location", label: "Location", render: (row) => `${row.zone_code || "No zone"} / ${row.rack_code || "No rack"} / ${row.level_code || "No level"}` },
    { key: "occupancy", label: "Occupancy", render: (row) => formatOccupancy(row) },
    { key: "capacity", label: "Capacity", render: (row) => formatCapacity(row) },
    { key: "reserved_for_cargo_type", label: "Reserved For", render: (row) => row.reserved_for_cargo_type || "Not reserved" }
  ];

  return (
    <>
      <PageHeader eyebrow="Warehouse Storage" title={config.title} description={config.description} />
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-3">
          {scope !== "zones" && scope !== "occupancy" && (
            <SectionCard title="Storage Hierarchy Filter" icon={Warehouse}>
              <HierarchySelector
                zones={zones}
                racks={racks}
                levels={levels}
                selectedZone={selectedZone}
                selectedRack={selectedRack}
                selectedLevel={selectedLevel}
                setSelectedZone={setSelectedZone}
                setSelectedRack={setSelectedRack}
                setSelectedLevel={setSelectedLevel}
                needRack={scope === "levels" || scope === "bins"}
                needLevel={scope === "bins"}
                loading={loading}
              />
            </SectionCard>
          )}

          <SectionCard title={config.title} icon={config.icon}>
            <DataTable
              loading={config.loading}
              error={error}
              rows={config.rows}
              emptyTitle={config.emptyTitle}
              columns={scope === "bins" ? binColumns : storageColumns}
            />
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function DispatchOperationPage({ mode }) {
  const config = {
    queue: {
      title: "Dispatch Queue",
      icon: Truck,
      status: undefined,
      emptyTitle: "No cargo queued for dispatch",
      description: "Cargo prepared for outbound handling will appear here after dispatch readiness is recorded."
    },
    gate: {
      title: "Gate Release",
      icon: DoorOpen,
      status: undefined,
      emptyTitle: "No cargo ready for gate release",
      description: "Readonly gate release preparation queue for warehouse staff."
    },
    released: {
      title: "Released Cargo",
      icon: PackageCheck,
      status: "Dispatched",
      emptyTitle: "No released cargo",
      description: "Cargo released from the warehouse."
    }
  }[mode];

  const { records, loading, error, refresh } = useCargo(config.status);
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState("");
  const visibleRecords = mode === "queue"
    ? records.filter((record) =>
      ["Placed", "Relocated"].includes(record.placement_status)
      && record.registration_status === "Approved"
    )
    : mode === "gate"
      ? records.filter((record) => record.dispatch_authorization_status === "Approved")
      : records;

  const requestDispatch = async (cargo) => {
    setBusyId(String(cargo.id));
    setActionError("");
    try {
      await requestDispatchAuthorization({
        cargo_id: cargo.id,
        reason: "Cargo prepared by Warehouse Staff for supervisor dispatch authorization."
      });
      refresh();
    } catch (requestError) {
      setActionError(getErrorMessage(requestError));
    } finally {
      setBusyId("");
    }
  };

  return (
    <>
      <PageHeader eyebrow="Dispatch Operations" title={config.title} description={config.description} />
      <div className="flex-1 overflow-auto p-4">
        {actionError && <ErrorState message={actionError} />}
        <SectionCard title={config.title} icon={config.icon}>
          <DataTable
            loading={loading}
            error={error}
            rows={visibleRecords}
            emptyTitle={config.emptyTitle}
            columns={[
              { key: "cargo_id", label: "Cargo ID", className: "font-mono font-semibold" },
              { key: "barcode", label: "Barcode", className: "font-mono text-muted-foreground" },
              { key: "consignee_name", label: "Consignee", render: (row) => row.consignee_name || "Not recorded" },
              { key: "location", label: "Storage Location", render: (row) => row.location || "Not assigned" },
              { key: "clearance_status", label: "Clearance Status", render: (row) => row.clearance_status || "Not recorded" },
              { key: "status", label: "Placement", render: (row) => <StatusBadge tone={statusTone(row.placement_status)}>{row.placement_status}</StatusBadge> },
              ...(mode === "queue" ? [{
                key: "action",
                label: "Action",
                render: (row) => !row.dispatch_authorization_status ? (
                  <button
                    type="button"
                    disabled={busyId === String(row.id)}
                    onClick={() => requestDispatch(row)}
                    className="rounded bg-info px-2 py-1 text-[11px] font-semibold text-info-foreground disabled:opacity-50"
                  >
                    {busyId === String(row.id) ? "Requesting..." : "Request Authorization"}
                  </button>
                ) : <StatusBadge tone={row.dispatch_authorization_status === "Approved" ? "success" : "pending"}>
                  {row.dispatch_authorization_status}
                </StatusBadge>
              }] : [])
            ]}
          />
        </SectionCard>
      </div>
    </>
  );
}

function ProfilePage() {
  return (
    <>
      <PageHeader
        eyebrow="Profile"
        title="Warehouse Staff Profile"
        description="Role context for the current warehouse operations session."
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-3 lg:grid-cols-3">
          <SectionCard title="User Profile" icon={UserCircle2}>
            <div className="space-y-3 text-xs">
              <div className="rounded border border-border bg-muted/20 p-3">
                <div className="text-[11px] font-semibold text-muted-foreground">Name</div>
                <div className="mt-1 font-semibold">Warehouse Staff</div>
              </div>
              <div className="rounded border border-border bg-muted/20 p-3">
                <div className="text-[11px] font-semibold text-muted-foreground">Role</div>
                <div className="mt-1"><StatusBadge tone="released">Warehouse Staff</StatusBadge></div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Operational Assignment" icon={Warehouse}>
            <div className="space-y-3 text-xs">
              <div className="rounded border border-border bg-muted/20 p-3">
                <div className="text-[11px] font-semibold text-muted-foreground">Current Shift</div>
                <div className="mt-1 font-semibold">Shift not assigned</div>
              </div>
              <div className="rounded border border-border bg-muted/20 p-3">
                <div className="text-[11px] font-semibold text-muted-foreground">Active Warehouse</div>
                <div className="mt-1 font-semibold">Warehouse not assigned</div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Role Responsibilities" icon={ClipboardList}>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="rounded border border-border bg-muted/20 px-3 py-2">Receiving cargo</div>
              <div className="rounded border border-border bg-muted/20 px-3 py-2">Registering cargo</div>
              <div className="rounded border border-border bg-muted/20 px-3 py-2">Physical placement</div>
              <div className="rounded border border-border bg-muted/20 px-3 py-2">Barcode-assisted storage operations</div>
              <div className="rounded border border-border bg-muted/20 px-3 py-2">Cargo tracking</div>
              <div className="rounded border border-border bg-muted/20 px-3 py-2">Dispatch preparation</div>
            </div>
          </SectionCard>
        </div>
      </div>
    </>
  );
}

const Index = () => {
  return (
    <AppLayout>
      <Routes>
        <Route index element={<DashboardPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route
          path="cargo/registration"
          element={
            <CargoWorkflowPage
              tab={0}
              title="Cargo Registration"
              description="Register newly received cargo and generate identifiers and barcodes."
            />
          }
        />
        <Route path="cargo/registration-reviews" element={<RegistrationReviewsPage />} />
        <Route path="cargo/placement-queue" element={<PlacementQueuePage />} />
        <Route
          path="cargo/placement-scanning"
          element={
            <CargoWorkflowPage
              tab={1}
              title="Placement & Scanning"
              description="Barcode-assisted placement workflow for cargo and storage bin validation."
            />
          }
        />
        <Route
          path="cargo/tracking"
          element={
            <CargoWorkflowPage
              tab={2}
              title="Cargo Tracking"
              description="Find cargo, view current storage location, and inspect movement history."
            />
          }
        />
        <Route path="storage/zones" element={<WarehouseStoragePage scope="zones" />} />
        <Route path="storage/racks" element={<WarehouseStoragePage scope="racks" />} />
        <Route path="storage/levels" element={<WarehouseStoragePage scope="levels" />} />
        <Route path="storage/bins" element={<WarehouseStoragePage scope="bins" />} />
        <Route path="storage/occupancy" element={<WarehouseStoragePage scope="occupancy" />} />
        <Route path="dispatch/queue" element={<DispatchOperationPage mode="queue" />} />
        <Route path="dispatch/gate-release" element={<DispatchOperationPage mode="gate" />} />
        <Route path="dispatch/released" element={<DispatchOperationPage mode="released" />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/staff" replace />} />
      </Routes>
    </AppLayout>
  );
};

export default Index;

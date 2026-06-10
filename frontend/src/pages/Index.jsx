import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import {
  Activity,
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
import { DetailForm } from "@/components/wms/DetailForm";
import {
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
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
  getPlacementLogs,
  getRacks,
  getZones
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
  }, [status]);

  return { records, loading, error };
}

function DashboardPage() {
  const [cargo, setCargo] = useState([]);
  const [logs, setLogs] = useState([]);
  const [zones, setZones] = useState([]);
  const [cargoLoading, setCargoLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(true);
  const [zonesLoading, setZonesLoading] = useState(true);
  const [cargoError, setCargoError] = useState("");
  const [logsError, setLogsError] = useState("");
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

    const loadLogs = async () => {
      setLogsLoading(true);
      setLogsError("");
      try {
        const response = await getPlacementLogs();
        if (active) setLogs(response.data || []);
      } catch (err) {
        if (active) setLogsError(getErrorMessage(err));
      } finally {
        if (active) setLogsLoading(false);
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
    loadLogs();
    loadZones();

    return () => {
      active = false;
    };
  }, []);

  const pendingPlacement = useMemo(
    () => cargo.filter((record) => record.status === "Registered" && !record.current_bin_id && !record.location),
    [cargo]
  );
  const rejectedPlacement = useMemo(() => logs.filter((log) => log.approved === false), [logs]);
  const recentlyStored = useMemo(
    () => cargo.filter((record) => record.status === "Stored").slice(0, 5),
    [cargo]
  );
  const recentActivity = logs.slice(0, 5);

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
            title="Rejected Placement"
            icon={ClipboardCheck}
            loading={logsLoading}
            error={logsError}
            value={rejectedPlacement.length}
            emptyTitle="No rejected placements"
            tone="destructive"
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
                { key: "status", label: "Status", render: (row) => <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge> }
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

        <div className="mt-3">
          <SectionCard title="Recent Activity Feed" icon={Activity}>
            {logsLoading ? (
              <LoadingState />
            ) : logsError ? (
              <ErrorState message={logsError} />
            ) : recentActivity.length ? (
              <div className="space-y-2">
                {recentActivity.map((log) => (
                  <div key={log.id} className="grid gap-2 rounded border border-border bg-muted/20 p-2 text-xs md:grid-cols-[150px_110px_1fr]">
                    <span className="font-mono text-muted-foreground">{formatDateTime(log.created_at)}</span>
                    <StatusBadge tone={log.approved ? "success" : "destructive"}>{log.approved ? "Accepted" : "Rejected"}</StatusBadge>
                    <span>{log.reason}: {log.detail || "No detail recorded"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No recent activity" />
            )}
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function CargoWorkflowPage({ tab, title, description }) {
  return (
    <>
      <PageHeader eyebrow="Cargo Operations" title={title} description={description} />
      <div className="flex-1 min-h-0 overflow-hidden p-3">
        <DetailForm initialTab={tab} />
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
      status: "Ready for Dispatch",
      emptyTitle: "No cargo queued for dispatch",
      description: "Cargo prepared for outbound handling will appear here after dispatch readiness is recorded."
    },
    gate: {
      title: "Gate Release",
      icon: DoorOpen,
      status: "Ready for Dispatch",
      emptyTitle: "No cargo ready for gate release",
      description: "Readonly gate release preparation queue for warehouse staff."
    },
    released: {
      title: "Released Cargo",
      icon: PackageCheck,
      status: "Released",
      emptyTitle: "No released cargo",
      description: "Cargo released from the warehouse."
    }
  }[mode];

  const { records, loading, error } = useCargo(config.status);

  return (
    <>
      <PageHeader eyebrow="Dispatch Operations" title={config.title} description={config.description} />
      <div className="flex-1 overflow-auto p-4">
        <SectionCard title={config.title} icon={config.icon}>
          <DataTable
            loading={loading}
            error={error}
            rows={records}
            emptyTitle={config.emptyTitle}
            columns={[
              { key: "cargo_id", label: "Cargo ID", className: "font-mono font-semibold" },
              { key: "barcode", label: "Barcode", className: "font-mono text-muted-foreground" },
              { key: "consignee_name", label: "Consignee", render: (row) => row.consignee_name || "Not recorded" },
              { key: "location", label: "Storage Location", render: (row) => row.location || "Not assigned" },
              { key: "clearance_status", label: "Clearance Status", render: (row) => row.clearance_status || "Not recorded" },
              { key: "status", label: "Status", render: (row) => <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge> }
            ]}
          />
        </SectionCard>
      </div>
    </>
  );
}

function ActivityLogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const response = await getPlacementLogs();
        if (active) setLogs(response.data || []);
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
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Activity Logs"
        title="Warehouse Activity Logs"
        description="Placement validation and scanner activity for warehouse operations."
      />
      <div className="flex-1 overflow-auto p-4">
        <SectionCard title="System & Validation Logs" icon={Activity}>
          <DataTable
            loading={loading}
            error={error}
            rows={logs}
            emptyTitle="No recent activity"
            columns={[
              { key: "created_at", label: "Time", render: (row) => formatDateTime(row.created_at), className: "font-mono text-muted-foreground" },
              { key: "cargo_identifier", label: "Cargo", render: (row) => row.cargo_identifier || row.cargo_barcode || "Not recorded" },
              { key: "bin_identifier", label: "Bin", render: (row) => row.bin_identifier || row.bin_barcode || "Not recorded" },
              { key: "approved", label: "Result", render: (row) => <StatusBadge tone={row.approved ? "success" : "destructive"}>{row.approved ? "Accepted" : "Rejected"}</StatusBadge> },
              { key: "detail", label: "Detail", render: (row) => `${row.reason}: ${row.detail || "No detail recorded"}` }
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
        <Route path="activity-logs" element={<ActivityLogsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/staff" replace />} />
      </Routes>
    </AppLayout>
  );
};

export default Index;

import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import {
  Boxes,
  Clock3,
  ClipboardCheck,
  ClipboardList,
  DoorOpen,
  PackageCheck,
  PackagePlus,
  Search,
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
import { EnterpriseModal } from "@/components/wms/EnterpriseModal";
import { PlacementSessionModal } from "@/components/wms/PlacementSessionModal";
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

function PlacementQueuePanel() {
  const barcodeRef = useRef(null);
  const [records, setRecords] = useState([]);
  const [filter, setFilter] = useState("Unplaced");
  const [selected, setSelected] = useState(null);
  const [printCargo, setPrintCargo] = useState(null);
  const [placementCargo, setPlacementCargo] = useState(null);
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
    setPlacementCargo(cargo);
  };

  return (
    <div className="h-full overflow-auto p-3">
      <div className="space-y-3">
        {error && <ErrorState message={error} />}
        <SectionCard title="Queue Filters" icon={ClipboardList}>
          <div className="grid grid-cols-7 gap-1.5">
            {placementQueueFilters.map((item) => (
              <button
                key={item}
                type="button"
                title={item}
                onClick={() => setFilter(item)}
                className={`min-w-0 overflow-hidden whitespace-nowrap rounded border px-1 py-2 text-[10px] font-semibold ${
                  filter === item
                    ? "border-info bg-info/10 text-info"
                    : "border-border bg-background text-muted-foreground"
                  }`}
              >
                {item === "Correction Required"
                  ? "Correction"
                  : item === "Relocation Required"
                    ? "Relocation"
                    : item}
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard title={`${filter} Cargo`} icon={PackagePlus}>
          <DataTable
            loading={loading}
            rows={visibleRecords}
            emptyTitle={`No ${filter.toLowerCase()} cargo in the placement queue`}
            tableClassName="!min-w-0 table-fixed"
            containerClassName="overflow-hidden"
            columns={[
              { key: "cargo_id", label: "Cargo ID", headerClassName: "w-[18%] whitespace-nowrap", className: "truncate whitespace-nowrap font-mono font-semibold" },
              { key: "cargo_type", label: "Cargo Type", headerClassName: "w-[17%] whitespace-nowrap", className: "truncate whitespace-nowrap" },
              {
                key: "placement_status",
                label: "Placement Status",
                headerClassName: "w-[18%] whitespace-nowrap",
                className: "whitespace-nowrap",
                render: (row) => <StatusBadge tone={statusTone(row.placement_status)}>{row.placement_status}</StatusBadge>
              },
              {
                key: "location",
                label: "Current Location",
                headerClassName: "w-[17%] whitespace-nowrap",
                className: "truncate whitespace-nowrap",
                render: (row) => row.location || "Not placed"
              },
              {
                key: "actions",
                label: "Actions",
                headerClassName: "w-[30%] whitespace-nowrap",
                className: "overflow-hidden whitespace-nowrap",
                render: (row) => {
                  const canStart = row.registration_status !== "Rejected"
                    && row.placement_status !== "Dispatched";
                  return (
                    <div className="flex min-w-0 flex-nowrap items-center gap-1">
                      <button
                        type="button"
                        disabled={!canStart}
                        onClick={() => startPlacement(row)}
                        className="min-w-0 whitespace-nowrap rounded bg-success px-1.5 py-1 text-[9px] font-semibold text-success-foreground disabled:opacity-40"
                      >
                        {["Placed", "Relocated"].includes(row.placement_status) ? "Relocate" : "Start Placement"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelected(row)}
                        className="min-w-0 whitespace-nowrap rounded border border-info/30 bg-info/10 px-1.5 py-1 text-[9px] font-semibold text-info"
                      >
                        Details
                      </button>
                      <button
                        type="button"
                        onClick={() => setPrintCargo(row)}
                        className="min-w-0 whitespace-nowrap rounded border border-border px-1.5 py-1 text-[9px] font-semibold"
                      >
                        Print
                      </button>
                      {row.registration_status === "Correction Required" && (
                        <button
                            type="button"
                            onClick={() => setSelected(row)}
                            className="min-w-0 whitespace-nowrap rounded bg-warning px-1.5 py-1 text-[9px] font-semibold text-warning-foreground"
                          >
                            Correction
                        </button>
                      )}
                    </div>
                  );
                }
              }
            ]}
          />
        </SectionCard>

      </div>
      <EnterpriseModal
        open={Boolean(selected)}
        title={selected ? `Cargo Details: ${selected.cargo_id}` : "Cargo Details"}
        subtitle="Registered cargo, approval, placement, and location information."
        size="medium"
        onClose={() => setSelected(null)}
        footer={(
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="rounded border border-border bg-background px-4 py-2 text-xs font-semibold hover:bg-muted"
          >
            Close
          </button>
        )}
      >
        {selected && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Cargo ID", selected.cargo_id],
                ["Barcode", selected.barcode],
                ["Cargo Type", selected.cargo_type],
                ["Consignee", selected.consignee_name],
                ["Contact Phone", selected.phone_number || "No phone"],
                ["Quantity", formatCount(selected.quantity)],
                ["Weight", formatMeasure(selected.weight, "kg")],
                ["Volume", formatMeasure(selected.volume, "m3")],
                ["Hazard Class", selected.hazard_class || "Not applicable"],
                ["Current Location", selected.location || "Not placed"],
                ["Current Bin", selected.bin_barcode || "Not placed"],
                ["Registered", formatDateTime(selected.created_at)]
              ].map(([label, value]) => (
                <div key={label} className="rounded border border-border bg-card p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
                  <div className="mt-1 break-words text-xs font-semibold">{value}</div>
                </div>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded border border-border bg-card p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Registration Status</div>
                <div className="mt-2">
                  <StatusBadge tone={statusTone(selected.registration_status)}>{selected.registration_status}</StatusBadge>
                </div>
              </div>
              <div className="rounded border border-border bg-card p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Placement Status</div>
                <div className="mt-2">
                  <StatusBadge tone={statusTone(selected.placement_status)}>{selected.placement_status}</StatusBadge>
                </div>
              </div>
            </div>

            <div className="rounded border border-border bg-card p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Supervisor Message</div>
              <div className="mt-1 text-xs font-semibold">
                {selected.correction_notes || selected.rejection_reason || "No correction message"}
              </div>
            </div>

            {selected.relocation_required && (
              <div className="rounded border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                <strong>Relocation required:</strong> {selected.relocation_reason}
              </div>
            )}
          </div>
        )}
      </EnterpriseModal>
      <PlacementSessionModal
        open={Boolean(placementCargo)}
        cargo={placementCargo}
        onClose={() => setPlacementCargo(null)}
        onCompleted={load}
      />
      {printCargo && (
        <div className="fixed -left-[10000px] top-0">
          <BarcodeLabel ref={barcodeRef} cargo={printCargo} />
        </div>
      )}
    </div>
  );
}

function RegistrationReviewsPanel() {
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
      <div className="h-full overflow-auto p-3">
        <div className="space-y-3">
          {error && <ErrorState message={error} />}
          <SectionCard title="Registration Review Status" icon={ClipboardCheck}>
            <DataTable
              loading={loading}
              rows={records}
              emptyTitle="No registrations are awaiting review or correction"
              tableClassName="!min-w-0 table-fixed"
              containerClassName="overflow-hidden"
              columns={[
                { key: "cargo_id", label: "Cargo ID", headerClassName: "w-[14%]", className: "truncate font-mono font-semibold" },
                { key: "consignee_name", label: "Consignee", headerClassName: "w-[17%]", className: "truncate" },
                { key: "cargo_type", label: "Cargo Type", headerClassName: "w-[16%]", className: "truncate" },
                {
                  key: "registration_status",
                  label: "Review Status",
                  headerClassName: "w-[17%]",
                  className: "whitespace-nowrap",
                  render: (row) => <StatusBadge tone={statusTone(row.registration_status)}>{row.registration_status}</StatusBadge>
                },
                {
                  key: "review_notes",
                  label: "Supervisor Notes",
                  headerClassName: "w-[23%]",
                  className: "truncate",
                  render: (row) => row.correction_notes || row.corrective_notes || row.rejection_reason || "Awaiting review"
                },
                {
                  key: "action",
                  label: "Action",
                  headerClassName: "w-[13%]",
                  className: "overflow-hidden whitespace-nowrap",
                  render: (row) => ["Correction Required", "Rejected"].includes(row.registration_status) ? (
                    <button
                      type="button"
                      onClick={() => setSelectedId(String(row.id))}
                      className="max-w-full truncate whitespace-nowrap rounded bg-info px-1.5 py-1 text-[9px] font-semibold text-info-foreground"
                    >
                      {row.registration_status === "Rejected" ? "Revise" : "Correct"}
                    </button>
                  ) : <span className="whitespace-nowrap text-[10px] text-muted-foreground">Read only</span>
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

const cargoSearchTypes = [
  "General Goods",
  "Electronics",
  "Machinery",
  "Food Products",
  "Construction Materials",
  "Fragile Goods",
  "Hazardous Cargo",
  "Mixed Cargo"
];

const registrationWorkspaceTabs = [
  { id: "registration", label: "Cargo Registration", icon: ClipboardList },
  { id: "reviews", label: "My Registration Reviews", icon: ClipboardCheck },
  { id: "placement", label: "Placement Queue", icon: PackagePlus }
];

function CompactCargoList({ records, loading, error, emptyTitle }) {
  if (loading) {
    return <div className="rounded border border-border bg-muted/20 px-3 py-4 text-xs text-muted-foreground">Loading cargo...</div>;
  }

  if (error) return <ErrorState message={error} />;

  if (!records.length) {
    return (
      <div className="rounded border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
        {emptyTitle}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded border border-border bg-background">
      <table className="w-full table-fixed text-left">
        <thead className="bg-panel-header text-panel-header-foreground">
          <tr className="text-[10px] font-semibold">
            <th className="w-[34%] whitespace-nowrap px-2 py-2">Consignee Name</th>
            <th className="w-[41%] whitespace-nowrap px-2 py-2">Status</th>
            <th className="w-[25%] whitespace-nowrap px-2 py-2">Contact Phone</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {records.map((record) => (
            <tr key={record.id || record.cargo_id} className="align-middle hover:bg-muted/30">
              <td className="px-2 py-2.5">
                <div
                  className="truncate whitespace-nowrap text-[11px] font-semibold"
                  title={record.consignee_name || "No consignee"}
                >
                  {record.consignee_name || "No consignee"}
                </div>
              </td>
              <td className="px-2 py-2">
                <div className="flex items-center gap-1 whitespace-nowrap">
                  <StatusBadge
                    tone={statusTone(record.registration_status)}
                    className="shrink-0 px-1.5 text-[9px]"
                  >
                    {record.registration_status || "Pending Review"}
                  </StatusBadge>
                  <StatusBadge
                    tone={statusTone(record.placement_status)}
                    className="shrink-0 px-1.5 text-[9px]"
                  >
                    {record.placement_status || "Unplaced"}
                  </StatusBadge>
                </div>
              </td>
              <td className="whitespace-nowrap px-2 py-2.5 text-[10px] text-muted-foreground">
                {record.phone_number || record.contact_phone || "No phone"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CargoSearchSidebar({ refreshKey }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [cargoType, setCargoType] = useState("All");
  const [searchResults, setSearchResults] = useState([]);
  const [recentRecords, setRecentRecords] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [recentLoading, setRecentLoading] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [recentError, setRecentError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    let active = true;
    setRecentLoading(true);
    setRecentError("");

    getCargo({ limit: 8 })
      .then((response) => {
        if (active) setRecentRecords(response.data || []);
      })
      .catch((error) => {
        if (active) setRecentError(getErrorMessage(error));
      })
      .finally(() => {
        if (active) setRecentLoading(false);
      });

    return () => {
      active = false;
    };
  }, [refreshKey]);

  const runSearch = async (event) => {
    event?.preventDefault();
    setSearchLoading(true);
    setSearchError("");
    setHasSearched(true);

    try {
      const response = await getCargo({
        ...(searchTerm.trim() ? { search: searchTerm.trim() } : {}),
        ...(cargoType !== "All" ? { cargo_type: cargoType } : {}),
        limit: 30
      });
      setSearchResults(response.data || []);
    } catch (error) {
      setSearchError(getErrorMessage(error));
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const clearSearch = () => {
    setSearchTerm("");
    setCargoType("All");
    setSearchResults([]);
    setSearchError("");
    setHasSearched(false);
  };

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card">
      <div className="border-b border-border bg-panel-header px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Search className="h-4 w-4 text-info" />
          Search Cargo
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Find cargo by ID, barcode, consignee, company, cargo type, vehicle, container, or delivery note.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <form onSubmit={runSearch} className="space-y-2.5 border-b border-border p-3">
          <label className="block space-y-1.5">
            <span className="text-[11px] font-semibold text-foreground/80">Search any cargo</span>
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className={inputClass}
              placeholder="ID, barcode, consignee..."
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] font-semibold text-foreground/80">Cargo type</span>
            <select value={cargoType} onChange={(event) => setCargoType(event.target.value)} className={inputClass}>
              <option>All</option>
              {cargoSearchTypes.map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button type="submit" className="inline-flex items-center justify-center gap-1.5 rounded bg-success px-3 py-2 text-xs font-semibold text-success-foreground">
              <Search className="h-3.5 w-3.5" />
              Search
            </button>
            <button type="button" onClick={clearSearch} className="rounded border border-border bg-background px-3 py-2 text-xs font-semibold">
              Clear
            </button>
          </div>
        </form>

        {hasSearched && (
          <section className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold">Search Results</h2>
              {!searchLoading && !searchError && (
                <span className="text-[10px] text-muted-foreground">{searchResults.length} found</span>
              )}
            </div>
            <CompactCargoList
              records={searchResults}
              loading={searchLoading}
              error={searchError}
              emptyTitle="No cargo matched your search."
            />
          </section>
        )}

        <section className="space-y-2 border-t border-border p-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Clock3 className="h-3.5 w-3.5 text-info" />
              Recent Registered Cargo
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">The latest cargo added to the warehouse.</p>
          </div>
          <CompactCargoList
            records={recentRecords}
            loading={recentLoading}
            error={recentError}
            emptyTitle="No cargo has been registered yet."
          />
        </section>
      </div>
    </aside>
  );
}

function CargoRegistrationWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);
  const requestedTab = searchParams.get("tab") || "registration";
  const activeTab = registrationWorkspaceTabs.some((tab) => tab.id === requestedTab)
    ? requestedTab
    : "registration";

  const selectTab = (tabId) => {
    const next = new URLSearchParams(searchParams);
    if (tabId === "registration") next.delete("tab");
    else next.set("tab", tabId);
    setSearchParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        eyebrow="Cargo Operations"
        title="Cargo Registration"
        description="Register cargo, follow your supervisor reviews, and manage cargo awaiting warehouse placement."
      />
      <div className="grid min-h-0 flex-1 gap-3 overflow-hidden p-3 lg:grid-cols-[420px_minmax(0,1fr)] xl:grid-cols-[480px_minmax(0,1fr)]">
        <CargoSearchSidebar refreshKey={refreshKey} />

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card">
          <div className="flex shrink-0 overflow-x-auto border-b border-border bg-muted/20 px-2 pt-2">
            {registrationWorkspaceTabs.map((tab) => {
              const Icon = tab.icon;
              const selected = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => selectTab(tab.id)}
                  className={`relative inline-flex min-w-max items-center gap-2 rounded-t-md border border-b-0 px-4 py-2.5 text-xs font-semibold transition ${
                    selected
                      ? "border-border bg-card text-info"
                      : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                  {selected && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-info" />}
                </button>
              );
            })}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {activeTab === "registration" && (
              <div className="h-full p-3">
                <DetailForm
                  initialTab={0}
                  onCargoSaved={() => setRefreshKey((current) => current + 1)}
                />
              </div>
            )}
            {activeTab === "reviews" && <RegistrationReviewsPanel />}
            {activeTab === "placement" && <PlacementQueuePanel />}
          </div>
        </section>
      </div>
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
          element={<CargoRegistrationWorkspace />}
        />
        <Route path="cargo/registration-reviews" element={<Navigate to="/staff/cargo/registration?tab=reviews" replace />} />
        <Route path="cargo/placement-queue" element={<Navigate to="/staff/cargo/registration?tab=placement" replace />} />
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

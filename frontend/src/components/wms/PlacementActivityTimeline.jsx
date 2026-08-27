import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Filter,
  PackageCheck,
  RefreshCw,
  ScanLine,
  Shuffle,
  SlidersHorizontal
} from "lucide-react";
import {
  DataTable,
  EmptyState,
  OperationalStatCard,
  SectionCard,
  StatusBadge
} from "./OperationalUi";
import {
  getCargoPlacementActivity,
  getPlacementActivity,
  getPlacementActivitySummary
} from "@/services/api";
import { formatDateTime, getErrorMessage } from "@/lib/wms-operational";

const activityTypeLabels = {
  PLACEMENT_QUEUE_ENTERED: "Queue Entered",
  PLACEMENT_VALIDATED: "Validation Passed",
  PLACEMENT_VALIDATION_FAILED: "Validation Failed",
  PLACEMENT_CONFIRMATION_FAILED: "Confirmation Failed",
  PLACEMENT_CONFIRMED: "Placed",
  CARGO_RELOCATED: "Relocated",
  PLACEMENT_OVERRIDE_REQUESTED: "Override Requested",
  PLACEMENT_OVERRIDE_APPROVED: "Override Approved",
  PLACEMENT_OVERRIDE_REJECTED: "Override Rejected",
  MANUAL_PLACEMENT_SETTING_CHANGED: "Manual Setting Changed",
  LOCATION_REVALIDATED: "Location Revalidated",
  LOCATION_REVALIDATION_FAILED: "Location Revalidation Failed",
  CARGO_UNALLOCATED_EXCEPTION: "No Compatible Bin",
  CARGO_UNALLOCATED_RESOLVED: "Unallocated Exception Resolved",
  SCANNER_SESSION_STARTED: "Scanner Session Started",
  SCANNER_SESSION_COMPLETED: "Scanner Placement Completed",
  SCANNER_SESSION_CANCELLED: "Scanner Session Cancelled"
};

const activityTypes = Object.entries(activityTypeLabels);

const emptyFilters = {
  cargo_id: "",
  activity_type: "",
  result: "",
  placement_mode: "",
  from_date: "",
  to_date: "",
  staff_id: "",
  warehouse_id: ""
};

function resultTone(result) {
  if (result === "success") return "success";
  if (result === "pending") return "warning";
  if (result === "failed") return "destructive";
  return "muted";
}

function activityTone(activityType) {
  if (activityType?.includes("FAILED") || activityType?.includes("REJECTED")) return "destructive";
  if (activityType?.includes("REQUESTED")) return "warning";
  if (activityType?.includes("RELOCATED")) return "info";
  return "success";
}

function compactLocation(row) {
  const from = row.from_location || "Start";
  const to = row.to_location || "Not recorded";
  return `${from} -> ${to}`;
}

function detailText(row) {
  const base = row.detail || row.reason || "No detail recorded";
  if (row.activity_type === "CARGO_RELOCATED" && row.metadata?.released_at) {
    return `${base} - released ${formatDateTime(row.metadata.released_at)}`;
  }
  return base;
}

function buildQuery(filters) {
  return Object.fromEntries(
    Object.entries(filters)
      .map(([key, value]) => [key, String(value || "").trim()])
      .filter(([, value]) => value)
  );
}

function PlacementActivityFilters({ filters, onChange, onApply, onReset, adminFilters = false }) {
  const update = (key, value) => onChange({ ...filters, [key]: value });

  return (
    <SectionCard title="Activity Filters" icon={Filter}>
      <form
        className="grid gap-3 md:grid-cols-2 xl:grid-cols-6"
        onSubmit={(event) => {
          event.preventDefault();
          onApply();
        }}
      >
        <label className="space-y-1.5">
          <span className="text-[11px] font-semibold">Cargo</span>
          <input className="h-9 w-full rounded border border-input bg-background px-2 text-xs" value={filters.cargo_id} onChange={(event) => update("cargo_id", event.target.value)} placeholder="Cargo reference or barcode" />
        </label>
        <label className="space-y-1.5">
          <span className="text-[11px] font-semibold">Activity</span>
          <select className="h-9 w-full rounded border border-input bg-background px-2 text-xs" value={filters.activity_type} onChange={(event) => update("activity_type", event.target.value)}>
            <option value="">All activity</option>
            {activityTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="text-[11px] font-semibold">Result</span>
          <select className="h-9 w-full rounded border border-input bg-background px-2 text-xs" value={filters.result} onChange={(event) => update("result", event.target.value)}>
            <option value="">All results</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="text-[11px] font-semibold">Mode</span>
          <select className="h-9 w-full rounded border border-input bg-background px-2 text-xs" value={filters.placement_mode} onChange={(event) => update("placement_mode", event.target.value)}>
            <option value="">All modes</option>
            <option value="scan">Scan</option>
            <option value="manual">Manual</option>
          </select>
        </label>
        {adminFilters && (
          <>
            <label className="space-y-1.5">
              <span className="text-[11px] font-semibold">Staff</span>
              <input className="h-9 w-full rounded border border-input bg-background px-2 text-xs" value={filters.staff_id} onChange={(event) => update("staff_id", event.target.value)} placeholder="Full name or username" />
            </label>
            <label className="space-y-1.5">
              <span className="text-[11px] font-semibold">Warehouse</span>
              <input className="h-9 w-full rounded border border-input bg-background px-2 text-xs" value={filters.warehouse_id} onChange={(event) => update("warehouse_id", event.target.value)} placeholder="WH-A, WH-B, etc." />
            </label>
          </>
        )}
        <label className="space-y-1.5">
          <span className="text-[11px] font-semibold">From</span>
          <input type="date" className="h-9 w-full rounded border border-input bg-background px-2 text-xs" value={filters.from_date} onChange={(event) => update("from_date", event.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className="text-[11px] font-semibold">To</span>
          <input type="date" className="h-9 w-full rounded border border-input bg-background px-2 text-xs" value={filters.to_date} onChange={(event) => update("to_date", event.target.value)} />
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="inline-flex h-9 items-center gap-2 rounded bg-info px-3 text-xs font-semibold text-info-foreground">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Apply
          </button>
          <button type="button" onClick={onReset} className="inline-flex h-9 items-center gap-2 rounded border border-border bg-background px-3 text-xs font-semibold">
            <RefreshCw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>
      </form>
    </SectionCard>
  );
}

function PlacementActivityPanel({
  title = "Placement Activity",
  cargoId = null,
  adminFilters = false,
  showFilters = true
}) {
  const [filters, setFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState({ rows: [], summary: {}, total: 0, loading: true, error: "" });

  const query = useMemo(
    () => buildQuery({ ...appliedFilters, page, limit: pageSize }),
    [appliedFilters, page, pageSize]
  );

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: "" }));

    const activityRequest = cargoId
      ? getCargoPlacementActivity(cargoId, query)
      : getPlacementActivity(query);
    const summaryRequest = getPlacementActivitySummary(cargoId
      ? { ...query, cargo_id: cargoId }
      : query);

    Promise.all([activityRequest, summaryRequest])
      .then(([activityResponse, summaryResponse]) => {
        if (!active) return;
        setState({
          rows: activityResponse.data || [],
          summary: summaryResponse.data || {},
          total: Number(activityResponse.total || 0),
          loading: false,
          error: ""
        });
      })
      .catch((error) => {
        if (!active) return;
        setState({ rows: [], summary: {}, total: 0, loading: false, error: getErrorMessage(error) });
      });

    return () => {
      active = false;
    };
  }, [cargoId, query, refreshKey]);

  const summary = state.summary || {};

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <OperationalStatCard title="Activity" icon={ClipboardCheck} loading={state.loading} error={state.error} value={summary.activity_count} emptyTitle="No activity" tone="info" />
        <OperationalStatCard title="Placed" icon={PackageCheck} loading={state.loading} error={state.error} value={summary.placement_confirmed_count} emptyTitle="No placed cargo" tone="success" />
        <OperationalStatCard title="Relocated" icon={Shuffle} loading={state.loading} error={state.error} value={summary.relocation_count} emptyTitle="No relocations" tone="info" />
        <OperationalStatCard title="Failed Attempts" icon={AlertTriangle} loading={state.loading} error={state.error} value={(summary.validation_failed_count || 0) + (summary.confirmation_failed_count || 0)} emptyTitle="No failed attempts" tone="destructive" />
      </div>

      {showFilters && (
        <PlacementActivityFilters
          filters={filters}
          adminFilters={adminFilters}
          onChange={setFilters}
          onApply={() => { setPage(1); setAppliedFilters(filters); }}
          onReset={() => {
            setFilters(emptyFilters);
            setAppliedFilters(emptyFilters);
            setPage(1);
          }}
        />
      )}

      <div className="flex justify-end">
        <button type="button" disabled={state.loading} onClick={() => setRefreshKey((value) => value + 1)} className="inline-flex h-9 items-center gap-2 rounded border border-border bg-background px-3 text-xs font-semibold disabled:opacity-40">
          <RefreshCw className={`h-3.5 w-3.5 ${state.loading ? "animate-spin" : ""}`} />
          Refresh activity
        </button>
      </div>
      <SectionCard title={title} icon={ScanLine}>
        <DataTable
          loading={state.loading}
          error={state.error}
          rows={state.rows}
          page={page}
          pageSize={pageSize}
          total={state.total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          itemLabel="activity records"
          emptyTitle="No placement activity recorded"
          emptyBody="Placement events will appear after validation, confirmation, relocation, or override activity is recorded."
          columns={[
            { key: "timestamp", label: "Time", render: (row) => formatDateTime(row.timestamp), className: "font-mono text-muted-foreground" },
            { key: "activity_type", label: "Activity", render: (row) => <StatusBadge tone={activityTone(row.activity_type)}>{activityTypeLabels[row.activity_type] || row.activity_type}</StatusBadge> },
            { key: "result", label: "Result", render: (row) => <StatusBadge tone={resultTone(row.result)}>{row.result || "recorded"}</StatusBadge> },
            { key: "cargo_identifier", label: "Cargo", render: (row) => row.cargo_identifier || row.metadata?.cargo_identifier || row.metadata?.cargo_barcode || "Not linked", className: "font-mono font-semibold" },
            { key: "warehouse", label: "Warehouse", render: (row) => row.warehouse_code || row.warehouse_name || "Not assigned" },
            { key: "performed_by", label: "Actor", render: (row) => row.performed_by_name || row.performed_by_username || (row.performed_by ? `User ${row.performed_by}` : "System") },
            { key: "location", label: "Location", render: compactLocation, className: "max-w-[260px] truncate" },
            { key: "detail", label: "Detail", render: detailText, className: "max-w-[320px] truncate" }
          ]}
        />
        {!state.loading && !state.error && state.rows.length === 0 && (
          <div className="mt-3">
            <EmptyState title="No activity in this view" body="Adjust filters or record placement work to populate this timeline." />
          </div>
        )}
      </SectionCard>
    </div>
  );
}

export {
  PlacementActivityPanel,
  PlacementActivityFilters
};

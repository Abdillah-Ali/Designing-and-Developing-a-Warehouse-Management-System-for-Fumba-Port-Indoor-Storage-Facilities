import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  PackageSearch,
  Rows3,
  ScanLine,
  ShieldCheck,
  SquareStack,
  Truck,
  UserCircle2,
  Users,
  Warehouse,
  XCircle
} from "lucide-react";
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
import { CargoReviewModal } from "@/components/wms/CargoReviewModal";
import { DecisionNotesModal } from "@/components/wms/DecisionNotesModal";
import { ManualPlacementSetting } from "@/components/wms/ManualPlacementSetting";
import { ReviewActionModal } from "@/components/wms/ReviewActionModal";
import { cn } from "@/lib/utils";
import {
  formatCount,
  formatDateTime,
  formatMeasure,
  getErrorMessage,
  statusTone
} from "@/lib/wms-operational";
import {
  approveDispatchAuthorization,
  approveSupervisorApproval,
  getAllBins,
  getAllLevels,
  getAllRacks,
  getCargo,
  getCargoById,
  getDispatchAuthorizationRequests,
  getProfile,
  getSupervisorApprovals,
  getSupervisorDashboard,
  getSupervisorPlacementSummary,
  getSupervisorReviewHistory,
  getSupervisorReviewConfiguration,
  getZones,
  logout,
  rejectDispatchAuthorization,
  rejectSupervisorApproval,
  requestSupervisorCorrection
} from "@/services/api";

const navigation = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/supervisor" },
  {
    label: "Cargo Supervision",
    icon: PackageSearch,
    children: [
      { label: "Pending Cargo Approvals", icon: ClipboardCheck, to: "/supervisor/cargo/pending-approvals" },
      { label: "My Review History", icon: Activity, to: "/supervisor/cargo/review-history" },
      { label: "Cargo Records", icon: ClipboardList, to: "/supervisor/cargo/records" },
      { label: "Placement Monitoring", icon: ScanLine, to: "/supervisor/cargo/placement-monitoring" },
      { label: "Exception Handling", icon: AlertTriangle, to: "/supervisor/cargo/exceptions" }
    ]
  },
  {
    label: "Warehouse Monitoring",
    icon: Warehouse,
    children: [
      { label: "Occupancy Status", icon: Boxes, to: "/supervisor/warehouse/occupancy" },
      { label: "Zones", icon: Boxes, to: "/supervisor/warehouse/zones" },
      { label: "Racks", icon: Rows3, to: "/supervisor/warehouse/racks" },
      { label: "Levels", icon: SquareStack, to: "/supervisor/warehouse/levels" },
      { label: "Bins", icon: Warehouse, to: "/supervisor/warehouse/bins" }
    ]
  },
  {
    label: "Dispatch Authorization",
    icon: Truck,
    children: [
      { label: "Dispatch Requests", icon: ClipboardCheck, to: "/supervisor/dispatch/requests" },
      { label: "Approved Dispatch", icon: CheckCircle2, to: "/supervisor/dispatch/approved" }
    ]
  },
  { label: "Profile", icon: UserCircle2, to: "/supervisor/profile" }
];

function useCollection(loader, key = "") {
  const loaderRef = useRef(loader);
  const [state, setState] = useState({ rows: [], loading: true, error: "" });
  useEffect(() => {
    loaderRef.current = loader;
  });
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await loaderRef.current();
      setState({ rows: response.data || [], loading: false, error: "" });
    } catch (error) {
      setState({ rows: [], loading: false, error: getErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, key]);

  return { ...state, refresh: load };
}

function SupervisorSidebar() {
  const navigate = useNavigate();
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border px-4 py-4">
        <div className="text-[10px] uppercase tracking-widest text-sidebar-foreground/60">Warehouse Supervisor</div>
        <div className="mt-1 text-sm font-semibold">Supervision Console</div>
      </div>
      <nav className="flex-1 overflow-auto py-2">
        {navigation.map((item) => (
          <div key={item.label} className={item.children ? "py-1" : ""}>
            {item.children ? (
              <>
                <div className="flex items-center gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/60">
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </div>
                {item.children.map((child) => (
                  <NavLink
                    key={child.to}
                    to={child.to}
                    className={({ isActive }) => cn(
                      "relative flex items-center gap-3 px-4 py-2 pl-8 text-xs hover:bg-sidebar-accent",
                      isActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    )}
                  >
                    <child.icon className="h-3.5 w-3.5" />
                    {child.label}
                  </NavLink>
                ))}
              </>
            ) : (
              <NavLink
                to={item.to}
                end={item.to === "/supervisor"}
                className={({ isActive }) => cn(
                  "flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-sidebar-accent",
                  isActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            )}
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate("/");
          }}
          className="flex w-full items-center justify-center gap-2 rounded border border-sidebar-border bg-sidebar-accent px-3 py-2 text-xs font-semibold"
        >
          <LogOut className="h-3.5 w-3.5" />
          Exit
        </button>
      </div>
    </aside>
  );
}

function SupervisorLayout({ children }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex h-14 items-center justify-between bg-header px-5 text-header-foreground shadow-sm">
        <div>
          <div className="text-base font-semibold">Fumba Port WMS</div>
          <div className="text-[11px] text-white/75">Warehouse Supervision</div>
        </div>
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-5 w-5" />
          Warehouse Supervisor
        </div>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <SupervisorSidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

function DashboardPage() {
  const [state, setState] = useState({ data: null, loading: true, error: "" });
  useEffect(() => {
    getSupervisorDashboard()
      .then((response) => setState({ data: response.data, loading: false, error: "" }))
      .catch((error) => setState({ data: null, loading: false, error: getErrorMessage(error) }));
  }, []);
  const metrics = state.data?.metrics || {};

  return (
    <>
      <PageHeader eyebrow="Warehouse Supervisor" title="Supervisor Dashboard" description="Live cargo registration approvals, placement exceptions, occupancy, and dispatch readiness." />
      <div className="flex-1 overflow-auto p-4">
        {state.error && <ErrorState message={state.error} />}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <OperationalStatCard title="Pending Cargo Approvals" icon={ClipboardCheck} loading={state.loading} value={metrics.pending_approvals} emptyTitle="No pending approvals" tone="warning" />
          <OperationalStatCard title="Rejected Placement Attempts" icon={XCircle} loading={state.loading} value={metrics.rejected_placements} emptyTitle="No rejected placements" tone="destructive" />
          <OperationalStatCard title="Stored Cargo Today" icon={CheckCircle2} loading={state.loading} value={metrics.stored_today} emptyTitle="No cargo stored today" tone="success" />
          <OperationalStatCard title="Blocked / Reserved Bins" icon={AlertTriangle} loading={state.loading} value={metrics.blocked_reserved_bins} emptyTitle="No blocked or reserved bins" tone="warning" />
          <OperationalStatCard title="Warehouse Occupancy" icon={Warehouse} loading={state.loading} value={metrics.occupancy_percent} emptyTitle="No occupancy recorded" tone="info" />
          <OperationalStatCard title="Active Staff" icon={Users} loading={state.loading} value={metrics.active_staff} emptyTitle="No active staff sessions" tone="info" />
        </div>
      </div>
    </>
  );
}

function ApprovalsPage({ exceptionsOnly = false }) {
  const approvals = useCollection(
    () => getSupervisorApprovals({
      status: "Pending",
      request_type: exceptionsOnly ? "PLACEMENT_OVERRIDE" : "CARGO_REGISTRATION"
    }),
    exceptionsOnly ? "exceptions" : "pending"
  );
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [reviewApproval, setReviewApproval] = useState(null);
  const [actionMode, setActionMode] = useState("");
  const [actionError, setActionError] = useState("");
  const [reviewConfiguration, setReviewConfiguration] = useState({
    rejection_conditions: [],
    error: ""
  });

  useEffect(() => {
    getSupervisorReviewConfiguration()
      .then((response) => setReviewConfiguration({
        rejection_conditions: response.data?.rejection_conditions || [],
        error: ""
      }))
      .catch((configurationError) => setReviewConfiguration({
        rejection_conditions: [],
        error: getErrorMessage(configurationError)
      }));
  }, []);

  const submitReviewAction = async (payload) => {
    if (!reviewApproval || !actionMode) return;
    setBusyId(`${actionMode}-${reviewApproval.id}`);
    setError("");
    setActionError("");
    try {
      if (actionMode === "approve") {
        await approveSupervisorApproval(reviewApproval.id, payload);
      } else if (actionMode === "reject") {
        await rejectSupervisorApproval(reviewApproval.id, payload);
      } else {
        await requestSupervisorCorrection(reviewApproval.id, payload);
      }
      await approvals.refresh();
      setActionMode("");
      setReviewApproval(null);
    } catch (decisionError) {
      setActionError(getErrorMessage(decisionError));
    } finally {
      setBusyId("");
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Cargo Supervision"
        title={exceptionsOnly ? "Exception Handling" : "Pending Cargo Approvals"}
        description={exceptionsOnly ? "Review requested placement overrides and recorded validation failures." : "Review registration accuracy and compliance independently from warehouse placement activity."}
      />
      <div className="flex-1 overflow-auto p-4">
        {(error || reviewConfiguration.error) && <ErrorState message={error || reviewConfiguration.error} />}
        <SectionCard title={exceptionsOnly ? "Placement Override Requests" : "Cargo Registration Review Queue"} icon={ClipboardCheck}>
          <DataTable
            loading={approvals.loading}
            error={approvals.error}
            rows={approvals.rows}
            emptyTitle="No pending approval requests"
            emptyBody={exceptionsOnly
              ? "Pending placement overrides for your assigned warehouse will appear here."
              : "Pending cargo registrations for your assigned warehouse will appear here."
            }
            columns={[
              { key: "cargo_id", label: "Cargo ID", className: "font-mono font-semibold" },
              { key: "cargo_barcode", label: "Barcode", className: "font-mono" },
              { key: "consignee_name", label: "Consignee" },
              { key: "cargo_type", label: "Cargo Type" },
              { key: "weight", label: "Weight", render: (row) => formatMeasure(row.weight, "kg") },
              { key: "volume", label: "Volume", render: (row) => formatMeasure(row.volume, "m3") },
              { key: "placement_status", label: "Placement", render: (row) => <StatusBadge tone={statusTone(row.placement_status)}>{row.placement_status}</StatusBadge> },
              { key: "container_number", label: "Container", render: (row) => row.container_number || "Not recorded" },
              { key: "registration_date", label: "Registered", render: (row) => formatDateTime(row.registration_date) },
              { key: "registered_by_name", label: "Registered By", render: (row) => row.registered_by_name || row.registered_by_username || "System" },
              {
                key: "supporting_documents",
                label: "Documents",
                render: (row) => row.supporting_documents?.length
                  ? row.supporting_documents.map((document) => document.file_name).join(", ")
                  : "None"
              },
              { key: "inspection_notes", label: "Inspection Notes", render: (row) => row.inspection_notes || "None" },
              {
                key: "actions",
                label: exceptionsOnly ? "Decision" : "Review",
                render: (row) => (
                  <div className="flex gap-2">
                    {exceptionsOnly ? (
                      <>
                        <button
                          disabled={Boolean(busyId)}
                          onClick={() => {
                            setReviewApproval(row);
                            setActionMode("approve");
                            setActionError("");
                          }}
                          className="rounded bg-success px-2 py-1 text-[11px] font-semibold text-success-foreground"
                        >
                          Approve
                        </button>
                        <button
                          disabled={Boolean(busyId)}
                          onClick={() => {
                            setReviewApproval(row);
                            setActionMode("reject");
                            setActionError("");
                          }}
                          className="rounded bg-destructive px-2 py-1 text-[11px] font-semibold text-destructive-foreground"
                        >
                          Reject
                        </button>
                      </>
                    ) : (
                      <button
                        disabled={Boolean(busyId)}
                        onClick={() => {
                          setActionError("");
                          setReviewApproval(row);
                        }}
                        className="rounded border border-info/30 bg-info/10 px-3 py-1.5 text-[11px] font-semibold text-info"
                      >
                        View Cargo
                      </button>
                    )}
                  </div>
                )
              }
            ]}
          />
        </SectionCard>
      </div>
      {!exceptionsOnly && (
          <CargoReviewModal
            open={Boolean(reviewApproval)}
            approval={reviewApproval}
            busy={Boolean(busyId)}
            onClose={() => {
              if (!busyId) {
                setReviewApproval(null);
                setActionMode("");
                setActionError("");
              }
            }}
            onApprove={() => {
              setActionError("");
              setActionMode("approve");
            }}
            onReject={() => {
              setActionError("");
              setActionMode("reject");
            }}
            onRequestCorrection={() => {
              setActionError("");
              setActionMode("correction");
            }}
          />
      )}
      <ReviewActionModal
        open={Boolean(actionMode && reviewApproval)}
        mode={actionMode}
        cargo={reviewApproval}
        busy={Boolean(busyId)}
        apiError={actionError}
        rejectionConditions={reviewConfiguration.rejection_conditions}
        subjectLabel={exceptionsOnly ? "Placement Override" : "Cargo Registration"}
        onClose={() => {
          if (!busyId) {
            setActionMode("");
            setActionError("");
            if (exceptionsOnly) setReviewApproval(null);
          }
        }}
        onSubmit={submitReviewAction}
      />
    </>
  );
}

function ReviewHistoryPage() {
  const history = useCollection(getSupervisorReviewHistory, "my-review-history");

  return (
    <>
      <PageHeader
        eyebrow="Cargo Supervision"
        title="My Review History"
        description="Approval, correction, and rejection actions you performed, including previous warehouse assignments."
      />
      <div className="flex-1 overflow-auto p-4">
        <SectionCard title="Review Actions" icon={Activity}>
          <DataTable
            loading={history.loading}
            error={history.error}
            rows={history.rows}
            emptyTitle="No review history recorded"
            columns={[
              { key: "created_at", label: "Time", render: (row) => formatDateTime(row.created_at || row.performed_at) },
              { key: "cargo_id", label: "Cargo ID", className: "font-mono font-semibold" },
              { key: "cargo_type", label: "Cargo Type" },
              { key: "warehouse", label: "Warehouse", render: (row) => row.warehouse_code || row.warehouse_name || "Previous warehouse" },
              { key: "action", label: "Action", className: "font-mono font-semibold" },
              { key: "registration_status", label: "Registration", render: (row) => <StatusBadge tone={statusTone(row.registration_status)}>{row.registration_status}</StatusBadge> },
              { key: "remarks", label: "Notes", render: (row) => row.remarks || "No notes" }
            ]}
          />
        </SectionCard>
      </div>
    </>
  );
}

function CargoRecordsPage() {
  const cargo = useCollection(() => getCargo({ limit: 500 }), "supervisor-cargo");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    getCargoById(selectedId)
      .then((response) => setDetail(response.data))
      .catch((error) => setDetailError(getErrorMessage(error)));
  }, [selectedId]);

  return (
    <>
      <PageHeader eyebrow="Cargo Supervision" title="Cargo Records" description="Readonly cargo records, approval state, current storage location, and movement history." />
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-3">
          <SectionCard title="Cargo Records" icon={PackageSearch}>
            <DataTable
              loading={cargo.loading}
              error={cargo.error}
              rows={cargo.rows}
              emptyTitle="No cargo records available"
              columns={[
                { key: "cargo_id", label: "Cargo ID", className: "font-mono font-semibold" },
                { key: "consignee_name", label: "Consignee" },
                { key: "cargo_type", label: "Cargo Type" },
                { key: "registration_status", label: "Registration", render: (row) => <StatusBadge tone={statusTone(row.registration_status)}>{row.registration_status}</StatusBadge> },
                { key: "placement_status", label: "Placement Status" },
                {
                  key: "relocation_required",
                  label: "Storage Review",
                  render: (row) => row.relocation_required
                    ? <StatusBadge tone="warning">Relocation Required</StatusBadge>
                    : "Compatible"
                },
                { key: "location", label: "Location", render: (row) => row.location || "Not assigned" },
                { key: "select", label: "Details", render: (row) => <button onClick={() => setSelectedId(row.id)} className="rounded border border-info/30 bg-info/10 px-2 py-1 text-[11px] font-semibold text-info">View</button> }
              ]}
            />
          </SectionCard>
          {detailError && <ErrorState message={detailError} />}
          {detail ? (
            <div className="grid gap-3 xl:grid-cols-2">
              <SectionCard title={`Current Location: ${detail.cargo_id}`} icon={Warehouse}>
                <div className="grid gap-2 sm:grid-cols-2 text-xs">
                  <div>Zone: <strong>{detail.zone_code || "Unassigned"}</strong></div>
                  <div>Rack: <strong>{detail.rack_code || "Unassigned"}</strong></div>
                  <div>Level: <strong>{detail.level_code || "Unassigned"}</strong></div>
                  <div>Bin: <strong>{detail.bin_barcode || "Unassigned"}</strong></div>
                </div>
              </SectionCard>
              <SectionCard title="Movement History" icon={Activity}>
                <DataTable
                  rows={detail.movement_history || []}
                  emptyTitle="No movement history"
                  columns={[
                    { key: "created_at", label: "Time", render: (row) => formatDateTime(row.created_at) },
                    { key: "from_location", label: "From", render: (row) => row.from_location || "Receiving" },
                    { key: "to_location", label: "To", render: (row) => row.to_location || "Not assigned" },
                    { key: "action", label: "Action" }
                  ]}
                />
              </SectionCard>
            </div>
          ) : <EmptyState title="Select a cargo record to view location and movement history" />}
        </div>
      </div>
    </>
  );
}

function PlacementPage() {
  const [state, setState] = useState({ summary: null, loading: true, error: "" });

  useEffect(() => {
    getSupervisorPlacementSummary()
      .then((response) => setState({ summary: response.data || {}, loading: false, error: "" }))
      .catch((error) => setState({ summary: null, loading: false, error: getErrorMessage(error) }));
  }, []);

  const summary = state.summary || {};

  return (
    <>
      <PageHeader eyebrow="Cargo Supervision" title="Placement Monitoring" description="Count-only placement summary for the assigned warehouse. Raw validation records remain restricted to System Administrators." />
      <div className="flex-1 overflow-auto p-4">
        {state.error && <ErrorState message={state.error} />}
        <div className="mb-3">
          <ManualPlacementSetting />
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <OperationalStatCard title="Validation Attempts Today" icon={ScanLine} loading={state.loading} value={summary.validation_attempts_today} emptyTitle="No placement attempts today" tone="info" />
          <OperationalStatCard title="Successful Today" icon={CheckCircle2} loading={state.loading} value={summary.successful_placements_today} emptyTitle="No successful placements today" tone="success" />
          <OperationalStatCard title="Rejected Today" icon={XCircle} loading={state.loading} value={summary.rejected_placements_today} emptyTitle="No rejected placements today" tone="destructive" />
          <OperationalStatCard title="Stored Cargo Today" icon={Warehouse} loading={state.loading} value={summary.stored_cargo_today} emptyTitle="No cargo stored today" tone="success" />
          <OperationalStatCard title="Pending Overrides" icon={ClipboardCheck} loading={state.loading} value={summary.pending_placement_approvals} emptyTitle="No pending placement overrides" tone="warning" />
        </div>
      </div>
    </>
  );
}

const warehouseColumns = {
  occupancy: [
    { key: "zone_code", label: "Zone", render: (row) => `${row.zone_code} - ${row.zone_name}` },
    { key: "status", label: "Status", render: (row) => <StatusBadge tone={statusTone(row.status)}>{row.status || "Active"}</StatusBadge> },
    { key: "bin_total", label: "Total Bins", render: (row) => formatCount(row.bin_total) },
    { key: "available_bins", label: "Available", render: (row) => formatCount(row.available_bins) },
    { key: "occupied_bins", label: "Occupied", render: (row) => formatCount(row.occupied_bins) },
    { key: "blocked_bins", label: "Blocked", render: (row) => formatCount(row.blocked_bins) },
    { key: "reserved_bins", label: "Reserved", render: (row) => formatCount(row.reserved_bins) },
    { key: "weight_occupancy_percent", label: "Weight Used", render: (row) => `${formatMeasure(row.current_weight_capacity, "kg")} / ${formatMeasure(row.max_weight_capacity, "kg")} (${row.weight_occupancy_percent || 0}%)` },
    { key: "volume_occupancy_percent", label: "Volume Used", render: (row) => `${formatMeasure(row.current_volume_capacity, "m3")} / ${formatMeasure(row.max_volume_capacity, "m3")} (${row.volume_occupancy_percent || 0}%)` }
  ],
  zones: [
    { key: "zone_code", label: "Zone Code", className: "font-mono font-semibold" },
    { key: "zone_name", label: "Zone Name" },
    { key: "allowed_cargo_type", label: "Allowed Cargo" },
    { key: "status", label: "Status", render: (row) => <StatusBadge tone={statusTone(row.status)}>{row.status || "Active"}</StatusBadge> },
    { key: "rack_total", label: "Racks", render: (row) => formatCount(row.rack_total) },
    { key: "level_total", label: "Levels", render: (row) => formatCount(row.level_total) },
    { key: "bin_total", label: "Bins", render: (row) => formatCount(row.bin_total) },
    { key: "available_bins", label: "Available Bins", render: (row) => formatCount(row.available_bins) }
  ],
  racks: [
    { key: "rack_path", label: "Rack Location", className: "font-mono font-semibold", render: (row) => `${row.zone_code} / ${row.rack_code}` },
    { key: "zone_name", label: "Zone Name" },
    { key: "status", label: "Status", render: (row) => <StatusBadge tone={statusTone(row.status)}>{row.status || "Active"}</StatusBadge> },
    { key: "level_total", label: "Levels", render: (row) => formatCount(row.level_total) },
    { key: "bin_total", label: "Bins", render: (row) => formatCount(row.bin_total) },
    { key: "available_bins", label: "Available Bins", render: (row) => formatCount(row.available_bins) },
    { key: "capacity", label: "Weight", render: (row) => `${formatMeasure(row.current_weight_capacity, "kg")} / ${formatMeasure(row.max_weight, "kg")}` },
    { key: "volume", label: "Volume", render: (row) => `${formatMeasure(row.current_volume_capacity, "m3")} / ${formatMeasure(row.max_volume, "m3")}` }
  ],
  levels: [
    { key: "level_path", label: "Level Location", className: "font-mono font-semibold", render: (row) => `${row.zone_code} / ${row.rack_code} / ${row.level_code}` },
    { key: "zone_name", label: "Zone Name" },
    { key: "status", label: "Status", render: (row) => <StatusBadge tone={statusTone(row.status)}>{row.status || "Active"}</StatusBadge> },
    { key: "bin_total", label: "Bins", render: (row) => formatCount(row.bin_total) },
    { key: "available_bins", label: "Available Bins", render: (row) => formatCount(row.available_bins) },
    { key: "capacity", label: "Weight", render: (row) => `${formatMeasure(row.current_weight_capacity, "kg")} / ${formatMeasure(row.max_weight, "kg")}` },
    { key: "volume", label: "Volume", render: (row) => `${formatMeasure(row.current_volume_capacity, "m3")} / ${formatMeasure(row.max_volume, "m3")}` }
  ],
  bins: [
    { key: "bin_barcode", label: "Unique Bin Barcode", className: "font-mono font-semibold" },
    { key: "zone_name", label: "Storage Zone", render: (row) => `${row.zone_code} - ${row.zone_name}` },
    { key: "status", label: "Status", render: (row) => <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge> },
    { key: "capacity", label: "Weight", render: (row) => `${formatMeasure(row.current_weight, "kg")} / ${formatMeasure(row.max_weight, "kg")}` },
    { key: "volume", label: "Volume", render: (row) => `${formatMeasure(row.current_volume, "m3")} / ${formatMeasure(row.max_volume, "m3")}` },
    { key: "reserved_for_cargo_type", label: "Reserved For", render: (row) => row.reserved_for_cargo_type || "General use" }
  ]
};

const warehouseRowKey = (scope, row) => {
  if (row.id !== undefined && row.id !== null) return `${scope}:${row.id}`;
  return [
    scope,
    row.zone_id || row.zone_code,
    row.rack_id || row.rack_code,
    row.level_id || row.level_code,
    row.bin_id || row.bin_barcode
  ].filter(Boolean).join(":");
};

function WarehousePage({ scope }) {
  const loaders = {
    zones: getZones,
    occupancy: getZones,
    racks: getAllRacks,
    levels: getAllLevels,
    bins: () => getAllBins({}),
  };
  const data = useCollection(loaders[scope], scope);
  const titles = { zones: "Zones", occupancy: "Occupancy Status", racks: "Racks", levels: "Levels", bins: "Bins" };
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [zoneFilter, setZoneFilter] = useState("All");
  const [rackFilter, setRackFilter] = useState("All");
  const [levelFilter, setLevelFilter] = useState("All");
  const [page, setPage] = useState(1);
  const pageSize = scope === "bins" ? 50 : scope === "levels" ? 30 : 25;

  const uniqueRows = useMemo(() => {
    const seen = new Set();
    return data.rows.filter((row) => {
      const key = warehouseRowKey(scope, row);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [data.rows, scope]);

  const statuses = useMemo(
    () => Array.from(new Set(uniqueRows.map((row) => row.status || "Active"))).sort(),
    [uniqueRows]
  );

  const zoneOptions = useMemo(
    () => Array.from(new Set(uniqueRows.map((row) => row.zone_code).filter(Boolean))).sort(),
    [uniqueRows]
  );

  const rackOptions = useMemo(
    () => Array.from(new Set(
      uniqueRows
        .filter((row) => zoneFilter === "All" || row.zone_code === zoneFilter)
        .map((row) => row.rack_code)
        .filter(Boolean)
    )).sort(),
    [uniqueRows, zoneFilter]
  );

  const levelOptions = useMemo(
    () => Array.from(new Set(
      uniqueRows
        .filter((row) => zoneFilter === "All" || row.zone_code === zoneFilter)
        .filter((row) => rackFilter === "All" || row.rack_code === rackFilter)
        .map((row) => row.level_code)
        .filter(Boolean)
    )).sort((left, right) => Number(left.slice(1)) - Number(right.slice(1))),
    [uniqueRows, zoneFilter, rackFilter]
  );

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return uniqueRows.filter((row) => {
      if (status !== "All" && (row.status || "Active") !== status) return false;
      if (zoneFilter !== "All" && row.zone_code !== zoneFilter) return false;
      if (rackFilter !== "All" && row.rack_code !== rackFilter) return false;
      if (levelFilter !== "All" && row.level_code !== levelFilter) return false;
      if (!term) return true;
      return [
        row.zone_code,
        row.zone_name,
        row.rack_code,
        row.rack_name,
        row.level_code,
        row.bin_code,
        row.bin_barcode,
        row.allowed_cargo_type,
        row.reserved_for_cargo_type
      ].some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [levelFilter, rackFilter, search, status, uniqueRows, zoneFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [levelFilter, rackFilter, scope, search, status, zoneFilter]);

  useEffect(() => {
    setSearch("");
    setStatus("All");
    setZoneFilter("All");
    setRackFilter("All");
    setLevelFilter("All");
  }, [scope]);

  return (
    <>
      <PageHeader eyebrow="Warehouse Monitoring" title={titles[scope]} description="Readonly PostgreSQL-backed warehouse hierarchy and capacity monitoring." />
      <div className="flex-1 overflow-auto p-4">
        <SectionCard title={titles[scope]} icon={Warehouse}>
          <div className="mb-3 flex flex-wrap items-end gap-3 rounded border border-border bg-muted/20 p-3">
            <label className="min-w-64 flex-1 text-[11px] font-semibold text-muted-foreground">
              Search
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${titles[scope].toLowerCase()} by code or name`}
                className="mt-1 h-9 w-full rounded border border-input bg-background px-3 text-xs font-normal text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="w-44 text-[11px] font-semibold text-muted-foreground">
              Status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="mt-1 h-9 w-full rounded border border-input bg-background px-3 text-xs font-normal text-foreground outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="All">All statuses</option>
                {statuses.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            {["racks", "levels", "bins"].includes(scope) && (
              <label className="w-36 text-[11px] font-semibold text-muted-foreground">
                Zone
                <select
                  value={zoneFilter}
                  onChange={(event) => {
                    setZoneFilter(event.target.value);
                    setRackFilter("All");
                    setLevelFilter("All");
                  }}
                  className="mt-1 h-9 w-full rounded border border-input bg-background px-3 text-xs font-normal text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="All">All zones</option>
                  {zoneOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            )}
            {["levels", "bins"].includes(scope) && (
              <label className="w-36 text-[11px] font-semibold text-muted-foreground">
                Rack
                <select
                  value={rackFilter}
                  onChange={(event) => {
                    setRackFilter(event.target.value);
                    setLevelFilter("All");
                  }}
                  className="mt-1 h-9 w-full rounded border border-input bg-background px-3 text-xs font-normal text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="All">All racks</option>
                  {rackOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            )}
            {scope === "bins" && (
              <label className="w-36 text-[11px] font-semibold text-muted-foreground">
                Level
                <select
                  value={levelFilter}
                  onChange={(event) => setLevelFilter(event.target.value)}
                  className="mt-1 h-9 w-full rounded border border-input bg-background px-3 text-xs font-normal text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="All">All levels</option>
                  {levelOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            )}
            <div className="pb-2 text-xs text-muted-foreground">
              {filteredRows.length} unique {titles[scope].toLowerCase()}
            </div>
          </div>
          <DataTable
            loading={data.loading}
            error={data.error}
            rows={visibleRows}
            emptyTitle={`No ${titles[scope].toLowerCase()} available`}
            columns={warehouseColumns[scope]}
          />
          {!data.loading && !data.error && filteredRows.length > pageSize && (
            <div className="mt-3 flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">
                Showing {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, filteredRows.length)} of {filteredRows.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  className="rounded border border-border px-3 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <span>Page {currentPage} of {pageCount}</span>
                <button
                  type="button"
                  disabled={currentPage === pageCount}
                  onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                  className="rounded border border-border px-3 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}

function DispatchPage({ approved = false }) {
  const requests = useCollection(
    () => getDispatchAuthorizationRequests({ status: approved ? "Approved" : "Pending" }),
    approved ? "dispatch-approved" : "dispatch-pending"
  );
  const [error, setError] = useState("");
  const [decisionState, setDecisionState] = useState({ row: null, decision: "" });
  const [decisionError, setDecisionError] = useState("");
  const [busy, setBusy] = useState(false);

  const decide = async (payload) => {
    if (!decisionState.row || !decisionState.decision) return;
    setBusy(true);
    setDecisionError("");
    try {
      if (decisionState.decision === "approve") {
        await approveDispatchAuthorization(decisionState.row.id, payload);
      } else {
        await rejectDispatchAuthorization(decisionState.row.id, payload);
      }
      await requests.refresh();
      setDecisionState({ row: null, decision: "" });
    } catch (submitError) {
      setDecisionError(getErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Dispatch Authorization" title={approved ? "Approved Dispatch" : "Dispatch Requests"} description="Supervisor authorization before cargo becomes ready for gate release." />
      <div className="flex-1 overflow-auto p-4">
        {error && <ErrorState message={error} />}
        <SectionCard title={approved ? "Approved Dispatch" : "Pending Dispatch Requests"} icon={Truck}>
          <DataTable
            loading={requests.loading}
            error={requests.error}
            rows={requests.rows}
            emptyTitle={approved ? "No approved dispatch requests" : "No pending dispatch requests"}
            columns={[
              { key: "created_at", label: "Requested", render: (row) => formatDateTime(row.created_at) },
              { key: "cargo_id", label: "Cargo", className: "font-mono font-semibold" },
              { key: "consignee_name", label: "Consignee" },
              { key: "location", label: "Location" },
              { key: "requested_by_name", label: "Requested By" },
              { key: "status", label: "Status", render: (row) => <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge> },
              ...(!approved ? [{
                key: "actions",
                label: "Decision",
                render: (row) => (
                  <div className="flex gap-2">
                    <button onClick={() => setDecisionState({ row, decision: "approve" })} className="rounded bg-success px-2 py-1 text-[11px] font-semibold text-success-foreground">Approve</button>
                    <button onClick={() => setDecisionState({ row, decision: "reject" })} className="rounded bg-destructive px-2 py-1 text-[11px] font-semibold text-destructive-foreground">Reject</button>
                  </div>
                )
              }] : [])
            ]}
          />
        </SectionCard>
      </div>
      <DecisionNotesModal
        open={Boolean(decisionState.row)}
        decision={decisionState.decision}
        subject={decisionState.row ? {
          label: "Dispatch Authorization",
          cargo_id: decisionState.row.cargo_id
        } : null}
        busy={busy}
        apiError={decisionError}
        onClose={() => {
          if (!busy) {
            setDecisionState({ row: null, decision: "" });
            setDecisionError("");
          }
        }}
        onSubmit={decide}
      />
    </>
  );
}

function ProfilePage() {
  const [state, setState] = useState({ profile: null, loading: true, error: "" });
  useEffect(() => {
    getProfile()
      .then((response) => setState({ profile: response.data?.user, loading: false, error: "" }))
      .catch((error) => setState({ profile: null, loading: false, error: getErrorMessage(error) }));
  }, []);
  return (
    <>
      <PageHeader eyebrow="Profile" title="Warehouse Supervisor Profile" description="Current role, warehouse assignment, and shift context." />
      <div className="flex-1 overflow-auto p-4">
        <SectionCard title="Supervisor Assignment" icon={UserCircle2}>
          {state.loading ? <LoadingState /> : state.error ? <ErrorState message={state.error} /> : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-xs">
              <div className="rounded border p-3"><div className="text-muted-foreground">Name</div><div className="mt-1 font-semibold">{state.profile?.full_name}</div></div>
              <div className="rounded border p-3"><div className="text-muted-foreground">Role</div><div className="mt-1 font-semibold">Warehouse Supervisor</div></div>
              <div className="rounded border p-3"><div className="text-muted-foreground">Warehouse</div><div className="mt-1 font-semibold">{state.profile?.warehouse_name || "Not assigned"}</div></div>
              <div className="rounded border p-3"><div className="text-muted-foreground">Shift</div><div className="mt-1 font-semibold">{state.profile?.shift_name || "Not assigned"}</div></div>
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}

function SupervisorPortal() {
  return (
    <SupervisorLayout>
      <Routes>
        <Route index element={<DashboardPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="cargo/pending-approvals" element={<ApprovalsPage />} />
        <Route path="cargo/review-history" element={<ReviewHistoryPage />} />
        <Route path="cargo/records" element={<CargoRecordsPage />} />
        <Route path="cargo/placement-monitoring" element={<PlacementPage />} />
        <Route path="cargo/exceptions" element={<ApprovalsPage exceptionsOnly />} />
        <Route path="warehouse/occupancy" element={<WarehousePage scope="occupancy" />} />
        <Route path="warehouse/zones" element={<WarehousePage scope="zones" />} />
        <Route path="warehouse/racks" element={<WarehousePage scope="racks" />} />
        <Route path="warehouse/levels" element={<WarehousePage scope="levels" />} />
        <Route path="warehouse/bins" element={<WarehousePage scope="bins" />} />
        <Route path="dispatch/requests" element={<DispatchPage />} />
        <Route path="dispatch/approved" element={<DispatchPage approved />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/supervisor" replace />} />
      </Routes>
    </SupervisorLayout>
  );
}

export default SupervisorPortal;

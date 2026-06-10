import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Anchor,
  Ban,
  Box,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  DoorOpen,
  Edit,
  Eye,
  FileWarning,
  Filter,
  HelpCircle,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Loader2,
  LockKeyhole,
  LogOut,
  PackageCheck,
  PackageSearch,
  Plus,
  Power,
  RefreshCw,
  Rows3,
  Ruler,
  ScanLine,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  SquareStack,
  Trash2,
  Truck,
  UserCircle2,
  UserPlus,
  Users,
  Warehouse,
  X
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
import { cn } from "@/lib/utils";
import {
  formatCount,
  formatDateTime,
  formatMeasure,
  getErrorMessage,
  statusTone
} from "@/lib/wms-operational";
import {
  createUser,
  deleteUser,
  getAuditLogs,
  getBins,
  getCargo,
  getLevels,
  getPlacementLogs,
  getRacks,
  getRoles,
  getShifts,
  getUserSessions,
  getUsers,
  getWarehouses,
  getZones,
  logout,
  updateUser
} from "@/services/api";

const inputClass =
  "h-9 w-full rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

const adminRoles = [
  "System Admin",
  "Warehouse Staff",
  "Supervisor",
  "Customs Officer",
  "Billing Officer"
];

const shiftNames = ["Morning Shift", "Evening Shift", "Night Shift"];

const cargoStatuses = [
  "Registered",
  "Pending Placement",
  "Stored",
  "Blocked",
  "Released"
];

const adminNavigation = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/admin" },
  {
    label: "System Management",
    icon: Settings,
    children: [
      { label: "Users", icon: Users, to: "/admin/system/users" },
      { label: "Roles & Permissions", icon: ShieldCheck, to: "/admin/system/roles-permissions" },
      { label: "Shift Assignment", icon: CalendarClock, to: "/admin/system/shift-assignment" },
      { label: "Warehouse Assignment", icon: Warehouse, to: "/admin/system/warehouse-assignment" }
    ]
  },
  {
    label: "Warehouse Configuration",
    icon: Warehouse,
    children: [
      { label: "Zones", icon: Boxes, to: "/admin/warehouse/zones" },
      { label: "Racks", icon: Rows3, to: "/admin/warehouse/racks" },
      { label: "Levels", icon: SquareStack, to: "/admin/warehouse/levels" },
      { label: "Bins", icon: Box, to: "/admin/warehouse/bins" },
      { label: "Bin Rules", icon: ListChecks, to: "/admin/warehouse/bin-rules" },
      { label: "Capacity Configuration", icon: Ruler, to: "/admin/warehouse/capacity-configuration" }
    ]
  },
  {
    label: "Cargo Oversight",
    icon: PackageSearch,
    children: [
      { label: "Cargo Records", icon: ClipboardList, to: "/admin/cargo/records" },
      { label: "Placement Monitoring", icon: ClipboardCheck, to: "/admin/cargo/placement-monitoring" },
      { label: "Cargo Tracking", icon: Search, to: "/admin/cargo/tracking" },
      { label: "Blocked Cargo", icon: Ban, to: "/admin/cargo/blocked" }
    ]
  },
  {
    label: "Dispatch Oversight",
    icon: Truck,
    children: [
      { label: "Dispatch Queue", icon: ClipboardList, to: "/admin/dispatch/queue" },
      { label: "Released Cargo", icon: PackageCheck, to: "/admin/dispatch/released" },
      { label: "Gate Activity", icon: DoorOpen, to: "/admin/dispatch/gate-activity" }
    ]
  },
  {
    label: "Operational Review",
    icon: Activity,
    children: [
      { label: "Validation Logs", icon: FileWarning, to: "/admin/monitoring/validation-logs" }
    ]
  },
  {
    label: "Audit & Security",
    icon: Shield,
    children: [
      { label: "Audit Logs", icon: ClipboardList, to: "/admin/audit/logs" },
      { label: "User Activity", icon: Activity, to: "/admin/audit/user-activity" },
      { label: "Login Sessions", icon: LockKeyhole, to: "/admin/audit/login-sessions" },
      { label: "Security Events", icon: AlertTriangle, to: "/admin/audit/security-events" }
    ]
  },
  { label: "Profile", icon: UserCircle2, to: "/admin/profile" }
];

const permissionRows = [
  {
    module: "System Configuration",
    systemAdmin: "Full access",
    warehouseStaff: "No access",
    supervisor: "Read only",
    customsOfficer: "No access",
    billingOfficer: "No access"
  },
  {
    module: "User Management",
    systemAdmin: "Create, update, activate, deactivate",
    warehouseStaff: "No access",
    supervisor: "Read assigned team",
    customsOfficer: "No access",
    billingOfficer: "No access"
  },
  {
    module: "Cargo Operations",
    systemAdmin: "Full oversight",
    warehouseStaff: "Cargo registration, placement scanning, cargo tracking",
    supervisor: "Read, approve exceptions",
    customsOfficer: "Inspection review",
    billingOfficer: "Release documentation review"
  },
  {
    module: "Warehouse Structure",
    systemAdmin: "Configure zones, racks, levels, bins",
    warehouseStaff: "Read storage structure",
    supervisor: "Read storage structure",
    customsOfficer: "Read restricted zones",
    billingOfficer: "No access"
  },
  {
    module: "Dispatch Oversight",
    systemAdmin: "Full oversight",
    warehouseStaff: "Dispatch preparation",
    supervisor: "Dispatch review",
    customsOfficer: "Customs clearance review",
    billingOfficer: "Release readiness review"
  },
  {
    module: "Audit & Security",
    systemAdmin: "Read audit and security events",
    warehouseStaff: "No access",
    supervisor: "Read team activity",
    customsOfficer: "Read own sessions",
    billingOfficer: "Read own sessions"
  }
];

const binRuleCards = [
  {
    title: "Hazardous Cargo Rules",
    body: "Define which zones can accept hazardous classes and which cargo types must be rejected from standard storage."
  },
  {
    title: "Weight Limits",
    body: "Configure maximum cargo weight per zone, rack, level, and bin before placement validation approves storage."
  },
  {
    title: "Volume Limits",
    body: "Configure volume ceilings used by placement validation to prevent over-capacity bin assignment."
  },
  {
    title: "Compatible Cargo Types",
    body: "Set cargo-type compatibility rules for reserved storage areas and specialist handling locations."
  },
  {
    title: "Restricted Zones",
    body: "Mark controlled or blocked storage areas that should reject scanner placement attempts."
  }
];

function readValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function readNumber(record, keys) {
  const value = readValue(record, keys);
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function cargoOperationalStatus(record) {
  if (record?.status === "Registered" && !record.current_bin_id && !record.location) return "Pending Placement";
  return record?.status || "No status";
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
  const maxWeight = readValue(record, ["max_weight_capacity", "max_weight", "max_weight_capacity"]);
  const currentVolume = readValue(record, ["current_volume_capacity", "current_volume"]);
  const maxVolume = readValue(record, ["max_volume_capacity", "max_volume"]);

  if (!currentWeight && !maxWeight && !currentVolume && !maxVolume) return "No capacity data";

  return (
    <div className="space-y-0.5">
      <div>{formatMeasure(currentWeight, "kg")} / {formatMeasure(maxWeight, "kg")}</div>
      <div className="text-muted-foreground">{formatMeasure(currentVolume, "m3")} / {formatMeasure(maxVolume, "m3")}</div>
    </div>
  );
}

const accountStatuses = ["active", "inactive", "suspended"];

function accountStatusTone(status) {
  if (status === "active") return "success";
  if (status === "inactive") return "muted";
  if (status === "suspended") return "destructive";
  return "warning";
}

function formatAccountStatus(status) {
  if (!status) return "Not recorded";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatShiftHours(shift) {
  if (!shift?.start_time || !shift?.end_time) return "";
  return `${String(shift.start_time).slice(0, 5)}-${String(shift.end_time).slice(0, 5)}`;
}

function userMatchesSearch(user, searchTerm) {
  if (!searchTerm) return true;
  const search = searchTerm.toLowerCase();
  return [
    user.full_name,
    user.username,
    user.email,
    user.phone_number,
    user.role_name,
    user.warehouse_name,
    user.warehouse_code,
    user.shift_name
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(search));
}

function useApiCollection(loader, dependencyKey = "default") {
  const loaderRef = useRef(loader);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const response = await loaderRef.current();
        if (active) setRows(response.data || []);
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
  }, [dependencyKey]);

  return { rows, loading, error };
}

function isItemActive(location, item) {
  if (item.to === "/admin") return location.pathname === "/admin" || location.pathname === "/admin/dashboard";
  if (item.to) return location.pathname === item.to;
  return item.children?.some((child) => location.pathname === child.to);
}

function getActiveSectionLabel(location) {
  const section = adminNavigation.find((item) => item.children?.some((child) => isItemActive(location, child)));
  return section?.label || "";
}

function AdminNavItem({ item, nested = false, openSection, setOpenSection }) {
  const location = useLocation();
  const Icon = item.icon;
  const active = isItemActive(location, item);

  if (item.children) {
    const open = openSection === item.label;

    return (
      <div className="rounded-md">
        <button
          type="button"
          onClick={() => setOpenSection(open ? "" : item.label)}
          aria-expanded={open}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[11px] font-semibold uppercase text-sidebar-foreground/65 transition-colors",
            "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            active && "bg-sidebar-accent/60 text-sidebar-accent-foreground"
          )}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <div className="mt-0.5 space-y-0.5 pb-0.5">
            {item.children.map((child) => (
              <AdminNavItem key={child.label} item={child} nested />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.to === "/admin"}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          nested && "ml-4 py-1.5 pl-3 text-xs",
          (isActive || active) && "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
        )
      }
    >
      {active && <span className="absolute bottom-1 left-0 top-1 w-0.5 rounded-full bg-sidebar-primary" />}
      <Icon className={cn("shrink-0", nested ? "h-3.5 w-3.5" : "h-4 w-4")} />
      <span className="min-w-0 truncate">{item.label}</span>
    </NavLink>
  );
}

function AdminSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [openSection, setOpenSection] = useState(() => getActiveSectionLabel(location));

  useEffect(() => {
    setOpenSection(getActiveSectionLabel(location));
  }, [location]);

  return (
    <aside className="sticky top-0 flex h-full w-64 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border px-3 py-3">
        <div className="text-[10px] uppercase tracking-widest text-sidebar-foreground/60">System Administrator</div>
        <div className="mt-1 text-sm font-semibold">WMS Control Console</div>
      </div>
      <nav className="min-h-0 flex-1 space-y-1 overflow-hidden px-2 py-2">
        {adminNavigation.map((item) => (
          <AdminNavItem
            key={item.label}
            item={item}
            openSection={openSection}
            setOpenSection={setOpenSection}
          />
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-2.5">
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate("/");
          }}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent px-3 py-2 text-xs font-semibold text-sidebar-accent-foreground transition hover:bg-sidebar-accent/80"
          aria-label="Exit system administrator console"
        >
          <LogOut className="h-3.5 w-3.5" />
          Exit
        </button>
        <div className="mt-2 px-1 text-[10px] text-sidebar-foreground/60">Fumba Port WMS</div>
      </div>
    </aside>
  );
}

function AdminHeader() {
  return (
    <header className="flex min-h-14 items-center justify-between gap-3 bg-header px-5 py-2 text-header-foreground shadow-sm">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/15">
          <Anchor className="h-5 w-5" />
        </div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-base font-semibold">Fumba Port WMS</div>
          <div className="truncate text-[11px] text-white/75">System Administration Console</div>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <button
          className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-white/10"
          aria-label="Help"
        >
          <HelpCircle className="h-4 w-4" />
          <span className="hidden sm:inline">Help</span>
        </button>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-white/10"
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
        <div className="flex min-w-0 items-center gap-2 border-l border-white/20 pl-3">
          <UserCircle2 className="h-7 w-7 shrink-0" />
          <div className="hidden min-w-0 leading-tight text-right sm:block">
            <div className="truncate text-sm font-medium">System Admin</div>
            <div className="truncate text-[11px] text-white/75">Administrator</div>
          </div>
        </div>
      </div>
    </header>
  );
}

function AdminLayout({ children }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <AdminHeader />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AdminSidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

function ToolbarButton({ icon: Icon, children, variant = "primary", disabled, onClick, type = "button" }) {
  const classes = {
    primary: "bg-info text-info-foreground hover:opacity-90",
    secondary: "border border-border bg-secondary text-secondary-foreground hover:bg-muted",
    warning: "bg-warning text-warning-foreground hover:opacity-90",
    destructive: "bg-destructive text-destructive-foreground hover:opacity-90"
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 rounded px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        classes[variant]
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

function FormField({ label, children }) {
  return (
    <label className="space-y-1.5">
      <span className="block text-[11px] font-semibold text-foreground/80">{label}</span>
      {children}
    </label>
  );
}

function SelectField({ value, onChange, children, disabled, ...props }) {
  const selectProps = value !== undefined ? { value } : {};

  return (
    <select
      className={inputClass}
      {...selectProps}
      onChange={(event) => onChange?.(event.target.value)}
      disabled={disabled}
      {...props}
    >
      {children}
    </select>
  );
}

function Drawer({ open, title, children, onClose }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
      <div className="h-full w-full max-w-xl overflow-auto border-l border-border bg-card shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-panel-header px-4 py-3 text-panel-header-foreground">
          <div className="text-sm font-semibold">{title}</div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-background/60" aria-label="Close panel">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function ActionPlaceholder({ title, body }) {
  return (
    <div className="rounded border border-dashed border-border bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
      <div className="font-semibold text-foreground">{title}</div>
      <div className="mt-1">{body}</div>
    </div>
  );
}

function SkeletonBlock({ label = "Loading system data..." }) {
  return (
    <div className="rounded border border-border bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-info" />
        {label}
      </div>
      <div className="mt-3 space-y-2">
        <div className="h-2.5 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

function DashboardPage() {
  const cargo = useApiCollection(() => getCargo(), "cargo-all");
  const logs = useApiCollection(() => getPlacementLogs(), "placement-logs");
  const zones = useApiCollection(() => getZones(), "zones");
  const users = useApiCollection(() => getUsers({ status: "active" }), "active-users");

  const activeOperations = useMemo(
    () => cargo.rows.filter((record) => record.status !== "Released"),
    [cargo.rows]
  );
  const placementQueue = useMemo(
    () => cargo.rows.filter((record) => cargoOperationalStatus(record) === "Pending Placement"),
    [cargo.rows]
  );
  const recentActivity = useMemo(() => logs.rows.slice(0, 5), [logs.rows]);
  const statusRows = useMemo(
    () => cargoStatuses.map((status) => ({
      status,
      count: cargo.rows.filter((record) => cargoOperationalStatus(record) === status).length
    })),
    [cargo.rows]
  );

  return (
    <>
      <PageHeader
        eyebrow="System Administrator"
        title="System Supervision Dashboard"
        description="Operational overview for warehouse activity, storage readiness, users, and cargo oversight."
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
          <OperationalStatCard
            title="Active Warehouse Operations"
            icon={Warehouse}
            loading={cargo.loading}
            error={cargo.error}
            value={activeOperations.length}
            emptyTitle="No active operations loaded"
            emptyBody="Operational cargo activity will appear as records are created."
            tone="info"
          />
          <OperationalStatCard
            title="Storage Occupancy Summary"
            icon={Boxes}
            loading={zones.loading}
            error={zones.error}
            value={zones.rows.length}
            emptyTitle="No warehouse hierarchy loaded"
            emptyBody="Zone occupancy will appear when storage areas are configured."
            tone="success"
          />
          <section className="rounded-md border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-muted-foreground">Active Accounts</div>
                {users.loading ? (
                  <div className="mt-3"><SkeletonBlock label="Loading accounts..." /></div>
                ) : users.error ? (
                  <div className="mt-3"><ErrorState message={users.error} /></div>
                ) : users.rows.length ? (
                  <div className="mt-2 text-2xl font-semibold leading-none">{users.rows.length.toLocaleString()}</div>
                ) : (
                  <div className="mt-3"><EmptyState icon={Users} title="No active accounts" /></div>
                )}
              </div>
              <div className="rounded-md border border-warning/25 bg-warning/10 p-2 text-warning">
                <Users className="h-4 w-4" />
              </div>
            </div>
          </section>
          <OperationalStatCard
            title="Placement Validation Queue"
            icon={ClipboardCheck}
            loading={cargo.loading}
            error={cargo.error}
            value={placementQueue.length}
            emptyTitle="No placement queue loaded"
            emptyBody="Pending placement cargo will appear when registered cargo awaits storage."
            tone="warning"
          />
          <section className="rounded-md border border-border bg-card p-3">
            <div className="text-xs font-semibold text-muted-foreground">Cargo Status Overview</div>
            {cargo.loading ? (
              <div className="mt-3"><SkeletonBlock label="Loading cargo statuses..." /></div>
            ) : cargo.error ? (
              <div className="mt-3"><ErrorState message={cargo.error} /></div>
            ) : cargo.rows.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {statusRows.map((row) => (
                  <StatusBadge key={row.status} tone={statusTone(row.status)}>
                    {row.status}: {row.count}
                  </StatusBadge>
                ))}
              </div>
            ) : (
              <div className="mt-3">
                <EmptyState icon={PackageSearch} title="No cargo records loaded" />
              </div>
            )}
          </section>
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1fr]">
          <SectionCard title="Recent Activity" icon={Activity}>
            <DataTable
              loading={logs.loading}
              error={logs.error}
              rows={recentActivity}
              emptyTitle="No recent activity"
              emptyBody="Validation and scanner events will appear as work is recorded."
              columns={[
                { key: "created_at", label: "Time", render: (row) => formatDateTime(row.created_at), className: "font-mono text-muted-foreground" },
                { key: "result", label: "Result", render: (row) => <StatusBadge tone={row.approved ? "success" : "destructive"}>{row.approved ? "Validation Passed" : "Validation Failed"}</StatusBadge> },
                { key: "reason", label: "Event", render: (row) => row.reason || "No event reason" },
                { key: "detail", label: "Detail", render: (row) => row.detail || "No detail recorded" }
              ]}
            />
          </SectionCard>
          <SectionCard title="Storage Occupancy Summary" icon={Warehouse}>
            <DataTable
              loading={zones.loading}
              error={zones.error}
              rows={zones.rows}
              emptyTitle="No storage occupancy records"
              emptyBody="Warehouse hierarchy and capacity records will appear when storage areas are configured."
              columns={[
                { key: "zone", label: "Zone", render: (row) => getZoneLabel(row), className: "font-mono font-semibold" },
                { key: "occupancy", label: "Occupancy", render: (row) => formatOccupancy(row) },
                { key: "available_bins", label: "Available Bins", render: (row) => formatCount(row.available_bins) },
                { key: "blocked_bins", label: "Blocked Bins", render: (row) => formatCount(row.blocked_bins) },
                { key: "reserved_bins", label: "Reserved Bins", render: (row) => formatCount(row.reserved_bins) }
              ]}
            />
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function UsersPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("All roles");
  const [warehouseFilter, setWarehouseFilter] = useState("All warehouses");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [drawerMode, setDrawerMode] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionError, setActionError] = useState("");
  const [busyUserId, setBusyUserId] = useState("");
  const users = useApiCollection(() => getUsers(), `users-${refreshKey}`);
  const roles = useApiCollection(() => getRoles(), "roles");
  const warehouses = useApiCollection(() => getWarehouses(), "warehouses");
  const shifts = useApiCollection(() => getShifts(), "shifts");

  const filteredUsers = useMemo(() => {
    return users.rows.filter((user) => {
      const roleMatch = roleFilter === "All roles" || String(user.role_id) === roleFilter;
      const warehouseMatch = warehouseFilter === "All warehouses" || String(user.warehouse_id || "") === warehouseFilter;
      const statusMatch = statusFilter === "All statuses" || user.status === statusFilter;
      return userMatchesSearch(user, searchTerm) && roleMatch && warehouseMatch && statusMatch;
    });
  }, [roleFilter, searchTerm, statusFilter, users.rows, warehouseFilter]);

  const refreshUsers = () => setRefreshKey((current) => current + 1);

  const openCreateDrawer = () => {
    setSelectedUser(null);
    setActionError("");
    setDrawerMode("create");
  };

  const openEditDrawer = (user) => {
    setSelectedUser(user);
    setActionError("");
    setDrawerMode("edit");
  };

  const closeDrawer = () => {
    setDrawerMode("");
    setSelectedUser(null);
  };

  const saveUser = async (payload, userId) => {
    const response = userId ? await updateUser(userId, payload) : await createUser(payload);
    closeDrawer();
    refreshUsers();
    return response;
  };

  const toggleUserStatus = async (user) => {
    const nextStatus = user.status === "active" ? "inactive" : "active";
    setBusyUserId(`status-${user.id}`);
    setActionError("");

    try {
      await updateUser(user.id, { status: nextStatus });
      refreshUsers();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusyUserId("");
    }
  };

  const removeUserAccount = async (user) => {
    if (!window.confirm(`Delete ${user.full_name || user.username}?`)) return;

    setBusyUserId(`delete-${user.id}`);
    setActionError("");

    try {
      await deleteUser(user.id);
      refreshUsers();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusyUserId("");
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="System Management"
        title="Users"
        description="Create, update, activate, deactivate, and remove administrative and warehouse staff accounts."
        action={
          <div className="flex flex-wrap gap-2">
            <ToolbarButton icon={RefreshCw} variant="secondary" onClick={refreshUsers}>Refresh</ToolbarButton>
            <ToolbarButton icon={UserPlus} onClick={openCreateDrawer}>Create User</ToolbarButton>
          </div>
        }
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-3">
          {actionError && <ErrorState message={actionError} />}
          <SectionCard title="User Filters" icon={Filter}>
            <div className="grid gap-3 md:grid-cols-4">
              <FormField label="Search users">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input className={cn(inputClass, "pl-8")} value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Name, username, email, phone" />
                </div>
              </FormField>
              <FormField label="Filter by role">
                <SelectField value={roleFilter} onChange={setRoleFilter}>
                  <option>All roles</option>
                  {roles.rows.map((role) => <option key={role.id} value={String(role.id)}>{role.role_name}</option>)}
                </SelectField>
              </FormField>
              <FormField label="Filter by warehouse">
                <SelectField value={warehouseFilter} onChange={setWarehouseFilter}>
                  <option>All warehouses</option>
                  {warehouses.rows.map((warehouse) => (
                    <option key={warehouse.id} value={String(warehouse.id)}>
                      {warehouse.warehouse_code} - {warehouse.warehouse_name}
                    </option>
                  ))}
                </SelectField>
              </FormField>
              <FormField label="Filter by status">
                <SelectField value={statusFilter} onChange={setStatusFilter}>
                  <option>All statuses</option>
                  {accountStatuses.map((status) => <option key={status} value={status}>{formatAccountStatus(status)}</option>)}
                </SelectField>
              </FormField>
            </div>
          </SectionCard>
          <SectionCard title="Users Table" icon={Users}>
            <DataTable
              loading={users.loading}
              error={users.error}
              rows={filteredUsers}
              emptyTitle="No users loaded"
              emptyBody="Create a user or clear the filters to see account records."
              columns={[
                { key: "full_name", label: "Full Name", className: "font-semibold" },
                { key: "username", label: "Username", className: "font-mono text-muted-foreground" },
                { key: "email", label: "Email" },
                { key: "phone_number", label: "Phone Number" },
                { key: "role", label: "Role", render: (row) => row.role_name || "No role" },
                {
                  key: "assigned_warehouse",
                  label: "Assigned Warehouse",
                  render: (row) => row.warehouse_code ? `${row.warehouse_code} - ${row.warehouse_name}` : "All warehouses"
                },
                { key: "assigned_shift", label: "Assigned Shift", render: (row) => row.shift_name || "No shift" },
                {
                  key: "account_status",
                  label: "Account Status",
                  render: (row) => <StatusBadge tone={accountStatusTone(row.status)}>{formatAccountStatus(row.status)}</StatusBadge>
                },
                { key: "last_login", label: "Last Login", render: (row) => formatDateTime(row.last_login) },
                {
                  key: "actions",
                  label: "Actions",
                  render: (row) => (
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditDrawer(row)}
                        className="inline-flex h-8 items-center gap-1 rounded border border-border bg-secondary px-2 text-[11px] font-semibold hover:bg-muted"
                      >
                        <Edit className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleUserStatus(row)}
                        disabled={busyUserId === `status-${row.id}`}
                        className="inline-flex h-8 items-center gap-1 rounded border border-warning/35 bg-warning/10 px-2 text-[11px] font-semibold text-warning hover:bg-warning/20 disabled:opacity-50"
                      >
                        {busyUserId === `status-${row.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                        {row.status === "active" ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeUserAccount(row)}
                        disabled={busyUserId === `delete-${row.id}`}
                        className="inline-flex h-8 items-center gap-1 rounded border border-destructive/35 bg-destructive/10 px-2 text-[11px] font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-50"
                      >
                        {busyUserId === `delete-${row.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        Delete
                      </button>
                    </div>
                  )
                }
              ]}
            />
          </SectionCard>
        </div>
      </div>

      <Drawer open={drawerMode === "create" || drawerMode === "edit"} title={drawerMode === "edit" ? "Edit User" : "Create User"} onClose={closeDrawer}>
        <UserForm
          mode={drawerMode}
          user={selectedUser}
          roles={roles.rows}
          warehouses={warehouses.rows}
          shifts={shifts.rows}
          referenceLoading={roles.loading || warehouses.loading || shifts.loading}
          onCancel={closeDrawer}
          onSave={saveUser}
        />
      </Drawer>
    </>
  );
}

function UserForm({ mode, user, roles, warehouses, shifts, referenceLoading, onCancel, onSave }) {
  const [form, setForm] = useState({
    full_name: "",
    username: "",
    email: "",
    phone_number: "",
    role_id: "",
    warehouse_id: "",
    shift_id: "",
    status: "active",
    password: ""
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    setForm({
      full_name: user?.full_name || "",
      username: user?.username || "",
      email: user?.email || "",
      phone_number: user?.phone_number || "",
      role_id: user?.role_id ? String(user.role_id) : "",
      warehouse_id: user?.warehouse_id ? String(user.warehouse_id) : "",
      shift_id: user?.shift_id ? String(user.shift_id) : "",
      status: user?.status || "active",
      password: ""
    });
    setFormError("");
  }, [user, mode]);

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");

    const payload = {
      full_name: form.full_name,
      username: form.username,
      email: form.email,
      phone_number: form.phone_number,
      role_id: form.role_id,
      warehouse_id: form.warehouse_id,
      shift_id: form.shift_id,
      status: form.status
    };

    if (form.password) {
      payload.password = form.password;
    }

    try {
      await onSave(payload, user?.id);
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      {formError && <ErrorState message={formError} />}
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label="Full Name">
          <input className={inputClass} value={form.full_name} onChange={(event) => updateField("full_name", event.target.value)} placeholder="Full name" required />
        </FormField>
        <FormField label="Username">
          <input className={inputClass} value={form.username} onChange={(event) => updateField("username", event.target.value)} placeholder="Username" required />
        </FormField>
        <FormField label="Email">
          <input className={inputClass} type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} placeholder="Email address" required />
        </FormField>
        <FormField label="Phone Number">
          <input className={inputClass} value={form.phone_number} onChange={(event) => updateField("phone_number", event.target.value)} placeholder="Phone number" required />
        </FormField>
        <FormField label="Role">
          <SelectField value={form.role_id} onChange={(value) => updateField("role_id", value)} required disabled={referenceLoading}>
            <option value="">Select role</option>
            {roles.map((role) => <option key={role.id} value={String(role.id)}>{role.role_name}</option>)}
          </SelectField>
        </FormField>
        <FormField label="Assigned Warehouse">
          <SelectField value={form.warehouse_id} onChange={(value) => updateField("warehouse_id", value)} disabled={referenceLoading}>
            <option value="">All warehouses</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={String(warehouse.id)}>
                {warehouse.warehouse_code} - {warehouse.warehouse_name}
              </option>
            ))}
          </SelectField>
        </FormField>
        <FormField label="Assigned Shift">
          <SelectField value={form.shift_id} onChange={(value) => updateField("shift_id", value)} disabled={referenceLoading}>
            <option value="">No shift assigned</option>
            {shifts.map((shift) => (
              <option key={shift.id} value={String(shift.id)}>
                {shift.shift_name}{formatShiftHours(shift) ? ` (${formatShiftHours(shift)})` : ""}
              </option>
            ))}
          </SelectField>
        </FormField>
        <FormField label="Account Status">
          <SelectField value={form.status} onChange={(value) => updateField("status", value)}>
            {accountStatuses.map((status) => <option key={status} value={status}>{formatAccountStatus(status)}</option>)}
          </SelectField>
        </FormField>
        <FormField label={mode === "edit" ? "New Password" : "Password"}>
          <input
            className={inputClass}
            type="password"
            value={form.password}
            onChange={(event) => updateField("password", event.target.value)}
            placeholder={mode === "edit" ? "Leave blank to keep current password" : "Minimum 8 characters"}
            required={mode !== "edit"}
            minLength={form.password || mode !== "edit" ? 8 : undefined}
          />
        </FormField>
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <ToolbarButton icon={X} variant="secondary" onClick={onCancel} disabled={saving}>Cancel</ToolbarButton>
        <ToolbarButton icon={saving ? Loader2 : CheckCircle2} type="submit" disabled={saving || referenceLoading}>
          {saving ? "Saving" : "Save User"}
        </ToolbarButton>
      </div>
    </form>
  );
}

function RolesPermissionsPage() {
  const roles = useApiCollection(() => getRoles(), "roles-permissions");
  const roleRows = roles.rows.length
    ? roles.rows
    : adminRoles.map((role) => ({ role_name: role, role_description: role === "System Admin" ? "Full access" : "Scoped operational access" }));

  return (
    <>
      <PageHeader
        eyebrow="System Management"
        title="Roles & Permissions"
        description="Readonly role access matrix for WMS modules and operational actions."
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-3 xl:grid-cols-[280px_1fr]">
          <SectionCard title="Role List" icon={ShieldCheck}>
            {roles.loading ? (
              <LoadingState label="Loading roles..." />
            ) : roles.error ? (
              <ErrorState message={roles.error} />
            ) : (
              <div className="space-y-2">
                {roleRows.map((role) => (
                  <div key={role.id || role.role_name} className="rounded border border-border bg-muted/20 px-3 py-2 text-xs">
                    <div className="font-semibold">{role.role_name}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{role.role_description || "Scoped system access"}</div>
                    {role.user_count !== undefined && <div className="mt-1 text-[11px] text-muted-foreground">{formatCount(role.user_count)} assigned users</div>}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
          <SectionCard title="Permission Matrix" icon={KeyRound}>
            <DataTable
              rows={permissionRows}
              emptyTitle="No permissions configured"
              columns={[
                { key: "module", label: "Module", className: "font-semibold" },
                { key: "systemAdmin", label: "System Admin" },
                { key: "warehouseStaff", label: "Warehouse Staff" },
                { key: "supervisor", label: "Supervisor" },
                { key: "customsOfficer", label: "Customs Officer" },
                { key: "billingOfficer", label: "Billing Officer" }
              ]}
            />
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function ShiftAssignmentPage() {
  const shifts = useApiCollection(() => getShifts(), "shift-assignment");
  const users = useApiCollection(() => getUsers(), "shift-users");
  const shiftRows = shifts.rows.length
    ? shifts.rows
    : shiftNames.map((shift) => ({ shift_name: shift }));

  return (
    <>
      <PageHeader
        eyebrow="System Management"
        title="Shift Assignment"
        description="Current user-to-shift coverage from the user management records."
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-3 lg:grid-cols-3">
          {shiftRows.map((shift) => {
            const assignedUsers = users.rows.filter((user) => String(user.shift_id || "") === String(shift.id || ""));

            return (
              <SectionCard
                key={shift.id || shift.shift_name}
                title={formatShiftHours(shift) ? `${shift.shift_name} (${formatShiftHours(shift)})` : shift.shift_name}
                icon={CalendarClock}
              >
                <DataTable
                  loading={shifts.loading || users.loading}
                  error={shifts.error || users.error}
                  rows={assignedUsers}
                  emptyTitle="No active shift assignment"
                  emptyBody="Assign a shift from the Users screen to populate this list."
                  columns={[
                    { key: "full_name", label: "User", className: "font-semibold" },
                    { key: "role_name", label: "Role", render: (row) => row.role_name || "No role" },
                    { key: "warehouse_name", label: "Warehouse", render: (row) => row.warehouse_code ? `${row.warehouse_code} - ${row.warehouse_name}` : "All warehouses" },
                    { key: "status", label: "Status", render: (row) => <StatusBadge tone={accountStatusTone(row.status)}>{formatAccountStatus(row.status)}</StatusBadge> }
                  ]}
                />
              </SectionCard>
            );
          })}
          {!shiftRows.length && (
            <SectionCard title="Shift Assignment" icon={CalendarClock}>
              <EmptyState title="No shifts loaded" />
            </SectionCard>
          )}
        </div>
      </div>
    </>
  );
}

function WarehouseAssignmentPage() {
  const users = useApiCollection(() => getUsers(), "warehouse-assignment-users");
  const warehouses = useApiCollection(() => getWarehouses(), "warehouse-assignment-warehouses");

  return (
    <>
      <PageHeader
        eyebrow="System Management"
        title="Warehouse Assignment"
        description="Current user warehouse scope and operational coverage from account records."
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            {warehouses.rows.map((warehouse) => (
              <SectionCard key={warehouse.id} title={`${warehouse.warehouse_code} - ${warehouse.warehouse_name}`} icon={Warehouse}>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <StatusBadge tone={accountStatusTone(warehouse.status)}>{formatAccountStatus(warehouse.status)}</StatusBadge>
                  <span className="text-muted-foreground">{formatCount(warehouse.assigned_user_count)} assigned users</span>
                </div>
              </SectionCard>
            ))}
          </div>
          <SectionCard title="Warehouse Scope Assignments" icon={Warehouse}>
            <DataTable
              loading={users.loading}
              error={users.error}
              rows={users.rows}
              emptyTitle="No warehouse assignments loaded"
              emptyBody="Assign a warehouse from the Users screen to populate this list."
              columns={[
                { key: "full_name", label: "User", className: "font-semibold" },
                { key: "role", label: "Role", render: (row) => row.role_name || "No role" },
                { key: "warehouse", label: "Assigned Warehouse", render: (row) => row.warehouse_code ? `${row.warehouse_code} - ${row.warehouse_name}` : "All warehouses" },
                { key: "zones", label: "Zone Scope", render: () => "All assigned warehouse zones" },
                { key: "shift", label: "Shift", render: (row) => row.shift_name || "No shift" },
                { key: "status", label: "Status", render: (row) => <StatusBadge tone={accountStatusTone(row.status)}>{formatAccountStatus(row.status)}</StatusBadge> }
              ]}
            />
          </SectionCard>
        </div>
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
      <FormField label="Zone">
        <select className={inputClass} value={selectedZone} onChange={(event) => setSelectedZone(event.target.value)}>
          <option value="">{loading.zones ? "Loading zones..." : "Select zone"}</option>
          {zones.map((zone) => (
            <option key={getRecordId(zone, "zone_id")} value={getRecordId(zone, "zone_id")}>
              {getZoneLabel(zone)}
            </option>
          ))}
        </select>
      </FormField>

      {needRack && (
        <FormField label="Rack">
          <select className={inputClass} value={selectedRack} onChange={(event) => setSelectedRack(event.target.value)} disabled={!selectedZone}>
            <option value="">{loading.racks ? "Loading racks..." : "Select rack"}</option>
            {racks.map((rack) => (
              <option key={getRecordId(rack, "rack_id")} value={getRecordId(rack, "rack_id")}>
                {getRackCode(rack) || "Unnamed rack"}
              </option>
            ))}
          </select>
        </FormField>
      )}

      {needLevel && (
        <FormField label="Level">
          <select className={inputClass} value={selectedLevel} onChange={(event) => setSelectedLevel(event.target.value)} disabled={!selectedRack}>
            <option value="">{loading.levels ? "Loading levels..." : "Select level"}</option>
            {levels.map((level) => (
              <option key={getRecordId(level, "level_id")} value={getRecordId(level, "level_id")}>
                {getLevelCode(level) || "Unnamed level"}
              </option>
            ))}
          </select>
        </FormField>
      )}
    </div>
  );
}

function useWarehouseHierarchy() {
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

  return {
    zones,
    racks,
    levels,
    bins,
    selectedZone,
    selectedRack,
    selectedLevel,
    setSelectedZone,
    setSelectedRack,
    setSelectedLevel,
    loading,
    error
  };
}

function ConfigActionDrawer({ action, onClose }) {
  return (
    <Drawer open={Boolean(action)} title={action || "Warehouse Action"} onClose={onClose}>
      <div className="space-y-3">
        <ActionPlaceholder
          title="Configuration write pending"
          body="This action panel is prepared for future configuration changes."
        />
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Code"><input className={inputClass} placeholder="Code" /></FormField>
          <FormField label="Name / Label"><input className={inputClass} placeholder="Name or label" /></FormField>
          <FormField label="Max Weight"><input className={inputClass} placeholder="kg" /></FormField>
          <FormField label="Max Volume"><input className={inputClass} placeholder="m3" /></FormField>
          <FormField label="Status">
            <SelectField defaultValue="">
              <option value="">Select status</option>
              <option>Available</option>
              <option>Reserved</option>
              <option>Blocked</option>
            </SelectField>
          </FormField>
          <FormField label="Reserved Cargo Type"><input className={inputClass} placeholder="Optional" /></FormField>
        </div>
        <div className="flex justify-end border-t border-border pt-3">
          <ToolbarButton icon={CheckCircle2} disabled>Save Configuration</ToolbarButton>
        </div>
      </div>
    </Drawer>
  );
}

function WarehouseConfigPage({ scope }) {
  const hierarchy = useWarehouseHierarchy();
  const [action, setAction] = useState("");
  const config = {
    zones: {
      title: "Zones",
      description: "Manage top-level warehouse zones from the storage hierarchy.",
      rows: hierarchy.zones,
      loading: hierarchy.loading.zones,
      needRack: false,
      needLevel: false,
      addAction: "Add Zone",
      icon: Boxes
    },
    racks: {
      title: "Racks",
      description: "Manage rack structure within the selected zone.",
      rows: hierarchy.selectedZone ? hierarchy.racks : [],
      loading: hierarchy.loading.racks,
      needRack: false,
      needLevel: false,
      addAction: "Add Rack",
      icon: Rows3
    },
    levels: {
      title: "Levels",
      description: "Manage level structure within the selected rack.",
      rows: hierarchy.selectedRack ? hierarchy.levels : [],
      loading: hierarchy.loading.levels,
      needRack: true,
      needLevel: false,
      addAction: "Add Level",
      icon: SquareStack
    },
    bins: {
      title: "Bins",
      description: "Manage bin barcode, reservation, blocked state, and capacity configuration.",
      rows: hierarchy.selectedLevel ? hierarchy.bins : [],
      loading: hierarchy.loading.bins,
      needRack: true,
      needLevel: true,
      addAction: "Add Bin",
      icon: Box
    }
  }[scope];

  const baseColumns = [
    {
      key: "code",
      label: scope === "zones" ? "Zone" : scope === "racks" ? "Rack" : "Level",
      render: (row) => {
        if (scope === "zones") return getZoneLabel(row);
        if (scope === "racks") return getRackCode(row) || "No rack data";
        return getLevelCode(row) || "No level data";
      },
      className: "font-mono font-semibold"
    },
    { key: "capacity", label: "Capacity", render: (row) => formatCapacity(row) },
    { key: "occupancy", label: "Occupancy", render: (row) => formatOccupancy(row) },
    { key: "available_bins", label: "Available Bins", render: (row) => formatCount(row.available_bins) },
    { key: "blocked_bins", label: "Blocked Bins", render: (row) => formatCount(row.blocked_bins) },
    { key: "reserved_bins", label: "Reserved Bins", render: (row) => formatCount(row.reserved_bins) },
    { key: "status", label: "Status", render: (row) => <StatusBadge tone={row.active === false ? "destructive" : "success"}>{row.active === false ? "Inactive" : "Active"}</StatusBadge> }
  ];

  const binColumns = [
    { key: "barcode", label: "Bin Barcode", render: (row) => getBinCode(row), className: "font-mono font-semibold" },
    { key: "status", label: "Status", render: (row) => <StatusBadge tone={statusTone(row.status)}>{row.status || "No data"}</StatusBadge> },
    { key: "location", label: "Hierarchy", render: (row) => `${row.zone_code || "No zone"} / ${row.rack_code || "No rack"} / ${row.level_code || "No level"}` },
    { key: "capacity", label: "Capacity", render: (row) => formatCapacity(row) },
    { key: "occupancy", label: "Occupancy", render: (row) => formatOccupancy(row) },
    { key: "reserved_for_cargo_type", label: "Reserved For", render: (row) => row.reserved_for_cargo_type || "Not reserved" }
  ];

  const emptyTitle = {
    zones: "No zones loaded",
    racks: hierarchy.selectedZone ? "No racks loaded" : "Select a zone to load racks",
    levels: hierarchy.selectedRack ? "No levels loaded" : "Select a zone and rack to load levels",
    bins: hierarchy.selectedLevel ? "No bins loaded" : "Select a zone, rack, and level to load bins"
  }[scope];

  return (
    <>
      <PageHeader
        eyebrow="Warehouse Configuration"
        title={config.title}
        description={config.description}
        action={
          <div className="flex flex-wrap gap-2">
            <ToolbarButton icon={Plus} onClick={() => setAction(config.addAction)}>{config.addAction}</ToolbarButton>
            <ToolbarButton icon={Ruler} variant="secondary" onClick={() => setAction("Edit Capacity")}>Edit Capacity</ToolbarButton>
            {scope === "bins" && (
              <>
                <ToolbarButton icon={Ban} variant="warning" onClick={() => setAction("Block Bin")}>Block Bin</ToolbarButton>
                <ToolbarButton icon={LockKeyhole} variant="secondary" onClick={() => setAction("Reserve Bin")}>Reserve Bin</ToolbarButton>
              </>
            )}
          </div>
        }
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-3">
          {scope !== "zones" && (
            <SectionCard title="Hierarchy Filter" icon={Warehouse}>
              <HierarchySelector
                zones={hierarchy.zones}
                racks={hierarchy.racks}
                levels={hierarchy.levels}
                selectedZone={hierarchy.selectedZone}
                selectedRack={hierarchy.selectedRack}
                selectedLevel={hierarchy.selectedLevel}
                setSelectedZone={hierarchy.setSelectedZone}
                setSelectedRack={hierarchy.setSelectedRack}
                setSelectedLevel={hierarchy.setSelectedLevel}
                needRack={config.needRack}
                needLevel={config.needLevel}
                loading={hierarchy.loading}
              />
            </SectionCard>
          )}
          <SectionCard title={`${config.title} Structure`} icon={config.icon}>
            <DataTable
              rows={config.rows}
              loading={config.loading}
              error={hierarchy.error}
              emptyTitle={emptyTitle}
              emptyBody="Warehouse configuration records will appear when storage areas are configured."
              columns={scope === "bins" ? binColumns : baseColumns}
            />
          </SectionCard>
        </div>
      </div>
      <ConfigActionDrawer action={action} onClose={() => setAction("")} />
    </>
  );
}

function BinRulesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Warehouse Configuration"
        title="Bin Rules"
        description="Operational rule configuration for cargo compatibility and storage validation."
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {binRuleCards.map((rule) => (
            <SectionCard key={rule.title} title={rule.title} icon={ListChecks}>
              <div className="space-y-3 text-xs">
                <p className="text-muted-foreground">{rule.body}</p>
                <EmptyState title="No rule records loaded" body="Rule values will appear when warehouse rules are configured." />
                <ToolbarButton icon={SlidersHorizontal} variant="secondary" disabled>Configure Rule</ToolbarButton>
              </div>
            </SectionCard>
          ))}
        </div>
      </div>
    </>
  );
}

function CapacityConfigurationPage() {
  const hierarchy = useWarehouseHierarchy();

  return (
    <>
      <PageHeader
        eyebrow="Warehouse Configuration"
        title="Capacity Configuration"
        description="Storage capacity visibility by zone, rack, level, and bin."
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-3">
          <SectionCard title="Capacity Hierarchy Filter" icon={Warehouse}>
            <HierarchySelector
              zones={hierarchy.zones}
              racks={hierarchy.racks}
              levels={hierarchy.levels}
              selectedZone={hierarchy.selectedZone}
              selectedRack={hierarchy.selectedRack}
              selectedLevel={hierarchy.selectedLevel}
              setSelectedZone={hierarchy.setSelectedZone}
              setSelectedRack={hierarchy.setSelectedRack}
              setSelectedLevel={hierarchy.setSelectedLevel}
              needRack
              needLevel
              loading={hierarchy.loading}
            />
          </SectionCard>
          <div className="grid gap-3 xl:grid-cols-2">
            <CapacityTable title="Zone Capacity" icon={Boxes} rows={hierarchy.zones} loading={hierarchy.loading.zones} error={hierarchy.error} label="Zone" labelRenderer={getZoneLabel} />
            <CapacityTable title="Rack Capacity" icon={Rows3} rows={hierarchy.racks} loading={hierarchy.loading.racks} error={hierarchy.error} label="Rack" labelRenderer={getRackCode} emptyTitle={hierarchy.selectedZone ? "No racks loaded" : "Select a zone to load rack capacity"} />
            <CapacityTable title="Level Capacity" icon={SquareStack} rows={hierarchy.levels} loading={hierarchy.loading.levels} error={hierarchy.error} label="Level" labelRenderer={getLevelCode} emptyTitle={hierarchy.selectedRack ? "No levels loaded" : "Select a rack to load level capacity"} />
            <CapacityTable title="Bin Capacity" icon={Box} rows={hierarchy.bins} loading={hierarchy.loading.bins} error={hierarchy.error} label="Bin" labelRenderer={getBinCode} emptyTitle={hierarchy.selectedLevel ? "No bins loaded" : "Select a level to load bin capacity"} />
          </div>
        </div>
      </div>
    </>
  );
}

function CapacityTable({ title, icon, rows, loading, error, label, labelRenderer, emptyTitle = "No capacity records loaded" }) {
  return (
    <SectionCard title={title} icon={icon}>
      <DataTable
        rows={rows}
        loading={loading}
        error={error}
        emptyTitle={emptyTitle}
        columns={[
          { key: "label", label, render: (row) => labelRenderer(row) || "No data", className: "font-mono font-semibold" },
          { key: "max_weight", label: "Max Weight", render: (row) => formatMeasure(readValue(row, ["max_weight_capacity", "max_weight"]), "kg") },
          { key: "max_volume", label: "Max Volume", render: (row) => formatMeasure(readValue(row, ["max_volume_capacity", "max_volume"]), "m3") },
          { key: "current_usage", label: "Current Usage", render: (row) => formatCapacity(row) },
          { key: "remaining_capacity", label: "Remaining Capacity", render: (row) => {
            const maxWeight = readNumber(row, ["max_weight_capacity", "max_weight"]);
            const currentWeight = readNumber(row, ["current_weight_capacity", "current_weight"]);
            const maxVolume = readNumber(row, ["max_volume_capacity", "max_volume"]);
            const currentVolume = readNumber(row, ["current_volume_capacity", "current_volume"]);
            const remainingWeight = maxWeight !== null && currentWeight !== null ? maxWeight - currentWeight : null;
            const remainingVolume = maxVolume !== null && currentVolume !== null ? maxVolume - currentVolume : null;
            return (
              <div className="space-y-0.5">
                <div>{remainingWeight !== null ? formatMeasure(remainingWeight, "kg") : "No data"}</div>
                <div className="text-muted-foreground">{remainingVolume !== null ? formatMeasure(remainingVolume, "m3") : "No data"}</div>
              </div>
            );
          } }
        ]}
      />
    </SectionCard>
  );
}

function CargoFilters({ filters, setFilters }) {
  return (
    <SectionCard title="Cargo Filters" icon={Filter}>
      <div className="grid gap-3 md:grid-cols-4">
        <FormField label="Cargo status">
          <SelectField value={filters.status} onChange={(value) => setFilters((current) => ({ ...current, status: value }))}>
            <option>All statuses</option>
            {cargoStatuses.map((status) => <option key={status}>{status}</option>)}
          </SelectField>
        </FormField>
        <FormField label="Warehouse">
          <input className={inputClass} value={filters.warehouse} onChange={(event) => setFilters((current) => ({ ...current, warehouse: event.target.value }))} placeholder="Warehouse name" />
        </FormField>
        <FormField label="Date">
          <input className={inputClass} type="date" value={filters.date} onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value }))} />
        </FormField>
        <FormField label="Cargo type">
          <input className={inputClass} value={filters.cargoType} onChange={(event) => setFilters((current) => ({ ...current, cargoType: event.target.value }))} placeholder="Cargo type" />
        </FormField>
      </div>
    </SectionCard>
  );
}

function CargoRecordsPage({ mode = "records" }) {
  const statusParam = mode === "blocked" ? "Blocked" : undefined;
  const cargo = useApiCollection(() => getCargo(statusParam ? { status: statusParam } : {}), `cargo-${statusParam || "all"}`);
  const [filters, setFilters] = useState({ status: "All statuses", warehouse: "", date: "", cargoType: "" });

  const rows = useMemo(() => {
    return cargo.rows.filter((record) => {
      const status = cargoOperationalStatus(record);
      const statusMatch = filters.status === "All statuses" || status === filters.status;
      const typeMatch = !filters.cargoType || record.cargo_type?.toLowerCase().includes(filters.cargoType.toLowerCase());
      const dateMatch = !filters.date || String(record.created_at || record.received_datetime || "").startsWith(filters.date);
      return statusMatch && typeMatch && dateMatch;
    });
  }, [cargo.rows, filters]);

  const config = {
    records: {
      title: "Cargo Records",
      description: "Readonly cargo records for operational supervision across receiving, storage, and release states.",
      emptyTitle: "No cargo records loaded"
    },
    tracking: {
      title: "Cargo Tracking",
      description: "Readonly cargo movement and current-location visibility for administrators.",
      emptyTitle: "No tracking records loaded"
    },
    blocked: {
      title: "Blocked Cargo",
      description: "Readonly visibility of cargo marked as blocked or unavailable for normal movement.",
      emptyTitle: "No blocked cargo loaded"
    }
  }[mode];

  return (
    <>
      <PageHeader eyebrow="Cargo Oversight" title={config.title} description={config.description} />
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-3">
          <CargoFilters filters={filters} setFilters={setFilters} />
          <SectionCard title={config.title} icon={PackageSearch}>
            <DataTable
              loading={cargo.loading}
              error={cargo.error}
              rows={rows}
              emptyTitle={config.emptyTitle}
              emptyBody="Cargo supervision data will appear when cargo records are available."
              columns={[
                { key: "cargo_id", label: "Cargo ID", className: "font-mono font-semibold" },
                { key: "barcode", label: "Barcode", className: "font-mono text-muted-foreground" },
                { key: "cargo_type", label: "Cargo Type", render: (row) => row.cargo_type || "No data" },
                { key: "warehouse", label: "Warehouse", render: () => "Warehouse context not loaded" },
                { key: "status", label: "Status", render: (row) => <StatusBadge tone={statusTone(cargoOperationalStatus(row))}>{cargoOperationalStatus(row)}</StatusBadge> },
                { key: "location", label: "Current Location", render: (row) => row.location || "Not assigned" },
                { key: "updated_at", label: "Updated", render: (row) => formatDateTime(row.updated_at) }
              ]}
            />
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function PlacementMonitoringPage() {
  const logs = useApiCollection(() => getPlacementLogs(), "placement-logs");

  return (
    <>
      <PageHeader
        eyebrow="Cargo Oversight"
        title="Placement Monitoring"
        description="Monitor placement attempts, validation failures, occupied bins, rejected placements, and scanner activity."
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-3 lg:grid-cols-4">
          <SectionCard title="Placement Attempts" icon={ClipboardCheck}>
            <DataTable
              loading={logs.loading}
              error={logs.error}
              rows={logs.rows}
              emptyTitle="No placement attempts loaded"
              columns={[
                { key: "created_at", label: "Time", render: (row) => formatDateTime(row.created_at) },
                { key: "result", label: "Status", render: (row) => <StatusBadge tone={row.approved ? "success" : "destructive"}>{row.approved ? "Validation Passed" : "Validation Failed"}</StatusBadge> },
                { key: "cargo_barcode", label: "Cargo", render: (row) => row.cargo_barcode || "No cargo barcode" },
                { key: "bin_barcode", label: "Bin", render: (row) => row.bin_barcode || "No bin barcode" },
                { key: "detail", label: "Detail", render: (row) => row.detail || row.reason || "No detail recorded" }
              ]}
            />
          </SectionCard>
          <SectionCard title="Validation Failures" icon={FileWarning}>
            <DataTable
              loading={logs.loading}
              error={logs.error}
              rows={logs.rows.filter((log) => log.approved === false)}
              emptyTitle="No validation failures loaded"
              columns={[
                { key: "created_at", label: "Time", render: (row) => formatDateTime(row.created_at) },
                { key: "reason", label: "Failure", render: (row) => row.reason || "No reason recorded" },
                { key: "detail", label: "Detail", render: (row) => row.detail || "No detail recorded" }
              ]}
            />
          </SectionCard>
          <SectionCard title="Occupied Bins" icon={Box}>
            <EmptyState title="No occupied-bin activity" body="Occupied bin activity will appear as storage work is recorded." />
          </SectionCard>
          <SectionCard title="Scanner Activity" icon={ScanLine}>
            <EmptyState title="No scanner activity" body="Scanner and rejected placement events will appear here." />
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function DispatchOversightPage({ mode }) {
  const config = {
    queue: {
      title: "Dispatch Queue",
      description: "Readonly cargo awaiting dispatch release.",
      status: "Ready for Dispatch",
      emptyTitle: "No dispatch queue records loaded"
    },
    released: {
      title: "Released Cargo",
      description: "Readonly cargo released from the warehouse.",
      status: "Released",
      emptyTitle: "No released cargo loaded"
    },
    gate: {
      title: "Gate Activity",
      description: "Readonly gate activity supervision for released cargo movement.",
      status: "",
      emptyTitle: "No gate activity loaded"
    }
  }[mode];

  const cargo = useApiCollection(() => config.status ? getCargo({ status: config.status }) : Promise.resolve({ data: [] }), `dispatch-${config.status || "gate"}`);

  return (
    <>
      <PageHeader eyebrow="Dispatch Oversight" title={config.title} description={config.description} />
      <div className="flex-1 overflow-auto p-4">
        <SectionCard title={config.title} icon={mode === "gate" ? DoorOpen : Truck}>
          <DataTable
            loading={cargo.loading}
            error={cargo.error}
            rows={cargo.rows}
            emptyTitle={config.emptyTitle}
            emptyBody="Dispatch supervision records will appear when dispatch data is available."
            columns={[
              { key: "cargo_id", label: "Cargo ID", className: "font-mono font-semibold" },
              { key: "barcode", label: "Barcode", className: "font-mono text-muted-foreground" },
              { key: "location", label: "Storage Location", render: (row) => row.location || "Not assigned" },
              { key: "status", label: "Status", render: (row) => <StatusBadge tone={statusTone(row.status)}>{row.status || "No status"}</StatusBadge> },
              { key: "updated_at", label: "Updated", render: (row) => formatDateTime(row.updated_at) }
            ]}
          />
        </SectionCard>
      </div>
    </>
  );
}

function ValidationLogsPage({ logs: providedLogs } = {}) {
  const ownLogs = useApiCollection(() => getPlacementLogs(), "placement-logs");
  const logs = providedLogs || ownLogs;

  return (
    <>
      <PageHeader
        eyebrow="Operational Review"
        title="Validation Logs"
        description="Operational log table for invalid barcodes, rejected placements, hazardous mismatch, capacity exceeded, and blocked storage areas."
      />
      <div className="flex-1 overflow-auto p-4">
        <SectionCard title="Operational Validation Logs" icon={FileWarning}>
          <DataTable
            loading={logs.loading}
            error={logs.error}
            rows={logs.rows}
            emptyTitle="No validation logs loaded"
            emptyBody="Validation logs will appear when placement validation events are recorded."
            columns={[
              { key: "created_at", label: "Timestamp", render: (row) => formatDateTime(row.created_at), className: "font-mono text-muted-foreground" },
              { key: "event", label: "Event", render: (row) => row.reason || "Validation event" },
              { key: "result", label: "Result", render: (row) => <StatusBadge tone={row.approved ? "success" : "destructive"}>{row.approved ? "Passed" : "Rejected"}</StatusBadge> },
              { key: "cargo_barcode", label: "Cargo", render: (row) => row.cargo_barcode || "Not recorded" },
              { key: "bin_barcode", label: "Bin", render: (row) => row.bin_barcode || "Not recorded" },
              { key: "detail", label: "Detail", render: (row) => row.detail || "No detail recorded" }
            ]}
          />
        </SectionCard>
      </div>
    </>
  );
}

function AuditPage({ mode }) {
  const logs = useApiCollection(() => getAuditLogs({ limit: 200 }), `audit-logs-${mode}`);
  const sessions = useApiCollection(() => getUserSessions(), `audit-sessions-${mode}`);
  const config = {
    logs: {
      title: "Audit Logs",
      description: "Readonly audit trail for administrative and operational modules."
    },
    activity: {
      title: "User Activity",
      description: "Readonly user activity monitoring by module and action."
    },
    sessions: {
      title: "Login Sessions",
      description: "Readonly session monitoring for account access."
    },
    security: {
      title: "Security Events",
      description: "Readonly security event monitoring for the WMS."
    }
  }[mode];

  const auditColumns = [
    { key: "created_at", label: "Timestamp", render: (row) => formatDateTime(row.created_at), className: "font-mono text-muted-foreground" },
    { key: "user", label: "User", render: (row) => row.full_name || row.username || "System" },
    { key: "action", label: "Action", className: "font-mono font-semibold" },
    { key: "module", label: "Module" },
    { key: "description", label: "Description", render: (row) => row.description || "No description recorded" }
  ];

  const sessionColumns = [
    { key: "login_time", label: "Login Time", render: (row) => formatDateTime(row.login_time), className: "font-mono text-muted-foreground" },
    { key: "user", label: "User", render: (row) => row.full_name || row.username || "Unknown user" },
    { key: "logout_time", label: "Logout Time", render: (row) => formatDateTime(row.logout_time) },
    { key: "session_status", label: "Session Status", render: (row) => <StatusBadge tone={row.session_status === "active" ? "success" : "muted"}>{formatAccountStatus(row.session_status)}</StatusBadge> },
    { key: "ip_address", label: "IP Address", render: (row) => row.ip_address || "Not recorded" }
  ];

  const table = mode === "sessions"
    ? {
      rows: sessions.rows,
      loading: sessions.loading,
      error: sessions.error,
      columns: sessionColumns,
      emptyBody: "Login sessions will appear when account access events are recorded."
    }
    : {
      rows: logs.rows,
      loading: logs.loading,
      error: logs.error,
      columns: auditColumns,
      emptyBody: "Audit entries will appear when administrative actions are recorded."
    };

  return (
    <>
      <PageHeader eyebrow="Audit & Security" title={config.title} description={config.description} />
      <div className="flex-1 overflow-auto p-4">
        <SectionCard title={config.title} icon={Shield}>
          <DataTable
            loading={table.loading}
            error={table.error}
            rows={table.rows}
            emptyTitle={`No ${config.title.toLowerCase()} loaded`}
            emptyBody={table.emptyBody}
            columns={table.columns}
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
        title="System Administrator Profile"
        description="Administrator identity, warehouse scope, permissions summary, and session placeholders."
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-3 lg:grid-cols-3">
          <SectionCard title="Administrator Profile" icon={UserCircle2}>
            <div className="space-y-3 text-xs">
              <ReadonlyValue label="Name" value="System Administrator" />
              <ReadonlyValue label="Role" value={<StatusBadge tone="released">System Admin</StatusBadge>} />
              <ReadonlyValue label="Warehouse Scope" value="All warehouses" />
            </div>
          </SectionCard>
          <SectionCard title="Permissions Summary" icon={ShieldCheck}>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="rounded border border-border bg-muted/20 px-3 py-2">Full system configuration access</div>
              <div className="rounded border border-border bg-muted/20 px-3 py-2">User and role access oversight</div>
              <div className="rounded border border-border bg-muted/20 px-3 py-2">Warehouse hierarchy configuration</div>
              <div className="rounded border border-border bg-muted/20 px-3 py-2">Audit and security monitoring</div>
            </div>
          </SectionCard>
          <SectionCard title="Session Information" icon={LockKeyhole}>
            <div className="space-y-3 text-xs">
              <ReadonlyValue label="Session Status" value="Session not loaded" />
              <ReadonlyValue label="Last Login" value="Not recorded" />
              <ReadonlyValue label="IP Placeholder" value="Not recorded" />
            </div>
          </SectionCard>
          <SectionCard title="Change Password" icon={KeyRound}>
            <ActionPlaceholder title="Password change placeholder" body="Password updates will be available when account security settings are enabled." />
          </SectionCard>
          <SectionCard title="Notification Settings" icon={Settings}>
            <ActionPlaceholder title="Notification settings placeholder" body="System alerts and admin notification preferences will be configured here." />
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function ReadonlyValue({ label, value }) {
  return (
    <div className="rounded border border-border bg-muted/20 p-3">
      <div className="text-[11px] font-semibold text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

function AdminPortal() {
  return (
    <AdminLayout>
      <Routes>
        <Route index element={<DashboardPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="system/users" element={<UsersPage />} />
        <Route path="system/roles-permissions" element={<RolesPermissionsPage />} />
        <Route path="system/shift-assignment" element={<ShiftAssignmentPage />} />
        <Route path="system/warehouse-assignment" element={<WarehouseAssignmentPage />} />
        <Route path="warehouse/zones" element={<WarehouseConfigPage scope="zones" />} />
        <Route path="warehouse/racks" element={<WarehouseConfigPage scope="racks" />} />
        <Route path="warehouse/levels" element={<WarehouseConfigPage scope="levels" />} />
        <Route path="warehouse/bins" element={<WarehouseConfigPage scope="bins" />} />
        <Route path="warehouse/bin-rules" element={<BinRulesPage />} />
        <Route path="warehouse/capacity-configuration" element={<CapacityConfigurationPage />} />
        <Route path="cargo/records" element={<CargoRecordsPage mode="records" />} />
        <Route path="cargo/placement-monitoring" element={<PlacementMonitoringPage />} />
        <Route path="cargo/tracking" element={<CargoRecordsPage mode="tracking" />} />
        <Route path="cargo/blocked" element={<CargoRecordsPage mode="blocked" />} />
        <Route path="dispatch/queue" element={<DispatchOversightPage mode="queue" />} />
        <Route path="dispatch/released" element={<DispatchOversightPage mode="released" />} />
        <Route path="dispatch/gate-activity" element={<DispatchOversightPage mode="gate" />} />
        <Route path="monitoring/validation-logs" element={<ValidationLogsPage />} />
        <Route path="audit/logs" element={<AuditPage mode="logs" />} />
        <Route path="audit/user-activity" element={<AuditPage mode="activity" />} />
        <Route path="audit/login-sessions" element={<AuditPage mode="sessions" />} />
        <Route path="audit/security-events" element={<AuditPage mode="security" />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AdminLayout>
  );
}

export default AdminPortal;

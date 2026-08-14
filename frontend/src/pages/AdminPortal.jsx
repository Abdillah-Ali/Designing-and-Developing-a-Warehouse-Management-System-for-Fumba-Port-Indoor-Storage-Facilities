import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
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
  EyeOff,
  FileWarning,
  Filter,
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
  Printer,
  RefreshCw,
  Rows3,
  Ruler,
  Save,
  ScanLine,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  SquareStack,
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
import { BinBarcodeLabel, printBinBarcodeLabel } from "@/components/wms/BarcodeLabel";
import { EnterpriseModal } from "@/components/wms/EnterpriseModal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ManualPlacementSetting } from "@/components/wms/ManualPlacementSetting";
import { PlacementActivityPanel } from "@/components/wms/PlacementActivityTimeline";
import { ReviewActionModal } from "@/components/wms/ReviewActionModal";
import { HeaderActions } from "@/components/wms/HeaderActions";
import { NotificationsPage } from "@/components/wms/NotificationsPage";
import { AccountProfilePage } from "@/components/wms/ProfilePage";
import { cn } from "@/lib/utils";
import { getStoredAuthUserId } from "@/lib/portal-access";
import {
  formatCount,
  formatDateTime,
  formatMeasure,
  getErrorMessage,
  statusTone
} from "@/lib/wms-operational";
import { getDetailViewFields } from "@/lib/warehouse-detail-fields";
import { getSystemReadinessPresentation } from "@/lib/system-readiness";

import {
  approveSupervisorApproval,
  createBin,
  createBinRule,
  createBinRuleCategory,
  createLevel,
  createRack,
  createScanner,
  createShift,
  createZone,
  createUser,
  deactivateUser,
  deleteBin,
  deleteBinRule,
  deleteBinRuleCategory,
  deleteLevel,
  deleteRack,
  deleteWarehouse,
  deleteZone,
  getAuditLogs,
  getAdminPermissions,
  getAdminRolePermissions,
  getAdminRoles,
  getBins,
  getBinRules,
  getBinRuleCategories,
  getBinRuleEvaluators,
  getBinRuleReadiness,
  getCapacityConfigurations,
  getAvailableCargoRegistrationFields,
  getCargo,
  getCargoById,
  getLevels,
  getPlacementFailures,
  getPlacementLogs,
  getRacks,
  getRoles,
  getShifts,
  getShiftAssignmentHistory,
  getShiftUsers,
  getSupervisorApprovals,
  getSupervisorReviewConfiguration,
  getSystemAdministratorCapacity,
  getSystemReadiness,
  getUserPendingTasks,
  getUserSessions,
  getUsers,
  getWarehouses,
  getWarehouseAssignments,
  getWarehouseAssignmentHistory,
  getZones,
  logout,
  printBinBarcode,
  reassignUserPendingTasks,
  rejectSupervisorApproval,
  resetUserPassword,
  resetCargoRegistrationForm,
  updateBin,
  updateBinRule,
  updateBinRuleCategory,
  updateBinStatus,
  updateCapacityConfiguration,
  updateCargoRegistrationForm,
  updateAdminRolePermissions,
  updateShift,
  updateShiftStatus,
  assignUserToShift,
  removeUserFromShift,
  assignUserToWarehouse,
  removeUserFromWarehouse,
  updateLevel,
  updateLevelStatus,
  updateRack,
  updateRackStatus,
  updateZone,
  updateZoneStatus,
  updateUser,
  updateUserStatus,
  createWarehouse,
  updateWarehouse,
  validateCargoRegistrationForm,
  updateWarehouseStatus
} from "@/services/api";

const inputClass =
  "h-9 w-full rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

const emptyAuditFilters = {
  user: "",
  role: "",
  action: "",
  module: "",
  date_from: "",
  date_to: "",
  status: "",
  cargo_id: "",
  warehouse: ""
};

const cargoStatuses = [
  "Pending Review",
  "Approved",
  "Correction Required",
  "Rejected",
  "Unplaced",
  "Placed",
  "Relocated",
  "Dispatched",
  "Archived"
];

const warehouseCargoTypes = [
  "General Goods",
  "Electronics",
  "Machinery",
  "Food Products",
  "Construction Materials",
  "Fragile Goods",
  "Hazardous Cargo",
  "Mixed Cargo"
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
      { label: "Warehouse Assignment", icon: Warehouse, to: "/admin/system/warehouse-assignment" },
      { label: "Cargo Registration Form", icon: ClipboardList, to: "/admin/system/cargo-registration-form" }
    ]
  },
  {
    label: "Warehouse Configuration",
    icon: Warehouse,
    children: [
      { label: "Warehouses", icon: Warehouse, to: "/admin/warehouse/warehouses" },
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
      { label: "Approval Overrides", icon: ShieldCheck, to: "/admin/cargo/approval-overrides" },
      { label: "Placement Activity", icon: ClipboardCheck, to: "/admin/cargo/placement-monitoring" },
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
      { label: "System Logs", icon: Settings, to: "/admin/monitoring/system-logs" },
      { label: "Placement Logs", icon: ScanLine, to: "/admin/monitoring/placement-logs" },
      { label: "Validation Logs", icon: FileWarning, to: "/admin/monitoring/validation-logs" }
    ]
  },
  {
    label: "Audit & Security",
    icon: Shield,
    children: [
      { label: "Audit Logs", icon: ClipboardList, to: "/admin/audit/logs" },
      { label: "Activity Logs", icon: Activity, to: "/admin/audit/user-activity" },
      { label: "Login Sessions", icon: LockKeyhole, to: "/admin/audit/login-sessions" },
      { label: "Security Logs", icon: AlertTriangle, to: "/admin/audit/security-events" }
    ]
  },
  { label: "Profile", icon: UserCircle2, to: "/admin/profile" }
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
  if (record?.is_deleted) return "Archived";
  return record?.registration_status || "No status";
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

      <HeaderActions />
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
  const [systemReadiness,setSystemReadiness]=useState(null);

  useEffect(()=>{let active=true;getSystemReadiness().then((response)=>{if(active)setSystemReadiness(response.data||null);}).catch(()=>{});return()=>{active=false;};},[]);
  const readinessPresentation=getSystemReadinessPresentation(systemReadiness);

  const registeredCargo = useMemo(() => cargo.rows.filter((record) => record.placement_status === "Unplaced" && record.registration_status !== "Rejected"), [cargo.rows]);
  const storedCargo = useMemo(() => cargo.rows.filter((record) => ["Placed", "Relocated"].includes(record.placement_status)), [cargo.rows]);
  const blockedCargo = useMemo(() => cargo.rows.filter((record) => record.relocation_required), [cargo.rows]);
  const pendingSupervisor = useMemo(
    () => cargo.rows.filter((record) => record.registration_status === "Pending Review"),
    [cargo.rows]
  );
  const placementFailures = useMemo(() => logs.rows.filter((record) => record.approved === false), [logs.rows]);
  const recentActivity = useMemo(() => logs.rows.slice(0, 5), [logs.rows]);
  const activeBootstrapAdmin = useMemo(
    () => users.rows.find((user) => user.is_bootstrap_admin && user.status === "active"),
    [users.rows]
  );
  const statusRows = useMemo(
    () => cargoStatuses.map((status) => ({
      status,
      count: cargo.rows.filter((record) =>
        cargoOperationalStatus(record) === status || record.placement_status === status
      ).length
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
        {readinessPresentation && readinessPresentation.tone !== "success" && (
          <div className="mb-3 flex items-start gap-3 rounded-md border border-warning/35 bg-warning/10 px-4 py-3 text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div><div className="text-xs font-semibold">{readinessPresentation.title}</div><p className="mt-1 text-xs leading-5">The backend is available, but one or more business domains require authorized configuration. Review the readiness issue codes and complete the relevant configuration.</p></div>
          </div>
        )}
        {activeBootstrapAdmin && (
          <div className="mb-3 flex items-start gap-3 rounded-md border border-warning/35 bg-warning/10 px-4 py-3 text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="text-xs font-semibold">Bootstrap admin account is still active</div>
              <p className="mt-1 text-xs leading-5">
                For security, deactivate it after verifying the new admin account.
              </p>
            </div>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
          <OperationalStatCard
            title="Total Cargo"
            icon={Warehouse}
            loading={cargo.loading}
            error={cargo.error}
            value={cargo.rows.length}
            emptyTitle="No cargo records loaded"
            emptyBody="Operational cargo activity will appear as records are created."
            tone="info"
          />
          <OperationalStatCard
            title="Placement Queue"
            icon={ClipboardList}
            loading={cargo.loading}
            error={cargo.error}
            value={registeredCargo.length}
            emptyTitle="No cargo awaiting placement"
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
            title="Pending Review"
            icon={ClipboardCheck}
            loading={cargo.loading}
            error={cargo.error}
            value={pendingSupervisor.length}
            emptyTitle="No supervisor approvals pending"
            tone="warning"
          />
          <OperationalStatCard title="Placed Cargo" icon={PackageCheck} loading={cargo.loading} error={cargo.error} value={storedCargo.length} emptyTitle="No placed cargo" tone="success" />
          <OperationalStatCard title="Relocation Required" icon={Ban} loading={cargo.loading} error={cargo.error} value={blockedCargo.length} emptyTitle="No cargo requires relocation" tone="destructive" />
          <OperationalStatCard title="Placement Failures" icon={FileWarning} loading={logs.loading} error={logs.error} value={placementFailures.length} emptyTitle="No placement failures" tone="destructive" />
          <OperationalStatCard title="Warehouse Zones" icon={Boxes} loading={zones.loading} error={zones.error} value={zones.rows.length} emptyTitle="No warehouse hierarchy loaded" tone="info" />
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
  const currentUserId = getStoredAuthUserId();
  const users = useApiCollection(() => getUsers(), `users-${refreshKey}`);
  const roles = useApiCollection(() => getRoles(), "roles");
  const warehouses = useApiCollection(() => getWarehouses(), "warehouses");
  const shifts = useApiCollection(() => getShifts(), "shifts");
  const administratorCapacity = useApiCollection(
    async () => {
      const response = await getSystemAdministratorCapacity();
      return { data: [response.data] };
    },
    `administrator-capacity-${refreshKey}`
  );
  const activeSystemAdministratorCount = users.rows.filter(
    (user) => user.role_key === "system_administrator" && user.status === "active"
  ).length;
  const configuredAdministratorMaximum = administratorCapacity.rows[0]?.maximum ?? null;
  const administratorCapacityReached = Boolean(administratorCapacity.rows[0]?.capacity_reached);

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

  const openCreateScannerDrawer = () => {
    setSelectedUser(null);
    setActionError("");
    setDrawerMode("create-scanner");
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
    toast.success(userId ? "User account updated." : "User account created.");
    return response;
  };

  const toggleUserStatus = async (user) => {
    const nextStatus = user.status === "active" ? "inactive" : "active";
    setBusyUserId(`status-${user.id}`);
    setActionError("");

    try {
      await updateUserStatus(user.id, nextStatus);
      refreshUsers();
      toast.success(nextStatus === "active" ? "User account reactivated." : "User account deactivated.");
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusyUserId("");
    }
  };

  const disableUserAccount = async (user) => {
    if (!window.confirm(`Disable the account for ${user.full_name || user.username}? The user history will be preserved.`)) return;

    setBusyUserId(`deactivate-${user.id}`);
    setActionError("");

    try {
      await deactivateUser(user.id);
      refreshUsers();
      toast.success("User account disabled.");
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusyUserId("");
    }
  };

  const openResetPasswordDrawer = (user) => {
    setSelectedUser(user);
    setActionError("");
    setDrawerMode("reset-password");
  };

  const saveResetPassword = async (password) => {
    await resetUserPassword(selectedUser.id, password);
    closeDrawer();
    refreshUsers();
    toast.success("Temporary password set. The user must change it at next sign-in.");
  };

  const saveScanner = async (payload, scannerUser) => {
    await createScanner(payload);
    closeDrawer();
    refreshUsers();
    toast.success("Scanner credentials created successfully.", {
      description: `Linked to ${scannerUser?.role_name || "the selected user"} ${scannerUser?.full_name || ""}`.trim()
    });
  };

  return (
    <>
      <PageHeader
        eyebrow="System Management"
        title="Users"
        description="Create, assign, secure, activate, and deactivate WMS user accounts with full audit history."
        action={
          <div className="flex flex-wrap gap-2">
            <ToolbarButton icon={RefreshCw} variant="secondary" onClick={refreshUsers}>Refresh</ToolbarButton>
            <ToolbarButton icon={ScanLine} variant="secondary" onClick={openCreateScannerDrawer}>Create Scanner</ToolbarButton>
            <ToolbarButton icon={UserPlus} onClick={openCreateDrawer}>Create User</ToolbarButton>
          </div>
        }
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-3">
          {actionError && <ErrorState message={actionError} />}
          <div className="rounded border border-info/30 bg-info/10 px-4 py-3 text-sm text-info">
            <span className="font-semibold">
              System Administrators: {activeSystemAdministratorCount} / {configuredAdministratorMaximum ?? "…"} Active
            </span>
            {administratorCapacityReached && (
              <span className="ml-2">The maximum has been reached. Deactivate an existing administrator before assigning another.</span>
            )}
          </div>
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
                {
                  key: "full_name",
                  label: "Full Name",
                  render: (row) => (
                    <div>
                      <div className="font-semibold">{row.full_name}</div>
                      {row.role_key === "system_administrator" && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          <StatusBadge tone="info">System Administrator</StatusBadge>
                        </div>
                      )}
                    </div>
                  )
                },
                { key: "username", label: "Username", className: "font-mono text-muted-foreground" },
                { key: "email", label: "Email" },
                { key: "phone_number", label: "Phone Number" },
                { key: "role", label: "Role", render: (row) => row.role_name || "No role" },
                {
                  key: "scanner_link",
                  label: "Scanner Account",
                  render: (row) => row.role_key === "system_administrator"
                    ? "Not applicable"
                    : row.scanner_account_id
                    ? <StatusBadge tone="success">Created</StatusBadge>
                    : <StatusBadge tone="neutral">Not created</StatusBadge>
                },
                {
                  key: "assigned_warehouse",
                  label: "Assigned Warehouse",
                  render: (row) => row.role_key === "system_administrator"
                    ? "System-wide access"
                    : row.warehouse_code ? `${row.warehouse_code} - ${row.warehouse_name}` : "No warehouse assigned"
                },
                {
                  key: "assigned_shift",
                  label: "Assigned Shift",
                  render: (row) => row.role_key === "system_administrator" ? "Not applicable" : row.shift_name || "No shift"
                },
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
                        onClick={() => openResetPasswordDrawer(row)}
                        disabled={Number(row.id) === Number(currentUserId)}
                        className="inline-flex h-8 items-center gap-1 rounded border border-info/35 bg-info/10 px-2 text-[11px] font-semibold text-info hover:bg-info/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        Reset Password
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleUserStatus(row)}
                        disabled={
                          busyUserId === `status-${row.id}`
                          || (
                            row.status === "active"
                            && (
                              row.role_key === "system_administrator" && activeSystemAdministratorCount === 1
                            )
                          )
                        }
                        className="inline-flex h-8 items-center gap-1 rounded border border-warning/35 bg-warning/10 px-2 text-[11px] font-semibold text-warning hover:bg-warning/20 disabled:opacity-50"
                      >
                        {busyUserId === `status-${row.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                        {row.status === "active" ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => disableUserAccount(row)}
                        disabled={
                          busyUserId === `deactivate-${row.id}`
                          || row.status === "inactive"
                          || (row.role_key === "system_administrator" && row.status === "active" && activeSystemAdministratorCount === 1)
                        }
                        className="inline-flex h-8 items-center gap-1 rounded border border-destructive/35 bg-destructive/10 px-2 text-[11px] font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-50"
                      >
                        {busyUserId === `deactivate-${row.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                        Disable Account
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
          users={users.rows}
          referenceLoading={roles.loading || warehouses.loading || shifts.loading}
          activeSystemAdministratorCount={activeSystemAdministratorCount}
          maximumActiveSystemAdministrators={configuredAdministratorMaximum}
          onCancel={closeDrawer}
          onSave={saveUser}
          onReassigned={refreshUsers}
        />
      </Drawer>
      <Drawer open={drawerMode === "reset-password"} title="Reset User Password" onClose={closeDrawer}>
        <ResetUserPasswordForm user={selectedUser} onCancel={closeDrawer} onSave={saveResetPassword} />
      </Drawer>
      <Drawer open={drawerMode === "create-scanner"} title="Create Scanner Credentials" onClose={closeDrawer}>
        <ScannerForm users={users.rows} loading={users.loading} onCancel={closeDrawer} onSave={saveScanner} />
      </Drawer>
    </>
  );
}

function ScannerForm({ users, loading, onCancel, onSave }) {
  const [department, setDepartment] = useState("");
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const eligibleUsers = useMemo(() => users.filter((user) => (
    user.status === "active"
    && user.role_name !== "Scanner"
    && user.role_key !== "system_administrator"
  )), [users]);
  const departments = useMemo(() => (
    Array.from(new Set(eligibleUsers.map((user) => user.department_name).filter(Boolean)))
      .sort((left, right) => left.localeCompare(right))
  ), [eligibleUsers]);
  const departmentUsers = useMemo(() => eligibleUsers.filter(
    (user) => user.department_name === department
  ), [department, eligibleUsers]);
  const selectedUser = departmentUsers.find((user) => String(user.id) === userId) || null;
  const passwordChecks = useMemo(() => {
    const hasPassword = Boolean(password);
    return [
      {
        label: "Minimum 8 characters",
        pass: password.length >= 8
      },
      {
        label: "Uppercase letter",
        pass: /[A-Z]/.test(password)
      },
      {
        label: "Lowercase letter",
        pass: /[a-z]/.test(password)
      },
      {
        label: "Number",
        pass: /\d/.test(password)
      },
      {
        label: "Special character",
        pass: /[^A-Za-z0-9]/.test(password)
      }
    ].map((check) => ({ ...check, pass: hasPassword && check.pass }));
  }, [password]);
  const passwordStrengthValid = passwordChecks.every((check) => check.pass);
  const passwordsMatch = Boolean(password) && password === confirmPassword;
  const selectedUserHasScannerAccount = Boolean(selectedUser?.scanner_account_id);
  const canSubmit = Boolean(selectedUser) && !selectedUserHasScannerAccount && passwordStrengthValid && passwordsMatch;

  const selectDepartment = (value) => {
    setDepartment(value);
    setUserId("");
    setFormError("");
    setPassword("");
    setConfirmPassword("");
  };

  useEffect(() => {
    setPassword("");
    setConfirmPassword("");
    setFormError("");
  }, [selectedUser?.id]);

  useEffect(() => {
    if (selectedUserHasScannerAccount) {
      setFormError("This user already has scanner credentials. Select another user.");
    } else if (formError === "This user already has scanner credentials. Select another user.") {
      setFormError("");
    }
  }, [formError, selectedUserHasScannerAccount]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError("");

    if (!selectedUser) {
      setFormError("Select a department and user.");
      return;
    }

    if (!passwordStrengthValid) {
      setFormError("Complete all scanner password requirements.");
      return;
    }

    if (!passwordsMatch) {
      setFormError("Scanner password and confirmation do not match.");
      return;
    }

    setSaving(true);
    try {
      await onSave({ user_id: selectedUser.id, password }, selectedUser);
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const selectedUserSummary = selectedUser ? [
    { label: "Full Name", value: selectedUser.full_name },
    { label: "Username", value: selectedUser.username },
    { label: "Email", value: selectedUser.email },
    { label: "Current Role", value: selectedUser.role_name || "No role" }
  ] : [];

  return (
    <form className="space-y-3 max-h-[calc(100vh-9rem)] overflow-y-auto pr-1" onSubmit={handleSubmit}>
      {formError && <ErrorState message={formError} />}

      <section className="space-y-2 rounded-md border border-border bg-card/70 p-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Select User</div>
          <p className="mt-1 text-[11px] text-muted-foreground">Choose the department first, then select the user who will receive scanner credentials.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Department">
            <SelectField value={department} onChange={selectDepartment} disabled={loading} required>
              <option value="">Select department</option>
              {departments.map((name) => <option key={name} value={name}>{name}</option>)}
            </SelectField>
          </FormField>
          <FormField label="User">
            <SelectField
              value={userId}
              onChange={setUserId}
              disabled={!department || loading}
              required
            >
              <option value="">{department ? "Select user" : "Select department first"}</option>
              {departmentUsers.map((user) => (
                <option key={user.id} value={String(user.id)}>
                  {user.full_name} ({user.username})
                </option>
              ))}
            </SelectField>
          </FormField>
        </div>
      </section>

      <section className="space-y-2 rounded-md border border-border bg-card/70 p-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">User Information</div>
          <p className="mt-1 text-[11px] text-muted-foreground">Review the selected user before creating scanner credentials.</p>
        </div>

        {selectedUser ? (
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <div className="mb-2 text-xs font-semibold text-foreground">Selected User</div>
            <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
              {selectedUserSummary.map((item) => (
                <div key={item.label} className="flex gap-2">
                  <dt className="w-24 shrink-0 text-muted-foreground">{item.label}</dt>
                  <dd className="min-w-0 font-medium text-foreground">{item.value || "Not recorded"}</dd>
                </div>
              ))}
            </dl>
            {selectedUserHasScannerAccount && (
              <div className="mt-3 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
                This user already has scanner credentials. Choose a different user.
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border bg-muted/10 px-3 py-4 text-xs text-muted-foreground">
            Select a department and user to review their account summary.
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-md border border-border bg-card/70 p-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Scanner Credentials</div>
          <p className="mt-1 text-[11px] text-muted-foreground">Create a unique scanner password for the selected user. The backend also enforces that it differs from the user’s normal login password.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Scanner Password">
            <div className="relative">
              <input
                className={cn(inputClass, "pr-9")}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Create scanner password"
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((current) => !current)}
                className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </FormField>
          <FormField label="Confirm Scanner Password">
            <input
              className={inputClass}
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repeat scanner password"
              autoComplete="new-password"
              required
            />
          </FormField>
        </div>

        <div className="rounded-md border border-border bg-muted/20 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Password Rules</div>
          <ul className="mt-2 space-y-1.5 text-xs">
            {passwordChecks.map((check) => (
              <li key={check.label} className={cn("flex items-center gap-2", check.pass ? "text-success" : "text-muted-foreground") }>
                {check.pass ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-current/40" />}
                <span>{check.label}</span>
              </li>
            ))}
            <li className={cn("flex items-center gap-2", passwordsMatch ? "text-success" : "text-muted-foreground") }>
              {passwordsMatch ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-current/40" />}
              <span>Passwords match</span>
            </li>
          </ul>
        </div>
      </section>

      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <ToolbarButton icon={X} variant="secondary" onClick={onCancel} disabled={saving}>Cancel</ToolbarButton>
        <ToolbarButton icon={saving ? Loader2 : ScanLine} type="submit" disabled={saving || loading || !canSubmit}>
          {saving ? "Creating" : "Create Scanner"}
        </ToolbarButton>
      </div>
    </form>
  );
}

function UserForm({ mode, user, roles, warehouses, shifts, users = [], referenceLoading, activeSystemAdministratorCount = 0, maximumActiveSystemAdministrators = null, onCancel, onSave, onReassigned }) {
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
  const [showPassword, setShowPassword] = useState(false);
  const [pendingTasks, setPendingTasks] = useState(null);
  const [pendingTasksLoading, setPendingTasksLoading] = useState(false);
  const [reassignTargetId, setReassignTargetId] = useState("");
  const [reassigning, setReassigning] = useState(false);

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
    setShowPassword(false);
    setPendingTasks(null);
    setReassignTargetId("");
  }, [user, mode]);

  const updateField = (field, value) => {
    setForm((current) => {
      if (
        field === "role_id"
        && roles.find((role) => String(role.id) === String(value))?.role_key === "system_administrator"
      ) {
        return { ...current, role_id: value, warehouse_id: "", shift_id: "" };
      }
      return { ...current, [field]: value };
    });
  };

  const selectedRole = roles.find((role) => String(role.id) === String(form.role_id));
  const isWarehouseStaff = selectedRole?.role_key === "warehouse_staff";
  const isWarehouseSupervisor = selectedRole?.role_key === "warehouse_supervisor";
  const isSystemAdministrator = selectedRole?.role_key === "system_administrator";
  const requiresWarehouse = isWarehouseStaff || isWarehouseSupervisor;
  const isLastActiveSystemAdministrator = Boolean(
    user?.role_key === "system_administrator"
    && user?.status === "active"
    && activeSystemAdministratorCount === 1
  );
  const protectedRole = isLastActiveSystemAdministrator;
  const protectedStatus = isLastActiveSystemAdministrator;
  const retainsActiveAdministratorSlot = Boolean(
    mode === "edit" && user?.role_key === "system_administrator" && user?.status === "active"
  );
  const systemAdministratorRoleDisabled = (
    Number.isInteger(maximumActiveSystemAdministrators)
    && activeSystemAdministratorCount >= maximumActiveSystemAdministrators
    && !retainsActiveAdministratorSlot
  );
  const warehouseChanged = mode === "edit"
    && user?.id
    && String(user?.warehouse_id || "") !== String(form.warehouse_id || "");
  const canOwnWarehouseTasks = isWarehouseStaff || isWarehouseSupervisor;
  const reassignmentCandidates = users.filter((candidate) => (
    Number(candidate.id) !== Number(user?.id)
    && candidate.status === "active"
    && candidate.role_name === selectedRole?.role_name
    && (!user?.warehouse_id || String(candidate.warehouse_id || "") === String(user.warehouse_id || ""))
  ));
  useEffect(() => {
    if (!warehouseChanged || !canOwnWarehouseTasks || !user?.id) {
      setPendingTasks(null);
      setReassignTargetId("");
      return undefined;
    }

    let active = true;
    setPendingTasksLoading(true);
    getUserPendingTasks(user.id)
      .then((response) => {
        if (active) setPendingTasks(response.data || null);
      })
      .catch((error) => {
        if (active) {
          setPendingTasks(null);
          setFormError(getErrorMessage(error));
        }
      })
      .finally(() => {
        if (active) setPendingTasksLoading(false);
      });

    return () => {
      active = false;
    };
  }, [canOwnWarehouseTasks, user?.id, warehouseChanged]);

  const pendingTaskCount = pendingTasks?.total_pending_tasks || 0;

  const reassignPendingTasks = async () => {
    if (!user?.id || !reassignTargetId) return;
    setReassigning(true);
    setFormError("");
    try {
      const response = await reassignUserPendingTasks(user.id, {
        target_user_id: reassignTargetId,
        reason: "Reassigned before warehouse transfer."
      });
      setPendingTasks(response.data?.remaining_pending_tasks || null);
      setReassignTargetId("");
      onReassigned?.();
      toast.success("Pending tasks reassigned.");
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setReassigning(false);
    }
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

    if (warehouseChanged && pendingTaskCount > 0) {
      setFormError("Cannot transfer this user because they have pending warehouse tasks. Complete or reassign pending tasks before changing warehouse.");
      setSaving(false);
      return;
    }
    if (
      isSystemAdministrator
      && form.status === "active"
      && Number.isInteger(maximumActiveSystemAdministrators)
      && activeSystemAdministratorCount >= maximumActiveSystemAdministrators
      && !retainsActiveAdministratorSlot
    ) {
      setFormError(`Maximum number of active System Administrators (${maximumActiveSystemAdministrators}) has been reached. Deactivate an existing administrator before assigning this role to another user.`);
      setSaving(false);
      return;
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
          <SelectField value={form.role_id} onChange={(value) => updateField("role_id", value)} required disabled={referenceLoading || protectedRole}>
            <option value="">Select role</option>
            {roles.filter((role) => role.role_name !== "Scanner").map((role) => (
              <option
                key={role.id}
                value={String(role.id)}
                disabled={role.role_key === "system_administrator" && systemAdministratorRoleDisabled}
              >
                {role.role_name}{role.role_key === "system_administrator" && systemAdministratorRoleDisabled ? " — limit reached" : ""}
              </option>
            ))}
          </SelectField>
          {systemAdministratorRoleDisabled && (
            <span className="block text-[10px] font-normal leading-4 text-warning">
              Maximum active System Administrators reached ({maximumActiveSystemAdministrators}). Deactivate an existing administrator before assigning this role.
            </span>
          )}
        </FormField>
        <FormField label="Assigned Warehouse">
          <SelectField value={form.warehouse_id} onChange={(value) => updateField("warehouse_id", value)} disabled={referenceLoading || isSystemAdministrator} required={requiresWarehouse}>
            <option value="">{isSystemAdministrator ? "System-wide access" : "No warehouse assigned"}</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={String(warehouse.id)}>
                {warehouse.warehouse_code} - {warehouse.warehouse_name}
              </option>
            ))}
          </SelectField>
        </FormField>
        <FormField label="Assigned Shift">
          <SelectField value={form.shift_id} onChange={(value) => updateField("shift_id", value)} disabled={referenceLoading || isSystemAdministrator} required={isWarehouseStaff}>
            <option value="">{isSystemAdministrator ? "Not applicable" : "No shift assigned"}</option>
            {shifts.map((shift) => (
              <option key={shift.id} value={String(shift.id)}>
                {shift.shift_name}{formatShiftHours(shift) ? ` (${formatShiftHours(shift)})` : ""}
              </option>
            ))}
          </SelectField>
        </FormField>
        <FormField label="Account Status">
          <SelectField value={form.status} onChange={(value) => updateField("status", value)} disabled={protectedStatus}>
            {accountStatuses.map((status) => <option key={status} value={status}>{formatAccountStatus(status)}</option>)}
          </SelectField>
        </FormField>
        <FormField label={mode === "edit" ? "New Password" : "Password"}>
          <div className="relative">
            <input
              className={cn(inputClass, "pr-9")}
              type={showPassword ? "text" : "password"}
              value={form.password}
              onChange={(event) => updateField("password", event.target.value)}
              placeholder={mode === "edit" ? "Leave blank to keep current password" : "Minimum 8 characters"}
              required={mode !== "edit"}
              minLength={form.password || mode !== "edit" ? 8 : undefined}
            />
            <button
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((current) => !current)}
              className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <span className="block text-[10px] font-normal leading-4 text-muted-foreground">
            Minimum 8 characters, including uppercase, lowercase, number, and special character.
          </span>
        </FormField>
      </div>
      {isWarehouseStaff && (
        <div className="rounded border border-info/30 bg-info/10 px-3 py-2 text-[11px] text-info">
          Warehouse Staff require both a warehouse and shift assignment.
        </div>
      )}
      {isWarehouseSupervisor && (
        <div className="rounded border border-info/30 bg-info/10 px-3 py-2 text-[11px] text-info">
          Warehouse Supervisors require a warehouse assignment. Shift assignment is optional.
        </div>
      )}
      {isSystemAdministrator && (
        <div className="rounded border border-info/30 bg-info/10 px-3 py-2 text-[11px] text-info">
          System Administrators have system-wide access. Warehouse, shift, and scanner assignments do not apply.
        </div>
      )}
      {protectedRole && (
        <div className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          This is the only active System Administrator. Create or reactivate another administrator before demoting or deactivating it.
        </div>
      )}
      {warehouseChanged && canOwnWarehouseTasks && (
        <div className="space-y-2 rounded border border-warning/30 bg-warning/10 px-3 py-3 text-[11px] text-warning">
          <div className="font-semibold">Warehouse transfer check</div>
          {pendingTasksLoading ? (
            <div>Checking pending warehouse tasks...</div>
          ) : pendingTaskCount > 0 ? (
            <>
              <div>
                Cannot transfer this user until pending tasks are completed or reassigned.
              </div>
              <div className="space-y-1">
                {pendingTasks.tasks.map((task) => (
                  <div key={task.code} className="flex items-center justify-between gap-3 rounded border border-warning/25 bg-background/70 px-2 py-1.5">
                    <span>{task.label}</span>
                    <strong>{task.count}</strong>
                  </div>
                ))}
              </div>
              <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                <SelectField
                  value={reassignTargetId}
                  onChange={setReassignTargetId}
                  disabled={reassigning || reassignmentCandidates.length === 0}
                >
                  <option value="">Select reassignment target</option>
                  {reassignmentCandidates.map((candidate) => (
                    <option key={candidate.id} value={String(candidate.id)}>
                      {candidate.full_name || candidate.username}
                    </option>
                  ))}
                </SelectField>
                <ToolbarButton
                  icon={reassigning ? Loader2 : RefreshCw}
                  variant="warning"
                  disabled={!reassignTargetId || reassigning}
                  onClick={reassignPendingTasks}
                >
                  {reassigning ? "Reassigning" : "Reassign"}
                </ToolbarButton>
              </div>
              {reassignmentCandidates.length === 0 && (
                <div>No active user with the same role and current warehouse is available for reassignment.</div>
              )}
            </>
          ) : (
            <div>No pending tasks are blocking this transfer.</div>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <ToolbarButton icon={X} variant="secondary" onClick={onCancel} disabled={saving}>Cancel</ToolbarButton>
        <ToolbarButton icon={saving ? Loader2 : CheckCircle2} type="submit" disabled={saving || referenceLoading || pendingTaskCount > 0}>
          {saving ? "Saving" : "Save User"}
        </ToolbarButton>
      </div>
    </form>
  );
}

function ResetUserPasswordForm({ user, onCancel, onSave }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (password !== confirmation) {
      setError("Password confirmation does not match.");
      return;
    }

    setSaving(true);
    try {
      await onSave(password);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <div className="rounded border border-border bg-muted/20 px-3 py-3 text-xs">
        <div className="font-semibold">{user?.full_name || user?.username}</div>
        <div className="mt-1 text-muted-foreground">
          Existing sessions will be closed and this temporary password must be changed at the next sign-in.
        </div>
      </div>
      {error && <ErrorState message={error} />}
      <FormField label="Temporary Password">
        <input className={inputClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        <span className="block text-[10px] font-normal leading-4 text-muted-foreground">
          Minimum 8 characters, including uppercase, lowercase, number, and special character.
        </span>
      </FormField>
      <FormField label="Confirm Temporary Password">
        <input className={inputClass} type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
      </FormField>
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <ToolbarButton variant="secondary" onClick={onCancel} disabled={saving}>Cancel</ToolbarButton>
        <ToolbarButton icon={saving ? Loader2 : KeyRound} type="submit" disabled={saving}>
          {saving ? "Resetting..." : "Reset Password"}
        </ToolbarButton>
      </div>
    </form>
  );
}

function RolesPermissionsPage() {
  const roles = useApiCollection(() => getAdminRoles(), "roles-permissions");
  const permissions = useApiCollection(() => getAdminPermissions(), "permissions-catalog");
  const roleRows = roles.rows;
  const [selectedRole, setSelectedRole] = useState("");
  const [assigned, setAssigned] = useState([]);
  const [loadingAssigned, setLoadingAssigned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedRole && roleRows[0]?.public_reference) {
      setSelectedRole(roleRows[0].public_reference);
    }
  }, [roleRows, selectedRole]);

  useEffect(() => {
    if (!selectedRole) return;
    let cancelled = false;
    setLoadingAssigned(true);
    setError("");
    getAdminRolePermissions(selectedRole)
      .then((response) => {
        if (!cancelled) setAssigned(response.data?.permission_keys || []);
      })
      .catch((loadError) => {
        if (!cancelled) setError(getErrorMessage(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoadingAssigned(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRole]);

  const togglePermission = (permissionKey) => {
    setAssigned((current) => (
      current.includes(permissionKey)
        ? current.filter((key) => key !== permissionKey)
        : [...current, permissionKey]
    ));
  };

  const savePermissions = async () => {
    setSaving(true);
    setError("");
    try {
      await updateAdminRolePermissions(selectedRole, assigned);
      toast.success("Role permissions updated.");
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const selectedRoleName = roleRows.find((role) => role.public_reference === selectedRole)?.role_name || "role";

  return (
    <>
      <PageHeader
        eyebrow="System Management"
        title="Roles & Permissions"
        description="Database-backed role permissions for WMS modules and operational actions."
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
                  <button
                    type="button"
                    key={role.public_reference || role.role_name}
                    onClick={() => setSelectedRole(role.public_reference)}
                    className={cn(
                      "w-full rounded border border-border bg-muted/20 px-3 py-2 text-left text-xs",
                      selectedRole === role.public_reference && "border-info bg-info/10"
                    )}
                  >
                    <div className="font-semibold">{role.role_name}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{role.role_description || "Scoped system access"}</div>
                    {role.user_count !== undefined && <div className="mt-1 text-[11px] text-muted-foreground">{formatCount(role.user_count)} assigned users</div>}
                  </button>
                ))}
              </div>
            )}
          </SectionCard>
          <SectionCard title={`Permissions for ${selectedRoleName}`} icon={KeyRound}>
            {error && <div className="mb-3"><ErrorState message={error} /></div>}
            <DataTable
              loading={permissions.loading || loadingAssigned}
              error={permissions.error}
              rows={permissions.rows}
              emptyTitle="No permissions configured"
              columns={[
                { key: "module", label: "Module", className: "font-semibold" },
                { key: "permission_key", label: "Permission", className: "font-mono" },
                { key: "description", label: "Description" },
                { key: "system_protected", label: "Protected", render: (row) => row.system_protected ? <StatusBadge tone="warning">Protected</StatusBadge> : <StatusBadge tone="muted">Configurable</StatusBadge> },
                {
                  key: "assigned",
                  label: "Assigned",
                  render: (row) => (
                    <input
                      type="checkbox"
                      checked={assigned.includes(row.permission_key)}
                      disabled={row.system_protected && assigned.includes(row.permission_key)}
                      onChange={() => togglePermission(row.permission_key)}
                      aria-label={`Toggle ${row.permission_key}`}
                    />
                  )
                }
              ]}
            />
            <div className="mt-3 flex justify-end">
              <ToolbarButton icon={saving ? Loader2 : Save} onClick={savePermissions} disabled={!selectedRole || saving}>
                {saving ? "Saving..." : "Save Permissions"}
              </ToolbarButton>
            </div>
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function ShiftFormFields({ form, setForm }) {
  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  return (
    <>
      <FormField label="Shift Name"><input className={inputClass} value={form.shift_name} onChange={(event) => setField("shift_name", event.target.value)} required /></FormField>
      <FormField label="Shift Code"><input className={inputClass} value={form.shift_code} onChange={(event) => setField("shift_code", event.target.value.toUpperCase())} required /></FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Start Time"><input className={inputClass} type="time" value={form.start_time} onChange={(event) => setField("start_time", event.target.value)} required /></FormField>
        <FormField label="End Time"><input className={inputClass} type="time" value={form.end_time} onChange={(event) => setField("end_time", event.target.value)} required /></FormField>
      </div>
      <FormField label="Grace Minutes"><input className={inputClass} type="number" min="0" value={form.grace_period_minutes} onChange={(event) => setField("grace_period_minutes", event.target.value)} /></FormField>
      <FormField label="Effective Date"><input className={inputClass} type="date" value={form.effective_date} onChange={(event) => setField("effective_date", event.target.value)} /></FormField>
      <FormField label="Description"><input className={inputClass} value={form.description} onChange={(event) => setField("description", event.target.value)} /></FormField>
    </>
  );
}

function ShiftAssignmentPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const shifts = useApiCollection(() => getShifts(), `shift-assignment-${refreshKey}`);
  const users = useApiCollection(() => getUsers(), `shift-users-${refreshKey}`);
  const [selectedShift, setSelectedShift] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    shift_name: "",
    shift_code: "",
    start_time: "",
    end_time: "",
    description: "",
    grace_period_minutes: "",
    effective_date: "",
    status: "active"
  });
  const [assignUsername, setAssignUsername] = useState("");
  const [message, setMessage] = useState("");
  const selectedUsers = useApiCollection(
    () => selectedShift ? getShiftUsers(selectedShift) : Promise.resolve({ data: [] }),
    `shift-users-${selectedShift}-${refreshKey}`
  );
  const history = useApiCollection(() => getShiftAssignmentHistory(), `shift-history-${refreshKey}`);
  const shiftRows = shifts.rows;

  useEffect(() => {
    if (!selectedShift && shiftRows[0]?.public_reference) setSelectedShift(shiftRows[0].public_reference);
  }, [selectedShift, shiftRows]);

  const resetForm = () => {
    setEditing(null);
    setForm({
      shift_name: "",
      shift_code: "",
      start_time: "",
      end_time: "",
      description: "",
      grace_period_minutes: "",
      effective_date: "",
      status: "active"
    });
  };

  const editShift = (shift) => {
    setEditing(shift);
    setForm({
      shift_name: shift.shift_name || "",
      shift_code: shift.shift_code || "",
      start_time: shift.start_time || "",
      end_time: shift.end_time || "",
      description: shift.description || "",
      grace_period_minutes: shift.grace_period_minutes ?? "",
      effective_date: shift.effective_date ? String(shift.effective_date).slice(0, 10) : "",
      status: String(shift.status || "Active").toLowerCase()
    });
  };

  const submitShift = async (event) => {
    event.preventDefault();
    setMessage("");
    try {
      if (editing) {
        await updateShift(editing.public_reference, form);
        setMessage("Shift updated.");
      } else {
        await createShift(form);
        setMessage("Shift created.");
      }
      resetForm();
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  };

  const changeStatus = async (shift) => {
    setMessage("");
    try {
      const nextStatus = shift.status === "Active" ? "inactive" : "active";
      await updateShiftStatus(shift.public_reference, nextStatus);
      setMessage(`Shift ${nextStatus === "active" ? "activated" : "deactivated"}.`);
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  };

  const assignUser = async () => {
    if (!selectedShift || !assignUsername) return;
    setMessage("");
    try {
      await assignUserToShift(selectedShift, { username: assignUsername });
      setAssignUsername("");
      setMessage("User assigned to shift.");
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  };

  const removeAssignment = async (username) => {
    setMessage("");
    try {
      await removeUserFromShift(selectedShift, username, "Removed by System Admin.");
      setMessage("Shift assignment removed.");
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="System Management"
        title="Shift Assignment"
        description="Create shifts, manage activation, assign users, and preserve assignment history."
      />
      <div className="flex-1 overflow-auto p-4">
        {message && <div className="mb-3 rounded border border-info/30 bg-info/10 px-3 py-2 text-xs font-semibold text-info">{message}</div>}
        <div className="grid gap-3 xl:grid-cols-[360px_1fr]">
          <SectionCard title="Create Shift" icon={CalendarClock}>
            <form className="grid gap-3" onSubmit={submitShift}>
              <ShiftFormFields form={form} setForm={setForm} />
              <div className="flex justify-end gap-2">
                <ToolbarButton icon={Save} type="submit">Create Shift</ToolbarButton>
              </div>
            </form>
          </SectionCard>
          <div className="space-y-3">
            <SectionCard title="Configured Shifts" icon={CalendarClock}>
              <DataTable
                loading={shifts.loading}
                error={shifts.error}
                rows={shiftRows}
                emptyTitle="No shifts configured"
                emptyBody="Create the first operational shift before assigning Warehouse Staff users."
                columns={[
                  { key: "shift_code", label: "Code", className: "font-mono font-semibold" },
                  { key: "shift_name", label: "Name" },
                  { key: "hours", label: "Hours", render: (row) => formatShiftHours(row) },
                  { key: "status", label: "Status", render: (row) => <StatusBadge tone={row.status === "Active" ? "success" : "muted"}>{row.status}</StatusBadge> },
                  { key: "assigned_user_count", label: "Users" },
                  { key: "actions", label: "Actions", render: (row) => (
                    <div className="flex flex-wrap gap-1">
                      <button type="button" onClick={() => setSelectedShift(row.public_reference)} className="rounded border border-border px-2 py-1 text-[11px] font-semibold">Users</button>
                      <button type="button" onClick={() => editShift(row)} className="rounded border border-border px-2 py-1 text-[11px] font-semibold">Edit</button>
                      <button type="button" onClick={() => changeStatus(row)} className="rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] font-semibold text-warning">{row.status === "Active" ? "Deactivate" : "Activate"}</button>
                    </div>
                  ) }
                ]}
              />
            </SectionCard>
            <SectionCard title="Assigned Users" icon={Users}>
              <div className="mb-3 grid gap-2 md:grid-cols-[1fr_auto]">
                <select className={inputClass} value={assignUsername} onChange={(event) => setAssignUsername(event.target.value)}>
                  <option value="">Select user to assign</option>
                  {users.rows.map((user) => <option key={user.username} value={user.username}>{user.full_name} ({user.username})</option>)}
                </select>
                <ToolbarButton icon={UserPlus} onClick={assignUser} disabled={!selectedShift || !assignUsername}>Assign</ToolbarButton>
              </div>
              <DataTable
                loading={selectedUsers.loading}
                error={selectedUsers.error}
                rows={selectedUsers.rows}
                emptyTitle="No users assigned"
                columns={[
                  { key: "full_name", label: "User", className: "font-semibold" },
                  { key: "username", label: "Username" },
                  { key: "role_name", label: "Role" },
                  { key: "status", label: "Status", render: (row) => <StatusBadge tone={accountStatusTone(row.status)}>{formatAccountStatus(row.status)}</StatusBadge> },
                  { key: "actions", label: "Actions", render: (row) => <button type="button" onClick={() => removeAssignment(row.username)} className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] font-semibold text-destructive">Remove</button> }
                ]}
              />
            </SectionCard>
            <SectionCard title="Shift Assignment History" icon={Activity}>
              <DataTable
                loading={history.loading}
                error={history.error}
                rows={history.rows}
                emptyTitle="No shift assignment history"
                columns={[
                  { key: "public_reference", label: "History Ref", className: "font-mono font-semibold" },
                  { key: "username", label: "User" },
                  { key: "action", label: "Action" },
                  { key: "shift_code", label: "Shift" },
                  { key: "created_at", label: "Time", render: (row) => formatDateTime(row.created_at) }
                ]}
              />
            </SectionCard>
          </div>
        </div>
      </div>
      <EnterpriseModal open={Boolean(editing)} title="Edit Shift" subtitle="Update the selected shift's schedule and operational details." onClose={resetForm}>
        {editing && (
          <form className="grid gap-3" onSubmit={submitShift}>
            <ShiftFormFields form={form} setForm={setForm} />
            <div className="flex justify-end gap-2">
              <ToolbarButton variant="secondary" onClick={resetForm}>Cancel</ToolbarButton>
              <ToolbarButton icon={Save} type="submit">Save Shift</ToolbarButton>
            </div>
          </form>
        )}
      </EnterpriseModal>
    </>
  );
}

function WarehouseAssignmentPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedWarehouse, setSelectedWarehouse] = useState("");
  const [assignUsername, setAssignUsername] = useState("");
  const [message, setMessage] = useState("");
  const users = useApiCollection(() => getUsers(), `warehouse-assignment-users-${refreshKey}`);
  const warehouses = useApiCollection(() => getWarehouses(), `warehouse-assignment-warehouses-${refreshKey}`);
  const assignments = useApiCollection(() => getWarehouseAssignments(), `warehouse-assignments-${refreshKey}`);
  const history = useApiCollection(() => getWarehouseAssignmentHistory(), `warehouse-assignment-history-${refreshKey}`);

  useEffect(() => {
    if (!selectedWarehouse) {
      const active = warehouses.rows.find((warehouse) => formatAccountStatus(warehouse.status) === "Active");
      if (active?.warehouse_code) setSelectedWarehouse(active.warehouse_code);
    }
  }, [selectedWarehouse, warehouses.rows]);

  const assignUser = async () => {
    if (!selectedWarehouse || !assignUsername) return;
    setMessage("");
    try {
      await assignUserToWarehouse(selectedWarehouse, { username: assignUsername });
      setAssignUsername("");
      setMessage("Warehouse assignment updated.");
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  };

  const removeAssignment = async (username, warehouseReference = selectedWarehouse) => {
    setMessage("");
    try {
      await removeUserFromWarehouse(warehouseReference, username, "Removed by System Admin.");
      setMessage("Warehouse assignment removed.");
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="System Management"
        title="Warehouse Assignment"
        description="Assign users to warehouses, remove assignments, and preserve assignment history."
      />
      <div className="flex-1 overflow-auto p-4">
        {message && <div className="mb-3 rounded border border-info/30 bg-info/10 px-3 py-2 text-xs font-semibold text-info">{message}</div>}
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            {warehouses.rows.map((warehouse) => (
              <SectionCard key={warehouse.warehouse_code} title={`${warehouse.warehouse_code} - ${warehouse.warehouse_name}`} icon={Warehouse}>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <StatusBadge tone={accountStatusTone(warehouse.status)}>{formatAccountStatus(warehouse.status)}</StatusBadge>
                  <span className="text-muted-foreground">{formatCount(warehouse.assigned_user_count)} assigned users</span>
                </div>
              </SectionCard>
            ))}
          </div>
          <SectionCard title="Assign User" icon={UserPlus}>
            <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <select className={inputClass} value={selectedWarehouse} onChange={(event) => setSelectedWarehouse(event.target.value)}>
                <option value="">Select warehouse</option>
                {warehouses.rows
                  .filter((warehouse) => formatAccountStatus(warehouse.status) === "Active")
                  .map((warehouse) => <option key={warehouse.warehouse_code} value={warehouse.warehouse_code}>{warehouse.warehouse_code} - {warehouse.warehouse_name}</option>)}
              </select>
              <select className={inputClass} value={assignUsername} onChange={(event) => setAssignUsername(event.target.value)}>
                <option value="">Select user</option>
                {users.rows.map((user) => <option key={user.username} value={user.username}>{user.full_name} ({user.username})</option>)}
              </select>
              <ToolbarButton icon={UserPlus} onClick={assignUser} disabled={!selectedWarehouse || !assignUsername}>Assign</ToolbarButton>
            </div>
          </SectionCard>
          <SectionCard title="Warehouse Scope Assignments" icon={Warehouse}>
            <DataTable
              loading={assignments.loading}
              error={assignments.error}
              rows={assignments.rows}
              emptyTitle="No warehouse assignments loaded"
              emptyBody="Assign users to active warehouses to populate this list."
              columns={[
                { key: "full_name", label: "User", className: "font-semibold" },
                { key: "role", label: "Role", render: (row) => row.role_name || "No role" },
                { key: "warehouse", label: "Assigned Warehouse", render: (row) => row.warehouse_reference ? `${row.warehouse_reference} - ${row.warehouse_name}` : "No warehouse" },
                { key: "status", label: "Status", render: (row) => <StatusBadge tone={accountStatusTone(row.user_status)}>{formatAccountStatus(row.user_status)}</StatusBadge> },
                { key: "actions", label: "Actions", render: (row) => row.warehouse_reference && (
                  <button type="button" onClick={() => removeAssignment(row.username, row.warehouse_reference)} className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] font-semibold text-destructive">Remove</button>
                ) }
              ]}
            />
          </SectionCard>
          <SectionCard title="Warehouse Assignment History" icon={Activity}>
            <DataTable
              loading={history.loading}
              error={history.error}
              rows={history.rows}
              emptyTitle="No warehouse assignment history"
              columns={[
                { key: "public_reference", label: "History Ref", className: "font-mono font-semibold" },
                { key: "username", label: "User" },
                { key: "action", label: "Action" },
                { key: "warehouse_reference", label: "Warehouse" },
                { key: "created_at", label: "Time", render: (row) => formatDateTime(row.created_at) }
              ]}
            />
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function HierarchySelector({
  warehouses,
  zones,
  racks,
  levels,
  selectedWarehouse,
  selectedZone,
  selectedRack,
  selectedLevel,
  setSelectedWarehouse,
  setSelectedZone,
  setSelectedRack,
  setSelectedLevel,
  needZone = true,
  needRack,
  needLevel,
  loading
}) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <FormField label="Warehouse">
        <select className={inputClass} value={selectedWarehouse} onChange={(event) => {
          setSelectedWarehouse(event.target.value);
        }}>
          <option value="">{loading.warehouses ? "Loading warehouses..." : "Select warehouse"}</option>
          {warehouses.map((wh) => (
            <option key={wh.id} value={wh.id}>
              {wh.warehouse_code} - {wh.warehouse_name}
            </option>
          ))}
        </select>
      </FormField>

      {needZone && (
        <FormField label="Zone">
          <select className={inputClass} value={selectedZone} onChange={(event) => setSelectedZone(event.target.value)} disabled={!selectedWarehouse}>
            <option value="">{loading.zones ? "Loading zones..." : "Select zone"}</option>
            {zones.map((zone) => (
              <option key={getRecordId(zone, "zone_id")} value={getRecordId(zone, "zone_id")}>
                {getZoneLabel(zone)}
              </option>
            ))}
          </select>
        </FormField>
      )}

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
  const [warehouses, setWarehouses] = useState([]);
  const [zones, setZones] = useState([]);
  const [racks, setRacks] = useState([]);
  const [levels, setLevels] = useState([]);
  const [bins, setBins] = useState([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState("");
  const [selectedZone, setSelectedZone] = useState("");
  const [selectedRack, setSelectedRack] = useState("");
  const [selectedLevel, setSelectedLevel] = useState("");
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState({
    warehouses: true,
    zones: false,
    racks: false,
    levels: false,
    bins: false
  });

  useEffect(() => {
    let active = true;
    const loadWarehouses = async () => {
      setLoading((current) => ({ ...current, warehouses: true }));
      setError("");
      try {
        const response = await getWarehouses();
        if (active) {
          const list = response.data || [];
          setWarehouses(list);
        }
      } catch (err) {
        if (active) setError(getErrorMessage(err));
      } finally {
        if (active) setLoading((current) => ({ ...current, warehouses: false }));
      }
    };
    loadWarehouses();
    return () => {
      active = false;
    };
  }, [refreshKey]);

  useEffect(() => {
    setZones([]);
    setRacks([]);
    setLevels([]);
    setBins([]);
    setSelectedZone("");
    setSelectedRack("");
    setSelectedLevel("");

    if (!selectedWarehouse) return undefined;

    let active = true;
    const loadZones = async () => {
      setLoading((current) => ({ ...current, zones: true }));
      setError("");
      try {
        const response = await getZones({ warehouse_id: selectedWarehouse });
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
  }, [selectedWarehouse, refreshKey]);

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
  }, [selectedZone, refreshKey]);

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
  }, [selectedRack, refreshKey]);

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
  }, [selectedLevel, refreshKey]);

  return {
    warehouses,
    zones,
    racks,
    levels,
    bins,
    selectedWarehouse,
    selectedZone,
    selectedRack,
    selectedLevel,
    setSelectedWarehouse,
    setSelectedZone,
    setSelectedRack,
    setSelectedLevel,
    refresh: () => setRefreshKey((current) => current + 1),
    loading,
    error
  };
}

function WarehouseConfigDrawer({ action, scope, hierarchy, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!action) return;

    const row = action.row || {};
    setError("");
    setForm({
      warehouse_id: String(row.warehouse_id || hierarchy.selectedWarehouse || ""),
      zone_id: String(row.zone_id || hierarchy.selectedZone || ""),
      rack_id: String(row.rack_id || hierarchy.selectedRack || ""),
      level_id: String(row.level_id || hierarchy.selectedLevel || ""),
      zone_letter: row.zone_letter || String(row.zone_code || "").replace(/^Z-/i, ""),
      zone_code: row.zone_code || row.code || "",
      zone_name: row.zone_name || row.name || "",
      zone_type: row.zone_type || "Standard",
      allowed_cargo_type: row.allowed_cargo_type || "",
      description: row.description || "",
      handling_condition: row.handling_condition || "",
      status: row.creation_status || row.status || "Active",
      rack_letter: row.rack_letter || String(row.rack_code || "").replace(/^R-/i, ""),
      rack_code: row.rack_code || row.code || "",
      name: row.rack_name || row.name || "",
      level_code: row.level_code || row.code || "",
      level_number: row.level_number || "",
      bin_identifier: row.bin_identifier || String(row.bin_code || "").replace(/^B-/i, ""),
      bin_code: row.bin_code || row.code || "",
      barcode: row.barcode || "",
      max_weight: row.max_weight ?? "",
      max_volume: row.max_volume ?? "",
      bin_type: row.bin_type || "Standard",
      length: row.length ?? "",
      width: row.width ?? "",
      height: row.height ?? "",
      cargo_restrictions: row.cargo_restrictions || "",
      reserved_for_cargo_type: row.reserved_for_cargo_type || "",
      reason: "",
      override_with_cargo: false
    });
  }, [action, hierarchy.selectedLevel, hierarchy.selectedRack, hierarchy.selectedZone, hierarchy.selectedWarehouse]);

  if (!action) return null;

  const setField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const isStatusAction = action.kind === "status";
  const isDeleteAction = action.kind === "delete";
  const isViewAction = action.kind === "view";
  const actionLabel = action.kind === "create"
    ? `Add ${scope.slice(0, -1).replace(/^./, (character) => character.toUpperCase())}`
      : action.kind === "edit"
      ? `Edit ${scope.slice(0, -1).replace(/^./, (character) => character.toUpperCase())}`
      : action.kind === "delete"
        ? `Delete ${scope === "bins" ? "Bin" : scope.slice(0, -1).replace(/^./, (character) => character.toUpperCase())}`
        : action.kind === "view"
          ? `View ${scope === "bins" ? "Bin" : scope.slice(0, -1).replace(/^./, (character) => character.toUpperCase())}`
      : `${action.status} ${scope === "bins" ? "Bin" : scope.slice(0, -1).replace(/^./, (character) => character.toUpperCase())}`;

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const id = getRecordId(action.row, `${scope.slice(0, -1)}_id`);

      if (isDeleteAction) {
        if (scope === "zones") await deleteZone(id);
        if (scope === "racks") await deleteRack(id);
        if (scope === "levels") await deleteLevel(id);
        if (scope === "bins") await deleteBin(id);
      } else if (isStatusAction) {
        if (scope === "zones") await updateZoneStatus(id, action.status);
        if (scope === "racks") await updateRackStatus(id, action.status);
        if (scope === "levels") await updateLevelStatus(id, action.status);
        if (scope === "bins") {
          await updateBinStatus(id, action.status, {
            reserved_for_cargo_type: form.reserved_for_cargo_type,
            reason: form.reason,
            override_with_cargo: form.override_with_cargo
          });
        }
      } else if (scope === "zones") {
        const payload = {
          warehouse_id: Number(form.warehouse_id),
          zone_letter: form.zone_letter,
          zone_type: form.zone_type,
          allowed_cargo_type: form.allowed_cargo_type,
          description: form.description,
          handling_condition: form.handling_condition,
          status: form.status,
          max_weight: form.max_weight,
          max_volume: form.max_volume,
          is_hazard_zone: form.zone_type === "Hazardous"
        };
        if (action.kind === "create") await createZone(payload);
        else await updateZone(id, payload);
      } else if (scope === "racks") {
        const payload = {
          zone_id: form.zone_id,
          rack_letter: form.rack_letter,
          max_weight: form.max_weight,
          max_volume: form.max_volume,
          status: form.status
        };
        if (action.kind === "create") await createRack(payload);
        else await updateRack(id, payload);
      } else if (scope === "levels") {
        const payload = {
          rack_id: form.rack_id,
          level_number: form.level_number,
          max_weight: form.max_weight,
          max_volume: form.max_volume,
          status: form.status
        };
        if (action.kind === "create") await createLevel(payload);
        else await updateLevel(id, payload);
      } else if (scope === "bins") {
        const payload = {
          level_id: form.level_id,
          bin_identifier: form.bin_identifier,
          bin_type: form.bin_type,
          length: form.length,
          width: form.width,
          height: form.height,
          weight_capacity: form.max_weight,
          volume_capacity: form.max_volume,
          allowed_cargo_type: form.allowed_cargo_type,
          cargo_restrictions: form.cargo_restrictions,
          creation_status: form.status
        };
        if (action.kind === "create") await createBin(payload);
        else await updateBin(id, payload);
      }

      onSaved(`${actionLabel} completed successfully.`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const statusDescription = action.status === "Inactive"
    ? "This is a soft deactivation. The record and any existing cargo history remain traceable, while the location stops accepting new placements."
    : action.status === "Blocked"
      ? "Blocked bins remain visible but cannot receive cargo placement."
      : action.status === "Reserved"
        ? "Reserved bins cannot be used for normal cargo placement."
        : action.status === "Maintenance"
          ? "Bins under maintenance remain visible but reject all normal placement operations."
        : "The record will become active and available only when its parent storage locations are active.";

    const viewContent = (
      <div className="grid gap-3 md:grid-cols-2">
        {getDetailViewFields(scope, action.row).map(([label, value]) => (
          <ReadonlyValue key={label} label={label} value={value} />
        ))}
      </div>
    );

    if (isViewAction) {
      return (
        <EnterpriseModal
          open
          title={actionLabel}
          subtitle="Review warehouse configuration details"
          onClose={onClose}
          size="review"
        >
          {viewContent}
        </EnterpriseModal>
      );
    }

  return (
    <Drawer open title={actionLabel} onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        {error && <ErrorState message={error} />}

          {isStatusAction || isDeleteAction ? (
          <>
            <div className="rounded border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              <div className="font-semibold text-foreground">
                {scope === "bins" ? getBinCode(action.row) : readValue(action.row, [`${scope.slice(0, -1)}_code`, "code"])}
              </div>
              <div className="mt-1">{isDeleteAction ? "Deletion succeeds only when this record has no children, cargo, placement, billing, report, barcode, or audit history. Otherwise deactivate it." : statusDescription}</div>
            </div>
            {scope === "bins" && action.status === "Reserved" && (
              <FormField label="Reservation note / cargo type">
                <input
                  className={inputClass}
                  value={form.reserved_for_cargo_type || ""}
                  onChange={(event) => setField("reserved_for_cargo_type", event.target.value)}
                  placeholder="Optional administrative note"
                />
              </FormField>
            )}
            {isStatusAction && scope === "bins" && !["Available", "Occupied", "Full"].includes(action.status) && (
              <>
                <FormField label="Reason / Justification">
                  <input className={inputClass} value={form.reason || ""} onChange={(event) => setField("reason", event.target.value)} required />
                </FormField>
                {action.status === "Inactive" && (
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={Boolean(form.override_with_cargo)} onChange={(event) => setField("override_with_cargo", event.target.checked)} />
                    Admin override if cargo is still inside
                  </label>
                )}
              </>
            )}
          </>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {scope === "zones" && (
              <>
                <FormField label="Warehouse">
                  <SelectField value={form.warehouse_id || ""} onChange={(value) => setField("warehouse_id", value)} required>
                    <option value="">Select warehouse</option>
                    {hierarchy.warehouses.map((wh) => (
                      <option key={wh.id} value={wh.id}>{wh.warehouse_code} - {wh.warehouse_name}</option>
                    ))}
                  </SelectField>
                </FormField>
                <FormField label="Zone Letter">
                  <input className={inputClass} maxLength={1} value={form.zone_letter || ""} onChange={(event) => setField("zone_letter", event.target.value.toUpperCase())} placeholder="A" required />
                </FormField>
                <FormField label="Generated Name & Code">
                  <input className={inputClass} value={`${hierarchy.warehouses.find((item) => String(item.id) === String(form.warehouse_id))?.warehouse_code || "WH-?"}-Z-${String(form.zone_letter || "?").toUpperCase()} · Z-${String(form.zone_letter || "?").toUpperCase()}`} readOnly />
                </FormField>
                <FormField label="Zone Type">
                  <SelectField value={form.zone_type || "Standard"} onChange={(value) => setField("zone_type", value)}>
                    <option value="Standard">Standard</option>
                    <option value="Hazardous">Hazardous</option>
                    <option value="Controlled">Controlled</option>
                  </SelectField>
                </FormField>
                <FormField label="Allowed Cargo Type">
                  <SelectField value={form.allowed_cargo_type || ""} onChange={(value) => setField("allowed_cargo_type", value)} required>
                    <option value="">Select cargo type</option>
                    {warehouseCargoTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                  </SelectField>
                </FormField>
                <FormField label="Handling Condition (optional)">
                  <input className={inputClass} value={form.handling_condition || ""} onChange={(event) => setField("handling_condition", event.target.value)} />
                </FormField>
              </>
            )}

            {scope === "racks" && (
              <>
                <FormField label="Parent Zone">
                  <SelectField value={form.zone_id || ""} onChange={(value) => setField("zone_id", value)} required>
                    <option value="">Select zone</option>
                    {hierarchy.zones.map((zone) => (
                      <option key={getRecordId(zone, "zone_id")} value={getRecordId(zone, "zone_id")}>{getZoneLabel(zone)}</option>
                    ))}
                  </SelectField>
                </FormField>
                <FormField label="Rack Letter">
                  <input className={inputClass} maxLength={1} value={form.rack_letter || ""} onChange={(event) => setField("rack_letter", event.target.value.toUpperCase())} placeholder="A" required />
                </FormField>
                <FormField label="Generated Name & Code">
                  <input className={inputClass} value={`${hierarchy.zones.find((item) => String(getRecordId(item, "zone_id")) === String(form.zone_id))?.zone_name || "WH-?-Z-?"}-R-${String(form.rack_letter || "?").toUpperCase()} · R-${String(form.rack_letter || "?").toUpperCase()}`} readOnly />
                </FormField>
              </>
            )}

            {scope === "levels" && (
              <>
                <FormField label="Parent Rack">
                  <SelectField value={form.rack_id || ""} onChange={(value) => setField("rack_id", value)} required>
                    <option value="">Select rack</option>
                    {hierarchy.racks.map((rack) => (
                      <option key={getRecordId(rack, "rack_id")} value={getRecordId(rack, "rack_id")}>{getRackCode(rack)}</option>
                    ))}
                  </SelectField>
                </FormField>
                <FormField label="Level Number">
                  <input className={inputClass} type="number" min="1" step="1" value={form.level_number || ""} onChange={(event) => setField("level_number", event.target.value)} required />
                </FormField>
                <FormField label="Generated Name & Code">
                  <input className={inputClass} value={`${hierarchy.racks.find((item) => String(getRecordId(item, "rack_id")) === String(form.rack_id))?.rack_name || "WH-?-Z-?-R-?"}-L-${form.level_number || "?"} · L-${form.level_number || "?"}`} readOnly />
                </FormField>
              </>
            )}

            {scope === "bins" && (
              <>
                <FormField label="Parent Level">
                  <SelectField value={form.level_id || ""} onChange={(value) => setField("level_id", value)} required>
                    <option value="">Select level</option>
                    {hierarchy.levels.map((level) => (
                      <option key={getRecordId(level, "level_id")} value={getRecordId(level, "level_id")}>{getLevelCode(level)}</option>
                    ))}
                  </SelectField>
                </FormField>
                <FormField label="Bin Number / Letter">
                  <input className={inputClass} value={form.bin_identifier || ""} onChange={(event) => setField("bin_identifier", event.target.value.toUpperCase())} placeholder="1 or A" required />
                </FormField>
                <FormField label="Generated Name & Code">
                  <input className={inputClass} value={`${hierarchy.levels.find((item) => String(getRecordId(item, "level_id")) === String(form.level_id))?.level_name || "WH-?-Z-?-R-?-L-?"}-B-${form.bin_identifier || "?"} · B-${form.bin_identifier || "?"}`} readOnly />
                </FormField>
                <FormField label="Bin Type">
                  <SelectField value={form.bin_type || "Standard"} onChange={(value) => setField("bin_type", value)}>
                    <option value="Standard">Standard</option>
                    <option value="Fragile">Fragile</option>
                    <option value="Customs Hold">Customs Hold</option>
                    <option value="Restricted">Restricted</option>
                  </SelectField>
                </FormField>
                {["length", "width", "height"].map((dimension) => (
                  <FormField key={dimension} label={`${dimension.charAt(0).toUpperCase() + dimension.slice(1)} (m)`}>
                    <input className={inputClass} type="number" min="0.001" step="0.001" value={form[dimension] ?? ""} onChange={(event) => setField(dimension, event.target.value)} required />
                  </FormField>
                ))}
                <FormField label="Cargo Restrictions (optional)">
                  <input className={inputClass} value={form.cargo_restrictions || ""} onChange={(event) => setField("cargo_restrictions", event.target.value)} placeholder="e.g. Customs hold" />
                </FormField>
              </>
            )}

            {scope !== "zones" && (
              <FormField label="Maximum Weight (kg)">
                <input className={inputClass} type="number" min="0.01" step="0.01" value={form.max_weight ?? ""} onChange={(event) => setField("max_weight", event.target.value)} required />
              </FormField>
            )}
            {scope === "bins" && (
              <FormField label="Volume Capacity (m3, optional override)">
                <input className={inputClass} type="number" min="0.001" step="0.001" value={form.max_volume ?? ""} onChange={(event) => setField("max_volume", event.target.value)} />
              </FormField>
            )}
            {action.kind === "create" && (
              <FormField label="Status">
                <SelectField value={form.status || "Active"} onChange={(value) => setField("status", value)}>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </SelectField>
              </FormField>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <ToolbarButton variant="secondary" onClick={onClose} disabled={saving}>Cancel</ToolbarButton>
          {!isViewAction && (
            <ToolbarButton icon={saving ? Loader2 : CheckCircle2} type="submit" disabled={saving}>
              {saving ? "Saving..." : actionLabel}
            </ToolbarButton>
          )}
        </div>
      </form>
    </Drawer>
  );
}

function WarehouseFormDrawer({ mode, warehouse, onClose, onSave }) {
  const [form, setForm] = useState({
    warehouse_letter: "",
    total_capacity: "",
    description: "",
    status: "Active"
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (warehouse) {
      setForm({
        warehouse_letter: warehouse.warehouse_letter || String(warehouse.warehouse_code || "").replace(/^WH-/i, ""),
        total_capacity: warehouse.total_capacity || "",
        description: warehouse.description || "",
        status: warehouse.status || "Active"
      });
    }
  }, [warehouse]);

  const setField = (field, value) => {
    setForm((curr) => ({ ...curr, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      await onSave(form, warehouse?.id);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open title={mode === "create" ? "Add Warehouse" : "Edit Warehouse"} onClose={onClose}>
      <form className="space-y-3" onSubmit={handleSubmit}>
        {error && <ErrorState message={error} />}

        <FormField label="Warehouse Letter">
          <input
            className={inputClass}
            maxLength={1}
            value={form.warehouse_letter}
            onChange={(e) => setField("warehouse_letter", e.target.value.toUpperCase())}
            placeholder="A"
            required
          />
        </FormField>

        <FormField label="Generated Name & Code">
          <input
            className={inputClass}
            value={`Warehouse ${form.warehouse_letter || "?"} · WH-${form.warehouse_letter || "?"}`}
            readOnly
          />
        </FormField>

        <FormField label="Total Capacity (kg)">
          <input
            className={inputClass}
            type="number"
            min="0.01"
            max="999999999999999"
            step="0.01"
            value={form.total_capacity}
            onChange={(e) => setField("total_capacity", e.target.value)}
            required
          />
        </FormField>

        <FormField label="Location / Description (optional)">
          <input className={inputClass} value={form.description} onChange={(e) => setField("description", e.target.value)} />
        </FormField>

        <FormField label="Status">
          <SelectField value={form.status} onChange={(value) => setField("status", value)}>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </SelectField>
        </FormField>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <ToolbarButton variant="secondary" onClick={onClose} disabled={saving}>Cancel</ToolbarButton>
          <ToolbarButton icon={saving ? Loader2 : CheckCircle2} type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </ToolbarButton>
        </div>
      </form>
    </Drawer>
  );
}

function WarehousesPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [drawerMode, setDrawerMode] = useState("");
  const [selectedWarehouse, setSelectedWarehouse] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionError, setActionError] = useState("");
  const [busyWarehouseId, setBusyWarehouseId] = useState("");
  const [detailsWarehouse, setDetailsWarehouse] = useState(null);
  const warehouses = useApiCollection(() => getWarehouses(), `warehouses-${refreshKey}`);

  const filteredWarehouses = useMemo(() => {
    return (warehouses.rows || []).filter((wh) => {
      const statusMatch = statusFilter === "All statuses" || wh.status === statusFilter;
      const searchMatch = !searchTerm ||
        wh.warehouse_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        wh.warehouse_code.toLowerCase().includes(searchTerm.toLowerCase());
      return statusMatch && searchMatch;
    });
  }, [searchTerm, statusFilter, warehouses.rows]);

  const refreshWarehouses = () => setRefreshKey((current) => current + 1);

  const openCreateDrawer = () => {
    setSelectedWarehouse(null);
    setActionError("");
    setDrawerMode("create");
  };

  const openEditDrawer = (wh) => {
    setSelectedWarehouse(wh);
    setActionError("");
    setDrawerMode("edit");
  };

  const closeDrawer = () => {
    setDrawerMode("");
    setSelectedWarehouse(null);
  };

  const saveWarehouse = async (payload, warehouseId) => {
    const response = warehouseId ? await updateWarehouse(warehouseId, payload) : await createWarehouse(payload);
    closeDrawer();
    refreshWarehouses();
    toast.success(warehouseId ? "Warehouse updated." : "Warehouse created.");
    return response;
  };

  const toggleStatus = async (wh) => {
    const nextStatus = wh.status === "Active" ? "Inactive" : "Active";
    if (nextStatus === "Inactive" && !window.confirm(`Deactivate ${wh.warehouse_name}? Child locations will stop accepting new placements.`)) return;
    setBusyWarehouseId(`status-${wh.id}`);
    setActionError("");

    try {
      await updateWarehouseStatus(wh.id, nextStatus);
      refreshWarehouses();
      toast.success(nextStatus === "Active" ? "Warehouse activated." : "Warehouse deactivated.");
    } catch (error) {
      setActionError(getErrorMessage(error));
      toast.error("Failed to update status", { description: getErrorMessage(error) });
    } finally {
      setBusyWarehouseId("");
    }
  };

  const removeWarehouse = async (wh) => {
    if (!window.confirm(`Permanently delete ${wh.warehouse_name}? This succeeds only when it has never been used.`)) return;
    setBusyWarehouseId(`delete-${wh.id}`);
    try {
      await deleteWarehouse(wh.id);
      refreshWarehouses();
      toast.success("Warehouse deleted.");
    } catch (error) {
      setActionError(getErrorMessage(error));
      toast.error("Warehouse could not be deleted", { description: getErrorMessage(error) });
    } finally {
      setBusyWarehouseId("");
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="System Configuration"
        title="Warehouses"
        description="Configure and manage system storage warehouses."
        action={
          <ToolbarButton icon={Plus} onClick={openCreateDrawer}>
            Add Warehouse
          </ToolbarButton>
        }
      />

      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-3">
          {actionError && <ErrorState message={actionError} />}

          <SectionCard title="Search & Filter" icon={Filter}>
            <div className="grid gap-3 md:grid-cols-2">
              <FormField label="Search Term">
                <input
                  className={inputClass}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by name or code..."
                />
              </FormField>

              <FormField label="Status Filter">
                <SelectField value={statusFilter} onChange={setStatusFilter}>
                  <option value="All statuses">All statuses</option>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </SelectField>
              </FormField>
            </div>
          </SectionCard>

          <SectionCard title="Warehouses Directory" icon={Warehouse}>
            {warehouses.loading && warehouses.rows.length === 0 ? (
              <LoadingState />
            ) : (
              <DataTable
                rows={filteredWarehouses}
                emptyTitle="No warehouses found"
                emptyBody="Try adjusting your filter settings or create a new warehouse."
                columns={[
                  { key: "warehouse_code", label: "Code", render: (row) => row.warehouse_code, className: "font-mono font-semibold" },
                  { key: "warehouse_name", label: "Warehouse Name", render: (row) => row.warehouse_name },
                  {
                    key: "status",
                    label: "Status",
                    render: (row) => (
                      <StatusBadge tone={row.status === "Active" ? "success" : "destructive"}>
                        {row.status}
                      </StatusBadge>
                    )
                  },
                  {
                    key: "actions",
                    label: "Actions",
                    render: (row) => {
                      const isBusy = busyWarehouseId === `status-${row.id}`;
                      return (
                        <div className="flex gap-2">
                          <button className="rounded border border-border bg-background px-2 py-1 text-[10px] font-semibold hover:bg-muted" onClick={() => setDetailsWarehouse(row)}>
                            View
                          </button>
                          <button
                            className="rounded border border-border bg-background px-2 py-1 text-[10px] font-semibold hover:bg-muted"
                            onClick={() => openEditDrawer(row)}
                          >
                            Edit
                          </button>
                          <button
                            className="rounded border border-border bg-background px-2 py-1 text-[10px] font-semibold hover:bg-muted disabled:opacity-50"
                            onClick={() => toggleStatus(row)}
                            disabled={isBusy}
                          >
                            {isBusy ? "Updating..." : row.status === "Active" ? "Deactivate" : "Activate"}
                          </button>
                          <button
                            className="rounded border border-destructive/40 bg-background px-2 py-1 text-[10px] font-semibold text-destructive hover:bg-muted disabled:opacity-50"
                            onClick={() => removeWarehouse(row)}
                            disabled={busyWarehouseId === `delete-${row.id}`}
                          >
                            Delete
                          </button>
                        </div>
                      );
                    }
                  }
                ]}
              />
            )}
          </SectionCard>
        </div>
      </div>

      {drawerMode && (
        <WarehouseFormDrawer
          mode={drawerMode}
          warehouse={selectedWarehouse}
          onClose={closeDrawer}
          onSave={saveWarehouse}
        />
      )}
      <EnterpriseModal
        open={Boolean(detailsWarehouse)}
        title={detailsWarehouse?.warehouse_name || "Warehouse details"}
        subtitle={detailsWarehouse?.warehouse_code}
        onClose={() => setDetailsWarehouse(null)}
      >
        {detailsWarehouse && (
          <div className="grid gap-3 text-xs md:grid-cols-2">
            {getDetailViewFields("warehouses", detailsWarehouse).map(([label, value]) => (
              <ReadonlyValue key={label} label={label} value={value} />
            ))}
          </div>
        )}
      </EnterpriseModal>
    </>
  );
}

function WarehouseConfigPage({ scope }) {
  const hierarchy = useWarehouseHierarchy();
  const [action, setAction] = useState(null);
  const [labelBin, setLabelBin] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [generating, setGenerating] = useState(false);
  const binLabelRef = useRef(null);
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

  const actionButtonClass = "rounded border border-border bg-background px-2 py-1 text-[10px] font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

  const hierarchyActions = (row) => (
    <div className="flex flex-wrap gap-1">
      <button className={actionButtonClass} type="button" onClick={() => setAction({ kind: "view", row })}>View</button>
      <button className={actionButtonClass} type="button" onClick={() => setAction({ kind: "edit", row })}>Edit</button>
      <button
        className={actionButtonClass}
        type="button"
        onClick={() => setAction({ kind: "status", row, status: row.active === false ? "Active" : "Inactive" })}
      >
        {row.active === false ? "Activate" : "Deactivate"}
      </button>
      <button className={actionButtonClass} type="button" onClick={() => setAction({ kind: "delete", row })}>Delete</button>
    </div>
  );

  const columnsByScope = {
    zones: [
      { key: "zone_code", label: "Code", render: (row) => row.zone_code, className: "font-mono font-semibold" },
      { key: "zone_name", label: "Zone Name", render: (row) => row.zone_name },
      { key: "allowed_cargo_type", label: "Allowed Cargo", render: (row) => row.allowed_cargo_type },
      { key: "max_weight", label: "Max Weight", render: (row) => formatMeasure(row.max_weight, "kg") },
      { key: "max_volume", label: "Max Volume", render: (row) => formatMeasure(row.max_volume, "m3") },
      { key: "rack_total", label: "Racks", render: (row) => formatCount(row.rack_total) },
      { key: "bin_total", label: "Bins", render: (row) => formatCount(row.bin_total) },
      { key: "occupancy", label: "Occupancy", render: (row) => formatOccupancy(row) },
      { key: "status", label: "Status", render: (row) => <StatusBadge tone={row.active ? "success" : "destructive"}>{row.status}</StatusBadge> },
      { key: "actions", label: "Actions", render: hierarchyActions }
    ],
    racks: [
      { key: "rack_code", label: "Rack", render: (row) => row.rack_code, className: "font-mono font-semibold" },
      { key: "zone", label: "Parent Zone", render: (row) => `${row.zone_code} - ${row.zone_name}` },
      { key: "max_weight", label: "Max Weight", render: (row) => formatMeasure(row.max_weight, "kg") },
      { key: "max_volume", label: "Max Volume", render: (row) => formatMeasure(row.max_volume, "m3") },
      { key: "level_total", label: "Levels", render: (row) => formatCount(row.level_total) },
      { key: "bin_total", label: "Bins", render: (row) => formatCount(row.bin_total) },
      { key: "status", label: "Status", render: (row) => <StatusBadge tone={row.active ? "success" : "destructive"}>{row.status}</StatusBadge> },
      { key: "actions", label: "Actions", render: hierarchyActions }
    ],
    levels: [
      { key: "level_code", label: "Level", render: (row) => row.level_code, className: "font-mono font-semibold" },
      { key: "zone", label: "Parent Zone", render: (row) => row.zone_code },
      { key: "rack", label: "Parent Rack", render: (row) => row.rack_code },
      { key: "max_weight", label: "Max Weight", render: (row) => formatMeasure(row.max_weight, "kg") },
      { key: "max_volume", label: "Max Volume", render: (row) => formatMeasure(row.max_volume, "m3") },
      { key: "bin_total", label: "Bins", render: (row) => formatCount(row.bin_total) },
      { key: "status", label: "Status", render: (row) => <StatusBadge tone={row.active ? "success" : "destructive"}>{row.status}</StatusBadge> },
      { key: "actions", label: "Actions", render: hierarchyActions }
    ],
    bins: [
      { key: "bin_code", label: "Bin Code", render: (row) => row.bin_code, className: "font-mono font-semibold" },
      { key: "barcode", label: "Barcode", className: "font-mono" },
      { key: "allowed_cargo_type", label: "Allowed Cargo", render: (row) => row.allowed_cargo_type || "Zone rules" },
      { key: "zone", label: "Zone", render: (row) => row.zone_code },
      { key: "rack", label: "Rack", render: (row) => row.rack_code },
      { key: "level", label: "Level", render: (row) => row.level_code },
      { key: "capacity_weight", label: "Capacity Weight", render: (row) => formatMeasure(row.capacity_weight, "kg") },
      { key: "capacity_volume", label: "Capacity Volume", render: (row) => formatMeasure(row.capacity_volume, "m3") },
      { key: "current_weight", label: "Current Weight", render: (row) => formatMeasure(row.current_weight, "kg") },
      { key: "current_volume", label: "Current Volume", render: (row) => formatMeasure(row.current_volume, "m3") },
      { key: "status", label: "Status", render: (row) => <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge> },
      { key: "active", label: "Active", render: (row) => <StatusBadge tone={row.active ? "success" : "destructive"}>{row.active ? "Active" : "Inactive"}</StatusBadge> },
      {
        key: "actions",
        label: "Actions",
        render: (row) => (
          <div className="flex min-w-[180px] flex-wrap gap-1">
            <button className={actionButtonClass} type="button" onClick={() => setAction({ kind: "edit", row })}>Edit</button>
            <button className={actionButtonClass} type="button" onClick={() => setAction({ kind: "view", row })}>View</button>
            <button className={actionButtonClass} type="button" disabled={!row.active || row.status === "Blocked"} onClick={() => setAction({ kind: "status", row, status: "Blocked" })}>Block</button>
            <button className={actionButtonClass} type="button" disabled={!row.active || row.status === "Reserved"} onClick={() => setAction({ kind: "status", row, status: "Reserved" })}>Reserve</button>
            <button className={actionButtonClass} type="button" disabled={!row.active || row.status === "Maintenance"} onClick={() => setAction({ kind: "status", row, status: "Maintenance" })}>Maintenance</button>
            <button className={actionButtonClass} type="button" disabled={!row.active || row.status === "Damaged"} onClick={() => setAction({ kind: "status", row, status: "Damaged" })}>Damaged</button>
            <button className={actionButtonClass} type="button" disabled={!row.active || row.status === "Restricted"} onClick={() => setAction({ kind: "status", row, status: "Restricted" })}>Restrict</button>
            <button className={actionButtonClass} type="button" disabled={row.active && row.status === "Available"} onClick={() => setAction({ kind: "status", row, status: "Available" })}>Activate</button>
            <button className={actionButtonClass} type="button" disabled={!row.active} onClick={() => setAction({ kind: "status", row, status: "Inactive" })}>Deactivate</button>
            <button className={actionButtonClass} type="button" onClick={() => setLabelBin(row)}>View Label</button>
            <button className={actionButtonClass} type="button" onClick={() => setAction({ kind: "delete", row })}>Delete</button>
          </div>
        )
      }
    ]
  };

  const emptyTitle = {
    zones: hierarchy.selectedWarehouse ? "No zones configured for this warehouse." : "Select a warehouse to load zones",
    racks: hierarchy.selectedZone ? "No racks loaded" : "Select a zone to load racks",
    levels: hierarchy.selectedRack ? "No levels loaded" : "Select a rack to load levels",
    bins: hierarchy.selectedLevel ? "No bins loaded" : "Select a level to load bins"
  }[scope];

  const visibleRows = config.rows.filter((row) => {
    const rowStatus = row.creation_status || row.status || (row.active ? "Active" : "Inactive");
    const statusMatches = !statusFilter || rowStatus === statusFilter || (statusFilter === "Active" && row.active === true);
    const searchable = [
      row.code, row.name, row.zone_code, row.zone_name, row.rack_code,
      row.level_code, row.barcode, row.bin_identifier
    ].filter(Boolean).join(" ").toLowerCase();
    return statusMatches && (!searchTerm || searchable.includes(searchTerm.toLowerCase()));
  });

  return (
    <>
      <PageHeader
        eyebrow="Warehouse Configuration"
        title={config.title}
        description={config.description}
        action={
          <div className="flex flex-wrap gap-2">
            <ToolbarButton
              icon={Plus}
              onClick={() => setAction({ kind: "create" })}
              disabled={
                (scope === "zones" && !hierarchy.selectedWarehouse) ||
                (scope === "racks" && !hierarchy.selectedZone) ||
                (scope === "levels" && !hierarchy.selectedRack) ||
                (scope === "bins" && !hierarchy.selectedLevel)
              }
            >
              {config.addAction}
            </ToolbarButton>
          </div>
        }
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-3">
          <SectionCard title="Hierarchy Filter" icon={Warehouse}>
            <HierarchySelector
              warehouses={hierarchy.warehouses}
              zones={hierarchy.zones}
              racks={hierarchy.racks}
              levels={hierarchy.levels}
              selectedWarehouse={hierarchy.selectedWarehouse}
              selectedZone={hierarchy.selectedZone}
              selectedRack={hierarchy.selectedRack}
              selectedLevel={hierarchy.selectedLevel}
              setSelectedWarehouse={hierarchy.setSelectedWarehouse}
              setSelectedZone={hierarchy.setSelectedZone}
              setSelectedRack={hierarchy.setSelectedRack}
              setSelectedLevel={hierarchy.setSelectedLevel}
              needZone={scope !== "zones"}
              needRack={config.needRack}
              needLevel={config.needLevel}
              loading={hierarchy.loading}
            />
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <FormField label="Search">
                <input className={inputClass} value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search name, code, barcode..." />
              </FormField>
              <FormField label="Status">
                  <SelectField value={statusFilter} onChange={setStatusFilter}>
                    <option value="">All statuses</option>
                    <option value="Active">Active</option>
                    <option value="Available">Available</option>
                    <option value="Occupied">Occupied</option>
                    <option value="Full">Full</option>
                    <option value="Reserved">Reserved</option>
                    <option value="Restricted">Restricted</option>
                    <option value="Blocked">Blocked</option>
                    <option value="Maintenance">Maintenance</option>
                    <option value="Damaged">Damaged</option>
                    <option value="Inactive">Inactive</option>
                  </SelectField>
              </FormField>
            </div>
          </SectionCard>
          <SectionCard title={`${config.title} Structure`} icon={config.icon}>
            <DataTable
              rows={visibleRows}
              loading={config.loading}
              error={hierarchy.error}
              emptyTitle={emptyTitle}
              emptyBody={scope === "zones"
                ? "Create warehouses, zones, racks, levels, and bins manually from this page."
                : "Warehouse configuration records will appear when the parent storage area is selected."}
              columns={columnsByScope[scope]}
            />
          </SectionCard>
        </div>
      </div>
      <WarehouseConfigDrawer
        action={action}
        scope={scope}
        hierarchy={hierarchy}
        onClose={() => setAction(null)}
        onSaved={(message) => {
          toast.success(message);
          setAction(null);
          hierarchy.refresh();
        }}
      />
      <EnterpriseModal
        open={Boolean(labelBin)}
        title={labelBin ? `Bin Barcode: ${labelBin.barcode}` : "Bin Barcode"}
        subtitle="View and print the physical warehouse bin label."
        size="medium"
        onClose={() => setLabelBin(null)}
        footer={(
          <>
            <button type="button" onClick={() => setLabelBin(null)} className="rounded border border-border px-4 py-2 text-xs font-semibold">
              Close
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await printBinBarcode(labelBin.id || labelBin.bin_id);
                  if (!printBinBarcodeLabel(binLabelRef.current)) {
                    toast.error("The browser blocked the print preview window.");
                  }
                } catch (error) {
                  toast.error("Bin label could not be printed.", { description: getErrorMessage(error) });
                }
              }}
              className="inline-flex items-center gap-2 rounded bg-info px-4 py-2 text-xs font-semibold text-info-foreground"
            >
              <Printer className="h-4 w-4" />
              Print Bin Label
            </button>
          </>
        )}
      >
        {labelBin && <BinBarcodeLabel ref={binLabelRef} bin={labelBin} />}
      </EnterpriseModal>
    </>
  );
}

function BinRulesPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const rules = useApiCollection(() => getBinRules(), `bin-rules-${refreshKey}`);
  const categories = useApiCollection(() => getBinRuleCategories(), `bin-rule-categories-${refreshKey}`);
  const [catalog, setCatalog] = useState({ evaluators: [], execution_targets: [], violation_actions: [], severities: [] });
  const [readiness, setReadiness] = useState(null);
  const [editing, setEditing] = useState(null);
  const [categoryForm, setCategoryForm] = useState({ category_code: "", category_name: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const emptyRule = {
    rule_code: "", rule_name: "", description: "", category_reference: "",
    rule_type: "validation", evaluator_type: "", execution_targets: [],
    violation_action: "block", severity: "high", priority: 100,
    is_active: false, parameters: {}
  };

  useEffect(() => {
    let active = true;
    Promise.all([getBinRuleEvaluators(), getBinRuleReadiness()]).then(([catalogResponse, readinessResponse]) => {
      if (active) {
        setCatalog(catalogResponse.data || {});
        setReadiness(readinessResponse.data || null);
      }
    }).catch((error) => toast.error("Rule engine configuration could not be loaded", { description: getErrorMessage(error) }));
    return () => { active = false; };
  }, [refreshKey]);

  const visibleRules = rules.rows.filter((rule) => (
    (!statusFilter || (statusFilter === "Active") === rule.is_active)
    && (!searchTerm || `${rule.rule_name} ${rule.description} ${rule.rule_code} ${rule.evaluator_type}`.toLowerCase().includes(searchTerm.toLowerCase()))
  ));

  const openRule = (rule = null) => setEditing(rule ? {
    ...rule,
    category_reference: rule.category_reference || "",
    parameters: rule.parameters || {}
  } : { ...emptyRule });

  const saveRule = async () => {
    setSaving(true);
    try {
      const payload = { ...editing, priority: Number(editing.priority) };
      delete payload.public_reference;
      if (editing.public_reference) await updateBinRule(editing.public_reference, payload);
      else await createBinRule(payload);
      toast.success(editing.public_reference ? "Bin rule updated." : "Bin rule created.");
      setEditing(null);
      setRefreshKey((value) => value + 1);
    } catch (error) {
      toast.error("Rule could not be updated", { description: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const toggleRule = async (rule) => {
    setSaving(true);
    try {
      await updateBinRule(rule.public_reference, { is_active: !rule.is_active });
      setRefreshKey((value) => value + 1);
    } catch (error) { toast.error("Rule status could not be changed", { description: getErrorMessage(error) }); }
    finally { setSaving(false); }
  };

  const removeRule = async (rule) => {
    if (!window.confirm(`Delete ${rule.rule_name}? Audit history will be retained.`)) return;
    try { await deleteBinRule(rule.public_reference); setRefreshKey((value) => value + 1); }
    catch (error) { toast.error("Rule could not be deleted", { description: getErrorMessage(error) }); }
  };

  const saveCategory = async (event) => {
    event.preventDefault();
    try { await createBinRuleCategory(categoryForm); setCategoryForm({ category_code: "", category_name: "", description: "" }); setRefreshKey((value) => value + 1); }
    catch (error) { toast.error("Category could not be created", { description: getErrorMessage(error) }); }
  };

  const renameCategory = async (category) => {
    const name = window.prompt("Category name", category.category_name);
    if (!name) return;
    try {
      await updateBinRuleCategory(category.public_reference, {
        category_code: category.category_code,
        category_name: name,
        description: category.description || "",
        is_active: category.is_active
      });
      setRefreshKey((value) => value + 1);
    } catch (error) { toast.error("Category could not be updated", { description: getErrorMessage(error) }); }
  };

  const removeCategory = async (category) => {
    if (!window.confirm(`Delete category ${category.category_name}?`)) return;
    try { await deleteBinRuleCategory(category.public_reference); setRefreshKey((value) => value + 1); }
    catch (error) { toast.error("Category could not be deleted", { description: getErrorMessage(error) }); }
  };

  const toggleCategory = async (category) => {
    try {
      await updateBinRuleCategory(category.public_reference, {
        category_code: category.category_code,
        category_name: category.category_name,
        description: category.description || "",
        is_active: !category.is_active
      });
      setRefreshKey((value) => value + 1);
    } catch (error) { toast.error("Category status could not be updated", { description: getErrorMessage(error) }); }
  };

  const selectedEvaluator = catalog.evaluators?.find((item) => item.value === editing?.evaluator_type);
  const setRuleField = (key, value) => setEditing((current) => ({ ...current, [key]: value }));
  const setRuleParameter = (key, value) => setEditing((current) => ({ ...current, parameters: { ...(current.parameters || {}), [key]: value } }));
  const toggleTarget = (target) => setRuleField("execution_targets", editing.execution_targets.includes(target)
    ? editing.execution_targets.filter((item) => item !== target)
    : [...editing.execution_targets, target]);

  return (
    <>
      <PageHeader
        eyebrow="Warehouse Configuration"
        title="Bin Rules"
        description="Database-driven policies evaluated through trusted application capabilities."
        actions={<ToolbarButton icon={Plus} onClick={() => openRule()}>Create Rule</ToolbarButton>}
      />
      <div className="flex-1 overflow-auto p-4">
        <SectionCard title="Operational Readiness" icon={readiness?.ready ? CheckCircle2 : AlertTriangle}>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <StatusBadge tone={readiness?.ready ? "success" : "destructive"}>{readiness?.ready ? "Placement ready" : "Placement blocked"}</StatusBadge>
            <span>{readiness?.ready ? `${readiness.active_rule_count} active rules provide required safety coverage.` : `Missing: ${(readiness?.missing_capabilities || []).join(", ") || "Invalid rule configuration"}`}</span>
          </div>
        </SectionCard>
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_2fr]">
          <SectionCard title="Rule Categories" icon={Rows3}>
            <form className="space-y-2" onSubmit={saveCategory}>
              <FormField label="Category code"><input className={inputClass} value={categoryForm.category_code} onChange={(event) => setCategoryForm((value) => ({ ...value, category_code: event.target.value }))} required /></FormField>
              <FormField label="Category name"><input className={inputClass} value={categoryForm.category_name} onChange={(event) => setCategoryForm((value) => ({ ...value, category_name: event.target.value }))} required /></FormField>
              <FormField label="Description"><input className={inputClass} value={categoryForm.description} onChange={(event) => setCategoryForm((value) => ({ ...value, description: event.target.value }))} /></FormField>
              <ToolbarButton icon={Plus} type="submit">Add Category</ToolbarButton>
            </form>
            <div className="mt-3 space-y-1 text-xs">{categories.rows.map((category) => <div key={category.public_reference} className="rounded border p-2"><div className="flex items-center justify-between gap-2"><strong>{category.category_name}</strong><StatusBadge tone={category.is_active ? "success" : "secondary"}>{category.is_active ? "Active" : "Inactive"}</StatusBadge></div><div className="text-muted-foreground">{category.category_code} · {category.rule_count} rules</div><div className="mt-2 flex gap-2"><button type="button" className="text-primary" onClick={() => renameCategory(category)}>Edit</button><button type="button" className="text-primary" onClick={() => toggleCategory(category)}>{category.is_active ? "Deactivate" : "Activate"}</button><button type="button" className="text-destructive" onClick={() => removeCategory(category)}>Delete</button></div></div>)}</div>
          </SectionCard>
          <div>
        <SectionCard title="Search & Filter" icon={Filter}>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Search">
              <input className={inputClass} value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search assignment rules..." />
            </FormField>
            <FormField label="Status">
              <SelectField value={statusFilter} onChange={setStatusFilter}>
                <option value="">All statuses</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </SelectField>
            </FormField>
          </div>
        </SectionCard>
        <div className="mt-3">
          {rules.loading && rules.rows.length === 0 ? (
            <LoadingState />
          ) : (
            <SectionCard title="Bin Rules List" icon={ListChecks}>
              {visibleRules.length > 0 ? (
                <div className="divide-y divide-border">
                  {visibleRules.map((rule) => (
                    <div key={rule.public_reference} className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-semibold text-foreground">{rule.rule_name}</div>
                          <StatusBadge tone={rule.is_active ? "success" : "destructive"}>
                            {rule.is_active ? "Active" : "Inactive"}
                          </StatusBadge>
                        </div>
                        <div className="text-xs text-muted-foreground">{rule.description}</div>
                        <div className="text-[11px] text-muted-foreground">
                          Code: <span className="font-mono text-foreground">{rule.rule_code}</span> · Evaluator: <span className="font-mono text-foreground">{rule.evaluator_type || "Review required"}</span> · Priority {rule.priority}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 md:justify-end">
                        <ToolbarButton
                          icon={Power}
                          variant="secondary"
                           onClick={() => toggleRule(rule)}
                          disabled={saving}
                        >
                          {rule.is_active ? "Deactivate" : "Activate"}
                        </ToolbarButton>
                        <ToolbarButton
                          icon={Eye}
                          variant="secondary"
                          onClick={() => openRule(rule)}
                        >
                          Edit
                        </ToolbarButton>
                        <ToolbarButton
                          icon={SlidersHorizontal}
                          variant="secondary"
                          onClick={() => removeRule(rule)}
                        >
                          Delete
                        </ToolbarButton>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No bin rules configured" body="Create administrator-owned rules before placement workflows can operate." />
              )}
            </SectionCard>
          )}
        </div>
          </div>
      </div>
      </div>
      <EnterpriseModal open={Boolean(editing)} title={editing?.public_reference ? "Edit Bin Rule" : "Create Bin Rule"} subtitle="Configure trusted evaluator metadata; rule names and codes never control execution." onClose={() => setEditing(null)}>
        {editing && <div className="grid gap-3 text-xs md:grid-cols-2">
          <FormField label="Rule name"><input className={inputClass} value={editing.rule_name} onChange={(event) => setRuleField("rule_name", event.target.value)} /></FormField>
          <FormField label="Rule code"><input className={inputClass} value={editing.rule_code} onChange={(event) => setRuleField("rule_code", event.target.value.toLowerCase())} /></FormField>
          <FormField label="Category"><SelectField value={editing.category_reference} onChange={(value) => setRuleField("category_reference", value)}><option value="">Uncategorized</option>{categories.rows.map((category) => <option key={category.public_reference} value={category.public_reference}>{category.category_name}</option>)}</SelectField></FormField>
          <FormField label="Trusted evaluator"><SelectField value={editing.evaluator_type} onChange={(value) => { const definition = catalog.evaluators.find((item) => item.value === value); setEditing((current) => ({ ...current, evaluator_type: value, rule_type: definition?.rule_type || "validation", execution_targets: [] })); }}><option value="">Select evaluator</option>{catalog.evaluators.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</SelectField></FormField>
          <FormField label="Violation action"><SelectField value={editing.violation_action} onChange={(value) => setRuleField("violation_action", value)}>{(selectedEvaluator?.supported_actions || catalog.violation_actions).map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</SelectField></FormField>
          <FormField label="Severity"><SelectField value={editing.severity} onChange={(value) => setRuleField("severity", value)}>{catalog.severities.map((item) => <option key={item} value={item}>{item}</option>)}</SelectField></FormField>
          <FormField label="Priority"><input className={inputClass} type="number" min="1" value={editing.priority} onChange={(event) => setRuleField("priority", event.target.value)} /></FormField>
          <FormField label="Status"><label className="flex items-center gap-2 rounded border p-2"><input type="checkbox" checked={editing.is_active} onChange={(event) => setRuleField("is_active", event.target.checked)} /> Active</label></FormField>
          <div className="md:col-span-2"><FormField label="Description"><textarea className={inputClass} value={editing.description || ""} onChange={(event) => setRuleField("description", event.target.value)} /></FormField></div>
          <div className="md:col-span-2"><FormField label="Execution targets"><div className="grid gap-2 sm:grid-cols-2">{(selectedEvaluator?.supported_targets || []).map((target) => <label key={target} className="flex items-center gap-2 rounded border p-2"><input type="checkbox" checked={editing.execution_targets.includes(target)} onChange={() => toggleTarget(target)} />{target.replaceAll("_", " ")}</label>)}</div></FormField></div>
          <div className="md:col-span-2"><FormField label="Evaluator settings"><div className="grid gap-3 sm:grid-cols-2">{Object.entries(selectedEvaluator?.parameter_schema?.properties || {}).map(([key, schema]) => <div key={key}><label className="mb-1 block capitalize text-muted-foreground">{key.replaceAll("_", " ")}</label>{schema.type === "boolean" ? <label className="flex items-center gap-2 rounded border p-2"><input type="checkbox" checked={editing.parameters?.[key] ?? schema.default ?? false} onChange={(event) => setRuleParameter(key, event.target.checked)} /> Enabled</label> : schema.enum ? <SelectField value={editing.parameters?.[key] || ""} onChange={(value) => setRuleParameter(key, value)}><option value="">Select value</option>{schema.enum.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</SelectField> : <input className={inputClass} value={Array.isArray(editing.parameters?.[key]) ? editing.parameters[key].join(", ") : editing.parameters?.[key] || ""} onChange={(event) => setRuleParameter(key, schema.type === "array" ? event.target.value.split(",").map((item) => item.trim()).filter(Boolean) : event.target.value)} />}</div>)}</div>{!selectedEvaluator && <p className="text-muted-foreground">Select a trusted evaluator to configure its supported settings.</p>}</FormField></div>
          <div className="flex justify-end gap-2">
            <ToolbarButton variant="secondary" onClick={() => setEditing(null)}>Cancel</ToolbarButton>
            <ToolbarButton onClick={saveRule} disabled={saving}>{saving ? "Saving..." : "Save Rule"}</ToolbarButton>
          </div>
        </div>}
      </EnterpriseModal>
    </>
  );
}

function CapacityConfigurationPage() {
  const hierarchy = useWarehouseHierarchy();
  const [refreshKey, setRefreshKey] = useState(0);
  const capacity = useApiCollection(() => getCapacityConfigurations(), `capacity-${refreshKey}`);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [activeCapacityTab, setActiveCapacityTab] = useState("warehouse");

  const rowsFor = (type, selectedId = "", matchParent = false) => capacity.rows.filter((row) => {
    const normalizedStatus = String(row.status || "").toLowerCase();
    return row.entity_type === type
      && (!selectedId || String(row[matchParent ? "parent_id" : "entity_id"]) === String(selectedId))
      && (!statusFilter || normalizedStatus === statusFilter.toLowerCase())
      && (!searchTerm || String(row.entity_name || "").toLowerCase().includes(searchTerm.toLowerCase()));
  });

  const openCapacity = (row) => {
    setEditing(row);
    setForm({
      max_weight: row.max_weight || "",
      max_volume: row.max_volume || "",
      occupancy_warning_threshold: row.occupancy_warning_threshold || 80,
      full_threshold: row.full_threshold || 100,
      allow_child_capacity_override: Boolean(row.allow_child_capacity_override),
      status: row.status === "Inactive" || row.status === "inactive" ? "Inactive" : "Active"
    });
  };

  const saveCapacity = async () => {
    setSaving(true);
    try {
      await updateCapacityConfiguration(editing.entity_type, editing.entity_id, form);
      toast.success("Capacity configuration updated.");
      setEditing(null);
      setRefreshKey((value) => value + 1);
      hierarchy.refresh();
    } catch (error) {
      toast.error("Capacity could not be updated", { description: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const capacityTabs = [
    { value: "warehouse", label: "Warehouse Capacity", icon: Warehouse, type: "Warehouse", selectedId: hierarchy.selectedWarehouse, labelText: "Warehouse" },
    { value: "zone", label: "Zone Capacity", icon: Boxes, type: "Zone", selectedId: hierarchy.selectedWarehouse, labelText: "Zone", matchParent: true },
    { value: "rack", label: "Rack Capacity", icon: Rows3, type: "Rack", selectedId: hierarchy.selectedZone, labelText: "Rack", matchParent: true },
    { value: "level", label: "Level Capacity", icon: SquareStack, type: "Level", selectedId: hierarchy.selectedRack, labelText: "Level", matchParent: true },
    { value: "bin", label: "Bin Capacity", icon: Box, type: "Bin", selectedId: hierarchy.selectedLevel, labelText: "Bin", matchParent: true }
  ];

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
              warehouses={hierarchy.warehouses}
              zones={hierarchy.zones}
              racks={hierarchy.racks}
              levels={hierarchy.levels}
              selectedWarehouse={hierarchy.selectedWarehouse}
              selectedZone={hierarchy.selectedZone}
              selectedRack={hierarchy.selectedRack}
              selectedLevel={hierarchy.selectedLevel}
              setSelectedWarehouse={hierarchy.setSelectedWarehouse}
              setSelectedZone={hierarchy.setSelectedZone}
              setSelectedRack={hierarchy.setSelectedRack}
              setSelectedLevel={hierarchy.setSelectedLevel}
              needZone
              needRack
              needLevel
              loading={hierarchy.loading}
            />
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <FormField label="Search">
                <input className={inputClass} value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search capacity records..." />
              </FormField>
              <FormField label="Status">
                <SelectField value={statusFilter} onChange={setStatusFilter}>
                  <option value="">All statuses</option>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </SelectField>
              </FormField>
            </div>
          </SectionCard>
          <Tabs value={activeCapacityTab} onValueChange={setActiveCapacityTab}>
            <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-lg bg-muted p-1">
              {capacityTabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger key={tab.value} value={tab.value} className="shrink-0 gap-2 px-4 py-2">
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
            {capacityTabs.map((tab) => (
              <TabsContent key={tab.value} value={tab.value} className="mt-3">
                <CapacityTable
                  title={tab.label}
                  icon={tab.icon}
                  rows={rowsFor(tab.type, tab.selectedId, tab.matchParent)}
                  loading={capacity.loading}
                  error={capacity.error}
                  label={tab.labelText}
                  labelRenderer={(row) => row.entity_name}
                  onView={setViewing}
                  onEdit={openCapacity}
                />
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
      <EnterpriseModal open={Boolean(viewing)} title={`${viewing?.entity_name || "Capacity Configuration"} - Details`} subtitle={`${viewing?.entity_type || "Entity"} capacity configuration`} onClose={() => setViewing(null)}>
        {viewing && (
          <div className="grid gap-3 md:grid-cols-2">
            {getDetailViewFields("capacity-config", viewing).map(([label, value]) => (
              <ReadonlyValue key={label} label={label} value={value} />
            ))}
          </div>
        )}
      </EnterpriseModal>
      <EnterpriseModal open={Boolean(editing)} title={`Configure ${editing?.entity_name || "capacity"}`} onClose={() => setEditing(null)}>
        <div className="grid gap-3 md:grid-cols-2">
          <FormField label="Maximum Weight (kg)">
            <input className={inputClass} type="number" min="0.01" value={form.max_weight || ""} onChange={(event) => setForm((value) => ({ ...value, max_weight: event.target.value }))} />
          </FormField>
          <FormField label="Maximum Volume (m3)">
            <input className={inputClass} type="number" min="0.001" value={form.max_volume || ""} onChange={(event) => setForm((value) => ({ ...value, max_volume: event.target.value }))} />
          </FormField>
          <FormField label="Warning Threshold (%)">
            <input className={inputClass} type="number" min="1" max="99" value={form.occupancy_warning_threshold || ""} onChange={(event) => setForm((value) => ({ ...value, occupancy_warning_threshold: event.target.value }))} />
          </FormField>
          <FormField label="Full Threshold (%)">
            <input className={inputClass} type="number" min="2" max="100" value={form.full_threshold || ""} onChange={(event) => setForm((value) => ({ ...value, full_threshold: event.target.value }))} />
          </FormField>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={Boolean(form.allow_child_capacity_override)} onChange={(event) => setForm((value) => ({ ...value, allow_child_capacity_override: event.target.checked }))} />
            Allow child capacity override
          </label>
          <div className="flex justify-end gap-2 md:col-span-2">
            <ToolbarButton variant="secondary" onClick={() => setEditing(null)}>Cancel</ToolbarButton>
            <ToolbarButton onClick={saveCapacity} disabled={saving}>{saving ? "Saving..." : "Save Capacity"}</ToolbarButton>
          </div>
        </div>
      </EnterpriseModal>
    </>
  );
}

function CapacityTable({ title, icon, rows, loading, error, label, labelRenderer, onView, onEdit, emptyTitle = "No capacity records loaded" }) {
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
          { key: "usage", label: "Usage", render: (row) => `${Math.max(Number(row.weight_usage_percent || 0), Number(row.volume_usage_percent || 0)).toFixed(1)}%` },
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
          } },
          { key: "actions", label: "Actions", render: (row) => (
            <div className="flex gap-1">
              <ToolbarButton icon={Eye} variant="secondary" onClick={() => onView(row)} />
              <ToolbarButton icon={Edit} variant="secondary" onClick={() => onEdit(row)} />
            </div>
          ) }
        ]}
      />
    </SectionCard>
  );
}

function CargoFilters({ filters, setFilters }) {
  return (
    <SectionCard title="Cargo Filters" icon={Filter}>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
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
        <FormField label="Consignee">
          <input className={inputClass} value={filters.consignee} onChange={(event) => setFilters((current) => ({ ...current, consignee: event.target.value }))} placeholder="Consignee" />
        </FormField>
        <FormField label="Barcode">
          <input className={inputClass} value={filters.barcode} onChange={(event) => setFilters((current) => ({ ...current, barcode: event.target.value }))} placeholder="Cargo barcode" />
        </FormField>
      </div>
    </SectionCard>
  );
}

function CargoApprovalOverridesPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [busyId, setBusyId] = useState("");
  const [actionError, setActionError] = useState("");
  const [selectedApproval, setSelectedApproval] = useState(null);
  const [actionMode, setActionMode] = useState("");
  const [rejectionConditions, setRejectionConditions] = useState([]);
  const approvals = useApiCollection(
    () => getSupervisorApprovals({ status: "Pending", request_type: "CARGO_REGISTRATION" }),
    `admin-cargo-approvals-${refreshKey}`
  );

  useEffect(() => {
    getSupervisorReviewConfiguration()
      .then((response) => setRejectionConditions(response.data?.rejection_conditions || []))
      .catch((error) => setActionError(getErrorMessage(error)));
  }, []);

  const decide = async (payload) => {
    if (!selectedApproval || !actionMode) return;
    setActionError("");
    setBusyId(`${actionMode}-${selectedApproval.id}`);
    try {
      if (actionMode === "approve") {
        await approveSupervisorApproval(selectedApproval.id, payload);
      } else {
        await rejectSupervisorApproval(selectedApproval.id, payload);
      }
      setRefreshKey((current) => current + 1);
      setSelectedApproval(null);
      setActionMode("");
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setBusyId("");
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Cargo Oversight"
        title="Approval Overrides"
        description="Administrative override authority for pending cargo registrations. Routine approvals remain a Warehouse Supervisor responsibility."
      />
      <div className="flex-1 overflow-auto p-4">
        {actionError && <ErrorState message={actionError} />}
        <SectionCard title="Pending Registration Approvals" icon={ShieldCheck}>
          <DataTable
            loading={approvals.loading}
            error={approvals.error}
            rows={approvals.rows}
            emptyTitle="No cargo registrations require an override"
            columns={[
              { key: "cargo_id", label: "Cargo Reference", className: "font-mono font-semibold" },
              { key: "cargo_barcode", label: "Barcode", className: "font-mono" },
              { key: "consignee_name", label: "Consignee" },
              { key: "cargo_type", label: "Cargo Type" },
              { key: "registered_by_name", label: "Registered By", render: (row) => row.registered_by_name || "System" },
              { key: "registration_date", label: "Registered", render: (row) => formatDateTime(row.registration_date) },
              {
                key: "actions",
                label: "Override",
                render: (row) => (
                  <div className="flex gap-2">
                    <button
                      disabled={Boolean(busyId)}
                      onClick={() => {
                        setSelectedApproval(row);
                        setActionMode("approve");
                      }}
                      className="rounded bg-success px-2 py-1 text-[11px] font-semibold text-success-foreground"
                    >
                      Force Approve
                    </button>
                    <button
                      disabled={Boolean(busyId)}
                      onClick={() => {
                        setSelectedApproval(row);
                        setActionMode("reject");
                      }}
                      className="rounded bg-destructive px-2 py-1 text-[11px] font-semibold text-destructive-foreground"
                    >
                      Force Reject
                    </button>
                  </div>
                )
              }
            ]}
          />
        </SectionCard>
      </div>
      <ReviewActionModal
        open={Boolean(selectedApproval && actionMode)}
        mode={actionMode}
        cargo={selectedApproval}
        busy={Boolean(busyId)}
        apiError={actionError}
        rejectionConditions={rejectionConditions}
        subjectLabel="Administrative Cargo Override"
        onClose={() => {
          if (!busyId) {
            setSelectedApproval(null);
            setActionMode("");
            setActionError("");
          }
        }}
        onSubmit={decide}
      />
    </>
  );
}

function CargoRecordsPage({ mode = "records" }) {
  const cargo = useApiCollection(
    () => getCargo({ include_archived: "true" }),
    `cargo-${mode}`
  );
  const [filters, setFilters] = useState({ status: "All statuses", warehouse: "", date: "", cargoType: "", consignee: "", barcode: "" });
  const [selectedCargoId, setSelectedCargoId] = useState("");
  const [selectedCargo, setSelectedCargo] = useState(null);
  const [detailError, setDetailError] = useState("");

  const rows = useMemo(() => {
    return cargo.rows.filter((record) => {
      const status = cargoOperationalStatus(record);
      const statusMatch = filters.status === "All statuses"
        || status === filters.status
        || record.placement_status === filters.status;
      const modeMatch = mode !== "blocked" || record.relocation_required;
      const typeMatch = !filters.cargoType || record.cargo_type?.toLowerCase().includes(filters.cargoType.toLowerCase());
      const dateMatch = !filters.date || String(record.created_at || record.received_datetime || "").startsWith(filters.date);
      const warehouseMatch = !filters.warehouse || [
        record.warehouse_name,
        record.warehouse_code
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(filters.warehouse.toLowerCase()));
      const consigneeMatch = !filters.consignee || record.consignee_name?.toLowerCase().includes(filters.consignee.toLowerCase());
      const barcodeMatch = !filters.barcode || record.barcode?.toLowerCase().includes(filters.barcode.toLowerCase());
      return modeMatch && statusMatch && typeMatch && dateMatch && warehouseMatch && consigneeMatch && barcodeMatch;
    });
  }, [cargo.rows, filters, mode]);

  useEffect(() => {
    if (!selectedCargoId) {
      setSelectedCargo(null);
      setDetailError("");
      return;
    }
    getCargoById(selectedCargoId)
      .then((response) => setSelectedCargo(response.data))
      .catch((error) => setDetailError(getErrorMessage(error)));
  }, [selectedCargoId]);

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
                { key: "cargo_id", label: "Cargo Reference", className: "font-mono font-semibold" },
                { key: "barcode", label: "Barcode", className: "font-mono text-muted-foreground" },
                { key: "cargo_type", label: "Cargo Type", render: (row) => row.cargo_type || "No data" },
                { key: "warehouse", label: "Warehouse", render: (row) => row.warehouse_code ? `${row.warehouse_code} - ${row.warehouse_name}` : "Not assigned" },
                { key: "status", label: "Status", render: (row) => <StatusBadge tone={statusTone(cargoOperationalStatus(row))}>{cargoOperationalStatus(row)}</StatusBadge> },
                { key: "placement_status", label: "Placement Status", render: (row) => row.placement_status || "Unassigned" },
                { key: "location", label: "Current Location", render: (row) => row.location || "Not assigned" },
                { key: "updated_at", label: "Updated", render: (row) => formatDateTime(row.updated_at) },
                ...(mode === "tracking" ? [{
                  key: "details",
                  label: "Details",
                  render: (row) => (
                    <button
                      type="button"
                      onClick={() => setSelectedCargoId(String(row.id))}
                      className="rounded border border-info/30 bg-info/10 px-2 py-1 text-[11px] font-semibold text-info"
                    >
                      View History
                    </button>
                  )
                }] : [])
              ]}
            />
          </SectionCard>
          {mode === "tracking" && detailError && <ErrorState message={detailError} />}
          {mode === "tracking" && selectedCargo && (
            <div className="grid gap-3 xl:grid-cols-2">
              <SectionCard title={`Current Location: ${selectedCargo.cargo_id}`} icon={Warehouse}>
                <div className="grid gap-2 text-xs sm:grid-cols-2">
                  <ReadonlyValue label="Zone" value={selectedCargo.zone_code || "Unassigned"} />
                  <ReadonlyValue label="Rack" value={selectedCargo.rack_code || "Unassigned"} />
                  <ReadonlyValue label="Level" value={selectedCargo.level_code || "Unassigned"} />
                  <ReadonlyValue label="Bin" value={selectedCargo.bin_barcode || "Unassigned"} />
                  <ReadonlyValue label="Registration Status" value={selectedCargo.registration_status} />
                  <ReadonlyValue label="Placement Status" value={selectedCargo.placement_status || "Unassigned"} />
                </div>
              </SectionCard>
              <SectionCard title="Movement History" icon={Activity}>
                <DataTable
                  rows={selectedCargo.movement_history || []}
                  emptyTitle="No movement history recorded"
                  columns={[
                    { key: "created_at", label: "Time", render: (row) => formatDateTime(row.created_at) },
                    { key: "from_location", label: "From", render: (row) => row.from_location || "Receiving" },
                    { key: "to_location", label: "To", render: (row) => row.to_location || "Not assigned" },
                    { key: "moved_by", label: "Moved By" },
                    { key: "action", label: "Action" }
                  ]}
                />
              </SectionCard>
              <SectionCard title="Approval Workflow History" icon={ClipboardCheck}>
                <DataTable
                  rows={selectedCargo.approval_history || []}
                  emptyTitle="No approval workflow history recorded"
                  columns={[
                    { key: "performed_at", label: "Time", render: (row) => formatDateTime(row.performed_at) },
                    { key: "action", label: "Action" },
                    { key: "performed_by_name", label: "Performed By", render: (row) => row.performed_by_name || row.performed_by_username || "System" },
                    { key: "remarks", label: "Remarks", render: (row) => row.remarks || "No remarks" }
                  ]}
                />
              </SectionCard>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function PlacementMonitoringPage() {
  return (
    <>
      <PageHeader
        eyebrow="Cargo Oversight"
        title="Placement Activity"
        description="Global placement activity, failed attempts, relocations, override workflow, and support events."
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="mb-3">
          <ManualPlacementSetting />
        </div>
        <PlacementActivityPanel title="Global Placement Activity" adminFilters />
      </div>
    </>
  );
}

function DispatchOversightPage({ mode }) {
  const config = {
    queue: {
      title: "Dispatch Queue",
      description: "Readonly cargo awaiting dispatch release.",
      status: "",
      emptyTitle: "No dispatch queue records loaded"
    },
    released: {
      title: "Released Cargo",
      description: "Readonly cargo released from the warehouse.",
      status: "Dispatched",
      emptyTitle: "No released cargo loaded"
    },
    gate: {
      title: "Gate Activity",
      description: "Readonly gate activity supervision for released cargo movement.",
      status: "",
      emptyTitle: "No gate activity loaded"
    }
  }[mode];

  const cargo = useApiCollection(() => getCargo(config.status ? { status: config.status } : {}), `dispatch-${mode}`);
  const rows = mode === "queue"
    ? cargo.rows.filter((record) => record.dispatch_authorization_status === "Pending")
    : mode === "gate"
      ? cargo.rows.filter((record) => record.dispatch_authorization_status === "Approved")
      : cargo.rows;

  return (
    <>
      <PageHeader eyebrow="Dispatch Oversight" title={config.title} description={config.description} />
      <div className="flex-1 overflow-auto p-4">
        <SectionCard title={config.title} icon={mode === "gate" ? DoorOpen : Truck}>
          <DataTable
            loading={cargo.loading}
            error={cargo.error}
            rows={rows}
            emptyTitle={config.emptyTitle}
            emptyBody="Dispatch supervision records will appear when dispatch data is available."
            columns={[
              { key: "cargo_id", label: "Cargo Reference", className: "font-mono font-semibold" },
              { key: "barcode", label: "Barcode", className: "font-mono text-muted-foreground" },
              { key: "location", label: "Storage Location", render: (row) => row.location || "Not assigned" },
              { key: "status", label: "Placement", render: (row) => <StatusBadge tone={statusTone(row.placement_status)}>{row.placement_status || "No status"}</StatusBadge> },
              { key: "updated_at", label: "Updated", render: (row) => formatDateTime(row.updated_at) }
            ]}
          />
        </SectionCard>
      </div>
    </>
  );
}

function ValidationLogsPage({ logs: providedLogs, mode = "validation" } = {}) {
  const ownLogs = useApiCollection(
    () => (mode === "placement" ? getPlacementLogs() : getPlacementFailures()),
    `${mode}-logs`
  );
  const logs = providedLogs || ownLogs;
  const content = mode === "placement"
    ? {
      title: "Placement Logs",
      description: "Readonly placement validation and scanner records for warehouse operations."
    }
    : {
      title: "Validation Logs",
      description: "Operational log table for invalid barcodes, rejected placements, hazardous mismatch, capacity exceeded, and blocked storage areas."
    };

  return (
    <>
      <PageHeader
        eyebrow="Operational Review"
        title={content.title}
        description={content.description}
      />
      <div className="flex-1 overflow-auto p-4">
        <SectionCard title={content.title} icon={mode === "placement" ? ScanLine : FileWarning}>
          <DataTable
            loading={logs.loading}
            error={logs.error}
            rows={logs.rows}
            emptyTitle="No validation logs loaded"
            emptyBody="Validation logs will appear when placement validation events are recorded."
            columns={[
              { key: "created_at", label: "Timestamp", render: (row) => formatDateTime(row.created_at), className: "font-mono text-muted-foreground" },
              { key: "attempt_stage", label: "Stage", render: (row) => row.attempt_stage || "validation" },
              { key: "placement_mode", label: "Mode", render: (row) => row.placement_mode || "scan" },
              { key: "event", label: "Event", render: (row) => row.reason || row.failure_reason || row.result || "Validation event" },
              { key: "result", label: "Result", render: (row) => <StatusBadge tone={row.approved ? "success" : "destructive"}>{row.approved ? "Passed" : "Rejected"}</StatusBadge> },
              { key: "cargo_barcode", label: "Cargo", render: (row) => row.cargo_identifier || row.cargo_barcode || "Not recorded" },
              { key: "bin_barcode", label: "Bin", render: (row) => row.bin_identifier || row.bin_barcode || "Not recorded" },
              { key: "detail", label: "Detail", render: (row) => row.detail || row.validation_message || row.message || "No detail recorded" }
            ]}
          />
        </SectionCard>
      </div>
    </>
  );
}

function AuditPage({ mode }) {
  const [filters, setFilters] = useState(emptyAuditFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyAuditFilters);
  const filterKey = JSON.stringify(appliedFilters);
  const logs = useApiCollection(
    () => getAuditLogs({ limit: 200, ...appliedFilters }),
    `audit-logs-${mode}-${filterKey}`
  );
  const roles = useApiCollection(() => getRoles(), "audit-role-filter");
  const sessions = useApiCollection(() => getUserSessions(), `audit-sessions-${mode}`);
  const config = {
    logs: {
      title: "Audit Logs",
      description: "Readonly audit trail for administrative and operational modules."
    },
    activity: {
      title: "Activity Logs",
      description: "Readonly user activity monitoring by module and action."
    },
    sessions: {
      title: "Login Sessions",
      description: "Readonly session monitoring for account access."
    },
    security: {
      title: "Security Logs",
      description: "Readonly security event monitoring for the WMS."
    },
    system: {
      title: "System Logs",
      description: "Readonly system-wide administrative and operational audit records."
    }
  }[mode];

  const auditColumns = [
    { key: "created_at", label: "Timestamp", render: (row) => formatDateTime(row.created_at), className: "font-mono text-muted-foreground" },
    { key: "user", label: "Acting User", render: (row) => row.full_name || row.username || "System" },
    { key: "role_name", label: "Role", render: (row) => row.role_name || "System" },
    { key: "warehouse", label: "Warehouse", render: (row) => row.warehouse_name || row.warehouse_code || "Not assigned" },
    { key: "target_user", label: "Target User", render: (row) => row.target_full_name || row.target_username || "Not applicable" },
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
        {mode !== "sessions" && (
          <SectionCard title="Log Filters" icon={Filter}>
            <form
              className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"
              onSubmit={(event) => {
                event.preventDefault();
                setAppliedFilters(filters);
              }}
            >
              <FormField label="User">
                <input className={inputClass} value={filters.user} onChange={(event) => setFilters((current) => ({ ...current, user: event.target.value }))} placeholder="Name or username" />
              </FormField>
              <FormField label="Role">
                <SelectField value={filters.role} onChange={(value) => setFilters((current) => ({ ...current, role: value }))}>
                  <option value="">All roles</option>
                  {roles.rows.map((role) => <option key={role.id} value={role.role_name}>{role.role_name}</option>)}
                </SelectField>
              </FormField>
              <FormField label="Action">
                <input className={inputClass} value={filters.action} onChange={(event) => setFilters((current) => ({ ...current, action: event.target.value }))} placeholder="Action code" />
              </FormField>
              <FormField label="Module">
                <input className={inputClass} value={filters.module} onChange={(event) => setFilters((current) => ({ ...current, module: event.target.value }))} placeholder="Module name" />
              </FormField>
              <FormField label="Status">
                <input className={inputClass} value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} placeholder="Status or result" />
              </FormField>
              <FormField label="Cargo Reference">
                <input className={inputClass} value={filters.cargo_id} onChange={(event) => setFilters((current) => ({ ...current, cargo_id: event.target.value }))} placeholder="Cargo reference" />
              </FormField>
              <FormField label="Warehouse">
                <input className={inputClass} value={filters.warehouse} onChange={(event) => setFilters((current) => ({ ...current, warehouse: event.target.value }))} placeholder="Name or code" />
              </FormField>
              <FormField label="From Date">
                <input type="date" className={inputClass} value={filters.date_from} onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value }))} />
              </FormField>
              <FormField label="To Date">
                <input type="date" className={inputClass} value={filters.date_to} onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value }))} />
              </FormField>
              <div className="flex items-end gap-2">
                <ToolbarButton icon={Filter} type="submit">Apply Filters</ToolbarButton>
                <ToolbarButton
                  icon={RefreshCw}
                  variant="secondary"
                  onClick={() => {
                    setFilters(emptyAuditFilters);
                    setAppliedFilters(emptyAuditFilters);
                  }}
                >
                  Reset
                </ToolbarButton>
              </div>
            </form>
          </SectionCard>
        )}
        <div className={mode !== "sessions" ? "mt-3" : ""}>
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
      </div>
    </>
  );
}

function ProfilePage() {
  return (
    <AccountProfilePage
      title="System Administrator Profile"
      description="Your authenticated account details, contact information, and read-only system assignment."
    />
  );
}

function CargoRegistrationFormConfigurationPage() {
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await getAvailableCargoRegistrationFields();
      setFields((response.data || []).sort((left, right) => left.display_order - right.display_order));
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updateField = (fieldKey, key, value) => {
    setFields((current) => current.map((field) => (
      field.field_key === fieldKey ? { ...field, [key]: value } : field
    )));
  };

  const moveField = (index, direction) => {
    setFields((current) => {
      const next = [...current].sort((left, right) => left.display_order - right.display_order);
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((field, fieldIndex) => ({ ...field, display_order: (fieldIndex + 1) * 10 }));
    });
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await validateCargoRegistrationForm(fields);
      const response = await updateCargoRegistrationForm(fields);
      setFields((response.data || []).sort((left, right) => left.display_order - right.display_order));
      toast.success("Cargo registration form configuration published.");
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm("Reset every cargo registration field to the system defaults?")) return;
    setSaving(true);
    setError("");
    try {
      const response = await resetCargoRegistrationForm();
      setFields((response.data || []).sort((left, right) => left.display_order - right.display_order));
      toast.success("Cargo registration form reset to system defaults.");
    } catch (resetError) {
      setError(getErrorMessage(resetError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="System Configuration"
        title="Cargo Registration Form"
        description="Configure the presentation of predefined cargo fields without weakening workflow or validation rules."
        action={(
          <div className="flex gap-2">
            <ToolbarButton icon={RefreshCw} variant="secondary" onClick={reset} disabled={saving}>Reset Defaults</ToolbarButton>
            <ToolbarButton icon={Save} onClick={save} disabled={saving || loading}>
              {saving ? "Saving" : "Save & Publish"}
            </ToolbarButton>
          </div>
        )}
      />
      <div className="flex-1 overflow-auto p-4">
        {error && <ErrorState message={error} />}
        <div className="mb-3 rounded border border-info/30 bg-info/10 px-4 py-3 text-xs text-info">
          Protected and conditional fields cannot be hidden or deactivated. Conditional required rules remain controlled by the backend.
        </div>
        <SectionCard title="Predefined Fields" icon={ClipboardList}>
          {loading ? (
            <LoadingState label="Loading cargo form configuration..." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[1500px] w-full text-left text-xs">
                <thead className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-2">Order</th>
                    <th className="p-2">Field</th>
                    <th className="p-2">Display Name</th>
                    <th className="p-2">Help Text</th>
                    <th className="p-2">Placeholder</th>
                    <th className="p-2">Section</th>
                    <th className="p-2">Default</th>
                    <th className="p-2">Visible</th>
                    <th className="p-2">Required</th>
                    <th className="p-2">Editable</th>
                    <th className="p-2">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field, index) => {
                    const conditionalRequired = Boolean(field.conditional_rule?.required);
                    return (
                      <tr key={field.field_key} className="border-b border-border align-top">
                        <td className="p-2">
                          <div className="flex items-center gap-1">
                            <button type="button" className="h-7 rounded border px-2 disabled:opacity-40" disabled={index === 0} onClick={() => moveField(index, -1)}>↑</button>
                            <button type="button" className="h-7 rounded border px-2 disabled:opacity-40" disabled={index === fields.length - 1} onClick={() => moveField(index, 1)}>↓</button>
                            <span className="ml-1 font-mono text-muted-foreground">{index + 1}</span>
                          </div>
                        </td>
                        <td className="p-2">
                          <div className="font-semibold">{field.field_key}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <StatusBadge tone="neutral">{field.field_type}</StatusBadge>
                            {field.system_protected && <StatusBadge tone="warning">Protected</StatusBadge>}
                            {conditionalRequired && <StatusBadge tone="info">Conditional</StatusBadge>}
                          </div>
                        </td>
                        <td className="p-2"><input className={inputClass} value={field.label || ""} onChange={(event) => updateField(field.field_key, "label", event.target.value)} /></td>
                        <td className="p-2"><textarea className="min-h-16 w-64 rounded border border-input bg-background p-2" value={field.help_text || ""} onChange={(event) => updateField(field.field_key, "help_text", event.target.value)} /></td>
                        <td className="p-2"><input className={inputClass} value={field.placeholder || ""} disabled={field.field_type === "system"} onChange={(event) => updateField(field.field_key, "placeholder", event.target.value)} /></td>
                        <td className="p-2"><input className={inputClass} value={field.section_key || ""} onChange={(event) => updateField(field.field_key, "section_key", event.target.value)} /></td>
                        <td className="p-2">
                          <input
                            className={inputClass}
                            value={field.default_value ?? ""}
                            disabled={field.field_type === "system"}
                            onChange={(event) => updateField(field.field_key, "default_value", event.target.value || null)}
                          />
                        </td>
                        <td className="p-2 text-center"><input type="checkbox" checked={field.visible} disabled={field.system_protected} onChange={(event) => updateField(field.field_key, "visible", event.target.checked)} /></td>
                        <td className="p-2 text-center">
                          {conditionalRequired ? (
                            <span className="text-[10px] font-semibold text-info">Conditional</span>
                          ) : (
                            <input type="checkbox" checked={field.required} disabled={field.required_locked} onChange={(event) => updateField(field.field_key, "required", event.target.checked)} />
                          )}
                        </td>
                        <td className="p-2 text-center"><input type="checkbox" checked={field.editable} disabled={field.editable_locked} onChange={(event) => updateField(field.field_key, "editable", event.target.checked)} /></td>
                        <td className="p-2 text-center"><input type="checkbox" checked={field.active} disabled={field.system_protected} onChange={(event) => updateField(field.field_key, "active", event.target.checked)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}

function ReadonlyValue({ label, value }) {
  const displayValue = value === null || value === undefined || value === "" ? "Not specified" : value;

  return (
    <div className="rounded border border-border bg-muted/20 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-medium text-foreground">{displayValue}</div>
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
        <Route path="system/cargo-registration-form" element={<CargoRegistrationFormConfigurationPage />} />
        <Route path="warehouse/warehouses" element={<WarehousesPage />} />
        <Route path="warehouse/zones" element={<WarehouseConfigPage scope="zones" />} />
        <Route path="warehouse/racks" element={<WarehouseConfigPage scope="racks" />} />
        <Route path="warehouse/levels" element={<WarehouseConfigPage scope="levels" />} />
        <Route path="warehouse/bins" element={<WarehouseConfigPage scope="bins" />} />
        <Route path="warehouse/bin-rules" element={<BinRulesPage />} />
        <Route path="warehouse/capacity-configuration" element={<CapacityConfigurationPage />} />
        <Route path="cargo/records" element={<CargoRecordsPage mode="records" />} />
        <Route path="cargo/approval-overrides" element={<CargoApprovalOverridesPage />} />
        <Route path="cargo/placement-monitoring" element={<PlacementMonitoringPage />} />
        <Route path="cargo/tracking" element={<CargoRecordsPage mode="tracking" />} />
        <Route path="cargo/blocked" element={<CargoRecordsPage mode="blocked" />} />
        <Route path="dispatch/queue" element={<DispatchOversightPage mode="queue" />} />
        <Route path="dispatch/released" element={<DispatchOversightPage mode="released" />} />
        <Route path="dispatch/gate-activity" element={<DispatchOversightPage mode="gate" />} />
        <Route path="monitoring/system-logs" element={<AuditPage mode="system" />} />
        <Route path="monitoring/placement-logs" element={<ValidationLogsPage mode="placement" />} />
        <Route path="monitoring/validation-logs" element={<ValidationLogsPage />} />
        <Route path="audit/logs" element={<AuditPage mode="logs" />} />
        <Route path="audit/user-activity" element={<AuditPage mode="activity" />} />
        <Route path="audit/login-sessions" element={<AuditPage mode="sessions" />} />
        <Route path="audit/security-events" element={<AuditPage mode="security" />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AdminLayout>
  );
}

export default AdminPortal;

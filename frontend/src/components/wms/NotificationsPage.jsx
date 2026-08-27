import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Bell,
  CalendarDays,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  DollarSign,
  ExternalLink,
  FileText,
  Inbox,
  Megaphone,
  Package,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Truck
} from "lucide-react";
import {
  archiveNotification,
  createSystemAnnouncement,
  getNotificationSummary,
  getNotifications,
  getRoles,
  getUsers,
  getWarehouses,
  markAllNotificationsRead,
  markNotificationRead,
  restoreNotification
} from "@/services/api";
import { ErrorState } from "@/components/wms/OperationalUi";
import { getStoredAuthRole, PORTAL_ROLES } from "@/lib/portal-access";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/wms-operational";
import { shortDate, statusLabels, typeLabels } from "@/components/wms/notification-utils";
import { NotificationDetailModal } from "@/components/wms/NotificationDetailModal";

const inputClass =
  "h-10 w-full rounded border border-input bg-background px-3 text-xs text-foreground outline-none transition focus:border-info focus:ring-2 focus:ring-info/15 disabled:cursor-not-allowed disabled:opacity-60";

const defaultFilters = {
  search: "",
  notification_type: "",
  read: "",
  priority: "",
  status: "",
  date_from: "",
  date_to: "",
  sort_by: "",
  sort_order: "desc"
};

const notificationTypes = [
  "pending_approval",
  "correction_request",
  "approval_decision",
  "placement_override",
  "dispatch_request",
  "dispatch_update",
  "customs_inspection",
  "invoice_pending",
  "warehouse_alert",
  "system_announcement"
];

const VIEW_OPTIONS = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "archived", label: "Archived" }
];

const FILTER_STORAGE_KEY = "wms.notifications.filtersExpanded";

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getInitialFiltersExpanded() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(FILTER_STORAGE_KEY) === "true";
}

function priorityTone(priority) {
  if (priority === "urgent") return "critical";
  if (priority === "high") return "high";
  if (priority === "low") return "low";
  return "normal";
}

function notificationStatusTone(status) {
  if (status === "completed") return "completed";
  if (status === "dismissed") return "dismissed";
  return "pending";
}

function getRecordReference(notification) {
  return notification?.related_record_reference
    || notification?.related_cargo_identifier
    || notification?.cargo_reference
    || notification?.dispatch_reference
    || notification?.invoice_reference
    || notification?.public_reference
    || "";
}

function getTypeMeta(type = "") {
  if (type.includes("dispatch")) {
    return { Icon: Truck, tone: "text-sky-700 bg-sky-50 border-sky-100" };
  }
  if (type.includes("invoice")) {
    return { Icon: DollarSign, tone: "text-emerald-700 bg-emerald-50 border-emerald-100" };
  }
  if (type.includes("approval") || type.includes("correction") || type.includes("override")) {
    return { Icon: ClipboardCheck, tone: "text-blue-700 bg-blue-50 border-blue-100" };
  }
  if (type.includes("warehouse")) {
    return { Icon: AlertTriangle, tone: "text-amber-700 bg-amber-50 border-amber-100" };
  }
  if (type.includes("customs")) {
    return { Icon: FileText, tone: "text-slate-700 bg-slate-50 border-slate-200" };
  }
  if (type.includes("announcement") || type.includes("system")) {
    return { Icon: Bell, tone: "text-indigo-700 bg-indigo-50 border-indigo-100" };
  }
  return { Icon: Package, tone: "text-cyan-700 bg-cyan-50 border-cyan-100" };
}

function SoftBadge({ children, tone = "muted", className }) {
  const tones = {
    low: "border-slate-200 bg-slate-50 text-slate-600",
    normal: "border-blue-100 bg-blue-50 text-blue-700",
    high: "border-amber-200 bg-amber-50 text-amber-700",
    critical: "border-rose-200 bg-rose-50 text-rose-700",
    pending: "border-amber-200 bg-amber-50 text-amber-700",
    completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dismissed: "border-slate-200 bg-slate-50 text-slate-600",
    unread: "border-blue-200 bg-blue-50 text-blue-700",
    read: "border-slate-200 bg-slate-50 text-slate-600",
    archived: "border-slate-200 bg-slate-100 text-slate-600",
    muted: "border-border bg-muted/60 text-muted-foreground"
  };

  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none",
      tones[tone] || tones.muted,
      className
    )}
    >
      {children}
    </span>
  );
}

function SummaryCard({ icon: Icon, label, value, tone = "info" }) {
  const tones = {
    info: "border-blue-100 bg-blue-50 text-blue-700",
    warning: "border-amber-100 bg-amber-50 text-amber-700",
    success: "border-emerald-100 bg-emerald-50 text-emerald-700",
    muted: "border-slate-200 bg-slate-50 text-slate-600"
  };

  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold leading-none text-foreground">{safeNumber(value).toLocaleString()}</div>
        </div>
        <div className={cn("rounded-md border p-2", tones[tone])}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function AdminPageTab({ active, icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-t border px-5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-info/30",
        active
          ? "border-border border-b-background bg-background text-info"
          : "border-transparent bg-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground"
      )}
    >
      <Icon className={cn("h-4 w-4", active ? "text-info" : "text-muted-foreground")} />
      {label}
    </button>
  );
}

function SegmentedTabs({ activeView, counts, onChange }) {
  return (
    <div className="inline-flex max-w-full flex-wrap rounded-md border border-border bg-muted/40 p-1">
      {VIEW_OPTIONS.map((option) => {
        const count = option.id === "all"
          ? counts.active
          : option.id === "unread"
            ? counts.unread
            : counts.archived;
        const active = activeView === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded px-3 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-info/30",
              active
                ? "bg-background text-info shadow-sm"
                : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
            )}
            aria-pressed={active}
          >
            {option.label}
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[10px]",
              active ? "bg-info/10 text-info" : "bg-background text-muted-foreground"
            )}
            >
              {safeNumber(count).toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function EmptyNotifications({ view }) {
  const copy = view === "archived"
    ? {
        title: "No archived notifications.",
        body: "Archived notifications will appear here after you archive completed or informational items.",
        Icon: Archive
      }
    : view === "unread"
      ? {
          title: "You're all caught up.",
          body: "Unread notifications will appear here when new work or announcements arrive.",
          Icon: CheckCheck
        }
      : {
          title: "No notifications found.",
          body: "Try changing your filters or check back later.",
          Icon: Inbox
        };
  const Icon = copy.Icon;

  return (
    <div className="rounded-md border border-dashed border-border bg-background px-5 py-12 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted/50">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="mt-3 text-sm font-semibold text-foreground">{copy.title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{copy.body}</div>
    </div>
  );
}

function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  const pages = [];

  for (let candidate = 1; candidate <= totalPages; candidate++) {
    if (
      candidate === 1
      || candidate === totalPages
      || Math.abs(candidate - page) <= 1
    ) {
      pages.push(candidate);
    } else if (pages[pages.length - 1] !== "...") {
      pages.push("...");
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-background px-3 py-3 text-xs text-muted-foreground lg:flex-row lg:items-center lg:justify-between">
      <div className="font-medium">
        Showing {start}-{end} of {safeNumber(total).toLocaleString()} notifications
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-8 rounded border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-info/20"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="inline-flex h-8 items-center gap-1 rounded border border-border px-2 font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Previous
          </button>
          {pages.map((item, index) => item === "..." ? (
            <span key={`ellipsis-${index}`} className="px-2">...</span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              className={cn(
                "h-8 min-w-8 rounded border px-2 font-semibold transition",
                item === page
                  ? "border-info bg-info text-info-foreground"
                  : "border-border text-foreground hover:bg-muted"
              )}
              aria-current={item === page ? "page" : undefined}
            >
              {item}
            </button>
          ))}
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="inline-flex h-8 items-center gap-1 rounded border border-border px-2 font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function NotificationCard({
  notification,
  archivedView,
  onOpen,
  onArchive,
  onRestore,
  onMarkRead
}) {
  const { Icon, tone } = getTypeMeta(notification.notification_type);
  const reference = getRecordReference(notification);
  const typeLabel = typeLabels[notification.notification_type] || notification.notification_type || "Notification";
  const status = notification.status || "pending";
  const priority = notification.priority || "normal";

  return (
    <article
      className={cn(
        "rounded-md border border-border bg-card p-4 shadow-sm transition hover:border-info/25 hover:shadow-md",
        !notification.is_read && !archivedView && "border-l-4 border-l-info",
        archivedView && "bg-muted/20 text-muted-foreground"
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-1 gap-3">
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-md border", tone)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 break-words text-sm font-semibold text-foreground" title={notification.title}>
                {notification.title}
              </h3>
              {archivedView && <SoftBadge tone="archived">Archived</SoftBadge>}
            </div>
            <p className="mt-1 line-clamp-2 max-w-4xl text-xs leading-relaxed text-muted-foreground" title={notification.message}>
              {notification.message}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <SoftBadge tone="muted">{typeLabel}</SoftBadge>
              {reference && <span className="font-mono font-semibold text-foreground">{reference}</span>}
              {notification.related_module && <span>{notification.related_module}</span>}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-3 lg:min-w-72 lg:items-end">
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <SoftBadge tone={priorityTone(priority)}>
              {priority === "urgent" ? "Critical" : `${priority.charAt(0).toUpperCase()}${priority.slice(1)}`} Priority
            </SoftBadge>
            <SoftBadge tone={notificationStatusTone(status)}>
              {statusLabels[status] || status}
            </SoftBadge>
            <SoftBadge tone={notification.is_read ? "read" : "unread"}>
              {notification.is_read ? "Read" : "Unread"}
            </SoftBadge>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted-foreground lg:justify-end">
            <CalendarDays className="h-3.5 w-3.5" />
            <span>{shortDate(notification.created_at)}</span>
            {archivedView && notification.archived_at && (
              <>
                <span aria-hidden="true">•</span>
                <Archive className="h-3.5 w-3.5" />
                <span>{shortDate(notification.archived_at)}</span>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <button
              type="button"
              onClick={() => onOpen(notification)}
              className="inline-flex h-8 items-center gap-1.5 rounded bg-info px-3 text-[11px] font-semibold text-info-foreground transition hover:bg-info/90 focus:outline-none focus:ring-2 focus:ring-info/30"
              aria-label={`Open ${notification.title}`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open
            </button>
            {!archivedView && !notification.is_read && (
              <button
                type="button"
                onClick={() => onMarkRead(notification)}
                className="inline-flex h-8 items-center gap-1.5 rounded border border-info/25 bg-info/10 px-3 text-[11px] font-semibold text-info transition hover:bg-info/15 focus:outline-none focus:ring-2 focus:ring-info/20"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark Read
              </button>
            )}
            {archivedView ? (
              <button
                type="button"
                onClick={() => onRestore(notification)}
                className="inline-flex h-8 items-center gap-1.5 rounded border border-info/25 bg-background px-3 text-[11px] font-semibold text-info transition hover:bg-info/10 focus:outline-none focus:ring-2 focus:ring-info/20"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restore
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onArchive(notification)}
                className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-background px-3 text-[11px] font-semibold text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-info/20"
              >
                <Archive className="h-3.5 w-3.5" />
                Archive
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function NotificationsPage() {
  const activeRole = getStoredAuthRole();
  const isAdmin = activeRole === PORTAL_ROLES.SYSTEM_ADMIN;
  const [adminTab, setAdminTab] = useState("notifications");
  const [activeView, setActiveView] = useState("all");
  const [filters, setFilters] = useState(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState(defaultFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filtersExpanded, setFiltersExpanded] = useState(getInitialFiltersExpanded);
  const [state, setState] = useState({ rows: [], loading: true, error: "", total: 0 });
  const [summary, setSummary] = useState({ active: 0, unread: 0, archived: 0, pending: 0 });
  const [announcement, setAnnouncement] = useState({
    title: "",
    message: "",
    target_role_id: "",
    target_warehouse_id: "",
    target_user_id: "",
    priority: "normal",
    expires_at: ""
  });
  const [options, setOptions] = useState({ roles: [], warehouses: [], users: [] });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const showingNotifications = !isAdmin || adminTab === "notifications";
  const showingAnnouncement = isAdmin && adminTab === "announcement";

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(FILTER_STORAGE_KEY, String(filtersExpanded));
    }
  }, [filtersExpanded]);

  const loadSummary = useCallback(async () => {
    try {
      const [summaryResponse, pendingResponse] = await Promise.all([
        getNotificationSummary(),
        getNotifications({ status: "pending", limit: 1 })
      ]);
      setSummary({
        active: summaryResponse.data?.active || 0,
        unread: summaryResponse.data?.unread || 0,
        archived: summaryResponse.data?.archived || 0,
        pending: pendingResponse.total || pendingResponse.data?.length || 0
      });
    } catch (error) {
      console.error("Notification summary load failed:", error);
    }
  }, []);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const query = Object.fromEntries(
        Object.entries(appliedFilters).filter(([, value]) => value !== "")
      );
      const nextQuery = {
        ...query,
        page,
        limit: pageSize
      };

      if (activeView === "unread") {
        nextQuery.read = "false";
      }

      if (activeView === "archived") {
        nextQuery.archived = "true";
        nextQuery.sort_by = nextQuery.sort_by || "archived_at";
        nextQuery.date_field = nextQuery.date_field || "archived_at";
      }

      const response = await getNotifications(nextQuery);
      setState({
        rows: response.data || [],
        loading: false,
        error: "",
        total: response.total ?? response.count ?? response.data?.length ?? 0
      });
    } catch (error) {
      setState({ rows: [], loading: false, error: getErrorMessage(error), total: 0 });
    }
  }, [activeView, appliedFilters, page, pageSize]);

  useEffect(() => {
    if (!showingNotifications) return;
    load();
    loadSummary();
  }, [load, loadSummary, showingNotifications]);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;

    Promise.all([
      getRoles(),
      getWarehouses()
    ]).then(([roles, warehouses]) => {
      if (active) {
        setOptions((current) => ({
          ...current,
          roles: roles.data || [],
          warehouses: warehouses.data || []
        }));
      }
    }).catch(() => {
      if (active) setOptions({ roles: [], warehouses: [], users: [] });
    });

    return () => {
      active = false;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    const params = { status: "active" };

    if (announcement.target_role_id) {
      params.role_id = announcement.target_role_id;
    }

    if (announcement.target_warehouse_id) {
      params.warehouse_id = announcement.target_warehouse_id;
    }

    getUsers(params)
      .then((users) => {
        if (!active) return;
        const rows = users.data || [];
        setOptions((current) => ({ ...current, users: rows }));
        setAnnouncement((current) => (
          current.target_user_id && !rows.some((user) => String(user.id) === String(current.target_user_id))
            ? { ...current, target_user_id: "" }
            : current
        ));
      })
      .catch(() => {
        if (active) {
          setOptions((current) => ({ ...current, users: [] }));
          setAnnouncement((current) => ({ ...current, target_user_id: "" }));
        }
      });

    return () => {
      active = false;
    };
  }, [announcement.target_role_id, announcement.target_warehouse_id, isAdmin]);

  const viewTitle = useMemo(() => {
    if (activeView === "archived") return "Archived Notifications";
    if (activeView === "unread") return "Unread Notifications";
    return "All Notifications";
  }, [activeView]);

  const totalNotifications = summary.active + summary.archived;
  const activeFilterCount = useMemo(
    () => Object.entries(appliedFilters).filter(([, value]) => value !== "").length,
    [appliedFilters]
  );

  const applyFilters = (event) => {
    event.preventDefault();
    setPage(1);
    setAppliedFilters(filters);
  };

  const resetFilters = () => {
    setFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
    setPage(1);
  };

  const changeView = (view) => {
    setActiveView(view);
    setPage(1);
  };

  const changePageSize = (nextPageSize) => {
    setPageSize(nextPageSize);
    setPage(1);
  };

  const replaceRow = (publicRef, updater) => {
    setState((current) => ({
      ...current,
      rows: current.rows
        .map((row) => row.public_reference === publicRef ? updater(row) : row)
        .filter(Boolean)
    }));
  };

  const markRead = async (notification) => {
    if (!notification || notification.is_read) return;
    replaceRow(notification.public_reference, (row) => (
      activeView === "unread" ? null : { ...row, is_read: true, read_at: row.read_at || new Date().toISOString() }
    ));
    setSummary((current) => ({
      ...current,
      unread: Math.max(0, current.unread - 1)
    }));
    try {
      await markNotificationRead(notification.public_reference);
    } catch (error) {
      setState((current) => ({ ...current, error: getErrorMessage(error) }));
      await load();
      await loadSummary();
    }
  };

  const markAllRead = async () => {
    setState((current) => ({
      ...current,
      rows: activeView === "unread"
        ? []
        : current.rows.map((row) => ({ ...row, is_read: true, read_at: row.read_at || new Date().toISOString() }))
    }));
    setSummary((current) => ({ ...current, unread: 0 }));
    try {
      await markAllNotificationsRead();
    } catch (error) {
      setState((current) => ({ ...current, error: getErrorMessage(error) }));
      await load();
      await loadSummary();
    }
  };

  const archiveRow = async (notification) => {
    setState((current) => ({ ...current, error: "" }));
    try {
      const response = await archiveNotification(notification.public_reference);
      replaceRow(notification.public_reference, () => null);
      setSummary((current) => ({
        ...current,
        active: Math.max(0, current.active - 1),
        unread: notification.is_read ? current.unread : Math.max(0, current.unread - 1),
        archived: current.archived + 1,
        pending: notification.status === "pending" ? Math.max(0, current.pending - 1) : current.pending
      }));
      setSelectedNotification((current) => (
        current?.public_reference === notification.public_reference
          ? { ...current, ...(response.data || {}), archived_at: response.data?.archived_at || new Date().toISOString() }
          : current
      ));
    } catch (error) {
      setState((current) => ({ ...current, error: getErrorMessage(error) }));
    }
  };

  const restoreRow = async (notification) => {
    setState((current) => ({ ...current, error: "" }));
    try {
      await restoreNotification(notification.public_reference);
      replaceRow(notification.public_reference, () => null);
      setSummary((current) => ({
        ...current,
        active: current.active + 1,
        archived: Math.max(0, current.archived - 1),
        pending: notification.status === "pending" ? current.pending + 1 : current.pending
      }));
    } catch (error) {
      setState((current) => ({ ...current, error: getErrorMessage(error) }));
    }
  };

  const openRelated = (notification) => {
    setSelectedNotification(notification);
    setModalOpen(true);
  };

  const handleReadCompleted = (readNotification) => {
    if (!readNotification?.public_reference) return;
    replaceRow(readNotification.public_reference, (row) => (
      activeView === "unread" ? null : { ...row, ...readNotification, is_read: true }
    ));
    setSelectedNotification((current) => (
      current?.public_reference === readNotification.public_reference
        ? { ...current, ...readNotification, is_read: true }
        : current
    ));
    setSummary((current) => ({
      ...current,
      unread: Math.max(0, current.unread - 1)
    }));
  };

  const handleArchiveCompleted = (notification) => {
    if (notification?.public_reference) {
      replaceRow(notification.public_reference, () => null);
      setSummary((current) => ({
        ...current,
        active: Math.max(0, current.active - 1),
        archived: current.archived + 1,
        unread: notification.is_read ? current.unread : Math.max(0, current.unread - 1),
        pending: notification.status === "pending" ? Math.max(0, current.pending - 1) : current.pending
      }));
    }
  };

  const handleRestoreCompleted = (notification) => {
    if (notification?.public_reference) {
      replaceRow(notification.public_reference, () => null);
      setSummary((current) => ({
        ...current,
        active: current.active + 1,
        archived: Math.max(0, current.archived - 1),
        pending: notification.status === "pending" ? current.pending + 1 : current.pending
      }));
    }
  };

  const submitAnnouncement = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      await createSystemAnnouncement({
        ...announcement,
        target_role_id: announcement.target_role_id || null,
        target_warehouse_id: announcement.target_warehouse_id || null,
        target_user_id: announcement.target_user_id || null,
        expires_at: announcement.expires_at || null
      });
      setAnnouncement({
        title: "",
        message: "",
        target_role_id: "",
        target_warehouse_id: "",
        target_user_id: "",
        priority: "normal",
        expires_at: ""
      });
      await Promise.all([load(), loadSummary()]);
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="border-b border-border bg-card px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Notifications</div>
            <h1 className="mt-1 text-xl font-semibold leading-tight text-foreground">Notifications</h1>
            <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
              Operational alerts, approvals, dispatch updates, and system announcements.
            </p>
          </div>
        </div>

        {showingNotifications && (
          <div className={cn(
            "mt-4 grid gap-3 sm:grid-cols-2",
            activeView !== "archived" ? "xl:grid-cols-5" : "xl:grid-cols-4"
          )}
          >
            <SummaryCard icon={Bell} label="Total Notifications" value={totalNotifications} tone="info" />
            <SummaryCard icon={CheckCheck} label="Unread" value={summary.unread} tone="warning" />
            <SummaryCard icon={ClipboardCheck} label="Pending Actions" value={summary.pending} tone="success" />
            <SummaryCard icon={Archive} label="Archived" value={summary.archived} tone="muted" />
            {activeView !== "archived" && (
              <div className="rounded-md border border-border bg-background p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Quick Action</div>
                <button
                  type="button"
                  onClick={markAllRead}
                  className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded bg-info px-4 text-xs font-semibold text-info-foreground transition hover:bg-info/90 focus:outline-none focus:ring-2 focus:ring-info/30"
                >
                  <CheckCheck className="h-4 w-4" />
                  Mark all as read
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-4">
          {isAdmin && (
            <div className="flex flex-wrap items-end gap-1 border-b border-border bg-muted/20 px-1 pt-2">
              <AdminPageTab
                active={adminTab === "notifications"}
                icon={Bell}
                label="Notifications"
                onClick={() => setAdminTab("notifications")}
              />
              <AdminPageTab
                active={adminTab === "announcement"}
                icon={Megaphone}
                label="Create Announcement"
                onClick={() => setAdminTab("announcement")}
              />
            </div>
          )}

          {showingNotifications && (
            <>
              {state.error && <ErrorState message={state.error} />}

              <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3 lg:flex-row lg:items-center lg:justify-between">
                <SegmentedTabs activeView={activeView} counts={summary} onChange={changeView} />
                <button
                  type="button"
                  onClick={() => setFiltersExpanded((value) => !value)}
                  className="inline-flex h-9 w-fit items-center gap-2 rounded border border-border bg-background px-3 text-xs font-semibold text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-info/20"
                  aria-expanded={filtersExpanded}
                >
                  <SlidersHorizontal className="h-4 w-4 text-info" />
                  Advanced Filters
                  {activeFilterCount > 0 && <SoftBadge tone="normal">{activeFilterCount}</SoftBadge>}
                  <ChevronDown className={cn("h-4 w-4 transition", filtersExpanded && "rotate-180")} />
                </button>
              </div>

              {filtersExpanded && (
                <section className="rounded-md border border-border bg-card p-4">
                  <form className="space-y-3" onSubmit={applyFilters}>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <label className="text-[11px] font-semibold text-muted-foreground">
                        Search
                        <div className="relative mt-1">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <input
                            value={filters.search}
                            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                            className={cn(inputClass, "pl-9")}
                            placeholder="Search notifications"
                          />
                        </div>
                      </label>
                      <label className="text-[11px] font-semibold text-muted-foreground">
                        Notification Type
                        <select
                          value={filters.notification_type}
                          onChange={(event) => setFilters((current) => ({ ...current, notification_type: event.target.value }))}
                          className={cn(inputClass, "mt-1")}
                        >
                          <option value="">All types</option>
                          {notificationTypes.map((type) => (
                            <option key={type} value={type}>{typeLabels[type]}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[11px] font-semibold text-muted-foreground">
                        Priority
                        <select
                          value={filters.priority}
                          onChange={(event) => setFilters((current) => ({ ...current, priority: event.target.value }))}
                          className={cn(inputClass, "mt-1")}
                        >
                          <option value="">All priorities</option>
                          <option value="urgent">Critical</option>
                          <option value="high">High</option>
                          <option value="normal">Normal</option>
                          <option value="low">Low</option>
                        </select>
                      </label>
                      <label className="text-[11px] font-semibold text-muted-foreground">
                        Status
                        <select
                          value={filters.status}
                          onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
                          className={cn(inputClass, "mt-1")}
                        >
                          <option value="">All statuses</option>
                          <option value="pending">Pending</option>
                          <option value="completed">Completed</option>
                          <option value="dismissed">Dismissed</option>
                        </select>
                      </label>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <label className="text-[11px] font-semibold text-muted-foreground">
                        Date From
                        <input
                          type="date"
                          value={filters.date_from}
                          onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value }))}
                          className={cn(inputClass, "mt-1")}
                        />
                      </label>
                      <label className="text-[11px] font-semibold text-muted-foreground">
                        Date To
                        <input
                          type="date"
                          value={filters.date_to}
                          onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value }))}
                          className={cn(inputClass, "mt-1")}
                        />
                      </label>
                      <label className="text-[11px] font-semibold text-muted-foreground">
                        Sort By
                        <select
                          value={filters.sort_by}
                          onChange={(event) => setFilters((current) => ({ ...current, sort_by: event.target.value }))}
                          className={cn(inputClass, "mt-1")}
                        >
                          <option value="">{activeView === "archived" ? "Archived date" : "Default order"}</option>
                          <option value="archived_at">Archived date</option>
                          <option value="created_at">Created date</option>
                          <option value="status">Status</option>
                        </select>
                      </label>
                      <label className="text-[11px] font-semibold text-muted-foreground">
                        Read State
                        <select
                          value={activeView === "unread" ? "false" : filters.read}
                          disabled={activeView === "unread"}
                          onChange={(event) => setFilters((current) => ({ ...current, read: event.target.value }))}
                          className={cn(inputClass, "mt-1")}
                        >
                          <option value="">Read and unread</option>
                          <option value="false">Unread only</option>
                          <option value="true">Read only</option>
                        </select>
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="h-9 rounded border border-border bg-secondary px-4 text-xs font-semibold text-foreground transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-info/20"
                      >
                        Reset Filters
                      </button>
                      <button
                        type="submit"
                        className="h-9 rounded bg-info px-4 text-xs font-semibold text-info-foreground transition hover:bg-info/90 focus:outline-none focus:ring-2 focus:ring-info/30"
                      >
                        Apply Filters
                      </button>
                    </div>
                  </form>
                </section>
              )}

              <section className="space-y-3" aria-label={viewTitle}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-foreground">{viewTitle}</h2>
                    <p className="text-xs text-muted-foreground">Open a card to view full notification context.</p>
                  </div>
                </div>

                {state.loading && state.rows.length === 0 ? (
                  <div className="rounded-md border border-border bg-card px-5 py-10 text-center text-xs font-medium text-muted-foreground">
                    Loading notifications...
                  </div>
                ) : state.rows.length === 0 ? (
                  <EmptyNotifications view={activeView} />
                ) : (
                  <div className="space-y-3">
                    {state.rows.map((notification, index) => (
                      <NotificationCard
                        key={notification.public_reference || notification.id || `${notification.notification_type}-${index}`}
                        notification={notification}
                        archivedView={activeView === "archived" || Boolean(notification.archived_at)}
                        onOpen={openRelated}
                        onArchive={archiveRow}
                        onRestore={restoreRow}
                        onMarkRead={markRead}
                      />
                    ))}
                  </div>
                )}

                <Pagination
                  page={page}
                  pageSize={pageSize}
                  total={state.total}
                  onPageChange={setPage}
                  onPageSizeChange={changePageSize}
                />
              </section>
            </>
          )}

          {showingAnnouncement && (
            <section className="rounded-md border border-border bg-card p-4">
              <div className="mb-4 flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-info" />
                <h2 className="text-sm font-semibold text-foreground">Create System Announcement</h2>
              </div>
              {formError && <div className="mb-3"><ErrorState message={formError} /></div>}
              <form className="grid gap-3 lg:grid-cols-2" onSubmit={submitAnnouncement}>
                <input
                  value={announcement.title}
                  onChange={(event) => setAnnouncement((current) => ({ ...current, title: event.target.value }))}
                  className={inputClass}
                  placeholder="Announcement title"
                  required
                />
                <select
                  value={announcement.priority}
                  onChange={(event) => setAnnouncement((current) => ({ ...current, priority: event.target.value }))}
                  className={inputClass}
                >
                  <option value="normal">Normal priority</option>
                  <option value="high">High priority</option>
                  <option value="urgent">Critical priority</option>
                  <option value="low">Low priority</option>
                </select>
                <textarea
                  value={announcement.message}
                  onChange={(event) => setAnnouncement((current) => ({ ...current, message: event.target.value }))}
                  className="min-h-28 rounded border border-input bg-background px-3 py-2 text-xs outline-none transition focus:border-info focus:ring-2 focus:ring-info/15 lg:col-span-2"
                  placeholder="Announcement message"
                  required
                />
                <select
                  value={announcement.target_role_id}
                  onChange={(event) => setAnnouncement((current) => ({ ...current, target_role_id: event.target.value }))}
                  className={inputClass}
                >
                  <option value="">All roles</option>
                  {options.roles.map((role) => (
                    <option key={role.id} value={role.id}>{role.role_name}</option>
                  ))}
                </select>
                <select
                  value={announcement.target_warehouse_id}
                  onChange={(event) => setAnnouncement((current) => ({ ...current, target_warehouse_id: event.target.value }))}
                  className={inputClass}
                >
                  <option value="">All warehouses</option>
                  {options.warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>{warehouse.warehouse_name}</option>
                  ))}
                </select>
                <select
                  value={announcement.target_user_id}
                  onChange={(event) => setAnnouncement((current) => ({ ...current, target_user_id: event.target.value }))}
                  className={inputClass}
                >
                  <option value="">No specific user</option>
                  {options.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name || user.username}
                      {user.role_name ? ` - ${user.role_name}` : ""}
                      {user.warehouse_name ? ` - ${user.warehouse_name}` : ""}
                    </option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  value={announcement.expires_at}
                  onChange={(event) => setAnnouncement((current) => ({ ...current, expires_at: event.target.value }))}
                  className={inputClass}
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="h-10 rounded bg-info px-4 text-xs font-semibold text-info-foreground transition hover:bg-info/90 disabled:opacity-50 lg:col-span-2"
                >
                  {saving ? "Creating announcement..." : "Create Announcement"}
                </button>
              </form>
            </section>
          )}
        </div>
      </div>

      <NotificationDetailModal
        open={modalOpen}
        notification={selectedNotification}
        onClose={() => {
          setModalOpen(false);
          setSelectedNotification(null);
        }}
        onActionCompleted={() => {}}
        onArchived={handleArchiveCompleted}
        onRead={handleReadCompleted}
        onRestored={handleRestoreCompleted}
        readOnly={activeView === "archived" || Boolean(selectedNotification?.archived_at)}
      />
    </>
  );
}

export { NotificationsPage };

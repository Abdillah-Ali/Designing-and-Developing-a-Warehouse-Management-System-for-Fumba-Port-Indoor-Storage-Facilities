import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck, ExternalLink, Megaphone, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  createSystemAnnouncement,
  getNotifications,
  getRoles,
  getUsers,
  getWarehouses,
  markAllNotificationsRead,
  markNotificationRead
} from "@/services/api";
import {
  DataTable,
  ErrorState,
  PageHeader,
  SectionCard,
  StatusBadge
} from "@/components/wms/OperationalUi";
import { getStoredAuthRole, PORTAL_ROLES } from "@/lib/portal-access";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/wms-operational";
import { getRelatedPath, shortDate, typeLabels } from "@/components/wms/notification-utils";

const inputClass =
  "h-9 w-full rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

const defaultFilters = {
  search: "",
  notification_type: "",
  read: "",
  priority: ""
};

const notificationTypes = [
  "pending_approval",
  "correction_request",
  "approval_decision",
  "placement_override",
  "dispatch_request",
  "warehouse_alert",
  "system_announcement"
];

function priorityTone(priority) {
  if (priority === "urgent" || priority === "high") return "destructive";
  if (priority === "low") return "muted";
  return "info";
}

function NotificationsPage() {
  const navigate = useNavigate();
  const activeRole = getStoredAuthRole();
  const isAdmin = activeRole === PORTAL_ROLES.SYSTEM_ADMIN;
  const [filters, setFilters] = useState(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState(defaultFilters);
  const [state, setState] = useState({ rows: [], loading: true, error: "" });
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

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const query = Object.fromEntries(
        Object.entries(appliedFilters).filter(([, value]) => value !== "")
      );
      const response = await getNotifications({ ...query, limit: 100 });
      setState({ rows: response.data || [], loading: false, error: "" });
    } catch (error) {
      setState({ rows: [], loading: false, error: getErrorMessage(error) });
    }
  }, [appliedFilters]);

  useEffect(() => {
    load();
  }, [load]);

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
    const params = {
      status: "active"
    };

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
        setOptions((current) => ({
          ...current,
          users: rows
        }));
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

  const unreadCount = useMemo(
    () => state.rows.filter((notification) => !notification.is_read).length,
    [state.rows]
  );

  const markRead = async (notification) => {
    await markNotificationRead(notification.id);
    await load();
  };

  const markAllRead = async () => {
    await markAllNotificationsRead();
    await load();
  };

  const openRelated = async (notification) => {
    const path = getRelatedPath(notification);
    if (!path) return;
    if (!notification.is_read) await markNotificationRead(notification.id);
    navigate(path);
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
      await load();
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      key: "notification",
      label: "Notification",
      render: (row) => (
        <div className={cn("min-w-0", !row.is_read && "font-semibold")}>
          <div className="truncate">{row.title}</div>
          <div className="mt-0.5 line-clamp-2 text-xs font-normal text-muted-foreground">{row.message}</div>
        </div>
      )
    },
    {
      key: "type",
      label: "Type",
      render: (row) => typeLabels[row.notification_type] || row.notification_type
    },
    {
      key: "priority",
      label: "Priority",
      render: (row) => <StatusBadge tone={priorityTone(row.priority)}>{row.priority}</StatusBadge>
    },
    {
      key: "created_at",
      label: "Created",
      render: (row) => shortDate(row.created_at)
    },
    {
      key: "state",
      label: "State",
      render: (row) => row.is_read
        ? <StatusBadge tone="muted">Read</StatusBadge>
        : <StatusBadge tone="info">Unread</StatusBadge>
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <div className="flex flex-wrap items-center gap-2">
          {!row.is_read && (
            <button
              type="button"
              onClick={() => markRead(row)}
              className="rounded border border-info/30 bg-info/10 px-2 py-1 text-[11px] font-semibold text-info"
            >
              Mark as read
            </button>
          )}
          {getRelatedPath(row) && (
            <button
              type="button"
              onClick={() => openRelated(row)}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-semibold"
            >
              <ExternalLink className="h-3 w-3" />
              Open
            </button>
          )}
        </div>
      )
    }
  ];

  return (
    <>
      <PageHeader
        eyebrow="Notifications"
        title="Notifications"
        description="Operational alerts, approvals, dispatch updates, and system announcements."
        action={(
          <button
            type="button"
            onClick={markAllRead}
            className="inline-flex h-9 items-center gap-2 rounded bg-info px-3 text-xs font-semibold text-info-foreground"
          >
            <CheckCheck className="h-4 w-4" />
            Mark all as read
          </button>
        )}
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-3">
          {state.error && <ErrorState message={state.error} />}

          <SectionCard title="Filters" icon={Search}>
            <form
              className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"
              onSubmit={(event) => {
                event.preventDefault();
                setAppliedFilters(filters);
              }}
            >
              <input
                value={filters.search}
                onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                className={inputClass}
                placeholder="Search notifications"
              />
              <select
                value={filters.notification_type}
                onChange={(event) => setFilters((current) => ({ ...current, notification_type: event.target.value }))}
                className={inputClass}
              >
                <option value="">All types</option>
                {notificationTypes.map((type) => (
                  <option key={type} value={type}>{typeLabels[type]}</option>
                ))}
              </select>
              <select
                value={filters.read}
                onChange={(event) => setFilters((current) => ({ ...current, read: event.target.value }))}
                className={inputClass}
              >
                <option value="">Read and unread</option>
                <option value="false">Unread only</option>
                <option value="true">Read only</option>
              </select>
              <select
                value={filters.priority}
                onChange={(event) => setFilters((current) => ({ ...current, priority: event.target.value }))}
                className={inputClass}
              >
                <option value="">All priorities</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
              <button
                type="submit"
                className="h-9 rounded bg-info px-3 text-xs font-semibold text-info-foreground"
              >
                Apply
              </button>
            </form>
          </SectionCard>

          {isAdmin && (
            <SectionCard title="Create System Announcement" icon={Megaphone}>
              {formError && <ErrorState message={formError} />}
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
                  <option value="urgent">Urgent priority</option>
                  <option value="low">Low priority</option>
                </select>
                <textarea
                  value={announcement.message}
                  onChange={(event) => setAnnouncement((current) => ({ ...current, message: event.target.value }))}
                  className="min-h-20 rounded border border-input bg-background px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring lg:col-span-2"
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
                  className="h-9 rounded bg-info px-3 text-xs font-semibold text-info-foreground disabled:opacity-50 lg:col-span-2"
                >
                  {saving ? "Creating announcement..." : "Create Announcement"}
                </button>
              </form>
            </SectionCard>
          )}

          <SectionCard title={`Notification List (${unreadCount} unread)`} icon={Bell}>
            <DataTable
              loading={state.loading}
              rows={state.rows}
              emptyTitle="No notifications found"
              columns={columns}
            />
          </SectionCard>
        </div>
      </div>
    </>
  );
}

export { NotificationsPage };

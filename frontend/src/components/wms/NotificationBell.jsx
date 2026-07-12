import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getPortalConfig, getStoredAuthRole, getStoredAuthToken } from "@/lib/portal-access";
import { cn } from "@/lib/utils";
import {
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead
} from "@/services/api";
import { shortDate, statusLabels, typeLabels } from "@/components/wms/notification-utils";
import { NotificationDetailModal } from "@/components/wms/NotificationDetailModal";

function getPortalBase() {
  return getPortalConfig(getStoredAuthRole())?.basePath || "";
}

function NotificationBell() {
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const loadNotifications = useCallback(async () => {
    if (!getStoredAuthToken()) return;
    setLoading(true);
    try {
      const [countResponse, listResponse] = await Promise.all([
        getUnreadNotificationCount(),
        getNotifications({ read: "false", limit: 5 })
      ]);
      setCount(Number(countResponse.data?.count || 0));
      setNotifications((listResponse.data || []).filter((notification) => !notification.is_read));
    } catch {
      setCount(0);
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  if (!getStoredAuthToken()) return null;

  const openAll = () => {
    setOpen(false);
    const basePath = getPortalBase();
    if (basePath) navigate(`${basePath}/notifications`);
  };

  const markRead = async (notification, event) => {
    if (event) event.stopPropagation();
    setNotifications((current) => current.filter((entry) => entry.public_reference !== notification.public_reference));
    setCount((current) => Math.max(current - 1, 0));
    try {
      await markNotificationRead(notification.public_reference);
    } catch (err) {
      console.error("Non-blocking mark read failure:", err);
    }
    await loadNotifications();
  };

  const markAllRead = async () => {
    setNotifications([]);
    setCount(0);
    try {
      await markAllNotificationsRead();
    } catch (err) {
      console.error("Mark all read failure:", err);
    }
    await loadNotifications();
  };

  const handleNotificationClick = (notification) => {
    setSelectedNotification(notification);
    setModalOpen(true);
    setOpen(false);
  };

  const handleArchiveCompleted = (archivedNtf) => {
    setNotifications((current) => current.filter((entry) => entry.public_reference !== archivedNtf.public_reference));
    loadNotifications();
  };

  const handleReadCompleted = (readNotification) => {
    setSelectedNotification((current) => (
      current?.public_reference === readNotification.public_reference
        ? { ...current, ...readNotification, is_read: true }
        : current
    ));
    setNotifications((current) =>
      current.filter((entry) => entry.public_reference !== readNotification.public_reference)
    );
    setCount((current) => Math.max(current - 1, 0));
    loadNotifications();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          loadNotifications();
        }}
        className="relative inline-flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-white/10"
        aria-label="Notifications"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-destructive-foreground">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[22rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="text-xs font-semibold">Notifications</div>
            <button
              type="button"
              onClick={markAllRead}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-info hover:bg-muted"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all
            </button>
          </div>
          <div className="max-h-80 overflow-auto">
            {loading ? (
              <div className="px-3 py-5 text-center text-xs text-muted-foreground">Loading notifications...</div>
            ) : notifications.length === 0 ? (
              <div className="px-3 py-5 text-center text-xs text-muted-foreground">No unread notifications.</div>
            ) : notifications.map((notification) => {
              return (
                <div
                  key={notification.public_reference}
                  onClick={() => handleNotificationClick(notification)}
                  className={cn(
                    "cursor-pointer border-b border-border px-3 py-2 text-xs last:border-b-0 hover:bg-muted/40 transition-colors",
                    !notification.is_read && "bg-info/10"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="break-words font-semibold leading-snug">{notification.title}</div>
                      <div className="mt-0.5 line-clamp-3 break-words text-muted-foreground">{notification.message}</div>
                    </div>
                    {!notification.is_read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-info" />}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="rounded bg-muted px-1.5 py-0.5">{typeLabels[notification.notification_type] || notification.notification_type}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5">{statusLabels[notification.status] || notification.status}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5">{notification.priority}</span>
                    <span>{shortDate(notification.created_at)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {!notification.is_read && (
                      <button
                        type="button"
                        onClick={(e) => markRead(notification, e)}
                        className="text-[11px] font-semibold text-info hover:underline"
                      >
                        Mark as read
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={openAll}
            className="w-full border-t border-border px-3 py-2 text-center text-xs font-semibold text-info hover:bg-muted"
          >
            Open all notifications
          </button>
        </div>
      )}

      <NotificationDetailModal
        open={modalOpen}
        notification={selectedNotification}
        onClose={() => {
          setModalOpen(false);
          setSelectedNotification(null);
        }}
        onActionCompleted={loadNotifications}
        onArchived={handleArchiveCompleted}
        onRead={handleReadCompleted}
      />
    </div>
  );
}

export { NotificationBell };

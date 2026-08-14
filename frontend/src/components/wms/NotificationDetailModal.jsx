import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Clock,
  Layers,
  FileText,
  AlertCircle,
  Archive,
  CheckCircle2,
  ExternalLink,
  Info,
  RotateCcw,
  Tag
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { EnterpriseModal } from "@/components/wms/EnterpriseModal";
import {
  getNotificationAction,
  shortDate,
  statusLabels,
  typeLabels
} from "@/components/wms/notification-utils";
import { getStoredAuthRole } from "@/lib/portal-access";
import { archiveNotification, markNotificationRead, restoreNotification } from "@/services/api";

const ACTION_DESCRIPTIONS = {
  pending_approval: {
    description: "This cargo registration requires supervisor verification before storage placement."
  },
  placement_override: {
    description: "This placement exception requires supervisor review and bin routing override."
  },
  invoice_pending: {
    description: "This cargo fee transaction requires supervisor approval and invoice confirmation."
  },
  dispatch_request: {
    description: "This cargo gate release request requires supervisor authorization."
  },
  customs_inspection: {
    description: "This cargo record requires customs clearance review before release."
  },
  correction_request: {
    description: "The supervisor requested correction of specific cargo registration details."
  }
};

const PRIORITY_STYLES = {
  low: "bg-muted text-muted-foreground border-transparent",
  normal: "bg-info/10 text-info border-info/20",
  high: "bg-warning/10 text-warning border-warning/20",
  urgent: "bg-destructive/10 text-destructive border-destructive/20"
};

const STATUS_STYLES = {
  pending: "bg-warning/10 text-warning border-warning/20",
  completed: "bg-success/10 text-success border-success/20",
  dismissed: "bg-muted text-muted-foreground border-transparent"
};

function DetailTile({ icon: Icon, label, value, mono = false }) {
  return (
    <div className="rounded border border-border bg-card p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-2 flex min-w-0 items-center gap-1.5 break-words text-xs font-semibold text-foreground ${mono ? "font-mono" : ""}`}>
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 break-words">{value || "Not linked"}</span>
      </div>
    </div>
  );
}

export function NotificationDetailModal({
  open,
  notification,
  onClose,
  onActionCompleted,
  onArchived,
  onRead,
  onRestored,
  readOnly = false
}) {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const readRequests = useRef(new Set());

  const publicRef = notification?.public_reference || "";
  const isArchived = Boolean(notification?.archived_at);
  const isReadOnly = readOnly || isArchived;

  useEffect(() => {
    if (!open) return;
    setError("");
  }, [open, publicRef]);

  useEffect(() => {
    if (!open || !notification || isReadOnly || notification.is_read || !publicRef || readRequests.current.has(publicRef)) {
      return;
    }

    readRequests.current.add(publicRef);
    markNotificationRead(publicRef)
      .then((response) => {
        if (onRead) {
          onRead(response.data || { ...notification, is_read: true });
        }
      })
      .catch((err) => {
        console.error("Non-blocking mark read failure:", err);
      });
  }, [open, publicRef, notification, isReadOnly, onRead]);

  if (!notification) return null;

  const type = notification.notification_type;
  const role = getStoredAuthRole();
  const action = getNotificationAction(notification, role);
  const workflow = notification.actionable ? (ACTION_DESCRIPTIONS[type] || { description: "Complete the linked business workflow to resolve this notification." }) : null;
  const archiveBlocked = notification.actionable === true && notification.status === "pending";
  const showActionButton = !isReadOnly && action.actionRequired && Boolean(action.targetRoute);
  const relatedRecord = action.recordIdentifier || notification.related_record_reference || notification.related_cargo_identifier || "";

  const capitalize = (str) => {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  };

  const handleActionClick = () => {
    if (action.targetRoute) {
      if (onActionCompleted) onActionCompleted(notification);
      onClose?.();
      navigate(action.targetRoute);
    }
  };

  const handleArchiveClick = async () => {
    setError("");
    setBusy(true);
    try {
      await archiveNotification(notification.public_reference);
      if (onArchived) onArchived(notification);
      onClose?.();
    } catch (err) {
      const msg = err.message || "Failed to archive notification.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreClick = async () => {
    setError("");
    setBusy(true);
    try {
      const response = await restoreNotification(notification.public_reference);
      if (onRestored) onRestored(response.data || notification);
      onClose?.();
    } catch (err) {
      const msg = err.message || "Failed to restore notification.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <EnterpriseModal
      open={open}
      title="Notification Details"
      subtitle="Review the alert context and continue in the correct WMS workflow."
      size="medium"
      onClose={onClose}
      footer={(
        <>
          {isArchived ? (
            <button
              type="button"
              disabled={busy || archiveBlocked}
              title={archiveBlocked ? "Complete the required workflow before archiving." : "Archive notification"}
              onClick={handleRestoreClick}
              className="inline-flex items-center gap-2 rounded border border-info/35 bg-info/10 px-4 py-2 text-xs font-semibold text-info transition hover:bg-info/15 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Restore
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={handleArchiveClick}
              className="inline-flex items-center gap-2 rounded border border-destructive/35 bg-destructive/10 px-4 py-2 text-xs font-semibold text-destructive transition hover:bg-destructive/15 disabled:opacity-50"
            >
              <Archive className="h-4 w-4" />
              Archive
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded border border-border bg-secondary px-4 py-2 text-xs font-semibold transition hover:bg-muted disabled:opacity-50"
          >
            Close
          </button>
          {showActionButton && (
            <button
              type="button"
              disabled={busy}
              onClick={handleActionClick}
              className="inline-flex items-center gap-2 rounded bg-info px-4 py-2 text-xs font-semibold text-info-foreground transition hover:bg-info/90 disabled:opacity-50"
            >
              {action.actionLabel}
              <ExternalLink className="h-4 w-4" />
            </button>
          )}
        </>
      )}
    >
      <div className="space-y-4">
        {error && (
          <Alert variant="destructive" className="mb-4 py-2.5">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs leading-normal">{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <DetailTile icon={Tag} label="Notification Reference" value={notification.public_reference} mono />
          <DetailTile icon={Info} label="Notification Type" value={typeLabels[type] || type} />
          <div className="rounded border border-border bg-card p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Priority</div>
            <div className="mt-2">
              <Badge variant="outline" className={PRIORITY_STYLES[notification.priority]}>
                {capitalize(notification.priority)}
              </Badge>
            </div>
          </div>
          <div className="rounded border border-border bg-card p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Status</div>
            <div className="mt-2">
              <Badge variant="outline" className={STATUS_STYLES[notification.status]}>
                {statusLabels[notification.status] || capitalize(notification.status)}
              </Badge>
            </div>
          </div>
          <DetailTile icon={Layers} label="Related Module" value={notification.related_module || "System"} />
          <DetailTile icon={FileText} label="Related Record" value={relatedRecord || "Not linked"} mono />
          {isArchived && (
            <>
              <DetailTile icon={Archive} label="Archived On" value={shortDate(notification.archived_at)} />
              <DetailTile
                icon={CheckCircle2}
                label="Workflow Outcome"
                value={statusLabels[notification.status] || capitalize(notification.status)}
              />
            </>
          )}
        </div>

        <div className="rounded border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Info className="h-4 w-4" />
                Notification
              </div>
              <h3 className="mt-2 break-words text-lg font-semibold text-foreground">{notification.title}</h3>
              <p className="mt-2 break-words text-xs leading-relaxed text-muted-foreground">
                {notification.message}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              {isArchived && (
                <Badge variant="outline" className="bg-muted text-muted-foreground border-transparent">
                  Archived
                </Badge>
              )}
              <Badge variant="outline" className="bg-info/10 text-info border-info/25">
                {notification.is_read ? "read" : "unread"}
              </Badge>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Received {shortDate(notification.created_at)}
            </span>
            {isArchived && (
              <span className="inline-flex items-center gap-1">
                <Archive className="h-3.5 w-3.5" />
                Archived {shortDate(notification.archived_at)}
              </span>
            )}
          </div>
        </div>

        {workflow && (
          <div className="rounded border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {isReadOnly ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                  {isReadOnly ? "Workflow Outcome" : "Action Required"}
                </div>
                <h3 className="mt-2 text-base font-semibold text-foreground">
                  {isReadOnly
                    ? statusLabels[notification.status] || capitalize(notification.status)
                    : action.actionRequired ? action.actionLabel : "No pending workflow action"}
                </h3>
              </div>
              <Badge variant="outline" className={STATUS_STYLES[notification.status]}>
                {statusLabels[notification.status] || capitalize(notification.status)}
              </Badge>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {workflow.description}
            </p>
          </div>
        )}
      </div>
    </EnterpriseModal>
  );
}

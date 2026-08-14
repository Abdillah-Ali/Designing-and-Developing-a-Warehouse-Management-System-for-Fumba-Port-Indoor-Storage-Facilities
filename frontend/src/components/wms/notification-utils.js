import {
  getPortalConfig,
  getStoredAuthRole
} from "@/lib/portal-access";

const typeLabels = {
  pending_approval: "Pending Approval",
  correction_request: "Correction Request",
  approval_decision: "Approval Decision",
  placement_override: "Placement Override",
  dispatch_request: "Dispatch Request",
  dispatch_update: "Dispatch Update",
  customs_inspection: "Customs Inspection",
  invoice_pending: "Invoice Pending",
  finance_charge_started: "Finance Charge Started",
  finance_payment_update: "Payment Update",
  gate_release_update: "Gate Release Update",
  warehouse_alert: "Warehouse Alert",
  system_announcement: "Announcement"
};

const statusLabels = {
  pending: "Pending",
  completed: "Completed",
  dismissed: "Dismissed"
};

function getPortalBase() {
  return getPortalConfig(getStoredAuthRole())?.basePath || "";
}

function getRecordIdentifier(notification) {
  return notification?.related_cargo_identifier
    || notification?.related_record_reference
    || notification?.cargo_reference
    || notification?.dispatch_reference
    || notification?.invoice_reference
    || "";
}

function appendCargoRef(route, cargoRef) {
  if (!cargoRef) return route;
  const separator = route.includes("?") ? "&" : "?";
  return `${route}${separator}cargoRef=${encodeURIComponent(cargoRef)}`;
}

function isAllowedDestination(route, role) {
  if (!route || typeof route !== "string") return false;
  if (!route.startsWith("/")) return false;
  if (/^\/\//.test(route) || /https?:/i.test(route)) return false;
  const basePath = getPortalConfig(role)?.basePath;
  return Boolean(basePath && (route === basePath || route.startsWith(`${basePath}/`)));
}

function actionFromDestination(notification, role, label) {
  const destination = notification?.safe_destination || notification?.safeDestination;
  if (!isAllowedDestination(destination, role)) return null;
  return {
    actionLabel: label,
    targetRoute: destination,
    recordIdentifier: getRecordIdentifier(notification),
    actionRequired: true
  };
}

function getNotificationAction(notification, role = getStoredAuthRole()) {
  const recordIdentifier = getRecordIdentifier(notification);
  const action = {
    actionLabel: "",
    targetRoute: "",
    recordIdentifier,
    actionRequired: false
  };

  if (!notification || notification.status !== "pending" || notification.actionable !== true) {
    return action;
  }

  return actionFromDestination(notification, role, "Open Workflow") || action;
}

function getRelatedPath(notification) {
  const role=getStoredAuthRole();
  const destination=notification?.safe_destination||notification?.safeDestination;
  return isAllowedDestination(destination,role)?destination:"";
}

function shortDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export { typeLabels, statusLabels, getNotificationAction, getRelatedPath, shortDate };

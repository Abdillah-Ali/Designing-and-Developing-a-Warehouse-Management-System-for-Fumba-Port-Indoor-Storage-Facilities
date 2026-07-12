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

function getNotificationAction(notification, role = getStoredAuthRole()) {
  const type = notification?.notification_type;
  const recordIdentifier = getRecordIdentifier(notification);
  const action = {
    actionLabel: "",
    targetRoute: "",
    recordIdentifier,
    actionRequired: false
  };

  if (!notification || notification.status !== "pending") {
    return action;
  }

  if (role === "warehouse-supervisor") {
    if (type === "pending_approval") {
      return {
        actionLabel: "Review Cargo",
        targetRoute: appendCargoRef("/supervisor/cargo/pending-approvals", recordIdentifier),
        recordIdentifier,
        actionRequired: true
      };
    }

    if (type === "placement_override") {
      return {
        actionLabel: "Open Placement",
        targetRoute: appendCargoRef("/supervisor/cargo/exceptions", recordIdentifier),
        recordIdentifier,
        actionRequired: true
      };
    }

    if (type === "dispatch_request") {
      return {
        actionLabel: "Review Dispatch",
        targetRoute: appendCargoRef("/supervisor/dispatch/requests", recordIdentifier),
        recordIdentifier,
        actionRequired: true
      };
    }

    if (type === "customs_inspection") {
      return {
        actionLabel: "Open Customs Review",
        targetRoute: appendCargoRef("/supervisor/cargo/pending-approvals", recordIdentifier),
        recordIdentifier,
        actionRequired: true
      };
    }

    if (type === "invoice_pending") {
      return {
        actionLabel: "Confirm Invoice",
        targetRoute: appendCargoRef("/supervisor/cargo/pending-approvals", recordIdentifier),
        recordIdentifier,
        actionRequired: true
      };
    }
  }

  if (role === "warehouse-staff" && type === "correction_request") {
    return {
      actionLabel: "Review Corrections",
      targetRoute: appendCargoRef("/staff/cargo/registration?tab=reviews", recordIdentifier),
      recordIdentifier,
      actionRequired: true
    };
  }

  return action;
}

function getRelatedPath(notification) {
  const basePath = getPortalBase();
  if (!basePath) return "";
  const type = notification?.notification_type;
  const module = String(notification?.related_module || "").toLowerCase();

  if (basePath === "/staff") {
    if (type === "correction_request") return "/staff/cargo/registration?tab=reviews";
    if (type === "dispatch_request" || module.includes("dispatch")) return "/staff/dispatch/queue";
    if (type === "warehouse_alert" || module.includes("warehouse")) return "/staff/storage/bins";

    if (notification?.related_entity_type === "cargo") {
      const cargoIdentifier = notification.related_cargo_identifier || "";
      return cargoIdentifier
        ? `/staff/cargo/tracking?cargo=${encodeURIComponent(cargoIdentifier)}`
        : "/staff/cargo/tracking";
    }
  }

  if (basePath === "/supervisor") {
    if (type === "pending_approval") return "/supervisor/cargo/pending-approvals";
    if (type === "placement_override") return "/supervisor/cargo/exceptions";
    if (type === "dispatch_request" || module.includes("dispatch")) return "/supervisor/dispatch/requests";
    if (type === "warehouse_alert" || module.includes("warehouse")) return "/supervisor/warehouse/bins";
    if (notification?.related_entity_type === "cargo") return "/supervisor/cargo/records";
  }

  if (basePath === "/admin") {
    if (type === "dispatch_request" || module.includes("dispatch")) return "/admin/dispatch/queue";
    if (type === "warehouse_alert" || module.includes("warehouse")) return "/admin/warehouse/bins";
    if (type === "pending_approval" || type === "placement_override") return "/admin/cargo/approval-overrides";
    if (notification?.related_entity_type === "cargo") return "/admin/cargo/records";
  }

  return "";
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

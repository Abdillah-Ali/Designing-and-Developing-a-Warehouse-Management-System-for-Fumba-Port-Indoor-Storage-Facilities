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
  warehouse_alert: "Warehouse Alert",
  system_announcement: "Announcement"
};

function getPortalBase() {
  return getPortalConfig(getStoredAuthRole())?.basePath || "";
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

export { typeLabels, getRelatedPath, shortDate };

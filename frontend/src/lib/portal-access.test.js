import { describe, expect, it } from "vitest";
import {
  PORTAL_CONFIG,
  PORTAL_ROLES,
  clearStoredAuthToken,
  clearStoredPortalRole,
  extractRoleFromToken,
  getPortalRoleForPath,
  getDisplayRoleName,
  getStoredAuthRole,
  getStoredAuthUserId,
  hasPortalEntryPermission,
  getStoredPortalRole,
  isStoredBootstrapAdmin,
  isStoredBootstrapCompleted,
  isStoredBootstrapSetupPending,
  mustChangeStoredPassword,
  setStoredAuthToken,
  isPathAllowedForRole,
  setStoredPortalRole
} from "./portal-access";

function createMemoryStorage() {
  const values = new Map();

  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function createUnsignedBrowserToken(payload) {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `e30.${encoded}.signature`;
}

describe("portal access", () => {
  it("keeps all supported roles in separate portal roots", () => {
    expect(PORTAL_CONFIG[PORTAL_ROLES.SYSTEM_ADMIN].allowedPaths.every((path) => path.startsWith("/admin"))).toBe(true);
    expect(PORTAL_CONFIG[PORTAL_ROLES.WAREHOUSE_STAFF].allowedPaths.every((path) => path.startsWith("/staff"))).toBe(true);
    expect(PORTAL_CONFIG[PORTAL_ROLES.WAREHOUSE_SUPERVISOR].allowedPaths.every((path) => path.startsWith("/supervisor"))).toBe(true);
    expect(PORTAL_CONFIG[PORTAL_ROLES.FINANCE_OFFICER].allowedPaths.every((path) => path.startsWith("/finance"))).toBe(true);
    expect(PORTAL_CONFIG[PORTAL_ROLES.CUSTOMS_OFFICER].allowedPaths.every((path) => path.startsWith("/customs"))).toBe(true);
    expect(PORTAL_CONFIG[PORTAL_ROLES.GATE_OFFICER].allowedPaths.every((path) => path.startsWith("/gate"))).toBe(true);
  });

  it("blocks cross-portal page rendering for staff-only and admin-only modules", () => {
    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_STAFF, "/staff/cargo/registration")).toBe(true);
    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_STAFF, "/staff/cargo/registration-reviews")).toBe(true);
    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_STAFF, "/staff/cargo/placement-queue")).toBe(true);
    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_STAFF, "/admin/cargo/registration")).toBe(false);
    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_STAFF, "/admin/system/users")).toBe(false);

    expect(isPathAllowedForRole(PORTAL_ROLES.SYSTEM_ADMIN, "/admin/system/users")).toBe(true);
    expect(isPathAllowedForRole(PORTAL_ROLES.SYSTEM_ADMIN, "/staff/cargo/registration")).toBe(false);
    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "/supervisor/cargo/pending-approvals")).toBe(true);
    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "/admin/system/users")).toBe(false);
    expect(isPathAllowedForRole(PORTAL_ROLES.FINANCE_OFFICER, "/finance/cargo-charges")).toBe(true);
    expect(isPathAllowedForRole(PORTAL_ROLES.FINANCE_OFFICER, "/admin/system/users")).toBe(false);
    expect(isPathAllowedForRole(PORTAL_ROLES.CUSTOMS_OFFICER, "/customs/inspection-queue")).toBe(true);
    expect(isPathAllowedForRole(PORTAL_ROLES.CUSTOMS_OFFICER, "/finance/tariffs")).toBe(false);
    expect(isPathAllowedForRole(PORTAL_ROLES.GATE_OFFICER, "/gate/release-queue")).toBe(true);
    expect(isPathAllowedForRole(PORTAL_ROLES.GATE_OFFICER, "/customs/records")).toBe(false);
  });

  it("keeps every raw log page restricted to the System Administrator portal", () => {
    expect(isPathAllowedForRole(PORTAL_ROLES.SYSTEM_ADMIN, "/admin/audit/logs")).toBe(true);
    expect(isPathAllowedForRole(PORTAL_ROLES.SYSTEM_ADMIN, "/admin/monitoring/system-logs")).toBe(true);
    expect(isPathAllowedForRole(PORTAL_ROLES.SYSTEM_ADMIN, "/admin/cargo/approval-overrides")).toBe(true);
    expect(isPathAllowedForRole(PORTAL_ROLES.SYSTEM_ADMIN, "/admin/monitoring/placement-logs")).toBe(true);
    expect(isPathAllowedForRole(PORTAL_ROLES.SYSTEM_ADMIN, "/admin/monitoring/validation-logs")).toBe(true);

    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_STAFF, "/staff/activity-logs")).toBe(false);
    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "/supervisor/activity-logs")).toBe(false);
    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "/supervisor/staff/work-logs")).toBe(false);
    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "/supervisor/staff/placement-logs")).toBe(false);
  });

  it("allows every visible Management and Auditor portal route while rejecting cross-portal URLs", () => {
    ["/management", "/management/dashboard", "/management/cargo", "/management/release-requests", "/management/tariff-approvals", "/management/reports", "/management/notifications", "/management/profile"].forEach((path) => {
      expect(isPathAllowedForRole(PORTAL_ROLES.MANAGEMENT, path)).toBe(true);
    });
    ["/auditor", "/auditor/dashboard", "/auditor/logs", "/auditor/reports", "/auditor/cargo", "/auditor/system-changes", "/auditor/notifications", "/auditor/profile"].forEach((path) => {
      expect(isPathAllowedForRole(PORTAL_ROLES.AUDITOR, path)).toBe(true);
    });
    expect(isPathAllowedForRole(PORTAL_ROLES.AUDITOR, "/management/release-requests")).toBe(false);
    expect(isPathAllowedForRole(PORTAL_ROLES.MANAGEMENT, "/auditor/logs")).toBe(false);
  });

  it("resolves portal ownership from the URL root", () => {
    expect(getPortalRoleForPath("/admin/audit/logs")).toBe(PORTAL_ROLES.SYSTEM_ADMIN);
    expect(getPortalRoleForPath("/staff/storage/bins")).toBe(PORTAL_ROLES.WAREHOUSE_STAFF);
    expect(getPortalRoleForPath("/supervisor/dispatch/requests")).toBe(PORTAL_ROLES.WAREHOUSE_SUPERVISOR);
    expect(getPortalRoleForPath("/finance/payments")).toBe(PORTAL_ROLES.FINANCE_OFFICER);
    expect(getPortalRoleForPath("/customs/records")).toBe(PORTAL_ROLES.CUSTOMS_OFFICER);
    expect(getPortalRoleForPath("/gate/gate-out-records")).toBe(PORTAL_ROLES.GATE_OFFICER);
    expect(getPortalRoleForPath("/")).toBe(null);
  });

  it("stores only known active portal roles", () => {
    const storage = createMemoryStorage();

    setStoredPortalRole(PORTAL_ROLES.WAREHOUSE_STAFF, storage);
    expect(getStoredPortalRole(storage)).toBe(PORTAL_ROLES.WAREHOUSE_STAFF);

    setStoredPortalRole("unknown-role", storage);
    expect(getStoredPortalRole(storage)).toBe(PORTAL_ROLES.WAREHOUSE_STAFF);

    clearStoredPortalRole(storage);
    expect(getStoredPortalRole(storage)).toBe(null);
  });

  it("maps signed-in account roles from stored tokens", () => {
    const storage = createMemoryStorage();
    const token = createUnsignedBrowserToken({
      role: "System Admin",
      exp: Math.floor(Date.now() / 1000) + 60
    });

    expect(extractRoleFromToken(token)).toBe(PORTAL_ROLES.SYSTEM_ADMIN);

    setStoredAuthToken(token, storage);
    expect(getStoredAuthRole(storage)).toBe(PORTAL_ROLES.SYSTEM_ADMIN);
    expect(getStoredPortalRole(storage)).toBe(PORTAL_ROLES.SYSTEM_ADMIN);

    clearStoredAuthToken(storage);
    expect(getStoredAuthRole(storage)).toBe(null);
  });

  it("maps the existing Supervisor database role to the supervisor portal", () => {
    const token = createUnsignedBrowserToken({
      role: "Supervisor",
      exp: Math.floor(Date.now() / 1000) + 60
    });

    expect(extractRoleFromToken(token)).toBe(PORTAL_ROLES.WAREHOUSE_SUPERVISOR);
  });

  it("uses immutable role keys and current permissions for portal UX", () => {
    const storage = createMemoryStorage();
    const token = createUnsignedBrowserToken({ role: "Renamed Operations Label", role_key: "warehouse_staff", exp: Math.floor(Date.now() / 1000) + 60 });
    setStoredAuthToken(token, storage);
    expect(getStoredAuthRole(storage)).toBe(PORTAL_ROLES.WAREHOUSE_STAFF);
    expect(hasPortalEntryPermission(PORTAL_ROLES.WAREHOUSE_STAFF, storage)).toBe(false);
    storage.setItem("fumba-wms-auth-permissions", JSON.stringify(["cargo.register"]));
    expect(hasPortalEntryPermission(PORTAL_ROLES.WAREHOUSE_STAFF, storage)).toBe(true);
  });

  it("maps finance, customs, and gate database roles to dedicated portals", () => {
    for (const [roleName, portalRole] of [
      ["Finance Officer", PORTAL_ROLES.FINANCE_OFFICER],
      ["Customs Officer", PORTAL_ROLES.CUSTOMS_OFFICER],
      ["Gate Officer", PORTAL_ROLES.GATE_OFFICER]
    ]) {
      const token = createUnsignedBrowserToken({
        role: roleName,
        exp: Math.floor(Date.now() / 1000) + 60
      });

      expect(extractRoleFromToken(token)).toBe(portalRole);
    }
  });

  it("formats authenticated account roles for header display", () => {
    expect(getDisplayRoleName("System Admin")).toBe("System Admin");
    expect(getDisplayRoleName("Warehouse Staff")).toBe("Warehouse Staff");
    expect(getDisplayRoleName("Supervisor")).toBe("Warehouse Supervisor");
    expect(getDisplayRoleName("Finance Officer")).toBe("Finance Officer");
    expect(getDisplayRoleName("Customs Officer")).toBe("Customs Officer");
    expect(getDisplayRoleName("Gate Officer")).toBe("Gate Officer");
  });

  it("reads forced password-change and user identity claims from stored tokens", () => {
    const storage = createMemoryStorage();
    const token = createUnsignedBrowserToken({
      user_id: 42,
      role: "Warehouse Staff",
      must_change_password: true,
      exp: Math.floor(Date.now() / 1000) + 60
    });

    setStoredAuthToken(token, storage);

    expect(getStoredAuthUserId(storage)).toBe(42);
    expect(mustChangeStoredPassword(storage)).toBe(true);
  });

  it("distinguishes pending bootstrap setup from completed bootstrap access", () => {
    const storage = createMemoryStorage();
    const pendingToken = createUnsignedBrowserToken({
      role: "System Admin",
      is_bootstrap_admin: true,
      bootstrap_completed: false,
      exp: Math.floor(Date.now() / 1000) + 60
    });

    setStoredAuthToken(pendingToken, storage);
    expect(isStoredBootstrapAdmin(storage)).toBe(true);
    expect(isStoredBootstrapCompleted(storage)).toBe(false);
    expect(isStoredBootstrapSetupPending(storage)).toBe(true);

    const completedToken = createUnsignedBrowserToken({
      role: "System Admin",
      is_bootstrap_admin: true,
      bootstrap_completed: true,
      exp: Math.floor(Date.now() / 1000) + 60
    });

    setStoredAuthToken(completedToken, storage);
    expect(isStoredBootstrapCompleted(storage)).toBe(true);
    expect(isStoredBootstrapSetupPending(storage)).toBe(false);
  });
});

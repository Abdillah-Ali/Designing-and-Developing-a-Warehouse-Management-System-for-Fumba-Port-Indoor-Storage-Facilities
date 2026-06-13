import { describe, expect, it } from "vitest";
import {
  PORTAL_CONFIG,
  PORTAL_ROLES,
  clearStoredAuthToken,
  clearStoredPortalRole,
  extractRoleFromToken,
  getPortalRoleForPath,
  getStoredAuthRole,
  getStoredAuthUserId,
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
  });

  it("blocks cross-portal page rendering for staff-only and admin-only modules", () => {
    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_STAFF, "/staff/cargo/registration")).toBe(true);
    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_STAFF, "/staff/cargo/registration-reviews")).toBe(true);
    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_STAFF, "/admin/cargo/registration")).toBe(false);
    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_STAFF, "/admin/system/users")).toBe(false);

    expect(isPathAllowedForRole(PORTAL_ROLES.SYSTEM_ADMIN, "/admin/system/users")).toBe(true);
    expect(isPathAllowedForRole(PORTAL_ROLES.SYSTEM_ADMIN, "/staff/cargo/registration")).toBe(false);
    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "/supervisor/cargo/pending-approvals")).toBe(true);
    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "/admin/system/users")).toBe(false);
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

  it("resolves portal ownership from the URL root", () => {
    expect(getPortalRoleForPath("/admin/audit/logs")).toBe(PORTAL_ROLES.SYSTEM_ADMIN);
    expect(getPortalRoleForPath("/staff/storage/bins")).toBe(PORTAL_ROLES.WAREHOUSE_STAFF);
    expect(getPortalRoleForPath("/supervisor/dispatch/requests")).toBe(PORTAL_ROLES.WAREHOUSE_SUPERVISOR);
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

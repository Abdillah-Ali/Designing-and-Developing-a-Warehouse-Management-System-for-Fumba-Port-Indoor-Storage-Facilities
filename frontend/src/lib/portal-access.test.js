import { describe, expect, it } from "vitest";
import {
  PORTAL_CONFIG,
  PORTAL_ROLES,
  clearStoredAuthToken,
  clearStoredPortalRole,
  extractRoleFromToken,
  getPortalRoleForPath,
  getStoredAuthRole,
  getStoredPortalRole,
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
  it("keeps system administrator and warehouse staff paths in separate portal roots", () => {
    expect(PORTAL_CONFIG[PORTAL_ROLES.SYSTEM_ADMIN].allowedPaths.every((path) => path.startsWith("/admin"))).toBe(true);
    expect(PORTAL_CONFIG[PORTAL_ROLES.WAREHOUSE_STAFF].allowedPaths.every((path) => path.startsWith("/staff"))).toBe(true);
  });

  it("blocks cross-portal page rendering for staff-only and admin-only modules", () => {
    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_STAFF, "/staff/cargo/registration")).toBe(true);
    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_STAFF, "/admin/cargo/registration")).toBe(false);
    expect(isPathAllowedForRole(PORTAL_ROLES.WAREHOUSE_STAFF, "/admin/system/users")).toBe(false);

    expect(isPathAllowedForRole(PORTAL_ROLES.SYSTEM_ADMIN, "/admin/system/users")).toBe(true);
    expect(isPathAllowedForRole(PORTAL_ROLES.SYSTEM_ADMIN, "/staff/cargo/registration")).toBe(false);
  });

  it("resolves portal ownership from the URL root", () => {
    expect(getPortalRoleForPath("/admin/audit/logs")).toBe(PORTAL_ROLES.SYSTEM_ADMIN);
    expect(getPortalRoleForPath("/staff/storage/bins")).toBe(PORTAL_ROLES.WAREHOUSE_STAFF);
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
});

const PORTAL_SESSION_KEY = "fumba-wms-active-portal-role";
const AUTH_TOKEN_KEY = "fumba-wms-auth-token";

export const PORTAL_ROLES = Object.freeze({
  SYSTEM_ADMIN: "system-admin",
  WAREHOUSE_STAFF: "warehouse-staff"
});

export const PORTAL_CONFIG = Object.freeze({
  [PORTAL_ROLES.SYSTEM_ADMIN]: {
    label: "System Administrator",
    roleName: "System Admin",
    basePath: "/admin",
    defaultPath: "/admin",
    allowedPaths: Object.freeze([
      "/admin",
      "/admin/dashboard",
      "/admin/system/users",
      "/admin/system/roles-permissions",
      "/admin/system/shift-assignment",
      "/admin/system/warehouse-assignment",
      "/admin/warehouse/zones",
      "/admin/warehouse/racks",
      "/admin/warehouse/levels",
      "/admin/warehouse/bins",
      "/admin/warehouse/bin-rules",
      "/admin/warehouse/capacity-configuration",
      "/admin/cargo/records",
      "/admin/cargo/placement-monitoring",
      "/admin/cargo/tracking",
      "/admin/cargo/blocked",
      "/admin/dispatch/queue",
      "/admin/dispatch/released",
      "/admin/dispatch/gate-activity",
      "/admin/monitoring/validation-logs",
      "/admin/audit/logs",
      "/admin/audit/user-activity",
      "/admin/audit/login-sessions",
      "/admin/audit/security-events",
      "/admin/profile"
    ]),
    modules: Object.freeze([
      "dashboard",
      "system-management",
      "warehouse-configuration",
      "cargo-oversight",
      "dispatch-oversight",
      "operational-review",
      "audit-security",
      "profile"
    ])
  },
  [PORTAL_ROLES.WAREHOUSE_STAFF]: {
    label: "Warehouse Staff",
    roleName: "Warehouse Staff",
    basePath: "/staff",
    defaultPath: "/staff",
    allowedPaths: Object.freeze([
      "/staff",
      "/staff/dashboard",
      "/staff/cargo/registration",
      "/staff/cargo/placement-scanning",
      "/staff/cargo/tracking",
      "/staff/storage/zones",
      "/staff/storage/racks",
      "/staff/storage/levels",
      "/staff/storage/bins",
      "/staff/storage/occupancy",
      "/staff/dispatch/queue",
      "/staff/dispatch/gate-release",
      "/staff/dispatch/released",
      "/staff/activity-logs",
      "/staff/profile"
    ]),
    modules: Object.freeze([
      "dashboard",
      "cargo-registration",
      "placement-scanning",
      "cargo-tracking",
      "storage-readonly",
      "dispatch-preparation",
      "activity-logs",
      "profile"
    ])
  }
});

const roleAliases = Object.freeze({
  "system-admin": PORTAL_ROLES.SYSTEM_ADMIN,
  "system admin": PORTAL_ROLES.SYSTEM_ADMIN,
  "system administrator": PORTAL_ROLES.SYSTEM_ADMIN,
  "administrator": PORTAL_ROLES.SYSTEM_ADMIN,
  "warehouse-staff": PORTAL_ROLES.WAREHOUSE_STAFF,
  "warehouse staff": PORTAL_ROLES.WAREHOUSE_STAFF
});

function canUseSessionStorage() {
  return typeof window !== "undefined" && Boolean(window.sessionStorage);
}

function normalizeRole(role) {
  if (!role) return null;
  return roleAliases[String(role).trim().toLowerCase()] || null;
}

function normalizePath(pathname) {
  if (!pathname) return "/";
  const withoutTrailingSlash = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return withoutTrailingSlash || "/";
}

function decodeTokenPayload(token) {
  if (!token) return null;

  try {
    const parts = String(token).split(".");
    const encodedPayload = parts.length === 3 ? parts[1] : parts[0];
    const normalized = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const decoded = JSON.parse(atob(padded));

    if (decoded.exp && decoded.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

export function getPortalConfig(role) {
  return PORTAL_CONFIG[role] || null;
}

export function isKnownPortalRole(role) {
  return Boolean(getPortalConfig(role));
}

export function getPortalRoleForPath(pathname) {
  const path = normalizePath(pathname);

  return Object.entries(PORTAL_CONFIG).find(([, config]) => (
    path === config.basePath || path.startsWith(`${config.basePath}/`)
  ))?.[0] || null;
}

export function getPortalDefaultPath(role) {
  return getPortalConfig(role)?.defaultPath || "/";
}

export function getStoredPortalRole(storage = canUseSessionStorage() ? window.sessionStorage : null) {
  if (!storage) return null;

  try {
    const role = storage.getItem(PORTAL_SESSION_KEY);
    return isKnownPortalRole(role) ? role : null;
  } catch {
    return null;
  }
}

export function setStoredPortalRole(role, storage = canUseSessionStorage() ? window.sessionStorage : null) {
  if (!storage || !isKnownPortalRole(role)) return;

  try {
    storage.setItem(PORTAL_SESSION_KEY, role);
  } catch {
  }
}

export function clearStoredPortalRole(storage = canUseSessionStorage() ? window.sessionStorage : null) {
  if (!storage) return;

  try {
    storage.removeItem(PORTAL_SESSION_KEY);
  } catch {
  }
}

export function isPathAllowedForRole(role, pathname) {
  const config = getPortalConfig(role);
  if (!config) return false;

  return config.allowedPaths.includes(normalizePath(pathname));
}

// Auth token management
export function getStoredAuthToken(storage = canUseSessionStorage() ? window.sessionStorage : null) {
  if (!storage) return null;

  try {
    return storage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredAuthToken(token, storage = canUseSessionStorage() ? window.sessionStorage : null) {
  if (!storage || !token) return;

  try {
    storage.setItem(AUTH_TOKEN_KEY, token);
    const role = extractRoleFromToken(token);
    if (role) {
      storage.setItem(PORTAL_SESSION_KEY, role);
    }
  } catch {
  }
}

export function clearStoredAuthToken(storage = canUseSessionStorage() ? window.sessionStorage : null) {
  if (!storage) return;

  try {
    storage.removeItem(AUTH_TOKEN_KEY);
    // Also clear the old portal role key for backward compatibility
    storage.removeItem(PORTAL_SESSION_KEY);
  } catch {
  }
}

export function extractRoleFromToken(token) {
  return normalizeRole(decodeTokenPayload(token)?.role);
}

export function getStoredAuthRole(storage = canUseSessionStorage() ? window.sessionStorage : null) {
  return extractRoleFromToken(getStoredAuthToken(storage));
}

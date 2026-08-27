const PORTAL_SESSION_KEY = "fumba-wms-active-portal-role";
const AUTH_TOKEN_KEY = "fumba-wms-auth-token";
const AUTH_PERMISSIONS_KEY = "fumba-wms-auth-permissions";
const AUTH_SESSION_SELECTOR_KEY = "fumba-wms-session-selector";

export const PORTAL_ROLES = Object.freeze({
  SYSTEM_ADMIN: "system-admin",
  WAREHOUSE_STAFF: "warehouse-staff",
  WAREHOUSE_SUPERVISOR: "warehouse-supervisor",
  FINANCE_OFFICER: "finance-officer",
  CUSTOMS_OFFICER: "customs-officer",
  GATE_OFFICER: "gate-officer",
  MANAGEMENT: "management",
  AUDITOR: "auditor",
  SCANNER: "scanner"
});

export const PORTAL_CONFIG = Object.freeze({
  [PORTAL_ROLES.SYSTEM_ADMIN]: {
    label: "System Administrator",
    roleName: "System Admin",
    displayRoleName: "System Admin",
    basePath: "/admin",
    defaultPath: "/admin",
    allowedPaths: Object.freeze([
      "/admin",
      "/admin/dashboard",
      "/admin/system/users",
      "/admin/system/roles-permissions",
      "/admin/system/shift-assignment",
      "/admin/system/warehouse-assignment",
      "/admin/system/cargo-registration-form",
      "/admin/system/configuration",
      "/admin/warehouse/warehouses",
      "/admin/warehouse/zones",
      "/admin/warehouse/racks",
      "/admin/warehouse/levels",
      "/admin/warehouse/bins",
      "/admin/warehouse/bin-rules",
      "/admin/warehouse/capacity-configuration",
      "/admin/cargo/records",
      "/admin/cargo/approval-overrides",
      "/admin/cargo/placement-monitoring",
      "/admin/cargo/tracking",
      "/admin/cargo/blocked",
      "/admin/dispatch/queue",
      "/admin/dispatch/released",
      "/admin/dispatch/gate-activity",
      "/admin/monitoring/system-logs",
      "/admin/monitoring/placement-logs",
      "/admin/monitoring/validation-logs",
      "/admin/audit/logs",
      "/admin/audit/user-activity",
      "/admin/audit/login-sessions",
      "/admin/audit/security-events",
      "/admin/reports",
      "/admin/notifications",
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
    displayRoleName: "Warehouse Staff",
    basePath: "/staff",
    defaultPath: "/staff",
    allowedPaths: Object.freeze([
      "/staff",
      "/staff/dashboard",
      "/staff/cargo/registration",
      "/staff/cargo/registration-reviews",
      "/staff/cargo/placement-queue",
      "/staff/cargo/placement-history",
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
      "/staff/reports",
      "/staff/notifications",
      "/staff/profile"
    ]),
    modules: Object.freeze([
      "dashboard",
      "cargo-registration",
      "placement-scanning",
      "cargo-tracking",
      "storage-readonly",
      "dispatch-preparation",
      "profile"
    ])
  },
  [PORTAL_ROLES.WAREHOUSE_SUPERVISOR]: {
    label: "Warehouse Supervisor",
    roleName: "Supervisor",
    displayRoleName: "Warehouse Supervisor",
    basePath: "/supervisor",
    defaultPath: "/supervisor",
    allowedPaths: Object.freeze([
      "/supervisor",
      "/supervisor/dashboard",
      "/supervisor/cargo/pending-approvals",
      "/supervisor/cargo/review-history",
      "/supervisor/cargo/records",
      "/supervisor/cargo/placement-monitoring",
      "/supervisor/cargo/exceptions",
      "/supervisor/warehouse/occupancy",
      "/supervisor/warehouse/zones",
      "/supervisor/warehouse/racks",
      "/supervisor/warehouse/levels",
      "/supervisor/warehouse/bins",
      "/supervisor/dispatch/requests",
      "/supervisor/dispatch/approved",
      "/supervisor/dispatch/emergency-releases",
      "/supervisor/reports",
      "/supervisor/notifications",
      "/supervisor/profile"
    ]),
    modules: Object.freeze([
      "dashboard",
      "cargo-supervision",
      "warehouse-monitoring",
      "dispatch-authorization",
      "profile"
    ])
  },
  [PORTAL_ROLES.FINANCE_OFFICER]: {
    label: "Finance Officer",
    roleName: "Finance Officer",
    displayRoleName: "Finance Officer",
    basePath: "/finance",
    defaultPath: "/finance",
    allowedPaths: Object.freeze([
      "/finance",
      "/finance/dashboard",
      "/finance/cargo-charges",
      "/finance/invoices",
      "/finance/payments",
      "/finance/tariffs",
      "/finance/reports",
      "/finance/notifications",
      "/finance/profile"
    ]),
    modules: Object.freeze([
      "dashboard",
      "cargo-charges",
      "invoices",
      "payments",
      "tariff-configuration",
      "financial-reports",
      "profile"
    ])
  },
  [PORTAL_ROLES.CUSTOMS_OFFICER]: {
    label: "Customs Officer",
    roleName: "Customs Officer",
    displayRoleName: "Customs Officer",
    basePath: "/customs",
    defaultPath: "/customs",
    allowedPaths: Object.freeze([
      "/customs",
      "/customs/dashboard",
      "/customs/inspection-queue",
      "/customs/records",
      "/customs/cleared",
      "/customs/holds",
      "/customs/reports",
      "/customs/notifications",
      "/customs/profile"
    ]),
    modules: Object.freeze([
      "dashboard",
      "inspection-queue",
      "customs-records",
      "cleared-cargo",
      "cargo-on-hold",
      "profile"
    ])
  },
  [PORTAL_ROLES.GATE_OFFICER]: {
    label: "Gate Officer",
    roleName: "Gate Officer",
    displayRoleName: "Gate Officer",
    basePath: "/gate",
    defaultPath: "/gate",
    allowedPaths: Object.freeze([
      "/gate",
      "/gate/dashboard",
      "/gate/release-queue",
      "/gate/gate-out-records",
      "/gate/emergency-releases",
      "/gate/reports",
      "/gate/notifications",
      "/gate/profile"
    ]),
    modules: Object.freeze([
      "dashboard",
      "release-queue",
      "gate-out-records",
      "emergency-releases",
      "profile"
    ])
  },
  [PORTAL_ROLES.SCANNER]: {
    label: "Scanner",
    roleName: "Scanner",
    displayRoleName: "Scanner",
    basePath: "/scanner",
    defaultPath: "/scanner",
    allowedPaths: Object.freeze([
      "/scanner"
    ]),
    modules: Object.freeze([
      "barcode-scanner"
    ])
  },
  [PORTAL_ROLES.MANAGEMENT]: {
    label: "Management",
    roleName: "Management",
    displayRoleName: "Management",
    basePath: "/management",
    defaultPath: "/management",
    allowedPaths: Object.freeze([
      "/management",
      "/management/dashboard",
      "/management/reports",
      "/management/cargo",
      "/management/release-requests",
      "/management/tariff-approvals",
      "/management/notifications",
      "/management/profile"
    ]),
    modules: Object.freeze(["dashboard", "cargo-oversight", "management-release", "tariff-approval", "executive-reports", "notifications", "profile"])
  },
  [PORTAL_ROLES.AUDITOR]: {
    label: "Auditor", roleName: "Auditor", displayRoleName: "Auditor", basePath: "/auditor", defaultPath: "/auditor",
    allowedPaths: Object.freeze([
      "/auditor", "/auditor/dashboard", "/auditor/logs", "/auditor/reports",
      "/auditor/cargo", "/auditor/system-changes", "/auditor/notifications", "/auditor/profile"
    ]),
    modules: Object.freeze(["audit", "cargo-traceability", "system-changes", "executive-reports", "notifications", "profile"])
  }
});

const roleAliases = Object.freeze({
  "system_administrator": PORTAL_ROLES.SYSTEM_ADMIN,
  "warehouse_staff": PORTAL_ROLES.WAREHOUSE_STAFF,
  "warehouse_supervisor": PORTAL_ROLES.WAREHOUSE_SUPERVISOR,
  "finance_officer": PORTAL_ROLES.FINANCE_OFFICER,
  "customs_officer": PORTAL_ROLES.CUSTOMS_OFFICER,
  "gate_officer": PORTAL_ROLES.GATE_OFFICER,
  "system-admin": PORTAL_ROLES.SYSTEM_ADMIN,
  "system admin": PORTAL_ROLES.SYSTEM_ADMIN,
  "system administrator": PORTAL_ROLES.SYSTEM_ADMIN,
  "administrator": PORTAL_ROLES.SYSTEM_ADMIN,
  "warehouse-staff": PORTAL_ROLES.WAREHOUSE_STAFF,
  "warehouse staff": PORTAL_ROLES.WAREHOUSE_STAFF,
  "warehouse-supervisor": PORTAL_ROLES.WAREHOUSE_SUPERVISOR,
  "warehouse supervisor": PORTAL_ROLES.WAREHOUSE_SUPERVISOR,
  "supervisor": PORTAL_ROLES.WAREHOUSE_SUPERVISOR,
  "finance-officer": PORTAL_ROLES.FINANCE_OFFICER,
  "finance officer": PORTAL_ROLES.FINANCE_OFFICER,
  "billing officer": PORTAL_ROLES.FINANCE_OFFICER,
  "customs-officer": PORTAL_ROLES.CUSTOMS_OFFICER,
  "customs officer": PORTAL_ROLES.CUSTOMS_OFFICER,
  "gate-officer": PORTAL_ROLES.GATE_OFFICER,
  "gate officer": PORTAL_ROLES.GATE_OFFICER,
  "management": PORTAL_ROLES.MANAGEMENT,
  "auditor": PORTAL_ROLES.AUDITOR,
  "scanner": PORTAL_ROLES.SCANNER
});

function canUseSessionStorage() {
  return typeof window !== "undefined" && Boolean(window.sessionStorage);
}

function getPreferredStorage() {
  if (canUseSessionStorage()) return window.sessionStorage;
  return null;
}

let inMemoryAccessToken = null;
const authStateListeners = new Set();

const notifyAuthState = (event) => {
  authStateListeners.forEach((listener) => listener(event));
};

export function subscribeToAuthState(listener) {
  authStateListeners.add(listener);
  return () => authStateListeners.delete(listener);
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

export function decodeTokenPayload(token) {
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

export function getStoredPortalRole(storage = getPreferredStorage()) {
  if (!storage) return null;
  try {
    const role = storage.getItem(PORTAL_SESSION_KEY);
    return isKnownPortalRole(role) ? role : null;
  } catch {
    return null;
  }
}

export function setStoredPortalRole(role, storage = getPreferredStorage()) {
  if (!isKnownPortalRole(role)) return;

  if (!storage) return;
  try {
    storage.setItem(PORTAL_SESSION_KEY, role);
  } catch {}
}

export function clearStoredPortalRole(storage = getPreferredStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(PORTAL_SESSION_KEY);
  } catch {}
}

export function isPathAllowedForRole(role, pathname) {
  const config = getPortalConfig(role);
  if (!config) return false;

  return config.allowedPaths.includes(normalizePath(pathname));
}

// Auth token management
export function getStoredAuthToken(storage) {
  if (storage) {
    try {
      const token = storage.getItem(AUTH_TOKEN_KEY);
      if (token) return token;
    } catch {}
  }
  if (canUseSessionStorage()) {
    try {
      const token = window.sessionStorage.getItem(AUTH_TOKEN_KEY);
      if (token) return token;
    } catch {}
  }
  return inMemoryAccessToken;
}

export function setStoredAuthToken(token, storage) {
  if (!token) return;

  inMemoryAccessToken = token;
  const role = extractRoleFromToken(token);
  const targetStorage = storage || getPreferredStorage();

  if (targetStorage) {
    try {
      targetStorage.setItem(AUTH_TOKEN_KEY, token);
      if (role) {
        targetStorage.setItem(PORTAL_SESSION_KEY, role);
      }
    } catch {}
  }
  notifyAuthState("updated");
}

export function clearStoredAuthToken(storage) {
  inMemoryAccessToken = null;
  const targetStorage = storage || getPreferredStorage();

  if (targetStorage) {
    try {
      targetStorage.removeItem(AUTH_TOKEN_KEY);
      targetStorage.removeItem(AUTH_PERMISSIONS_KEY);
      targetStorage.removeItem(AUTH_SESSION_SELECTOR_KEY);
      targetStorage.removeItem(PORTAL_SESSION_KEY);
    } catch {}
  }
  notifyAuthState("cleared");
}

export function setStoredPermissions(permissions, storage = getPreferredStorage()) {
  if (!Array.isArray(permissions)) return;

  if (storage) {
    try {
      storage.setItem(AUTH_PERMISSIONS_KEY, JSON.stringify(permissions));
    } catch {}
  }
  notifyAuthState("permissions-updated");
}

export function getStoredPermissions(storage = getPreferredStorage()) {
  if (storage) {
    try {
      const parsed = JSON.parse(storage.getItem(AUTH_PERMISSIONS_KEY) || "[]");
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {}
  }
  return [];
}

export function hasStoredPermission(permissionKey, storage = getPreferredStorage()) {
  const permissions = getStoredPermissions(storage);
  return permissions.includes("*") || permissions.includes(permissionKey);
}

export function setStoredSessionSelector(selector, storage = getPreferredStorage()) {
  if (!/^SES-[A-F0-9]{24}$/.test(String(selector || "").toUpperCase()) || !storage) return;
  try {
    storage.setItem(AUTH_SESSION_SELECTOR_KEY, String(selector).toUpperCase());
  } catch {}
}

export function getStoredSessionSelector(storage = getPreferredStorage()) {
  if (!storage) return null;
  try {
    const selector = storage.getItem(AUTH_SESSION_SELECTOR_KEY);
    return /^SES-[A-F0-9]{24}$/.test(String(selector || "").toUpperCase()) ? String(selector).toUpperCase() : null;
  } catch {
    return null;
  }
}

export function extractRoleFromToken(token) {
  const claims = decodeTokenPayload(token);
  return normalizeRole(claims?.roleKey || claims?.role_key || claims?.role);
}

const portalEntryPermissions = Object.freeze({
  [PORTAL_ROLES.SYSTEM_ADMIN]: "system.dashboard.view",
  [PORTAL_ROLES.WAREHOUSE_STAFF]: "cargo.register",
  [PORTAL_ROLES.WAREHOUSE_SUPERVISOR]: "supervisor.dashboard.view",
  [PORTAL_ROLES.FINANCE_OFFICER]: "finance.dashboard.view",
  [PORTAL_ROLES.CUSTOMS_OFFICER]: "customs.dashboard.view",
  [PORTAL_ROLES.GATE_OFFICER]: "gate.dashboard.view",
  [PORTAL_ROLES.MANAGEMENT]: "management.dashboard.view"
  ,[PORTAL_ROLES.AUDITOR]: "system.audit.view"
});

export function hasPortalEntryPermission(role, storage = getPreferredStorage()) {
  if (role === PORTAL_ROLES.SCANNER) return true;
  const required = portalEntryPermissions[role];
  return Boolean(required && hasStoredPermission(required, storage));
}

export function getDisplayRoleName(role) {
  const normalizedRole = normalizeRole(role);
  const configuredRole = getPortalConfig(normalizedRole);

  if (configuredRole?.displayRoleName) {
    return configuredRole.displayRoleName;
  }

  return role ? String(role).trim() : "";
}

export function getStoredAuthRole(storage) {
  return extractRoleFromToken(getStoredAuthToken(storage));
}

export function getStoredAuthClaims(storage) {
  return decodeTokenPayload(getStoredAuthToken(storage));
}

export function getStoredAuthUserId(storage) {
  const claims = getStoredAuthClaims(storage);
  const userId = Number(claims?.userId || claims?.user_id || claims?.sub);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

export function mustChangeStoredPassword(storage) {
  const claims = getStoredAuthClaims(storage);
  return Boolean(claims?.mustChangePassword ?? claims?.must_change_password);
}

export function isStoredBootstrapAdmin(storage) {
  const claims = getStoredAuthClaims(storage);
  return Boolean(claims?.isBootstrapAdmin ?? claims?.is_bootstrap_admin);
}

export function isStoredBootstrapCompleted(storage) {
  const claims = getStoredAuthClaims(storage);
  return Boolean(claims?.bootstrapCompleted ?? claims?.bootstrap_completed);
}

export function isStoredBootstrapSetupPending(storage) {
  return isStoredBootstrapAdmin(storage) && !isStoredBootstrapCompleted(storage);
}

export function getStoredAuthWarehouseId(storage) {
  const claims = getStoredAuthClaims(storage);
  return Number(claims?.warehouseId || claims?.warehouse_id) || null;
}

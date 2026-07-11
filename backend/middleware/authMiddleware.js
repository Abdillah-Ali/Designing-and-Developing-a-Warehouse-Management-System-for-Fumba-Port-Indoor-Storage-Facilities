const db = require("../config/db");
const { roleNames } = require("../config/systemConfig");
const { verifyToken } = require("../utils/token");

const PORTAL_ROLES = Object.freeze({
  SYSTEM_ADMIN: "system-admin",
  WAREHOUSE_STAFF: "warehouse-staff",
  WAREHOUSE_SUPERVISOR: "warehouse-supervisor",
  SCANNER: "scanner"
});

const roleAliases = Object.freeze({
  "system-admin": PORTAL_ROLES.SYSTEM_ADMIN,
  "system admin": PORTAL_ROLES.SYSTEM_ADMIN,
  "system administrator": PORTAL_ROLES.SYSTEM_ADMIN,
  "administrator": PORTAL_ROLES.SYSTEM_ADMIN,
  "warehouse-staff": PORTAL_ROLES.WAREHOUSE_STAFF,
  "warehouse staff": PORTAL_ROLES.WAREHOUSE_STAFF,
  "warehouse-supervisor": PORTAL_ROLES.WAREHOUSE_SUPERVISOR,
  "warehouse supervisor": PORTAL_ROLES.WAREHOUSE_SUPERVISOR,
  "supervisor": PORTAL_ROLES.WAREHOUSE_SUPERVISOR,
  "scanner": PORTAL_ROLES.SCANNER,
  [roleNames.systemAdmin.toLowerCase()]: PORTAL_ROLES.SYSTEM_ADMIN,
  [roleNames.warehouseStaff.toLowerCase()]: PORTAL_ROLES.WAREHOUSE_STAFF,
  [roleNames.warehouseSupervisor.toLowerCase()]: PORTAL_ROLES.WAREHOUSE_SUPERVISOR,
  [roleNames.scanner.toLowerCase()]: PORTAL_ROLES.SCANNER
});

const portalPermissions = Object.freeze({
  [PORTAL_ROLES.SYSTEM_ADMIN]: Object.freeze([
    { methods: ["GET", "DELETE"], pattern: /^\/cargo(?:\/[^/]+)?$/ },
    { methods: ["GET"], pattern: /^\/cargo\/[^/]+\/placement-activity$/ },
    { methods: ["GET"], pattern: /^\/cargo\/my\/placement-history$/ },
    { methods: ["GET"], pattern: /^\/cargo\/my\/documents$/ },
    { methods: ["GET"], pattern: /^\/cargo\/my\/barcode-prints$/ },
    { methods: ["GET"], pattern: /^\/cargo\/[^/]+\/documents\/[^/]+\/content$/ },
    { methods: ["GET", "POST"], pattern: /^\/zones$/ },
    { methods: ["GET", "PUT", "DELETE"], pattern: /^\/zones\/[^/]+$/ },
    { methods: ["PATCH"], pattern: /^\/zones\/[^/]+\/status$/ },
    { methods: ["GET", "POST"], pattern: /^\/racks$/ },
    { methods: ["GET"], pattern: /^\/racks\/by-zone\/[^/]+$/ },
    { methods: ["GET", "PUT", "DELETE"], pattern: /^\/racks\/[^/]+$/ },
    { methods: ["PATCH"], pattern: /^\/racks\/[^/]+\/status$/ },
    { methods: ["GET", "POST"], pattern: /^\/levels$/ },
    { methods: ["GET"], pattern: /^\/levels\/by-rack\/[^/]+$/ },
    { methods: ["GET", "PUT", "DELETE"], pattern: /^\/levels\/[^/]+$/ },
    { methods: ["PATCH"], pattern: /^\/levels\/[^/]+\/status$/ },
    { methods: ["GET", "POST"], pattern: /^\/bins$/ },
    { methods: ["GET"], pattern: /^\/bins\/by-level\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/bins\/recommend\/[^/]+$/ },
    { methods: ["GET", "PUT", "DELETE"], pattern: /^\/bins\/[^/]+$/ },
    { methods: ["PATCH"], pattern: /^\/bins\/[^/]+\/status$/ },
    { methods: ["POST"], pattern: /^\/bins\/[^/]+\/print-barcode$/ },
    { methods: ["GET"], pattern: /^\/bin-rules$/ },
    { methods: ["PUT"], pattern: /^\/bin-rules\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/capacity-configurations$/ },
    { methods: ["PUT"], pattern: /^\/capacity-configurations\/[^/]+\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/placement\/logs$/ },
    { methods: ["GET"], pattern: /^\/placement\/failures$/ },
    { methods: ["GET"], pattern: /^\/placement\/activity$/ },
    { methods: ["GET"], pattern: /^\/placement\/activity\/summary$/ },
    { methods: ["GET", "PUT"], pattern: /^\/placement\/settings$/ },
    { methods: ["GET"], pattern: /^\/supervisor\/dashboard$/ },
    { methods: ["GET"], pattern: /^\/supervisor\/my\/review-history$/ },
    { methods: ["GET"], pattern: /^\/supervisor\/review-configuration$/ },
    { methods: ["GET"], pattern: /^\/supervisor\/approvals(?:\/[^/]+)?$/ },
    { methods: ["POST"], pattern: /^\/supervisor\/approvals\/[^/]+\/(?:approve|emergency-approve|reject|request-correction)$/ },
    { methods: ["GET"], pattern: /^\/supervisor\/staff-activity$/ },
    { methods: ["GET"], pattern: /^\/supervisor\/placement-monitoring$/ },
    { methods: ["GET"], pattern: /^\/supervisor\/placement-summary$/ },
    { methods: ["GET"], pattern: /^\/dispatch\/authorization-requests$/ },
    { methods: ["POST"], pattern: /^\/dispatch\/authorization-requests\/[^/]+\/complete$/ },
    { methods: ["GET", "POST"], pattern: /^\/users$/ },
    { methods: ["POST"], pattern: /^\/users\/scanners$/ },
    { methods: ["GET", "PUT", "DELETE"], pattern: /^\/users\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/users\/[^/]+\/pending-tasks$/ },
    { methods: ["POST"], pattern: /^\/users\/[^/]+\/reassign-tasks$/ },
    { methods: ["PATCH"], pattern: /^\/users\/[^/]+\/status$/ },
    { methods: ["PATCH"], pattern: /^\/users\/[^/]+\/reset-password$/ },
    { methods: ["PATCH"], pattern: /^\/users\/[^/]+\/deactivate$/ },
    { methods: ["GET"], pattern: /^\/roles$/ },
    { methods: ["GET", "POST"], pattern: /^\/warehouses$/ },
    { methods: ["PUT", "PATCH", "DELETE"], pattern: /^\/warehouses\/[^/]+$/ },
    { methods: ["PATCH"], pattern: /^\/warehouses\/[^/]+\/status$/ },
    { methods: ["GET"], pattern: /^\/shifts$/ },
    { methods: ["GET"], pattern: /^\/audit-logs$/ },
    { methods: ["GET"], pattern: /^\/user-sessions$/ },
    { methods: ["GET", "PATCH", "DELETE"], pattern: /^\/notifications(?:\/.*)?$/ },
    { methods: ["POST"], pattern: /^\/notifications\/system-announcement$/ }
  ]),
  [PORTAL_ROLES.WAREHOUSE_STAFF]: Object.freeze([
    { methods: ["GET", "POST"], pattern: /^\/cargo$/ },
    { methods: ["GET"], pattern: /^\/cargo\/my\/submissions$/ },
    { methods: ["GET"], pattern: /^\/cargo\/my\/placement-history$/ },
    { methods: ["GET"], pattern: /^\/cargo\/my\/documents$/ },
    { methods: ["GET"], pattern: /^\/cargo\/my\/barcode-prints$/ },
    { methods: ["GET", "PUT"], pattern: /^\/cargo\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/cargo\/[^/]+\/placement-activity$/ },
    { methods: ["GET", "POST"], pattern: /^\/cargo\/[^/]+\/documents$/ },
    { methods: ["GET"], pattern: /^\/cargo\/[^/]+\/documents\/[^/]+\/content$/ },
    { methods: ["POST"], pattern: /^\/cargo\/[^/]+\/print-barcode$/ },
    { methods: ["POST"], pattern: /^\/cargo\/[^/]+\/resubmit$/ },
    { methods: ["GET"], pattern: /^\/zones$/ },
    { methods: ["GET"], pattern: /^\/zones\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/racks\/by-zone\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/racks\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/levels\/by-rack\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/levels\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/bins\/by-level\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/bins\/recommend\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/bins\/[^/]+$/ },
    { methods: ["POST"], pattern: /^\/bins\/[^/]+\/print-barcode$/ },
    { methods: ["GET"], pattern: /^\/placement\/settings$/ },
    { methods: ["GET"], pattern: /^\/placement\/activity$/ },
    { methods: ["GET"], pattern: /^\/placement\/activity\/summary$/ },
    { methods: ["POST"], pattern: /^\/placement\/validate$/ },
    { methods: ["POST"], pattern: /^\/placement\/confirm$/ },
    { methods: ["POST"], pattern: /^\/placement\/request-override$/ },
    { methods: ["POST"], pattern: /^\/dispatch\/request-authorization$/ },
    { methods: ["GET"], pattern: /^\/dispatch\/authorization-requests$/ },
    { methods: ["POST"], pattern: /^\/dispatch\/authorization-requests\/[^/]+\/complete$/ },
    { methods: ["GET", "PATCH", "DELETE"], pattern: /^\/notifications(?:\/.*)?$/ }
  ]),
  [PORTAL_ROLES.WAREHOUSE_SUPERVISOR]: Object.freeze([
    { methods: ["GET"], pattern: /^\/cargo(?:\/[^/]+)?$/ },
    { methods: ["GET"], pattern: /^\/cargo\/[^/]+\/placement-activity$/ },
    { methods: ["GET"], pattern: /^\/cargo\/[^/]+\/documents$/ },
    { methods: ["GET"], pattern: /^\/cargo\/[^/]+\/documents\/[^/]+\/content$/ },
    { methods: ["GET"], pattern: /^\/zones(?:\/[^/]+)?$/ },
    { methods: ["GET"], pattern: /^\/racks(?:\/[^/]+)?$/ },
    { methods: ["GET"], pattern: /^\/racks\/by-zone\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/levels(?:\/[^/]+)?$/ },
    { methods: ["GET"], pattern: /^\/levels\/by-rack\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/bins(?:\/[^/]+)?$/ },
    { methods: ["GET"], pattern: /^\/bins\/by-level\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/bins\/recommend\/[^/]+$/ },
    { methods: ["POST"], pattern: /^\/bins\/[^/]+\/print-barcode$/ },
    { methods: ["GET", "PUT"], pattern: /^\/placement\/settings$/ },
    { methods: ["GET"], pattern: /^\/placement\/activity$/ },
    { methods: ["GET"], pattern: /^\/placement\/activity\/summary$/ },
    { methods: ["GET"], pattern: /^\/supervisor\/dashboard$/ },
    { methods: ["GET"], pattern: /^\/supervisor\/my\/review-history$/ },
    { methods: ["GET"], pattern: /^\/supervisor\/review-configuration$/ },
    { methods: ["GET"], pattern: /^\/supervisor\/approvals(?:\/[^/]+)?$/ },
    { methods: ["POST"], pattern: /^\/supervisor\/approvals\/[^/]+\/approve$/ },
    { methods: ["POST"], pattern: /^\/supervisor\/approvals\/[^/]+\/emergency-approve$/ },
    { methods: ["POST"], pattern: /^\/supervisor\/approvals\/[^/]+\/reject$/ },
    { methods: ["POST"], pattern: /^\/supervisor\/approvals\/[^/]+\/request-correction$/ },
    { methods: ["GET"], pattern: /^\/supervisor\/placement-summary$/ },
    { methods: ["GET"], pattern: /^\/dispatch\/authorization-requests$/ },
    { methods: ["POST"], pattern: /^\/dispatch\/authorization-requests\/[^/]+\/approve$/ },
    { methods: ["POST"], pattern: /^\/dispatch\/authorization-requests\/[^/]+\/reject$/ },
    { methods: ["GET", "PATCH", "DELETE"], pattern: /^\/notifications(?:\/.*)?$/ },
  ])
});

const normalizeRole = (value) => {
  if (!value) return null;
  return roleAliases[String(value).trim().toLowerCase()] || null;
};

const canAccessRoute = (role, method, path) => {
  const permissions = portalPermissions[role] || [];
  return permissions.some((permission) => (
    permission.methods.includes(method) && permission.pattern.test(path)
  ));
};

const isWarehouseConfigurationMutation = (method, path) => (
  ["POST", "PUT", "PATCH", "DELETE"].includes(method)
  && /^\/(?:warehouses|zones|racks|levels|bins|bin-rules|capacity-configurations)(?:\/|$)/.test(path)
);

const extractTokenFromHeader = (authHeader) => {
  if (!authHeader) return null;
  
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return null;
  }
  
  return parts[1];
};

const readAuthContext = (req) => {
  const token = extractTokenFromHeader(req.get("authorization"));
  if (!token) return null;

  const decoded = verifyToken(token);
  if (!decoded) {
    return {
      error: "Your session is invalid or has expired. Please sign in again."
    };
  }

  const role = normalizeRole(decoded.role);
  const userId = Number(decoded.userId || decoded.user_id || decoded.sub);
  const sessionIdValue = decoded.sessionId || decoded.session_id;
  const sessionId = sessionIdValue ? Number(sessionIdValue) : null;
  const scannerAccountIdValue = decoded.scannerAccountId || decoded.scanner_account_id;
  const scannerAccountId = scannerAccountIdValue ? Number(scannerAccountIdValue) : null;

  if (
    !role
    || !Number.isInteger(userId)
    || userId <= 0
    || !Number.isInteger(sessionId)
    || sessionId <= 0
  ) {
    return {
      error: "Your session is missing required access details. Please sign in again."
    };
  }

  return {
    auth: {
      role,
      userId,
      sessionId,
      scannerAccountId,
      username: decoded.username || null,
      roleId: Number(decoded.roleId || decoded.role_id) || null,
      mustChangePassword: Boolean(decoded.mustChangePassword ?? decoded.must_change_password),
      isSystemUser: Boolean(decoded.isSystemUser ?? decoded.is_system_user),
      isBootstrapAdmin: Boolean(decoded.isBootstrapAdmin ?? decoded.is_bootstrap_admin),
      bootstrapCompleted: Boolean(decoded.bootstrapCompleted ?? decoded.bootstrap_completed),
      token
    }
  };
};

const getActiveAccountContext = async ({ sessionId, userId, role, scannerAccountId }) => {
  if (role === PORTAL_ROLES.SCANNER) {
    if (!Number.isInteger(scannerAccountId) || scannerAccountId <= 0) {
      return null;
    }

    const scannerResult = await db.query(
      `SELECT
         u.status,
         scanner_role.id AS role_id,
         u.warehouse_id,
         u.shift_id,
         FALSE AS must_change_password,
         FALSE AS is_system_user,
         FALSE AS is_bootstrap_admin,
         FALSE AS bootstrap_completed,
         u.id AS scanner_staff_id,
         scanner_account.id AS scanner_account_id,
         scanner_role.role_name
       FROM user_sessions us
       JOIN users u ON u.id = us.user_id
       JOIN scanner_accounts scanner_account
         ON scanner_account.id = us.scanner_account_id
        AND scanner_account.user_id = u.id
       JOIN roles scanner_role ON scanner_role.role_name = $4
       WHERE us.id = $1
         AND us.user_id = $2
         AND scanner_account.id = $3
         AND us.identity_type = 'scanner'
         AND us.session_status = 'active'
         AND scanner_account.status = 'active'
         AND u.status = 'active'
       LIMIT 1`,
      [sessionId, userId, scannerAccountId, roleNames.scanner]
    );

    return scannerResult.rows[0] || null;
  }

  const result = await db.query(
    `SELECT
       u.status,
       u.role_id,
       u.warehouse_id,
       u.shift_id,
      u.must_change_password,
      u.is_system_user,
      u.is_bootstrap_admin,
      u.bootstrap_completed,
      NULL::integer AS scanner_staff_id,
      NULL::integer AS scanner_account_id,
      r.role_name
    FROM user_sessions us
    JOIN users u ON u.id = us.user_id
    JOIN roles r ON r.id = u.role_id
    WHERE us.id = $1
      AND us.user_id = $2
      AND us.identity_type = 'user'
      AND us.session_status = 'active'
      AND u.status = 'active'
    LIMIT 1`,
    [sessionId, userId]
  );

  return result.rows[0] || null;
};

const optionalAuthContext = (req, res, next) => {
  const context = readAuthContext(req);
  req.auth = context?.auth || null;
  next();
};

const requireAuthenticated = async (req, res, next) => {
  try {
    const context = readAuthContext(req);

    const account = context?.auth ? await getActiveAccountContext(context.auth) : null;

    if (!context?.auth || !account) {
      res.status(401).json({
        success: false,
        message: context?.error || "A valid signed-in session is required for this API request."
      });
      return;
    }

    req.auth = {
      ...context.auth,
      role: normalizeRole(account.role_name),
      roleId: account.role_id,
      warehouseId: account.warehouse_id,
      shiftId: account.shift_id,
      scannerStaffId: account.scanner_staff_id,
      scannerAccountId: account.scanner_account_id,
      mustChangePassword: account.must_change_password,
      isSystemUser: account.is_system_user,
      isBootstrapAdmin: account.is_bootstrap_admin,
      bootstrapCompleted: account.bootstrap_completed
    };
    next();
  } catch (error) {
    next(error);
  }
};

const requirePortalAccess = async (req, res, next) => {
  if (req.method === "OPTIONS") {
    next();
    return;
  }

  try {
    const context = readAuthContext(req);

    const account = context?.auth ? await getActiveAccountContext(context.auth) : null;

    if (!context?.auth || !account) {
      res.status(401).json({
        success: false,
        message: context?.error || "A valid signed-in session is required for this API request."
      });
      return;
    }

    const role = normalizeRole(account.role_name);
    const path = req.path.replace(/\/+$/, "") || "/";

    if (account.is_bootstrap_admin) {
      res.status(403).json({
        success: false,
        message: account.bootstrap_completed
          ? "Bootstrap setup is complete. Sign in with the real System Administrator account."
          : "Bootstrap administrator access is restricted to the initial setup screen."
      });
      return;
    }

    if (account.must_change_password) {
      res.status(403).json({
        success: false,
        message: "You must change your password before accessing the portal."
      });
      return;
    }

    if (!canAccessRoute(role, req.method, path)) {
      if (isWarehouseConfigurationMutation(req.method, path)) {
        await db.query(
          `INSERT INTO audit_logs
             (user_id, role_id_at_action, warehouse_id_at_action, action, module, description, metadata)
           VALUES ($1,$2,$3,'UNAUTHORIZED_WAREHOUSE_CONFIGURATION_ATTEMPT',
                   'Warehouse Configuration',$4,$5)`,
          [
            context.auth.userId,
            account.role_id || null,
            account.warehouse_id || null,
            `${req.method} ${path} was denied for role ${role || "unknown"}.`,
            JSON.stringify({ method: req.method, path, role })
          ]
        );
      }
      res.status(403).json({
        success: false,
        message: "This portal role is not allowed to access that module."
      });
      return;
    }

    req.auth = {
      ...context.auth,
      role,
      roleId: account.role_id,
      warehouseId: account.warehouse_id,
      shiftId: account.shift_id,
      scannerStaffId: account.scanner_staff_id,
      scannerAccountId: account.scanner_account_id,
      mustChangePassword: account.must_change_password,
      isSystemUser: account.is_system_user,
      isBootstrapAdmin: account.is_bootstrap_admin,
      bootstrapCompleted: account.bootstrap_completed
    };

    next();
  } catch (error) {
    next(error);
  }
};

const requireRole = (...roles) => {
  const allowedRoles = roles.map(normalizeRole).filter(Boolean);

  return (req, res, next) => {
    if (!req.auth) {
      res.status(401).json({
        success: false,
        message: "A valid signed-in session is required for this API request."
      });
      return;
    }

    if (!allowedRoles.includes(req.auth.role)) {
      res.status(403).json({
        success: false,
        message: "This action is restricted to an authorized portal role."
      });
      return;
    }

    next();
  };
};

const requireNonScanner = (req, res, next) => {
  if (req.auth?.role === PORTAL_ROLES.SCANNER) {
    res.status(403).json({
      success: false,
      message: "Scanner accounts can only access assigned scanning functions."
    });
    return;
  }

  next();
};

module.exports = {
  PORTAL_ROLES,
  canAccessRoute,
  normalizeRole,
  optionalAuthContext,
  requireAuthenticated,
  requireNonScanner,
  requirePortalAccess,
  requireRole
};

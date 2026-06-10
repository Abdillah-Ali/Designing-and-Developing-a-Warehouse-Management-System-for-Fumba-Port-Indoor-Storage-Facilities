const db = require("../config/db");
const { verifyToken } = require("../utils/token");

const PORTAL_ROLES = Object.freeze({
  SYSTEM_ADMIN: "system-admin",
  WAREHOUSE_STAFF: "warehouse-staff"
});

const roleAliases = Object.freeze({
  "system-admin": PORTAL_ROLES.SYSTEM_ADMIN,
  "system admin": PORTAL_ROLES.SYSTEM_ADMIN,
  "system administrator": PORTAL_ROLES.SYSTEM_ADMIN,
  "administrator": PORTAL_ROLES.SYSTEM_ADMIN,
  "warehouse-staff": PORTAL_ROLES.WAREHOUSE_STAFF,
  "warehouse staff": PORTAL_ROLES.WAREHOUSE_STAFF
});

const portalPermissions = Object.freeze({
  [PORTAL_ROLES.SYSTEM_ADMIN]: Object.freeze([
    { methods: ["GET"], pattern: /^\/cargo(?:\/[^/]+)?$/ },
    { methods: ["GET", "POST"], pattern: /^\/zones$/ },
    { methods: ["PUT", "DELETE"], pattern: /^\/zones\/[^/]+$/ },
    { methods: ["GET", "POST"], pattern: /^\/racks$/ },
    { methods: ["GET", "PUT", "DELETE"], pattern: /^\/racks\/[^/]+$/ },
    { methods: ["GET", "POST"], pattern: /^\/levels$/ },
    { methods: ["GET", "PUT", "DELETE"], pattern: /^\/levels\/[^/]+$/ },
    { methods: ["GET", "POST"], pattern: /^\/bins$/ },
    { methods: ["GET", "PUT", "DELETE"], pattern: /^\/bins\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/bin-rules$/ },
    { methods: ["PUT"], pattern: /^\/bin-rules\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/placement\/logs$/ },
    { methods: ["GET", "POST"], pattern: /^\/users$/ },
    { methods: ["GET", "PUT", "DELETE"], pattern: /^\/users\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/roles$/ },
    { methods: ["GET"], pattern: /^\/warehouses$/ },
    { methods: ["GET"], pattern: /^\/shifts$/ },
    { methods: ["GET"], pattern: /^\/audit-logs$/ },
    { methods: ["GET"], pattern: /^\/user-sessions$/ }
  ]),
  [PORTAL_ROLES.WAREHOUSE_STAFF]: Object.freeze([
    { methods: ["GET", "POST"], pattern: /^\/cargo$/ },
    { methods: ["GET", "PUT"], pattern: /^\/cargo\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/zones$/ },
    { methods: ["GET"], pattern: /^\/racks\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/levels\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/bins\/[^/]+$/ },
    { methods: ["GET"], pattern: /^\/placement\/logs$/ },
    { methods: ["POST"], pattern: /^\/placement\/validate$/ },
    { methods: ["POST"], pattern: /^\/placement\/confirm$/ }
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
  const userId = Number(decoded.userId || decoded.sub);
  const sessionId = decoded.sessionId ? Number(decoded.sessionId) : null;

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
      username: decoded.username || null,
      token
    }
  };
};

const isActiveSession = async ({ sessionId, userId }) => {
  const result = await db.query(
    `SELECT 1
    FROM user_sessions
    WHERE id = $1
      AND user_id = $2
      AND session_status = 'active'
    LIMIT 1`,
    [sessionId, userId]
  );

  return result.rowCount === 1;
};

const optionalAuthContext = (req, res, next) => {
  const context = readAuthContext(req);
  req.auth = context?.auth || null;
  next();
};

const requireAuthenticated = async (req, res, next) => {
  try {
    const context = readAuthContext(req);

    if (!context?.auth || !(await isActiveSession(context.auth))) {
      res.status(401).json({
        success: false,
        message: context?.error || "A valid signed-in session is required for this API request."
      });
      return;
    }

    req.auth = context.auth;
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

    if (!context?.auth || !(await isActiveSession(context.auth))) {
      res.status(401).json({
        success: false,
        message: context?.error || "A valid signed-in session is required for this API request."
      });
      return;
    }

    const { role } = context.auth;
    const path = req.path.replace(/\/+$/, "") || "/";

    if (!canAccessRoute(role, req.method, path)) {
      res.status(403).json({
        success: false,
        message: "This portal role is not allowed to access that module."
      });
      return;
    }

    req.auth = context.auth;

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  PORTAL_ROLES,
  optionalAuthContext,
  requireAuthenticated,
  requirePortalAccess
};

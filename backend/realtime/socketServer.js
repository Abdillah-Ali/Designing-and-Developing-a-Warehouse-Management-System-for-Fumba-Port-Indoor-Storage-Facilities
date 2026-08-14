const { Server } = require("socket.io");
const db = require("../config/db");
const { normalizeRole } = require("../middleware/authMiddleware");
const {
  abandonSessionByScanner,
  getActiveSessionForAuth,
  submitScan
} = require("../services/scannerSessionService");
const { verifyToken } = require("../utils/token");

let io = null;

const localDevOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:5175",
  "http://127.0.0.1:5175",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
];

const configuredOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([...configuredOrigins, ...localDevOrigins]));
const localFrontendPorts = new Set(["3000", "3001", "4173", "5173", "5174", "5175"]);

const isPrivateNetworkDevOrigin = (origin) => {
  if (process.env.NODE_ENV === "production") return false;

  try {
    const { hostname, port, protocol } = new URL(origin);
    const isPrivateHostname =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);

    return protocol === "http:" && localFrontendPorts.has(port) && isPrivateHostname;
  } catch {
    return false;
  }
};

const staffRoom = (staffUserId) => `staff:${staffUserId}`;
const scannerLinkRoom = (staffUserId) => `scanner-link:${staffUserId}`;
const scannerUserRoom = (scannerUserId) => `scanner:${scannerUserId}`;

const extractSocketToken = (socket) => {
  const token = socket.handshake.auth?.token;
  if (token) return token;

  const header = socket.handshake.headers?.authorization || "";
  const parts = String(header).split(" ");
  return parts.length === 2 && parts[0].toLowerCase() === "bearer"
    ? parts[1]
    : null;
};

const authenticateSocket = async (socket, next) => {
  try {
    const token = extractSocketToken(socket);
    const decoded = verifyToken(token);
    const userId = Number(decoded?.userId || decoded?.user_id || decoded?.sub);
    const sessionId = Number(decoded?.sessionId || decoded?.session_id);
    const tokenRole = normalizeRole(decoded?.role);
    const scannerAccountId = Number(decoded?.scannerAccountId || decoded?.scanner_account_id);

    if (!decoded || !Number.isInteger(userId) || userId <= 0 || !Number.isInteger(sessionId) || sessionId <= 0) {
      next(new Error("A valid signed-in session is required."));
      return;
    }

    const isScanner = tokenRole === "scanner";
    if (isScanner && (!Number.isInteger(scannerAccountId) || scannerAccountId <= 0)) {
      next(new Error("A valid scanner session is required."));
      return;
    }

    const result = isScanner
      ? await db.query(
        `SELECT
           u.id,
           u.username,
           scanner_role.id AS role_id,
           u.warehouse_id,
           u.shift_id,
           u.id AS scanner_staff_id,
           scanner_account.id AS scanner_account_id,
           u.status,
           FALSE AS must_change_password,
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
           AND us.expires_at > CURRENT_TIMESTAMP
           AND scanner_account.status = 'active'
           AND u.status = 'active'
           AND scanner_role.role_key = 'scanner'
         LIMIT 1`,
        [sessionId, userId, scannerAccountId, "Scanner"]
      )
      : await db.query(
        `SELECT
           u.id,
           u.username,
           u.role_id,
           u.warehouse_id,
           u.shift_id,
           NULL::integer AS scanner_staff_id,
           NULL::integer AS scanner_account_id,
           u.status,
           u.must_change_password,
           r.role_name
         FROM user_sessions us
         JOIN users u ON u.id = us.user_id
         JOIN roles r ON r.id = u.role_id
         WHERE us.id = $1
           AND us.user_id = $2
           AND us.identity_type = 'user'
           AND us.session_status = 'active'
           AND us.expires_at > CURRENT_TIMESTAMP
           AND u.status = 'active'
         LIMIT 1`,
        [sessionId, userId]
      );
    const account = result.rows[0];
    const role = normalizeRole(account?.role_name);

    if (!account || !role || account.must_change_password) {
      next(new Error("A valid scanner session is required."));
      return;
    }

    socket.data.auth = {
      userId: account.id,
      username: account.username,
      role,
      roleId: account.role_id,
      warehouseId: account.warehouse_id,
      shiftId: account.shift_id,
      scannerStaffId: account.scanner_staff_id,
      scannerAccountId: account.scanner_account_id,
      sessionId,
      token
    };

    next();
  } catch (error) {
    next(error);
  }
};

const revalidateSocketAuthority = async (auth) => {
  const result = await db.query(
    `SELECT us.id
     FROM user_sessions us
     JOIN users u ON u.id=us.user_id AND u.status='active'
     LEFT JOIN scanner_accounts sa ON sa.id=us.scanner_account_id AND sa.user_id=u.id
     WHERE us.id=$1 AND us.user_id=$2 AND us.session_status='active'
       AND us.expires_at > CURRENT_TIMESTAMP
       AND (($3::boolean=FALSE AND us.identity_type='user') OR
            ($3::boolean=TRUE AND us.identity_type='scanner' AND sa.id=$4 AND sa.status='active'))
     LIMIT 1`,
    [auth.sessionId, auth.userId, auth.role === "scanner", auth.scannerAccountId || null]
  );
  if (!result.rowCount) throw Object.assign(new Error("Scanner authentication session is no longer active."), { statusCode: 401, errorCode: "AUTH_SESSION_INVALID" });
};

const emitToSessionParties = (event, session, extra = {}) => {
  if (!io || !session) return;

  const payload = {
    session,
    ...extra
  };

  io.to(staffRoom(session.staff_user_id)).emit(event, payload);
  io.to(scannerLinkRoom(session.staff_user_id)).emit(event, payload);
};

const emitSessionStarted = (session) => {
  emitToSessionParties("scanner:session-started", session);
  emitToSessionParties("scanner:session-updated", session);
};

const emitSessionUpdated = (session, event = "scanner:session-updated", extra = {}) => {
  emitToSessionParties(event, session, extra);
  if (event !== "scanner:session-updated") {
    emitToSessionParties("scanner:session-updated", session, extra);
  }
};

const emitSessionCancelled = (session) => {
  emitToSessionParties("scanner:session-cancelled", session);
  emitToSessionParties("scanner:session-updated", session);
};

const serializeSocketError = (error) => ({
  success: false,
  message: error?.message || "Request could not be completed.",
  status: error?.statusCode || 500,
  code: error?.errorCode || error?.code || undefined,
  errors: error?.errors || undefined
});

const initSocketServer = (server) => {
  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || isPrivateNetworkDevOrigin(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error("Origin is not allowed by CORS."));
      },
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"]
    }
  });

  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    const auth = socket.data.auth;

    if (auth.role === "warehouse-staff") {
      socket.join(staffRoom(auth.userId));
    }

    if (auth.role === "scanner") {
      socket.join(scannerUserRoom(auth.userId));
      if (auth.scannerStaffId) {
        socket.join(scannerLinkRoom(auth.scannerStaffId));
      }
    }

    socket.on("scanner:request-active-session", async (_payload, callback) => {
      try {
        await revalidateSocketAuthority(auth);
        const session = await getActiveSessionForAuth(auth);
        callback?.({ success: true, data: session });
      } catch (error) {
        callback?.(serializeSocketError(error));
      }
    });

    socket.on("scanner:submit-scan", async (payload, callback) => {
      try {
        await revalidateSocketAuthority(auth);
        const result = await submitScan(payload || {}, auth);

        if (result.session) {
          const event = result.completed
            ? "scanner:session-completed"
            : result.ignoredDuplicate
              ? "scanner:scan-ignored"
              : result.accepted
                ? "scanner:scan-accepted"
                : "scanner:scan-error";
          emitSessionUpdated(result.session, event, {
            scan: {
              accepted: result.accepted,
              completed: result.completed,
              ignored_duplicate: Boolean(result.ignoredDuplicate),
              attempted_step_index: result.attempted_step_index,
              error: result.error || null,
              validation: result.validation || null,
              result: result.result || null
            }
          });
        }

        callback?.({ success: true, data: result });
      } catch (error) {
        callback?.(serializeSocketError(error));
      }
    });

    socket.on("scanner:cancel-scan", async (payload, callback) => {
      try {
        await revalidateSocketAuthority(auth);
        const result = await abandonSessionByScanner(payload?.sessionId || payload?.session_id, auth);

        if (result.session) {
          emitSessionUpdated(result.session, "scanner:scan-cancelled", {
            abandoned: result.abandoned
          });
        }

        callback?.({ success: true, data: result });
      } catch (error) {
        callback?.(serializeSocketError(error));
      }
    });
  });

  return io;
};

const getSocketServer = () => io;

module.exports = {
  emitSessionCancelled,
  emitSessionStarted,
  emitSessionUpdated,
  getSocketServer,
  initSocketServer
};

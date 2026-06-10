const db = require("../config/db");
const {
  closeUserSession,
  createUserSession,
  createUser: insertUser,
  deleteUser: removeUser,
  getUserById,
  listAuditLogs: fetchAuditLogs,
  listRoles: fetchRoles,
  listShifts: fetchShifts,
  listUserSessions: fetchUserSessions,
  listUsers: fetchUsers,
  listWarehouses: fetchWarehouses,
  updateLastLogin,
  updateUser: patchUser,
  writeAuditLog
} = require("../models/adminModel");
const { buildError } = require("../utils/apiError");
const { hashPassword, verifyPassword } = require("../utils/password");
const { createToken, verifyToken } = require("../utils/token");

const allowedUserStatuses = ["active", "inactive", "suspended"];
const allowedPortalRoleNames = ["System Admin", "Warehouse Staff"];

const cleanString = (value) => {
  if (value === undefined || value === null) return value;
  return String(value).trim();
};

const readId = (value, fieldName, required = false) => {
  if (value === undefined || value === null || value === "") {
    if (required) throw buildError(`${fieldName} is required.`, 400);
    return null;
  }

  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw buildError(`${fieldName} must be a valid record id.`, 400);
  }

  return id;
};

const normalizeUserPayload = (body, mode = "create") => {
  const payload = {};
  const fields = ["full_name", "username", "email", "phone_number", "password", "status"];

  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = cleanString(body[field]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "role_id")) {
    payload.role_id = readId(body.role_id, "Role", mode === "create");
    if (payload.role_id === null) {
      throw buildError("Role is required.", 400);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "warehouse_id")) {
    payload.warehouse_id = readId(body.warehouse_id, "Warehouse");
  }

  if (Object.prototype.hasOwnProperty.call(body, "shift_id")) {
    payload.shift_id = readId(body.shift_id, "Shift");
  }

  const requiredFields = ["full_name", "username", "email", "phone_number"];
  for (const field of requiredFields) {
    if (mode === "create" && !payload[field]) {
      throw buildError(`${field.replace("_", " ")} is required.`, 400);
    }
  }

  if (mode === "create" && !payload.role_id) {
    throw buildError("Role is required.", 400);
  }

  if (mode === "create" && !payload.password) {
    throw buildError("Password is required.", 400);
  }

  if (payload.password !== undefined && payload.password !== null && payload.password.length < 8) {
    throw buildError("Password must be at least 8 characters.", 400);
  }

  if (payload.status !== undefined) {
    payload.status = payload.status.toLowerCase();
    if (!allowedUserStatuses.includes(payload.status)) {
      throw buildError("User status must be active, inactive, or suspended.", 400);
    }
  }

  if (mode === "create" && !payload.status) {
    payload.status = "active";
  }

  return payload;
};

const mapDatabaseError = (error) => {
  if (error.code === "23505") {
    return buildError("A user with that username or email already exists.", 409);
  }

  if (error.code === "23503") {
    return buildError("Selected role, warehouse, or shift was not found.", 400);
  }

  if (error.code === "23502") {
    return buildError("Missing required user information.", 400);
  }

  return error;
};

const sendRows = (res, result) => {
  res.json({
    success: true,
    count: result.rowCount,
    data: result.rows
  });
};

const getClientIp = (req) => (
  req.ip
  || req.socket?.remoteAddress
  || null
);

const getUsers = async (req, res, next) => {
  try {
    const result = await fetchUsers({
      search: cleanString(req.query.search),
      role_id: req.query.role_id ? readId(req.query.role_id, "Role") : null,
      role_name: cleanString(req.query.role_name),
      warehouse_id: req.query.warehouse_id ? readId(req.query.warehouse_id, "Warehouse") : null,
      status: cleanString(req.query.status)
    });

    sendRows(res, result);
  } catch (error) {
    next(error);
  }
};

const getUser = async (req, res, next) => {
  try {
    const id = readId(req.params.id, "User", true);
    const result = await getUserById(id);

    if (result.rowCount === 0) {
      throw buildError("User account not found.", 404);
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

const createUser = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const payload = normalizeUserPayload(req.body, "create");
    await client.query("BEGIN");

    const passwordHash = await hashPassword(payload.password, client);
    const insertResult = await insertUser(payload, passwordHash, client);
    const userId = insertResult.rows[0].id;

    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action: "CREATE_USER",
        module: "User Management",
        description: `Created user account ${payload.username}.`
      },
      client
    );

    const userResult = await getUserById(userId, client);
    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      data: userResult.rows[0]
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(mapDatabaseError(error));
  } finally {
    client.release();
  }
};

const updateUser = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const id = readId(req.params.id, "User", true);
    const payload = normalizeUserPayload(req.body, "update");

    await client.query("BEGIN");

    const existingResult = await getUserById(id, client);
    if (existingResult.rowCount === 0) {
      throw buildError("User account not found.", 404);
    }

    const passwordHash = payload.password ? await hashPassword(payload.password, client) : null;
    delete payload.password;

    const updateResult = await patchUser(id, payload, passwordHash, client);
    if (!updateResult) {
      throw buildError("No editable user fields were provided.", 400);
    }

    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action: "UPDATE_USER",
        module: "User Management",
        description: `Updated user account ${existingResult.rows[0].username}.`
      },
      client
    );

    const userResult = await getUserById(id, client);
    await client.query("COMMIT");

    res.json({
      success: true,
      data: userResult.rows[0]
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(mapDatabaseError(error));
  } finally {
    client.release();
  }
};

const deleteUser = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const id = readId(req.params.id, "User", true);
    await client.query("BEGIN");

    const existingResult = await getUserById(id, client);
    if (existingResult.rowCount === 0) {
      throw buildError("User account not found.", 404);
    }

    const existing = existingResult.rows[0];
    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action: "DELETE_USER",
        module: "User Management",
        description: `Deleted user account ${existing.username}.`
      },
      client
    );

    const deleteResult = await removeUser(id, client);
    await client.query("COMMIT");

    res.json({
      success: true,
      data: deleteResult.rows[0]
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(mapDatabaseError(error));
  } finally {
    client.release();
  }
};

const getRoles = async (req, res, next) => {
  try {
    sendRows(res, await fetchRoles());
  } catch (error) {
    next(error);
  }
};

const getWarehouses = async (req, res, next) => {
  try {
    sendRows(res, await fetchWarehouses());
  } catch (error) {
    next(error);
  }
};

const getShifts = async (req, res, next) => {
  try {
    sendRows(res, await fetchShifts());
  } catch (error) {
    next(error);
  }
};

const getAuditLogs = async (req, res, next) => {
  try {
    sendRows(res, await fetchAuditLogs({
      action: cleanString(req.query.action),
      module: cleanString(req.query.module),
      search: cleanString(req.query.search),
      limit: req.query.limit
    }));
  } catch (error) {
    next(error);
  }
};

const getUserSessions = async (req, res, next) => {
  try {
    sendRows(res, await fetchUserSessions({
      status: cleanString(req.query.status),
      user_id: req.query.user_id ? readId(req.query.user_id, "User") : null
    }));
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  const client = await db.pool.connect();
  let transactionStarted = false;

  try {
    const username = cleanString(req.body?.username);
    const password = req.body?.password;

    if (!username || !password) {
      throw buildError("Username and password are required.", 400);
    }

    const result = await client.query(
      `SELECT
        u.id,
        u.full_name,
        u.username,
        u.email,
        u.password_hash,
        u.status,
        u.role_id,
        r.role_name,
        u.warehouse_id,
        w.warehouse_name,
        u.shift_id,
        s.shift_name
      FROM users u
      JOIN roles r ON r.id = u.role_id
      LEFT JOIN warehouses w ON w.id = u.warehouse_id
      LEFT JOIN shifts s ON s.id = u.shift_id
      WHERE u.username = $1`,
      [username]
    );

    if (result.rowCount === 0) {
      throw buildError("Invalid username or password.", 401);
    }

    const user = result.rows[0];

    if (user.status !== "active") {
      throw buildError("User account is not active.", 403);
    }

    const passwordMatch = await verifyPassword(password, user.password_hash, client);
    if (!passwordMatch) {
      throw buildError("Invalid username or password.", 401);
    }

    if (!allowedPortalRoleNames.includes(user.role_name)) {
      throw buildError("This account does not have portal access.", 403);
    }

    await client.query("BEGIN");
    transactionStarted = true;

    const sessionResult = await createUserSession(
      {
        user_id: user.id,
        ip_address: getClientIp(req)
      },
      client
    );
    const session = sessionResult.rows[0];

    await updateLastLogin(user.id, client);

    await writeAuditLog(
      {
        user_id: user.id,
        action: "USER_LOGIN",
        module: "Authentication",
        description: `User ${user.username} logged in successfully.`
      },
      client
    );

    await client.query("COMMIT");
    transactionStarted = false;

    const token = createToken({
      userId: user.id,
      username: user.username,
      role: user.role_name,
      sessionId: session.id
    }, process.env.JWT_EXPIRES_IN || "24h");

    res.json({
      success: true,
      message: "Login successful.",
      data: {
        token,
        user: {
          id: user.id,
          full_name: user.full_name,
          username: user.username,
          email: user.email,
          role_id: user.role_id,
          role_name: user.role_name,
          warehouse_id: user.warehouse_id,
          warehouse_name: user.warehouse_name,
          shift_id: user.shift_id,
          shift_name: user.shift_name
        },
        session: {
          id: session.id,
          login_time: session.login_time,
          session_status: session.session_status
        }
      }
    });
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }
    next(error);
  } finally {
    client.release();
  }
};

const logout = async (req, res, next) => {
  const client = await db.pool.connect();
  let transactionStarted = false;

  try {
    const userId = req.auth?.userId;
    const sessionId = req.auth?.sessionId;
    
    await client.query("BEGIN");
    transactionStarted = true;

    if (userId && sessionId) {
      await closeUserSession(
        {
          user_id: userId,
          session_id: sessionId
        },
        client
      );

      await writeAuditLog(
        {
          user_id: userId,
          action: "USER_LOGOUT",
          module: "Authentication",
          description: "User logged out."
        },
        client
      );
    }

    await client.query("COMMIT");
    transactionStarted = false;

    res.json({
      success: true,
      message: "Logout successful."
    });
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }
    next(error);
  } finally {
    client.release();
  }
};

const getProfile = async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw buildError("Unauthorized.", 401);
    }

    const userResult = await db.query(
      `SELECT
        u.id,
        u.full_name,
        u.username,
        u.email,
        u.phone_number,
        u.status,
        u.role_id,
        r.role_name,
        u.warehouse_id,
        w.warehouse_name,
        u.shift_id,
        s.shift_name,
        u.must_change_password,
        u.created_at
      FROM users u
      JOIN roles r ON r.id = u.role_id
      LEFT JOIN warehouses w ON w.id = u.warehouse_id
      LEFT JOIN shifts s ON s.id = u.shift_id
      WHERE u.id = $1`,
      [userId]
    );

    if (userResult.rowCount === 0) {
      throw buildError("User not found.", 404);
    }

    const sessionsResult = await db.query(
      `SELECT id, login_time, session_status, ip_address
       FROM user_sessions
       WHERE user_id = $1
       ORDER BY login_time DESC
       LIMIT 10`,
      [userId]
    );

    res.json({
      success: true,
      data: {
        user: userResult.rows[0],
        sessions: sessionsResult.rows
      }
    });
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw buildError("Unauthorized.", 401);
    }

    const email = cleanString(req.body.email);
    const phone_number = cleanString(req.body.phone_number);
    const full_name = cleanString(req.body.full_name);

    if (!email || !phone_number || !full_name) {
      throw buildError("Email, phone number, and full name are required.", 400);
    }

    await client.query("BEGIN");

    // Check if email already taken by someone else
    const emailCheck = await client.query(
      "SELECT id FROM users WHERE email = $1 AND id <> $2",
      [email, userId]
    );
    if (emailCheck.rowCount > 0) {
      throw buildError("Email is already in use by another account.", 409);
    }

    const result = await client.query(
      `UPDATE users
       SET email = $1, phone_number = $2, full_name = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id, full_name, username, email, phone_number`,
      [email, phone_number, full_name, userId]
    );

    if (result.rowCount === 0) {
      throw buildError("User not found.", 404);
    }

    await writeAuditLog(
      {
        user_id: userId,
        action: "UPDATE_PROFILE",
        module: "User Management",
        description: `Updated profile details for account.`
      },
      client
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Profile updated successfully.",
      data: result.rows[0]
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(mapDatabaseError(error));
  } finally {
    client.release();
  }
};

const changePassword = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw buildError("Unauthorized.", 401);
    }

    const currentPassword = req.body.currentPassword;
    const newPassword = req.body.newPassword;

    if (!currentPassword || !newPassword) {
      throw buildError("Current password and new password are required.", 400);
    }

    if (newPassword.length < 8) {
      throw buildError("New password must be at least 8 characters long.", 400);
    }

    await client.query("BEGIN");

    // Fetch user password_hash
    const userResult = await client.query(
      "SELECT password_hash, username FROM users WHERE id = $1",
      [userId]
    );

    if (userResult.rowCount === 0) {
      throw buildError("User not found.", 404);
    }

    const user = userResult.rows[0];

    const passwordMatch = await verifyPassword(currentPassword, user.password_hash, client);
    if (!passwordMatch) {
      throw buildError("Incorrect current password.", 400);
    }

    const newPasswordHash = await hashPassword(newPassword, client);

    await client.query(
      `UPDATE users
       SET password_hash = $1, must_change_password = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [newPasswordHash, userId]
    );

    await writeAuditLog(
      {
        user_id: userId,
        action: "CHANGE_PASSWORD",
        module: "User Management",
        description: `Password changed for user ${user.username}.`
      },
      client
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Password changed successfully."
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

// Refresh token endpoint
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      throw buildError("Refresh token is required.", 400);
    }
    const decoded = verifyToken(refreshToken);
    if (!decoded) {
      throw buildError("Invalid or expired refresh token.", 401);
    }
    // Issue new access token (short-lived)
    const newAccessToken = createToken({
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role,
      sessionId: decoded.sessionId
    }, process.env.JWT_EXPIRES_IN || "24h");
    res.json({
      success: true,
      token: newAccessToken,
      message: "Access token refreshed."
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createUser,
  deleteUser,
  getAuditLogs,
  getRoles,
  getShifts,
  getUser,
  getUserSessions,
  getUsers,
  getWarehouses,
  login,
  logout,
  updateUser,
  getProfile,
  updateProfile,
  changePassword,
  refreshToken
};

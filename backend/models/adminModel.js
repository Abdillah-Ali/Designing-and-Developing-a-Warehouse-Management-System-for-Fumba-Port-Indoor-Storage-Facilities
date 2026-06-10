const db = require("../config/db");

const userSelect = `
  SELECT
    u.id,
    u.full_name,
    u.username,
    u.email,
    u.phone_number,
    u.role_id,
    r.role_name,
    r.role_description,
    u.warehouse_id,
    w.warehouse_name,
    w.warehouse_code,
    u.shift_id,
    s.shift_name,
    s.start_time,
    s.end_time,
    u.status,
    u.last_login,
    u.created_at,
    u.updated_at
  FROM users u
  JOIN roles r ON r.id = u.role_id
  LEFT JOIN warehouses w ON w.id = u.warehouse_id
  LEFT JOIN shifts s ON s.id = u.shift_id
`;

const listUsers = async (filters = {}) => {
  const values = [];
  const clauses = [];

  if (filters.search) {
    values.push(`%${filters.search}%`);
    clauses.push(`(
      u.full_name ILIKE $${values.length}
      OR u.username ILIKE $${values.length}
      OR u.email ILIKE $${values.length}
      OR u.phone_number ILIKE $${values.length}
    )`);
  }

  if (filters.role_id) {
    values.push(filters.role_id);
    clauses.push(`u.role_id = $${values.length}`);
  }

  if (filters.role_name) {
    values.push(filters.role_name);
    clauses.push(`r.role_name = $${values.length}`);
  }

  if (filters.warehouse_id) {
    values.push(filters.warehouse_id);
    clauses.push(`u.warehouse_id = $${values.length}`);
  }

  if (filters.status) {
    values.push(filters.status);
    clauses.push(`u.status = $${values.length}`);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  return db.query(
    `${userSelect}
    ${whereClause}
    ORDER BY u.created_at DESC, u.id DESC`,
    values
  );
};

const getUserById = async (id, executor = db) => {
  return executor.query(
    `${userSelect}
    WHERE u.id = $1
    LIMIT 1`,
    [id]
  );
};

const createUser = async (payload, passwordHash, executor = db) => {
  return executor.query(
    `INSERT INTO users (
      full_name,
      username,
      email,
      phone_number,
      password_hash,
      role_id,
      warehouse_id,
      shift_id,
      status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id`,
    [
      payload.full_name,
      payload.username,
      payload.email,
      payload.phone_number,
      passwordHash,
      payload.role_id,
      payload.warehouse_id || null,
      payload.shift_id || null,
      payload.status || "active"
    ]
  );
};

const updateUser = async (id, payload, passwordHash, executor = db) => {
  const editableFields = [
    "full_name",
    "username",
    "email",
    "phone_number",
    "role_id",
    "warehouse_id",
    "shift_id",
    "status"
  ];
  const updates = [];
  const values = [];

  for (const field of editableFields) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      values.push(payload[field] === "" ? null : payload[field]);
      updates.push(`${field} = $${values.length}`);
    }
  }

  if (passwordHash) {
    values.push(passwordHash);
    updates.push(`password_hash = $${values.length}`);
  }

  if (updates.length === 0) return null;

  values.push(id);

  return executor.query(
    `UPDATE users
    SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP
    WHERE id = $${values.length}
    RETURNING id`,
    values
  );
};

const deleteUser = async (id, executor = db) => {
  return executor.query(
    "DELETE FROM users WHERE id = $1 RETURNING id, full_name, username",
    [id]
  );
};

const listRoles = async () => {
  return db.query(
    `SELECT
      r.id,
      r.role_name,
      r.role_description,
      r.created_at,
      COUNT(u.id)::int AS user_count
    FROM roles r
    LEFT JOIN users u ON u.role_id = r.id
    GROUP BY r.id
    ORDER BY r.role_name`
  );
};

const listWarehouses = async () => {
  return db.query(
    `SELECT
      w.id,
      w.warehouse_name,
      w.warehouse_code,
      w.status,
      w.created_at,
      COUNT(u.id)::int AS assigned_user_count
    FROM warehouses w
    LEFT JOIN users u ON u.warehouse_id = w.id
    GROUP BY w.id
    ORDER BY w.warehouse_code`
  );
};

const listShifts = async () => {
  return db.query(
    `SELECT
      s.id,
      s.shift_name,
      s.start_time,
      s.end_time,
      s.created_at,
      COUNT(u.id)::int AS assigned_user_count
    FROM shifts s
    LEFT JOIN users u ON u.shift_id = s.id
    GROUP BY s.id
    ORDER BY s.start_time, s.shift_name`
  );
};

const listAuditLogs = async (filters = {}) => {
  const values = [];
  const clauses = [];

  if (filters.module) {
    values.push(filters.module);
    clauses.push(`al.module = $${values.length}`);
  }

  if (filters.action) {
    values.push(filters.action);
    clauses.push(`al.action = $${values.length}`);
  }

  if (filters.search) {
    values.push(`%${filters.search}%`);
    clauses.push(`(
      al.action ILIKE $${values.length}
      OR al.module ILIKE $${values.length}
      OR al.description ILIKE $${values.length}
      OR u.full_name ILIKE $${values.length}
      OR u.username ILIKE $${values.length}
    )`);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);

  return db.query(
    `SELECT
      al.id,
      al.user_id,
      u.full_name,
      u.username,
      al.action,
      al.module,
      al.description,
      al.created_at
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.user_id
    ${whereClause}
    ORDER BY al.created_at DESC, al.id DESC
    LIMIT ${limit}`,
    values
  );
};

const listUserSessions = async (filters = {}) => {
  const values = [];
  const clauses = [];

  if (filters.status) {
    values.push(filters.status);
    clauses.push(`us.session_status = $${values.length}`);
  }

  if (filters.user_id) {
    values.push(filters.user_id);
    clauses.push(`us.user_id = $${values.length}`);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  return db.query(
    `SELECT
      us.id,
      us.user_id,
      u.full_name,
      u.username,
      us.login_time,
      us.logout_time,
      us.session_status,
      us.ip_address
    FROM user_sessions us
    LEFT JOIN users u ON u.id = us.user_id
    ${whereClause}
    ORDER BY us.login_time DESC, us.id DESC
    LIMIT 200`,
    values
  );
};

const createUserSession = async ({ user_id, ip_address }, executor = db) => {
  return executor.query(
    `INSERT INTO user_sessions (user_id, ip_address, session_status)
    VALUES ($1, $2, 'active')
    RETURNING id, login_time, session_status`,
    [user_id, ip_address || null]
  );
};

const closeUserSession = async ({ session_id, user_id }, executor = db) => {
  return executor.query(
    `UPDATE user_sessions
    SET logout_time = CURRENT_TIMESTAMP,
        session_status = 'closed'
    WHERE id = $1
      AND user_id = $2
      AND session_status = 'active'
    RETURNING id, logout_time, session_status`,
    [session_id, user_id]
  );
};

const updateLastLogin = async (userId, executor = db) => {
  return executor.query(
    `UPDATE users
    SET last_login = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1`,
    [userId]
  );
};

const writeAuditLog = async (payload, executor = db) => {
  return executor.query(
    `INSERT INTO audit_logs (user_id, action, module, description)
    VALUES ($1, $2, $3, $4)
    RETURNING *`,
    [
      payload.user_id || null,
      payload.action,
      payload.module,
      payload.description || null
    ]
  );
};

module.exports = {
  closeUserSession,
  createUserSession,
  createUser,
  deleteUser,
  getUserById,
  listAuditLogs,
  listRoles,
  listShifts,
  listUserSessions,
  listUsers,
  listWarehouses,
  updateLastLogin,
  updateUser,
  writeAuditLog
};

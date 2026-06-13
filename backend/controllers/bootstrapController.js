const db = require("../config/db");
const { roleNames } = require("../config/systemConfig");
const { writeAuditLog } = require("../models/adminModel");
const { buildError } = require("../utils/apiError");
const { hashPassword } = require("../utils/password");

const passwordPolicyMessage = "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[0-9][0-9\s()-]{6,18}[0-9]$/;
const usernamePattern = /^[A-Za-z0-9._-]{3,50}$/;
const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

const cleanString = (value) => String(value ?? "").trim();

const readRequiredId = (value, fieldName) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw buildError(`${fieldName} is required.`, 400);
  }
  return id;
};

const normalizeFirstAdminPayload = (body = {}) => {
  const payload = {
    full_name: cleanString(body.full_name),
    username: cleanString(body.username),
    email: cleanString(body.email),
    phone_number: cleanString(body.phone_number),
    password: String(body.password ?? ""),
    confirm_password: String(body.confirm_password ?? body.password_confirmation ?? ""),
    shift_id: readRequiredId(body.shift_id, "Shift")
  };

  if (payload.full_name.length < 2 || payload.full_name.length > 150) {
    throw buildError("Full name must be between 2 and 150 characters.", 400);
  }
  if (!usernamePattern.test(payload.username)) {
    throw buildError("Username must be 3 to 50 characters and may contain letters, numbers, dots, underscores, or hyphens.", 400);
  }
  if (!emailPattern.test(payload.email)) {
    throw buildError("Enter a valid email address.", 400);
  }
  if (!phonePattern.test(payload.phone_number)) {
    throw buildError("Enter a valid phone number using digits and an optional leading +.", 400);
  }
  if (!passwordPattern.test(payload.password)) {
    throw buildError(passwordPolicyMessage, 400);
  }
  if (payload.password !== payload.confirm_password) {
    throw buildError("Password confirmation does not match.", 400);
  }

  return payload;
};

const requirePendingBootstrapAccount = async (client, userId, lock = false) => {
  const result = await client.query(
    `SELECT id, username, status, is_bootstrap_admin, bootstrap_completed
     FROM users
     WHERE id = $1
     ${lock ? "FOR UPDATE" : ""}`,
    [userId]
  );
  const bootstrapUser = result.rows[0];

  if (!bootstrapUser || bootstrapUser.status !== "active" || !bootstrapUser.is_bootstrap_admin) {
    throw buildError("Only the authenticated bootstrap administrator can perform this action.", 403);
  }
  if (bootstrapUser.bootstrap_completed) {
    throw buildError("Bootstrap administrator setup has already been completed.", 409);
  }

  return bootstrapUser;
};

const getBootstrapOptions = async (req, res, next) => {
  try {
    await requirePendingBootstrapAccount(db, req.auth?.userId);
    const [warehouses, shifts] = await Promise.all([
      db.query(
        `SELECT id, warehouse_name, warehouse_code
         FROM warehouses
         WHERE status = 'active'
         ORDER BY warehouse_code, warehouse_name`
      ),
      db.query(
        `SELECT id, shift_name, start_time, end_time
         FROM shifts
         ORDER BY start_time, shift_name`
      )
    ]);

    res.json({
      success: true,
      data: {
        role_name: roleNames.systemAdmin,
        warehouses: warehouses.rows,
        shifts: shifts.rows
      }
    });
  } catch (error) {
    next(error);
  }
};

const createFirstAdmin = async (req, res, next) => {
  let payload;
  let passwordHash;

  try {
    payload = normalizeFirstAdminPayload(req.body);
    passwordHash = await hashPassword(payload.password);
  } catch (error) {
    next(error);
    return;
  }

  const client = await db.pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const bootstrapUser = await requirePendingBootstrapAccount(client, req.auth?.userId, true);
    const roleResult = await client.query(
      "SELECT id FROM roles WHERE role_name = $1 LIMIT 1",
      [roleNames.systemAdmin]
    );
    if (roleResult.rowCount === 0) {
      throw buildError("System Admin role was not found.", 500);
    }

    const shiftResult = await client.query(
      "SELECT id FROM shifts WHERE id = $1",
      [payload.shift_id]
    );
    if (shiftResult.rowCount === 0) {
      throw buildError("Selected shift was not found.", 400);
    }

    const duplicateResult = await client.query(
      `SELECT
         CASE
           WHEN LOWER(username) = LOWER($1) THEN 'username'
           WHEN LOWER(email) = LOWER($2) THEN 'email'
         END AS duplicate_field
       FROM users
       WHERE LOWER(username) = LOWER($1)
          OR LOWER(email) = LOWER($2)
       LIMIT 1`,
      [payload.username, payload.email]
    );
    if (duplicateResult.rowCount > 0) {
      throw buildError(`A user with that ${duplicateResult.rows[0].duplicate_field} already exists.`, 409);
    }

    const insertResult = await client.query(
      `INSERT INTO users (
         full_name,
         username,
         email,
         phone_number,
         password_hash,
         role_id,
         warehouse_id,
         shift_id,
         status,
         must_change_password,
         is_system_user,
         is_bootstrap_admin,
         bootstrap_completed
       )
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, 'active', TRUE, FALSE, FALSE, FALSE)
       RETURNING id`,
      [
        payload.full_name,
        payload.username,
        payload.email,
        payload.phone_number,
        passwordHash,
        roleResult.rows[0].id,
        payload.shift_id
      ]
    );
    const newAdminId = insertResult.rows[0].id;

    await writeAuditLog(
      {
        user_id: bootstrapUser.id,
        target_user_id: newAdminId,
        action: "CREATE_FIRST_REAL_ADMIN",
        module: "Bootstrap Setup",
        description: `Created the first real System Administrator account ${payload.username}.`,
        metadata: {
          warehouse_scope: "all",
          shift_id: payload.shift_id
        }
      },
      client
    );

    await client.query(
      `UPDATE users
       SET bootstrap_completed = TRUE,
           status = 'inactive',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [bootstrapUser.id]
    );

    await writeAuditLog(
      {
        user_id: bootstrapUser.id,
        target_user_id: newAdminId,
        action: "BOOTSTRAP_ADMIN_COMPLETED",
        module: "Bootstrap Setup",
        description: "Bootstrap administrator setup was completed."
      },
      client
    );

    const invalidated = await client.query(
      `UPDATE user_sessions
       SET logout_time = CURRENT_TIMESTAMP,
           session_status = 'closed'
       WHERE user_id = $1
         AND session_status = 'active'
       RETURNING id`,
      [bootstrapUser.id]
    );

    await writeAuditLog(
      {
        user_id: bootstrapUser.id,
        target_user_id: bootstrapUser.id,
        action: "BOOTSTRAP_SESSION_INVALIDATED",
        module: "Authentication",
        description: `Closed ${invalidated.rowCount} bootstrap administrator session(s) after setup.`,
        metadata: {
          sessions_closed: invalidated.rowCount
        }
      },
      client
    );

    await client.query("COMMIT");
    transactionStarted = false;

    res.status(201).json({
      success: true,
      message: "First real System Admin created. Please log in with the new admin account."
    });
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }
    if (error.code === "23505") {
      next(buildError("A user with that username or email already exists.", 409));
    } else {
      next(error);
    }
  } finally {
    client.release();
  }
};

module.exports = {
  createFirstAdmin,
  getBootstrapOptions,
  normalizeFirstAdminPayload
};

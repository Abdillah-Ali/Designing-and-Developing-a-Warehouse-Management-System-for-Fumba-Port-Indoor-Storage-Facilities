const db = require("../config/db");
const { roleNames } = require("../config/systemConfig");
const { buildError } = require("../utils/apiError");
const { hashPassword } = require("../utils/password");
const { getMaximumActiveSystemAdministrators } = require("../services/systemConfigurationService");

const SETUP_LOCK_KEY = 927431;
const passwordPolicyMessage = "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[0-9][0-9\s()-]{6,18}[0-9]$/;
const usernamePattern = /^[A-Za-z0-9._-]{3,50}$/;
const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const cleanString = (value) => String(value ?? "").trim();

const normalizeFirstAdminPayload = (body = {}) => {
  const payload = {
    full_name: cleanString(body.full_name),
    username: cleanString(body.username),
    email: cleanString(body.email),
    phone_number: cleanString(body.phone_number),
    password: String(body.password ?? ""),
    confirm_password: String(body.confirm_password ?? body.password_confirmation ?? "")
  };
  if (payload.full_name.length < 2 || payload.full_name.length > 150) {
    throw buildError("Full name must be between 2 and 150 characters.", 400);
  }
  if (!usernamePattern.test(payload.username)) {
    throw buildError("Username must be 3 to 50 characters and may contain letters, numbers, dots, underscores, or hyphens.", 400);
  }
  if (!emailPattern.test(payload.email)) throw buildError("Enter a valid email address.", 400);
  if (!phonePattern.test(payload.phone_number)) throw buildError("Enter a valid phone number.", 400);
  if (!passwordPattern.test(payload.password)) throw buildError(passwordPolicyMessage, 400);
  if (payload.password !== payload.confirm_password) throw buildError("Password confirmation does not match.", 400);
  return payload;
};

const readSetupComplete = async (executor = db) => {
  const result = await executor.query(
    `SELECT
       state.initial_setup_completed
       OR EXISTS (
         SELECT 1
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE r.role_name = $1
       ) AS setup_complete
     FROM installation_state state
     WHERE state.singleton = TRUE`,
    [roleNames.systemAdmin]
  );
  return Boolean(result.rows[0]?.setup_complete);
};

const getSetupStatus = async (_req, res, next) => {
  try {
    const setupComplete = await readSetupComplete();
    res.json({ success: true, data: { setup_required: !setupComplete, setup_complete: setupComplete } });
  } catch (error) {
    next(error);
  }
};

const getBootstrapOptions = async (_req, res, next) => {
  try {
    if (await readSetupComplete()) throw buildError("Initial setup is no longer available.", 409);
    res.json({ success: true, data: { setup_required: true, role_name: roleNames.systemAdmin } });
  } catch (error) {
    next(error);
  }
};

const createFirstAdmin = async (req, res, next) => {
  let payload;
  try {
    payload = normalizeFirstAdminPayload(req.body);
  } catch (error) {
    next(error);
    return;
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [SETUP_LOCK_KEY]);
    if (await readSetupComplete(client)) {
      throw buildError("Initial setup is permanently disabled because the System Administrator has already been created.", 409);
    }
    const role = await client.query("SELECT id FROM roles WHERE role_name = $1 LIMIT 1", [roleNames.systemAdmin]);
    if (!role.rowCount) throw buildError("The structural System Administrator role is unavailable.", 503);
    const maximumAdministrators = await getMaximumActiveSystemAdministrators(client);
    const activeAdministrators = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE r.role_name = $1
         AND u.status = 'active'`,
      [roleNames.systemAdmin]
    );
    if (Number(activeAdministrators.rows[0]?.count || 0) >= maximumAdministrators) {
      throw buildError(
        `Maximum number of active System Administrators (${maximumAdministrators}) has been reached.`,
        409
      );
    }

    const passwordHash = await hashPassword(payload.password, client);
    const administrator = await client.query(
      `INSERT INTO users (
         public_reference, full_name, username, email, phone_number, password_hash, role_id,
         warehouse_id, shift_id, status, must_change_password,
         is_system_user, is_bootstrap_admin, bootstrap_completed
       ) VALUES (generate_user_public_reference(),$1,$2,$3,$4,$5,$6,NULL,NULL,'active',FALSE,FALSE,FALSE,FALSE)
       RETURNING id, public_reference`,
      [payload.full_name, payload.username, payload.email, payload.phone_number, passwordHash, role.rows[0].id]
    );
    const createdAdministrator = administrator.rows[0];
    await client.query(
      `UPDATE installation_state
       SET initial_setup_completed = TRUE,
           initialized_by_user_id = $1,
           initialized_at = CURRENT_TIMESTAMP
       WHERE singleton = TRUE
         AND initial_setup_completed = FALSE`,
      [createdAdministrator.id]
    );
    await client.query(
      `INSERT INTO audit_logs (target_user_id, actor_reference, action, module, description, metadata)
       VALUES ($1,'SYSTEM_SETUP','INITIAL_SYSTEM_ADMIN_CREATED','Initial Setup',$2,$3)`,
      [
        createdAdministrator.id,
        `Created the first System Administrator account ${payload.username}.`,
        JSON.stringify({
          setup_method: "one_time_setup",
          actor: "SYSTEM_SETUP",
          target_user_reference: createdAdministrator.public_reference
        })
      ]
    );
    await client.query("COMMIT");
    res.status(201).json({
      success: true,
      message: "First System Administrator created. Initial setup is now permanently disabled."
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error.code === "23505" ? buildError("The username or email is already in use.", 409) : error);
  } finally {
    client.release();
  }
};

module.exports = {
  createFirstAdmin,
  getBootstrapOptions,
  getSetupStatus,
  normalizeFirstAdminPayload,
  readSetupComplete
};

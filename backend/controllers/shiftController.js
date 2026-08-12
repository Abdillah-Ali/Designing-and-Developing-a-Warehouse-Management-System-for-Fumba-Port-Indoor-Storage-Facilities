const crypto = require("node:crypto");
const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { buildError } = require("../utils/apiError");

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const cleanString = (value) => String(value ?? "").trim();

const generateReference = (prefix) => {
  const year = new Date().getFullYear();
  const random = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}-${year}-${random}`;
};

const normalizeStatus = (value, fallback = "active") => {
  const status = cleanString(value || fallback).toLowerCase();
  if (!["active", "inactive"].includes(status)) {
    throw buildError("Shift status must be Active or Inactive.", 400);
  }
  return status;
};

const readShiftPayload = (body, existing = {}) => {
  const shiftName = cleanString(body.shift_name ?? body.name ?? existing.shift_name);
  const shiftCode = cleanString(body.shift_code ?? body.code ?? existing.shift_code).toUpperCase();
  const startTime = cleanString(body.start_time ?? existing.start_time);
  const endTime = cleanString(body.end_time ?? existing.end_time);
  const graceRaw = body.grace_period_minutes ?? body.grace_period ?? existing.grace_period_minutes;
  const gracePeriod = graceRaw === undefined || graceRaw === null || graceRaw === ""
    ? null
    : Number(graceRaw);

  if (!shiftName || shiftName.length > 120) {
    throw buildError("Shift name is required and must be 120 characters or fewer.", 400);
  }
  if (!shiftCode || shiftCode.length > 40) {
    throw buildError("Shift code is required and must be 40 characters or fewer.", 400);
  }
  if (!timePattern.test(startTime) || !timePattern.test(endTime)) {
    throw buildError("Start and end times must use HH:MM 24-hour format.", 400);
  }
  if (startTime === endTime) {
    throw buildError("Shift start and end times cannot be the same.", 400);
  }
  if (gracePeriod !== null && (!Number.isInteger(gracePeriod) || gracePeriod < 0)) {
    throw buildError("Grace period must be a non-negative whole number of minutes.", 400);
  }

  return {
    shift_name: shiftName,
    shift_code: shiftCode,
    start_time: startTime,
    end_time: endTime,
    description: cleanString(body.description ?? existing.description) || null,
    grace_period_minutes: gracePeriod,
    status: normalizeStatus(body.status, existing.status || "active"),
    effective_date: cleanString(body.effective_date ?? existing.effective_date) || null
  };
};

const formatShift = (row) => row && ({
  id: row.id,
  public_reference: row.public_reference,
  shift_name: row.shift_name,
  name: row.shift_name,
  shift_code: row.shift_code,
  code: row.shift_code,
  start_time: row.start_time,
  end_time: row.end_time,
  description: row.description,
  grace_period_minutes: row.grace_period_minutes,
  status: row.status === "active" ? "Active" : "Inactive",
  effective_date: row.effective_date,
  created_at: row.created_at,
  updated_at: row.updated_at,
  assigned_user_count: Number(row.assigned_user_count || 0)
});

const getShifts = async (req, res, next) => {
  try {
    const values = [];
    const clauses = [];
    if (req.query.status) {
      values.push(normalizeStatus(req.query.status));
      clauses.push(`s.status = $${values.length}`);
    }
    if (req.query.active === "true") {
      clauses.push("s.status = 'active'");
    }
    if (req.query.search) {
      values.push(`%${req.query.search}%`);
      clauses.push(`(s.shift_name ILIKE $${values.length} OR s.shift_code ILIKE $${values.length})`);
    }

    const result = await db.query(
      `SELECT
         s.*,
         COUNT(u.id)::int AS assigned_user_count
       FROM shifts s
       LEFT JOIN users u ON u.shift_id = s.id AND u.status = 'active'
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       GROUP BY s.id
       ORDER BY s.start_time, s.shift_name`,
      values
    );

    res.json({ success: true, count: result.rowCount, data: result.rows.map(formatShift) });
  } catch (error) {
    next(error);
  }
};

const getShift = async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT s.*, COUNT(u.id)::int AS assigned_user_count
       FROM shifts s
       LEFT JOIN users u ON u.shift_id = s.id AND u.status = 'active'
       WHERE s.public_reference = $1
       GROUP BY s.id`,
      [req.params.reference]
    );
    if (!result.rowCount) throw buildError("Shift not found.", 404);
    res.json({ success: true, data: formatShift(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

const createShift = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const payload = readShiftPayload(req.body);
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO shifts (
         public_reference, shift_name, shift_code, start_time, end_time,
         description, grace_period_minutes, status, effective_date, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
       RETURNING *`,
      [
        generateReference("SHIFT"),
        payload.shift_name,
        payload.shift_code,
        payload.start_time,
        payload.end_time,
        payload.description,
        payload.grace_period_minutes,
        payload.status,
        payload.effective_date,
        req.auth?.userId || null
      ]
    );
    await writeAuditLog({
      user_id: req.auth?.userId,
      action: "CREATE_SHIFT",
      module: "Shift Management",
      description: `Created shift ${payload.shift_code}.`,
      metadata: { shift_reference: result.rows[0].public_reference, shift_code: payload.shift_code }
    }, client);
    await client.query("COMMIT");
    res.status(201).json({ success: true, data: formatShift(result.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

const updateShift = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT * FROM shifts WHERE public_reference = $1 FOR UPDATE", [req.params.reference]);
    if (!existing.rowCount) throw buildError("Shift not found.", 404);
    const payload = readShiftPayload(req.body, existing.rows[0]);
    const result = await client.query(
      `UPDATE shifts SET
         shift_name=$1, shift_code=$2, start_time=$3, end_time=$4, description=$5,
         grace_period_minutes=$6, status=$7, effective_date=$8, updated_by=$9
       WHERE public_reference=$10
       RETURNING *`,
      [
        payload.shift_name,
        payload.shift_code,
        payload.start_time,
        payload.end_time,
        payload.description,
        payload.grace_period_minutes,
        payload.status,
        payload.effective_date,
        req.auth?.userId || null,
        req.params.reference
      ]
    );
    await writeAuditLog({
      user_id: req.auth?.userId,
      action: "UPDATE_SHIFT",
      module: "Shift Management",
      description: `Updated shift ${payload.shift_code}.`,
      metadata: { shift_reference: req.params.reference }
    }, client);
    await client.query("COMMIT");
    res.json({ success: true, data: formatShift(result.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

const updateShiftStatus = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const status = normalizeStatus(req.body.status);
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE shifts
       SET status=$1, updated_by=$2
       WHERE public_reference=$3
       RETURNING *`,
      [status, req.auth?.userId || null, req.params.reference]
    );
    if (!result.rowCount) throw buildError("Shift not found.", 404);
    await writeAuditLog({
      user_id: req.auth?.userId,
      action: status === "active" ? "ACTIVATE_SHIFT" : "DEACTIVATE_SHIFT",
      module: "Shift Management",
      description: `${status === "active" ? "Activated" : "Deactivated"} shift ${result.rows[0].shift_code}.`,
      metadata: { shift_reference: req.params.reference, status }
    }, client);
    await client.query("COMMIT");
    res.json({ success: true, data: formatShift(result.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

const getShiftUsers = async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT
         u.username,
         u.full_name,
         u.email,
         u.status,
         r.role_name,
         s.public_reference AS shift_reference,
         s.shift_code
       FROM shifts s
       JOIN users u ON u.shift_id = s.id
       JOIN roles r ON r.id = u.role_id
       WHERE s.public_reference = $1
       ORDER BY u.full_name`,
      [req.params.reference]
    );
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

const resolveUserForAssignment = async (client, body) => {
  const username = cleanString(body.username ?? body.user_reference);
  if (username) {
    const result = await client.query(
      `SELECT u.id, u.username, u.full_name, u.shift_id
       FROM users u
       WHERE LOWER(u.username) = LOWER($1)
       FOR UPDATE`,
      [username]
    );
    return result.rows[0] || null;
  }
  if (body.user_id) {
    const result = await client.query(
      "SELECT id, username, full_name, shift_id FROM users WHERE id = $1 FOR UPDATE",
      [Number(body.user_id)]
    );
    return result.rows[0] || null;
  }
  throw buildError("User username is required for shift assignment.", 400);
};

const assignUserToShift = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const shiftResult = await client.query(
      "SELECT id, public_reference, shift_code, status FROM shifts WHERE public_reference = $1 FOR UPDATE",
      [req.params.reference]
    );
    if (!shiftResult.rowCount) throw buildError("Shift not found.", 404);
    const shift = shiftResult.rows[0];
    if (shift.status !== "active") throw buildError("Inactive shifts cannot receive new assignments.", 409);

    const user = await resolveUserForAssignment(client, req.body || {});
    if (!user) throw buildError("User not found.", 404);
    if (Number(user.shift_id) === Number(shift.id)) {
      throw buildError("User is already assigned to this shift.", 409);
    }

    const action = user.shift_id ? "Reassigned" : "Assigned";
    await client.query("UPDATE users SET shift_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", [shift.id, user.id]);
    await client.query(
      `INSERT INTO shift_assignment_history (
         public_reference, user_id, shift_id, previous_shift_id, action, reason, assigned_by, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        generateReference("SHA"),
        user.id,
        shift.id,
        user.shift_id || null,
        action,
        cleanString(req.body.reason) || null,
        req.auth?.userId || null,
        JSON.stringify({ shift_reference: shift.public_reference, username: user.username })
      ]
    );
    await writeAuditLog({
      user_id: req.auth?.userId,
      target_user_id: user.id,
      action: `${action.toUpperCase()}_USER_SHIFT`,
      module: "Shift Management",
      description: `${action} ${user.username} to shift ${shift.shift_code}.`,
      metadata: { shift_reference: shift.public_reference, username: user.username }
    }, client);
    await client.query("COMMIT");
    res.json({ success: true, message: "Shift assignment updated." });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

const removeUserFromShift = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const user = await resolveUserForAssignment(client, {
      username: req.params.username
    });
    if (!user) throw buildError("User not found.", 404);
    if (!user.shift_id) throw buildError("User does not have an active shift assignment.", 409);
    const previousShift = user.shift_id;
    await client.query("UPDATE users SET shift_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [user.id]);
    await client.query(
      `INSERT INTO shift_assignment_history (
         public_reference, user_id, previous_shift_id, action, reason, assigned_by, metadata
       ) VALUES ($1,$2,$3,'Removed',$4,$5,$6)`,
      [
        generateReference("SHA"),
        user.id,
        previousShift,
        cleanString(req.body?.reason) || null,
        req.auth?.userId || null,
        JSON.stringify({ username: user.username })
      ]
    );
    await writeAuditLog({
      user_id: req.auth?.userId,
      target_user_id: user.id,
      action: "REMOVE_USER_SHIFT",
      module: "Shift Management",
      description: `Removed shift assignment for ${user.username}.`,
      metadata: { username: user.username }
    }, client);
    await client.query("COMMIT");
    res.json({ success: true, message: "Shift assignment removed." });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

const getShiftAssignmentHistory = async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT
         sah.public_reference,
         sah.action,
         sah.reason,
         sah.effective_from,
         sah.effective_to,
         sah.created_at,
         u.username,
         u.full_name,
         s.public_reference AS shift_reference,
         s.shift_code,
         previous.shift_code AS previous_shift_code,
         actor.username AS assigned_by_username
       FROM shift_assignment_history sah
       JOIN users u ON u.id = sah.user_id
       LEFT JOIN shifts s ON s.id = sah.shift_id
       LEFT JOIN shifts previous ON previous.id = sah.previous_shift_id
       LEFT JOIN users actor ON actor.id = sah.assigned_by
       ORDER BY sah.created_at DESC
       LIMIT 300`
    );
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  assignUserToShift,
  createShift,
  getShift,
  getShiftAssignmentHistory,
  getShiftUsers,
  getShifts,
  removeUserFromShift,
  updateShift,
  updateShiftStatus
};

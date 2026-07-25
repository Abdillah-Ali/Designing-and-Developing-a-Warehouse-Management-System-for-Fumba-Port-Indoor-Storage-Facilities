const db = require("../config/db");
const crypto = require("node:crypto");
const { writeAuditLog } = require("../models/adminModel");
const { buildError } = require("../utils/apiError");
const {
  getEntityReferenceCount,
  normalizeWarehouseStatusForApi,
  readConfigurationStatus,
  readLetter,
  readOptionalPositiveNumber,
  readPositiveNumber,
  readThresholds,
  resolveLifecycleState,
  textValue
} = require("../services/warehouseConfigurationService");

const formatWarehouse = (row) => row && ({
  ...row,
  public_reference: row.warehouse_code,
  name: row.warehouse_name,
  code: row.warehouse_code,
  status: normalizeWarehouseStatusForApi(row.status)
});

const generateAssignmentReference = () => `WHA-${new Date().getFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

const getWarehouses = async (req, res, next) => {
  try {
    const values = [];
    const clauses = [];
    if (req.auth?.role !== "system-admin") clauses.push("w.status = 'active'");
    if (req.query.status) {
      values.push(String(req.query.status).toLowerCase());
      clauses.push(`w.status = $${values.length}`);
    }
    if (req.query.search) {
      values.push(`%${req.query.search}%`);
      clauses.push(`(w.warehouse_name ILIKE $${values.length} OR w.warehouse_code ILIKE $${values.length})`);
    }
    const result = await db.query(
      `SELECT
         w.*,
         COUNT(DISTINCT u.id)::int AS assigned_user_count,
         COUNT(DISTINCT z.id)::int AS zone_count,
         COUNT(DISTINCT b.id)::int AS bin_total,
         COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'Available' AND b.active)::int AS available_bins,
         COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'Occupied' AND b.active)::int AS occupied_bins,
         COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'Full' AND b.active)::int AS full_bins,
         COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'Blocked')::int AS blocked_bins,
         COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'Maintenance')::int AS maintenance_bins,
         COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'Damaged')::int AS damaged_bins,
         COALESCE(SUM(b.current_weight), 0)::numeric(14, 2) AS current_weight_capacity,
         COALESCE(SUM(b.current_volume), 0)::numeric(14, 2) AS current_volume_capacity,
         CASE WHEN COALESCE(w.total_capacity, 0) > 0
              THEN ROUND(COALESCE(SUM(b.current_weight), 0) / w.total_capacity * 100, 2)
              ELSE 0 END AS weight_occupancy_percent
       FROM warehouses w
       LEFT JOIN users u ON u.warehouse_id = w.id
       LEFT JOIN zones z ON z.warehouse_id = w.id
       LEFT JOIN racks r ON r.zone_id = z.id
       LEFT JOIN levels l ON l.rack_id = r.id
       LEFT JOIN bins b ON b.level_id = l.id
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       GROUP BY w.id
       ORDER BY w.warehouse_code`,
      values
    );
    res.json({ success: true, count: result.rowCount, data: result.rows.map(formatWarehouse) });
  } catch (error) {
    next(error);
  }
};

const readWarehousePayload = (body, existing = {}) => {
  const letter = readLetter(body.warehouse_letter ?? body.letter ?? existing.warehouse_letter, "Warehouse letter");
  const thresholds = readThresholds(body, existing);
  const lifecycle = resolveLifecycleState({
    status: body.status,
    existingStatus: normalizeWarehouseStatusForApi(existing.status || "active")
  });
  return {
    letter,
    name: `Warehouse ${letter}`,
    code: `WH-${letter}`,
    description: textValue(body.description ?? body.location ?? existing.description),
    totalCapacity: readPositiveNumber(
      body.total_capacity ?? body.max_weight ?? existing.total_capacity,
      "Warehouse total capacity"
    ),
    maxVolume: readOptionalPositiveNumber(body.max_volume ?? existing.max_volume, "Warehouse maximum volume"),
    status: lifecycle.status,
    thresholds
  };
};

const createWarehouse = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const payload = readWarehousePayload(req.body);
    await client.query("BEGIN");
    const duplicate = await client.query(
      `SELECT id FROM warehouses
       WHERE UPPER(warehouse_code) = $1 OR UPPER(warehouse_name) = $2 OR UPPER(warehouse_letter) = $3`,
      [payload.code, payload.name.toUpperCase(), payload.letter]
    );
    if (duplicate.rowCount) throw buildError(`Warehouse ${payload.code} already exists.`, 409);
    const result = await client.query(
      `INSERT INTO warehouses (
         warehouse_letter, warehouse_name, warehouse_code, description, total_capacity,
         max_volume, occupancy_warning_threshold, full_threshold, status, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
       RETURNING *`,
      [
        payload.letter, payload.name, payload.code, payload.description, payload.totalCapacity,
        payload.maxVolume, payload.thresholds.warning, payload.thresholds.full,
        payload.status.toLowerCase(), req.auth?.userId || null
      ]
    );
    await writeAuditLog({
      user_id: req.auth?.userId,
      action: "CREATE_WAREHOUSE",
      module: "Warehouse Configuration",
      description: `Created ${payload.name} (${payload.code}).`,
      metadata: { warehouse_id: result.rows[0].id, ...payload }
    }, client);
    await client.query("COMMIT");
    res.status(201).json({ success: true, data: formatWarehouse(result.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const updateWarehouse = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const existingResult = await client.query("SELECT * FROM warehouses WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!existingResult.rowCount) throw buildError("Warehouse not found.", 404);
    const existing = existingResult.rows[0];
    const payload = readWarehousePayload(req.body, existing);
    const duplicate = await client.query(
      `SELECT id FROM warehouses
       WHERE (UPPER(warehouse_code) = $1 OR UPPER(warehouse_name) = $2 OR UPPER(warehouse_letter) = $3)
         AND id <> $4`,
      [payload.code, payload.name.toUpperCase(), payload.letter, req.params.id]
    );
    if (duplicate.rowCount) throw buildError(`Warehouse ${payload.code} already exists.`, 409);
    if (payload.status === "Inactive") await deactivateWarehouseChildren(client, req.params.id);
    const result = await client.query(
      `UPDATE warehouses SET
         warehouse_letter=$1, warehouse_name=$2, warehouse_code=$3, description=$4,
         total_capacity=$5, max_volume=$6, occupancy_warning_threshold=$7,
         full_threshold=$8, status=$9, updated_by=$10
       WHERE id=$11 RETURNING *`,
      [
        payload.letter, payload.name, payload.code, payload.description, payload.totalCapacity,
        payload.maxVolume, payload.thresholds.warning, payload.thresholds.full,
        payload.status.toLowerCase(), req.auth?.userId || null, req.params.id
      ]
    );
    await writeAuditLog({
      user_id: req.auth?.userId,
      action: "UPDATE_WAREHOUSE",
      module: "Warehouse Configuration",
      description: `Updated ${payload.code}.`,
      metadata: { warehouse_id: Number(req.params.id), before: existing, after: payload }
    }, client);
    await client.query("COMMIT");
    res.json({ success: true, data: formatWarehouse(result.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const deactivateWarehouseChildren = async (client, warehouseId) => {
  await client.query("UPDATE zones SET active=FALSE,status='Inactive' WHERE warehouse_id=$1", [warehouseId]);
  await client.query(
    "UPDATE racks SET active=FALSE,status='Inactive' WHERE zone_id IN (SELECT id FROM zones WHERE warehouse_id=$1)",
    [warehouseId]
  );
  await client.query(
    `UPDATE levels SET active=FALSE,status='Inactive'
     WHERE rack_id IN (SELECT r.id FROM racks r JOIN zones z ON z.id=r.zone_id WHERE z.warehouse_id=$1)`,
    [warehouseId]
  );
  await client.query(
    `UPDATE bins SET active=FALSE,status='Inactive',status_reason='Parent warehouse deactivated'
     WHERE level_id IN (
       SELECT l.id FROM levels l JOIN racks r ON r.id=l.rack_id JOIN zones z ON z.id=r.zone_id
       WHERE z.warehouse_id=$1
     )`,
    [warehouseId]
  );
};

const updateWarehouseStatus = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const status = readConfigurationStatus(req.body.status);
    await client.query("BEGIN");
    const existingResult = await client.query("SELECT * FROM warehouses WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!existingResult.rowCount) throw buildError("Warehouse not found.", 404);
    const existing = existingResult.rows[0];
    if (normalizeWarehouseStatusForApi(existing.status) === status) {
      throw buildError(`Warehouse is already ${status}.`, 400);
    }
    if (status === "Inactive") await deactivateWarehouseChildren(client, req.params.id);
    const result = await client.query(
      "UPDATE warehouses SET status=$1,updated_by=$2 WHERE id=$3 RETURNING *",
      [status.toLowerCase(), req.auth?.userId || null, req.params.id]
    );
    await writeAuditLog({
      user_id: req.auth?.userId,
      action: status === "Active" ? "ACTIVATE_WAREHOUSE" : "DEACTIVATE_WAREHOUSE",
      module: "Warehouse Configuration",
      description: `${status === "Active" ? "Activated" : "Deactivated"} ${existing.warehouse_code}.`,
      metadata: { warehouse_id: Number(req.params.id), status, reason: textValue(req.body.reason) }
    }, client);
    await client.query("COMMIT");
    res.json({ success: true, data: formatWarehouse(result.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const deleteWarehouse = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT * FROM warehouses WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!existing.rowCount) throw buildError("Warehouse not found.", 404);
    const references = await getEntityReferenceCount(client, "Warehouse", req.params.id);
    if (references > 0) {
      throw buildError("Warehouse is already in use and cannot be deleted. Deactivate it instead.", 409);
    }
    await client.query("DELETE FROM capacity_configurations WHERE entity_type='Warehouse' AND entity_id=$1", [req.params.id]);
    await client.query("DELETE FROM warehouses WHERE id=$1", [req.params.id]);
    await writeAuditLog({
      user_id: req.auth?.userId,
      action: "DELETE_WAREHOUSE",
      module: "Warehouse Configuration",
      description: `Deleted unused warehouse ${existing.rows[0].warehouse_code}.`,
      metadata: { deleted_record: existing.rows[0] }
    }, client);
    await client.query("COMMIT");
    res.json({ success: true, message: "Warehouse deleted." });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const listWarehouseAssignments = async (req, res, next) => {
  try {
    const values = [];
    const clauses = [];
    if (req.query.warehouse) {
      values.push(req.query.warehouse);
      clauses.push(`w.warehouse_code = $${values.length}`);
    }
    if (req.query.active_warehouses === "true") {
      clauses.push("w.status = 'active'");
    }
    const result = await db.query(
      `SELECT
         u.username,
         u.full_name,
         u.email,
         u.status AS user_status,
         r.role_name,
         w.warehouse_code AS warehouse_reference,
         w.warehouse_name,
         w.status AS warehouse_status
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN warehouses w ON w.id = u.warehouse_id
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY w.warehouse_code NULLS LAST, u.full_name`,
      values
    );
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

const resolveUserForWarehouseAssignment = async (client, body) => {
  const username = textValue(body.username ?? body.user_reference);
  if (username) {
    const result = await client.query(
      "SELECT id, username, full_name, warehouse_id FROM users WHERE LOWER(username) = LOWER($1) FOR UPDATE",
      [username]
    );
    return result.rows[0] || null;
  }
  if (body.user_id) {
    const result = await client.query(
      "SELECT id, username, full_name, warehouse_id FROM users WHERE id = $1 FOR UPDATE",
      [Number(body.user_id)]
    );
    return result.rows[0] || null;
  }
  throw buildError("User username is required for warehouse assignment.", 400);
};

const assignUserToWarehouse = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const warehouseResult = await client.query(
      "SELECT id, warehouse_code, warehouse_name, status FROM warehouses WHERE warehouse_code = $1 FOR UPDATE",
      [req.params.reference]
    );
    if (!warehouseResult.rowCount) throw buildError("Warehouse not found.", 404);
    const warehouse = warehouseResult.rows[0];
    if (warehouse.status !== "active") throw buildError("Inactive warehouses cannot receive new assignments.", 409);

    const user = await resolveUserForWarehouseAssignment(client, req.body || {});
    if (!user) throw buildError("User not found.", 404);
    if (Number(user.warehouse_id) === Number(warehouse.id)) {
      throw buildError("User is already assigned to this warehouse.", 409);
    }

    const action = user.warehouse_id ? "Reassigned" : "Assigned";
    await client.query(
      "UPDATE users SET warehouse_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [warehouse.id, user.id]
    );
    await client.query(
      `INSERT INTO warehouse_assignment_history (
         public_reference, user_id, warehouse_id, previous_warehouse_id,
         action, reason, assigned_by, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        generateAssignmentReference(),
        user.id,
        warehouse.id,
        user.warehouse_id || null,
        action,
        textValue(req.body.reason),
        req.auth?.userId || null,
        JSON.stringify({ warehouse_reference: warehouse.warehouse_code, username: user.username })
      ]
    );
    await writeAuditLog({
      user_id: req.auth?.userId,
      target_user_id: user.id,
      action: `${action.toUpperCase()}_USER_WAREHOUSE`,
      module: "Warehouse Assignment",
      description: `${action} ${user.username} to ${warehouse.warehouse_code}.`,
      metadata: { warehouse_reference: warehouse.warehouse_code, username: user.username }
    }, client);
    await client.query("COMMIT");
    res.json({ success: true, message: "Warehouse assignment updated." });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

const removeUserFromWarehouse = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const user = await resolveUserForWarehouseAssignment(client, { username: req.params.username });
    if (!user) throw buildError("User not found.", 404);
    if (!user.warehouse_id) throw buildError("User does not have an active warehouse assignment.", 409);
    const previousWarehouseId = user.warehouse_id;
    await client.query("UPDATE users SET warehouse_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [user.id]);
    await client.query(
      `INSERT INTO warehouse_assignment_history (
         public_reference, user_id, previous_warehouse_id, action, reason, assigned_by, metadata
       ) VALUES ($1,$2,$3,'Removed',$4,$5,$6)`,
      [
        generateAssignmentReference(),
        user.id,
        previousWarehouseId,
        textValue(req.body?.reason),
        req.auth?.userId || null,
        JSON.stringify({ username: user.username })
      ]
    );
    await writeAuditLog({
      user_id: req.auth?.userId,
      target_user_id: user.id,
      action: "REMOVE_USER_WAREHOUSE",
      module: "Warehouse Assignment",
      description: `Removed warehouse assignment for ${user.username}.`,
      metadata: { username: user.username }
    }, client);
    await client.query("COMMIT");
    res.json({ success: true, message: "Warehouse assignment removed." });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

const listWarehouseAssignmentHistory = async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT
         wah.public_reference,
         wah.action,
         wah.reason,
         wah.effective_from,
         wah.effective_to,
         wah.created_at,
         u.username,
         u.full_name,
         w.warehouse_code AS warehouse_reference,
         w.warehouse_name,
         previous.warehouse_code AS previous_warehouse_reference,
         actor.username AS assigned_by_username
       FROM warehouse_assignment_history wah
       JOIN users u ON u.id = wah.user_id
       LEFT JOIN warehouses w ON w.id = wah.warehouse_id
       LEFT JOIN warehouses previous ON previous.id = wah.previous_warehouse_id
       LEFT JOIN users actor ON actor.id = wah.assigned_by
       ORDER BY wah.created_at DESC
       LIMIT 300`
    );
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  assignUserToWarehouse,
  createWarehouse,
  deleteWarehouse,
  getWarehouses,
  listWarehouseAssignmentHistory,
  listWarehouseAssignments,
  removeUserFromWarehouse,
  updateWarehouse,
  updateWarehouseStatus
};

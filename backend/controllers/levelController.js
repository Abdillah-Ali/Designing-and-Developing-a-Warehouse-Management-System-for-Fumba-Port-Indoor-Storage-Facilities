const db = require("../config/db");
const { buildError } = require("../utils/apiError");
const { writeAuditLog } = require("../models/adminModel");
const {
  ensureCapacityFitsParent,
  getEntityReferenceCount,
  readConfigurationStatus,
  readPositiveNumber,
  readThresholds,
  resolveLifecycleState,
  textValue
} = require("../services/warehouseConfigurationService");

const isAdmin = (req) => req.auth?.role === "system-admin";

const levelSelect = (activeOnly) => `
  SELECT
    l.id,
    l.id AS level_id,
    l.rack_id,
    l.code,
    l.code AS level_code,
    l.name,
    l.name AS level_name,
    l.level_number,
    l.max_weight,
    l.max_volume,
    l.status,
    l.active,
    l.created_at,
    l.updated_at,
    r.code AS rack_code,
    z.id AS zone_id,
    z.code AS zone_code,
    z.name AS zone_name,
    z.warehouse_id,
    w.warehouse_name,
    w.warehouse_code,
    COUNT(b.id)::int AS bin_total,
    (COUNT(b.id) FILTER (WHERE b.status = 'Available' AND b.active = TRUE))::int AS available_bins,
    (COUNT(b.id) FILTER (WHERE b.status = 'Occupied' AND b.active = TRUE))::int AS occupied_bins,
    (COUNT(b.id) FILTER (WHERE b.status = 'Blocked' AND b.active = TRUE))::int AS blocked_bins,
    (COUNT(b.id) FILTER (WHERE b.status = 'Reserved' AND b.active = TRUE))::int AS reserved_bins,
    COALESCE(SUM(b.current_weight), 0)::numeric(18, 2) AS current_weight_capacity,
    COALESCE(SUM(b.current_volume), 0)::numeric(18, 2) AS current_volume_capacity,
    CASE WHEN l.max_weight > 0
      THEN ROUND((COALESCE(SUM(b.current_weight), 0) / l.max_weight) * 100, 2)
      ELSE 0 END AS weight_occupancy_percent,
    CASE WHEN l.max_volume > 0
      THEN ROUND((COALESCE(SUM(b.current_volume), 0) / l.max_volume) * 100, 2)
      ELSE 0 END AS volume_occupancy_percent
  FROM levels l
  JOIN racks r ON r.id = l.rack_id
  JOIN zones z ON z.id = r.zone_id
  LEFT JOIN warehouses w ON w.id = z.warehouse_id
  LEFT JOIN bins b ON b.level_id = l.id ${activeOnly ? "AND b.active = TRUE" : ""}
`;

const runLevelList = async (req, res, next, rackId = null) => {
  try {
    const activeOnly = !isAdmin(req);
    const conditions = [];
    const values = [];

    if (rackId !== null) {
      values.push(rackId);
      conditions.push(`l.rack_id = $${values.length}`);
    }
    if (req.query.zone_id) {
      values.push(req.query.zone_id);
      conditions.push(`z.id = $${values.length}`);
    }

    if (!isAdmin(req)) {
      const warehouseId = req.auth?.warehouseId || 0;
      values.push(warehouseId);
      conditions.push(`z.warehouse_id = $${values.length}`);
    } else if (req.query.warehouse_id) {
      values.push(req.query.warehouse_id);
      conditions.push(`z.warehouse_id = $${values.length}`);
    }

    if (activeOnly) {
      conditions.push("l.active = TRUE");
      conditions.push("r.active = TRUE");
      conditions.push("z.active = TRUE");
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await db.query(
      `${levelSelect(activeOnly)}
       ${whereClause}
       GROUP BY l.id, r.id, z.id, w.id
       ORDER BY z.code, r.code, l.level_number`,
      values
    );
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

const getLevels = (req, res, next) => runLevelList(req, res, next);
const getLevelsByRack = (req, res, next) => runLevelList(req, res, next, req.params.rackId);

const getLevelById = async (req, res, next) => {
  try {
    const activeOnly = !isAdmin(req);
    const conditions = ["l.id = $1"];
    const values = [req.params.id];

    if (!isAdmin(req)) {
      const warehouseId = req.auth?.warehouseId || 0;
      values.push(warehouseId);
      conditions.push(`z.warehouse_id = $${values.length}`);
    }

    if (activeOnly) {
      conditions.push("l.active = TRUE");
      conditions.push("r.active = TRUE");
      conditions.push("z.active = TRUE");
    }

    const result = await db.query(
      `${levelSelect(activeOnly)}
       WHERE ${conditions.join(" AND ")}
       GROUP BY l.id, r.id, z.id, w.id`,
      values
    );
    if (result.rowCount === 0) throw buildError("Level not found.", 404);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

const readLevelFields = (body) => {
  const levelNumber = Number(body.level_number);
  if (!Number.isInteger(levelNumber) || levelNumber <= 0) {
    throw buildError("Level number must be a positive whole number.", 400);
  }
  const code = `L-${levelNumber}`;
  return { code, levelNumber };
};

const createLevel = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const rackId = req.body.rack_id;
    if (!rackId) throw buildError("Rack ID is required.", 400);
    const { code, levelNumber } = readLevelFields(req.body);
    const status = readConfigurationStatus(req.body.status);

    await client.query("BEGIN");
    const rackResult = await client.query(
      `SELECT r.*, z.code AS zone_code, z.active AS zone_active,
              w.warehouse_code, w.status AS warehouse_status
       FROM racks r JOIN zones z ON z.id=r.zone_id JOIN warehouses w ON w.id=z.warehouse_id
       WHERE r.id=$1`,
      [rackId]
    );
    if (!rackResult.rowCount) throw buildError("Rack not found.", 404);
    const rack = rackResult.rows[0];
    if (status === "Active" && (!rack.active || !rack.zone_active || rack.warehouse_status !== "active")) {
      throw buildError("Level cannot be active while its parent hierarchy is inactive.", 400);
    }
    const name = `${rack.warehouse_code}-${rack.zone_code}-${rack.code}-${code}`;
    const maxWeight = readPositiveNumber(req.body.max_weight_capacity ?? req.body.max_weight, "Level maximum weight");
    const maxVolume = readPositiveNumber(req.body.max_volume, "Level maximum volume", Number(rack.max_volume) || 1);
    ensureCapacityFitsParent({
      childWeight: maxWeight, childVolume: maxVolume,
      parentWeight: Number(rack.max_weight), parentVolume: Number(rack.max_volume),
      allowOverride: Boolean(req.body.allow_capacity_override), childLabel: "Level"
    });
    const thresholds = readThresholds(req.body);

    const duplicate = await client.query(
      "SELECT id FROM levels WHERE rack_id = $1 AND (UPPER(code) = $2 OR level_number = $3)",
      [rackId, code, levelNumber]
    );
    if (duplicate.rowCount > 0) {
      throw buildError(`Level ${code} already exists on the selected rack.`, 409);
    }

    const result = await client.query(
      `INSERT INTO levels (
         rack_id,code,name,level_number,max_weight,max_volume,status,active,
         occupancy_warning_threshold,full_threshold,created_by,updated_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       RETURNING *, id AS level_id, code AS level_code`,
      [
        rackId,
        code,
        name,
        levelNumber,
        maxWeight,
        maxVolume,
        status,
        status === "Active",
        thresholds.warning,
        thresholds.full,
        req.auth?.userId || null
      ]
    );

    await writeAuditLog({
      user_id: req.auth?.userId, action: "CREATE_LEVEL", module: "Warehouse Configuration",
      description: `Created level ${name}.`, metadata: { level_id: result.rows[0].id, rack_id: Number(rackId), code, name }
    }, client);
    await client.query("COMMIT");
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const updateLevel = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const rackId = req.body.rack_id;
    if (!rackId) throw buildError("Rack ID is required.", 400);
    const { code, levelNumber } = readLevelFields(req.body);

    await client.query("BEGIN");
    const existingResult = await client.query("SELECT * FROM levels WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!existingResult.rowCount) throw buildError("Level not found.", 404);
    const existing = existingResult.rows[0];
    const lifecycle = resolveLifecycleState({ status: req.body.status, existingStatus: existing.status });
    const rackResult = await client.query(
      `SELECT r.*, z.code AS zone_code, z.active AS zone_active,
              w.warehouse_code, w.status AS warehouse_status
       FROM racks r JOIN zones z ON z.id=r.zone_id JOIN warehouses w ON w.id=z.warehouse_id
       WHERE r.id=$1`,
      [rackId]
    );
    if (!rackResult.rowCount) throw buildError("Rack not found.", 404);
    const rack = rackResult.rows[0];
    if (existing.active && (!rack.active || !rack.zone_active || rack.warehouse_status !== "active")) {
      throw buildError("An active level cannot be moved beneath an inactive parent.", 400);
    }
    const name = `${rack.warehouse_code}-${rack.zone_code}-${rack.code}-${code}`;
    const maxWeight = readPositiveNumber(req.body.max_weight_capacity ?? req.body.max_weight, "Level maximum weight");
    const maxVolume = readPositiveNumber(req.body.max_volume, "Level maximum volume", Number(rack.max_volume) || 1);
    ensureCapacityFitsParent({
      childWeight: maxWeight, childVolume: maxVolume,
      parentWeight: Number(rack.max_weight), parentVolume: Number(rack.max_volume),
      allowOverride: Boolean(req.body.allow_capacity_override), childLabel: "Level"
    });
    const thresholds = readThresholds(req.body);

    const duplicate = await client.query(
      `SELECT id FROM levels
       WHERE rack_id = $1 AND (UPPER(code) = $2 OR level_number = $3) AND id <> $4`,
      [rackId, code, levelNumber, req.params.id]
    );
    if (duplicate.rowCount > 0) {
      throw buildError(`Level ${code} already exists on the selected rack.`, 409);
    }

    if (lifecycle.status === "Inactive") {
      await client.query("UPDATE bins SET active = FALSE, status = 'Inactive' WHERE level_id = $1", [req.params.id]);
    }

    const result = await client.query(
      `UPDATE levels
       SET rack_id=$1,code=$2,name=$3,level_number=$4,max_weight=$5,max_volume=$6,
           occupancy_warning_threshold=$7,full_threshold=$8,active=$9,status=$10,updated_by=$11
       WHERE id=$12
       RETURNING *, id AS level_id, code AS level_code`,
      [
        rackId,
        code,
        name,
        levelNumber,
        maxWeight,
        maxVolume,
        thresholds.warning,
        thresholds.full,
        lifecycle.active,
        lifecycle.status,
        req.auth?.userId || null,
        req.params.id
      ]
    );
    if (result.rowCount === 0) throw buildError("Level not found.", 404);

    await writeAuditLog({
      user_id: req.auth?.userId, action: "UPDATE_LEVEL", module: "Warehouse Configuration",
      description: `Updated level ${name}.`, metadata: { level_id: Number(req.params.id), code, name }
    }, client);
    await client.query("COMMIT");
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const updateLevelStatus = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const status = readConfigurationStatus(req.body.status);

    await client.query("BEGIN");
    const levelResult = await client.query(
      `SELECT l.*, r.active AS rack_active, z.active AS zone_active, w.status AS warehouse_status
       FROM levels l
       JOIN racks r ON r.id = l.rack_id
       JOIN zones z ON z.id = r.zone_id
       JOIN warehouses w ON w.id=z.warehouse_id
       WHERE l.id = $1 FOR UPDATE OF l`,
      [req.params.id]
    );
    if (levelResult.rowCount === 0) throw buildError("Level not found.", 404);
    const level = levelResult.rows[0];

    if (status === "Active" && (!level.rack_active || !level.zone_active || level.warehouse_status !== "active")) {
      throw buildError("Cannot activate a level beneath an inactive parent.", 400);
    }

    if (status === "Inactive") {
      await client.query("UPDATE bins SET active = FALSE, status = 'Inactive' WHERE level_id = $1", [req.params.id]);
    }

    const result = await client.query(
      "UPDATE levels SET active = $1, status = $2 WHERE id = $3 RETURNING *, id AS level_id, code AS level_code",
      [status === "Active", status, req.params.id]
    );
    const action = status === "Active" ? "ACTIVATE_LEVEL" : "DEACTIVATE_LEVEL";
    await writeAuditLog({
      user_id: req.auth?.userId, action, module: "Warehouse Configuration",
      description: `${status === "Active" ? "Activated" : "Deactivated"} level ${level.code}.`,
      metadata: { level_id: Number(req.params.id), status, reason: textValue(req.body.reason) }
    }, client);
    await client.query("COMMIT");
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const deleteLevel = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT * FROM levels WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!existing.rowCount) throw buildError("Level not found.", 404);
    if (await getEntityReferenceCount(client, "Level", req.params.id)) {
      throw buildError("Level has bins or historical links and cannot be deleted. Deactivate it instead.", 409);
    }
    await client.query("DELETE FROM capacity_configurations WHERE entity_type='Level' AND entity_id=$1", [req.params.id]);
    await client.query("DELETE FROM levels WHERE id=$1", [req.params.id]);
    await writeAuditLog({
      user_id: req.auth?.userId, action: "DELETE_LEVEL", module: "Warehouse Configuration",
      description: `Deleted unused level ${existing.rows[0].code}.`, metadata: { deleted_record: existing.rows[0] }
    }, client);
    await client.query("COMMIT");
    res.json({ success: true, message: "Level deleted." });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

module.exports = {
  getLevels,
  getLevelById,
  getLevelsByRack,
  createLevel,
  updateLevel,
  updateLevelStatus,
  deleteLevel
};

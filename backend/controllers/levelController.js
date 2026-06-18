const db = require("../config/db");
const { buildError } = require("../utils/apiError");

const LEVEL_CODE_PATTERN = /^L[1-9]\d*$/;

const textValue = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const capacityValue = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw buildError("Capacity values must be valid non-negative numbers.", 400);
  }
  return normalized;
};

const isAdmin = (req) => req.auth?.role === "system-admin";

const levelSelect = (activeOnly) => `
  SELECT
    l.id,
    l.id AS level_id,
    l.rack_id,
    l.code,
    l.code AS level_code,
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
    COALESCE(SUM(b.current_weight), 0)::numeric(12, 2) AS current_weight_capacity,
    COALESCE(SUM(b.current_volume), 0)::numeric(12, 2) AS current_volume_capacity,
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
  const code = textValue(body.level_code ?? body.code)?.toUpperCase();
  const levelNumber = Number(body.level_number);
  if (!code || !LEVEL_CODE_PATTERN.test(code)) {
    throw buildError("Level code must follow the format L1.", 400);
  }
  if (!Number.isInteger(levelNumber) || levelNumber <= 0) {
    throw buildError("Level number must be a positive whole number.", 400);
  }
  if (code !== `L${levelNumber}`) {
    throw buildError("Level code must match the level number, for example L2 and 2.", 400);
  }
  return { code, levelNumber };
};

const createLevel = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const rackId = req.body.rack_id;
    if (!rackId) throw buildError("Rack ID is required.", 400);
    const { code, levelNumber } = readLevelFields(req.body);

    await client.query("BEGIN");
    const rackResult = await client.query(
      `SELECT r.code, z.active AS zone_active
       FROM racks r JOIN zones z ON z.id = r.zone_id
       WHERE r.id = $1 AND r.active = TRUE`,
      [rackId]
    );
    if (rackResult.rowCount === 0 || !rackResult.rows[0].zone_active) {
      throw buildError("Rack not found or inactive.", 404);
    }

    const duplicate = await client.query(
      "SELECT id FROM levels WHERE rack_id = $1 AND (UPPER(code) = $2 OR level_number = $3)",
      [rackId, code, levelNumber]
    );
    if (duplicate.rowCount > 0) {
      throw buildError(`Level ${code} already exists on the selected rack.`, 409);
    }

    const result = await client.query(
      `INSERT INTO levels (rack_id, code, level_number, max_weight, max_volume, status, active)
       VALUES ($1, $2, $3, $4, $5, 'Active', TRUE)
       RETURNING *, id AS level_id, code AS level_code`,
      [
        rackId,
        code,
        levelNumber,
        capacityValue(req.body.max_weight, 2500),
        capacityValue(req.body.max_volume, 20)
      ]
    );

    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, 'CREATE_LEVEL', 'Warehouse Configuration', $2)`,
      [req.auth?.userId || null, `Created level ${code} on rack ${rackResult.rows[0].code}.`]
    );
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
    const rackResult = await client.query(
      `SELECT r.code, r.active, z.active AS zone_active
       FROM racks r JOIN zones z ON z.id = r.zone_id WHERE r.id = $1`,
      [rackId]
    );
    if (rackResult.rowCount === 0 || !rackResult.rows[0].active || !rackResult.rows[0].zone_active) {
      throw buildError("Rack not found or inactive.", 404);
    }

    const duplicate = await client.query(
      `SELECT id FROM levels
       WHERE rack_id = $1 AND (UPPER(code) = $2 OR level_number = $3) AND id <> $4`,
      [rackId, code, levelNumber, req.params.id]
    );
    if (duplicate.rowCount > 0) {
      throw buildError(`Level ${code} already exists on the selected rack.`, 409);
    }

    const result = await client.query(
      `UPDATE levels
       SET rack_id = $1, code = $2, level_number = $3, max_weight = $4, max_volume = $5
       WHERE id = $6
       RETURNING *, id AS level_id, code AS level_code`,
      [
        rackId,
        code,
        levelNumber,
        capacityValue(req.body.max_weight, 2500),
        capacityValue(req.body.max_volume, 20),
        req.params.id
      ]
    );
    if (result.rowCount === 0) throw buildError("Level not found.", 404);

    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, 'UPDATE_LEVEL', 'Warehouse Configuration', $2)`,
      [req.auth?.userId || null, `Updated level ${code}.`]
    );
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
    const status = textValue(req.body.status);
    if (!["Active", "Inactive"].includes(status)) {
      throw buildError("Level status must be Active or Inactive.", 400);
    }

    await client.query("BEGIN");
    const levelResult = await client.query(
      `SELECT l.*, r.active AS rack_active, z.active AS zone_active
       FROM levels l
       JOIN racks r ON r.id = l.rack_id
       JOIN zones z ON z.id = r.zone_id
       WHERE l.id = $1 FOR UPDATE OF l`,
      [req.params.id]
    );
    if (levelResult.rowCount === 0) throw buildError("Level not found.", 404);
    const level = levelResult.rows[0];

    if (status === "Active" && (!level.rack_active || !level.zone_active)) {
      throw buildError("Cannot activate a level beneath an inactive rack or zone.", 400);
    }

    if (status === "Inactive") {
      const cargoResult = await client.query(
        `SELECT 1
         FROM cargo c JOIN bins b ON b.id = c.current_bin_id
         WHERE b.level_id = $1
           AND c.is_deleted = FALSE
           AND c.placement_status IN ('Placed', 'Relocated')
         LIMIT 1`,
        [req.params.id]
      );
      if (cargoResult.rowCount > 0) {
        throw buildError("Cannot deactivate a level that contains active stored cargo.", 400);
      }
      await client.query("UPDATE bins SET active = FALSE, status = 'Inactive' WHERE level_id = $1", [req.params.id]);
    }

    const result = await client.query(
      "UPDATE levels SET active = $1, status = $2 WHERE id = $3 RETURNING *, id AS level_id, code AS level_code",
      [status === "Active", status, req.params.id]
    );
    const action = status === "Active" ? "ACTIVATE_LEVEL" : "DEACTIVATE_LEVEL";
    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, $2, 'Warehouse Configuration', $3)`,
      [req.auth?.userId || null, action, `${status === "Active" ? "Activated" : "Deactivated"} level ${level.code}.`]
    );
    await client.query("COMMIT");
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const deleteLevel = (req, res, next) => {
  req.body = { ...req.body, status: "Inactive" };
  return updateLevelStatus(req, res, next);
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

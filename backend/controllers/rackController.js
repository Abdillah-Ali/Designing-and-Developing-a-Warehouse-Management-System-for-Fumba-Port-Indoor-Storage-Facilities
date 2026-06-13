const db = require("../config/db");
const { buildError } = require("../utils/apiError");

const RACK_CODE_PATTERN = /^R-[A-Z]\d{2}$/;

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

const rackSelect = (activeOnly) => `
  SELECT
    r.id,
    r.id AS rack_id,
    r.zone_id,
    r.code,
    r.code AS rack_code,
    r.name,
    r.name AS rack_name,
    r.max_weight,
    r.max_volume,
    r.status,
    r.active,
    r.created_at,
    r.updated_at,
    z.code AS zone_code,
    z.name AS zone_name,
    COUNT(DISTINCT l.id)::int AS level_total,
    COUNT(b.id)::int AS bin_total,
    (COUNT(b.id) FILTER (WHERE b.status = 'Available' AND b.active = TRUE))::int AS available_bins,
    (COUNT(b.id) FILTER (WHERE b.status = 'Occupied' AND b.active = TRUE))::int AS occupied_bins,
    (COUNT(b.id) FILTER (WHERE b.status = 'Blocked' AND b.active = TRUE))::int AS blocked_bins,
    (COUNT(b.id) FILTER (WHERE b.status = 'Reserved' AND b.active = TRUE))::int AS reserved_bins,
    COALESCE(SUM(b.current_weight), 0)::numeric(12, 2) AS current_weight_capacity,
    COALESCE(SUM(b.current_volume), 0)::numeric(12, 2) AS current_volume_capacity,
    CASE WHEN r.max_weight > 0
      THEN ROUND((COALESCE(SUM(b.current_weight), 0) / r.max_weight) * 100, 2)
      ELSE 0 END AS weight_occupancy_percent,
    CASE WHEN r.max_volume > 0
      THEN ROUND((COALESCE(SUM(b.current_volume), 0) / r.max_volume) * 100, 2)
      ELSE 0 END AS volume_occupancy_percent
  FROM racks r
  JOIN zones z ON z.id = r.zone_id
  LEFT JOIN levels l ON l.rack_id = r.id ${activeOnly ? "AND l.active = TRUE" : ""}
  LEFT JOIN bins b ON b.level_id = l.id ${activeOnly ? "AND b.active = TRUE" : ""}
`;

const runRackList = async (req, res, next, zoneId = null) => {
  try {
    const activeOnly = !isAdmin(req);
    const conditions = [];
    const values = [];

    if (zoneId !== null) {
      values.push(zoneId);
      conditions.push(`r.zone_id = $${values.length}`);
    }
    if (activeOnly) {
      conditions.push("r.active = TRUE");
      conditions.push("z.active = TRUE");
    }

    const result = await db.query(
      `${rackSelect(activeOnly)}
       ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
       GROUP BY r.id, z.id
       ORDER BY z.code, r.code`,
      values
    );

    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

const getRacks = (req, res, next) => runRackList(req, res, next);
const getRacksByZone = (req, res, next) => runRackList(req, res, next, req.params.zoneId);

const getRackById = async (req, res, next) => {
  try {
    const activeOnly = !isAdmin(req);
    const result = await db.query(
      `${rackSelect(activeOnly)}
       WHERE r.id = $1 ${activeOnly ? "AND r.active = TRUE AND z.active = TRUE" : ""}
       GROUP BY r.id, z.id`,
      [req.params.id]
    );
    if (result.rowCount === 0) throw buildError("Rack not found.", 404);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

const validateRackHierarchy = (rackCode, zoneCode) => {
  if (!rackCode || !RACK_CODE_PATTERN.test(rackCode)) {
    throw buildError("Rack code must follow the format R-A01.", 400);
  }
  if (rackCode.charAt(2) !== zoneCode.charAt(2)) {
    throw buildError(`Rack code ${rackCode} does not match parent zone ${zoneCode}.`, 400);
  }
};

const createRack = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const zoneId = req.body.zone_id;
    const code = textValue(req.body.rack_code ?? req.body.code)?.toUpperCase();
    if (!zoneId) throw buildError("Zone ID is required.", 400);

    await client.query("BEGIN");
    const zoneResult = await client.query("SELECT code FROM zones WHERE id = $1 AND active = TRUE", [zoneId]);
    if (zoneResult.rowCount === 0) throw buildError("Zone not found or inactive.", 404);

    validateRackHierarchy(code, zoneResult.rows[0].code);

    const duplicate = await client.query(
      "SELECT id FROM racks WHERE zone_id = $1 AND UPPER(code) = $2",
      [zoneId, code]
    );
    if (duplicate.rowCount > 0) {
      throw buildError(`Rack ${code} already exists in the selected zone.`, 409);
    }

    const result = await client.query(
      `INSERT INTO racks (zone_id, code, name, max_weight, max_volume, status, active)
       VALUES ($1, $2, $3, $4, $5, 'Active', TRUE)
       RETURNING *, id AS rack_id, code AS rack_code`,
      [
        zoneId,
        code,
        textValue(req.body.name) || `Rack ${code}`,
        capacityValue(req.body.max_weight, 10000),
        capacityValue(req.body.max_volume, 80)
      ]
    );

    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, 'CREATE_RACK', 'Warehouse Configuration', $2)`,
      [req.auth?.userId || null, `Created rack ${code} in zone ${zoneResult.rows[0].code}.`]
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

const updateRack = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const zoneId = req.body.zone_id;
    const code = textValue(req.body.rack_code ?? req.body.code)?.toUpperCase();
    if (!zoneId) throw buildError("Zone ID is required.", 400);

    await client.query("BEGIN");
    const zoneResult = await client.query("SELECT code FROM zones WHERE id = $1 AND active = TRUE", [zoneId]);
    if (zoneResult.rowCount === 0) throw buildError("Zone not found or inactive.", 404);
    validateRackHierarchy(code, zoneResult.rows[0].code);

    const duplicate = await client.query(
      "SELECT id FROM racks WHERE zone_id = $1 AND UPPER(code) = $2 AND id <> $3",
      [zoneId, code, req.params.id]
    );
    if (duplicate.rowCount > 0) {
      throw buildError(`Rack ${code} already exists in the selected zone.`, 409);
    }

    const result = await client.query(
      `UPDATE racks
       SET zone_id = $1, code = $2, name = $3, max_weight = $4, max_volume = $5
       WHERE id = $6
       RETURNING *, id AS rack_id, code AS rack_code`,
      [
        zoneId,
        code,
        textValue(req.body.name) || `Rack ${code}`,
        capacityValue(req.body.max_weight, 10000),
        capacityValue(req.body.max_volume, 80),
        req.params.id
      ]
    );
    if (result.rowCount === 0) throw buildError("Rack not found.", 404);

    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, 'UPDATE_RACK', 'Warehouse Configuration', $2)`,
      [req.auth?.userId || null, `Updated rack ${code}.`]
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

const updateRackStatus = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const status = textValue(req.body.status);
    if (!["Active", "Inactive"].includes(status)) {
      throw buildError("Rack status must be Active or Inactive.", 400);
    }

    await client.query("BEGIN");
    const rackResult = await client.query(
      `SELECT r.*, z.active AS zone_active
       FROM racks r JOIN zones z ON z.id = r.zone_id
       WHERE r.id = $1 FOR UPDATE OF r`,
      [req.params.id]
    );
    if (rackResult.rowCount === 0) throw buildError("Rack not found.", 404);
    const rack = rackResult.rows[0];
    if (status === "Active" && !rack.zone_active) {
      throw buildError("Cannot activate a rack inside an inactive zone.", 400);
    }

    if (status === "Inactive") {
      const cargoResult = await client.query(
        `SELECT 1
         FROM cargo c
         JOIN bins b ON b.id = c.current_bin_id
         JOIN levels l ON l.id = b.level_id
         WHERE l.rack_id = $1
           AND c.is_deleted = FALSE
           AND c.placement_status IN ('Placed', 'Relocated')
         LIMIT 1`,
        [req.params.id]
      );
      if (cargoResult.rowCount > 0) {
        throw buildError("Cannot deactivate a rack that contains active stored cargo.", 400);
      }
      await client.query("UPDATE levels SET active = FALSE, status = 'Inactive' WHERE rack_id = $1", [req.params.id]);
      await client.query(
        "UPDATE bins SET active = FALSE, status = 'Inactive' WHERE level_id IN (SELECT id FROM levels WHERE rack_id = $1)",
        [req.params.id]
      );
    }

    const result = await client.query(
      "UPDATE racks SET active = $1, status = $2 WHERE id = $3 RETURNING *, id AS rack_id, code AS rack_code",
      [status === "Active", status, req.params.id]
    );
    const action = status === "Active" ? "ACTIVATE_RACK" : "DEACTIVATE_RACK";
    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, $2, 'Warehouse Configuration', $3)`,
      [req.auth?.userId || null, action, `${status === "Active" ? "Activated" : "Deactivated"} rack ${rack.code}.`]
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

const deleteRack = (req, res, next) => {
  req.body = { ...req.body, status: "Inactive" };
  return updateRackStatus(req, res, next);
};

module.exports = {
  getRacks,
  getRackById,
  getRacksByZone,
  createRack,
  updateRack,
  updateRackStatus,
  deleteRack
};

const db = require("../config/db");
const { buildError } = require("../utils/apiError");

const ZONE_CODE_PATTERN = /^Z-[A-Z]$/;

const textValue = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const numberValue = (value, fallback = 0) => {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw buildError("Capacity values must be valid non-negative numbers.", 400);
  }
  return normalized;
};

const isAdmin = (req) => req.auth?.role === "system-admin";

const zoneSelect = (activeOnly) => `
  SELECT
    z.id,
    z.id AS zone_id,
    z.warehouse_id,
    w.warehouse_name,
    w.warehouse_code,
    z.code,
    z.code AS zone_code,
    z.name,
    z.name AS zone_name,
    z.description,
    z.zone_type,
    z.allowed_cargo_type,
    z.is_hazard_zone,
    z.max_weight,
    z.max_volume,
    z.rack_count,
    z.level_count,
    z.bins_per_level,
    z.status,
    z.active,
    z.created_at,
    z.updated_at,
    COUNT(DISTINCT r.id)::int AS rack_total,
    COUNT(DISTINCT l.id)::int AS level_total,
    COUNT(b.id)::int AS bin_total,
    (COUNT(b.id) FILTER (WHERE b.status = 'Available' AND b.active = TRUE))::int AS available_bins,
    (COUNT(b.id) FILTER (WHERE b.status = 'Occupied' AND b.active = TRUE))::int AS occupied_bins,
    (COUNT(b.id) FILTER (WHERE b.status = 'Blocked' AND b.active = TRUE))::int AS blocked_bins,
    (COUNT(b.id) FILTER (WHERE b.status = 'Reserved' AND b.active = TRUE))::int AS reserved_bins,
    COALESCE(SUM(b.max_weight), 0)::numeric(14, 2) AS max_weight_capacity,
    COALESCE(SUM(b.max_volume), 0)::numeric(14, 2) AS max_volume_capacity,
    COALESCE(SUM(b.current_weight), 0)::numeric(14, 2) AS current_weight_capacity,
    COALESCE(SUM(b.current_volume), 0)::numeric(14, 2) AS current_volume_capacity,
    CASE
      WHEN COALESCE(SUM(b.max_weight), 0) > 0
      THEN ROUND((SUM(b.current_weight) / SUM(b.max_weight)) * 100, 2)
      ELSE 0
    END AS weight_occupancy_percent,
    CASE
      WHEN COALESCE(SUM(b.max_volume), 0) > 0
      THEN ROUND((SUM(b.current_volume) / SUM(b.max_volume)) * 100, 2)
      ELSE 0
    END AS volume_occupancy_percent
  FROM zones z
  LEFT JOIN warehouses w ON w.id = z.warehouse_id
  LEFT JOIN racks r ON r.zone_id = z.id ${activeOnly ? "AND r.active = TRUE" : ""}
  LEFT JOIN levels l ON l.rack_id = r.id ${activeOnly ? "AND l.active = TRUE" : ""}
  LEFT JOIN bins b ON b.level_id = l.id ${activeOnly ? "AND b.active = TRUE" : ""}
`;

const getZones = async (req, res, next) => {
  try {
    const activeOnly = !isAdmin(req);
    const conditions = [];
    const values = [];

    if (!isAdmin(req)) {
      const warehouseId = req.auth?.warehouseId || 0;
      values.push(warehouseId);
      conditions.push(`z.warehouse_id = $${values.length}`);
    } else if (req.query.warehouse_id) {
      values.push(req.query.warehouse_id);
      conditions.push(`z.warehouse_id = $${values.length}`);
    }

    if (activeOnly) {
      conditions.push("z.active = TRUE");
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await db.query(
      `${zoneSelect(activeOnly)}
       ${whereClause}
       GROUP BY z.id, w.id
       ORDER BY z.code`,
      values
    );

    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

const getZoneById = async (req, res, next) => {
  try {
    const activeOnly = !isAdmin(req);
    const conditions = ["z.id = $1"];
    const values = [req.params.id];

    if (!isAdmin(req)) {
      const warehouseId = req.auth?.warehouseId || 0;
      values.push(warehouseId);
      conditions.push(`z.warehouse_id = $${values.length}`);
    }

    if (activeOnly) {
      conditions.push("z.active = TRUE");
    }

    const result = await db.query(
      `${zoneSelect(activeOnly)}
       WHERE ${conditions.join(" AND ")}
       GROUP BY z.id, w.id`,
      values
    );

    if (result.rowCount === 0) throw buildError("Zone not found.", 404);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

const createZone = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const code = textValue(req.body.zone_code ?? req.body.code)?.toUpperCase();
    const name = textValue(req.body.zone_name ?? req.body.name);
    const allowedCargoType = textValue(req.body.allowed_cargo_type);
    const zoneType = textValue(req.body.zone_type) || "Standard";
    const status = textValue(req.body.status) || "Active";
    const warehouseId = req.body.warehouse_id;

    if (!code || !ZONE_CODE_PATTERN.test(code)) {
      throw buildError("Zone code must follow the format Z-A.", 400);
    }
    if (!name) throw buildError("Zone name is required.", 400);
    if (!allowedCargoType) throw buildError("Allowed cargo type is required.", 400);
    if (!["Active", "Inactive"].includes(status)) {
      throw buildError("Zone status must be Active or Inactive.", 400);
    }
    if (!warehouseId) {
      throw buildError("Warehouse ID is required.", 400);
    }

    await client.query("BEGIN");

    const warehouseCheck = await client.query("SELECT id FROM warehouses WHERE id = $1", [warehouseId]);
    if (warehouseCheck.rowCount === 0) {
      throw buildError("Selected warehouse was not found.", 404);
    }

    const duplicate = await client.query(
      "SELECT id FROM zones WHERE UPPER(code) = $1 AND warehouse_id = $2",
      [code, warehouseId]
    );
    if (duplicate.rowCount > 0) {
      throw buildError(`Zone with code ${code} already exists in this warehouse.`, 409);
    }

    const result = await client.query(
      `INSERT INTO zones (
        code, name, description, zone_type, allowed_cargo_type, is_hazard_zone,
        max_weight, max_volume, rack_count, level_count, bins_per_level, status, active, warehouse_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, 0, $9, $10, $11)
      RETURNING *, id AS zone_id, code AS zone_code, name AS zone_name`,
      [
        code,
        name,
        textValue(req.body.description),
        zoneType,
        allowedCargoType,
        isHazardZone,
        maxWeight,
        maxVolume,
        status,
        status === "Active",
        warehouseId
      ]
    );

    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, 'CREATE_ZONE', 'Warehouse Configuration', $2)`,
      [req.auth?.userId || null, `Created zone ${code} (${name}) in warehouse.`]
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

const updateZone = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const code = textValue(req.body.zone_code ?? req.body.code)?.toUpperCase();
    const name = textValue(req.body.zone_name ?? req.body.name);
    const allowedCargoType = textValue(req.body.allowed_cargo_type);

    if (!code || !ZONE_CODE_PATTERN.test(code)) {
      throw buildError("Zone code must follow the format Z-A.", 400);
    }
    if (!name) throw buildError("Zone name is required.", 400);
    if (!allowedCargoType) throw buildError("Allowed cargo type is required.", 400);

    const zoneType = textValue(req.body.zone_type) || "Standard";
    const maxWeight = numberValue(req.body.max_weight);
    const maxVolume = numberValue(req.body.max_volume);
    const isHazardZone = req.body.is_hazard_zone === true || zoneType.toLowerCase() === "hazardous";

    await client.query("BEGIN");

    const existingZoneResult = await client.query("SELECT warehouse_id FROM zones WHERE id = $1", [req.params.id]);
    if (existingZoneResult.rowCount === 0) {
      throw buildError("Zone not found.", 404);
    }
    const warehouseId = existingZoneResult.rows[0].warehouse_id;

    const duplicate = await client.query(
      "SELECT id FROM zones WHERE UPPER(code) = $1 AND warehouse_id = $2 AND id <> $3",
      [code, warehouseId, req.params.id]
    );
    if (duplicate.rowCount > 0) {
      throw buildError(`Zone with code ${code} already exists in this warehouse.`, 409);
    }

    const result = await client.query(
      `UPDATE zones
       SET code = $1,
           name = $2,
           description = $3,
           zone_type = $4,
           allowed_cargo_type = $5,
           is_hazard_zone = $6,
           max_weight = $7,
           max_volume = $8
       WHERE id = $9
       RETURNING *, id AS zone_id, code AS zone_code, name AS zone_name`,
      [
        code,
        name,
        textValue(req.body.description),
        zoneType,
        allowedCargoType,
        isHazardZone,
        maxWeight,
        maxVolume,
        req.params.id
      ]
    );

    if (result.rowCount === 0) throw buildError("Zone not found.", 404);

    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, 'UPDATE_ZONE', 'Warehouse Configuration', $2)`,
      [req.auth?.userId || null, `Updated zone ${code}.`]
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

const updateZoneStatus = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const status = textValue(req.body.status);
    if (!["Active", "Inactive"].includes(status)) {
      throw buildError("Zone status must be Active or Inactive.", 400);
    }

    await client.query("BEGIN");

    const zoneResult = await client.query("SELECT * FROM zones WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (zoneResult.rowCount === 0) throw buildError("Zone not found.", 404);
    const zone = zoneResult.rows[0];

    if (status === "Inactive") {
      const cargoResult = await client.query(
        `SELECT 1
         FROM cargo c
         JOIN bins b ON b.id = c.current_bin_id
         JOIN levels l ON l.id = b.level_id
         JOIN racks r ON r.id = l.rack_id
         WHERE r.zone_id = $1
           AND c.is_deleted = FALSE
           AND c.placement_status IN ('Placed', 'Relocated')
         LIMIT 1`,
        [req.params.id]
      );
      if (cargoResult.rowCount > 0) {
        throw buildError("Cannot deactivate a zone that contains active stored cargo.", 400);
      }

      await client.query("UPDATE racks SET active = FALSE, status = 'Inactive' WHERE zone_id = $1", [req.params.id]);
      await client.query(
        "UPDATE levels SET active = FALSE, status = 'Inactive' WHERE rack_id IN (SELECT id FROM racks WHERE zone_id = $1)",
        [req.params.id]
      );
      await client.query(
        `UPDATE bins
         SET active = FALSE, status = 'Inactive'
         WHERE level_id IN (
           SELECT l.id FROM levels l JOIN racks r ON r.id = l.rack_id WHERE r.zone_id = $1
         )`,
        [req.params.id]
      );
    }

    const result = await client.query(
      "UPDATE zones SET active = $1, status = $2 WHERE id = $3 RETURNING *, id AS zone_id, code AS zone_code, name AS zone_name",
      [status === "Active", status, req.params.id]
    );

    const action = status === "Active" ? "ACTIVATE_ZONE" : "DEACTIVATE_ZONE";
    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, $2, 'Warehouse Configuration', $3)`,
      [req.auth?.userId || null, action, `${status === "Active" ? "Activated" : "Deactivated"} zone ${zone.code}.`]
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

const deleteZone = (req, res, next) => {
  req.body = { ...req.body, status: "Inactive" };
  return updateZoneStatus(req, res, next);
};

module.exports = {
  getZones,
  getZoneById,
  createZone,
  updateZone,
  updateZoneStatus,
  deleteZone
};

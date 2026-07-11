const db = require("../config/db");
const { buildError } = require("../utils/apiError");
const { writeAuditLog } = require("../models/adminModel");
const {
  ensureCargoType,
  getEntityReferenceCount,
  readConfigurationStatus,
  readLetter,
  readPositiveNumber,
  readThresholds,
  resolveLifecycleState,
  textValue
} = require("../services/warehouseConfigurationService");

const booleanValue = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;

  throw buildError("is_hazard_zone must be true or false.", 400);
};

const isAdmin = (req) => req.auth?.role === "system-admin";

const zoneSelect = (activeOnly) => `
  SELECT
    z.id,
    z.id AS zone_id,
    z.warehouse_id,
    z.zone_letter,
    w.warehouse_name,
    w.warehouse_code,
    z.code,
    z.code AS zone_code,
    z.name,
    z.name AS zone_name,
    z.description,
    z.zone_type,
    z.allowed_cargo_type,
    z.allowed_cargo_type AS cargo_type_allowed,
    z.handling_condition,
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
    const letter = readLetter(
      req.body.zone_letter ?? String(req.body.zone_code ?? req.body.code ?? "").replace(/^Z-/i, ""),
      "Zone letter"
    );
    const code = `Z-${letter}`;
    const allowedCargoType = ensureCargoType(req.body.cargo_type_allowed ?? req.body.allowed_cargo_type);
    const zoneType = textValue(req.body.zone_type) || "Standard";
    const status = readConfigurationStatus(req.body.status);
    const warehouseId = req.body.warehouse_id;
    const defaultHazardZone = zoneType.toLowerCase() === "hazardous"
      || allowedCargoType?.toLowerCase() === "hazardous cargo";
    const isHazardZone = booleanValue(req.body.is_hazard_zone, defaultHazardZone);
    if (!warehouseId) {
      throw buildError("Warehouse ID is required.", 400);
    }

    await client.query("BEGIN");

    const warehouseCheck = await client.query(
      "SELECT id, warehouse_code, status, total_capacity, max_volume FROM warehouses WHERE id = $1",
      [warehouseId]
    );
    if (warehouseCheck.rowCount === 0) {
      throw buildError("Selected warehouse was not found.", 404);
    }
    const warehouse = warehouseCheck.rows[0];
    if (status === "Active" && warehouse.status !== "active") {
      throw buildError("Zone cannot be active while its warehouse is inactive.", 400);
    }
    const name = `${warehouse.warehouse_code}-Z-${letter}`;
    const maxWeight = readPositiveNumber(req.body.max_weight, "Zone maximum weight", Number(warehouse.total_capacity) || 1);
    const maxVolume = readPositiveNumber(req.body.max_volume, "Zone maximum volume", Number(warehouse.max_volume) || 1);
    const thresholds = readThresholds(req.body);

    const duplicate = await client.query(
      "SELECT id FROM zones WHERE warehouse_id = $1 AND (UPPER(code) = $2 OR UPPER(name) = $3)",
      [warehouseId, code, name]
    );
    if (duplicate.rowCount > 0) {
      throw buildError(`Zone with code ${code} already exists in this warehouse.`, 409);
    }

    const result = await client.query(
      `INSERT INTO zones (
        code, name, zone_letter, description, handling_condition, zone_type, allowed_cargo_type, is_hazard_zone,
        max_weight, max_volume, rack_count, level_count, bins_per_level, status, active, warehouse_id,
        occupancy_warning_threshold, full_threshold, created_by, updated_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,0,0,$11,$12,$13,$14,$15,$16,$16)
      RETURNING *, id AS zone_id, code AS zone_code, name AS zone_name`,
      [
        code,
        name,
        letter,
        textValue(req.body.description),
        textValue(req.body.handling_condition),
        zoneType,
        allowedCargoType,
        isHazardZone,
        maxWeight,
        maxVolume,
        status,
        status === "Active",
        warehouseId,
        thresholds.warning,
        thresholds.full,
        req.auth?.userId || null
      ]
    );

    await writeAuditLog({
      user_id: req.auth?.userId,
      action: "CREATE_ZONE",
      module: "Warehouse Configuration",
      description: `Created zone ${name}.`,
      metadata: { zone_id: result.rows[0].id, warehouse_id: Number(warehouseId), code, name }
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

const updateZone = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const letter = readLetter(
      req.body.zone_letter ?? String(req.body.zone_code ?? req.body.code ?? "").replace(/^Z-/i, ""),
      "Zone letter"
    );
    const code = `Z-${letter}`;
    const allowedCargoType = ensureCargoType(req.body.cargo_type_allowed ?? req.body.allowed_cargo_type);

    const zoneType = textValue(req.body.zone_type) || "Standard";
    const isHazardZone = booleanValue(
      req.body.is_hazard_zone,
      zoneType.toLowerCase() === "hazardous" || allowedCargoType.toLowerCase() === "hazardous cargo"
    );

    await client.query("BEGIN");

    const existingZoneResult = await client.query(
      `SELECT z.*, w.warehouse_code, w.total_capacity, w.max_volume AS warehouse_max_volume
       FROM zones z JOIN warehouses w ON w.id=z.warehouse_id WHERE z.id=$1`,
      [req.params.id]
    );
    if (existingZoneResult.rowCount === 0) {
      throw buildError("Zone not found.", 404);
    }
    const existing = existingZoneResult.rows[0];
    const lifecycle = resolveLifecycleState({ status: req.body.status, existingStatus: existing.status });
    const warehouseId = existing.warehouse_id;
    const name = `${existing.warehouse_code}-Z-${letter}`;
    const maxWeight = readPositiveNumber(req.body.max_weight, "Zone maximum weight", Number(existing.max_weight) || Number(existing.total_capacity) || 1);
    const maxVolume = readPositiveNumber(req.body.max_volume, "Zone maximum volume", Number(existing.max_volume) || Number(existing.warehouse_max_volume) || 1);
    const thresholds = readThresholds(req.body, existing);

    const duplicate = await client.query(
      `SELECT id FROM zones WHERE warehouse_id=$1
       AND (UPPER(code)=$2 OR UPPER(name)=$3) AND id<>$4`,
      [warehouseId, code, name, req.params.id]
    );
    if (duplicate.rowCount > 0) {
      throw buildError(`Zone with code ${code} already exists in this warehouse.`, 409);
    }

    if (lifecycle.status === "Inactive") {
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
      `UPDATE zones
       SET code = $1,
           name = $2,
           zone_letter = $3,
           description = $4,
           handling_condition = $5,
           zone_type = $6,
           allowed_cargo_type = $7,
           is_hazard_zone = $8,
           max_weight = $9,
           max_volume = $10,
           occupancy_warning_threshold=$11,
           full_threshold=$12,
           active=$13,
           status=$14,
           updated_by=$15
       WHERE id = $16
       RETURNING *, id AS zone_id, code AS zone_code, name AS zone_name`,
      [
        code,
        name,
        letter,
        textValue(req.body.description),
        textValue(req.body.handling_condition),
        zoneType,
        allowedCargoType,
        isHazardZone,
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

    if (result.rowCount === 0) throw buildError("Zone not found.", 404);

    await writeAuditLog({
      user_id: req.auth?.userId,
      action: "UPDATE_ZONE",
      module: "Warehouse Configuration",
      description: `Updated zone ${name}.`,
      metadata: { zone_id: Number(req.params.id), before: existing, code, name }
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

const updateZoneStatus = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const status = readConfigurationStatus(req.body.status);

    await client.query("BEGIN");

    const zoneResult = await client.query(
      `SELECT z.*, w.status AS warehouse_status FROM zones z
       JOIN warehouses w ON w.id=z.warehouse_id WHERE z.id=$1 FOR UPDATE OF z`,
      [req.params.id]
    );
    if (zoneResult.rowCount === 0) throw buildError("Zone not found.", 404);
    const zone = zoneResult.rows[0];

    if (status === "Active" && zone.warehouse_status !== "active") {
      throw buildError("Cannot activate a zone while its warehouse is inactive.", 400);
    }

    if (status === "Inactive") {
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
    await writeAuditLog({
      user_id: req.auth?.userId, action, module: "Warehouse Configuration",
      description: `${status === "Active" ? "Activated" : "Deactivated"} zone ${zone.code}.`,
      metadata: { zone_id: Number(req.params.id), status, reason: textValue(req.body.reason) }
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

const deleteZone = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT * FROM zones WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!existing.rowCount) throw buildError("Zone not found.", 404);
    if (await getEntityReferenceCount(client, "Zone", req.params.id)) {
      throw buildError("Zone has racks or historical links and cannot be deleted. Deactivate it instead.", 409);
    }
    await client.query("DELETE FROM capacity_configurations WHERE entity_type='Zone' AND entity_id=$1", [req.params.id]);
    await client.query("DELETE FROM zones WHERE id=$1", [req.params.id]);
    await writeAuditLog({
      user_id: req.auth?.userId, action: "DELETE_ZONE", module: "Warehouse Configuration",
      description: `Deleted unused zone ${existing.rows[0].code}.`,
      metadata: { deleted_record: existing.rows[0] }
    }, client);
    await client.query("COMMIT");
    res.json({ success: true, message: "Zone deleted." });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

module.exports = {
  getZones,
  getZoneById,
  createZone,
  updateZone,
  updateZoneStatus,
  deleteZone
};

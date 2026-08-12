const db = require("../config/db");
const { buildError } = require("../utils/apiError");
const { writeAuditLog } = require("../models/adminModel");
const {
  ensureCapacityFitsParent,
  getEntityReferenceCount,
  readConfigurationStatus,
  readLetter,
  readPositiveNumber,
  readThresholds,
  resolveLifecycleState,
  textValue
} = require("../services/warehouseConfigurationService");

const isAdmin = (req) => req.auth?.role === "system-admin";

const rackSelect = (activeOnly) => `
  SELECT
    r.id,
    r.id AS rack_id,
    r.zone_id,
    r.rack_letter,
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
    z.warehouse_id,
    w.warehouse_name,
    w.warehouse_code,
    COUNT(DISTINCT l.id)::int AS level_total,
    COUNT(b.id)::int AS bin_total,
    (COUNT(b.id) FILTER (WHERE b.status = 'Available' AND b.active = TRUE))::int AS available_bins,
    (COUNT(b.id) FILTER (WHERE b.status = 'Occupied' AND b.active = TRUE))::int AS occupied_bins,
    (COUNT(b.id) FILTER (WHERE b.status = 'Blocked' AND b.active = TRUE))::int AS blocked_bins,
    (COUNT(b.id) FILTER (WHERE b.status = 'Reserved' AND b.active = TRUE))::int AS reserved_bins,
    COALESCE(SUM(b.current_weight), 0)::numeric(18, 2) AS current_weight_capacity,
    COALESCE(SUM(b.current_volume), 0)::numeric(18, 2) AS current_volume_capacity,
    CASE WHEN r.max_weight > 0
      THEN ROUND((COALESCE(SUM(b.current_weight), 0) / r.max_weight) * 100, 2)
      ELSE 0 END AS weight_occupancy_percent,
    CASE WHEN r.max_volume > 0
      THEN ROUND((COALESCE(SUM(b.current_volume), 0) / r.max_volume) * 100, 2)
      ELSE 0 END AS volume_occupancy_percent
  FROM racks r
  JOIN zones z ON z.id = r.zone_id
  LEFT JOIN warehouses w ON w.id = z.warehouse_id
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

    if (!isAdmin(req)) {
      const warehouseId = req.auth?.warehouseId || 0;
      values.push(warehouseId);
      conditions.push(`z.warehouse_id = $${values.length}`);
    } else if (req.query.warehouse_id) {
      values.push(req.query.warehouse_id);
      conditions.push(`z.warehouse_id = $${values.length}`);
    }

    if (activeOnly) {
      conditions.push("r.active = TRUE");
      conditions.push("z.active = TRUE");
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await db.query(
      `${rackSelect(activeOnly)}
       ${whereClause}
       GROUP BY r.id, z.id, w.id
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
    const conditions = ["r.id = $1"];
    const values = [req.params.id];

    if (!isAdmin(req)) {
      const warehouseId = req.auth?.warehouseId || 0;
      values.push(warehouseId);
      conditions.push(`z.warehouse_id = $${values.length}`);
    }

    if (activeOnly) {
      conditions.push("r.active = TRUE");
      conditions.push("z.active = TRUE");
    }

    const result = await db.query(
      `${rackSelect(activeOnly)}
       WHERE ${conditions.join(" AND ")}
       GROUP BY r.id, z.id, w.id`,
      values
    );
    if (result.rowCount === 0) throw buildError("Rack not found.", 404);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

const createRack = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const zoneId = req.body.zone_id;
    const letter = readLetter(
      req.body.rack_letter ?? String(req.body.rack_code ?? req.body.code ?? "").replace(/^R-/i, ""),
      "Rack letter"
    );
    const code = `R-${letter}`;
    const status = readConfigurationStatus(req.body.status);
    if (!zoneId) throw buildError("Zone ID is required.", 400);

    await client.query("BEGIN");
    const zoneResult = await client.query(
      `SELECT z.*, w.warehouse_code, w.status AS warehouse_status
       FROM zones z JOIN warehouses w ON w.id=z.warehouse_id WHERE z.id=$1`,
      [zoneId]
    );
    if (!zoneResult.rowCount) throw buildError("Zone not found.", 404);
    const zone = zoneResult.rows[0];
    if (status === "Active" && (!zone.active || zone.warehouse_status !== "active")) {
      throw buildError("Rack cannot be active while its zone or warehouse is inactive.", 400);
    }
    const name = `${zone.warehouse_code}-${zone.code}-${code}`;
    const maxWeight = readPositiveNumber(req.body.max_weight_capacity ?? req.body.max_weight, "Rack maximum weight");
    const maxVolume = readPositiveNumber(req.body.max_volume, "Rack maximum volume", Number(zone.max_volume) || 1);
    ensureCapacityFitsParent({
      childWeight: maxWeight, childVolume: maxVolume,
      parentWeight: Number(zone.max_weight), parentVolume: Number(zone.max_volume),
      allowOverride: Boolean(req.body.allow_capacity_override), childLabel: "Rack"
    });
    const thresholds = readThresholds(req.body);

    const duplicate = await client.query(
      "SELECT id FROM racks WHERE zone_id=$1 AND (UPPER(code)=$2 OR UPPER(name)=$3)",
      [zoneId, code, name]
    );
    if (duplicate.rowCount > 0) {
      throw buildError(`Rack ${code} already exists in the selected zone.`, 409);
    }

    const result = await client.query(
      `INSERT INTO racks (
         zone_id, rack_letter, code, name, max_weight, max_volume, status, active,
         occupancy_warning_threshold, full_threshold, created_by, updated_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       RETURNING *, id AS rack_id, code AS rack_code`,
      [
        zoneId,
        letter,
        code,
        name,
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
      user_id: req.auth?.userId, action: "CREATE_RACK", module: "Warehouse Configuration",
      description: `Created rack ${name}.`, metadata: { rack_id: result.rows[0].id, zone_id: Number(zoneId), code, name }
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

const updateRack = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const zoneId = req.body.zone_id;
    const letter = readLetter(
      req.body.rack_letter ?? String(req.body.rack_code ?? req.body.code ?? "").replace(/^R-/i, ""),
      "Rack letter"
    );
    const code = `R-${letter}`;
    if (!zoneId) throw buildError("Zone ID is required.", 400);

    await client.query("BEGIN");
    const existingResult = await client.query("SELECT * FROM racks WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!existingResult.rowCount) throw buildError("Rack not found.", 404);
    const existing = existingResult.rows[0];
    const lifecycle = resolveLifecycleState({ status: req.body.status, existingStatus: existing.status });
    const zoneResult = await client.query(
      `SELECT z.*, w.warehouse_code, w.status AS warehouse_status
       FROM zones z JOIN warehouses w ON w.id=z.warehouse_id WHERE z.id=$1`,
      [zoneId]
    );
    if (!zoneResult.rowCount) throw buildError("Zone not found.", 404);
    const zone = zoneResult.rows[0];
    if (existing.active && (!zone.active || zone.warehouse_status !== "active")) {
      throw buildError("An active rack cannot be moved beneath an inactive parent.", 400);
    }
    const name = `${zone.warehouse_code}-${zone.code}-${code}`;
    const maxWeight = readPositiveNumber(req.body.max_weight_capacity ?? req.body.max_weight, "Rack maximum weight");
    const maxVolume = readPositiveNumber(req.body.max_volume, "Rack maximum volume", Number(zone.max_volume) || 1);
    ensureCapacityFitsParent({
      childWeight: maxWeight, childVolume: maxVolume,
      parentWeight: Number(zone.max_weight), parentVolume: Number(zone.max_volume),
      allowOverride: Boolean(req.body.allow_capacity_override), childLabel: "Rack"
    });
    const thresholds = readThresholds(req.body);

    const duplicate = await client.query(
      "SELECT id FROM racks WHERE zone_id=$1 AND (UPPER(code)=$2 OR UPPER(name)=$3) AND id<>$4",
      [zoneId, code, name, req.params.id]
    );
    if (duplicate.rowCount > 0) {
      throw buildError(`Rack ${code} already exists in the selected zone.`, 409);
    }

    if (lifecycle.status === "Inactive") {
      await client.query("UPDATE levels SET active = FALSE, status = 'Inactive' WHERE rack_id = $1", [req.params.id]);
      await client.query(
        "UPDATE bins SET active = FALSE, status = 'Inactive' WHERE level_id IN (SELECT id FROM levels WHERE rack_id = $1)",
        [req.params.id]
      );
    }

    const result = await client.query(
      `UPDATE racks
       SET zone_id=$1,rack_letter=$2,code=$3,name=$4,max_weight=$5,max_volume=$6,
           occupancy_warning_threshold=$7,full_threshold=$8,active=$9,status=$10,updated_by=$11
       WHERE id=$12
       RETURNING *, id AS rack_id, code AS rack_code`,
      [
        zoneId,
        letter,
        code,
        name,
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
    if (result.rowCount === 0) throw buildError("Rack not found.", 404);

    await writeAuditLog({
      user_id: req.auth?.userId, action: "UPDATE_RACK", module: "Warehouse Configuration",
      description: `Updated rack ${name}.`, metadata: { rack_id: Number(req.params.id), code, name }
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

const updateRackStatus = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const status = readConfigurationStatus(req.body.status);

    await client.query("BEGIN");
    const rackResult = await client.query(
      `SELECT r.*, z.active AS zone_active, w.status AS warehouse_status
       FROM racks r JOIN zones z ON z.id = r.zone_id JOIN warehouses w ON w.id=z.warehouse_id
       WHERE r.id = $1 FOR UPDATE OF r`,
      [req.params.id]
    );
    if (rackResult.rowCount === 0) throw buildError("Rack not found.", 404);
    const rack = rackResult.rows[0];
    if (status === "Active" && (!rack.zone_active || rack.warehouse_status !== "active")) {
      throw buildError("Cannot activate a rack inside an inactive zone or warehouse.", 400);
    }

    if (status === "Inactive") {
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
    await writeAuditLog({
      user_id: req.auth?.userId, action, module: "Warehouse Configuration",
      description: `${status === "Active" ? "Activated" : "Deactivated"} rack ${rack.code}.`,
      metadata: { rack_id: Number(req.params.id), status, reason: textValue(req.body.reason) }
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

const deleteRack = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT * FROM racks WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!existing.rowCount) throw buildError("Rack not found.", 404);
    if (await getEntityReferenceCount(client, "Rack", req.params.id)) {
      throw buildError("Rack has levels or historical links and cannot be deleted. Deactivate it instead.", 409);
    }
    await client.query("DELETE FROM capacity_configurations WHERE entity_type='Rack' AND entity_id=$1", [req.params.id]);
    await client.query("DELETE FROM racks WHERE id=$1", [req.params.id]);
    await writeAuditLog({
      user_id: req.auth?.userId, action: "DELETE_RACK", module: "Warehouse Configuration",
      description: `Deleted unused rack ${existing.rows[0].code}.`, metadata: { deleted_record: existing.rows[0] }
    }, client);
    await client.query("COMMIT");
    res.json({ success: true, message: "Rack deleted." });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
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

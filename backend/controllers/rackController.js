const db = require("../config/db");
const { buildError } = require("../utils/apiError");

const getRacksByZone = async (req, res, next) => {
  try {
    const searchId = req.params.zoneId;
    const conditions = [];
    const values = [];

    // Try numeric ID match
    if (/^\d+$/.test(searchId)) {
      conditions.push(`z.id = $${conditions.length + 1}`);
      values.push(Number(searchId));
    }

    // Try code match (case-insensitive)
    conditions.push(`z.code = UPPER($${conditions.length + 1})`);
    values.push(searchId);

    // Try code without Z- prefix
    conditions.push(`REPLACE(z.code, 'Z-', '') = UPPER($${conditions.length + 1})`);
    values.push(searchId);

    const result = await db.query(
      `SELECT
        r.*,
        r.id AS rack_id,
        r.code AS rack_code,
        r.name AS rack_name,
        z.id AS zone_id,
        z.code AS zone_code,
        z.name AS zone_name,
        COUNT(DISTINCT l.id)::int AS level_total,
        COUNT(b.id)::int AS bin_total,
        (COUNT(b.id) FILTER (WHERE b.status = 'Available'))::int AS available_bins,
        (COUNT(b.id) FILTER (WHERE b.status = 'Occupied'))::int AS occupied_bins,
        (COUNT(b.id) FILTER (WHERE b.status = 'Blocked'))::int AS blocked_bins,
        (COUNT(b.id) FILTER (WHERE b.status = 'Reserved'))::int AS reserved_bins,
        COALESCE(SUM(b.max_weight), 0)::numeric(12, 2) AS max_weight_capacity,
        COALESCE(SUM(b.max_volume), 0)::numeric(12, 2) AS max_volume_capacity,
        COALESCE(SUM(b.current_weight), 0)::numeric(12, 2) AS current_weight_capacity,
        COALESCE(SUM(b.current_volume), 0)::numeric(12, 2) AS current_volume_capacity,
        CASE
          WHEN COALESCE(SUM(b.max_weight), 0) > 0
          THEN ROUND((SUM(b.current_weight) / SUM(b.max_weight)) * 100, 2)
          ELSE NULL
        END AS weight_occupancy_percent,
        CASE
          WHEN COALESCE(SUM(b.max_volume), 0) > 0
          THEN ROUND((SUM(b.current_volume) / SUM(b.max_volume)) * 100, 2)
          ELSE NULL
        END AS volume_occupancy_percent
      FROM racks r
      JOIN zones z ON z.id = r.zone_id
      LEFT JOIN levels l ON l.rack_id = r.id AND l.active = true
      LEFT JOIN bins b ON b.level_id = l.id AND b.active = true
      WHERE (${conditions.join(" OR ")}) AND r.active = true AND z.active = true
      GROUP BY r.id, z.id
      ORDER BY r.code`,
      values
    );

    res.json({
      success: true,
      count: result.rowCount,
      data: result.rows
    });
  } catch (error) {
    next(error);
  }
};

const createRack = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const { zone_id, code, name, max_weight, max_volume } = req.body;

    if (!zone_id || !code) {
      throw buildError("Zone ID and rack code are required.", 400);
    }

    const normalizedCode = String(code).trim().toUpperCase();
    const weight = Number(max_weight || 10000);
    const volume = Number(max_volume || 80);

    await client.query("BEGIN");

    // Verify zone exists and is active
    const zoneRes = await client.query("SELECT code FROM zones WHERE id = $1 AND active = true", [zone_id]);
    if (zoneRes.rowCount === 0) {
      throw buildError("Zone not found or inactive.", 404);
    }

    // Check if rack code is taken and active
    const rackCheck = await client.query("SELECT id FROM racks WHERE code = $1 AND active = true", [normalizedCode]);
    if (rackCheck.rowCount > 0) {
      throw buildError(`Rack with code ${normalizedCode} already exists.`, 409);
    }

    const insertResult = await client.query(
      `INSERT INTO racks (zone_id, code, name, max_weight, max_volume, active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING *`,
      [zone_id, normalizedCode, name || `Rack ${normalizedCode}`, weight, volume]
    );

    const newRack = insertResult.rows[0];

    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, $2, $3, $4)`,
      [
        req.auth?.userId || null,
        "CREATE_RACK",
        "Warehouse Configuration",
        `Created rack ${normalizedCode} in zone ${zoneRes.rows[0].code}.`
      ]
    );

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      data: newRack
    });
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
    const { id } = req.params;
    const { name, max_weight, max_volume } = req.body;

    if (!name) {
      throw buildError("Rack name is required.", 400);
    }

    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE racks
       SET name = $1, max_weight = $2, max_volume = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND active = true
       RETURNING *`,
      [name, Number(max_weight || 10000), Number(max_volume || 80), id]
    );

    if (result.rowCount === 0) {
      throw buildError("Rack not found or inactive.", 404);
    }

    const rack = result.rows[0];

    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, $2, $3, $4)`,
      [
        req.auth?.userId || null,
        "UPDATE_RACK",
        "Warehouse Configuration",
        `Updated details for rack ${rack.code}.`
      ]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      data: rack
    });
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
    const { id } = req.params;

    await client.query("BEGIN");

    const rackRes = await client.query("SELECT code FROM racks WHERE id = $1 AND active = true", [id]);
    if (rackRes.rowCount === 0) {
      throw buildError("Rack not found or already deleted.", 404);
    }

    const rackCode = rackRes.rows[0].code;

    // Check if there is active cargo stored in this rack
    const cargoCheck = await client.query(
      `SELECT c.id FROM cargo c
       JOIN bins b ON b.id = c.current_bin_id
       JOIN levels l ON l.id = b.level_id
       WHERE l.rack_id = $1 AND c.status IN ('Stored', 'Blocked', 'Ready for Dispatch')`,
      [id]
    );

    if (cargoCheck.rowCount > 0) {
      throw buildError("Cannot delete rack because it contains stored cargo.", 400);
    }

    // Soft delete rack
    await client.query("UPDATE racks SET active = false WHERE id = $1", [id]);
    await client.query("UPDATE levels SET active = false WHERE rack_id = $1", [id]);
    await client.query(
      `UPDATE bins SET active = false WHERE level_id IN (SELECT id FROM levels WHERE rack_id = $1)`,
      [id]
    );

    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, $2, $3, $4)`,
      [
        req.auth?.userId || null,
        "DELETE_RACK",
        "Warehouse Configuration",
        `Soft deleted rack ${rackCode} and its underlying levels and bins.`
      ]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Rack ${rackCode} and its underlying levels and bins soft deleted successfully.`
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

module.exports = {
  getRacksByZone,
  createRack,
  updateRack,
  deleteRack
};

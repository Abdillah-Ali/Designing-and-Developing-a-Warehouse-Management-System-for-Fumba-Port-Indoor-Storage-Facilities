const db = require("../config/db");
const { buildError } = require("../utils/apiError");

const getLevelsByRack = async (req, res, next) => {
  try {
    const searchId = req.params.rackId;
    const conditions = [];
    const values = [];

    // Try numeric ID match
    if (/^\d+$/.test(searchId)) {
      conditions.push(`r.id = $${conditions.length + 1}`);
      values.push(Number(searchId));
    }

    // Try code match (case-insensitive)
    conditions.push(`r.code = UPPER($${conditions.length + 1})`);
    values.push(searchId);

    const result = await db.query(
      `SELECT
        l.*,
        l.id AS level_id,
        l.code AS level_code,
        r.id AS rack_id,
        r.code AS rack_code,
        z.id AS zone_id,
        z.code AS zone_code,
        z.name AS zone_name,
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
      FROM levels l
      JOIN racks r ON r.id = l.rack_id
      JOIN zones z ON z.id = r.zone_id
      LEFT JOIN bins b ON b.level_id = l.id AND b.active = true
      WHERE (${conditions.join(" OR ")}) AND l.active = true AND r.active = true AND z.active = true
      GROUP BY l.id, r.id, z.id
      ORDER BY l.level_number`,
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

const createLevel = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const { rack_id, code, level_number, max_weight, max_volume } = req.body;

    if (!rack_id || !code || !level_number) {
      throw buildError("Rack ID, level code, and level number are required.", 400);
    }

    const normalizedCode = String(code).trim().toUpperCase();
    const num = Number(level_number);
    const weight = Number(max_weight || 2500);
    const volume = Number(max_volume || 20);

    await client.query("BEGIN");

    // Verify rack exists and is active
    const rackRes = await client.query("SELECT code FROM racks WHERE id = $1 AND active = true", [rack_id]);
    if (rackRes.rowCount === 0) {
      throw buildError("Rack not found or inactive.", 404);
    }

    // Check if level code is taken on this rack and active
    const levelCheck = await client.query(
      "SELECT id FROM levels WHERE rack_id = $1 AND code = $2 AND active = true",
      [rack_id, normalizedCode]
    );
    if (levelCheck.rowCount > 0) {
      throw buildError(`Level with code ${normalizedCode} already exists on this rack.`, 409);
    }

    const insertResult = await client.query(
      `INSERT INTO levels (rack_id, code, level_number, max_weight, max_volume, active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING *`,
      [rack_id, normalizedCode, num, weight, volume]
    );

    const newLevel = insertResult.rows[0];

    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, $2, $3, $4)`,
      [
        req.auth?.userId || null,
        "CREATE_LEVEL",
        "Warehouse Configuration",
        `Created level ${normalizedCode} (number ${num}) on rack ${rackRes.rows[0].code}.`
      ]
    );

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      data: newLevel
    });
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
    const { id } = req.params;
    const { level_number, max_weight, max_volume } = req.body;

    if (!level_number) {
      throw buildError("Level number is required.", 400);
    }

    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE levels
       SET level_number = $1, max_weight = $2, max_volume = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND active = true
       RETURNING *`,
      [Number(level_number), Number(max_weight || 2500), Number(max_volume || 20), id]
    );

    if (result.rowCount === 0) {
      throw buildError("Level not found or inactive.", 404);
    }

    const level = result.rows[0];

    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, $2, $3, $4)`,
      [
        req.auth?.userId || null,
        "UPDATE_LEVEL",
        "Warehouse Configuration",
        `Updated details for level ${level.code}.`
      ]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      data: level
    });
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
    const { id } = req.params;

    await client.query("BEGIN");

    const levelRes = await client.query("SELECT code FROM levels WHERE id = $1 AND active = true", [id]);
    if (levelRes.rowCount === 0) {
      throw buildError("Level not found or already deleted.", 404);
    }

    const levelCode = levelRes.rows[0].code;

    // Check if there is active cargo stored in this level
    const cargoCheck = await client.query(
      `SELECT c.id FROM cargo c
       JOIN bins b ON b.id = c.current_bin_id
       WHERE b.level_id = $1 AND c.status IN ('Stored', 'Blocked', 'Ready for Dispatch')`,
      [id]
    );

    if (cargoCheck.rowCount > 0) {
      throw buildError("Cannot delete level because it contains stored cargo.", 400);
    }

    // Soft delete level and bins
    await client.query("UPDATE levels SET active = false WHERE id = $1", [id]);
    await client.query("UPDATE bins SET active = false WHERE level_id = $1", [id]);

    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, $2, $3, $4)`,
      [
        req.auth?.userId || null,
        "DELETE_LEVEL",
        "Warehouse Configuration",
        `Soft deleted level ${levelCode} and its underlying bins.`
      ]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Level ${levelCode} and its underlying bins soft deleted successfully.`
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

module.exports = {
  getLevelsByRack,
  createLevel,
  updateLevel,
  deleteLevel
};

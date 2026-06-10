const db = require("../config/db");
const { buildError } = require("../utils/apiError");

const getZones = async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT
        z.id,
        z.id AS zone_id,
        z.code,
        z.code AS zone_code,
        z.name,
        z.name AS zone_name,
        z.description,
        z.allowed_cargo_type,
        z.is_hazard_zone,
        z.rack_count,
        z.level_count,
        z.bins_per_level,
        COUNT(DISTINCT r.id)::int AS rack_total,
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
      FROM zones z
      LEFT JOIN racks r ON r.zone_id = z.id AND r.active = true
      LEFT JOIN levels l ON l.rack_id = r.id AND l.active = true
      LEFT JOIN bins b ON b.level_id = l.id AND b.active = true
      WHERE z.active = true
      GROUP BY z.id
      ORDER BY z.code`
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

const createZone = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const {
      code,
      name,
      description,
      allowed_cargo_type,
      is_hazard_zone,
      rack_count,
      level_count,
      bins_per_level
    } = req.body;

    if (!code || !name || !allowed_cargo_type) {
      throw buildError("Zone code, name, and allowed cargo type are required.", 400);
    }

    const normalizedCode = String(code).trim().toUpperCase();
    const numRacks = Number(rack_count || 1);
    const numLevels = Number(level_count || 1);
    const numBins = Number(bins_per_level || 1);

    await client.query("BEGIN");

    // Check if zone code already exists and is active
    const zoneCheck = await client.query(
      "SELECT id FROM zones WHERE code = $1 AND active = true",
      [normalizedCode]
    );
    if (zoneCheck.rowCount > 0) {
      throw buildError(`Zone with code ${normalizedCode} already exists.`, 409);
    }

    // Insert zone
    const zoneResult = await client.query(
      `INSERT INTO zones (code, name, description, allowed_cargo_type, is_hazard_zone, rack_count, level_count, bins_per_level, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
       RETURNING *`,
      [normalizedCode, name, description || null, allowed_cargo_type, !!is_hazard_zone, numRacks, numLevels, numBins]
    );

    const zone = zoneResult.rows[0];

    // Auto-generate racks, levels, bins
    for (let r = 1; r <= numRacks; r++) {
      const rackCode = `RACK-${normalizedCode}-${r}`;
      const rackName = `Rack ${r} of Zone ${normalizedCode}`;
      const rackResult = await client.query(
        `INSERT INTO racks (zone_id, code, name, max_weight, max_volume, active)
         VALUES ($1, $2, $3, 10000, 80, TRUE)
         RETURNING id`,
        [zone.id, rackCode, rackName]
      );
      const rackId = rackResult.rows[0].id;

      for (let l = 1; l <= numLevels; l++) {
        const levelCode = `LVL-${normalizedCode}-${r}-${l}`;
        const levelResult = await client.query(
          `INSERT INTO levels (rack_id, code, level_number, max_weight, max_volume, active)
           VALUES ($1, $2, $3, 2500, 20, TRUE)
           RETURNING id`,
          [rackId, levelCode, l]
        );
        const levelId = levelResult.rows[0].id;

        for (let b = 1; b <= numBins; b++) {
          const binCode = String(b);
          const binBarcode = `BIN-${normalizedCode}-${r}-${l}-${b}`;
          await client.query(
            `INSERT INTO bins (level_id, code, barcode, status, max_weight, max_volume, current_weight, current_volume, reserved_for_cargo_type, active)
             VALUES ($1, $2, $3, 'Available', 500, 4, 0, 0, NULL, TRUE)`,
            [levelId, binCode, binBarcode]
          );
        }
      }
    }

    // Write Audit Log
    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, $2, $3, $4)`,
      [
        req.auth?.userId || null,
        "CREATE_ZONE",
        "Warehouse Configuration",
        `Created zone ${normalizedCode} with ${numRacks} racks, ${numLevels} levels, and ${numBins} bins per level.`
      ]
    );

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      data: zone
    });
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
    const { id } = req.params;
    const { name, description, allowed_cargo_type, is_hazard_zone } = req.body;

    if (!name || !allowed_cargo_type) {
      throw buildError("Zone name and allowed cargo type are required.", 400);
    }

    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE zones
       SET name = $1, description = $2, allowed_cargo_type = $3, is_hazard_zone = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND active = true
       RETURNING *`,
      [name, description || null, allowed_cargo_type, !!is_hazard_zone, id]
    );

    if (result.rowCount === 0) {
      throw buildError("Zone not found or inactive.", 404);
    }

    const zone = result.rows[0];

    // Write Audit Log
    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, $2, $3, $4)`,
      [
        req.auth?.userId || null,
        "UPDATE_ZONE",
        "Warehouse Configuration",
        `Updated details for zone ${zone.code}.`
      ]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      data: zone
    });
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
    const { id } = req.params;

    await client.query("BEGIN");

    const zoneResult = await client.query(
      "SELECT code FROM zones WHERE id = $1 AND active = true",
      [id]
    );

    if (zoneResult.rowCount === 0) {
      throw buildError("Zone not found or already deleted.", 404);
    }

    const zoneCode = zoneResult.rows[0].code;

    // Check if there is active cargo stored in this zone
    const cargoCheck = await client.query(
      `SELECT c.id FROM cargo c
       JOIN bins b ON b.id = c.current_bin_id
       JOIN levels l ON l.id = b.level_id
       JOIN racks r ON r.id = l.rack_id
       WHERE r.zone_id = $1 AND c.status IN ('Stored', 'Blocked', 'Ready for Dispatch')`,
      [id]
    );

    if (cargoCheck.rowCount > 0) {
      throw buildError("Cannot delete zone because it contains stored cargo.", 400);
    }

    // Soft delete zone
    await client.query("UPDATE zones SET active = false WHERE id = $1", [id]);
    
    // Soft delete child entities
    await client.query("UPDATE racks SET active = false WHERE zone_id = $1", [id]);
    await client.query(
      `UPDATE levels SET active = false WHERE rack_id IN (SELECT id FROM racks WHERE zone_id = $1)`,
      [id]
    );
    await client.query(
      `UPDATE bins SET active = false WHERE level_id IN (
         SELECT l.id FROM levels l
         JOIN racks r ON r.id = l.rack_id
         WHERE r.zone_id = $1
       )`,
      [id]
    );

    // Write Audit Log
    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, $2, $3, $4)`,
      [
        req.auth?.userId || null,
        "DELETE_ZONE",
        "Warehouse Configuration",
        `Soft deleted zone ${zoneCode} and its underlying hierarchy.`
      ]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Zone ${zoneCode} and its underlying hierarchy soft deleted successfully.`
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

module.exports = {
  getZones,
  createZone,
  updateZone,
  deleteZone
};

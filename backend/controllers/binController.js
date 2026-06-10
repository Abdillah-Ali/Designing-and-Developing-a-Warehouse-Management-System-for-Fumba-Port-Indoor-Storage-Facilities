const db = require("../config/db");
const { buildError } = require("../utils/apiError");

const getBinsByLevel = async (req, res, next) => {
  try {
    const searchId = req.params.levelId;
    const conditions = [];
    const values = [];

    // Try numeric ID match
    if (/^\d+$/.test(searchId)) {
      conditions.push(`l.id = $${conditions.length + 1}`);
      values.push(Number(searchId));
    }

    // Try code match (case-insensitive)
    conditions.push(`l.code = UPPER($${conditions.length + 1})`);
    values.push(searchId);

    const result = await db.query(
      `SELECT
        b.*,
        b.id AS bin_id,
        b.code AS bin_code,
        b.barcode AS bin_barcode,
        l.id AS level_id,
        l.code AS level_code,
        r.id AS rack_id,
        r.code AS rack_code,
        z.id AS zone_id,
        z.code AS zone_code,
        z.name AS zone_name,
        CASE
          WHEN b.max_weight > 0
          THEN ROUND((b.current_weight / b.max_weight) * 100, 2)
          ELSE NULL
        END AS weight_occupancy_percent,
        CASE
          WHEN b.max_volume > 0
          THEN ROUND((b.current_volume / b.max_volume) * 100, 2)
          ELSE NULL
        END AS volume_occupancy_percent
      FROM bins b
      JOIN levels l ON l.id = b.level_id
      JOIN racks r ON r.id = l.rack_id
      JOIN zones z ON z.id = r.zone_id
      WHERE (${conditions.join(" OR ")}) AND b.active = true AND l.active = true AND r.active = true AND z.active = true
      ORDER BY b.code`,
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

const createBin = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const {
      level_id,
      code,
      barcode,
      status,
      max_weight,
      max_volume,
      reserved_for_cargo_type
    } = req.body;

    if (!level_id || !code || !barcode) {
      throw buildError("Level ID, bin code, and barcode are required.", 400);
    }

    const normalizedCode = String(code).trim();
    const normalizedBarcode = String(barcode).trim().toUpperCase();
    const binStatus = status || "Available";
    const weight = Number(max_weight || 500);
    const volume = Number(max_volume || 4);

    if (!["Available", "Reserved", "Blocked", "Occupied"].includes(binStatus)) {
      throw buildError("Invalid bin status.", 400);
    }

    await client.query("BEGIN");

    // Verify level exists and is active
    const levelRes = await client.query("SELECT code FROM levels WHERE id = $1 AND active = true", [level_id]);
    if (levelRes.rowCount === 0) {
      throw buildError("Level not found or inactive.", 404);
    }

    // Check if bin code is taken on this level and active
    const binCheck = await client.query(
      "SELECT id FROM bins WHERE level_id = $1 AND code = $2 AND active = true",
      [level_id, normalizedCode]
    );
    if (binCheck.rowCount > 0) {
      throw buildError(`Bin with code ${normalizedCode} already exists on this level.`, 409);
    }

    // Check if barcode is taken globally and active
    const barcodeCheck = await client.query(
      "SELECT id FROM bins WHERE barcode = $1 AND active = true",
      [normalizedBarcode]
    );
    if (barcodeCheck.rowCount > 0) {
      throw buildError(`Bin with barcode ${normalizedBarcode} already exists.`, 409);
    }

    const insertResult = await client.query(
      `INSERT INTO bins (level_id, code, barcode, status, max_weight, max_volume, current_weight, current_volume, reserved_for_cargo_type, active)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $7, TRUE)
       RETURNING *`,
      [level_id, normalizedCode, normalizedBarcode, binStatus, weight, volume, reserved_for_cargo_type || null]
    );

    const newBin = insertResult.rows[0];

    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, $2, $3, $4)`,
      [
        req.auth?.userId || null,
        "CREATE_BIN",
        "Warehouse Configuration",
        `Created bin ${normalizedBarcode} on level ${levelRes.rows[0].code}.`
      ]
    );

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      data: newBin
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const updateBin = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const { id } = req.params;
    const { status, max_weight, max_volume, reserved_for_cargo_type } = req.body;

    if (status && !["Available", "Reserved", "Blocked", "Occupied"].includes(status)) {
      throw buildError("Invalid bin status.", 400);
    }

    await client.query("BEGIN");

    // Verify bin exists and is active
    const binCheck = await client.query("SELECT barcode, status, current_weight FROM bins WHERE id = $1 AND active = true", [id]);
    if (binCheck.rowCount === 0) {
      throw buildError("Bin not found or inactive.", 404);
    }

    const binInfo = binCheck.rows[0];

    // If trying to change status to Available, check if it's currently occupied with cargo
    if (status === "Available" && binInfo.current_weight > 0) {
      throw buildError("Cannot make bin available while it still contains cargo.", 400);
    }

    const weight = max_weight !== undefined ? Number(max_weight) : undefined;
    const volume = max_volume !== undefined ? Number(max_volume) : undefined;

    const result = await client.query(
      `UPDATE bins
       SET status = COALESCE($1, status),
           max_weight = COALESCE($2, max_weight),
           max_volume = COALESCE($3, max_volume),
           reserved_for_cargo_type = $4,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND active = true
       RETURNING *`,
      [status || null, weight, volume, reserved_for_cargo_type === "" ? null : (reserved_for_cargo_type || null), id]
    );

    const bin = result.rows[0];

    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, $2, $3, $4)`,
      [
        req.auth?.userId || null,
        "UPDATE_BIN",
        "Warehouse Configuration",
        `Updated bin ${bin.barcode}: status=${bin.status}, reserved_for=${bin.reserved_for_cargo_type || 'None'}.`
      ]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      data: bin
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const deleteBin = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const { id } = req.params;

    await client.query("BEGIN");

    const binRes = await client.query("SELECT barcode FROM bins WHERE id = $1 AND active = true", [id]);
    if (binRes.rowCount === 0) {
      throw buildError("Bin not found or already deleted.", 404);
    }

    const binBarcode = binRes.rows[0].barcode;

    // Check if there is active cargo stored in this bin
    const cargoCheck = await client.query(
      `SELECT id FROM cargo WHERE current_bin_id = $1 AND status IN ('Stored', 'Blocked', 'Ready for Dispatch')`,
      [id]
    );

    if (cargoCheck.rowCount > 0) {
      throw buildError("Cannot delete bin because it contains stored cargo.", 400);
    }

    // Soft delete bin
    await client.query("UPDATE bins SET active = false WHERE id = $1", [id]);

    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, $2, $3, $4)`,
      [
        req.auth?.userId || null,
        "DELETE_BIN",
        "Warehouse Configuration",
        `Soft deleted bin ${binBarcode}.`
      ]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Bin ${binBarcode} soft deleted successfully.`
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

module.exports = {
  getBinsByLevel,
  createBin,
  updateBin,
  deleteBin
};

const db = require("../config/db");
const { generateCargoIdentifiers } = require("../utils/barcodeGenerator");
const {
  cargoFields,
  normalizeCargoPayload,
  validateCargoPayload
} = require("../services/validationService");
const { writeAuditLog } = require("../models/adminModel");

const buildError = (message, statusCode = 400, errors) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errors = errors;
  return error;
};

const cargoSelect = `
  SELECT
    c.*,
    b.id AS bin_id,
    b.code AS bin_code,
    b.barcode AS bin_barcode,
    b.status AS bin_status,
    b.max_weight AS bin_max_weight,
    b.max_volume AS bin_max_volume,
    b.current_weight AS bin_current_weight,
    b.current_volume AS bin_current_volume,
    (b.max_weight - b.current_weight) AS remaining_weight,
    (b.max_volume - b.current_volume) AS remaining_volume,
    l.id AS level_id,
    l.code AS level_code,
    l.level_number,
    r.id AS rack_id,
    r.code AS rack_code,
    z.id AS zone_id,
    z.code AS zone_code,
    z.name AS zone_name
  FROM cargo c
  LEFT JOIN bins b ON b.id = c.current_bin_id
  LEFT JOIN levels l ON l.id = b.level_id
  LEFT JOIN racks r ON r.id = l.rack_id
  LEFT JOIN zones z ON z.id = r.zone_id
`;

const getCargo = async (req, res, next) => {
  try {
    const filters = [];
    const values = [];

    if (req.query.status) {
      values.push(req.query.status);
      filters.push(`c.status = $${values.length}`);
    }

    if (req.query.cargo_type) {
      values.push(req.query.cargo_type);
      filters.push(`c.cargo_type = $${values.length}`);
    }

    if (req.query.search) {
      values.push(`%${req.query.search}%`);
      filters.push(`(
        c.cargo_id ILIKE $${values.length}
        OR c.barcode ILIKE $${values.length}
        OR c.consignee_name ILIKE $${values.length}
        OR c.company_name ILIKE $${values.length}
        OR c.container_number ILIKE $${values.length}
        OR c.vehicle_number ILIKE $${values.length}
      )`);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const result = await db.query(
      `${cargoSelect}
      ${whereClause}
      ORDER BY c.created_at DESC, c.id DESC`,
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

const getCargoById = async (req, res, next) => {
  try {
    // Build dynamic query to prevent type casting injection
    const searchId = req.params.id;
    const conditions = [];
    const values = [];

    // Try numeric ID match
    if (/^\d+$/.test(searchId)) {
      conditions.push(`c.id = $${conditions.length + 1}`);
      values.push(Number(searchId));
    }

    // Try cargo_id match
    conditions.push(`c.cargo_id = $${conditions.length + 1}`);
    values.push(searchId);

    // Try barcode match
    conditions.push(`c.barcode = $${conditions.length + 1}`);
    values.push(searchId);

    const result = await db.query(
      `${cargoSelect}
      WHERE ${conditions.join(" OR ")}
      LIMIT 1`,
      values
    );

    if (result.rowCount === 0) {
      throw buildError("Cargo record not found.", 404);
    }

    const cargo = result.rows[0];
    const movementResult = await db.query(
      `SELECT * FROM cargo_movements
      WHERE cargo_id = $1
      ORDER BY created_at DESC, id DESC`,
      [cargo.id]
    );

    res.json({
      success: true,
      data: {
        ...cargo,
        movement_history: movementResult.rows
      }
    });
  } catch (error) {
    next(error);
  }
};

const createCargo = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const errors = validateCargoPayload(req.body);
    if (errors.length) {
      throw buildError("Cargo validation failed.", 400, errors);
    }

    const payload = normalizeCargoPayload(req.body);

    await client.query("BEGIN");

    const sequenceResult = await client.query("SELECT nextval('cargo_number_seq') AS value");
    const identifiers = generateCargoIdentifiers(sequenceResult.rows[0].value);

    const columns = [
      "cargo_id",
      "barcode",
      "reference_number",
      ...cargoFields,
      "status",
      "location"
    ];
    const values = [
      identifiers.cargo_id,
      identifiers.barcode,
      identifiers.reference_number,
      ...cargoFields.map((field) => payload[field]),
      "Registered",
      null
    ];
    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");

    const insertResult = await client.query(
      `INSERT INTO cargo (${columns.join(", ")})
      VALUES (${placeholders})
      RETURNING *`,
      values
    );

    await client.query(
      `INSERT INTO cargo_movements (cargo_id, from_location, to_location, moved_by, action)
      VALUES ($1, $2, $3, $4, $5)`,
      [
        insertResult.rows[0].id,
        null,
        null,
        payload.received_by || "System",
        "Registered"
      ]
    );

    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action: "CREATE_CARGO",
        module: "Cargo Management",
        description: `Created cargo ${identifiers.cargo_id} with barcode ${identifiers.barcode}.`
      },
      client
    );

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      data: insertResult.rows[0]
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const updateCargo = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const updates = cargoFields.filter((field) =>
      Object.prototype.hasOwnProperty.call(req.body, field)
    );

    if (updates.length === 0) {
      throw buildError("No editable cargo fields were provided.", 400);
    }

    const payload = normalizeCargoPayload(req.body);
    const values = updates.map((field) => payload[field]);
    
    const searchId = req.params.id;
    const conditions = [];
    const paramIndex = values.length;

    // Try numeric ID match
    if (/^\d+$/.test(searchId)) {
      conditions.push(`id = $${paramIndex + 1}`);
      values.push(Number(searchId));
    }

    // Try cargo_id match
    conditions.push(`cargo_id = $${paramIndex + conditions.length + 1}`);
    values.push(searchId);

    // Try barcode match
    conditions.push(`barcode = $${paramIndex + conditions.length + 1}`);
    values.push(searchId);

    const setClause = updates
      .map((field, index) => `${field} = $${index + 1}`)
      .join(", ");

    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE cargo
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE ${conditions.join(" OR ")}
      RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      throw buildError("Cargo record not found.", 404);
    }

    const updatedCargo = result.rows[0];

    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action: "UPDATE_CARGO",
        module: "Cargo Management",
        description: `Updated cargo ${updatedCargo.cargo_id} (ID: ${updatedCargo.id}).`
      },
      client
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      data: updatedCargo
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const deleteCargo = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const searchId = req.params.id;
    const conditions = [];
    const values = [];

    // Try numeric ID match
    if (/^\d+$/.test(searchId)) {
      conditions.push(`id = $${conditions.length + 1}`);
      values.push(Number(searchId));
    }

    // Try cargo_id match
    conditions.push(`cargo_id = $${conditions.length + 1}`);
    values.push(searchId);

    // Try barcode match
    conditions.push(`barcode = $${conditions.length + 1}`);
    values.push(searchId);

    await client.query("BEGIN");

    const result = await client.query(
      `DELETE FROM cargo
      WHERE ${conditions.join(" OR ")}
      RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      throw buildError("Cargo record not found.", 404);
    }

    const deletedCargo = result.rows[0];

    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action: "DELETE_CARGO",
        module: "Cargo Management",
        description: `Deleted cargo ${deletedCargo.cargo_id} (ID: ${deletedCargo.id}).`
      },
      client
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      data: deletedCargo
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

module.exports = {
  getCargo,
  getCargoById,
  createCargo,
  updateCargo,
  deleteCargo
};

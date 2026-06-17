const db = require("../config/db");
const { buildError } = require("../utils/apiError");

const BIN_CODE_PATTERN = /^BIN-([A-Z]\d{2})-(L[1-9]\d*)-(\d{2})$/;
const BIN_STATUSES = ["Available", "Occupied", "Full", "Reserved", "Blocked", "Maintenance", "Inactive"];

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

const binSelect = `
  SELECT
    b.id,
    b.id AS bin_id,
    b.level_id,
    b.code,
    b.code AS bin_code,
    b.barcode,
    b.barcode AS bin_barcode,
    b.max_weight,
    b.max_weight AS capacity_weight,
    b.max_volume,
    b.max_volume AS capacity_volume,
    b.current_weight,
    b.current_volume,
    b.status,
    b.active,
    COALESCE(b.allowed_cargo_type, z.allowed_cargo_type) AS allowed_cargo_type,
    b.reserved_for_cargo_type,
    b.created_at,
    b.updated_at,
    l.code AS level_code,
    l.level_number,
    r.id AS rack_id,
    r.code AS rack_code,
    z.id AS zone_id,
    z.code AS zone_code,
    z.name AS zone_name,
    CASE WHEN b.max_weight > 0
      THEN ROUND((b.current_weight / b.max_weight) * 100, 2)
      ELSE 0 END AS weight_occupancy_percent,
    CASE WHEN b.max_volume > 0
      THEN ROUND((b.current_volume / b.max_volume) * 100, 2)
      ELSE 0 END AS volume_occupancy_percent
  FROM bins b
  JOIN levels l ON l.id = b.level_id
  JOIN racks r ON r.id = l.rack_id
  JOIN zones z ON z.id = r.zone_id
`;

const runBinList = async (req, res, next, levelId = null) => {
  try {
    const activeOnly = !isAdmin(req);
    const conditions = [];
    const values = [];

    const addFilter = (column, value) => {
      if (value === undefined || value === null || value === "") return;
      values.push(value);
      conditions.push(`${column} = $${values.length}`);
    };

    addFilter("b.level_id", levelId ?? req.query.level_id);
    addFilter("r.id", req.query.rack_id);
    addFilter("z.id", req.query.zone_id);
    addFilter("b.status", req.query.status);

    if (activeOnly) {
      conditions.push("b.active = TRUE");
      conditions.push("b.status <> 'Inactive'");
      conditions.push("l.active = TRUE");
      conditions.push("r.active = TRUE");
      conditions.push("z.active = TRUE");
    }

    const result = await db.query(
      `${binSelect}
       ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY z.code, r.code, l.level_number, b.code`,
      values
    );
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

const getBins = (req, res, next) => runBinList(req, res, next);
const getBinsByLevel = (req, res, next) => runBinList(req, res, next, req.params.levelId);

const getBinById = async (req, res, next) => {
  try {
    const activeOnly = !isAdmin(req);
    const result = await db.query(
      `${binSelect}
       WHERE b.id = $1 ${
         activeOnly
           ? "AND b.active = TRUE AND b.status <> 'Inactive' AND l.active = TRUE AND r.active = TRUE AND z.active = TRUE"
           : ""
       }`,
      [req.params.id]
    );
    if (result.rowCount === 0) throw buildError("Bin not found.", 404);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

const validateBinCode = (code, hierarchy) => {
  const match = BIN_CODE_PATTERN.exec(code || "");
  if (!match) {
    throw buildError("Bin code must follow the format BIN-A01-L2-03.", 400);
  }

  const expectedRackPart = hierarchy.rack_code.replace(/^R-/, "");
  if (match[1] !== expectedRackPart || match[2] !== hierarchy.level_code) {
    throw buildError(
      `Bin code must match rack ${hierarchy.rack_code} and level ${hierarchy.level_code}.`,
      400
    );
  }
};

const getActiveHierarchy = async (client, levelId) => {
  const result = await client.query(
    `SELECT
       l.code AS level_code,
       l.active AS level_active,
       r.code AS rack_code,
       r.active AS rack_active,
       z.active AS zone_active,
       z.allowed_cargo_type
     FROM levels l
     JOIN racks r ON r.id = l.rack_id
     JOIN zones z ON z.id = r.zone_id
     WHERE l.id = $1`,
    [levelId]
  );
  if (
    result.rowCount === 0
    || !result.rows[0].level_active
    || !result.rows[0].rack_active
    || !result.rows[0].zone_active
  ) {
    throw buildError("Level not found or inactive.", 404);
  }
  return result.rows[0];
};

const ensureBinUniqueness = async (client, code, barcode, excludeId = null) => {
  const values = [code, barcode];
  let exclude = "";
  if (excludeId !== null) {
    values.push(excludeId);
    exclude = "AND id <> $3";
  }
  const duplicate = await client.query(
    `SELECT code, barcode FROM bins
     WHERE (UPPER(code) = $1 OR UPPER(barcode) = $2) ${exclude}
     LIMIT 1`,
    values
  );
  if (duplicate.rowCount > 0) {
    throw buildError("Bin code and barcode must be unique.", 409);
  }
};

const createBin = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const levelId = req.body.level_id;
    const code = textValue(req.body.bin_code ?? req.body.code)?.toUpperCase();
    const barcode = textValue(req.body.barcode)?.toUpperCase() || code;
    const status = textValue(req.body.status) || "Available";

    if (!levelId || !code) {
      throw buildError("Level ID and bin code are required.", 400);
    }
    if (!BIN_STATUSES.includes(status) || status === "Inactive" || status === "Occupied") {
      throw buildError("New bins may be Available, Reserved, Blocked, or Maintenance.", 400);
    }

    await client.query("BEGIN");
    const hierarchy = await getActiveHierarchy(client, levelId);
    validateBinCode(code, hierarchy);
    await ensureBinUniqueness(client, code, barcode);

    const result = await client.query(
      `INSERT INTO bins (
        level_id, code, barcode, max_weight, max_volume, current_weight, current_volume,
        status, active, allowed_cargo_type, reserved_for_cargo_type
      )
      VALUES ($1, $2, $3, $4, $5, 0, 0, $6, TRUE, $7, $8)
      RETURNING *,
        id AS bin_id,
        code AS bin_code,
        max_weight AS capacity_weight,
        max_volume AS capacity_volume`,
      [
        levelId,
        code,
        barcode,
        capacityValue(req.body.capacity_weight ?? req.body.max_weight, 500),
        capacityValue(req.body.capacity_volume ?? req.body.max_volume, 4),
        status,
        textValue(req.body.allowed_cargo_type) || hierarchy.allowed_cargo_type,
        textValue(req.body.reserved_for_cargo_type)
      ]
    );

    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, 'CREATE_BIN', 'Warehouse Configuration', $2)`,
      [req.auth?.userId || null, `Created bin ${code} on ${hierarchy.rack_code} ${hierarchy.level_code}.`]
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

const updateBin = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const levelId = req.body.level_id;
    const code = textValue(req.body.bin_code ?? req.body.code)?.toUpperCase();
    const barcode = textValue(req.body.barcode)?.toUpperCase() || code;
    if (!levelId || !code) {
      throw buildError("Level ID and bin code are required.", 400);
    }

    await client.query("BEGIN");
    const hierarchy = await getActiveHierarchy(client, levelId);
    validateBinCode(code, hierarchy);
    await ensureBinUniqueness(client, code, barcode, req.params.id);

    const result = await client.query(
      `UPDATE bins
       SET level_id = $1,
           code = $2,
           barcode = $3,
           max_weight = $4,
           max_volume = $5,
           allowed_cargo_type = $6,
           reserved_for_cargo_type = $7
       WHERE id = $8
       RETURNING *,
         id AS bin_id,
         code AS bin_code,
         max_weight AS capacity_weight,
         max_volume AS capacity_volume`,
      [
        levelId,
        code,
        barcode,
        capacityValue(req.body.capacity_weight ?? req.body.max_weight, 500),
        capacityValue(req.body.capacity_volume ?? req.body.max_volume, 4),
        textValue(req.body.allowed_cargo_type) || hierarchy.allowed_cargo_type,
        textValue(req.body.reserved_for_cargo_type),
        req.params.id
      ]
    );
    if (result.rowCount === 0) throw buildError("Bin not found.", 404);

    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, 'UPDATE_BIN', 'Warehouse Configuration', $2)`,
      [req.auth?.userId || null, `Updated bin ${code}.`]
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

const updateBinStatus = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    let status = textValue(req.body.status);
    if (status === "Active") status = "Available";
    if (!BIN_STATUSES.includes(status)) {
      throw buildError(`Bin status must be one of: ${BIN_STATUSES.join(", ")}.`, 400);
    }

    await client.query("BEGIN");
    const binResult = await client.query(
      `SELECT b.*, l.active AS level_active, r.active AS rack_active, z.active AS zone_active
       FROM bins b
       JOIN levels l ON l.id = b.level_id
       JOIN racks r ON r.id = l.rack_id
       JOIN zones z ON z.id = r.zone_id
       WHERE b.id = $1 FOR UPDATE OF b`,
      [req.params.id]
    );
    if (binResult.rowCount === 0) throw buildError("Bin not found.", 404);
    const bin = binResult.rows[0];

    const cargoResult = await client.query(
      `SELECT 1 FROM cargo
       WHERE current_bin_id = $1
         AND is_deleted = FALSE
         AND placement_status IN ('Placed', 'Relocated')
       LIMIT 1`,
      [req.params.id]
    );
    const containsCargo = cargoResult.rowCount > 0 || Number(bin.current_weight) > 0 || Number(bin.current_volume) > 0;

    if (status === "Inactive" && containsCargo) {
      throw buildError("Cannot deactivate a bin that contains active stored cargo.", 400);
    }
    if (["Available", "Reserved"].includes(status) && containsCargo) {
      throw buildError(`Cannot mark a bin ${status.toLowerCase()} while it contains cargo.`, 400);
    }
    if (status === "Occupied" && !containsCargo) {
      throw buildError("A bin can only be marked Occupied by the cargo placement workflow.", 400);
    }
    if (status !== "Inactive" && (!bin.level_active || !bin.rack_active || !bin.zone_active)) {
      throw buildError("Cannot activate a bin beneath an inactive level, rack, or zone.", 400);
    }

    const active = status !== "Inactive";
    const reservedFor = status === "Reserved"
      ? textValue(req.body.reserved_for_cargo_type) || bin.reserved_for_cargo_type
      : null;
    const result = await client.query(
      `UPDATE bins
       SET status = $1, active = $2, reserved_for_cargo_type = $3
       WHERE id = $4
       RETURNING *,
         id AS bin_id,
         code AS bin_code,
         max_weight AS capacity_weight,
         max_volume AS capacity_volume`,
      [status, active, reservedFor, req.params.id]
    );

    const actions = {
      Available: "ACTIVATE_BIN",
      Reserved: "RESERVE_BIN",
      Blocked: "BLOCK_BIN",
      Maintenance: "SET_BIN_MAINTENANCE",
      Occupied: "UPDATE_BIN",
      Inactive: "DEACTIVATE_BIN"
    };
    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, $2, 'Warehouse Configuration', $3)`,
      [req.auth?.userId || null, actions[status], `Changed bin ${bin.code} status to ${status}.`]
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

const deleteBin = (req, res, next) => {
  req.body = { ...req.body, status: "Inactive" };
  return updateBinStatus(req, res, next);
};

const printBinBarcode = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const binResult = await client.query(
      `${binSelect} WHERE b.id = $1`,
      [req.params.id]
    );
    if (binResult.rowCount === 0) throw buildError("Bin not found.", 404);

    const previousPrint = await client.query(
      "SELECT 1 FROM bin_barcode_print_logs WHERE bin_id = $1 LIMIT 1",
      [req.params.id]
    );
    const printType = previousPrint.rowCount > 0 ? "REPRINT" : "PRINT";
    await client.query(
      `INSERT INTO bin_barcode_print_logs (bin_id, printed_by, print_type)
       VALUES ($1, $2, $3)`,
      [req.params.id, req.auth?.userId || null, printType]
    );
    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description, metadata)
       VALUES ($1, 'PRINT_BIN_BARCODE', 'Warehouse Configuration', $2, $3)`,
      [
        req.auth?.userId || null,
        `${printType === "REPRINT" ? "Reprinted" : "Printed"} barcode label for bin ${binResult.rows[0].barcode}.`,
        JSON.stringify({ bin_id: Number(req.params.id), print_type: printType })
      ]
    );
    await client.query("COMMIT");
    res.json({
      success: true,
      data: {
        ...binResult.rows[0],
        print_type: printType
      }
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

module.exports = {
  getBins,
  getBinById,
  getBinsByLevel,
  createBin,
  updateBin,
  updateBinStatus,
  printBinBarcode,
  deleteBin
};

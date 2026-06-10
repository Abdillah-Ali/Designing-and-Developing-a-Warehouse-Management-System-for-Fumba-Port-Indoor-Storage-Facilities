const db = require("../config/db");
const { validatePlacement: runPlacementValidation } = require("../services/validationService");

const buildError = (message, statusCode = 400, errors) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errors = errors;
  return error;
};

const readPlacementValue = (payload, keys) => {
  for (const key of keys) {
    const value = payload?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return null;
};

const writePlacementLog = (executor, validation, payload) => {
  return executor.query(
    `INSERT INTO placement_validation_logs
    (cargo_id, cargo_barcode, bin_id, bin_barcode, approved, reason, detail, checks)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      validation.cargo?.id || null,
      readPlacementValue(payload, ["cargo_barcode", "cargoBarcode", "scanned_cargo_barcode", "scannedCargoBarcode"]),
      validation.bin?.id || null,
      readPlacementValue(payload, ["bin_barcode", "binBarcode", "scanned_bin_barcode", "scannedBinBarcode"]),
      validation.approved,
      validation.reason,
      validation.detail,
      JSON.stringify(validation.checks || {})
    ]
  );
};

const validatePlacement = async (req, res, next) => {
  try {
    const validation = await runPlacementValidation(req.body);

    await writePlacementLog(db, validation, req.body);

    res.json({
      success: true,
      data: validation
    });
  } catch (error) {
    next(error);
  }
};

const confirmPlacement = async (req, res, next) => {
  let validation;

  try {
    validation = await runPlacementValidation(req.body);
  } catch (error) {
    return next(error);
  }

  if (!validation.approved) {
    try {
      await writePlacementLog(db, validation, req.body);
    } catch (error) {
      return next(error);
    }

    return next(buildError(validation.detail, 400, [validation.reason]));
  }

  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const cargoResult = await client.query(
      "SELECT * FROM cargo WHERE id = $1 FOR UPDATE",
      [validation.cargo.id]
    );

    const binResult = await client.query(
      `SELECT
        b.*,
        l.id AS level_id,
        l.code AS level_code,
        l.level_number,
        r.id AS rack_id,
        r.code AS rack_code,
        z.id AS zone_id,
        z.code AS zone_code,
        z.name AS zone_name,
        z.allowed_cargo_type,
        z.is_hazard_zone
      FROM bins b
      JOIN levels l ON l.id = b.level_id
      JOIN racks r ON r.id = l.rack_id
      JOIN zones z ON z.id = r.zone_id
      WHERE b.id = $1
      FOR UPDATE OF b`,
      [validation.bin.id]
    );

    if (cargoResult.rowCount === 0 || binResult.rowCount === 0) {
      throw buildError("Cargo or bin record was not found during placement confirmation.", 404);
    }

    const cargo = cargoResult.rows[0];
    const bin = binResult.rows[0];
    const cargoWeight = Number(cargo.weight || 0);
    const cargoVolume = Number(cargo.volume || 0);
    const remainingWeight = Number(bin.max_weight || 0) - Number(bin.current_weight || 0);
    const remainingVolume = Number(bin.max_volume || 0) - Number(bin.current_volume || 0);
    const alreadyPlacedInThisBin = Number(cargo.current_bin_id) === Number(bin.id);

    if (cargo.current_bin_id && !alreadyPlacedInThisBin) {
      throw buildError("Cargo is already placed in another bin. Move workflow is not enabled yet.", 409);
    }

    if (!alreadyPlacedInThisBin) {
      if (bin.status === "Blocked") {
        throw buildError("Selected storage bin is blocked for operations.", 400);
      }

      if (bin.status === "Reserved" && bin.reserved_for_cargo_type && bin.reserved_for_cargo_type !== cargo.cargo_type) {
        throw buildError("Selected storage bin is reserved for a different cargo type.", 400);
      }

      if (bin.allowed_cargo_type && bin.allowed_cargo_type !== cargo.cargo_type) {
        throw buildError(`${cargo.cargo_type} cannot be placed in ${bin.zone_code}.`, 400);
      }

      if (bin.is_hazard_zone && cargo.cargo_type !== "Hazardous Cargo") {
        throw buildError(`${cargo.cargo_type} cannot be placed in the hazardous cargo zone.`, 400);
      }

      if (cargo.cargo_type === "Hazardous Cargo" && !bin.is_hazard_zone) {
        throw buildError("Hazardous cargo must be placed in the hazardous cargo zone.", 400);
      }

      if (cargoWeight > remainingWeight || cargoVolume > remainingVolume) {
        throw buildError("Selected bin does not have enough remaining capacity.", 400);
      }
    }

    const updatedBinResult = alreadyPlacedInThisBin
      ? { rows: [bin] }
      : await client.query(
        `UPDATE bins
        SET
          current_weight = current_weight + $1,
          current_volume = current_volume + $2,
          status = 'Occupied',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING *`,
        [cargoWeight, cargoVolume, bin.id]
      );

    const updatedCargoResult = await client.query(
      `UPDATE cargo
      SET
        status = 'Stored',
        location = $1,
        current_bin_id = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *`,
      [bin.barcode, bin.id, cargo.id]
    );

    const movedBy = readPlacementValue(req.body, ["assigned_by", "assignedBy", "moved_by", "movedBy"]) || cargo.received_by || "Warehouse Staff";
    const movementResult = alreadyPlacedInThisBin
      ? { rows: [] }
      : await client.query(
        `INSERT INTO cargo_movements (cargo_id, from_location, to_location, moved_by, action)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *`,
        [cargo.id, cargo.location || null, bin.barcode, movedBy, "Stored"]
      );

    await writePlacementLog(client, validation, req.body);

    await client.query("COMMIT");

    const updatedCargo = updatedCargoResult.rows[0];
    const updatedBin = updatedBinResult.rows[0];
    const currentWeight = Number(updatedBin.current_weight || 0);
    const currentVolume = Number(updatedBin.current_volume || 0);

    res.json({
      success: true,
      data: {
        validation,
        cargo: {
          ...updatedCargo,
          bin_id: bin.id,
          bin_code: bin.code,
          bin_barcode: bin.barcode,
          bin_status: updatedBin.status,
          level_id: bin.level_id,
          level_code: bin.level_code,
          level_number: bin.level_number,
          rack_id: bin.rack_id,
          rack_code: bin.rack_code,
          zone_id: bin.zone_id,
          zone_code: bin.zone_code,
          zone_name: bin.zone_name,
          remaining_weight: Number(updatedBin.max_weight || 0) - currentWeight,
          remaining_volume: Number(updatedBin.max_volume || 0) - currentVolume
        },
        bin: {
          ...updatedBin,
          bin_id: updatedBin.id,
          bin_code: updatedBin.code,
          bin_barcode: updatedBin.barcode,
          level_id: bin.level_id,
          level_code: bin.level_code,
          level_number: bin.level_number,
          rack_id: bin.rack_id,
          rack_code: bin.rack_code,
          zone_id: bin.zone_id,
          zone_code: bin.zone_code,
          zone_name: bin.zone_name,
          remaining_weight: Number(updatedBin.max_weight || 0) - currentWeight,
          remaining_volume: Number(updatedBin.max_volume || 0) - currentVolume
        },
        movement: movementResult.rows[0] || null,
        alreadyPlaced: alreadyPlacedInThisBin
      }
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const getPlacementLogs = async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT
        pvl.*,
        c.cargo_id AS cargo_identifier,
        b.barcode AS bin_identifier
      FROM placement_validation_logs pvl
      LEFT JOIN cargo c ON c.id = pvl.cargo_id
      LEFT JOIN bins b ON b.id = pvl.bin_id
      ORDER BY pvl.created_at DESC, pvl.id DESC
      LIMIT 100`
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

module.exports = {
  confirmPlacement,
  validatePlacement,
  getPlacementLogs
};

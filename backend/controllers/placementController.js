const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { validatePlacement: runPlacementValidation } = require("../services/validationService");
const {
  CARGO_NOT_OPERATIONAL_MESSAGE,
  PLACEMENT_STATUS,
  REGISTRATION_STATUS
} = require("../services/cargoWorkflowService");
const {
  confirmPlacementOperation,
  getPlacementSettings: readPlacementSettings,
  recordPlacementAttempt,
  recordPlacementError,
  updatePlacementSettings: savePlacementSettings,
  validatePlacementOperation
} = require("../services/placementService");
const { writeAuditLog } = require("../models/adminModel");

const buildError = (message, statusCode = 400, errors) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errors = errors;
  return error;
};

const logPlacementError = async (req, stage, error) => {
  try {
    await recordPlacementError(db, {
      payload: req.body,
      auth: req.auth,
      stage,
      error
    });
  } catch (loggingError) {
    // Preserve the operational error even if its audit record cannot be written.
const readPlacementValue = (payload, keys) => {
  for (const key of keys) {
    const value = payload?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return null;
};

const validatePlacement = async (req, res, next) => {
  try {
    const { normalized, validation } = await validatePlacementOperation(req.body, req.auth);
    await recordPlacementAttempt(db, {
      normalized,
      validation,
      auth: req.auth,
      stage: "validation",
      previousLocation: validation.cargo?.location || null,
      newLocation: validation.bin?.display_location || null
    });
    res.json({ success: true, data: validation });
  } catch (error) {
    await logPlacementError(req, "validation", error);
    next(error);
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

const assertWarehouseCargoAccess = (req, validation) => {
  if (
    req.auth?.warehouseId
    && validation.cargo
    && Number(validation.cargo.warehouse_id) !== Number(req.auth.warehouseId)
  ) {
    throw buildError("Cargo record not found.", 404);
  }
};

const confirmPlacement = async (req, res, next) => {
const validatePlacement = async (req, res, next) => {
  try {
    const result = await confirmPlacementOperation(req.body, req.auth);
    if (result.rejected) {
      await recordPlacementAttempt(db, {
        normalized: result.normalized,
        validation: result.validation,
        auth: req.auth,
        stage: "confirmation",
        previousLocation: result.validation.cargo?.location || null,
        newLocation: result.validation.bin?.display_location || null
      });
      res.status(400).json({
        success: false,
        message: result.validation.detail,
        errors: [result.validation.reason]
      });
      return;
    }
    const validation = await runPlacementValidation(req.body);
    assertWarehouseCargoAccess(req, validation);

    await writePlacementLog(db, validation, req.body);
    await writeAuditLog({
      user_id: req.auth?.userId || null,
      action: validation.approved ? "VALIDATE_PLACEMENT" : "REJECT_PLACEMENT",
      module: "Cargo Management",
      description: `${validation.reason}: ${validation.detail}`,
      metadata: {
        cargo_barcode: readPlacementValue(req.body, ["cargo_barcode", "cargoBarcode"]),
        bin_barcode: readPlacementValue(req.body, ["bin_barcode", "binBarcode"]),
        approved: validation.approved
      }
    });

    res.json({
      success: true,
      message: result.alreadyPlaced
        ? "Cargo is already placed in this bin."
        : result.relocated
          ? "Cargo relocated successfully."
          : "Cargo placed successfully.",
      data: result
      data: validation
    });
  } catch (error) {
    await logPlacementError(req, "confirmation", error);
    next(error);
  }
};

const getPlacementSettings = async (req, res, next) => {
  try {
    res.json({ success: true, data: await readPlacementSettings() });
  } catch (error) {
    next(error);
const confirmPlacement = async (req, res, next) => {
  // Run initial validation once before opening a heavy transaction
  const validation = await runPlacementValidation(req.body);
  if (!validation.approved) {
    try {
      await writePlacementLog(db, validation, req.body);
      await writeAuditLog({
        user_id: req.auth?.userId || null,
        action: "REJECT_PLACEMENT",
        module: "Cargo Management",
        description: `${validation.reason}: ${validation.detail}`,
        metadata: {
          cargo_barcode: readPlacementValue(req.body, ["cargo_barcode", "cargoBarcode"]),
          bin_barcode: readPlacementValue(req.body, ["bin_barcode", "binBarcode"])
        }
      });
    } catch (error) {
      return next(error);
    }

    return next(buildError(validation.detail, 400, [validation.reason]));
  }
};

const updatePlacementSettings = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");
    const data = await savePlacementSettings(

    const cargoResult = await client.query(
      "SELECT * FROM cargo WHERE id = $1 AND is_deleted = FALSE FOR UPDATE",
      [validation.cargo.id]
    );

    const binResult = await client.query(
      `SELECT
        b.*,
        l.id AS level_id,
        l.code AS level_code,
        l.level_number,
        l.active AS level_active,
        r.id AS rack_id,
        r.code AS rack_code,
        r.active AS rack_active,
        z.id AS zone_id,
        z.code AS zone_code,
        z.name AS zone_name,
        z.allowed_cargo_type,
        z.is_hazard_zone,
        z.active AS zone_active
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

    // Re-verify validation inside transaction to ensure capacity didn't change
    const finalValidation = await runPlacementValidation(req.body, client);
    if (!finalValidation.approved) {
      await writePlacementLog(client, finalValidation, req.body);
      await writeAuditLog(
        {
          user_id: req.auth?.userId || null,
          action: "REJECT_PLACEMENT",
          module: "Cargo Management",
          description: `${validation.reason}: ${validation.detail}`,
          metadata: {
            cargo_barcode: readPlacementValue(req.body, ["cargo_barcode", "cargoBarcode"]),
            bin_barcode: readPlacementValue(req.body, ["bin_barcode", "binBarcode"])
          }
        },
        client
      );
      throw buildError(finalValidation.detail, 400, [finalValidation.reason]);
    }

    const cargo = cargoResult.rows[0];
    const bin = binResult.rows[0];
    const cargoWeight = Number(cargo.weight || 0);
    const cargoVolume = Number(cargo.volume || 0);
    const alreadyPlacedInThisBin = Number(cargo.current_bin_id) === Number(bin.id);
    const isRelocation = Boolean(cargo.current_bin_id) && !alreadyPlacedInThisBin;

    let previousBin = null;
    if (isRelocation) {
      const previousBinResult = await client.query(
        "SELECT * FROM bins WHERE id = $1 FOR UPDATE",
        [cargo.current_bin_id]
      );
      previousBin = previousBinResult.rows[0] || null;

      if (previousBin) {
        await client.query(
          `UPDATE bins
           SET current_weight = GREATEST(0, current_weight - $1),
               current_volume = GREATEST(0, current_volume - $2),
               status = CASE
                 WHEN status IN ('Blocked', 'Reserved', 'Inactive') THEN status
                 WHEN GREATEST(0, current_weight - $1) = 0
                  AND GREATEST(0, current_volume - $2) = 0
                   THEN 'Available'
                 ELSE 'Occupied'
               END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [cargoWeight, cargoVolume, previousBin.id]
        );
      }
    }

    const updatedBinResult = alreadyPlacedInThisBin
      ? { rows: [bin] }
      : await client.query(
        `UPDATE bins
        SET
          current_weight = current_weight + $1,
          current_volume = current_volume + $2,
          status = CASE
            WHEN current_weight + $1 >= max_weight OR current_volume + $2 >= max_volume
              THEN 'Full'
            ELSE 'Occupied'
          END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING *`,
        [cargoWeight, cargoVolume, bin.id]
      );

    const updatedCargoResult = await client.query(
      `UPDATE cargo
      SET
        placement_status = $1,
        location = $2,
        current_bin_id = $3,
        relocation_required = FALSE,
        relocation_reason = NULL,
        relocation_flagged_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *`,
      [
        isRelocation ? PLACEMENT_STATUS.RELOCATED : PLACEMENT_STATUS.PLACED,
        bin.barcode,
        bin.id,
        cargo.id
      ]
    );

    const movedBy = readPlacementValue(req.body, ["assigned_by", "assignedBy", "moved_by", "movedBy"]) || cargo.received_by || "Warehouse Staff";
    const movementResult = alreadyPlacedInThisBin
      ? { rows: [] }
      : await client.query(
        `INSERT INTO cargo_movements (cargo_id, from_location, to_location, moved_by, action)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *`,
        [
          cargo.id,
          cargo.location || null,
          bin.barcode,
          movedBy,
          isRelocation ? "Relocated" : "Placed"
        ]
      );

    if (!alreadyPlacedInThisBin) {
      await client.query(
        `UPDATE cargo_locations
         SET is_current = FALSE, released_at = CURRENT_TIMESTAMP
         WHERE cargo_id = $1 AND is_current = TRUE`,
        [cargo.id]
      );
      await client.query(
        `INSERT INTO cargo_locations
         (cargo_id, bin_id, location, is_current, assigned_by)
         VALUES ($1, $2, $3, TRUE, $4)`,
        [cargo.id, bin.id, bin.barcode, req.auth?.userId || null]
      );
    }

    await writePlacementLog(client, validation, req.body);
    await writeAuditLog(
      {
        enabled: req.body.manual_placement_enabled,
        userId: req.auth?.userId || null
        user_id: req.auth?.userId || null,
        action: isRelocation ? "CONFIRM_CARGO_RELOCATION" : "CONFIRM_CARGO_PLACEMENT",
        module: "Cargo Management",
        description: `${isRelocation ? "Relocated" : "Placed"} cargo ${cargo.cargo_id} in bin ${bin.barcode}.`,
        metadata: {
          cargo_id: cargo.id,
          bin_id: bin.id,
          previous_bin_id: previousBin?.id || null,
          approval_request_id: validation.approval?.id || null
        }
      },
      client
    );

    await client.query("COMMIT");
    res.json({ success: true, data });

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
        alreadyPlaced: alreadyPlacedInThisBin,
        relocated: isRelocation
      }
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const requestPlacementOverride = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");
    const { normalized, validation } = await validatePlacementOperation(
      req.body,
      req.auth,
      client
    );
    const validation = await runPlacementValidation(req.body);
    assertWarehouseCargoAccess(req, validation);
    if (validation.approved) {
      throw buildError("This placement already passes validation and does not require an override.", 400);
    }
    if (!validation.cargo || !validation.bin) {
      throw buildError("A registered cargo and known bin are required before requesting an override.", 400);
    }
    const failedChecks = Object.entries(validation.checks || {})
      .filter(([, check]) => check?.passed === false)
      .map(([checkName]) => checkName);
    if (
      failedChecks.length !== 1
      || failedChecks[0] !== "restrictedZone"
    ) {
      throw buildError(
        "Supervisor overrides are limited to restricted-zone authorization. Safety, capacity, compatibility, and bin-status failures cannot be overridden.",
        400
      );
    }
    if (
      validation.cargo.registration_status === REGISTRATION_STATUS.REJECTED
      || validation.cargo.placement_status === PLACEMENT_STATUS.DISPATCHED
    ) {
      throw buildError(CARGO_NOT_OPERATIONAL_MESSAGE, 409);
    }

    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT id
       FROM approval_requests
       WHERE cargo_id = $1
         AND request_type = 'PLACEMENT_OVERRIDE'
         AND status = 'Pending'
         AND request_data->>'bin_id' = $2
       LIMIT 1`,
      [validation.cargo.id, String(validation.bin.id)]
    );
    if (existing.rowCount > 0) {
      throw buildError("A placement override request is already pending for this cargo and bin.", 409);
    }

    const reason = String(req.body.reason || validation.detail).trim();
    const result = await client.query(
      `INSERT INTO approval_requests
       (request_type, cargo_id, requested_by, reason, status, request_data)
       VALUES ('PLACEMENT_OVERRIDE', $1, $2, $3, 'Pending', $4)
       RETURNING *`,
      [
        validation.cargo.id,
        req.auth?.userId || null,
        reason,
        JSON.stringify({
          bin_id: validation.bin.id,
          bin_barcode: validation.bin.barcode,
          placement_mode: normalized.placement_mode,
          manual_reason: normalized.manual_placement_reason,
          validation_reason: validation.reason,
          validation_detail: validation.detail,
          checks: validation.checks
        })
      ]
    );

    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action: "REQUEST_PLACEMENT_OVERRIDE",
        module: "Cargo Placement",
        module: "Cargo Management",
        description: `Requested placement override for cargo ${validation.cargo.cargo_id} and bin ${validation.bin.barcode}.`,
        metadata: {
          approval_request_id: result.rows[0].id,
          placement_mode: normalized.placement_mode,
          manual_reason: normalized.manual_placement_reason
        }
        metadata: { approval_request_id: result.rows[0].id }
      },
      client
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

const getPlacementFailures = async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT pvl.*, c.cargo_id AS cargo_identifier, b.barcode AS bin_identifier
       FROM placement_validation_logs pvl
       LEFT JOIN cargo c ON c.id = pvl.cargo_id
       LEFT JOIN bins b ON b.id = pvl.bin_id
       WHERE pvl.approved = FALSE
       ORDER BY pvl.created_at DESC, pvl.id DESC
       LIMIT 200`
    );
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
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
  getPlacementLogs,
  getPlacementFailures,
  getPlacementLogs,
  getPlacementSettings,
  requestPlacementOverride,
  updatePlacementSettings,
  validatePlacement
  requestPlacementOverride
};

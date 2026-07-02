const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
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
const {
  getPlacementActivity: readPlacementActivity,
  getPlacementActivitySummary: readPlacementActivitySummary
} = require("../services/placementActivityService");
const {
  notifyPlacementOverridePending,
  notifyWarehouseAlert
} = require("../services/notificationService");
const { buildError } = require("../utils/apiError");

const logPlacementError = async (req, stage, error) => {
  try {
    await recordPlacementError(db, {
      payload: req.body,
      auth: req.auth,
      stage,
      error
    });
  } catch {
    // Preserve the operational error even if its audit record cannot be written.
  }
};

const readBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return value;
};

const getWarehouseAlertFromValidation = (validation) => {
  if (validation?.approved || !validation?.cargo || !validation?.bin) return null;

  const checks = validation.checks || {};
  const binLabel = validation.bin.barcode || "Selected bin";
  const cargoType = validation.cargo.cargo_type || "cargo";

  if (checks.availableBin?.passed === false || checks.weightCapacity?.passed === false || checks.volumeCapacity?.passed === false) {
    return {
      title: `${binLabel} cannot accept more cargo`,
      message: checks.availableBin?.passed === false
        ? `Bin ${binLabel} is full.`
        : `Bin ${binLabel} does not have enough capacity for ${cargoType}.`,
      priority: "urgent"
    };
  }

  if (checks.blockedBin?.passed === false) {
    return {
      title: `${binLabel} is blocked`,
      message: `Bin ${binLabel} is blocked for operations.`,
      priority: "high"
    };
  }

  if (checks.maintenanceBin?.passed === false) {
    return {
      title: `${binLabel} is under maintenance`,
      message: `Bin ${binLabel} is under maintenance.`,
      priority: "high"
    };
  }

  if (checks.cargoCompatibility?.passed === false) {
    return {
      title: `No compatible placement for ${cargoType}`,
      message: validation.detail || `No compatible bin is available for ${cargoType}.`,
      priority: "high"
    };
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

    const alert = getWarehouseAlertFromValidation(validation);
    if (alert) {
      await notifyWarehouseAlert(
        {
          ...alert,
          warehouseId: validation.cargo?.warehouse_id || req.auth?.warehouseId || null,
          relatedEntityType: validation.cargo?.id ? "cargo" : "bin",
          relatedEntityId: validation.cargo?.id || validation.bin?.id || null,
          actorId: req.auth?.userId || null,
          metadata: {
            cargo_id: validation.cargo?.id || null,
            cargo_identifier: validation.cargo?.cargo_id || null,
            cargo_type: validation.cargo?.cargo_type || null,
            bin_id: validation.bin?.id || null,
            bin_barcode: validation.bin?.barcode || null,
            validation_reason: validation.reason
          }
        },
        db
      );
    }

    res.json({ success: true, data: validation });
  } catch (error) {
    await logPlacementError(req, "validation", error);
    next(error);
  }
};

const confirmPlacement = async (req, res, next) => {
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

    res.json({
      success: true,
      message: result.alreadyPlaced
        ? "Cargo is already placed in this bin."
        : result.relocated
          ? "Cargo relocated successfully."
          : "Cargo placed successfully.",
      data: result
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
  }
};

const updatePlacementSettings = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");
    const enabled = readBoolean(
      req.body?.manual_placement_enabled ?? req.body?.manualPlacementEnabled
    );
    const data = await savePlacementSettings(
      {
        enabled,
        userId: req.auth?.userId || null
      },
      client
    );

    await client.query("COMMIT");
    res.json({ success: true, data });
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

    if (validation.approved) {
      throw buildError("This placement already passes validation and does not require an override.", 400);
    }

    if (!validation.cargo || !validation.bin) {
      throw buildError("A registered cargo and known bin are required before requesting an override.", 400);
    }

    const failedChecks = Object.entries(validation.checks || {})
      .filter(([, check]) => check?.passed === false)
      .map(([checkName]) => checkName);

    if (failedChecks.length !== 1 || failedChecks[0] !== "restrictedZone") {
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

    const reason = String(req.body?.reason || validation.detail).trim();
    const result = await client.query(
      `INSERT INTO approval_requests
       (request_type, cargo_id, requested_by, warehouse_id_at_request, reason, status, request_data)
       VALUES ('PLACEMENT_OVERRIDE', $1, $2, $3, $4, 'Pending', $5)
       RETURNING *`,
      [
        validation.cargo.id,
        req.auth?.userId || null,
        validation.cargo.warehouse_id || req.auth?.warehouseId || null,
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
        description: `Requested placement override for cargo ${validation.cargo.cargo_id} and bin ${validation.bin.barcode}.`,
        metadata: {
          approval_request_id: result.rows[0].id,
          placement_mode: normalized.placement_mode,
          manual_reason: normalized.manual_placement_reason
        }
      },
      client
    );

    await notifyPlacementOverridePending(
      {
        cargo: validation.cargo,
        bin: validation.bin,
        approvalRequestId: result.rows[0].id,
        actorId: req.auth?.userId || null
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
      `SELECT
         pvl.*,
         c.cargo_id AS cargo_identifier,
         b.barcode AS bin_identifier
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
    );

    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

const getPlacementActivityTimeline = async (req, res, next) => {
  try {
    const result = await readPlacementActivity({
      auth: req.auth,
      filters: req.query
    });

    res.json({
      success: true,
      count: result.rows.length,
      total: result.total,
      page: result.page,
      limit: result.limit,
      data: result.rows
    });
  } catch (error) {
    next(error);
  }
};

const getPlacementActivitySummary = async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await readPlacementActivitySummary({
        auth: req.auth,
        filters: req.query
      })
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  confirmPlacement,
  getPlacementActivitySummary,
  getPlacementActivityTimeline,
  getPlacementFailures,
  getPlacementLogs,
  getPlacementSettings,
  requestPlacementOverride,
  updatePlacementSettings,
  validatePlacement
};

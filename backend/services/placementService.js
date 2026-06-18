const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { buildError } = require("../utils/apiError");
const { validatePlacement: runPlacementValidation } = require("./validationService");
const { PLACEMENT_STATUS } = require("./cargoWorkflowService");

const MANUAL_PLACEMENT_REASONS = Object.freeze([
  { value: "scanner_unavailable", label: "Barcode scanner unavailable" },
  { value: "damaged_barcode", label: "Damaged barcode" },
  { value: "emergency_operation", label: "Emergency operation" },
  { value: "supervisor_approved", label: "Supervisor-approved operation" }
]);

const manualReasonAliases = new Map(
  MANUAL_PLACEMENT_REASONS.flatMap((reason) => [
    [reason.value, reason.value],
    [reason.label.toLowerCase(), reason.value]
  ])
);

const textValue = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const firstValue = (payload, keys) => {
  for (const key of keys) {
    const value = textValue(payload?.[key]);
    if (value) return value;
  }
  return null;
};

const normalizeManualReason = (value) => {
  const normalized = textValue(value)?.toLowerCase();
  return normalized ? manualReasonAliases.get(normalized) || null : null;
};

const normalizePlacementRequest = (payload = {}) => {
  const placementMode = String(payload.placement_mode || payload.placementMode || "scan")
    .trim()
    .toLowerCase();
  if (!["scan", "manual"].includes(placementMode)) {
    throw buildError("Placement mode must be scan or manual.", 400);
  }

  const scannedCargoBarcode = firstValue(payload, [
    "scanned_cargo_barcode",
    "scannedCargoBarcode",
    "cargo_barcode",
    "cargoBarcode"
  ]);
  const scannedBinBarcode = firstValue(payload, [
    "scanned_bin_barcode",
    "scannedBinBarcode",
    "bin_barcode",
    "binBarcode"
  ]);
  const cargoId = firstValue(payload, [
    "cargo_id",
    "cargoId",
    "selected_cargo_id",
    "selectedCargoId"
  ]) || scannedCargoBarcode;
  const binId = firstValue(payload, ["bin_id", "binId"]);
  const manualReason = normalizeManualReason(
    payload.manual_placement_reason || payload.manualPlacementReason
  );

  if (!cargoId) {
    throw buildError("Cargo ID is required for placement.", 400);
  }
  if (placementMode === "scan" && (!scannedCargoBarcode || !scannedBinBarcode)) {
    throw buildError("Scan placement requires both cargo and bin barcodes.", 400);
  }
  if (placementMode === "manual" && !binId) {
    throw buildError("Manual placement requires a selected bin.", 400);
  }
  if (placementMode === "manual" && !manualReason) {
    throw buildError(
      `Manual placement reason must be one of: ${MANUAL_PLACEMENT_REASONS.map((reason) => reason.label).join(", ")}.`,
      400
    );
  }

  return {
    ...payload,
    cargo_id: cargoId,
    placement_mode: placementMode,
    scanned_cargo_barcode: scannedCargoBarcode,
    scanned_bin_barcode: scannedBinBarcode,
    bin_id: binId,
    manual_placement_reason: placementMode === "manual" ? manualReason : null
  };
};

const getManualPlacementEnabled = async (executor = db) => {
  const result = await executor.query(
    `SELECT setting_value
     FROM system_settings
     WHERE setting_key = 'manual_placement_enabled'
     LIMIT 1`
  );
  const value = result.rows[0]?.setting_value;
  return value === true || value === "true";
};

const getPlacementSettings = async (executor = db) => ({
  manual_placement_enabled: await getManualPlacementEnabled(executor),
  manual_placement_reasons: MANUAL_PLACEMENT_REASONS
});

const updatePlacementSettings = async ({ enabled, userId }, executor = db) => {
  if (typeof enabled !== "boolean") {
    throw buildError("manual_placement_enabled must be true or false.", 400);
  }

  await executor.query(
    `INSERT INTO system_settings (setting_key, setting_value, updated_by, updated_at)
     VALUES ('manual_placement_enabled', to_jsonb($1::boolean), $2, CURRENT_TIMESTAMP)
     ON CONFLICT (setting_key) DO UPDATE
     SET setting_value = EXCLUDED.setting_value,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
    [enabled, userId || null]
  );

  await writeAuditLog(
    {
      user_id: userId || null,
      action: "UPDATE_MANUAL_PLACEMENT_SETTING",
      module: "Cargo Placement",
      description: `${enabled ? "Enabled" : "Disabled"} manual cargo placement.`,
      metadata: { manual_placement_enabled: enabled }
    },
    executor
  );

  return getPlacementSettings(executor);
};

const assertWarehouseCargoAccess = (auth, validation) => {
  if (
    auth?.warehouseId
    && validation.cargo
    && Number(validation.cargo.warehouse_id) !== Number(auth.warehouseId)
  ) {
    throw buildError("Cargo record not found.", 404);
  }
};

const validatePlacementOperation = async (payload, auth = {}, executor = db) => {
  const normalized = normalizePlacementRequest(payload);
  if (
    normalized.placement_mode === "manual"
    && !(await getManualPlacementEnabled(executor))
  ) {
    throw buildError("Manual placement is disabled by the warehouse administrator.", 403);
  }

  const validation = await runPlacementValidation(normalized, executor);
  assertWarehouseCargoAccess(auth, validation);
  return { normalized, validation };
};

const formatLocation = (bin) => {
  const wh = bin.warehouse_name || bin.warehouse_code || "Unknown WH";
  const binCode = bin.code || bin.bin_code || bin.barcode?.split("-")?.pop() || "B01";
  return `${wh} → ${bin.zone_code} → ${bin.rack_code} → ${bin.level_code} → ${binCode}`;
};

const getNextPlacementStatus = ({
  alreadyPlacedInThisBin,
  currentStatus,
  isRelocation
}) => {
  if (
    alreadyPlacedInThisBin
    && [PLACEMENT_STATUS.PLACED, PLACEMENT_STATUS.RELOCATED].includes(currentStatus)
  ) {
    return currentStatus;
  }
  return isRelocation ? PLACEMENT_STATUS.RELOCATED : PLACEMENT_STATUS.PLACED;
};

const recordPlacementAttempt = async (
  executor,
  { validation, normalized, auth = {}, stage, previousLocation = null, newLocation = null }
) => {
  await executor.query(
    `INSERT INTO placement_validation_logs
     (cargo_id, cargo_barcode, bin_id, bin_barcode, placement_mode, attempt_stage, manual_reason,
      user_id, performed_by, warehouse_id_at_action, result, previous_location, new_location, approved, reason, detail, checks)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      validation.cargo?.id || null,
      normalized.scanned_cargo_barcode || normalized.cargo_id || null,
      validation.bin?.id || null,
      normalized.scanned_bin_barcode || normalized.bin_id || null,
      normalized.placement_mode,
      stage,
      normalized.manual_placement_reason,
      auth.userId || null,
      auth.warehouseId || validation.cargo?.warehouse_id || null,
      validation.approved ? "Passed" : "Failed",
      previousLocation,
      newLocation,
      validation.approved,
      validation.reason,
      validation.detail,
      JSON.stringify(validation.checks || {})
    ]
  );

  await writeAuditLog(
    {
      user_id: auth.userId || null,
      action: validation.approved
        ? stage === "confirmation" ? "PLACEMENT_SUCCEEDED" : "PLACEMENT_VALIDATED"
        : "PLACEMENT_FAILED",
      module: "Cargo Placement",
      description: `${validation.reason}: ${validation.detail}`,
      metadata: {
        stage,
        placement_mode: normalized.placement_mode,
        manual_reason: normalized.manual_placement_reason,
        cargo_id: validation.cargo?.id || null,
        cargo_identifier: validation.cargo?.cargo_id || normalized.cargo_id,
        scanned_cargo_barcode: normalized.scanned_cargo_barcode,
        bin_id: validation.bin?.id || null,
        bin_barcode: validation.bin?.barcode || normalized.scanned_bin_barcode || normalized.bin_id,
        success: validation.approved,
        failure_reason: validation.approved ? null : validation.detail,
        previous_location: previousLocation,
        new_location: newLocation,
        zone: normalized.placement_mode === "manual" ? validation.bin?.zone_code || null : null,
        rack: normalized.placement_mode === "manual" ? validation.bin?.rack_code || null : null,
        level: normalized.placement_mode === "manual" ? validation.bin?.level_code || null : null,
        bin: normalized.placement_mode === "manual" ? validation.bin?.barcode || null : null
      }
    },
    executor
  );
};

const recordPlacementError = async (
  executor,
  { payload = {}, auth = {}, stage, error }
) => {
  const placementMode = String(
    payload.placement_mode || payload.placementMode || "scan"
  ).trim().toLowerCase();
  const cargoIdentifier = firstValue(payload, [
    "scanned_cargo_barcode",
    "scannedCargoBarcode",
    "cargo_barcode",
    "cargoBarcode",
    "cargo_id",
    "cargoId"
  ]);
  const binIdentifier = firstValue(payload, [
    "scanned_bin_barcode",
    "scannedBinBarcode",
    "bin_barcode",
    "binBarcode",
    "bin_id",
    "binId"
  ]);
  const reason = error?.errors?.[0] || error?.code || "Placement Request Rejected";
  const detail = error?.message || "The placement request could not be completed.";

  await executor.query(
    `INSERT INTO placement_validation_logs
     (cargo_barcode, bin_barcode, placement_mode, attempt_stage, manual_reason,
      user_id, performed_by, warehouse_id_at_action, result, approved, reason, detail, checks)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, 'Failed', FALSE, $8, $9, $10)`,
    [
      cargoIdentifier,
      binIdentifier,
      ["scan", "manual"].includes(placementMode) ? placementMode : "invalid",
      stage,
      normalizeManualReason(payload.manual_placement_reason || payload.manualPlacementReason),
      auth.userId || null,
      auth.warehouseId || null,
      String(reason),
      detail,
      JSON.stringify({
        request: { passed: false, message: detail }
      })
    ]
  );

  await writeAuditLog(
    {
      user_id: auth.userId || null,
      action: "PLACEMENT_FAILED",
      module: "Cargo Placement",
      description: detail,
      metadata: {
        stage,
        placement_mode: placementMode,
        cargo_identifier: cargoIdentifier,
        bin_identifier: binIdentifier,
        success: false,
        failure_reason: String(reason)
      }
    },
    executor
  );
};

const confirmPlacementOperation = async (payload, auth = {}) => {
  const client = await db.pool.connect();
  let normalized;
  let validation;

  try {
    await client.query("BEGIN");
    ({ normalized, validation } = await validatePlacementOperation(payload, auth, client));

    if (!validation.approved) {
      await client.query("ROLLBACK");
      return { rejected: true, normalized, validation };
    }

    const cargoResult = await client.query(
      "SELECT * FROM cargo WHERE id = $1 AND is_deleted = FALSE FOR UPDATE",
      [validation.cargo.id]
    );
    if (cargoResult.rowCount === 0) {
      throw buildError("Cargo record was not found during placement confirmation.", 404);
    }

    const cargo = cargoResult.rows[0];
    const binIds = [...new Set(
      [Number(validation.bin.id), Number(cargo.current_bin_id)]
        .filter((id) => Number.isInteger(id) && id > 0)
    )].sort((left, right) => left - right);
    const lockedBinsResult = await client.query(
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
         z.allowed_cargo_type AS zone_allowed_cargo_type,
         z.is_hazard_zone,
         z.active AS zone_active
       FROM bins b
       JOIN levels l ON l.id = b.level_id
       JOIN racks r ON r.id = l.rack_id
       JOIN zones z ON z.id = r.zone_id
       WHERE b.id = ANY($1::int[])
       ORDER BY b.id
       FOR UPDATE OF b`,
      [binIds]
    );
    const targetBin = lockedBinsResult.rows.find(
      (bin) => Number(bin.id) === Number(validation.bin.id)
    );
    if (!targetBin) {
      throw buildError("Bin record was not found during placement confirmation.", 404);
    }

    ({ validation } = await validatePlacementOperation(normalized, auth, client));
    if (!validation.approved) {
      await client.query("ROLLBACK");
      return { rejected: true, normalized, validation };
    }

    const previousBin = lockedBinsResult.rows.find(
      (bin) => Number(bin.id) === Number(cargo.current_bin_id)
    ) || null;
    const alreadyPlacedInThisBin = Number(cargo.current_bin_id) === Number(targetBin.id);
    const isRelocation = Boolean(cargo.current_bin_id) && !alreadyPlacedInThisBin;
    const cargoWeight = Number(cargo.weight || 0);
    const cargoVolume = Number(cargo.volume || 0);
    const previousLocation = cargo.location || null;
    const newLocation = formatLocation(validation.bin);

    if (isRelocation && previousBin) {
      await client.query(
        `UPDATE bins
         SET current_weight = GREATEST(0, current_weight - $1),
             current_volume = GREATEST(0, current_volume - $2),
             status = CASE
               WHEN status IN ('Blocked', 'Reserved', 'Maintenance', 'Inactive') THEN status
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

    const updatedBinResult = alreadyPlacedInThisBin
      ? { rows: [targetBin] }
      : await client.query(
        `UPDATE bins
         SET current_weight = current_weight + $1,
             current_volume = current_volume + $2,
             status = 'Occupied',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING *`,
        [cargoWeight, cargoVolume, targetBin.id]
      );

    const nextPlacementStatus = getNextPlacementStatus({
      alreadyPlacedInThisBin,
      currentStatus: cargo.placement_status,
      isRelocation
    });
    const updatedCargoResult = await client.query(
      `UPDATE cargo
       SET placement_status = $1,
           location = $2,
           current_bin_id = $3,
           relocation_required = FALSE,
           relocation_reason = NULL,
           relocation_flagged_at = NULL,
           updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
       RETURNING *`,
      [
        nextPlacementStatus,
        newLocation,
        targetBin.id,
        cargo.id
      ]
    );

    const movementResult = alreadyPlacedInThisBin
      ? { rows: [] }
      : await client.query(
        `INSERT INTO cargo_movements
         (cargo_id, from_bin_id, to_bin_id, from_location, to_location, moved_by,
          moved_by_user_id, warehouse_id_at_action, movement_type, action)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
         RETURNING *`,
        [
          cargo.id,
          previousBin?.id || null,
          targetBin.id,
          previousLocation,
          newLocation,
          auth.username || cargo.received_by || "Warehouse Staff",
          auth.userId || null,
          auth.warehouseId || cargo.warehouse_id || null,
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
        `INSERT INTO cargo_locations (cargo_id, bin_id, location, is_current, assigned_by)
         VALUES ($1, $2, $3, TRUE, $4)`,
        [cargo.id, targetBin.id, newLocation, auth.userId || null]
      );
    }

    await recordPlacementAttempt(client, {
      validation,
      normalized,
      auth,
      stage: "confirmation",
      previousLocation,
      newLocation
    });
    await client.query("COMMIT");

    const updatedBin = updatedBinResult.rows[0];
    return {
      rejected: false,
      normalized,
      validation,
      cargo: {
        ...updatedCargoResult.rows[0],
        ...validation.bin,
        location: newLocation,
        bin_status: updatedBin.status,
        remaining_weight: Number(updatedBin.max_weight || 0) - Number(updatedBin.current_weight || 0),
        remaining_volume: Number(updatedBin.max_volume || 0) - Number(updatedBin.current_volume || 0)
      },
      bin: {
        ...validation.bin,
        ...updatedBin,
        display_location: newLocation,
        remaining_weight: Number(updatedBin.max_weight || 0) - Number(updatedBin.current_weight || 0),
        remaining_volume: Number(updatedBin.max_volume || 0) - Number(updatedBin.current_volume || 0)
      },
      movement: movementResult.rows[0] || null,
      alreadyPlaced: alreadyPlacedInThisBin,
      relocated: isRelocation
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  MANUAL_PLACEMENT_REASONS,
  confirmPlacementOperation,
  formatLocation,
  getNextPlacementStatus,
  getPlacementSettings,
  normalizeManualReason,
  normalizePlacementRequest,
  recordPlacementAttempt,
  recordPlacementError,
  updatePlacementSettings,
  validatePlacementOperation
};

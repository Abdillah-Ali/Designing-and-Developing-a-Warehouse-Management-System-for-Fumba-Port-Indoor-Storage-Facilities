const db = require("../config/db");
const {
  canCargoBePlaced,
  getCargoPlacementBlock
} = require("./cargoWorkflowService");
const { evaluateRules } = require("./binRuleEngine");

const cargoFields = [
  "consignee_name",
  "company_name",
  "contact_person",
  "phone_number",
  "email",
  "source_of_cargo",
  "container_number",
  "vehicle_number",
  "cargo_description",
  "cargo_type",
  "packaging_type",
  "quantity",
  "weight",
  "volume",
  "cargo_condition",
  "hazard_class",
  "inspection_notes",
  "received_by",
  "received_datetime",
  "delivery_note_number"
];

const OPTION_KEYS = Object.freeze({
  HAZARDOUS_CARGO: "hazardous_cargo",
  CONTAINER: "container",
  TRUCK: "truck",
  MANUAL_DELIVERY: "manual_delivery",
  GOOD: "good"
});

const nullableText = (value) => {
  if (value === undefined || value === null) return null;
  const next = String(value).trim();
  return next === "" ? null : next;
};

const nullableNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};

const nullableDatetime = (value) => {
  if (!value) return new Date();
  const next = new Date(value);
  return Number.isNaN(next.getTime()) ? new Date() : next;
};

const validateCargoPayload = (payload = {}) => {
  const errors = [];

  if (!nullableText(payload.consignee_name)) {
    errors.push("Consignee name is required.");
  }

  if (!nullableText(payload.phone_number)) {
    errors.push("Phone number is required.");
  }

  if (!nullableText(payload.cargo_type)) {
    errors.push("Cargo type is required.");
  }

  if (!nullableText(payload.cargo_condition)) {
    errors.push("Cargo condition is required.");
  }

  if (!nullableText(payload.source_of_cargo_key)) errors.push("Stable cargo source identity is required.");
  if (!nullableText(payload.cargo_type_key)) errors.push("Stable cargo type identity is required.");
  if (!nullableText(payload.cargo_condition_key)) errors.push("Stable cargo condition identity is required.");

  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(payload.email))) {
    errors.push("Email address is not valid.");
  }

  ["quantity", "weight", "volume"].forEach((field) => {
    const value = payload[field];
    if (value === undefined || value === null || value === "" || !Number.isFinite(Number(value)) || Number(value) <= 0) {
      errors.push(`${field.replace("_", " ")} must be greater than zero.`);
    }
  });

  if (payload.cargo_type_key === OPTION_KEYS.HAZARDOUS_CARGO) {
    if (!nullableText(payload.hazard_class)) {
      errors.push("Hazard class is required for hazardous cargo.");
    }
  }

  if (payload.source_of_cargo_key === OPTION_KEYS.CONTAINER && !nullableText(payload.container_number)) {
    errors.push("Container number is required when source of cargo is Container.");
  }

  if ([OPTION_KEYS.TRUCK, OPTION_KEYS.MANUAL_DELIVERY].includes(payload.source_of_cargo_key) && !nullableText(payload.vehicle_number)) {
    errors.push("Vehicle number is required for truck or manual delivery cargo.");
  }

  if (payload.cargo_condition_key && payload.cargo_condition_key !== OPTION_KEYS.GOOD && !nullableText(payload.inspection_notes)) {
    errors.push("Inspection notes are required when cargo condition is not Good.");
  }

  return errors;
};

const normalizeCargoPayload = (payload = {}, optionKeys = {}) => {
  const normalized = {};

  cargoFields.forEach((field) => {
    if (["quantity", "weight", "volume"].includes(field)) {
      normalized[field] = nullableNumber(payload[field]);
      return;
    }

    if (field === "received_datetime") {
      normalized[field] = nullableDatetime(payload[field]);
      return;
    }

    normalized[field] = nullableText(payload[field]);
  });

  normalized.source_of_cargo_key = optionKeys.source_of_cargo || payload.source_of_cargo_key || null;
  normalized.cargo_type_key = optionKeys.cargo_type || payload.cargo_type_key || null;
  normalized.cargo_condition_key = optionKeys.cargo_condition || payload.cargo_condition_key || null;
  normalized.packaging_type_key = optionKeys.packaging_type || payload.packaging_type_key || null;
  normalized.hazard_class_key = optionKeys.hazard_class || payload.hazard_class_key || null;

  if (normalized.cargo_type_key !== OPTION_KEYS.HAZARDOUS_CARGO) {
    normalized.hazard_class = null;
    normalized.hazard_class_key = null;
  }

  return normalized;
};

const readScannedValue = (payload, keys) => {
  for (const key of keys) {
    const value = nullableText(payload[key]);
    if (value) return value.toUpperCase();
  }

  return null;
};

const failValidation = ({ reason, detail, checks, cargo = null, bin = null }) => ({
  approved: false,
  reason,
  detail,
  checks,
  cargo,
  bin
});

const validatePlacement = async (payload = {}, executor = db) => {
  const placementMode = String(payload.placement_mode || payload.placementMode || "scan")
    .trim()
    .toLowerCase();
  const selectedCargoIdentifier = readScannedValue(payload, [
    "cargo_id",
    "cargoId",
    "selected_cargo_id",
    "selectedCargoId"
  ]);
  const cargoBarcode = readScannedValue(payload, [
    "scanned_cargo_barcode",
    "scannedCargoBarcode",
    "cargo_barcode",
    "cargoBarcode"
  ]);
  const binBarcode = readScannedValue(payload, [
    "scanned_bin_barcode",
    "scannedBinBarcode",
    "bin_barcode",
    "binBarcode"
  ]);
  const manualBinIdentifier = readScannedValue(payload, [
    "bin_id",
    "binId"
  ]);
  const requestedOperationType = nullableText(
    payload.operation_type || payload.operationType || payload.placement_intent || payload.placementIntent
  )?.toLowerCase() || null;
  const cargoIdentifier = placementMode === "manual"
    ? selectedCargoIdentifier || cargoBarcode
    : cargoBarcode;
  const binIdentifier = placementMode === "manual"
    ? manualBinIdentifier || binBarcode
    : binBarcode;

  if (!["scan", "manual"].includes(placementMode)) {
    return failValidation({
      reason: "Invalid Placement Mode",
      detail: "Placement mode must be scan or manual.",
      checks: {
        placementMode: { passed: false, message: "Placement mode must be scan or manual." }
      }
    });
  }
  if (requestedOperationType && !["placement", "relocation"].includes(requestedOperationType)) {
    return failValidation({
      reason: "Invalid Operation Type",
      detail: "Operation type must be placement or relocation.",
      checks: {
        operationType: { passed: false, message: "Operation type must be placement or relocation." }
      }
    });
  }

  if (!cargoIdentifier || !binIdentifier) {
    return failValidation({
      reason: "Missing Scan Data",
      detail: placementMode === "manual"
        ? "Cargo ID and bin selection are required for manual placement validation."
        : "Both cargo barcode and bin barcode are required for placement validation.",
      checks: {
        placementMode: { passed: true, message: `${placementMode} placement mode selected.` },
        cargoScan: { passed: Boolean(cargoIdentifier), message: "Cargo identifier received." },
        binScan: { passed: Boolean(binIdentifier), message: "Bin identifier received." }
      }
    });
  }

  const cargoResult = await executor.query(
    `SELECT * FROM cargo
     WHERE (id::text = $1 OR UPPER(barcode) = $1 OR UPPER(cargo_id) = $1)
       AND is_deleted = FALSE
     LIMIT 1`,
    [cargoIdentifier]
  );

  if (cargoResult.rowCount === 0) {
    return failValidation({
      reason: "Cargo Not Found",
      detail: "Cargo does not exist.",
      checks: {
        placementMode: { passed: true, message: `${placementMode} placement mode selected.` },
        cargoFound: { passed: false, message: "Cargo must be registered before placement." }
      }
    });
  }

  const cargo = cargoResult.rows[0];
  const cargoIsCurrentlyPlaced = (
    ["Placed", "Relocated"].includes(cargo.placement_status)
    && Boolean(cargo.current_bin_id)
  );
  const operationType = requestedOperationType || (
    cargoIsCurrentlyPlaced ? "relocation" : "placement"
  );

  const binResult = await executor.query(
    `SELECT
      b.*,
      l.id AS level_id,
      l.code AS level_code,
      l.active AS level_active,
      r.id AS rack_id,
      r.code AS rack_code,
      r.active AS rack_active,
      z.id AS zone_id,
      z.code AS zone_code,
      z.name AS zone_name,
      z.zone_type,
      z.allowed_cargo_type AS zone_allowed_cargo_type,
      zone_option.option_key AS zone_allowed_cargo_type_key,
      z.handling_condition,
      COALESCE(b.allowed_cargo_type, z.allowed_cargo_type) AS allowed_cargo_type,
      COALESCE(bin_option.option_key, zone_option.option_key) AS allowed_cargo_type_key,
      z.is_hazard_zone,
      z.active AS zone_active,
      z.warehouse_id,
      w.warehouse_name,
      w.warehouse_code,
      w.status AS warehouse_status
    FROM bins b
    JOIN levels l ON l.id = b.level_id
    JOIN racks r ON r.id = l.rack_id
    JOIN zones z ON z.id = r.zone_id
    LEFT JOIN warehouses w ON w.id = z.warehouse_id
    LEFT JOIN cargo_option_values zone_option ON zone_option.catalog_key='cargo_type' AND zone_option.storage_value=z.allowed_cargo_type
    LEFT JOIN cargo_option_values bin_option ON bin_option.catalog_key='cargo_type' AND bin_option.storage_value=b.allowed_cargo_type
    WHERE b.id::text = $1 OR UPPER(b.barcode) = $1 OR UPPER(b.code) = $1
    LIMIT 1`,
    [binIdentifier]
  );

  if (binResult.rowCount === 0) {
    return failValidation({
      reason: "Bin Not Found",
      detail: "Destination bin does not exist.",
      checks: {
        placementMode: { passed: true, message: `${placementMode} placement mode selected.` },
        cargoFound: { passed: true, message: "Cargo record found." },
        binFound: { passed: false, message: "Scanned bin barcode is not in the storage hierarchy." }
      },
      cargo,
      bin: null
    });
  }

  const bin = binResult.rows[0];
  const issues = [];
  const cargoWeight = Number(cargo.weight || 0);
  const cargoVolume = Number(cargo.volume || 0);
  const alreadyPlacedInThisBin = Number(cargo.current_bin_id) === Number(bin.id);
  const remainingWeight = Number(bin.max_weight || 0) - Number(bin.current_weight || 0) + (alreadyPlacedInThisBin ? cargoWeight : 0);
  const remainingVolume = Number(bin.max_volume || 0) - Number(bin.current_volume || 0) + (alreadyPlacedInThisBin ? cargoVolume : 0);

  const approvalId = Number(payload.approval_request_id || payload.approvalRequestId);
  let approvedOverride = null;

  if (Number.isInteger(approvalId) && approvalId > 0) {
    const approvalResult = await executor.query(
      `SELECT *
       FROM approval_requests
       WHERE id = $1
         AND cargo_id = $2
         AND request_type = 'PLACEMENT_OVERRIDE'
         AND status = 'Approved'
       LIMIT 1`,
      [approvalId, cargo.id]
    );
    const candidate = approvalResult.rows[0];
    if (
      candidate
      && String(candidate.request_data?.bin_id || "") === String(bin.id)
    ) {
      approvedOverride = candidate;
    }
  } else {
    const approvalResult = await executor.query(
      `SELECT *
       FROM approval_requests
       WHERE cargo_id = $1
         AND request_type = 'PLACEMENT_OVERRIDE'
         AND status = 'Approved'
         AND request_data->>'bin_id' = $2
       ORDER BY decided_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [cargo.id, String(bin.id)]
    );
    approvedOverride = approvalResult.rows[0] || null;
  }

  const checks = {
    placementMode: { passed: true, message: `${placementMode} placement mode selected.` },
    cargoFound: { passed: true, message: "Cargo record found." },
    cargoScanMatch: {
      passed: true,
      message: placementMode === "scan"
        ? "Scanned cargo record loaded for backend validation."
        : "Selected cargo loaded for manual placement."
    },
    placementQueue: { passed: true, message: "Cargo is in the applicable placement queue." },
    relocationSource: { passed: true, message: "Cargo has a valid current placement for relocation." },
    destinationDifferent: { passed: true, message: "Destination bin differs from the current bin." },
    cargoPlacementStatus: { passed: true, message: "Cargo is available for this placement check." },
    binFound: { passed: true, message: "Bin record found." },
    cargoCompatibility: { passed: true, message: "Cargo type matches the selected zone." },
    hazardRestriction: { passed: true, message: "Hazard restrictions passed." },
    weightCapacity: { passed: true, message: "Weight capacity is available." },
    volumeCapacity: { passed: true, message: "Volume capacity is available." },
    blockedBin: { passed: true, message: "Bin is not blocked." },
    maintenanceBin: { passed: true, message: "Bin is not under maintenance." },
    reservedBin: { passed: true, message: "Bin is not reserved." },
    restrictedZone: { passed: true, message: "Zone is not restricted." },
    activeStorage: { passed: true, message: "Bin and parent storage locations are active." },
    availableBin: { passed: true, message: "Bin is available for placement." },
    warehouseMatch: { passed: true, message: "Cargo and bin are in the same warehouse." }
  };

  const addIssue = (checkName, reason, detail) => {
    checks[checkName] = { passed: false, message: detail };
    issues.push({ reason, detail });
  };

  if (Number(bin.warehouse_id) !== Number(cargo.warehouse_id)) {
    addIssue(
      "warehouseMatch",
      "Warehouse Mismatch",
      "Warehouse mismatch: this bin does not belong to the cargo's registered warehouse."
    );
  }

  if (operationType === "placement") {
    if (cargoIsCurrentlyPlaced || ["Placed", "Relocated"].includes(cargo.placement_status)) {
      addIssue("placementQueue", "Cargo Already Placed", "Cargo has already been placed.");
    } else if (cargo.placement_status !== "Unplaced") {
      addIssue("placementQueue", "Not In Placement Queue", "Cargo is not in the placement queue.");
    }
  } else if (!cargoIsCurrentlyPlaced) {
    addIssue(
      "relocationSource",
      "Cargo Not Placed",
      "Cargo is not currently placed and cannot be relocated."
    );
  }

  if (!canCargoBePlaced(cargo)) {
    const block = getCargoPlacementBlock(cargo);
    addIssue("cargoPlacementStatus", block.reason, block.detail);
  }

  if (operationType === "relocation" && alreadyPlacedInThisBin) {
    addIssue(
      "destinationDifferent",
      "Same Bin Relocation",
      "Cargo cannot be relocated to its current bin."
    );
  }

  // Physical maxima are trusted storage invariants and cannot be disabled by rule configuration.
  if (cargoWeight > remainingWeight) addIssue("weightCapacity", "Weight Capacity Exceeded", "Destination bin physical weight capacity is insufficient.");
  if (cargoVolume > remainingVolume) addIssue("volumeCapacity", "Volume Capacity Exceeded", "Destination bin physical volume capacity is insufficient.");

  const engineTarget = operationType === "relocation" ? "relocation" : "placement_confirmation";
  const ruleEvaluation = await evaluateRules({
    target: engineTarget,
    executor,
    context: {
      cargo,
      bin,
      approvals: { supervisor_override: approvedOverride },
      derived: { remaining_weight: remainingWeight, remaining_volume: remainingVolume, already_placed_in_bin: alreadyPlacedInThisBin }
    }
  });
  checks.ruleEngineReadiness = {
    passed: ruleEvaluation.readiness.ready,
    message: ruleEvaluation.readiness.ready
      ? "Required placement safety capabilities are configured."
      : ruleEvaluation.detail
  };
  for (const evaluated of ruleEvaluation.results) {
    checks[`rule:${evaluated.rule_reference}`] = { passed: evaluated.passed, message: evaluated.message };
    if (evaluated.blocks) addIssue(`rule:${evaluated.rule_reference}`, evaluated.rule_name, evaluated.message);
  }
  if (!ruleEvaluation.readiness.ready) {
    addIssue("ruleEngineReadiness", ruleEvaluation.reason, ruleEvaluation.detail);
  }

  const overrideApplied = Boolean(approvedOverride);

  const approved = issues.length === 0;

  return {
    approved,
    reason: approved ? "Placement Approved" : issues[0].reason,
    detail: approved
      ? overrideApplied
        ? "Placement approved using an authorized supervisor override."
        : "Cargo identity, compatibility, hazard, capacity, activity, blocked, reserved, maintenance, and restricted-zone checks passed."
      : issues.map((issue) => issue.detail).join(" "),
    checks,
    cargo: {
      id: cargo.id,
      cargo_id: cargo.cargo_id,
      barcode: cargo.barcode,
      warehouse_id: cargo.warehouse_id,
      cargo_type: cargo.cargo_type,
      weight: cargo.weight,
      volume: cargo.volume,
      hazard_class: cargo.hazard_class,
      registration_status: cargo.registration_status,
      placement_status: cargo.placement_status,
      current_bin_id: cargo.current_bin_id,
      location: cargo.location,
      relocation_required: cargo.relocation_required,
      relocation_reason: cargo.relocation_reason
    },
    bin: {
      id: bin.id,
      bin_id: bin.id,
      barcode: bin.barcode,
      bin_barcode: bin.barcode,
      code: bin.code,
      bin_code: bin.code,
      status: bin.status,
      zone_id: bin.zone_id,
      zone_code: bin.zone_code,
      zone_name: bin.zone_name,
      zone_type: bin.zone_type,
      rack_id: bin.rack_id,
      rack_code: bin.rack_code,
      level_id: bin.level_id,
      level_code: bin.level_code,
      allowed_cargo_type: bin.allowed_cargo_type,
      max_weight: bin.max_weight,
      max_volume: bin.max_volume,
      current_weight: bin.current_weight,
      current_volume: bin.current_volume,
      remaining_weight: remainingWeight,
      remaining_volume: remainingVolume,
      reserved_for_cargo_type: bin.reserved_for_cargo_type,
      warehouse_name: bin.warehouse_name,
      warehouse_code: bin.warehouse_code,
      location_display: `${bin.warehouse_name || bin.warehouse_code || "Unknown WH"} → ${bin.zone_code} → ${bin.rack_code} → ${bin.level_code} → ${bin.code}`,
      location_path: `${bin.warehouse_name || bin.warehouse_code || "Unknown WH"} → ${bin.zone_code} → ${bin.rack_code} → ${bin.level_code} → ${bin.code}`,
      display_location: `${bin.warehouse_name || bin.warehouse_code || "Unknown WH"} → ${bin.zone_code} → ${bin.rack_code} → ${bin.level_code} → ${bin.code}`
    },
    approval: overrideApplied ? approvedOverride : null,
    operation_type: operationType,
    placement_mode: placementMode,
    manual_reason: payload.manual_placement_reason || payload.manualPlacementReason || null
  };
};

module.exports = {
  OPTION_KEYS,
  cargoFields,
  validateCargoPayload,
  normalizeCargoPayload,
  validatePlacement
};

const db = require("../config/db");
const {
  REGISTRATION_STATUS,
  canCargoBePlaced
} = require("./cargoWorkflowService");

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

const sourceOptions = new Set([
  "Container",
  "Truck",
  "Ship Transfer",
  "Manual Delivery",
  "Customs Hold Release",
  "Other"
]);

const cargoTypes = new Set([
  "General Goods",
  "Electronics",
  "Machinery",
  "Food Products",
  "Construction Materials",
  "Fragile Goods",
  "Hazardous Cargo",
  "Mixed Cargo"
]);

const packagingTypes = new Set([
  "Boxes",
  "Cartons",
  "Pallets",
  "Crates",
  "Bags",
  "Drums",
  "Loose Cargo",
  "Containerized",
  "Other"
]);

const cargoConditions = new Set([
  "Good",
  "Damaged",
  "Wet",
  "Leaking",
  "Broken Packaging",
  "Requires Inspection"
]);

const hazardClasses = new Set([
  "Flammable",
  "Corrosive",
  "Explosive",
  "Toxic",
  "Oxidizing",
  "Compressed Gas",
  "Radioactive",
  "Other Hazardous"
]);

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

  if (payload.source_of_cargo && !sourceOptions.has(String(payload.source_of_cargo).trim())) {
    errors.push("Source of cargo is not valid.");
  }

  if (payload.cargo_type && !cargoTypes.has(String(payload.cargo_type).trim())) {
    errors.push("Cargo type is not valid.");
  }

  if (payload.packaging_type && !packagingTypes.has(String(payload.packaging_type).trim())) {
    errors.push("Packaging type is not valid.");
  }

  if (!nullableText(payload.cargo_condition)) {
    errors.push("Cargo condition is required.");
  } else if (!cargoConditions.has(String(payload.cargo_condition).trim())) {
    errors.push("Cargo condition is not valid.");
  }

  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(payload.email))) {
    errors.push("Email address is not valid.");
  }

  ["quantity", "weight", "volume"].forEach((field) => {
    const value = payload[field];
    if (value === undefined || value === null || value === "" || !Number.isFinite(Number(value)) || Number(value) <= 0) {
      errors.push(`${field.replace("_", " ")} must be greater than zero.`);
    }
  });

  if (payload.cargo_type === "Hazardous Cargo") {
    if (!nullableText(payload.hazard_class)) {
      errors.push("Hazard class is required for hazardous cargo.");
    } else if (!hazardClasses.has(String(payload.hazard_class).trim())) {
      errors.push("Hazard class is not valid.");
    }
  }

  if (payload.source_of_cargo === "Container" && !nullableText(payload.container_number)) {
    errors.push("Container number is required when source of cargo is Container.");
  }

  if (["Truck", "Manual Delivery"].includes(payload.source_of_cargo) && !nullableText(payload.vehicle_number)) {
    errors.push("Vehicle number is required for truck or manual delivery cargo.");
  }

  if (payload.cargo_condition && payload.cargo_condition !== "Good" && !nullableText(payload.inspection_notes)) {
    errors.push("Inspection notes are required when cargo condition is not Good.");
  }

  return errors;
};

const normalizeCargoPayload = (payload = {}) => {
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

  if (normalized.cargo_type !== "Hazardous Cargo") {
    normalized.hazard_class = null;
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

/**
 * Fetches active bin_rules from the database and returns them as a map
 * keyed by rule_key for fast lookup.
 */
const fetchActiveRules = async (executor = db) => {
  const result = await executor.query("SELECT rule_key, is_active, parameters FROM bin_rules");
  const rules = {};
  for (const row of result.rows) {
    rules[row.rule_key] = { is_active: row.is_active, parameters: row.parameters };
  }
  return rules;
};

const isRuleActive = (rules, ruleKey) => {
  const rule = rules[ruleKey];
  return rule ? rule.is_active : true; // default to active if rule doesn't exist
};

const validatePlacement = async (payload = {}, executor = db) => {
  const cargoBarcode = readScannedValue(payload, [
    "cargo_barcode",
    "cargoBarcode",
    "scanned_cargo_barcode",
    "scannedCargoBarcode"
  ]);
  const binBarcode = readScannedValue(payload, [
    "bin_barcode",
    "binBarcode",
    "scanned_bin_barcode",
    "scannedBinBarcode"
  ]);

  if (!cargoBarcode || !binBarcode) {
    return failValidation({
      reason: "Missing Scan Data",
      detail: "Both cargo barcode and bin barcode are required for placement validation.",
      checks: {
        cargoScan: { passed: Boolean(cargoBarcode), message: "Cargo barcode received." },
        binScan: { passed: Boolean(binBarcode), message: "Bin barcode received." }
      }
    });
  }

  const cargoResult = await executor.query(
    `SELECT * FROM cargo
     WHERE (UPPER(barcode) = $1 OR UPPER(cargo_id) = $1)
       AND is_deleted = FALSE
     LIMIT 1`,
    [cargoBarcode]
  );

  if (cargoResult.rowCount === 0) {
    return failValidation({
      reason: "Cargo Not Found",
      detail: "No registered cargo matches the scanned cargo barcode.",
      checks: {
        cargoFound: { passed: false, message: "Cargo must be registered before placement." }
      }
    });
  }

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
      z.allowed_cargo_type,
      z.is_hazard_zone,
      z.active AS zone_active
    FROM bins b
    JOIN levels l ON l.id = b.level_id
    JOIN racks r ON r.id = l.rack_id
    JOIN zones z ON z.id = r.zone_id
    WHERE UPPER(b.barcode) = $1
    LIMIT 1`,
    [binBarcode]
  );

  if (binResult.rowCount === 0) {
    return failValidation({
      reason: "Bin Not Found",
      detail: "No warehouse bin matches the scanned bin barcode.",
      checks: {
        cargoFound: { passed: true, message: "Cargo record found." },
        binFound: { passed: false, message: "Scanned bin barcode is not in the storage hierarchy." }
      },
      cargo: cargoResult.rows[0],
      bin: null
    });
  }

  const cargo = cargoResult.rows[0];
  const bin = binResult.rows[0];
  const issues = [];
  const cargoWeight = Number(cargo.weight || 0);
  const cargoVolume = Number(cargo.volume || 0);
  const alreadyPlacedInThisBin = Number(cargo.current_bin_id) === Number(bin.id);
  const remainingWeight = Number(bin.max_weight || 0) - Number(bin.current_weight || 0) + (alreadyPlacedInThisBin ? cargoWeight : 0);
  const remainingVolume = Number(bin.max_volume || 0) - Number(bin.current_volume || 0) + (alreadyPlacedInThisBin ? cargoVolume : 0);

  // Fetch dynamic rules from database
  const rules = await fetchActiveRules(executor);
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
    cargoFound: { passed: true, message: "Cargo record found." },
    cargoPlacementStatus: { passed: true, message: "Cargo is available for this placement check." },
    binFound: { passed: true, message: "Bin record found." },
    cargoCompatibility: { passed: true, message: "Cargo type matches the selected zone." },
    hazardRestriction: { passed: true, message: "Hazard restrictions passed." },
    weightCapacity: { passed: true, message: "Weight capacity is available." },
    volumeCapacity: { passed: true, message: "Volume capacity is available." },
    blockedBin: { passed: true, message: "Bin is not blocked." },
    reservedBin: { passed: true, message: "Bin is not reserved." },
    restrictedZone: { passed: true, message: "Zone is not restricted." },
    activeStorage: { passed: true, message: "Bin and parent storage locations are active." },
    availableBin: { passed: true, message: "Bin is available for placement." }
  };

  const addIssue = (checkName, reason, detail) => {
    checks[checkName] = { passed: false, message: detail };
    issues.push({ reason, detail });
  };

  if (cargo.current_bin_id && !alreadyPlacedInThisBin && !cargo.relocation_required) {
    addIssue(
      "cargoPlacementStatus",
      "Cargo Already Placed",
      "Cargo is already placed in another bin and has not been flagged for relocation."
    );
  }

  if (!canCargoBePlaced(cargo)) {
    addIssue(
      "cargoPlacementStatus",
      cargo.registration_status === REGISTRATION_STATUS.REJECTED
        ? "Registration Rejected"
        : "Cargo Dispatched",
      cargo.registration_status === REGISTRATION_STATUS.REJECTED
        ? "Rejected cargo cannot be placed in warehouse storage."
        : "Dispatched cargo cannot be placed again."
    );
  }

  if (!bin.active || !bin.level_active || !bin.rack_active || !bin.zone_active || bin.status === "Inactive") {
    addIssue("activeStorage", "Inactive Storage", "Selected bin or one of its parent storage locations is inactive.");
  }

  if (bin.status === "Blocked" && !approvedOverride) {
    addIssue("blockedBin", "Blocked Bin", "Selected storage bin is blocked for operations.");
  }

  if (bin.status === "Reserved" && !approvedOverride) {
    addIssue("reservedBin", "Reserved Bin", "Reserved bins cannot be used for normal cargo placement.");
  }

  if (bin.status === "Full" && !alreadyPlacedInThisBin && !approvedOverride) {
    addIssue("availableBin", "Bin Full", "Selected storage bin has no remaining capacity.");
  }

  if (!alreadyPlacedInThisBin && !approvedOverride && !["Available", "Occupied", "Blocked", "Reserved", "Full", "Inactive"].includes(bin.status)) {
    addIssue("availableBin", "Bin Not Available", `Selected storage bin is ${bin.status} and cannot receive normal placement.`);
  }

  // Hazardous rule (database-driven)
  if (isRuleActive(rules, "hazardous") && !approvedOverride) {
    if (bin.is_hazard_zone && cargo.cargo_type !== "Hazardous Cargo") {
      addIssue("hazardRestriction", "Hazard Restriction", `${cargo.cargo_type} cannot be placed in Hazardous Cargo Zone.`);
    }

    if (cargo.cargo_type === "Hazardous Cargo" && !bin.is_hazard_zone) {
      addIssue("hazardRestriction", "Hazard Restriction", "Hazardous cargo must be placed in a Hazardous Zone.");
    }
  }

  // Compatibility rule (database-driven, uses zone.allowed_cargo_type instead of hardcoded map)
  if (isRuleActive(rules, "compatibility") && !approvedOverride) {
    const allowedTypes = (bin.allowed_cargo_type || "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    if (allowedTypes.length > 0) {
      const cargoTypeLower = (cargo.cargo_type || "").toLowerCase();
      const isAllowed = allowedTypes.some((t) => t === cargoTypeLower || t === "all" || t === "mixed cargo");
      if (!isAllowed) {
        addIssue("cargoCompatibility", "Incompatible Cargo", `${cargo.cargo_type} is not permitted in zone ${bin.zone_code} (allowed: ${bin.allowed_cargo_type}).`);
      }
    }
  }

  // Weight rule (database-driven)
  if (isRuleActive(rules, "weight") && !approvedOverride) {
    if (cargoWeight > remainingWeight) {
      addIssue("weightCapacity", "Weight Capacity Exceeded", "Selected bin does not have enough remaining weight capacity.");
    }
  }

  // Volume rule (database-driven)
  if (isRuleActive(rules, "volume") && !approvedOverride) {
    if (cargoVolume > remainingVolume) {
      addIssue("volumeCapacity", "Volume Capacity Exceeded", "Selected bin does not have enough remaining volume capacity.");
    }
  }

  if (
    isRuleActive(rules, "restricted")
    && String(bin.zone_type || "").toLowerCase() === "restricted"
    && !approvedOverride
  ) {
    addIssue("restrictedZone", "Restricted Zone", "Placement into this restricted zone requires supervisor approval.");
  }

  const approved = issues.length === 0;

  return {
    approved,
    reason: approved ? "Placement Approved" : issues[0].reason,
    detail: approved
      ? approvedOverride
        ? "Placement approved using an authorized supervisor override."
        : "Cargo type, hazard rules, capacity, blocked-bin, reserved-bin, and restricted-zone checks passed."
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
      max_weight: bin.max_weight,
      max_volume: bin.max_volume,
      current_weight: bin.current_weight,
      current_volume: bin.current_volume,
      remaining_weight: remainingWeight,
      remaining_volume: remainingVolume,
      reserved_for_cargo_type: bin.reserved_for_cargo_type
    },
    approval: approvedOverride
  };
};

module.exports = {
  cargoFields,
  validateCargoPayload,
  normalizeCargoPayload,
  validatePlacement
};

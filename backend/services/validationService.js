const db = require("../config/db");

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

  if (!nullableText(payload.cargo_type)) {
    errors.push("Cargo type is required.");
  }

  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(payload.email))) {
    errors.push("Email address is not valid.");
  }

  ["quantity", "weight", "volume"].forEach((field) => {
    const value = payload[field];
    if (value !== undefined && value !== null && value !== "" && Number(value) < 0) {
      errors.push(`${field.replace("_", " ")} cannot be negative.`);
    }
  });

  if (payload.cargo_type === "Hazardous Cargo" && !nullableText(payload.hazard_class)) {
    errors.push("Hazard class is required for hazardous cargo.");
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
const fetchActiveRules = async () => {
  const result = await db.query("SELECT rule_key, is_active, parameters FROM bin_rules");
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

const validatePlacement = async (payload = {}) => {
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

  const cargoResult = await db.query(
    "SELECT * FROM cargo WHERE UPPER(barcode) = $1 OR UPPER(cargo_id) = $1 LIMIT 1",
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

  const binResult = await db.query(
    `SELECT
      b.*,
      l.id AS level_id,
      l.code AS level_code,
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
  const rules = await fetchActiveRules();

  const checks = {
    cargoFound: { passed: true, message: "Cargo record found." },
    cargoPlacementStatus: { passed: true, message: "Cargo is available for this placement check." },
    binFound: { passed: true, message: "Bin record found." },
    cargoCompatibility: { passed: true, message: "Cargo type matches the selected zone." },
    hazardRestriction: { passed: true, message: "Hazard restrictions passed." },
    weightCapacity: { passed: true, message: "Weight capacity is available." },
    volumeCapacity: { passed: true, message: "Volume capacity is available." },
    blockedBin: { passed: true, message: "Bin is not blocked." },
    reservedBin: { passed: true, message: "Bin reservation rules passed." }
  };

  const addIssue = (checkName, reason, detail) => {
    checks[checkName] = { passed: false, message: detail };
    issues.push({ reason, detail });
  };

  if (cargo.current_bin_id && !alreadyPlacedInThisBin) {
    addIssue("cargoPlacementStatus", "Cargo Already Stored", "Cargo is already placed in another bin.");
  }

  if (bin.status === "Blocked") {
    addIssue("blockedBin", "Blocked Bin", "Selected storage bin is blocked for operations.");
  }

  // Restricted bin rule (database-driven)
  if (isRuleActive(rules, "restricted")) {
    if (bin.status === "Reserved" && bin.reserved_for_cargo_type !== cargo.cargo_type) {
      addIssue("reservedBin", "Reserved Bin", "Selected storage bin is reserved for a different cargo type.");
    }
  }

  // Hazardous rule (database-driven)
  if (isRuleActive(rules, "hazardous")) {
    if (bin.is_hazard_zone && cargo.cargo_type !== "Hazardous Cargo") {
      addIssue("hazardRestriction", "Hazard Restriction", `${cargo.cargo_type} cannot be placed in Hazardous Cargo Zone.`);
    }

    if (cargo.cargo_type === "Hazardous Cargo" && !bin.is_hazard_zone) {
      addIssue("hazardRestriction", "Hazard Restriction", "Hazardous cargo must be placed in a Hazardous Zone.");
    }
  }

  // Compatibility rule (database-driven, uses zone.allowed_cargo_type instead of hardcoded map)
  if (isRuleActive(rules, "compatibility")) {
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
  if (isRuleActive(rules, "weight")) {
    if (cargoWeight > remainingWeight) {
      addIssue("weightCapacity", "Weight Capacity Exceeded", "Selected bin does not have enough remaining weight capacity.");
    }
  }

  // Volume rule (database-driven)
  if (isRuleActive(rules, "volume")) {
    if (cargoVolume > remainingVolume) {
      addIssue("volumeCapacity", "Volume Capacity Exceeded", "Selected bin does not have enough remaining volume capacity.");
    }
  }

  const approved = issues.length === 0;

  return {
    approved,
    reason: approved ? "Placement Approved" : issues[0].reason,
    detail: approved
      ? "Cargo type, hazard rules, capacity, blocked-bin, and reserved-bin checks passed."
      : issues.map((issue) => issue.detail).join(" "),
    checks,
    cargo: {
      id: cargo.id,
      cargo_id: cargo.cargo_id,
      barcode: cargo.barcode,
      cargo_type: cargo.cargo_type,
      weight: cargo.weight,
      volume: cargo.volume,
      hazard_class: cargo.hazard_class,
      status: cargo.status,
      location: cargo.location
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
    }
  };
};

module.exports = {
  cargoFields,
  validateCargoPayload,
  normalizeCargoPayload,
  validatePlacement
};

const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { buildError } = require("../utils/apiError");

const CARGO_TYPES = Object.freeze([
  "General Goods",
  "Electronics",
  "Machinery",
  "Food Products",
  "Construction Materials",
  "Fragile Goods",
  "Hazardous Cargo",
  "Mixed Cargo"
]);

// Stay just below PostgreSQL NUMERIC(18, 2)'s precision boundary. JavaScript
// cannot precisely represent its fractional maximum (.99) at this magnitude.
// Keep this limit in the API so oversized values return a useful 400 response
// instead of a database range error.
const MAX_CAPACITY = 999999999999999;

const textValue = (value) => {
  if (value === undefined || value === null) return null;
  return String(value).trim() || null;
};

const readLetter = (value, label) => {
  const letter = textValue(value)?.toUpperCase();
  if (!letter || !/^[A-Z]$/.test(letter)) {
    throw buildError(`${label} must be one alphabet letter.`, 400);
  }
  return letter;
};

const readIdentifier = (value) => {
  const identifier = textValue(value)?.toUpperCase();
  if (!identifier || !/^[A-Z0-9]+$/.test(identifier)) {
    throw buildError("Bin identifier must contain one or more letters or numbers.", 400);
  }
  return identifier;
};

const readPositiveNumber = (value, label, fallback = null) => {
  if ((value === undefined || value === null || value === "") && fallback !== null) {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw buildError(`${label} must be a number greater than zero.`, 400);
  }
  if (number > MAX_CAPACITY) {
    throw buildError(`${label} cannot exceed ${MAX_CAPACITY.toLocaleString("en-US")}.`, 400);
  }
  return number;
};

const readOptionalPositiveNumber = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  return readPositiveNumber(value, label);
};

const readConfigurationStatus = (value, fallback = "Active") => {
  const status = textValue(value) || fallback;
  const normalized = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  if (!["Active", "Inactive"].includes(normalized)) {
    throw buildError("Status must be Active or Inactive.", 400);
  }
  return normalized;
};

const resolveLifecycleState = ({ status, existingStatus = "Active" }) => {
  const normalizedStatus = readConfigurationStatus(status, existingStatus);
  return {
    status: normalizedStatus,
    active: normalizedStatus === "Active"
  };
};

const resolveBinLifecycleState = ({ creationStatus, existingStatus = "Available" }) => {
  const normalizedCreationStatus = readConfigurationStatus(creationStatus, existingStatus || "Active");
  const active = normalizedCreationStatus === "Active";
  return {
    creationStatus: normalizedCreationStatus,
    status: active ? (existingStatus && existingStatus !== "Inactive" ? existingStatus : "Available") : "Inactive",
    active
  };
};

const readThresholds = (body = {}, defaults = {}) => {
  const warning = Number(
    body.occupancy_warning_threshold ?? defaults.occupancy_warning_threshold ?? 80
  );
  const full = Number(body.full_threshold ?? defaults.full_threshold ?? 100);
  if (!Number.isFinite(warning) || warning <= 0 || warning >= 100) {
    throw buildError("Occupancy warning threshold must be greater than 0 and less than 100.", 400);
  }
  if (!Number.isFinite(full) || full <= warning || full > 100) {
    throw buildError("Full threshold must be greater than the warning threshold and at most 100.", 400);
  }
  return { warning, full };
};

const ensureCargoType = (value) => {
  const cargoType = textValue(value);
  if (!cargoType || !CARGO_TYPES.includes(cargoType)) {
    throw buildError("Select a valid predefined cargo type.", 400);
  }
  return cargoType;
};

const normalizeWarehouseStatusForApi = (status) => (
  String(status || "").toLowerCase() === "active" ? "Active" : "Inactive"
);

const auditConfigurationAttempt = async (req, res, next) => {
  try {
    await writeAuditLog({
      user_id: req.auth?.userId || null,
      action: "WAREHOUSE_CONFIGURATION_ATTEMPT",
      module: "Warehouse Configuration",
      description: `${req.method} ${req.baseUrl}${req.path}`,
      metadata: {
        method: req.method,
        path: `${req.baseUrl}${req.path}`,
        record_id: req.params?.id || null,
        requested_status: req.body?.status || req.body?.operational_status || null
      }
    });
    next();
  } catch (error) {
    next(error);
  }
};

const recordRejectedAttempt = async (req, error) => {
  try {
    await writeAuditLog({
      user_id: req.auth?.userId || null,
      action: "WAREHOUSE_CONFIGURATION_REJECTED",
      module: "Warehouse Configuration",
      description: error.message,
      metadata: {
        method: req.method,
        path: `${req.baseUrl}${req.path}`,
        record_id: req.params?.id || null,
        status_code: error.statusCode || 500
      }
    });
  } catch {
    // The original validation/database error remains authoritative.
  }
};

const getEntityReferenceCount = async (client, entityType, id) => {
  const checks = {
    Warehouse: [
      ["zones", "warehouse_id"],
      ["cargo", "warehouse_id"],
      ["cargo", "warehouse_id_at_registration"],
      ["users", "warehouse_id"],
      ["audit_logs", "warehouse_id_at_action"]
    ],
    Zone: [["racks", "zone_id"]],
    Rack: [["levels", "rack_id"]],
    Level: [["bins", "level_id"]],
    Bin: [
      ["cargo", "current_bin_id"],
      ["cargo_movements", "from_bin_id"],
      ["cargo_movements", "to_bin_id"],
      ["cargo_locations", "bin_id"],
      ["placement_validation_logs", "bin_id"],
      ["bin_barcode_print_logs", "bin_id"]
    ]
  };
  let count = 0;
  for (const [table, column] of checks[entityType] || []) {
    const result = await client.query(
      `SELECT COUNT(*)::int AS count FROM ${table} WHERE ${column} = $1`,
      [id]
    );
    count += Number(result.rows[0]?.count || 0);
  }
  return count;
};

const ensureCapacityFitsParent = ({
  childWeight,
  childVolume,
  parentWeight,
  parentVolume,
  allowOverride = false,
  childLabel
}) => {
  if (allowOverride) return;
  if (parentWeight > 0 && childWeight > parentWeight) {
    throw buildError(`${childLabel} maximum weight cannot exceed its parent capacity.`, 400);
  }
  if (parentVolume > 0 && childVolume > parentVolume) {
    throw buildError(`${childLabel} maximum volume cannot exceed its parent capacity.`, 400);
  }
};

module.exports = {
  CARGO_TYPES,
  MAX_CAPACITY,
  auditConfigurationAttempt,
  ensureCapacityFitsParent,
  ensureCargoType,
  getEntityReferenceCount,
  normalizeWarehouseStatusForApi,
  readConfigurationStatus,
  readIdentifier,
  readLetter,
  readOptionalPositiveNumber,
  readPositiveNumber,
  readThresholds,
  recordRejectedAttempt,
  resolveBinLifecycleState,
  resolveLifecycleState,
  textValue
};

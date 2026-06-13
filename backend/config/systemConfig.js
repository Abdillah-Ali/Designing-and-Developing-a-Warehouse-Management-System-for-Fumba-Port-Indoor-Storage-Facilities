const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const parseJsonSetting = (name, fallback) => {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must contain valid JSON.`);
  }
};

const roleNames = Object.freeze({
  systemAdmin: process.env.SYSTEM_ADMIN_ROLE_NAME || "System Admin",
  warehouseStaff: process.env.WAREHOUSE_STAFF_ROLE_NAME || "Warehouse Staff",
  warehouseSupervisor: process.env.WAREHOUSE_SUPERVISOR_ROLE_NAME || "Supervisor"
});

const defaultRoleDefinitions = Object.freeze(parseJsonSetting("WMS_ROLE_DEFINITIONS_JSON", [
  {
    name: roleNames.systemAdmin,
    description: "Full access to system configuration, user management, monitoring, and audit supervision."
  },
  {
    name: roleNames.warehouseStaff,
    description: "Operational access for cargo registration, placement scanning, cargo tracking, and dispatch preparation."
  },
  {
    name: roleNames.warehouseSupervisor,
    description: "Warehouse Supervisor access for cargo approvals, placement exceptions, dispatch authorization, and operational monitoring."
  }
]));

const defaultShifts = Object.freeze(parseJsonSetting("WMS_DEFAULT_SHIFTS_JSON", [
  { name: "Morning Shift", start: "06:00", end: "14:00" },
  { name: "Evening Shift", start: "14:00", end: "22:00" },
  { name: "Night Shift", start: "22:00", end: "06:00" }
]));

const rejectionConditions = Object.freeze(parseJsonSetting("WMS_REJECTION_CONDITIONS_JSON", {
  DUPLICATE_REGISTRATION: "Duplicate cargo registration exists.",
  MISSING_DOCUMENTS: "Required documents are missing.",
  FRAUDULENT_INFORMATION: "Cargo information is fraudulent or intentionally incorrect.",
  OWNERSHIP_UNVERIFIED: "Consignee or ownership cannot be verified.",
  PROHIBITED_CARGO: "Cargo is prohibited from warehouse storage.",
  SAFETY_RISK: "Cargo condition creates a safety risk.",
  INVALID_HAZARD_CLASSIFICATION: "Hazardous cargo classification is missing or invalid.",
  REGISTERED_IN_ERROR: "Cargo was registered in error and should not exist in the system."
}));

const documentTypes = Object.freeze(parseJsonSetting("CARGO_DOCUMENT_TYPES_JSON", {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "image/jpeg": ".jpg",
  "image/png": ".png"
}));

const configuredUploadRoot = process.env.CARGO_DOCUMENT_UPLOAD_ROOT;
const documentUploadRoot = configuredUploadRoot
  ? path.resolve(configuredUploadRoot)
  : path.join(__dirname, "..", "uploads", "cargo-documents");
const configuredMaxBytes = Number(process.env.CARGO_DOCUMENT_MAX_BYTES || 10 * 1024 * 1024);
const documentMaxBytes = Number.isFinite(configuredMaxBytes)
  ? Math.max(1, configuredMaxBytes)
  : 10 * 1024 * 1024;

module.exports = {
  defaultRoleDefinitions,
  defaultShifts,
  documentMaxBytes,
  documentTypes,
  documentUploadRoot,
  rejectionConditions,
  roleNames
};

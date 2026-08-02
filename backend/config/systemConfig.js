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
  warehouseSupervisor: process.env.WAREHOUSE_SUPERVISOR_ROLE_NAME || "Supervisor",
  financeOfficer: process.env.FINANCE_OFFICER_ROLE_NAME || "Finance Officer",
  customsOfficer: process.env.CUSTOMS_OFFICER_ROLE_NAME || "Customs Officer",
  gateOfficer: process.env.GATE_OFFICER_ROLE_NAME || "Gate Officer",
  management: process.env.MANAGEMENT_ROLE_NAME || "Management",
  scanner: process.env.SCANNER_ROLE_NAME || "Scanner"
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
  },
  {
    name: roleNames.financeOfficer,
    description: "Finance access for cargo charges, invoices, payments, tariffs, and financial reports."
  },
  {
    name: roleNames.customsOfficer,
    description: "Customs access for cargo inspection, document requests, holds, rejection, and clearance."
  },
  {
    name: roleNames.gateOfficer,
    description: "Gate access for dispatch validation, release eligibility checks, gate-out confirmation, and emergency release requests."
  },
  {
    name: roleNames.management,
    description: "Read-only executive access to cross-module KPIs, analytics, reports, and notifications."
  },
  {
    name: roleNames.scanner,
    description: "Dedicated barcode scanner identity permanently linked to one active user for scan-only workflows."
  }
]));

const defaultShifts = Object.freeze([]);

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

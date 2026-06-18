const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatLocation,
  getNextPlacementStatus,
  normalizeManualReason,
  normalizePlacementRequest
} = require("../services/placementService");
const {
  isCargoAllowedByBinCategory,
  isCargoAllowedInZone,
  validatePlacement
} = require("../services/validationService");
const {
  PORTAL_ROLES,
  canAccessRoute
} = require("../middleware/authMiddleware");

test("scan placement normalizes the requested cargo and scanned labels", () => {
  const request = normalizePlacementRequest({
    cargo_id: "CARGO-2026-00001",
    placement_mode: "scan",
    scanned_cargo_barcode: "cargo-2026-00001",
    scanned_bin_barcode: "bin-d01-l1-02"
  });

  assert.equal(request.cargo_id, "CARGO-2026-00001");
  assert.equal(request.placement_mode, "scan");
  assert.equal(request.scanned_cargo_barcode, "cargo-2026-00001");
  assert.equal(request.scanned_bin_barcode, "bin-d01-l1-02");
});

test("manual placement requires and normalizes an approved fallback reason", () => {
  const request = normalizePlacementRequest({
    cargo_id: "CARGO-2026-00001",
    placement_mode: "manual",
    bin_id: "BIN-D01-L1-02",
    manual_placement_reason: "Damaged barcode"
  });

  assert.equal(request.manual_placement_reason, "damaged_barcode");
  assert.equal(normalizeManualReason("supervisor-approved operation"), "supervisor_approved");
  assert.throws(
    () => normalizePlacementRequest({
      cargo_id: "CARGO-2026-00001",
      placement_mode: "manual",
      bin_id: "BIN-D01-L1-02"
    }),
    /Manual placement reason/
  );
});

test("scan validation stops when scanned cargo differs from selected cargo", async () => {
  const executor = {
    query: async (sql) => {
      if (sql.includes("FROM cargo")) {
        return {
          rowCount: 1,
          rows: [{
            id: 2,
            cargo_id: "CARGO-2026-00002",
            barcode: "CARGO-2026-00002",
            is_deleted: false
          }]
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const validation = await validatePlacement({
    cargo_id: "CARGO-2026-00001",
    placement_mode: "scan",
    scanned_cargo_barcode: "CARGO-2026-00002",
    scanned_bin_barcode: "BIN-D01-L1-02"
  }, executor);

  assert.equal(validation.approved, false);
  assert.equal(validation.reason, "Cargo Scan Mismatch");
  assert.equal(validation.detail, "Scanned cargo does not match selected cargo.");
});

test("placement locations use the complete warehouse hierarchy", () => {
  assert.equal(
    formatLocation({
      zone_code: "Z-D",
      rack_code: "R-D01",
      level_code: "L1",
      barcode: "BIN-D01-L1-02"
    }),
    "Unknown WH → Z-D → R-D01 → L1 → 02"
  );
});

test("mandatory cargo compatibility follows the official zone matrix", () => {
  assert.equal(isCargoAllowedInZone("Food Products", "Z-A"), false);
  assert.equal(isCargoAllowedInZone("Food Products", "Z-D"), true);
  assert.equal(isCargoAllowedInZone("Food Products", "Z-H"), true);
  assert.equal(isCargoAllowedInZone("Hazardous Cargo", "Z-G"), true);
  assert.equal(isCargoAllowedInZone("Hazardous Cargo", "Z-H"), false);
  assert.equal(isCargoAllowedInZone("Mixed Cargo", "Z-H"), true);
  assert.equal(isCargoAllowedInZone("Mixed Cargo", "Z-A"), false);
});

test("bin cargo categories can narrow mixed-zone storage without weakening hazard rules", () => {
  assert.equal(isCargoAllowedByBinCategory("Food Products", "Mixed Cargo"), true);
  assert.equal(isCargoAllowedByBinCategory("Hazardous Cargo", "Mixed Cargo"), false);
  assert.equal(isCargoAllowedByBinCategory("Electronics", "Electronics"), true);
  assert.equal(isCargoAllowedByBinCategory("General Goods", "Electronics"), false);
});

test("compatibility and capacity checks cannot be disabled or supervisor-overridden", async () => {
  const executor = {
    query: async (sql) => {
      if (sql.includes("FROM cargo")) {
        return {
          rowCount: 1,
          rows: [{
            id: 1,
            cargo_id: "CARGO-2026-00001",
            barcode: "CARGO-2026-00001",
            cargo_type: "Food Products",
            weight: 600,
            volume: 2,
            registration_status: "Approved",
            placement_status: "Unplaced",
            is_deleted: false
          }]
        };
      }
      if (sql.includes("FROM bins b")) {
        return {
          rowCount: 1,
          rows: [{
            id: 2,
            code: "BIN-A01-L1-01",
            barcode: "BIN-A01-L1-01",
            status: "Available",
            active: true,
            level_active: true,
            rack_active: true,
            zone_active: true,
            zone_code: "Z-A",
            zone_name: "General Goods",
            zone_type: "Standard",
            allowed_cargo_type: "General Goods",
            is_hazard_zone: false,
            max_weight: 500,
            max_volume: 4,
            current_weight: 0,
            current_volume: 0,
            level_code: "L1",
            rack_code: "R-A01"
          }]
        };
      }
      if (sql.includes("FROM bin_rules")) {
        return {
          rowCount: 4,
          rows: [
            { rule_key: "compatibility", is_active: false, parameters: {} },
            { rule_key: "weight", is_active: false, parameters: {} },
            { rule_key: "volume", is_active: false, parameters: {} },
            { rule_key: "hazardous", is_active: false, parameters: {} }
          ]
        };
      }
      if (sql.includes("FROM approval_requests")) {
        return {
          rowCount: 1,
          rows: [{
            id: 9,
            cargo_id: 1,
            request_type: "PLACEMENT_OVERRIDE",
            status: "Approved",
            request_data: { bin_id: 2 }
          }]
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const validation = await validatePlacement({
    cargo_id: "CARGO-2026-00001",
    placement_mode: "manual",
    bin_id: "BIN-A01-L1-01",
    approval_request_id: 9
  }, executor);

  assert.equal(validation.approved, false);
  assert.equal(validation.checks.cargoCompatibility.passed, false);
  assert.equal(validation.checks.weightCapacity.passed, false);
});

test("repeated confirmations preserve a relocated cargo status", () => {
  assert.equal(
    getNextPlacementStatus({
      alreadyPlacedInThisBin: true,
      currentStatus: "Relocated",
      isRelocation: false
    }),
    "Relocated"
  );
  assert.equal(
    getNextPlacementStatus({
      alreadyPlacedInThisBin: false,
      currentStatus: "Placed",
      isRelocation: true
    }),
    "Relocated"
  );
});

test("manual placement setting is readable by staff and editable only by supervisors and admins", () => {
  assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "GET", "/placement/settings"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "PUT", "/placement/settings"), false);
  assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "PUT", "/placement/settings"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.SYSTEM_ADMIN, "PUT", "/placement/settings"), true);
});

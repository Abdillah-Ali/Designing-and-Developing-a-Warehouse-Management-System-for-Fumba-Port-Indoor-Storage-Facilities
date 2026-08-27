const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../config/db");

const { validatePlacement: validatePlacementController } = require("../controllers/placementController");
const {
  confirmPlacementOperation,
  formatLocation,
  getNextPlacementStatus,
  normalizeManualReason,
  normalizePlacementRequest,
  validatePlacementOperation
} = require("../services/placementService");
const {
  validatePlacement
} = require("../services/validationService");
const {
  PORTAL_ROLES,
  canAccessRoute
} = require("../middleware/authMiddleware");

const basePlacementPayload = () => ({
  cargo_id: "CARGO-2026-OWN",
  placement_mode: "scan",
  scanned_cargo_barcode: "CARGO-2026-OWN",
  scanned_bin_barcode: "BIN-A01-L1-01"
});

const configuredPlacementRules = () => [
  { public_reference: "BR-CAPACITY", rule_code: "admin_capacity", rule_name: "Capacity", rule_type: "validation", evaluator_type: "capacity_limits", execution_targets: ["placement_confirmation", "placement_recommendation", "relocation"], violation_action: "block", severity: "critical", priority: 10, parameters: { enforce_weight: true, enforce_volume: true } },
  { public_reference: "BR-COMPATIBILITY", rule_code: "admin_compatibility", rule_name: "Compatibility", rule_type: "validation", evaluator_type: "cargo_storage_compatibility", execution_targets: ["placement_confirmation", "placement_recommendation", "relocation"], violation_action: "block", severity: "critical", priority: 20, parameters: {} },
  { public_reference: "BR-HAZARD", rule_code: "admin_hazard", rule_name: "Hazard", rule_type: "validation", evaluator_type: "hazard_zone_compatibility", execution_targets: ["placement_confirmation", "placement_recommendation", "relocation"], violation_action: "block", severity: "critical", priority: 30, parameters: { hazardous_cargo_type_key: "hazardous_cargo" } },
  { public_reference: "BR-STATUS", rule_code: "admin_status", rule_name: "Storage Status", rule_type: "validation", evaluator_type: "storage_status", execution_targets: ["placement_confirmation", "placement_recommendation", "relocation"], violation_action: "block", severity: "critical", priority: 40, parameters: { allowed_statuses: ["Available", "Occupied"] } },
  { public_reference: "BR-RESERVED", rule_code: "admin_reserved", rule_name: "Reserved Storage", rule_type: "validation", evaluator_type: "reserved_storage", execution_targets: ["placement_confirmation", "placement_recommendation", "relocation"], violation_action: "block", severity: "high", priority: 50, parameters: {} },
  { public_reference: "BR-RESTRICTED", rule_code: "admin_restricted", rule_name: "Restricted Zone", rule_type: "validation", evaluator_type: "restricted_zone_approval", execution_targets: ["placement_confirmation", "placement_recommendation", "relocation"], violation_action: "supervisor_approval", severity: "high", priority: 60, parameters: { restricted_zone_type: "Restricted" } },
  { public_reference: "BR-CUSTOMS", rule_code: "admin_customs", rule_name: "Customs Hold", rule_type: "validation", evaluator_type: "customs_hold_storage", execution_targets: ["placement_confirmation", "placement_recommendation", "relocation"], violation_action: "block", severity: "high", priority: 70, parameters: { hold_marker: "hold", storage_marker: "customs hold" } },
  { public_reference: "BR-FRAGILE", rule_code: "admin_fragile", rule_name: "Fragile Handling", rule_type: "validation", evaluator_type: "fragile_handling", execution_targets: ["placement_confirmation", "placement_recommendation", "relocation"], violation_action: "block", severity: "high", priority: 80, parameters: { cargo_type_key: "fragile_goods", handling_marker: "fragile" } }
];

const mockResponse = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
};

const createPlacementQueryMock = ({
  ownerUserId = 10,
  cargoWarehouseId = 1,
  currentBinId = null,
  registrationStatus = "Approved",
  binOverrides = {}
} = {}) => {
  const queries = [];
  const cargo = {
    id: 101,
    cargo_id: "CARGO-2026-OWN",
    barcode: "CARGO-2026-OWN",
    cargo_type: "General Goods",
    cargo_type_key: "general_goods",
    weight: 10,
    volume: 1,
    hazard_class: null,
    registration_status: registrationStatus,
    placement_status: currentBinId ? "Placed" : "Unplaced",
    warehouse_id: cargoWarehouseId,
    current_bin_id: currentBinId,
    location: currentBinId ? "WH-A -> Z-A -> R-A01 -> L1 -> 01" : null,
    relocation_required: false,
    relocation_reason: null,
    assigned_staff_id: ownerUserId,
    created_by: 77,
    received_by_user_id: 88,
    is_deleted: false
  };
  const bin = {
    id: 202,
    bin_id: 202,
    code: "BIN-A01-L1-01",
    barcode: "BIN-A01-L1-01",
    status: "Available",
    active: true,
    level_id: 301,
    level_code: "L1",
    level_active: true,
    rack_id: 401,
    rack_code: "R-A01",
    rack_active: true,
    zone_id: 501,
    zone_code: "Z-A",
    zone_name: "General Goods",
    zone_type: "Standard",
    zone_allowed_cargo_type: "General Goods",
    zone_allowed_cargo_type_key: "general_goods",
    allowed_cargo_type: "General Goods",
    allowed_cargo_type_key: "general_goods",
    is_hazard_zone: false,
    zone_active: true,
    warehouse_id: cargoWarehouseId,
    warehouse_name: "Warehouse A",
    warehouse_code: "WH-A",
    max_weight: 100,
    max_volume: 10,
    current_weight: 0,
    current_volume: 0,
    reserved_for_cargo_type: null,
    ...binOverrides
  };

  const query = async (sql, params = []) => {
    queries.push({ sql, params });

    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes("SELECT COALESCE(assigned_staff_id")) {
      return { rowCount: 1, rows: [{ owner_user_id: ownerUserId }] };
    }
    if (sql.includes("SELECT * FROM cargo") && sql.includes("id::text")) {
      return { rowCount: 1, rows: [cargo] };
    }
    if (sql.includes("SELECT * FROM cargo WHERE id=$1 AND is_deleted=FALSE")) {
      return { rowCount: 1, rows: [cargo] };
    }
    if (sql.includes("SELECT * FROM cargo WHERE id = $1")) {
      return { rowCount: 1, rows: [cargo] };
    }
    if (sql.includes("FROM bins b") && sql.includes("WHERE b.id::text")) {
      return { rowCount: 1, rows: [bin] };
    }
    if (sql.includes("FROM bins b") && sql.includes("WHERE b.id = ANY")) {
      return { rowCount: 1, rows: [bin] };
    }
    if (sql.includes("FROM bin_rules")) {
      const rows = configuredPlacementRules();
      return { rowCount: rows.length, rows };
    }
    if (sql.includes("FROM workflow_definitions wd")) {
      const relocation = cargo.placement_status !== "Unplaced";
      return { rowCount: 1, rows: [{ workflow_key: "cargo_placement", revision: 1, active_revision: 1,
        transition_key: relocation ? "relocate_cargo" : "confirm_placement",
        from_state_key: relocation ? "placed" : "unplaced", to_state_key: relocation ? "relocated" : "placed",
        to_storage_value: relocation ? "Relocated" : "Placed", required_permission_key: "placement.confirm",
        notes_requirement: "none", confirmation_requirement: true,
        conditions: [{ condition_key: "cargo_not_archived", parameters: {} }], effects: ["update_placement_state"], audit_event_key: "CARGO_WORKFLOW_PLACEMENT" }] };
    }
    if (sql.includes("FROM role_permissions")) return { rowCount: 1, rows: [{ "?column?": 1 }] };
    if (sql.includes("INSERT INTO workflow_transition_history")) return { rowCount: 1, rows: [{ id: 707 }] };
    if (sql.includes("FROM approval_requests")) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.startsWith("UPDATE bins")) {
      return {
        rowCount: 1,
        rows: [{
          ...bin,
          current_weight: Number(bin.current_weight) + Number(cargo.weight),
          current_volume: Number(bin.current_volume) + Number(cargo.volume),
          status: "Occupied"
        }]
      };
    }
    if (sql.startsWith("UPDATE cargo")) {
      return {
        rowCount: 1,
        rows: [{
          ...cargo,
          placement_status: params[0],
          location: params[1],
          current_bin_id: params[2]
        }]
      };
    }
    if (sql.includes("INSERT INTO cargo_movements")) {
      return {
        rowCount: 1,
        rows: [{
          id: 303,
          cargo_id: params[0],
          from_bin_id: params[1],
          to_bin_id: params[2],
          action: params[8]
        }]
      };
    }
    if (sql.includes("UPDATE cargo_locations")) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes("INSERT INTO cargo_locations")) {
      return { rowCount: 1, rows: [{ id: 404 }] };
    }
    if (sql.includes("INSERT INTO placement_validation_logs")) {
      return { rowCount: 1, rows: [{ id: 505 }] };
    }
    if (sql.includes("INSERT INTO audit_logs")) {
      return { rowCount: 1, rows: [{ id: 606 }] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  };

  return { query, queries, cargo, bin };
};

const withMockDbQuery = async (query, run) => {
  const originalQuery = db.query;
  db.query = query;
  try {
    await run();
  } finally {
    db.query = originalQuery;
  }
};

const withMockPlacementClient = async (query, run) => {
  const originalConnect = db.pool.connect;
  const client = {
    query,
    release: () => {}
  };
  db.pool.connect = async () => client;
  try {
    await run();
  } finally {
    db.pool.connect = originalConnect;
  }
};

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

test("scan validation uses the scanned cargo even when another cargo started the session", async () => {
  const mock = createPlacementQueryMock();
  const validation = await validatePlacement({
    cargo_id: "CARGO-THAT-STARTED-THE-SESSION",
    placement_mode: "scan",
    operation_type: "placement",
    scanned_cargo_barcode: "CARGO-2026-OWN",
    scanned_bin_barcode: "BIN-A01-L1-01"
  }, { query: mock.query });

  assert.equal(validation.approved, true);
  assert.equal(validation.cargo.cargo_id, "CARGO-2026-OWN");
  assert.equal(validation.operation_type, "placement");
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

test("placement fails closed when legacy rules do not provide trusted evaluator coverage", async () => {
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
  assert.equal(validation.approved, false);
  assert.equal(validation.checks.ruleEngineReadiness.passed, false);
  assert.match(validation.detail, /Missing capabilities/);
});

test("placement validation rejects cargo before supervisor approval", async () => {
  for (const registrationStatus of ["Pending Review", "Correction Required", "Rejected"]) {
    const mock = createPlacementQueryMock({ registrationStatus });
    const validation = await validatePlacement(basePlacementPayload(), { query: mock.query });

    assert.equal(validation.approved, false);
    assert.equal(validation.checks.cargoPlacementStatus.passed, false);
    assert.match(validation.detail, /approved|Rejected|correction/i);
  }
});

test("manual placement cannot bypass supervisor approval", async () => {
  const mock = createPlacementQueryMock({ registrationStatus: "Pending Review" });
  const validation = await validatePlacement({
    cargo_id: "CARGO-2026-OWN",
    placement_mode: "manual",
    bin_id: "202",
    manual_placement_reason: "supervisor_approved"
  }, { query: mock.query });

  assert.equal(validation.approved, false);
  assert.equal(validation.reason, "Pending Supervisor Approval");
  assert.equal(
    validation.detail,
    "Cargo has not yet been approved by the Warehouse Supervisor. Placement cannot begin until registration is approved."
  );
});

test("placement rejects cargo that has already been placed", async () => {
  const mock = createPlacementQueryMock({ currentBinId: 999 });
  const validation = await validatePlacement({
    ...basePlacementPayload(),
    operation_type: "placement"
  }, { query: mock.query });

  assert.equal(validation.approved, false);
  assert.equal(validation.reason, "Cargo Already Placed");
  assert.equal(validation.detail, "Cargo has already been placed.");
});

test("relocation requires placed cargo and a different destination bin", async () => {
  const unplacedMock = createPlacementQueryMock();
  const unplacedValidation = await validatePlacement({
    ...basePlacementPayload(),
    operation_type: "relocation"
  }, { query: unplacedMock.query });

  assert.equal(unplacedValidation.approved, false);
  assert.equal(unplacedValidation.reason, "Cargo Not Placed");

  const sameBinMock = createPlacementQueryMock({ currentBinId: 202 });
  const sameBinValidation = await validatePlacement({
    ...basePlacementPayload(),
    operation_type: "relocation"
  }, { query: sameBinMock.query });

  assert.equal(sameBinValidation.approved, false);
  assert.equal(sameBinValidation.reason, "Same Bin Relocation");
  assert.equal(sameBinValidation.detail, "Cargo cannot be relocated to its current bin.");
  assert.equal(sameBinValidation.checks.destinationDifferent.passed, false);
});

test("relocation rejects an unknown destination bin", async () => {
  const mock = createPlacementQueryMock({ currentBinId: 999 });
  const validation = await validatePlacement({
    ...basePlacementPayload(),
    operation_type: "relocation",
    scanned_bin_barcode: "BIN-DOES-NOT-EXIST"
  }, {
    query: async (sql, params) => {
      if (sql.includes("FROM bins b")) return { rowCount: 0, rows: [] };
      return mock.query(sql, params);
    }
  });

  assert.equal(validation.approved, false);
  assert.equal(validation.reason, "Bin Not Found");
  assert.equal(validation.detail, "Destination bin does not exist.");
});

test("relocation applies destination compatibility and capacity rules", async () => {
  const mock = createPlacementQueryMock({
    currentBinId: 999,
    binOverrides: {
      zone_code: "Z-D",
      zone_allowed_cargo_type: "Food Products",
      zone_allowed_cargo_type_key: "food_products",
      allowed_cargo_type: "Food Products",
      allowed_cargo_type_key: "food_products",
      max_weight: 5,
      max_volume: 0.5
    }
  });
  const validation = await validatePlacement({
    ...basePlacementPayload(),
    operation_type: "relocation"
  }, { query: mock.query });

  assert.equal(validation.approved, false);
  assert.equal(validation.checks["rule:BR-COMPATIBILITY"].passed, false);
  assert.equal(validation.checks["rule:BR-CAPACITY"].passed, false);
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

test("staff can confirm placement for cargo they own", async () => {
  const mock = createPlacementQueryMock({ ownerUserId: 10 });

  await withMockPlacementClient(mock.query, async () => {
    const result = await confirmPlacementOperation(basePlacementPayload(), {
      role: "warehouse-staff",
      userId: 10,
      username: "staff-a",
      warehouseId: 1
    });

    assert.equal(result.rejected, false);
    assert.equal(result.cargo.current_bin_id, 202);
    assert.equal(result.movement.to_bin_id, 202);
    assert.equal(result.movement.action, "Placed");
    assert.equal(mock.queries.some((entry) => entry.sql.includes("WHERE id=$1 AND is_deleted=FALSE")), true);
  });
});

test("staff cannot validate another staff user's cargo in the same warehouse", async () => {
  const mock = createPlacementQueryMock({ ownerUserId: 10 });

  await assert.rejects(
    () => validatePlacementOperation(basePlacementPayload(), {
      role: "warehouse-staff",
      userId: 20,
      username: "staff-b",
      warehouseId: 1
    }, { query: mock.query }),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, "Cargo record not found.");
      return true;
    }
  );
});

test("staff cannot confirm placement for cargo whose historical owner was transferred", async () => {
  const mock = createPlacementQueryMock({ ownerUserId: 10 });

  await withMockPlacementClient(mock.query, async () => {
    await assert.rejects(
      () => confirmPlacementOperation(basePlacementPayload(), {
        role: "warehouse-staff",
        userId: 20,
        username: "staff-b",
        warehouseId: 1
      }),
      /Cargo record not found/
    );
  });

  assert.equal(mock.queries.some((entry) => entry.sql.startsWith("UPDATE cargo")), false);
  assert.equal(mock.queries.some((entry) => entry.sql.startsWith("UPDATE bins")), false);
});

test("supervisor can review placement activity for warehouse cargo without staff ownership", async () => {
  const mock = createPlacementQueryMock({ ownerUserId: 10 });

  assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "GET", "/supervisor/placement-summary"), true);

  const { validation } = await validatePlacementOperation(basePlacementPayload(), {
    role: "warehouse-supervisor",
    userId: 30,
    username: "supervisor-a",
    warehouseId: 1
  }, { query: mock.query });

  assert.equal(validation.approved, true);
  assert.equal(mock.queries.some((entry) => entry.sql.includes("SELECT COALESCE(assigned_staff_id")), false);
});

test("system admin can confirm placement without staff ownership", async () => {
  const mock = createPlacementQueryMock({ ownerUserId: 10 });

  await withMockPlacementClient(mock.query, async () => {
    const result = await confirmPlacementOperation(basePlacementPayload(), {
      role: "system-admin",
      userId: 1,
      username: "admin"
    });

    assert.equal(result.rejected, false);
    assert.equal(result.cargo.current_bin_id, 202);
  });

  assert.equal(mock.queries.some((entry) => entry.sql.includes("SELECT COALESCE(assigned_staff_id")), false);
});

test("placement validation logs staff ownership failures", async () => {
  const mock = createPlacementQueryMock({ ownerUserId: 10 });
  let placementFailureLogged = false;

  const query = async (sql, params = []) => {
    if (sql.includes("INSERT INTO placement_validation_logs")) {
      placementFailureLogged = true;
    }
    return mock.query(sql, params);
  };

  await withMockDbQuery(query, async () => {
    const req = {
      body: basePlacementPayload(),
      auth: {
        role: "warehouse-staff",
        userId: 20,
        username: "staff-b",
        warehouseId: 1
      }
    };
    const res = mockResponse();
    let nextError = null;

    await validatePlacementController(req, res, (error) => {
      nextError = error;
    });

    assert.equal(nextError.statusCode, 404);
    assert.equal(res.body, null);
    assert.equal(placementFailureLogged, true);
  });
});

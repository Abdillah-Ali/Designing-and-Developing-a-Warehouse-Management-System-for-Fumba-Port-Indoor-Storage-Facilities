const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../config/db");
const {
  PLACEMENT_OPERATION,
  getPlacementCargoValidationError,
  getPlacementOperation,
  isStepTransitionDuplicate,
  submitScan
} = require("../services/scannerSessionService");

test("immediate cargo frame duplicates are ignored after advancing to the bin step", () => {
  const acceptedAt = Date.parse("2026-07-09T08:00:00.000Z");
  const session = {
    current_step_index: 1,
    context: {
      scanned_cargo_barcode: "CARGO-2026-00002",
      cargo_scan_accepted_at: new Date(acceptedAt).toISOString()
    }
  };

  assert.equal(
    isStepTransitionDuplicate(session, "cargo-2026-00002", acceptedAt + 1000),
    true
  );
  assert.equal(
    isStepTransitionDuplicate(session, "BIN-A-03", acceptedAt + 1000),
    false
  );
  assert.equal(
    isStepTransitionDuplicate(session, "CARGO-2026-00002", acceptedAt + 3000),
    false
  );
});

test("scanner cargo validation is based on backend queue rules, not the session's original cargo", () => {
  const auth = { userId: 7, warehouseId: 3 };
  const unplacedCargo = {
    id: 22,
    assigned_staff_id: 7,
    warehouse_id: 3,
    registration_status: "Approved",
    placement_status: "Unplaced",
    current_bin_id: null,
    is_deleted: false
  };
  const placedCargo = {
    ...unplacedCargo,
    placement_status: "Placed",
    current_bin_id: 91
  };

  assert.equal(getPlacementOperation(unplacedCargo), PLACEMENT_OPERATION.PLACEMENT);
  assert.equal(getPlacementOperation(placedCargo), PLACEMENT_OPERATION.RELOCATION);
  assert.equal(
    getPlacementCargoValidationError(unplacedCargo, auth, PLACEMENT_OPERATION.PLACEMENT),
    null
  );
  assert.equal(
    getPlacementCargoValidationError(placedCargo, auth, PLACEMENT_OPERATION.PLACEMENT),
    "Cargo has already been placed."
  );
  assert.equal(
    getPlacementCargoValidationError(unplacedCargo, auth, PLACEMENT_OPERATION.RELOCATION),
    "Cargo is not currently placed and cannot be relocated."
  );
  assert.equal(
    getPlacementCargoValidationError(
      { ...unplacedCargo, registration_status: "Pending Review" },
      auth,
      PLACEMENT_OPERATION.PLACEMENT
    ),
    "Cargo is not eligible for placement."
  );
  assert.equal(
    getPlacementCargoValidationError(
      { ...unplacedCargo, assigned_staff_id: 99 },
      auth,
      PLACEMENT_OPERATION.PLACEMENT
    ),
    "Cargo is not in the placement queue."
  );
  assert.equal(
    getPlacementCargoValidationError(null, auth, PLACEMENT_OPERATION.PLACEMENT),
    "Cargo does not exist."
  );
});

test("a scanner session adopts a different valid scanned cargo", async () => {
  const originalQuery = db.query;
  const sessionRow = {
    id: 40,
    staff_user_id: 7,
    workflow_type: "cargo_placement",
    workflow_name: "Cargo Placement",
    status: "active",
    current_step_index: 0,
    steps: [
      { key: "cargo", scan_type: "cargo", instruction: "Scan Cargo Barcode" },
      { key: "bin", scan_type: "bin", instruction: "Scan Bin Barcode" }
    ],
    context: {
      operation_type: "placement",
      cargo_db_id: 1,
      cargo_id: "CARGO-ORIGINAL",
      cargo_barcode: "CARGO-ORIGINAL"
    }
  };
  const scannedCargo = {
    id: 2,
    cargo_id: "CARGO-SCANNED",
    barcode: "CARGO-SCANNED",
    cargo_type: "General Goods",
    registration_status: "Approved",
    placement_status: "Unplaced",
    current_bin_id: null,
    warehouse_id: 3,
    assigned_staff_id: 7,
    is_deleted: false
  };

  db.query = async (sql, values = []) => {
    if (sql.includes("FROM scanner_sessions") && sql.includes("WHERE id = $1")) {
      return { rowCount: 1, rows: [sessionRow] };
    }
    if (sql.includes("FROM users staff")) {
      return {
        rowCount: 1,
        rows: [{
          id: 7,
          username: "staff",
          full_name: "Warehouse Staff",
          warehouse_id: 3,
          shift_id: 1,
          status: "active",
          role_name: "Warehouse Staff"
        }]
      };
    }
    if (sql.includes("FROM cargo")) {
      return { rowCount: 1, rows: [scannedCargo] };
    }
    if (sql.includes("SELECT u.id, u.username")) {
      return {
        rowCount: 1,
        rows: [{
          id: 7,
          username: "staff",
          warehouse_id: 3,
          shift_id: 1
        }]
      };
    }
    if (sql.startsWith("UPDATE scanner_sessions")) {
      return {
        rowCount: 1,
        rows: [{
          ...sessionRow,
          current_step_index: values[0],
          context: JSON.parse(values[1]),
          last_error: values[2],
          last_success: values[3]
        }]
      };
    }
    if (sql.includes("INSERT INTO audit_logs")) {
      return { rowCount: 1, rows: [{ id: 1 }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    const result = await submitScan(
      { sessionId: 40, barcode: "CARGO-SCANNED" },
      {
        role: "scanner",
        userId: 70,
        scannerStaffId: 7
      }
    );

    assert.equal(result.accepted, true);
    assert.equal(result.session.context.cargo_db_id, 2);
    assert.equal(result.session.context.cargo_id, "CARGO-SCANNED");
    assert.equal(result.session.current_step.scan_type, "bin");
  } finally {
    db.query = originalQuery;
  }
});

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
    isStepTransitionDuplicate(session, "cargo-2026-00002", acceptedAt + 1000, 3000),
    true
  );
  assert.equal(
    isStepTransitionDuplicate(session, "BIN-A-03", acceptedAt + 1000, 3000),
    false
  );
  assert.equal(
    isStepTransitionDuplicate(session, "CARGO-2026-00002", acceptedAt + 3000, 3000),
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
  const originalConnect = db.pool.connect;
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
    },
    expires_at: "2099-01-01T00:00:00.000Z",
    last_activity_at: "2026-08-13T00:00:00.000Z"
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
  let updatedContext = sessionRow.context;

  db.query = async (sql, values = []) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rowCount: 0, rows: [] };
    if (sql.includes("FROM system_setting_definitions")) {
      const key = values[0];
      const types = { scanner_session_timeout_minutes: "integer", scanner_duplicate_scan_window_ms: "duration_ms", scanner_session_cleanup_interval_ms: "duration_ms" };
      return { rowCount: 1, rows: [{ setting_key: key, value_type: types[key], criticality: "critical_policy", validation_schema: { minimum: 1 }, is_active: true }] };
    }
    if (sql.includes("FROM system_settings WHERE setting_key")) {
      const value = values[0] === "scanner_session_timeout_minutes" ? 20 : values[0] === "scanner_duplicate_scan_window_ms" ? 3000 : 60000;
      return { rowCount: 1, rows: [{ setting_value: value, revision: 1 }] };
    }
    if (sql.includes("SELECT * FROM scanner_sessions WHERE id=$1 FOR UPDATE")) return { rowCount: 1, rows: [sessionRow] };
    if (sql.includes("FROM scanner_scan_attempts")) return { rowCount: 0, rows: [] };
    if (sql.includes("INSERT INTO scanner_scan_attempts")) return { rowCount: 1, rows: [{ id: 1 }] };
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
          role_name: "Warehouse Staff",
          role_key: "warehouse_staff"
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
      if (sql.includes("status='expired'")) return { rowCount: 0, rows: [] };
      if (sql.includes("last_activity_at=CURRENT_TIMESTAMP")) return { rowCount: 1, rows: [{ ...sessionRow, current_step_index: 1, context: updatedContext, expires_at: "2099-01-01T00:20:00.000Z" }] };
      updatedContext = JSON.parse(values[1]);
      return {
        rowCount: 1,
        rows: [{
          ...sessionRow,
          current_step_index: values[0],
          context: updatedContext,
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
  db.pool.connect = async () => ({ query: (...args) => db.query(...args), release() {} });

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
    db.pool.connect = originalConnect;
  }
});

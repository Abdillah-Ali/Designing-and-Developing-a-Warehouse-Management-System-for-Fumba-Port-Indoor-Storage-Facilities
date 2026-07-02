const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ACTIVITY_TYPES,
  getPlacementActivity,
  getPlacementActivitySummary
} = require("../services/placementActivityService");

const staffRole = "Warehouse Staff";

const baseRow = (overrides = {}) => ({
  activity_id: "movement:1",
  source_table: "cargo_movements",
  source_id: 1,
  activity_type: ACTIVITY_TYPES.PLACEMENT_CONFIRMED,
  activity_timestamp: "2026-06-23T08:00:00.000Z",
  cargo_record_id: 100,
  cargo_identifier: "CARGO-2026-00100",
  cargo_barcode: "BAR-100",
  cargo_type: "General Goods",
  consignee_name: "Fumba Port",
  warehouse_id: 1,
  warehouse_name: "Warehouse A",
  warehouse_code: "WHA",
  performed_by: 10,
  performed_by_name: "Staff A",
  performed_by_username: "staff-a",
  performed_by_role_name: staffRole,
  assigned_staff_id: 10,
  created_by: 10,
  received_by_user_id: 10,
  from_bin_id: null,
  to_bin_id: 200,
  from_location: null,
  to_location: "WH-A -> Z-A -> R1 -> L1 -> B01",
  placement_mode: "scan",
  result: "success",
  reason: "Placed",
  detail: "Placed",
  metadata: {},
  ...overrides
});

const createExecutor = ({
  movements = [],
  validations = [],
  overrideRequests = [],
  overrideDecisions = [],
  audits = []
} = {}) => ({
  query: async (sql) => {
    if (sql.includes("FROM cargo_movements")) return { rowCount: movements.length, rows: movements };
    if (sql.includes("FROM placement_validation_logs")) return { rowCount: validations.length, rows: validations };
    if (sql.includes("'override-request:'")) return { rowCount: overrideRequests.length, rows: overrideRequests };
    if (sql.includes("'override-decision:'")) return { rowCount: overrideDecisions.length, rows: overrideDecisions };
    if (sql.includes("FROM audit_logs")) return { rowCount: audits.length, rows: audits };
    throw new Error(`Unexpected query: ${sql}`);
  }
});

const listFor = async (auth, rowsBySource) => (
  await getPlacementActivity({ auth, filters: { limit: 100 } }, createExecutor(rowsBySource))
).rows;

test("staff sees placement activity for cargo they own", async () => {
  const rows = await listFor(
    { role: "warehouse-staff", userId: 10, warehouseId: 1 },
    {
      movements: [
        baseRow({
          activity_id: "movement:owned",
          performed_by: null,
          performed_by_role_name: null,
          assigned_staff_id: 10
        })
      ]
    }
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "movement:owned");
});

test("staff sees placement activity they personally performed", async () => {
  const rows = await listFor(
    { role: "warehouse-staff", userId: 10, warehouseId: 1 },
    {
      validations: [
        baseRow({
          activity_id: "validation:performed",
          source_table: "placement_validation_logs",
          activity_type: ACTIVITY_TYPES.PLACEMENT_VALIDATED,
          performed_by: 10,
          assigned_staff_id: 20,
          created_by: 20,
          received_by_user_id: 20
        })
      ]
    }
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "validation:performed");
});

test("staff cannot see another staff member's placement activity", async () => {
  const rows = await listFor(
    { role: "warehouse-staff", userId: 10, warehouseId: 1 },
    {
      movements: [
        baseRow({
          activity_id: "movement:other-staff",
          performed_by: 20,
          performed_by_role_name: staffRole,
          assigned_staff_id: 10
        })
      ]
    }
  );

  assert.equal(rows.length, 0);
});

test("supervisor sees only assigned warehouse placement activity", async () => {
  const rows = await listFor(
    { role: "warehouse-supervisor", userId: 30, warehouseId: 1 },
    {
      movements: [
        baseRow({ activity_id: "movement:wha", warehouse_id: 1 }),
        baseRow({ activity_id: "movement:whb", warehouse_id: 2 })
      ]
    }
  );

  assert.deepEqual(rows.map((row) => row.id), ["movement:wha"]);
});

test("admin sees all placement activity", async () => {
  const rows = await listFor(
    { role: "system-admin", userId: 1 },
    {
      movements: [
        baseRow({ activity_id: "movement:wha", warehouse_id: 1 }),
        baseRow({ activity_id: "movement:whb", warehouse_id: 2 })
      ],
      audits: [
        baseRow({
          activity_id: "audit:manual-setting",
          source_table: "audit_logs",
          activity_type: ACTIVITY_TYPES.MANUAL_PLACEMENT_SETTING_CHANGED,
          cargo_record_id: null,
          assigned_staff_id: null,
          created_by: null,
          received_by_user_id: null,
          performed_by: 1,
          performed_by_role_name: "System Admin"
        })
      ]
    }
  );

  assert.equal(rows.length, 3);
});

test("null cargo_id validation logs do not leak to staff unless actor matches", async () => {
  const rows = await listFor(
    { role: "warehouse-staff", userId: 10, warehouseId: 1 },
    {
      validations: [
        baseRow({
          activity_id: "validation:mine-null-cargo",
          source_table: "placement_validation_logs",
          activity_type: ACTIVITY_TYPES.PLACEMENT_VALIDATION_FAILED,
          cargo_record_id: null,
          assigned_staff_id: null,
          created_by: null,
          received_by_user_id: null,
          performed_by: 10,
          result: "failed"
        }),
        baseRow({
          activity_id: "validation:other-null-cargo",
          source_table: "placement_validation_logs",
          activity_type: ACTIVITY_TYPES.PLACEMENT_VALIDATION_FAILED,
          cargo_record_id: null,
          assigned_staff_id: null,
          created_by: null,
          received_by_user_id: null,
          performed_by: 20,
          result: "failed"
        })
      ]
    }
  );

  assert.deepEqual(rows.map((row) => row.id), ["validation:mine-null-cargo"]);
});

test("activity summary respects role scope", async () => {
  const summary = await getPlacementActivitySummary(
    {
      auth: { role: "warehouse-staff", userId: 10, warehouseId: 1 },
      filters: {}
    },
    createExecutor({
      movements: [
        baseRow({
          activity_id: "movement:owned",
          activity_type: ACTIVITY_TYPES.PLACEMENT_CONFIRMED,
          assigned_staff_id: 10
        }),
        baseRow({
          activity_id: "movement:other-staff",
          activity_type: ACTIVITY_TYPES.CARGO_RELOCATED,
          assigned_staff_id: 10,
          performed_by: 20,
          performed_by_role_name: staffRole
        })
      ],
      validations: [
        baseRow({
          activity_id: "validation:mine",
          source_table: "placement_validation_logs",
          activity_type: ACTIVITY_TYPES.PLACEMENT_VALIDATION_FAILED,
          performed_by: 10,
          result: "failed"
        })
      ]
    })
  );

  assert.equal(summary.activity_count, 2);
  assert.equal(summary.placement_confirmed_count, 1);
  assert.equal(summary.relocation_count, 0);
  assert.equal(summary.validation_failed_count, 1);
});

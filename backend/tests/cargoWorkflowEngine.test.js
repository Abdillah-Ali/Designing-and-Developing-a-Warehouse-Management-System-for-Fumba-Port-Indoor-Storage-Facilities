const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { executeTransition } = require("../services/cargoWorkflowEngine");
const { workflowConditionRegistry, validateCondition } = require("../services/workflowConditionRegistry");
const { workflowEffectRegistry } = require("../services/workflowEffectRegistry");
const db = require("../config/db");

const policy = (overrides = {}) => ({
  workflow_key: "cargo_registration", revision: 1, active_revision: 1,
  transition_key: "approve_registration", from_state_key: "pending_review", to_state_key: "approved",
  to_storage_value: "Approved", required_permission_key: "cargo.approve", notes_requirement: "optional",
  confirmation_requirement: true, conditions: [{ condition_key: "cargo_not_archived", parameters: {} }],
  effects: ["update_registration_state"], audit_event_key: "CARGO_WORKFLOW_APPROVE_REGISTRATION", ...overrides
});

const executorFor = ({ configured = policy(), permission = true } = {}) => {
  const calls = [];
  const executor = { query: async (sql, values = []) => {
    calls.push({ sql, values });
    if (sql.includes("FROM workflow_definitions wd")) return { rowCount: configured ? 1 : 0, rows: configured ? [configured] : [] };
    if (sql.includes("SELECT 1 FROM workflow_transitions")) return { rowCount: 0, rows: [] };
    if (sql.includes("FROM role_permissions")) return { rowCount: permission ? 1 : 0, rows: permission ? [{}] : [] };
    if (sql.startsWith("UPDATE cargo")) return { rowCount: 1, rows: [{ id: 7, cargo_id: "CG-7", registration_status: values[0], is_deleted: false }] };
    if (sql.includes("INSERT INTO workflow_transition_history")) return { rowCount: 1, rows: [{ id: 9, policy_revision: 1 }] };
    if (sql.includes("INSERT INTO audit_logs")) return { rowCount: 1, rows: [{ id: 10 }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  return { executor, calls };
};

test("Phase 5 migration defines protected workflows, states, transitions and revisioned history", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../database/migrations/20260812_cargo_workflow_policy.sql"), "utf8");
  for (const table of ["workflow_definitions", "workflow_states", "workflow_transitions", "workflow_transition_history"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(sql, /approve_registration/);
  assert.match(sql, /request_registration_correction/);
  assert.match(sql, /reject_registration/);
  assert.match(sql, /resubmit_registration/);
  assert.match(sql, /confirm_placement/);
  assert.match(sql, /relocate_cargo/);
});

test("trusted condition and effect registries reject unknown executable keys", () => {
  assert.ok(workflowConditionRegistry.cargo_not_archived);
  assert.ok(workflowEffectRegistry.update_registration_state);
  assert.deepEqual(validateCondition("cargo_not_archived", {}), []);
  assert.ok(validateCondition("javascript_expression", {}).length);
  assert.equal(workflowEffectRegistry.http_callback, undefined);
});

test("a configured transition enforces permission and records revisioned history plus audit", async () => {
  const { executor, calls } = executorFor();
  const result = await executeTransition({ workflowKey: "cargo_registration", transitionKey: "approve_registration", cargoId: 7,
    actor: { userId: 3, roleId: 2 }, input: { confirmed: true }, executor,
    lockedCargo: { id: 7, cargo_id: "CG-7", registration_status: "Pending Review", is_deleted: false } });
  assert.equal(result.cargo.registration_status, "Approved");
  assert.equal(result.history.policy_revision, 1);
  assert.ok(calls.some((call) => call.sql.includes("FROM role_permissions")));
  assert.ok(calls.some((call) => call.sql.includes("INSERT INTO workflow_transition_history")));
  assert.ok(calls.some((call) => call.sql.includes("INSERT INTO audit_logs")));
});

test("unknown transition and missing permission fail before state mutation", async () => {
  const unknown = executorFor({ configured: null });
  await assert.rejects(() => executeTransition({ workflowKey: "cargo_registration", transitionKey: "unknown", cargoId: 7,
    actor: { userId: 3, roleId: 2 }, input: { confirmed: true }, executor: unknown.executor,
    lockedCargo: { id: 7, cargo_id: "CG-7", registration_status: "Pending Review", is_deleted: false } }),
  (error) => error.errorCode === "WORKFLOW_TRANSITION_NOT_FOUND");
  assert.equal(unknown.calls.some((call) => call.sql.startsWith("UPDATE cargo")), false);

  const denied = executorFor({ permission: false });
  await assert.rejects(() => executeTransition({ workflowKey: "cargo_registration", transitionKey: "approve_registration", cargoId: 7,
    actor: { userId: 3, roleId: 2 }, input: { confirmed: true }, executor: denied.executor,
    lockedCargo: { id: 7, cargo_id: "CG-7", registration_status: "Pending Review", is_deleted: false } }),
  (error) => error.statusCode === 403 && error.errorCode === "WORKFLOW_PERMISSION_DENIED");
  assert.equal(denied.calls.some((call) => call.sql.startsWith("UPDATE cargo")), false);
});

test("concurrent registration decisions serialize and only one transition commits", async (t) => {
  let role;
  try {
    role = (await db.query("SELECT role_id FROM role_permissions WHERE permission_key='cargo.approve' ORDER BY role_id LIMIT 1")).rows[0];
  } catch (error) {
    t.skip(`Live database is unavailable for workflow concurrency: ${error.code || error.message}`);
    return;
  }
  assert.ok(role?.role_id, "A role with cargo.approve must exist.");
  const marker = `WF-${Date.now()}`;
  const cargo = (await db.query(
    `INSERT INTO cargo(cargo_id,barcode,reference_number,consignee_name,cargo_type,cargo_condition,customs_status)
     VALUES($1,$1,$1,$2,'General Goods','Good','Pending Inspection') RETURNING *`, [marker, "Workflow Test"]
  )).rows[0];
  try {
    const actor = { roleId: role.role_id };
    const outcomes = await Promise.allSettled([
      executeTransition({ workflowKey: "cargo_registration", transitionKey: "approve_registration", cargoId: cargo.id, actor, input: { confirmed: true } }),
      executeTransition({ workflowKey: "cargo_registration", transitionKey: "reject_registration", cargoId: cargo.id, actor, input: { confirmed: true, notes: "Concurrent rejection" } })
    ]);
    assert.equal(outcomes.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((entry) => entry.status === "rejected").length, 1);
    assert.equal(outcomes.find((entry) => entry.status === "rejected").reason.errorCode, "WORKFLOW_TRANSITION_NOT_ALLOWED");
    const history = await db.query("SELECT * FROM workflow_transition_history WHERE entity_reference=$1", [marker]);
    assert.equal(history.rowCount, 1);
    assert.equal(history.rows[0].policy_revision, 1);
  } finally {
    await db.query("DELETE FROM workflow_transition_history WHERE entity_reference=$1", [marker]);
    await db.query("DELETE FROM audit_logs WHERE action IN ('CARGO_WORKFLOW_APPROVE_REGISTRATION','CARGO_WORKFLOW_REJECT_REGISTRATION') AND metadata->>'cargo_reference'=$1", [marker]);
    await db.query("DELETE FROM cargo WHERE id=$1", [cargo.id]);
  }
});

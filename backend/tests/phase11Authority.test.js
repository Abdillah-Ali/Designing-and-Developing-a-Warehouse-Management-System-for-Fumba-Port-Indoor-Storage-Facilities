const test = require("node:test");
const assert = require("node:assert/strict");
const { isWarehouseStaffRole, isWarehouseSupervisorRole } = require("../services/taskOwnershipService");
const { validateEligibilityPolicies } = require("../services/releaseEligibilityService");

test("task ownership protection is selected only by immutable role keys", () => {
  assert.equal(isWarehouseStaffRole("warehouse_staff"), true);
  assert.equal(isWarehouseSupervisorRole("warehouse_supervisor"), true);
  assert.equal(isWarehouseStaffRole("Warehouse Staff"), false);
  assert.equal(isWarehouseSupervisorRole("Warehouse Supervisor"), false);
  assert.equal(isWarehouseStaffRole("custom_role_with_old_display_name"), false);
});

const validRows = [
  ["dispatch", "dispatch_request", "registration_state", "dispatch.requests.create"],
  ["gate", "normal_gate_release", "customs_clearance", "gate.gate_out.confirm"],
  ["emergency", "emergency_gate_release", "emergency_authorization", "gate.emergency_release.request"]
].map(([policy_key, target, evaluator_key, permission_key]) => ({
  policy_key, revision: 1, target, configuration_status: "ready", evaluator_key,
  parameters: {}, permission_key
}));

const executor = (rows) => ({ query: async () => ({ rows }) });

test("eligibility readiness requires the complete protected target set", async () => {
  assert.equal((await validateEligibilityPolicies(executor(validRows))).ready, true);
  const withoutDispatch = await validateEligibilityPolicies(executor(validRows.filter((row) => row.target !== "dispatch_request")));
  assert.ok(withoutDispatch.issues.some((issue) => issue.code === "ELIGIBILITY_POLICY_MISSING" && issue.target === "dispatch_request"));
  const withoutGate = await validateEligibilityPolicies(executor(validRows.filter((row) => row.target !== "normal_gate_release")));
  assert.ok(withoutGate.issues.some((issue) => issue.code === "ELIGIBILITY_POLICY_MISSING" && issue.target === "normal_gate_release"));
});

test("eligibility readiness rejects ambiguous protected targets", async () => {
  const duplicate = { ...validRows[0], policy_key: "dispatch-duplicate" };
  const result = await validateEligibilityPolicies(executor([...validRows, duplicate]));
  assert.equal(result.ready, false);
  assert.ok(result.issues.some((issue) => issue.code === "ELIGIBILITY_POLICY_AMBIGUOUS" && issue.target === "dispatch_request"));
});

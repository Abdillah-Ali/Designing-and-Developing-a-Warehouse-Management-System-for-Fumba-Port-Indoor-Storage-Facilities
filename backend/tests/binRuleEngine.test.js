const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { evaluateRules, getWorkflowReadiness } = require("../services/binRuleEngine");
const { validateParameters } = require("../services/binRuleEvaluatorRegistry");

const context = {
  cargo: { cargo_type: "General Goods", weight: 10, volume: 1, customs_status: "Clear" },
  bin: {
    status: "Available", active: true, level_active: true, rack_active: true, zone_active: true,
    warehouse_status: "active", is_hazard_zone: false, zone_allowed_cargo_type: "General Goods",
    allowed_cargo_type: "General Goods", reserved_for_cargo_type: null, zone_type: "Standard",
    cargo_restrictions: null, handling_condition: null
  },
  approvals: { supervisor_override: null },
  derived: { remaining_weight: 100, remaining_volume: 10 }
};

const rules = () => [
  ["capacity_limits", { enforce_weight: true, enforce_volume: true }],
  ["cargo_storage_compatibility", {}],
  ["hazard_zone_compatibility", { hazardous_cargo_type: "Hazardous Cargo" }],
  ["storage_status", { allowed_statuses: ["Available", "Occupied"] }],
  ["reserved_storage", {}],
  ["restricted_zone_approval", { restricted_zone_type: "Restricted" }],
  ["customs_hold_storage", { hold_marker: "hold", storage_marker: "customs hold" }],
  ["fragile_handling", { cargo_type: "Fragile Goods", handling_marker: "fragile" }]
].map(([evaluator_type, parameters], index) => ({
  public_reference: `BR-${index}`,
  rule_code: `administrator_code_${index}`,
  rule_name: `Administrator Rule ${index}`,
  rule_type: "validation",
  evaluator_type,
  execution_targets: ["placement_confirmation"],
  violation_action: "block",
  severity: "high",
  priority: index + 1,
  parameters
}));

test("fresh schema and migrations do not insert bin rules or categories", () => {
  const files = [
    path.join(__dirname, "../database/schema.sql"),
    path.join(__dirname, "../database/updateSchema.js"),
    path.join(__dirname, "../database/migrations/warehouse_configuration_srs.sql"),
    path.join(__dirname, "../database/migrations/20260805_configurable_bin_rule_engine.sql")
  ];
  for (const file of files) {
    const sql = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(sql, /INSERT\s+INTO\s+bin_rules/i);
    assert.doesNotMatch(sql, /INSERT\s+INTO\s+bin_rule_categories/i);
  }
});

test("placement readiness fails closed with no configured rules", async () => {
  const readiness = await getWorkflowReadiness("placement_confirmation", null, []);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing_capabilities.includes("capacity_limits"));
  const evaluation = await evaluateRules({ target: "placement_confirmation", context, rules: [] });
  assert.equal(evaluation.approved, false);
  assert.equal(evaluation.reason, "Rule Engine Not Ready");
});

test("administrator rule names and codes do not affect evaluator execution", async () => {
  const first = rules();
  const renamed = first.map((rule) => ({ ...rule, rule_code: `renamed_${rule.priority}`, rule_name: `Renamed ${rule.priority}` }));
  const originalResult = await evaluateRules({ target: "placement_confirmation", context, rules: first });
  const renamedResult = await evaluateRules({ target: "placement_confirmation", context, rules: renamed });
  assert.equal(originalResult.approved, true);
  assert.equal(renamedResult.approved, true);
  assert.deepEqual(originalResult.results.map((item) => item.passed), renamedResult.results.map((item) => item.passed));
});

test("evaluation results follow database priority order", async () => {
  const configured = rules().reverse().map((rule, index) => ({ ...rule, priority: (index + 1) * 10 }));
  const result = await evaluateRules({ target: "placement_confirmation", context, rules: configured });
  assert.deepEqual(result.results.map((item) => item.priority), configured.map((item) => item.priority));
});

test("unknown evaluators and invalid parameters fail readiness safely", async () => {
  assert.ok(validateParameters("not_registered", {}).length > 0);
  assert.ok(validateParameters("storage_status", {}).length > 0);
  const invalid = [...rules(), { ...rules()[0], public_reference: "BR-UNKNOWN", evaluator_type: "not_registered" }];
  const readiness = await getWorkflowReadiness("placement_confirmation", null, invalid);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.invalid_rules.length, 1);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { evaluateRules, getWorkflowReadiness } = require("../services/binRuleEngine");
const { validateParameters } = require("../services/binRuleEvaluatorRegistry");

const context = {
  cargo: { cargo_type: "General Goods", cargo_type_key: "general_goods", weight: 10, volume: 1, customs_status: "Clear" },
  bin: {
    status: "Available", active: true, level_active: true, rack_active: true, zone_active: true,
    warehouse_status: "active", is_hazard_zone: false, zone_allowed_cargo_type: "General Goods",
    zone_allowed_cargo_type_key: "general_goods", allowed_cargo_type: "General Goods",
    allowed_cargo_type_key: "general_goods", reserved_for_cargo_type: null, zone_type: "Standard",
    cargo_restrictions: null, handling_condition: null
  },
  approvals: { supervisor_override: null },
  derived: { remaining_weight: 100, remaining_volume: 10 }
};

const rules = () => [
  ["capacity_limits", { enforce_weight: true, enforce_volume: true }],
  ["cargo_storage_compatibility", {}],
  ["hazard_zone_compatibility", { hazardous_cargo_type_key: "hazardous_cargo" }],
  ["storage_status", { allowed_statuses: ["Available", "Occupied"] }],
  ["reserved_storage", {}],
  ["restricted_zone_approval", { restricted_zone_type: "Restricted" }],
  ["customs_hold_storage", { hold_marker: "hold", storage_marker: "customs hold" }],
  ["fragile_handling", { cargo_type_key: "fragile_goods", handling_marker: "fragile" }]
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

test("built-in rule repair maps only rules lacking a trusted evaluator", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../database/migrations/20260811_repair_builtin_bin_rule_evaluators.sql"), "utf8");
  assert.match(sql, /capacity_limits/);
  assert.match(sql, /cargo_storage_compatibility/);
  assert.match(sql, /hazard_zone_compatibility/);
  assert.match(sql, /storage_status/);
  assert.match(sql, /reserved_storage/);
  assert.match(sql, /restricted_zone_approval/);
  assert.match(sql, /customs_hold_storage/);
  assert.match(sql, /fragile_handling/);
  assert.match(sql, /rule\.evaluator_type IS NULL/i);
});

test("reserved and restricted legacy rules are corrected using their displayed names", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../database/migrations/20260811_correct_reserved_bin_rule_evaluator.sql"), "utf8");
  assert.match(sql, /rule_name = 'Reserved Bin Restrictions'/);
  assert.match(sql, /reserved_storage/);
  assert.match(sql, /rule_name = 'Zone Restriction'/);
  assert.match(sql, /restricted_zone_approval/);
});

test("built-in rule migration records the approved trusted evaluator mapping", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../database/migrations/20260811_lock_builtin_bin_rule_evaluators.sql"), "utf8");
  assert.match(sql, /required_evaluator_type/);
  assert.match(sql, /'Customs Hold Restriction' THEN 'customs_hold_storage'/);
  assert.match(sql, /'Reserved Bin Restrictions' THEN 'reserved_storage'/);
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

test("cargo compatibility fails closed without a stable cargo-type key", async () => {
  const missingKeyContext = { ...context, cargo: { ...context.cargo, cargo_type_key: null } };
  const evaluated = await evaluateRules({ target: "placement_confirmation", context: missingKeyContext, rules: rules() });
  const compatibility = evaluated.results.find((item) => item.evaluator_type === "cargo_storage_compatibility");
  assert.equal(compatibility.passed, false);
  assert.equal(compatibility.details.reason_code, "CARGO_TYPE_KEY_MISSING");
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

test("unsupported workflow actions fail readiness instead of creating fictitious approvals", async () => {
  const invalid = rules();
  invalid[0] = { ...invalid[0], violation_action: "customs_approval" };
  const readiness = await getWorkflowReadiness("placement_confirmation", null, invalid);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.invalid_rules.length, 1);
});

test("a missing evaluator on an active targeted rule is reported as invalid", async () => {
  const invalid = [...rules(), { ...rules()[0], public_reference: "BR-NULL", evaluator_type: null }];
  const readiness = await getWorkflowReadiness("placement_confirmation", null, invalid);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.invalid_rules.length, 1);
});

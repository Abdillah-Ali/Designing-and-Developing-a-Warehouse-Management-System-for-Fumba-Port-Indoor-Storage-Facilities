const db = require("../config/db");
const {
  REQUIRED_PLACEMENT_CAPABILITIES,
  evaluatorDefinitions,
  validateParameters
} = require("./binRuleEvaluatorRegistry");

const placementWorkflow = (target) => [
  "placement_recommendation",
  "placement_confirmation",
  "relocation"
].includes(target);

const loadActiveRules = async (target, executor = db) => {
  const result = await executor.query(
    `SELECT br.public_reference, br.rule_key AS rule_code, br.rule_name, br.description,
            br.rule_type, br.evaluator_type, br.execution_targets, br.violation_action,
            br.severity, br.priority, br.parameters, br.required_evaluator_type,
            category.public_reference AS category_reference,
            category.category_code, category.category_name
     FROM bin_rules br
     LEFT JOIN bin_rule_categories category ON category.id = br.category_id
     WHERE br.is_active = TRUE
       AND $1 = ANY(br.execution_targets)
     ORDER BY br.priority ASC, br.created_at ASC, br.public_reference ASC`,
    [target]
  );
  return result.rows;
};

const getWorkflowReadiness = async (target, executor = db, preloadedRules = null) => {
  const rules = preloadedRules || await loadActiveRules(target, executor);
  const invalid_rules = [];
  const available = new Set();
  for (const rule of rules) {
    const definition = evaluatorDefinitions[rule.evaluator_type];
    const errors = validateParameters(rule.evaluator_type, rule.parameters || {});
    if (!definition || rule.required_evaluator_type && rule.evaluator_type !== rule.required_evaluator_type
      || !definition?.supported_targets.includes(target)
      || !definition?.supported_actions.includes(rule.violation_action)
      || errors.length) {
      invalid_rules.push({ rule_reference: rule.public_reference, evaluator_type: rule.evaluator_type, errors });
    } else {
      available.add(rule.evaluator_type);
    }
  }
  const missing_capabilities = placementWorkflow(target)
    ? REQUIRED_PLACEMENT_CAPABILITIES.filter((capability) => !available.has(capability))
    : [];
  return {
    ready: missing_capabilities.length === 0 && invalid_rules.length === 0,
    workflow: target,
    missing_capabilities,
    invalid_rules,
    active_rule_count: rules.length
  };
};

const evaluateRules = async ({ target, context, executor = db, rules: suppliedRules = null }) => {
  const rules = suppliedRules || await loadActiveRules(target, executor);
  const readiness = await getWorkflowReadiness(target, executor, rules);
  if (!readiness.ready && placementWorkflow(target)) {
    return {
      approved: false,
      readiness,
      results: [],
      reason: "Rule Engine Not Ready",
      detail: `Placement safety configuration is incomplete. Missing capabilities: ${readiness.missing_capabilities.join(", ") || "none"}.`
    };
  }
  if (readiness.invalid_rules.length) {
    return {
      approved: false,
      readiness,
      results: [],
      reason: "Invalid Rule Configuration",
      detail: "One or more active rules reference an unsupported evaluator, target, or parameter configuration."
    };
  }

  const results = [];
  for (const rule of rules) {
    const definition = evaluatorDefinitions[rule.evaluator_type];
    const evaluation = await definition.evaluate(context, rule.parameters || {});
    const blocks = !evaluation.passed && rule.violation_action !== "warning";
    results.push({
      rule_reference: rule.public_reference,
      rule_code: rule.rule_code,
      rule_name: rule.rule_name,
      evaluator_type: rule.evaluator_type,
      evaluator_key: rule.evaluator_type,
      priority: rule.priority,
      severity: rule.severity,
      violation_action: rule.violation_action,
      passed: evaluation.passed,
      blocks,
      message: evaluation.message,
      details: evaluation.details || {}
    });
  }
  const blocking = results.filter((item) => item.blocks);
  return {
    approved: blocking.length === 0,
    readiness,
    results,
    reason: blocking[0]?.rule_name || "Placement Approved",
    reason_code: blocking[0] ? "BIN_RULE_BLOCKED" : "BIN_RULES_APPROVED",
    detail: blocking.length ? blocking.map((item) => item.message).join(" ") : "All configured placement rules passed."
  };
};

module.exports = { evaluateRules, getWorkflowReadiness, loadActiveRules };

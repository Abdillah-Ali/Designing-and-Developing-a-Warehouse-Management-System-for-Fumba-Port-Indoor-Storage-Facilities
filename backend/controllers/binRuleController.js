const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { buildError } = require("../utils/apiError");
const {
  EXECUTION_TARGETS,
  SEVERITIES,
  VIOLATION_ACTIONS,
  evaluatorDefinitions,
  listEvaluatorDefinitions,
  validateParameters
} = require("../services/binRuleEvaluatorRegistry");
const { getWorkflowReadiness } = require("../services/binRuleEngine");

const RULE_TYPES = new Set(["validation", "filter", "ordering"]);
const codePattern = /^[a-z][a-z0-9_-]{2,79}$/;
const text = (value) => String(value || "").trim();

const ruleSelect = `
  SELECT br.public_reference, br.rule_key AS rule_code, br.rule_name, br.description,
         br.rule_type, br.evaluator_type, br.execution_targets, br.violation_action,
         br.severity, br.priority, br.is_active, br.parameters, br.created_at, br.updated_at,
         category.public_reference AS category_reference,
         category.category_code, category.category_name,
         creator.public_reference AS created_by_reference,
         updater.public_reference AS updated_by_reference
  FROM bin_rules br
  LEFT JOIN bin_rule_categories category ON category.id = br.category_id
  LEFT JOIN users creator ON creator.id = br.created_by
  LEFT JOIN users updater ON updater.id = br.updated_by`;

const parseRule = (payload, { partial = false } = {}) => {
  const parsed = {};
  const assign = (key, transform = (value) => value) => {
    if (Object.prototype.hasOwnProperty.call(payload, key)) parsed[key] = transform(payload[key]);
  };
  assign("rule_code", (value) => text(value).toLowerCase());
  assign("rule_name", text);
  assign("description", (value) => text(value) || null);
  assign("category_reference", (value) => text(value) || null);
  assign("rule_type", (value) => text(value).toLowerCase());
  assign("evaluator_type", (value) => text(value));
  assign("execution_targets", (value) => Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : []);
  assign("violation_action", (value) => text(value).toLowerCase());
  assign("severity", (value) => text(value).toLowerCase());
  assign("priority", Number);
  assign("is_active", (value) => value);
  assign("parameters", (value) => value);

  const required = ["rule_code", "rule_name", "rule_type", "evaluator_type", "execution_targets", "violation_action", "severity", "priority", "parameters"];
  if (!partial) {
    for (const key of required) if (parsed[key] === undefined || parsed[key] === "") throw buildError(`${key} is required.`, 400);
  }
  if (parsed.rule_code !== undefined && !codePattern.test(parsed.rule_code)) throw buildError("Rule code must start with a lowercase letter and contain 3-80 lowercase letters, numbers, underscores, or hyphens.", 400);
  if (parsed.rule_name !== undefined && !parsed.rule_name) throw buildError("Rule name is required.", 400);
  if (parsed.rule_type !== undefined && !RULE_TYPES.has(parsed.rule_type)) throw buildError("Rule type must be validation, filter, or ordering.", 400);
  if (parsed.evaluator_type !== undefined && !evaluatorDefinitions[parsed.evaluator_type]) throw buildError("The selected trusted evaluator is not supported.", 400);
  if (parsed.execution_targets !== undefined) {
    if (!parsed.execution_targets.length) throw buildError("At least one execution target is required.", 400);
    const invalid = parsed.execution_targets.filter((target) => !EXECUTION_TARGETS.includes(target));
    if (invalid.length) throw buildError(`Unsupported execution target: ${invalid.join(", ")}.`, 400);
  }
  if (parsed.violation_action !== undefined && !VIOLATION_ACTIONS.includes(parsed.violation_action)) throw buildError("The selected violation action is not supported.", 400);
  if (parsed.severity !== undefined && !SEVERITIES.includes(parsed.severity)) throw buildError("The selected severity is not supported.", 400);
  if (parsed.priority !== undefined && (!Number.isInteger(parsed.priority) || parsed.priority < 1)) throw buildError("Priority must be a positive integer.", 400);
  if (parsed.is_active !== undefined && typeof parsed.is_active !== "boolean") throw buildError("Active status must be true or false.", 400);
  if (parsed.parameters !== undefined && (!parsed.parameters || typeof parsed.parameters !== "object" || Array.isArray(parsed.parameters))) throw buildError("Parameters must be a JSON object.", 400);
  return parsed;
};

const validateCompleteRule = (rule) => {
  if (rule.required_evaluator_type && rule.evaluator_type !== rule.required_evaluator_type) {
    throw buildError(
      `This built-in rule must use the trusted evaluator: ${rule.required_evaluator_type.replaceAll("_", " ")}.`,
      400
    );
  }
  const definition = evaluatorDefinitions[rule.evaluator_type];
  if (!definition.supported_targets || rule.execution_targets.some((target) => !definition.supported_targets.includes(target))) {
    throw buildError("One or more execution targets are not supported by the selected evaluator.", 400);
  }
  if ((definition.rule_type || "validation") !== rule.rule_type) throw buildError(`This evaluator requires rule type ${definition.rule_type || "validation"}.`, 400);
  if (!definition.supported_actions.includes(rule.violation_action)) throw buildError("The selected action is not supported by this trusted evaluator.", 400);
  const errors = validateParameters(rule.evaluator_type, rule.parameters || {});
  if (errors.length) throw buildError("Rule parameters are invalid.", 400, errors);
};

const resolveCategoryId = async (client, reference) => {
  if (!reference) return null;
  const result = await client.query("SELECT id FROM bin_rule_categories WHERE public_reference = $1", [reference]);
  if (!result.rowCount) throw buildError("Rule category was not found.", 400);
  return result.rows[0].id;
};

const publicSnapshot = (value) => {
  if (!value) return null;
  const snapshot = { ...value };
  for (const key of ["id", "category_id", "created_by", "updated_by"]) delete snapshot[key];
  if (snapshot.rule_key && !snapshot.rule_code) snapshot.rule_code = snapshot.rule_key;
  delete snapshot.rule_key;
  return snapshot;
};

const recordHistory = async (client, { rule, action, previous, next, userId }) => {
  const previousSnapshot = publicSnapshot(previous);
  const nextSnapshot = publicSnapshot(next);
  await client.query(
    `INSERT INTO bin_rule_audit_history
       (rule_id, rule_public_reference, action, previous_values, new_values, changed_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [action === "DELETE_BIN_RULE" ? null : rule.id || null, rule.public_reference, action,
      previousSnapshot ? JSON.stringify(previousSnapshot) : null,
      nextSnapshot ? JSON.stringify(nextSnapshot) : null, userId || null]
  );
  await writeAuditLog({
    user_id: userId || null,
    action,
    module: "Bin Rules",
    description: `${action.replaceAll("_", " ")} for ${rule.public_reference}.`,
    metadata: { rule_reference: rule.public_reference, previous_values: previousSnapshot, new_values: nextSnapshot }
  }, client);
};

const getRules = async (req, res, next) => {
  try {
    const result = await db.query(`${ruleSelect} ORDER BY br.priority, br.rule_name`);
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) { next(error); }
};

const getRule = async (req, res, next) => {
  try {
    const result = await db.query(`${ruleSelect} WHERE br.public_reference=$1 LIMIT 1`, [req.params.reference]);
    if (!result.rowCount) throw buildError("Bin rule not found.", 404);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) { next(error); }
};

const createRule = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const rule = parseRule(req.body);
    validateCompleteRule(rule);
    await client.query("BEGIN");
    const categoryId = await resolveCategoryId(client, rule.category_reference);
    const result = await client.query(
      `INSERT INTO bin_rules
       (rule_key,rule_name,description,category_id,rule_type,evaluator_type,execution_targets,
        violation_action,severity,priority,is_active,parameters,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
       RETURNING *`,
      [rule.rule_code, rule.rule_name, rule.description, categoryId, rule.rule_type, rule.evaluator_type,
        rule.execution_targets, rule.violation_action, rule.severity, rule.priority, rule.is_active === true,
        JSON.stringify(rule.parameters), req.auth.userId]
    );
    await recordHistory(client, { rule: result.rows[0], action: "CREATE_BIN_RULE", previous: null, next: rule, userId: req.auth.userId });
    await client.query("COMMIT");
    const created = await db.query(`${ruleSelect} WHERE br.public_reference=$1`, [result.rows[0].public_reference]);
    res.status(201).json({ success: true, data: created.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") next(buildError("Rule code already exists.", 409)); else next(error);
  } finally { client.release(); }
};

const updateRule = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const existingResult = await client.query("SELECT * FROM bin_rules WHERE public_reference=$1 FOR UPDATE", [req.params.reference]);
    if (!existingResult.rowCount) throw buildError("Bin rule not found.", 404);
    const existing = existingResult.rows[0];
    const changes = parseRule(req.body, { partial: true });
    const merged = {
      rule_code: changes.rule_code ?? existing.rule_key,
      rule_name: changes.rule_name ?? existing.rule_name,
      description: changes.description !== undefined ? changes.description : existing.description,
      category_reference: changes.category_reference,
      rule_type: changes.rule_type ?? existing.rule_type,
      evaluator_type: changes.evaluator_type ?? existing.evaluator_type,
      execution_targets: changes.execution_targets ?? existing.execution_targets,
      violation_action: changes.violation_action ?? existing.violation_action,
      severity: changes.severity ?? existing.severity,
      priority: changes.priority ?? existing.priority,
      is_active: changes.is_active ?? existing.is_active,
      parameters: changes.parameters ?? existing.parameters,
      required_evaluator_type: existing.required_evaluator_type
    };
    const definitionChanged = ["evaluator_type", "execution_targets", "parameters", "rule_type"].some(
      (key) => Object.prototype.hasOwnProperty.call(changes, key)
    );
    if (merged.is_active || definitionChanged) validateCompleteRule(merged);
    const categoryId = changes.category_reference !== undefined
      ? await resolveCategoryId(client, changes.category_reference)
      : existing.category_id;
    const result = await client.query(
      `UPDATE bin_rules SET rule_key=$1,rule_name=$2,description=$3,category_id=$4,rule_type=$5,
       evaluator_type=$6,execution_targets=$7,violation_action=$8,severity=$9,priority=$10,
       is_active=$11,parameters=$12,updated_by=$13,updated_at=CURRENT_TIMESTAMP
       WHERE id=$14 RETURNING *`,
      [merged.rule_code, merged.rule_name, merged.description, categoryId, merged.rule_type,
        merged.evaluator_type, merged.execution_targets, merged.violation_action, merged.severity,
        merged.priority, merged.is_active, JSON.stringify(merged.parameters), req.auth.userId, existing.id]
    );
    const action = existing.is_active !== merged.is_active
      ? merged.is_active ? "ACTIVATE_BIN_RULE" : "DEACTIVATE_BIN_RULE"
      : "UPDATE_BIN_RULE";
    await recordHistory(client, { rule: result.rows[0], action, previous: existing, next: result.rows[0], userId: req.auth.userId });
    await client.query("COMMIT");
    const updated = await db.query(`${ruleSelect} WHERE br.public_reference=$1`, [req.params.reference]);
    res.json({ success: true, data: updated.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") next(buildError("Rule code already exists.", 409)); else next(error);
  } finally { client.release(); }
};

const deleteRule = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("DELETE FROM bin_rules WHERE public_reference=$1 RETURNING *", [req.params.reference]);
    if (!result.rowCount) throw buildError("Bin rule not found.", 404);
    await recordHistory(client, { rule: result.rows[0], action: "DELETE_BIN_RULE", previous: result.rows[0], next: null, userId: req.auth.userId });
    await client.query("COMMIT");
    res.json({ success: true, message: "Bin rule deleted." });
  } catch (error) { await client.query("ROLLBACK"); next(error); } finally { client.release(); }
};

const getRuleHistory = async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT history.public_reference,history.rule_public_reference,history.action,
              history.previous_values,history.new_values,history.created_at,
              users.public_reference AS changed_by_reference,users.full_name AS changed_by_name
       FROM bin_rule_audit_history history
       LEFT JOIN users ON users.id=history.changed_by
       WHERE history.rule_public_reference=$1 ORDER BY history.created_at DESC`,
      [req.params.reference]
    );
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) { next(error); }
};

const getEvaluatorCatalog = (req, res) => res.json({
  success: true,
  data: {
    evaluators: listEvaluatorDefinitions(),
    execution_targets: EXECUTION_TARGETS,
    violation_actions: VIOLATION_ACTIONS,
    severities: SEVERITIES
  }
});

const getReadiness = async (req, res, next) => {
  try { res.json({ success: true, data: await getWorkflowReadiness(req.query.workflow || "placement_confirmation") }); }
  catch (error) { next(error); }
};

const getCategories = async (req, res, next) => {
  try {
    const result = await db.query(`SELECT category.public_reference,category.category_code,category.category_name,
      category.description,category.is_active,category.created_at,category.updated_at,COUNT(rule.id)::int AS rule_count
      FROM bin_rule_categories category LEFT JOIN bin_rules rule ON rule.category_id=category.id
      GROUP BY category.id ORDER BY category.category_name`);
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) { next(error); }
};

const saveCategory = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const code = text(req.body.category_code).toLowerCase();
    const name = text(req.body.category_name);
    if (!codePattern.test(code) || !name) throw buildError("A valid category code and name are required.", 400);
    if (req.body.is_active !== undefined && typeof req.body.is_active !== "boolean") throw buildError("Active status must be true or false.", 400);
    await client.query("BEGIN");
    const existing = req.params.reference
      ? await client.query("SELECT * FROM bin_rule_categories WHERE public_reference=$1 FOR UPDATE", [req.params.reference])
      : { rows: [], rowCount: 0 };
    if (req.params.reference && !existing.rowCount) throw buildError("Rule category not found.", 404);
    const result = existing.rowCount
      ? await client.query(`UPDATE bin_rule_categories SET category_code=$1,category_name=$2,description=$3,
          is_active=$4,updated_by=$5,updated_at=CURRENT_TIMESTAMP WHERE id=$6 RETURNING *`,
        [code, name, text(req.body.description) || null, req.body.is_active ?? existing.rows[0].is_active, req.auth.userId, existing.rows[0].id])
      : await client.query(`INSERT INTO bin_rule_categories(category_code,category_name,description,is_active,created_by,updated_by)
          VALUES($1,$2,$3,$4,$5,$5) RETURNING *`,
        [code, name, text(req.body.description) || null, req.body.is_active !== false, req.auth.userId]);
    const previousCategory = publicSnapshot(existing.rows[0]);
    const nextCategory = publicSnapshot(result.rows[0]);
    await writeAuditLog({ user_id: req.auth.userId, action: existing.rowCount ? "UPDATE_BIN_RULE_CATEGORY" : "CREATE_BIN_RULE_CATEGORY",
      module: "Bin Rules", description: `Saved bin rule category ${result.rows[0].public_reference}.`,
      metadata: { category_reference: result.rows[0].public_reference, previous_values: previousCategory, new_values: nextCategory } }, client);
    await client.query("COMMIT");
    res.status(existing.rowCount ? 200 : 201).json({ success: true, data: { ...result.rows[0], id: undefined, created_by: undefined, updated_by: undefined } });
  } catch (error) { await client.query("ROLLBACK"); if (error.code === "23505") next(buildError("Category code already exists.", 409)); else next(error); }
  finally { client.release(); }
};

const deleteCategory = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("DELETE FROM bin_rule_categories WHERE public_reference=$1 RETURNING *", [req.params.reference]);
    if (!result.rowCount) throw buildError("Rule category not found.", 404);
    await writeAuditLog({ user_id: req.auth.userId, action: "DELETE_BIN_RULE_CATEGORY", module: "Bin Rules",
      description: `Deleted bin rule category ${result.rows[0].public_reference}.`, metadata: { category_reference: result.rows[0].public_reference } }, client);
    await client.query("COMMIT");
    res.json({ success: true, message: "Bin rule category deleted." });
  } catch (error) { await client.query("ROLLBACK"); if (error.code === "23503") next(buildError("Category cannot be deleted while rules use it.", 409)); else next(error); }
  finally { client.release(); }
};

module.exports = { createRule, deleteCategory, deleteRule, getCategories, getEvaluatorCatalog, getReadiness, getRule, getRuleHistory, getRules, saveCategory, updateRule };

const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { buildError } = require("../utils/apiError");
const { workflowConditionRegistry, validateCondition } = require("./workflowConditionRegistry");
const { workflowEffectRegistry } = require("./workflowEffectRegistry");

const WORKFLOW_COLUMNS = Object.freeze({ cargo_registration: "registration_status", cargo_placement: "placement_status" });

const loadPolicy = async (workflowKey, transitionKey, currentStorageValue, executor) => {
  const result = await executor.query(
    `SELECT wd.workflow_key, wd.active_revision, wt.*, fs.state_key AS from_state_key,
            fs.storage_value AS from_storage_value, ts.state_key AS to_state_key,
            ts.storage_value AS to_storage_value, ts.terminal AS to_terminal
     FROM workflow_definitions wd
     JOIN workflow_transitions wt ON wt.workflow_key=wd.workflow_key AND wt.revision=wd.active_revision
     JOIN workflow_states fs ON fs.workflow_key=wt.workflow_key AND fs.state_key=wt.from_state_key
     JOIN workflow_states ts ON ts.workflow_key=wt.workflow_key AND ts.state_key=wt.to_state_key
     WHERE wd.workflow_key=$1 AND wd.active=TRUE AND wt.transition_key=$2 AND wt.active=TRUE
       AND fs.storage_value=$3
     ORDER BY wt.priority, wt.id LIMIT 1`,
    [workflowKey, transitionKey, currentStorageValue]
  );
  return result.rows[0] || null;
};

const assertPermission = async (permissionKey, actor, executor) => {
  const result = await executor.query(
    `SELECT 1 FROM role_permissions WHERE role_id=$1 AND permission_key=$2 LIMIT 1`,
    [actor?.roleId || actor?.role_id || 0, permissionKey]
  );
  if (!result.rowCount) throw buildError("You do not have permission to perform this workflow transition.", 403, null, "WORKFLOW_PERMISSION_DENIED");
};

const executeTransition = async ({ workflowKey, transitionKey, cargoId, actor, input = {}, executor = null, lockedCargo = null }) => {
  const ownsTransaction = !executor;
  const client = executor || await db.pool.connect();
  try {
    if (ownsTransaction) await client.query("BEGIN");
    const column = WORKFLOW_COLUMNS[workflowKey];
    if (!column) throw buildError("Workflow is not supported.", 400, null, "WORKFLOW_NOT_FOUND");
    const cargo = lockedCargo || (await client.query("SELECT * FROM cargo WHERE id=$1 AND is_deleted=FALSE FOR UPDATE", [cargoId])).rows[0];
    if (!cargo) throw buildError("Cargo record not found.", 404);
    const policy = await loadPolicy(workflowKey, transitionKey, cargo[column], client);
    if (!policy) {
      const exists = await client.query(
        `SELECT 1 FROM workflow_transitions wt JOIN workflow_definitions wd ON wd.workflow_key=wt.workflow_key AND wd.active_revision=wt.revision
         WHERE wt.workflow_key=$1 AND wt.transition_key=$2 AND wt.active=TRUE`, [workflowKey, transitionKey]
      );
      throw buildError(
        exists.rowCount ? "Transition is not allowed from the cargo's current state." : "Workflow transition was not found.",
        409, null, exists.rowCount ? "WORKFLOW_TRANSITION_NOT_ALLOWED" : "WORKFLOW_TRANSITION_NOT_FOUND"
      );
    }
    await assertPermission(policy.required_permission_key, actor, client);
    const notes = String(input.notes || "").trim();
    if (policy.notes_requirement === "required" && !notes) throw buildError("Notes are required for this transition.", 400, null, "WORKFLOW_NOTES_REQUIRED");
    if (policy.confirmation_requirement && input.confirmed !== true) throw buildError("Confirmation is required for this transition.", 400, null, "WORKFLOW_CONFIRMATION_REQUIRED");
    for (const configured of policy.conditions || []) {
      const definition = workflowConditionRegistry[configured.condition_key];
      if (!definition || validateCondition(configured.condition_key, configured.parameters || {}).length || !definition.supported_workflows.includes(workflowKey)) {
        throw buildError("Workflow condition configuration is invalid.", 409, null, "WORKFLOW_CONFIGURATION_INVALID");
      }
      if (!await definition.evaluate({ cargo, actor, input }, configured.parameters || {})) {
        throw buildError("A required workflow condition was not satisfied.", 409, null, "WORKFLOW_CONDITION_FAILED");
      }
    }
    let updatedCargo = cargo;
    for (const effectKey of policy.effects || []) {
      const effect = workflowEffectRegistry[effectKey];
      if (!effect || !effect.supported_workflows.includes(workflowKey)) throw buildError("Workflow effect configuration is invalid.", 409, null, "WORKFLOW_CONFIGURATION_INVALID");
      const result = await effect.apply({ executor: client, cargo: updatedCargo, actor, input, policy, toState: { state_key: policy.to_state_key, storage_value: policy.to_storage_value } });
      updatedCargo = result?.rows?.[0] || updatedCargo;
    }
    const history = await client.query(
      `INSERT INTO workflow_transition_history
       (workflow_key,transition_key,entity_reference,from_state_key,to_state_key,policy_revision,performed_by,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
      [workflowKey, transitionKey, cargo.public_reference || cargo.cargo_id, policy.from_state_key, policy.to_state_key,
        policy.revision, actor?.userId || actor?.user_id || null, JSON.stringify({ notes: notes || null, ...(input.audit_metadata || {}) })]
    );
    await writeAuditLog({
      user_id: actor?.userId || actor?.user_id || null,
      action: policy.audit_event_key,
      module: "Cargo Workflow",
      description: `Executed ${transitionKey} for cargo ${cargo.cargo_id}.`,
      metadata: { cargo_reference: cargo.public_reference || cargo.cargo_id, workflow_key: workflowKey, transition_key: transitionKey,
        from_state_key: policy.from_state_key, to_state_key: policy.to_state_key, policy_revision: policy.revision, notes: notes || null }
    }, client);
    if (ownsTransaction) await client.query("COMMIT");
    return { cargo: updatedCargo, policy, history: history.rows[0], notification_event_key: policy.notification_event_key };
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
};

const getWorkflowReadiness = async (executor = db) => {
  const result = await executor.query(
    `SELECT wd.workflow_key, wd.active_revision, wt.transition_key, wt.from_state_key, wt.to_state_key,
            wt.required_permission_key, wt.conditions, wt.effects,
            fs.state_key IS NOT NULL AS from_valid, ts.state_key IS NOT NULL AS to_valid,
            p.permission_key IS NOT NULL AS permission_valid
     FROM workflow_definitions wd
     LEFT JOIN workflow_transitions wt ON wt.workflow_key=wd.workflow_key AND wt.revision=wd.active_revision AND wt.active=TRUE
     LEFT JOIN workflow_states fs ON fs.workflow_key=wt.workflow_key AND fs.state_key=wt.from_state_key
     LEFT JOIN workflow_states ts ON ts.workflow_key=wt.workflow_key AND ts.state_key=wt.to_state_key
     LEFT JOIN permissions p ON p.permission_key=wt.required_permission_key
     WHERE wd.active=TRUE ORDER BY wd.workflow_key,wt.priority,wt.id`
  );
  const issues = [];
  for (const row of result.rows) {
    if (!row.transition_key) { issues.push({ code: "WORKFLOW_ACTIVE_POLICY_MISSING", workflow_key: row.workflow_key }); continue; }
    if (!row.from_valid || !row.to_valid) issues.push({ code: "WORKFLOW_STATE_UNKNOWN", transition_key: row.transition_key });
    if (!row.permission_valid) issues.push({ code: "WORKFLOW_PERMISSION_UNKNOWN", transition_key: row.transition_key });
    for (const condition of row.conditions || []) if (!workflowConditionRegistry[condition.condition_key] || validateCondition(condition.condition_key, condition.parameters || {}).length) issues.push({ code: "WORKFLOW_CONDITION_UNKNOWN", transition_key: row.transition_key });
    for (const effect of row.effects || []) if (!workflowEffectRegistry[effect]) issues.push({ code: "WORKFLOW_EFFECT_UNKNOWN", transition_key: row.transition_key });
  }
  return { ready: issues.length === 0, workflows: [...new Set(result.rows.map((row) => row.workflow_key))], transition_count: result.rows.filter((row) => row.transition_key).length, issues };
};

module.exports = { executeTransition, getWorkflowReadiness, loadPolicy };

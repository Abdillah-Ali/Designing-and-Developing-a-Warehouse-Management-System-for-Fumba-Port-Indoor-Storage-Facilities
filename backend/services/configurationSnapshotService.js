const db = require("../config/db");
const { buildError } = require("../utils/apiError");
const { validateSettingValue } = require("./configurationRegistryService");
const { evaluatorDefinitions, validateParameters } = require("./binRuleEvaluatorRegistry");
const { getWorkflowReadiness } = require("./binRuleEngine");
const { getSystemReadiness } = require("./readinessService");
const { writeAuditLog } = require("../models/adminModel");

const FORMAT = "fumba-wms-configuration";
const VERSION = 1;

const exportSnapshot = async (actorId, executor = db) => {
  const [settings, rules] = await Promise.all([
    executor.query(`SELECT s.setting_key,s.setting_value FROM system_settings s
      JOIN system_setting_definitions d ON d.setting_key=s.setting_key
      WHERE d.is_active=TRUE AND d.is_secret=FALSE ORDER BY s.setting_key`),
    executor.query(`SELECT public_reference,rule_name,description,is_active,parameters,rule_type,
      evaluator_type,execution_targets,violation_action,severity,priority
      FROM bin_rules ORDER BY public_reference`)
  ]);
  const snapshot = {
    format: FORMAT,
    version: VERSION,
    created_at: new Date().toISOString(),
    sections: { system_settings: settings.rows, bin_rules: rules.rows }
  };
  await writeAuditLog({ user_id: actorId, action: "EXPORT_CONFIGURATION_BACKUP", module: "System Configuration", description: "Exported a versioned configuration backup.", metadata: { format: FORMAT, version: VERSION, domains: Object.keys(snapshot.sections) } }, executor);
  return snapshot;
};

const validateSnapshot = async (snapshot, executor = db) => {
  const issues = [];
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) issues.push("Backup must be a JSON object.");
  if (snapshot?.format !== FORMAT) issues.push("Backup format is not supported.");
  if (snapshot?.version !== VERSION) issues.push("Backup version is not supported.");
  if (!snapshot?.sections || typeof snapshot.sections !== "object") issues.push("Backup configuration sections are required.");
  const settings = snapshot?.sections?.system_settings;
  const rules = snapshot?.sections?.bin_rules;
  if (!Array.isArray(settings)) issues.push("system_settings must be an array.");
  if (!Array.isArray(rules)) issues.push("bin_rules must be an array.");
  if (issues.length) return { valid: false, issues };

  const seenSettings = new Set();
  for (const item of settings) {
    if (!item || typeof item.setting_key !== "string" || seenSettings.has(item.setting_key)) { issues.push("Every setting requires a unique stable setting_key."); continue; }
    seenSettings.add(item.setting_key);
    const definition = await executor.query("SELECT * FROM system_setting_definitions WHERE setting_key=$1 AND is_active=TRUE", [item.setting_key]);
    if (!definition.rowCount) { issues.push(`Unknown setting key: ${item.setting_key}.`); continue; }
    if (definition.rows[0].is_secret) { issues.push(`Secret setting is not permitted: ${item.setting_key}.`); continue; }
    const validation = validateSettingValue(definition.rows[0], item.setting_value);
    if (!validation.valid) issues.push(`${item.setting_key}: ${validation.issues.map((entry) => entry.message).join(" ")}`);
  }
  const seenRules = new Set();
  for (const rule of rules) {
    if (!rule || typeof rule.public_reference !== "string" || seenRules.has(rule.public_reference)) { issues.push("Every Bin Rule requires a unique public_reference."); continue; }
    seenRules.add(rule.public_reference);
    if (!evaluatorDefinitions[rule.evaluator_type]) issues.push(`Unknown trusted evaluator: ${rule.evaluator_type}.`);
    issues.push(...validateParameters(rule.evaluator_type, rule.parameters || {}).map((message) => `${rule.public_reference}: ${message}`));
    const existing = await executor.query("SELECT 1 FROM bin_rules WHERE public_reference=$1", [rule.public_reference]);
    if (!existing.rowCount) issues.push(`Unknown Bin Rule reference: ${rule.public_reference}.`);
  }
  return { valid: issues.length === 0, issues, domains: ["system_settings", "bin_rules"], counts: { system_settings: settings.length, bin_rules: rules.length } };
};

const restoreSnapshot = async (snapshot, actorId, database = db) => {
  const client = await database.pool.connect();
  try {
    await client.query("BEGIN");
    const validation = await validateSnapshot(snapshot, client);
    if (!validation.valid) throw buildError("Configuration backup validation failed.", 400, validation.issues, "CONFIG_BACKUP_INVALID");
    for (const item of snapshot.sections.system_settings) {
      await client.query(`UPDATE system_settings SET setting_value=$2::jsonb,updated_by=$3,updated_at=CURRENT_TIMESTAMP,
        revision=revision+1,validation_status='valid',validated_at=CURRENT_TIMESTAMP,validation_error=NULL WHERE setting_key=$1`,
      [item.setting_key, JSON.stringify(item.setting_value), actorId || null]);
    }
    for (const rule of snapshot.sections.bin_rules) {
      await client.query(`UPDATE bin_rules SET rule_name=$2,description=$3,is_active=$4,parameters=$5::jsonb,
        rule_type=$6,evaluator_type=$7,execution_targets=$8::text[],violation_action=$9,severity=$10,priority=$11,
        updated_by=$12,updated_at=CURRENT_TIMESTAMP WHERE public_reference=$1`,
      [rule.public_reference,rule.rule_name,rule.description||null,Boolean(rule.is_active),JSON.stringify(rule.parameters||{}),rule.rule_type,rule.evaluator_type,rule.execution_targets||[],rule.violation_action,rule.severity,Number(rule.priority),actorId||null]);
    }
    const placementReadiness = await getWorkflowReadiness("placement_confirmation", client);
    if (!placementReadiness.ready) throw buildError("Restored Bin Rules fail operational readiness.", 400, placementReadiness, "RESTORE_READINESS_FAILED");
    await writeAuditLog({ user_id: actorId, action: "RESTORE_CONFIGURATION_BACKUP", module: "System Configuration", description: "Restored a validated configuration backup transactionally.", metadata: { format: FORMAT, version: VERSION, changed_domains: validation.domains, counts: validation.counts } }, client);
    await client.query("COMMIT");
    return { ...validation, readiness: await getSystemReadiness() };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
};

module.exports = { FORMAT, VERSION, exportSnapshot, restoreSnapshot, validateSnapshot };

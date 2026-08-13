const db = require("../config/db");
const { buildError } = require("../utils/apiError");
const { getSettingDefinition, validateSettingValue } = require("./configurationRegistryService");
const { writeConfigurationAudit } = require("./configurationAuditService");

const SYSTEM_SETTING_KEYS = Object.freeze({
  maximumActiveSystemAdministrators: "maximum_active_system_administrators"
});

const readRegisteredSetting = async (settingKey, executor = db) => {
  const definition = await getSettingDefinition(settingKey, executor);
  if (!definition) return { setting_key: settingKey, valid: false, status: "undefined", criticality: null, issues: [{ code: "CONFIG_SETTING_NOT_DEFINED", message: "The setting is not registered." }] };
  const result = await executor.query(
    `SELECT setting_value, revision, validation_status, validated_at, validation_error
     FROM system_settings WHERE setting_key = $1 LIMIT 1`,
    [settingKey]
  );
  const validation = validateSettingValue(definition, result.rows[0]?.setting_value);
  return {
    setting_key: settingKey,
    definition,
    criticality: definition.criticality,
    revision: result.rows[0]?.revision || null,
    ...validation
  };
};

const getTypedSetting = async (settingKey, expectedType, options = {}, executor = db) => {
  const result = await readRegisteredSetting(settingKey, executor);
  if (result.definition && result.definition.value_type !== expectedType) {
    return { ...result, valid: false, status: "invalid", value: undefined, issues: [{ code: "CONFIG_SETTING_TYPE_MISMATCH", message: `The setting is not registered as ${expectedType}.` }] };
  }
  if (result.valid) return result;
  if (result.criticality === "technical" && Object.prototype.hasOwnProperty.call(options, "technicalFallback")) {
    const fallbackValidation = validateSettingValue(result.definition, options.technicalFallback);
    if (fallbackValidation.valid) return { ...result, ...fallbackValidation, status: "fallback", fallback_used: true };
  }
  return result;
};

const getBooleanSetting = (key, options, executor) => getTypedSetting(key, "boolean", options, executor);
const getIntegerSetting = (key, options, executor) => getTypedSetting(key, "integer", options, executor);
const getDecimalSetting = (key, options, executor) => getTypedSetting(key, "decimal", options, executor);
const getStringSetting = (key, options, executor) => getTypedSetting(key, "string", options, executor);
const getJsonSetting = (key, options, executor) => getTypedSetting(key, "json", options, executor);
const getDurationSetting = (key, options, executor) => getTypedSetting(key, "duration_ms", options, executor);

const requireValidSetting = (result) => {
  if (result.valid) return result.value;
  const firstIssue = result.issues?.[0];
  const code = firstIssue?.code || "CONFIG_VALIDATION_FAILED";
  throw buildError(`Required system configuration '${result.setting_key}' is ${result.status}.`, 503, result.issues, code);
};

const readPositiveIntegerSetting = async (settingKey, executor = db) => requireValidSetting(
  await getIntegerSetting(settingKey, {}, executor)
);

const getMaximumActiveSystemAdministrators = (executor = db) => readPositiveIntegerSetting(
  SYSTEM_SETTING_KEYS.maximumActiveSystemAdministrators,
  executor
);

const updateRegisteredSetting = async ({ settingKey, value, actorId, module, action }, database = db) => {
  const client = await database.pool.connect();
  try {
    await client.query("BEGIN");
    const definition = await getSettingDefinition(settingKey, client);
    const validation = validateSettingValue(definition, value);
    if (!validation.valid) throw buildError("Configuration validation failed.", 400, validation.issues, validation.issues[0]?.code || "CONFIG_VALIDATION_FAILED");
    const current = await client.query(
      "SELECT setting_value, revision FROM system_settings WHERE setting_key = $1 FOR UPDATE",
      [settingKey]
    );
    const previous = current.rows[0] || null;
    const nextRevision = Number(previous?.revision || 0) + 1;
    const updated = await client.query(
      `INSERT INTO system_settings
         (setting_key, setting_value, updated_by, updated_at, revision, validation_status, validated_at, validation_error)
       VALUES ($1,$2::jsonb,$3,CURRENT_TIMESTAMP,$4,'valid',CURRENT_TIMESTAMP,NULL)
       ON CONFLICT (setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value,
           updated_by = EXCLUDED.updated_by,
           updated_at = CURRENT_TIMESTAMP,
           revision = system_settings.revision + 1,
           validation_status = 'valid',
           validated_at = CURRENT_TIMESTAMP,
           validation_error = NULL
       RETURNING setting_value, revision, validation_status, validated_at`,
      [settingKey, JSON.stringify(validation.value), actorId || null, nextRevision]
    );
    const row = updated.rows[0];
    await writeConfigurationAudit({
      actorId, module, action, settingKey, definition,
      previousValue: previous?.setting_value,
      newValue: row.setting_value,
      previousRevision: previous?.revision || null,
      newRevision: row.revision,
      validation
    }, client);
    await client.query("COMMIT");
    return { setting_key: settingKey, value: row.setting_value, revision: row.revision, validation_status: row.validation_status, validated_at: row.validated_at };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  SYSTEM_SETTING_KEYS,
  getBooleanSetting,
  getDecimalSetting,
  getDurationSetting,
  getIntegerSetting,
  getJsonSetting,
  getMaximumActiveSystemAdministrators,
  getStringSetting,
  getTypedSetting,
  readPositiveIntegerSetting,
  readRegisteredSetting,
  requireValidSetting,
  updateRegisteredSetting
};

const db = require("../config/db");

const VALUE_TYPES = Object.freeze([
  "boolean",
  "integer",
  "decimal",
  "string",
  "json",
  "duration_ms"
]);

const CRITICALITIES = Object.freeze(["technical", "operational", "critical_policy"]);

const issue = (code, message, path = "value") => ({ code, message, path });

const parsePersistedValue = (value) => {
  if (typeof value !== "string") return { ok: true, value };
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false, value: null };
  }
};

const validateJsonSchema = (value, schema = {}, path = "value") => {
  const issues = [];
  if (schema.enum && !schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
    issues.push(issue("CONFIG_VALUE_NOT_ALLOWED", `${path} must be one of the configured values.`, path));
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < Number(schema.minimum)) issues.push(issue("CONFIG_VALUE_BELOW_MINIMUM", `${path} must be at least ${schema.minimum}.`, path));
    if (schema.maximum !== undefined && value > Number(schema.maximum)) issues.push(issue("CONFIG_VALUE_ABOVE_MAXIMUM", `${path} must be no greater than ${schema.maximum}.`, path));
    if (schema.exclusiveMinimum !== undefined && value <= Number(schema.exclusiveMinimum)) issues.push(issue("CONFIG_VALUE_BELOW_MINIMUM", `${path} must be greater than ${schema.exclusiveMinimum}.`, path));
    if (schema.exclusiveMaximum !== undefined && value >= Number(schema.exclusiveMaximum)) issues.push(issue("CONFIG_VALUE_ABOVE_MAXIMUM", `${path} must be less than ${schema.exclusiveMaximum}.`, path));
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < Number(schema.minLength)) issues.push(issue("CONFIG_VALUE_TOO_SHORT", `${path} must contain at least ${schema.minLength} characters.`, path));
    if (schema.maxLength !== undefined && value.length > Number(schema.maxLength)) issues.push(issue("CONFIG_VALUE_TOO_LONG", `${path} must contain no more than ${schema.maxLength} characters.`, path));
  }
  if (value && typeof value === "object" && !Array.isArray(value) && Array.isArray(schema.required)) {
    for (const property of schema.required) {
      if (value[property] === undefined || value[property] === null) issues.push(issue("CONFIG_JSON_PROPERTY_REQUIRED", `${path}.${property} is required.`, `${path}.${property}`));
    }
  }
  return issues;
};

const validateSettingValue = (definition, rawValue) => {
  if (!definition) return { valid: false, status: "undefined", issues: [issue("CONFIG_SETTING_NOT_DEFINED", "The setting is not registered.")] };
  if (!definition.is_active) return { valid: false, status: "inactive", issues: [issue("CONFIG_SETTING_INACTIVE", "The setting definition is inactive.")] };
  if (!VALUE_TYPES.includes(definition.value_type)) return { valid: false, status: "invalid", issues: [issue("CONFIG_SETTING_TYPE_UNSUPPORTED", "The setting uses an unsupported value type.")] };
  if (!CRITICALITIES.includes(definition.criticality)) return { valid: false, status: "invalid", issues: [issue("CONFIG_CRITICALITY_UNSUPPORTED", "The setting uses an unsupported criticality.")] };
  if (rawValue === undefined || rawValue === null) return { valid: false, status: "missing", issues: [issue("CONFIG_SETTING_MISSING", "The setting has no persisted value.")] };

  const type = definition.value_type;
  const parsed = type === "json" && typeof rawValue === "string"
    ? parsePersistedValue(rawValue)
    : { ok: true, value: rawValue };
  if (!parsed.ok) return { valid: false, status: "invalid", issues: [issue("CONFIG_JSON_MALFORMED", "The JSON value is malformed.")] };
  const value = parsed.value;
  const typeValid = type === "boolean" ? typeof value === "boolean"
    : type === "integer" ? Number.isSafeInteger(value)
      : type === "decimal" ? typeof value === "number" && Number.isFinite(value)
        : type === "duration_ms" ? Number.isSafeInteger(value) && value >= 0
          : type === "string" ? typeof value === "string"
            : type === "json" ? typeof value === "object" && value !== null
              : false;
  if (!typeValid) return { valid: false, status: "invalid", issues: [issue("CONFIG_SETTING_INVALID_TYPE", `The setting value must be ${type}.`)] };

  const issues = validateJsonSchema(value, definition.validation_schema || {});
  return { valid: issues.length === 0, status: issues.length ? "invalid" : "valid", value, issues };
};

const getSettingDefinition = async (settingKey, executor = db) => {
  const result = await executor.query(
    `SELECT setting_key, value_type, criticality, validation_schema, is_secret, description, is_active
     FROM system_setting_definitions
     WHERE setting_key = $1
     LIMIT 1`,
    [settingKey]
  );
  return result.rows[0] || null;
};

const listSettingDefinitions = async (executor = db) => executor.query(
  `SELECT setting_key, value_type, criticality, validation_schema, is_secret, description, is_active
   FROM system_setting_definitions
   ORDER BY setting_key`
);

const validateRegisteredSettings = async (executor = db) => {
  const result = await executor.query(
    `SELECT d.setting_key, d.value_type, d.criticality, d.validation_schema, d.is_secret,
            d.description, d.is_active, s.setting_value, s.revision,
            CASE WHEN s.setting_key IS NULL THEN FALSE ELSE TRUE END AS is_present
     FROM system_setting_definitions d
     LEFT JOIN system_settings s ON s.setting_key = d.setting_key
     ORDER BY d.setting_key`
  );
  return result.rows.map((row) => ({
    definition: row,
    revision: row.revision || null,
    ...validateSettingValue(row, row.is_present ? row.setting_value : undefined)
  }));
};

module.exports = {
  CRITICALITIES,
  VALUE_TYPES,
  getSettingDefinition,
  listSettingDefinitions,
  parsePersistedValue,
  validateJsonSchema,
  validateRegisteredSettings,
  validateSettingValue
};

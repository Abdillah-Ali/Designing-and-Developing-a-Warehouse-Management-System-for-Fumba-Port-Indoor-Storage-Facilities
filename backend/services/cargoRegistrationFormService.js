const db = require("../config/db");
const { buildError } = require("../utils/apiError");

const editableKeys = [
  "label",
  "help_text",
  "visible",
  "required",
  "editable",
  "display_order",
  "default_value",
  "placeholder",
  "section_key",
  "active"
];

const FIELD_CLASSIFICATION = Object.freeze({
  SYSTEM_REQUIRED: "system_required", CONFIGURABLE_REQUIRED: "configurable_required",
  CONDITIONAL_REQUIRED: "conditional_required", OPTIONAL: "optional", SYSTEM_MANAGED: "system_managed"
});
const PROTECTED_FIELD_REGISTRY = Object.freeze({
  consignee_name: FIELD_CLASSIFICATION.SYSTEM_REQUIRED, phone_number: FIELD_CLASSIFICATION.SYSTEM_REQUIRED,
  source_of_cargo: FIELD_CLASSIFICATION.SYSTEM_REQUIRED, cargo_type: FIELD_CLASSIFICATION.SYSTEM_REQUIRED,
  quantity: FIELD_CLASSIFICATION.SYSTEM_REQUIRED, weight: FIELD_CLASSIFICATION.SYSTEM_REQUIRED,
  volume: FIELD_CLASSIFICATION.SYSTEM_REQUIRED, cargo_condition: FIELD_CLASSIFICATION.SYSTEM_REQUIRED,
  container_number: FIELD_CLASSIFICATION.CONDITIONAL_REQUIRED, vehicle_number: FIELD_CLASSIFICATION.CONDITIONAL_REQUIRED,
  hazard_class: FIELD_CLASSIFICATION.CONDITIONAL_REQUIRED, inspection_notes: FIELD_CLASSIFICATION.CONDITIONAL_REQUIRED,
  received_by: FIELD_CLASSIFICATION.SYSTEM_MANAGED, received_datetime: FIELD_CLASSIFICATION.SYSTEM_MANAGED,
  receiving_warehouse: FIELD_CLASSIFICATION.SYSTEM_MANAGED, system_identifiers: FIELD_CLASSIFICATION.SYSTEM_MANAGED,
  registration_workflow: FIELD_CLASSIFICATION.SYSTEM_MANAGED
});

const fieldSelect = `
  SELECT
    field_key,
    core_field,
    field_type,
    field_classification,
    catalog_key,
    system_protected,
    required_locked,
    editable_locked,
    conditional_rule,
    option_values,
    label,
    help_text,
    visible,
    required,
    editable,
    display_order,
    default_value,
    placeholder,
    section_key,
    active,
    updated_at
  FROM cargo_registration_fields
`;

const listAvailableFields = async (executor = db) => {
  return executor.query(`${fieldSelect} ORDER BY display_order, field_key`);
};

const getPublishedConfiguration = async (executor = db) => {
  const fields = await executor.query(
    `${fieldSelect}
     WHERE active = TRUE
       AND visible = TRUE
     ORDER BY display_order, field_key`
  );
  return decorateConfiguration(fields, executor);
};

const listCatalogOptions = async (executor = db, { includeInactive = false } = {}) => executor.query(
  `SELECT c.catalog_key, c.display_label AS catalog_label, c.description AS catalog_description,
          o.option_key, o.storage_value, o.display_label, o.sort_order, o.is_active AS active, o.is_system_protected
   FROM cargo_option_catalogs c
   JOIN cargo_option_values o ON o.catalog_key = c.catalog_key
   WHERE c.is_active = TRUE ${includeInactive ? "" : "AND o.is_active = TRUE"}
   ORDER BY c.catalog_key, o.sort_order, o.option_key`
);

const listConditions = async (executor = db) => executor.query(
  `SELECT condition_key, controlling_field_key, operator, expected_value,
          target_field_key, requirement, sort_order, is_active AS active
   FROM cargo_registration_conditions
   WHERE is_active = TRUE
   ORDER BY sort_order, condition_key`
);

const decorateConfiguration = async (fieldsResult, executor = db) => {
  const [optionsResult, conditionsResult] = await Promise.all([
    listCatalogOptions(executor),
    listConditions(executor)
  ]);
  const optionsByCatalog = {};
  for (const option of optionsResult.rows) {
    (optionsByCatalog[option.catalog_key] ||= []).push(option);
  }
  const conditions = conditionsResult.rows.map((condition) => {
    const controller = fieldsResult.rows.find((field) => field.field_key === condition.controlling_field_key);
    const lookup = new Map((optionsByCatalog[controller?.catalog_key] || []).map((option) => [option.option_key, option.storage_value]));
    const expectedKeys = Array.isArray(condition.expected_value) ? condition.expected_value : [condition.expected_value];
    return { ...condition, expected_option_keys: expectedKeys, expected_values: expectedKeys.map((key) => lookup.get(key) || key) };
  });
  const fields = fieldsResult.rows.map((field) => ({
    ...field,
    options: field.catalog_key ? (optionsByCatalog[field.catalog_key] || []) : [],
    conditional_rules: conditions.filter((condition) => condition.target_field_key === field.field_key)
  }));
  return { rows: fields, rowCount: fields.length, fields, catalogs: optionsByCatalog, conditions };
};

const cleanText = (value, maximum, fieldName, { required = false } = {}) => {
  if (value === undefined) return undefined;
  const cleaned = value === null ? null : String(value).trim();
  if (required && !cleaned) throw buildError(`${fieldName} is required.`, 400);
  if (cleaned && cleaned.length > maximum) {
    throw buildError(`${fieldName} must not exceed ${maximum} characters.`, 400);
  }
  return cleaned || null;
};

const normalizeBoolean = (value, fieldName) => {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw buildError(`${fieldName} must be true or false.`, 400);
  return value;
};

const normalizeConfiguration = async (fields, executor = db) => {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw buildError("At least one cargo registration field configuration is required.", 400);
  }

  const currentResult = await listAvailableFields(executor);
  const currentByKey = new Map(currentResult.rows.map((field) => [field.field_key, field]));
  const submittedKeys = new Set();
  const normalized = [];

  for (const input of fields) {
    const fieldKey = String(input?.field_key || "").trim();
    const current = currentByKey.get(fieldKey);
    if (!current) throw buildError(`Unknown cargo registration field '${fieldKey}'.`, 400);
    if (submittedKeys.has(fieldKey)) throw buildError(`Field '${fieldKey}' was submitted more than once.`, 400);
    submittedKeys.add(fieldKey);

    const next = { field_key: fieldKey };
    next.label = cleanText(input.label, 120, `${fieldKey} label`, { required: true }) ?? current.label;
    next.help_text = cleanText(input.help_text, 1000, `${fieldKey} help text`);
    if (next.help_text === undefined) next.help_text = current.help_text;
    next.placeholder = cleanText(input.placeholder, 300, `${fieldKey} placeholder`);
    if (next.placeholder === undefined) next.placeholder = current.placeholder;
    next.section_key = cleanText(input.section_key, 80, `${fieldKey} section`, { required: true }) ?? current.section_key;
    next.visible = normalizeBoolean(input.visible, `${fieldKey} visible`) ?? current.visible;
    next.required = normalizeBoolean(input.required, `${fieldKey} required`) ?? current.required;
    next.editable = normalizeBoolean(input.editable, `${fieldKey} editable`) ?? current.editable;
    next.active = normalizeBoolean(input.active, `${fieldKey} active`) ?? current.active;
    next.display_order = Number(input.display_order ?? current.display_order);
    if (!Number.isSafeInteger(next.display_order) || next.display_order < 1) {
      throw buildError(`${fieldKey} display order must be a positive whole number.`, 400);
    }
    next.default_value = input.default_value === undefined ? current.default_value : input.default_value;

    const trustedClassification = PROTECTED_FIELD_REGISTRY[fieldKey] || current.field_classification;

    if ([FIELD_CLASSIFICATION.SYSTEM_REQUIRED, FIELD_CLASSIFICATION.CONDITIONAL_REQUIRED, FIELD_CLASSIFICATION.SYSTEM_MANAGED].includes(trustedClassification) && (!next.visible || !next.active)) {
      throw buildError(`${current.label} is system protected and cannot be hidden or deactivated.`, 400);
    }
    if (next.required && (!next.visible || !next.active)) {
      throw buildError(`${current.label} cannot be required while hidden or inactive.`, 400);
    }
    if (trustedClassification === FIELD_CLASSIFICATION.SYSTEM_REQUIRED && !next.required) {
      throw buildError(`${current.label} is system protected and must remain required.`, 400);
    }
    if (trustedClassification === FIELD_CLASSIFICATION.SYSTEM_MANAGED && next.editable) {
      throw buildError(`${current.label} is system managed and must remain read-only.`, 400);
    }
    if (current.field_type === "system" && next.default_value !== null) {
      throw buildError(`${current.label} is system managed and cannot have a configured default.`, 400);
    }
    if (
      current.field_type === "select"
      && next.default_value !== null
      && current.catalog_key
    ) {
      const option = await executor.query(
        `SELECT 1 FROM cargo_option_values WHERE catalog_key = $1 AND is_active = TRUE AND (option_key = $2 OR storage_value = $2)`,
        [current.catalog_key, String(next.default_value)]
      );
      if (!option.rowCount) throw buildError(`${current.label} default value must be one of its active options.`, 400);
    }

    normalized.push(next);
  }

  return normalized;
};

const conditionMatches = (rule, payload) => {
  if (!rule?.field) return true;
  const actual = payload[rule.field];
  if (rule.operator === "equals") return actual === rule.value;
  if (rule.operator === "not_equals") return actual !== rule.value;
  if (rule.operator === "in") return Array.isArray(rule.value) && rule.value.includes(actual);
  return true;
};

const applyConfiguredDefaults = async (payload = {}, executor = db) => {
  const result = await executor.query(
    `${fieldSelect}
     WHERE active = TRUE
     ORDER BY display_order, field_key`
  );
  const next = { ...payload };
  for (const field of result.rows) {
    if (
      field.core_field
      && field.default_value !== null
      && field.default_value !== undefined
      && (next[field.field_key] === undefined || next[field.field_key] === null || next[field.field_key] === "")
    ) {
      next[field.field_key] = field.default_value;
    }
  }
  return next;
};

const isBlank = (value) => value === undefined || value === null || (typeof value === "string" && !value.trim());

const configurationIssue = (code, message, fieldKey) => ({ code, message, field_key: fieldKey, impact: "blocked" });

const validateCargoRegistrationConfiguration = async (executor = db) => {
  const fieldsResult = await listAvailableFields(executor);
  const conditionsResult = await listConditions(executor);
  const byKey = new Map(fieldsResult.rows.map((field) => [field.field_key, field]));
  const issues = [];
  if (!fieldsResult.rowCount) issues.push(configurationIssue("CARGO_CONFIGURATION_EMPTY", "No cargo registration fields are configured."));
  for (const [fieldKey, classification] of Object.entries(PROTECTED_FIELD_REGISTRY)) {
    const field = byKey.get(fieldKey);
    if (!field) issues.push(configurationIssue("PROTECTED_FIELD_MISSING", `Protected cargo field ${fieldKey} is missing.`, fieldKey));
    else if (field.field_classification !== classification) issues.push(configurationIssue("FIELD_CLASSIFICATION_INVALID", `${field.label} has an invalid classification.`, fieldKey));
  }
  for (const field of fieldsResult.rows) {
    if (["system_required", "system_managed", "conditional_required"].includes(field.field_classification) && (!field.active || !field.visible)) {
      issues.push(configurationIssue("PROTECTED_FIELD_UNAVAILABLE", `${field.label} must remain active and visible.`, field.field_key));
    }
    if (field.field_classification === "system_required" && !field.required) issues.push(configurationIssue("SYSTEM_REQUIRED_FIELD_OPTIONAL", `${field.label} must remain required.`, field.field_key));
    if (field.field_classification === "system_managed" && field.editable) issues.push(configurationIssue("SYSTEM_MANAGED_FIELD_EDITABLE", `${field.label} must remain read-only.`, field.field_key));
    if (field.catalog_key) {
      const count = await executor.query("SELECT COUNT(*)::int AS count FROM cargo_option_values WHERE catalog_key=$1 AND is_active=TRUE", [field.catalog_key]);
      if (!count.rows[0]?.count) issues.push(configurationIssue("CATALOG_HAS_NO_ACTIVE_OPTIONS", `${field.label} has no active options.`, field.field_key));
    }
  }
  for (const condition of conditionsResult.rows) {
    if (!byKey.has(condition.controlling_field_key) || !byKey.has(condition.target_field_key)) issues.push(configurationIssue("CONDITION_FIELD_MISSING", `Condition ${condition.condition_key} references a missing field.`, condition.target_field_key));
    const controllingField = byKey.get(condition.controlling_field_key);
    const expectedKeys = Array.isArray(condition.expected_value) ? condition.expected_value : [condition.expected_value];
    if (controllingField?.catalog_key) {
      const validOptions = await executor.query("SELECT option_key FROM cargo_option_values WHERE catalog_key=$1", [controllingField.catalog_key]);
      const validKeys = new Set(validOptions.rows.map((option) => option.option_key));
      if (expectedKeys.some((key) => !validKeys.has(key))) issues.push(configurationIssue("CONDITION_OPTION_INVALID", `Condition ${condition.condition_key} references an unknown option.`, condition.controlling_field_key));
    }
  }
  return { valid: issues.length === 0, issues };
};

const normalizeCatalogPayload = async (payload = {}, executor = db, { allowInactive = false } = {}) => {
  const result = await listAvailableFields(executor);
  const next = { ...payload };
  const optionKeys = {};
  const errors = [];
  for (const field of result.rows.filter((entry) => entry.catalog_key && !isBlank(next[entry.field_key]))) {
    const option = await executor.query(
      `SELECT option_key, storage_value, is_active AS active FROM cargo_option_values
       WHERE catalog_key=$1 AND (option_key=$2 OR storage_value=$2) LIMIT 1`,
      [field.catalog_key, String(next[field.field_key])]
    );
    if (!option.rowCount) errors.push(configurationIssue("CARGO_OPTION_INVALID", `${field.label} contains an unknown option.`, field.field_key));
    else if (!option.rows[0].active && !allowInactive) errors.push(configurationIssue("CARGO_OPTION_INACTIVE", `${field.label} contains an inactive option.`, field.field_key));
    else {
      next[field.field_key] = option.rows[0].storage_value;
      optionKeys[field.field_key] = option.rows[0].option_key;
    }
  }
  return { payload: next, option_keys: optionKeys, errors };
};

const validateConfiguredCargoPayload = async (payload = {}, executor = db, options = {}) => {
  if (!options.skipConfigurationReadiness) {
    const readiness = await validateCargoRegistrationConfiguration(executor);
    if (!readiness.valid) return readiness.issues;
  }
  const result = await getPublishedConfiguration(executor);
  const errors = [];
  const normalized = await normalizeCatalogPayload(payload, executor, options);
  errors.push(...normalized.errors);
  const optionKeyByValue = new Map();
  Object.values(result.catalogs).flat().forEach((option) => optionKeyByValue.set(`${option.catalog_key}:${option.storage_value}`, option.option_key));
  const conditionMatchesMetadata = (condition) => {
    const controller = result.rows.find((field) => field.field_key === condition.controlling_field_key);
    const actual = optionKeyByValue.get(`${controller?.catalog_key}:${normalized.payload[condition.controlling_field_key]}`) || normalized.payload[condition.controlling_field_key];
    if (condition.operator === "equals") return actual === condition.expected_option_keys[0];
    if (condition.operator === "not_equals") return actual !== condition.expected_option_keys[0];
    if (condition.operator === "in") return condition.expected_option_keys.includes(actual);
    return false;
  };
  for (const field of result.rows) {
    if (!field.core_field || field.field_classification === "system_managed" || field.field_type === "file") continue;
    const conditionalRequired = field.conditional_rules.some(conditionMatchesMetadata);
    const required = field.field_classification === "system_required" || (field.field_classification === "configurable_required" && field.required) || conditionalRequired;
    if (!required) continue;
    const value = payload[field.field_key];
    if (isBlank(value)) errors.push(configurationIssue(conditionalRequired ? "CARGO_CONDITIONAL_FIELD_REQUIRED" : "CARGO_FIELD_REQUIRED", `${field.label} is required.`, field.field_key));
  }
  for (const field of result.rows.filter((entry) => entry.field_classification === "system_managed")) {
    if (options.allowSystemManaged) continue;
    if (Object.prototype.hasOwnProperty.call(payload, field.field_key)) errors.push(configurationIssue("CARGO_FIELD_READ_ONLY", `${field.label} is managed by the system and cannot be submitted.`, field.field_key));
  }
  if (!isBlank(payload.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(payload.email).trim())) errors.push(configurationIssue("CARGO_FIELD_FORMAT_INVALID", "Email must be a valid email address.", "email"));
  if (!isBlank(payload.phone_number) && !/^\+?[0-9][0-9\s()-]{6,18}[0-9]$/.test(String(payload.phone_number).trim())) errors.push(configurationIssue("CARGO_FIELD_FORMAT_INVALID", "Phone Number must be valid and may start with +.", "phone_number"));
  for (const fieldKey of ["quantity", "weight", "volume"]) {
    if (!isBlank(payload[fieldKey]) && (!Number.isFinite(Number(payload[fieldKey])) || Number(payload[fieldKey]) <= 0)) {
      errors.push(configurationIssue("CARGO_FIELD_RANGE_INVALID", `${result.rows.find((field) => field.field_key === fieldKey)?.label || fieldKey} must be greater than zero.`, fieldKey));
    }
  }
  return errors;
};

const updateConfiguration = async ({ fields, actorId, executor = db }) => {
  const normalized = await normalizeConfiguration(fields, executor);
  const previousResult = await listAvailableFields(executor);
  const previousByKey = new Map(previousResult.rows.map((field) => [field.field_key, field]));
  const changes = [];

  for (const field of normalized) {
    const previous = previousByKey.get(field.field_key);
    const before = {};
    const after = {};
    for (const key of editableKeys) {
      const previousValue = previous[key] ?? null;
      const nextValue = field[key] ?? null;
      if (JSON.stringify(previousValue) !== JSON.stringify(nextValue)) {
        before[key] = previousValue;
        after[key] = nextValue;
      }
    }
    if (Object.keys(after).length > 0) {
      changes.push({ field_key: field.field_key, before, after });
    }

    await executor.query(
      `UPDATE cargo_registration_fields
       SET label = $1,
           help_text = $2,
           visible = $3,
           required = $4,
           editable = $5,
           display_order = $6,
           default_value = $7::jsonb,
           placeholder = $8,
           section_key = $9,
           active = $10,
           updated_by = $11,
           updated_at = CURRENT_TIMESTAMP
       WHERE field_key = $12`,
      [
        field.label,
        field.help_text,
        field.visible,
        field.required,
        field.editable,
        field.display_order,
        JSON.stringify(field.default_value),
        field.placeholder,
        field.section_key,
        field.active,
        actorId || null,
        field.field_key
      ]
    );
  }

  return { changes, fields: (await listAvailableFields(executor)).rows };
};

const resetConfiguration = async ({ actorId, executor = db }) => {
  const previousResult = await listAvailableFields(executor);
  await executor.query(
    `UPDATE cargo_registration_fields
     SET label = default_label,
         help_text = default_help_text,
         visible = default_visible,
         required = default_required,
         editable = default_editable,
         display_order = default_display_order,
         default_value = default_value_snapshot,
         placeholder = default_placeholder,
         section_key = default_section_key,
         active = default_active,
         updated_by = $1,
         updated_at = CURRENT_TIMESTAMP`,
    [actorId || null]
  );
  const currentResult = await listAvailableFields(executor);
  return {
    previous: previousResult.rows,
    fields: currentResult.rows
  };
};

module.exports = {
  FIELD_CLASSIFICATION,
  PROTECTED_FIELD_REGISTRY,
  applyConfiguredDefaults,
  editableKeys,
  getPublishedConfiguration,
  listCatalogOptions,
  listConditions,
  listAvailableFields,
  normalizeConfiguration,
  normalizeCatalogPayload,
  resetConfiguration,
  updateConfiguration,
  validateConfiguredCargoPayload,
  validateCargoRegistrationConfiguration
};

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

const fieldSelect = `
  SELECT
    field_key,
    core_field,
    field_type,
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
  return executor.query(
    `${fieldSelect}
     WHERE active = TRUE
       AND visible = TRUE
     ORDER BY display_order, field_key`
  );
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

    if (current.system_protected && (!next.visible || !next.active)) {
      throw buildError(`${current.label} is system protected and cannot be hidden or deactivated.`, 400);
    }
    if (next.required && (!next.visible || !next.active)) {
      throw buildError(`${current.label} cannot be required while hidden or inactive.`, 400);
    }
    if (current.required_locked && !next.required) {
      throw buildError(`${current.label} is system protected and must remain required.`, 400);
    }
    if (current.editable_locked && next.editable) {
      throw buildError(`${current.label} is system managed and must remain read-only.`, 400);
    }
    if (current.field_type === "system" && next.default_value !== null) {
      throw buildError(`${current.label} is system managed and cannot have a configured default.`, 400);
    }
    if (
      current.field_type === "select"
      && next.default_value !== null
      && !current.option_values.includes(next.default_value)
    ) {
      throw buildError(`${current.label} default value must be one of its predefined options.`, 400);
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

const validateConfiguredCargoPayload = async (payload = {}, executor = db) => {
  const result = await getPublishedConfiguration(executor);
  const errors = [];
  for (const field of result.rows) {
    if (!field.core_field || ["system", "file"].includes(field.field_type)) continue;
    const conditionalRequired = Boolean(
      field.conditional_rule?.required
      && conditionMatches(field.conditional_rule, payload)
    );
    if (!field.required && !conditionalRequired) continue;
    const value = payload[field.field_key];
    if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
      errors.push(`${field.label} is required.`);
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
  applyConfiguredDefaults,
  editableKeys,
  getPublishedConfiguration,
  listAvailableFields,
  normalizeConfiguration,
  resetConfiguration,
  updateConfiguration,
  validateConfiguredCargoPayload
};

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  applyConfiguredDefaults,
  normalizeConfiguration,
  validateConfiguredCargoPayload
} = require("../services/cargoRegistrationFormService");

const fields = [
  {
    field_key: "consignee_name",
    core_field: true,
    field_type: "text",
    field_classification: "system_required",
    catalog_key: null,
    system_protected: true,
    required_locked: true,
    editable_locked: false,
    conditional_rule: {},
    option_values: [],
    label: "Consignee Name",
    help_text: "",
    visible: true,
    required: true,
    editable: true,
    display_order: 10,
    default_value: null,
    placeholder: "",
    section_key: "consignee",
    active: true
  },
  {
    field_key: "company_name",
    core_field: true,
    field_type: "text",
    field_classification: "configurable_required",
    catalog_key: null,
    system_protected: false,
    required_locked: false,
    editable_locked: false,
    conditional_rule: {},
    option_values: [],
    label: "Company Name",
    help_text: "",
    visible: true,
    required: false,
    editable: true,
    display_order: 20,
    default_value: "Fumba",
    placeholder: "",
    section_key: "consignee",
    active: true
  }
];

const executor = {
  async query(sql) {
    if (sql.includes("FROM cargo_registration_fields")) {
      const published = sql.includes("WHERE active = TRUE") && sql.includes("visible = TRUE");
      return {
        rowCount: fields.length,
        rows: published ? fields.filter((field) => field.active && field.visible) : fields
      };
    }
    if (sql.includes("FROM cargo_registration_conditions")) return { rowCount: 0, rows: [] };
    if (sql.includes("FROM cargo_option_catalogs")) return { rowCount: 0, rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  }
};

test("protected cargo registration fields cannot be hidden", async () => {
  await assert.rejects(
    normalizeConfiguration([{ ...fields[0], visible: false }], executor),
    /system protected and cannot be hidden or deactivated/i
  );
});

test("configured defaults and configurable required fields are backend enforced", async () => {
  const payload = await applyConfiguredDefaults({ consignee_name: "Port User" }, executor);
  assert.equal(payload.company_name, "Fumba");

  fields[1].required = true;
  const errors = await validateConfiguredCargoPayload({ consignee_name: "Port User" }, executor, { skipConfigurationReadiness: true });
  assert.deepEqual(errors, [{ code: "CARGO_FIELD_REQUIRED", message: "Company Name is required.", field_key: "company_name", impact: "blocked" }]);
  fields[1].required = false;
});

test("Phase 2 authority migration defines catalogs, stable conditions and classifications", () => {
  const migration = fs.readFileSync(path.join(__dirname, "..", "database", "migrations", "20260812_cargo_registration_configuration_authority.sql"), "utf8");
  assert.match(migration, /field_classification/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS cargo_option_catalogs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS cargo_registration_conditions/);
  assert.match(migration, /hazardous_cargo/);
});

test("form builder migration provides predefined fields and separate custom values", () => {
  const migration = fs.readFileSync(
    path.join(__dirname, "..", "database", "migrations", "20260730_cargo_registration_form_builder.sql"),
    "utf8"
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS cargo_registration_fields/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS cargo_custom_field_values/);
  assert.match(migration, /system\.cargo_registration_form\.manage/);
});

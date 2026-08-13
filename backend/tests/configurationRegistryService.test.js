const test = require("node:test");
const assert = require("node:assert/strict");
const {
  VALUE_TYPES,
  validateSettingValue
} = require("../services/configurationRegistryService");

const definition = (valueType, schema = {}, overrides = {}) => ({
  setting_key: "test_setting",
  value_type: valueType,
  criticality: "operational",
  validation_schema: schema,
  is_secret: false,
  is_active: true,
  ...overrides
});

test("configuration registry recognizes every Phase 0 value type", () => {
  assert.deepEqual(VALUE_TYPES, ["boolean", "integer", "decimal", "string", "json", "duration_ms"]);
});

test("configuration registry validates booleans and rejects invalid boolean values", () => {
  assert.equal(validateSettingValue(definition("boolean"), true).valid, true);
  assert.equal(validateSettingValue(definition("boolean"), "true").issues[0].code, "CONFIG_SETTING_INVALID_TYPE");
});

test("configuration registry validates integer bounds", () => {
  const integer = definition("integer", { minimum: 1, maximum: 3 });
  assert.equal(validateSettingValue(integer, 2).valid, true);
  assert.equal(validateSettingValue(integer, 1.5).valid, false);
  assert.equal(validateSettingValue(integer, 0).issues[0].code, "CONFIG_VALUE_BELOW_MINIMUM");
  assert.equal(validateSettingValue(integer, 4).issues[0].code, "CONFIG_VALUE_ABOVE_MAXIMUM");
});

test("configuration registry validates decimals, durations, strings and enums", () => {
  assert.equal(validateSettingValue(definition("decimal", { exclusiveMinimum: 0 }), 0.25).valid, true);
  assert.equal(validateSettingValue(definition("duration_ms", { minimum: 60000 }), 300000).valid, true);
  assert.equal(validateSettingValue(definition("string", { enum: ["A", "B"] }), "A").valid, true);
  assert.equal(validateSettingValue(definition("string", { enum: ["A", "B"] }), "C").valid, false);
});

test("configuration registry validates JSON requirements and malformed JSON", () => {
  const json = definition("json", { required: ["enabled"] });
  assert.equal(validateSettingValue(json, { enabled: true }).valid, true);
  assert.equal(validateSettingValue(json, {}).issues[0].code, "CONFIG_JSON_PROPERTY_REQUIRED");
  assert.equal(validateSettingValue(json, "{broken").issues[0].code, "CONFIG_JSON_MALFORMED");
});

test("configuration registry identifies missing, inactive, unknown and unsupported settings", () => {
  assert.equal(validateSettingValue(definition("boolean"), undefined).status, "missing");
  assert.equal(validateSettingValue(definition("boolean", {}, { is_active: false }), true).status, "inactive");
  assert.equal(validateSettingValue(null, true).status, "undefined");
  assert.equal(validateSettingValue(definition("executable"), true).issues[0].code, "CONFIG_SETTING_TYPE_UNSUPPORTED");
});

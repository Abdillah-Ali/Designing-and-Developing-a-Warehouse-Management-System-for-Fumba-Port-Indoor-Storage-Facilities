const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getBooleanSetting,
  getIntegerSetting,
  getMaximumActiveSystemAdministrators,
  updateRegisteredSetting
} = require("../services/systemConfigurationService");
const { safeAuditValue } = require("../services/configurationAuditService");
const { canAccessRoute, PORTAL_ROLES } = require("../middleware/authMiddleware");

const definition = (key, type, criticality = "operational") => ({
  setting_key: key,
  value_type: type,
  criticality,
  validation_schema: type === "integer" ? { minimum: 1 } : {},
  is_secret: false,
  description: key,
  is_active: true
});

const readExecutor = (settingDefinition, row) => ({
  async query(sql) {
    if (sql.includes("FROM system_setting_definitions")) return { rowCount: settingDefinition ? 1 : 0, rows: settingDefinition ? [settingDefinition] : [] };
    if (sql.includes("FROM system_settings")) return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    throw new Error(`Unexpected query: ${sql}`);
  }
});

test("typed configuration reads valid, missing and invalid persisted settings", async () => {
  const valid = await getBooleanSetting("feature", {}, readExecutor(definition("feature", "boolean"), { setting_value: true, revision: 2 }));
  assert.equal(valid.valid, true);
  assert.equal(valid.value, true);
  assert.equal((await getBooleanSetting("feature", {}, readExecutor(definition("feature", "boolean"), null))).status, "missing");
  assert.equal((await getBooleanSetting("feature", {}, readExecutor(definition("feature", "boolean"), { setting_value: "yes", revision: 1 }))).status, "invalid");
});

test("only technical definitions can use an explicit validated fallback", async () => {
  const technical = await getBooleanSetting("feature", { technicalFallback: false }, readExecutor(definition("feature", "boolean", "technical"), null));
  const operational = await getBooleanSetting("feature", { technicalFallback: false }, readExecutor(definition("feature", "boolean"), null));
  assert.equal(technical.status, "fallback");
  assert.equal(technical.value, false);
  assert.equal(operational.valid, false);
});

test("maximum administrator capacity remains fail closed and positive", async () => {
  const key = "maximum_active_system_administrators";
  assert.equal(await getMaximumActiveSystemAdministrators(readExecutor(definition(key, "integer", "critical_policy"), { setting_value: 3, revision: 1 })), 3);
  await assert.rejects(getMaximumActiveSystemAdministrators(readExecutor(definition(key, "integer", "critical_policy"), { setting_value: 0, revision: 1 })), /configuration.*invalid/i);
});

test("secret audit values are redacted", () => {
  assert.deepEqual(safeAuditValue({ is_secret: true }, "secret"), { redacted: true, present: true });
  assert.equal(safeAuditValue({ is_secret: false }, "visible"), "visible");
});

test("transactional update increments revision and audits the committed change", async () => {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("FROM system_setting_definitions")) return { rowCount: 1, rows: [definition("feature", "boolean")] };
      if (sql.includes("SELECT setting_value, revision")) return { rowCount: 1, rows: [{ setting_value: false, revision: 4 }] };
      if (sql.includes("INSERT INTO system_settings")) return { rowCount: 1, rows: [{ setting_value: true, revision: 5, validation_status: "valid", validated_at: new Date() }] };
      if (sql.includes("INSERT INTO audit_logs")) return { rowCount: 1, rows: [{ id: 1 }] };
      return { rowCount: 0, rows: [] };
    },
    release() {}
  };
  const result = await updateRegisteredSetting({ settingKey: "feature", value: true, actorId: 7 }, { pool: { async connect() { return client; } } });
  assert.equal(result.revision, 5);
  assert.equal(queries.some(({ sql }) => sql === "COMMIT"), true);
  const audit = queries.find(({ sql }) => sql.includes("INSERT INTO audit_logs"));
  const metadata = JSON.parse(audit.params[7]);
  assert.equal(metadata.previous_revision, 4);
  assert.equal(metadata.new_revision, 5);
  assert.equal(audit.params[0], 7);
});

test("rejected update neither increments revision nor writes a success audit", async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("FROM system_setting_definitions")) return { rowCount: 1, rows: [definition("feature", "boolean")] };
      return { rowCount: 0, rows: [] };
    },
    release() {}
  };
  await assert.rejects(updateRegisteredSetting({ settingKey: "feature", value: "invalid", actorId: 7 }, { pool: { async connect() { return client; } } }), /validation failed/i);
  assert.equal(queries.some((sql) => sql.includes("INSERT INTO system_settings")), false);
  assert.equal(queries.some((sql) => sql.includes("INSERT INTO audit_logs")), false);
  assert.equal(queries.includes("ROLLBACK"), true);
});

test("Phase 0 administrative endpoints remain protected by the existing portal matrix", () => {
  assert.equal(canAccessRoute(PORTAL_ROLES.SYSTEM_ADMIN, "GET", "/admin/readiness"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.SYSTEM_ADMIN, "POST", "/admin/configuration/validate"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "GET", "/admin/readiness"), false);
  assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "POST", "/admin/configuration/validate"), false);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { getDomainReadiness, getSystemReadiness } = require("../services/readinessService");

const row = (key, type, criticality, value, present = true) => ({
  setting_key: key,
  value_type: type,
  criticality,
  validation_schema: type === "integer" ? { minimum: 1 } : {},
  is_secret: false,
  description: key,
  is_active: true,
  setting_value: value,
  revision: 1,
  is_present: present
});

const executor = (rows) => ({ async query() { return { rowCount: rows.length, rows }; } });

test("readiness is healthy when all registered existing settings are valid", async () => {
  const result = await getSystemReadiness(executor([
    row("maximum_active_system_administrators", "integer", "critical_policy", 3),
    row("manual_placement_enabled", "boolean", "operational", false),
    row("cargo_pending_review_escalation_enabled", "boolean", "operational", true)
  ]));
  assert.equal(result.overall, "healthy");
  assert.equal(result.ready, true);
});

test("an invalid operational setting degrades only its domain", async () => {
  const result = await getSystemReadiness(executor([
    row("maximum_active_system_administrators", "integer", "critical_policy", 3),
    row("manual_placement_enabled", "boolean", "operational", "false")
  ]));
  assert.equal(result.overall, "degraded");
  assert.equal(result.domains.placement.ready, false);
  assert.equal(result.domains.rbac.ready, true);
});

test("an invalid critical setting blocks overall readiness without exposing values", async () => {
  const result = await getSystemReadiness(executor([
    row("maximum_active_system_administrators", "integer", "critical_policy", 0)
  ]));
  assert.equal(result.overall, "blocked");
  assert.equal(result.domains.rbac.status, "blocked");
  assert.equal(JSON.stringify(result).includes("setting_value"), false);
});

test("unknown readiness domains fail closed", async () => {
  const result = await getDomainReadiness("unknown", executor([]));
  assert.equal(result.ready, false);
  assert.equal(result.issues[0].code, "READINESS_DOMAIN_UNKNOWN");
});

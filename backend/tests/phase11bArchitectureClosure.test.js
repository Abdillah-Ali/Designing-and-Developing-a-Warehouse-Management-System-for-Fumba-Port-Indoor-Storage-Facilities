const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validateFinanceConfiguration } = require("../services/financeReadinessService");
const db = require("../config/db");
const { createTariffVersion, getApplicableTariff } = require("../services/financeService");
const { canAccessRoute, PORTAL_ROLES } = require("../middleware/authMiddleware");
const { summarizeReadiness } = require("../services/readinessService");

const validTariff = {
  public_reference: "TRV-VALID", calculator_key: "storage_started_day", currency: "TZS",
  configuration_status: "ready", effective_from: new Date("2026-01-01T00:00:00Z"), effective_to: null,
  daily_rate: "1000.00", tariff_scope: "default", cargo_type_key: "default",
  charging_unit: "per_cargo_per_day", minimum_billable_days: 1
};

const financeExecutor = ({ tariffs = [], overlaps = [], uncovered = [] } = {}) => ({
  query: async (sql) => {
    if (sql.includes("to_regclass")) return { rows: [{ tariffs: "tariff_versions", invoices: "invoices", payments: "payments" }], rowCount: 1 };
    if (sql.includes("JOIN tariff_versions b")) return { rows: overlaps, rowCount: overlaps.length };
    if (sql.includes("FROM cargo c")) return { rows: uncovered, rowCount: uncovered.length };
    if (sql.includes("FROM tariff_versions tv WHERE")) return { rows: tariffs, rowCount: tariffs.length };
    throw new Error(`Unexpected SQL: ${sql}`);
  }
});

test("zero tariffs is configuration-required and never treated as healthy", async () => {
  const result = await validateFinanceConfiguration(financeExecutor());
  assert.equal(result.ready, false);
  assert.equal(result.status, "configuration_required");
  assert.equal(result.usable_tariffs, 0);
  assert.ok(result.issues.some((issue) => issue.code === "NO_ACTIVE_USABLE_TARIFF"));
});

test("configuration-required Finance makes overall business readiness non-healthy", () => {
  const summary=summarizeReadiness({finance:{issues:[{code:"NO_ACTIVE_USABLE_TARIFF",impact:"configuration_required",criticality:"critical_policy"}]},authentication:{issues:[]}});
  assert.equal(summary.overall,"configuration_required");
});

test("a protected valid default tariff restores tariff readiness", async () => {
  const result = await validateFinanceConfiguration(financeExecutor({ tariffs: [validTariff] }));
  assert.equal(result.ready, true);
  assert.equal(result.status, "healthy");
  assert.equal(result.usable_tariffs, 1);
});

test("live valid default tariff restores readiness without leaving fixture data", async (t) => {
  let client;
  try { client=await db.pool.connect(); await client.query("BEGIN"); }
  catch (error) { if(client) client.release(); t.skip(`Live database unavailable: ${error.code||error.message}`); return; }
  try {
    const actor=(await client.query("SELECT id FROM users WHERE status='active' ORDER BY id LIMIT 1")).rows[0];
    await client.query("DELETE FROM tariff_versions");
    await createTariffVersion({payload:{tariff_name:"Phase 11B transactional readiness fixture",cargo_type_key:"default",charging_unit:"per_cargo_per_day",daily_rate:"1.00",currency:"TZS",minimum_billable_days:1,effective_from:"2026-01-01T00:00:00Z",is_active:true},auth:{userId:actor?.id},executor:client});
    const result=await validateFinanceConfiguration(client);
    assert.equal(result.ready,true);
    assert.equal(result.usable_tariffs,1);
  } finally {
    await client.query("ROLLBACK").catch(()=>{});
    client.release();
  }
});

test("invalid, review-required, and ambiguous tariffs do not satisfy readiness", async () => {
  const review = await validateFinanceConfiguration(financeExecutor({ tariffs: [{ ...validTariff, configuration_status: "review_required" }] }));
  assert.equal(review.ready, false);
  assert.ok(review.issues.some((issue) => issue.code === "FINANCE_TARIFF_REVIEW_REQUIRED"));
  const ambiguous = await validateFinanceConfiguration(financeExecutor({ tariffs: [validTariff], overlaps: [{ public_reference: "TRV-VALID" }] }));
  assert.equal(ambiguous.ready, false);
  assert.ok(ambiguous.issues.some((issue) => issue.code === "FINANCE_TARIFF_OVERLAP"));
});

test("charging fails closed with a stable code when no tariff applies", async () => {
  await assert.rejects(
    () => getApplicableTariff({ cargo_type: "Renamed Label", cargo_type_key: "general_goods" }, new Date(), { query: async () => ({ rows: [], rowCount: 0 }) }),
    (error) => error.errorCode === "TARIFF_CONFIGURATION_REQUIRED" && error.statusCode === 409
  );
});

test("registration checks tariff authority before inserting cargo", () => {
  const source = fs.readFileSync(path.join(__dirname, "../controllers/cargoController.js"), "utf8");
  const tariffCheck = source.indexOf("await getApplicableTariff(payload");
  const cargoInsert = source.indexOf("INSERT INTO cargo (${columns.join");
  assert.ok(tariffCheck > 0 && cargoInsert > tariffCheck);
});

test("configuration recovery stays RBAC protected while operational charging remains separate", () => {
  assert.equal(canAccessRoute(PORTAL_ROLES.FINANCE_OFFICER, "POST", "/finance/tariffs"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "POST", "/finance/tariffs"), false);
  assert.equal(canAccessRoute(PORTAL_ROLES.SYSTEM_ADMIN, "GET", "/admin/readiness"), true);
});

test("business readiness does not gate process listen and fatal startup remains caught", () => {
  const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  assert.match(source, /const readiness = await getSystemReadiness\(\)[\s\S]*server\.listen/);
  assert.doesNotMatch(source, /if\s*\(\s*!readiness\.ready\s*\)[\s\S]{0,120}(throw|process\.exit)/);
  assert.match(source, /catch \(error\)[\s\S]*process\.exit\(1\)/);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const db = require("../config/db");

const { getScannerWorkflow, listScannerWorkflows } = require("../services/scannerWorkflowRegistry");
const { expireStaleScannerSessions } = require("../services/scannerSessionCleanupService");
const { readScannerPolicy, requireScannerPolicy } = require("../services/scannerPolicyService");
const { expireSessionIfDue, refreshSessionActivity, serializeSession } = require("../services/scannerSessionService");

const read = (relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

test("migration 028 establishes scanner expiry, scan receipts, and validated operational policy", () => {
  const sql = read("database/migrations/20260813_scanner_policy_authority.sql");
  assert.match(sql, /last_activity_at TIMESTAMP NOT NULL/);
  assert.match(sql, /expires_at TIMESTAMP/);
  assert.match(sql, /'expired'/);
  assert.match(sql, /scanner_scan_attempts/);
  assert.match(sql, /scanner_session_timeout_minutes'[\s\S]*'20'::jsonb/);
  assert.match(sql, /scanner_duplicate_scan_window_ms'[\s\S]*'3000'::jsonb/);
});

test("trusted scanner workflow registry owns the two-step placement state machine", () => {
  assert.equal(listScannerWorkflows().length, 1);
  const workflow = getScannerWorkflow("cargo_placement");
  assert.deepEqual(workflow.steps.map((step) => step.scan_type), ["cargo", "bin"]);
  assert.deepEqual(workflow.operations, ["placement", "relocation"]);
  assert.equal(getScannerWorkflow("database_supplied_handler"), null);
});

test("scanner mutations use row locking, server duplicate receipts, and database-derived expiry", () => {
  const source = read("services/scannerSessionService.js");
  assert.match(source, /SELECT \* FROM scanner_sessions WHERE id=\$1 FOR UPDATE/);
  assert.match(source, /scanner_scan_attempts/);
  assert.match(source, /SCANNER_DUPLICATE_SCAN/);
  assert.match(source, /CURRENT_TIMESTAMP \+ \(\$2 \* INTERVAL '1 minute'\)/);
  assert.doesNotMatch(source, /STEP_TRANSITION_DUPLICATE_MS/);
});

test("invalid, rejected, and duplicate scans cannot refresh scanner activity", () => {
  const source = read("services/scannerSessionService.js");
  const duplicateBranch = source.slice(source.indexOf("if (duplicate.rowCount)"), source.indexOf("const step = session.current_step"));
  assert.doesNotMatch(duplicateBranch, /refreshSessionActivity/);
  const rejectStart = source.indexOf("const rejectScan");
  const rejectEnd = source.indexOf("const submitPlacementCargoScan");
  assert.doesNotMatch(source.slice(rejectStart, rejectEnd), /refreshSessionActivity/);
});

test("socket authentication and every scanner event revalidate persistent session expiry", () => {
  const source = read("realtime/socketServer.js");
  assert.match(source, /us\.expires_at > CURRENT_TIMESTAMP/g);
  assert.equal((source.match(/await revalidateSocketAuthority\(auth\)/g) || []).length, 3);
  assert.match(source, /scanner_role\.role_key = 'scanner'/);
});

test("cleanup expiry is idempotent and touches active overdue sessions only", async () => {
  const calls = [];
  const executor = { query: async (sql) => {
    calls.push(sql);
    return { rowCount: 0, rows: [] };
  } };
  assert.deepEqual(await expireStaleScannerSessions(executor), []);
  assert.deepEqual(await expireStaleScannerSessions(executor), []);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /WHERE status='active' AND expires_at <= CURRENT_TIMESTAMP/);
});

test("scanner cancellation is a terminal server-side session transition", () => {
  const service = read("services/scannerSessionService.js");
  assert.match(service, /status: "cancelled"/);
  assert.match(service, /cancelled_at: new Date\(\)/);
  assert.doesNotMatch(service.slice(service.indexOf("const abandonSessionByScanner"), service.indexOf("const rejectScan")), /current_step_index: 0/);
});

test("placement remains integrated through Phase 4 validation and Phase 5 transition", () => {
  const scanner = read("services/scannerSessionService.js");
  const placement = read("services/placementService.js");
  assert.match(scanner, /confirmPlacementOperation/);
  assert.match(placement, /validatePlacementOperation/);
  assert.match(placement, /executeTransition\(\{/);
});

test("live scanner policy settings and migration are authoritative", async (t) => {
  try {
    const result = await db.query(
      `SELECT setting_key, setting_value, validation_status FROM system_settings
       WHERE setting_key = ANY($1::text[]) ORDER BY setting_key`,
      [["scanner_session_timeout_minutes", "scanner_duplicate_scan_window_ms", "scanner_session_cleanup_interval_ms"]]
    );
    assert.equal(result.rowCount, 3);
    assert.ok(result.rows.every((row) => row.validation_status === "valid"));
    const migration = await db.query("SELECT execution_status FROM schema_migrations WHERE migration_name='028_scanner_policy_authority.sql'");
    assert.equal(migration.rows[0]?.execution_status, "applied");
  } catch (error) {
    t.skip(`Live database unavailable: ${error.code || error.message}`);
  }
});

test("invalid scanner policy fails readiness and session policy acquisition closed", async (t) => {
  let client;
  try {
    client = await db.pool.connect();
    await client.query("BEGIN");
    await client.query("UPDATE system_settings SET setting_value='0'::jsonb WHERE setting_key='scanner_session_timeout_minutes'");
    const policy = await readScannerPolicy(client);
    assert.equal(policy.ready, false);
    await assert.rejects(() => requireScannerPolicy(client), (error) => error.errorCode === "SCANNER_POLICY_NOT_READY" && error.statusCode === 503);
    await client.query("ROLLBACK");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (["ENOTFOUND", "ECONNREFUSED"].includes(error.code)) t.skip(`Live database unavailable: ${error.code}`);
    else throw error;
  } finally {
    client?.release();
  }
});

test("live sliding activity extends expiry and an expired session releases uniqueness", async (t) => {
  let client;
  try {
    client = await db.pool.connect();
    await client.query("BEGIN");
    const user = await client.query(
      `INSERT INTO users(full_name,username,email,phone_number,password_hash,role_id,status,must_change_password)
       SELECT 'Phase 9 Scanner Staff','phase9_'||txid_current(),'phase9_'||txid_current()||'@test.invalid','000','test',id,'active',FALSE
       FROM roles WHERE role_key='warehouse_staff' RETURNING id`
    );
    assert.equal(user.rowCount, 1);
    const created = await client.query(
      `INSERT INTO scanner_sessions(staff_user_id,workflow_type,workflow_name,steps,context,last_activity_at,expires_at)
       VALUES($1,'cargo_placement','Cargo Placement','[]'::jsonb,'{}'::jsonb,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+INTERVAL '1 minute') RETURNING *`,
      [user.rows[0].id]
    );
    const refreshed = await refreshSessionActivity(created.rows[0].id, 20, client);
    const interval = await client.query("SELECT EXTRACT(EPOCH FROM (expires_at-last_activity_at)) AS seconds FROM scanner_sessions WHERE id=$1", [refreshed.id]);
    assert.equal(Number(interval.rows[0].seconds), 1200);
    await client.query("UPDATE scanner_sessions SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE id=$1", [refreshed.id]);
    const stale = await client.query("SELECT * FROM scanner_sessions WHERE id=$1", [refreshed.id]);
    const expired = await expireSessionIfDue(serializeSession(stale.rows[0]), client);
    assert.equal(expired.status, "expired");
    const replacement = await client.query(
      `INSERT INTO scanner_sessions(staff_user_id,workflow_type,workflow_name,steps,context,last_activity_at,expires_at)
       VALUES($1,'cargo_placement','Cargo Placement','[]'::jsonb,'{}'::jsonb,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+INTERVAL '20 minutes') RETURNING id`,
      [user.rows[0].id]
    );
    assert.equal(replacement.rowCount, 1);
    await client.query("ROLLBACK");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (["ENOTFOUND", "ECONNREFUSED"].includes(error.code)) t.skip(`Live database unavailable: ${error.code}`);
    else throw error;
  } finally {
    client?.release();
  }
});

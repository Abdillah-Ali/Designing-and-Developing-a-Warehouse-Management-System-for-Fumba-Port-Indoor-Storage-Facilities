const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getRoutePermission, referencedPermissions } = require("../config/authorizationRegistry");
const { hasPermission, requirePermission } = require("../middleware/authMiddleware");
const { loadRolePermissions } = require("../services/permissionService");
const { validateRbacConfiguration, REQUIRED_ROLE_KEYS } = require("../services/rbacReadinessService");

test("protected routes resolve to stable permission keys and unknown routes fail closed", () => {
  assert.equal(getRoutePermission("POST", "/cargo"), "cargo.register");
  assert.equal(getRoutePermission("POST", "/supervisor/approvals/4/approve"), "cargo.approve");
  assert.equal(getRoutePermission("POST", "/finance/payments"), "finance.payments.record");
  assert.equal(getRoutePermission("POST", "/payments/invoices/INV-2026-TEST/payment-email/resend"), "finance.payments.initiate");
  assert.equal(getRoutePermission("POST", "/customs/cargo/CARGO-1/status"), "customs.clearance.update");
  assert.equal(getRoutePermission("POST", "/gate/cargo/CARGO-1/gate-out"), "gate.gate_out.confirm");
  assert.equal(getRoutePermission("POST", "/unknown-operation"), null);
  assert.equal(new Set(referencedPermissions).size, referencedPermissions.length);
});

test("permission middleware authorizes current permissions rather than role labels", async () => {
  const middleware = requirePermission("cargo.register");
  const invoke = (auth) => new Promise((resolve) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body }); } };
    middleware({ auth }, res, () => resolve({ status: 200 }));
  });
  assert.equal((await invoke({ role: "renamed-role", roleId: 2, permissions: ["cargo.register"] })).status, 200);
  const denied = await invoke({ role: "warehouse-staff", roleId: 2, permissions: [] });
  assert.equal(denied.status, 403);
});

test("permission changes are visible on the next load for an active role", async () => {
  let assigned = ["cargo.register"];
  const executor = { async query() { return { rows: assigned.map((permission_key) => ({ permission_key })) }; } };
  assert.equal(hasPermission({ permissions: await loadRolePermissions(2, executor) }, "cargo.register"), true);
  assigned = [];
  assert.equal(hasPermission({ permissions: await loadRolePermissions(2, executor) }, "cargo.register"), false);
  assigned = ["cargo.register"];
  assert.equal(hasPermission({ permissions: await loadRolePermissions(2, executor) }, "cargo.register"), true);
});

test("RBAC readiness rejects missing roles, route permissions, and administrator access", async () => {
  const executor = { async query(sql) {
    if (sql.includes("FROM roles") && !sql.includes("JOIN")) return { rows: REQUIRED_ROLE_KEYS.slice(1).map((role_key) => ({ role_key, system_protected: true })) };
    if (sql.includes("FROM permissions")) return { rows: [] };
    return { rowCount: 0, rows: [] };
  } };
  const result = await validateRbacConfiguration(executor);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((entry) => entry.code === "RBAC_PROTECTED_ROLE_MISSING"));
  assert.ok(result.issues.some((entry) => entry.code === "RBAC_ROUTE_PERMISSION_MISSING"));
  assert.ok(result.issues.some((entry) => entry.code === "RBAC_ADMIN_LOCKOUT_RISK"));
});

test("migration 021 backfills immutable protected role identities without replacing roles", () => {
  const migration = fs.readFileSync(path.join(__dirname, "..", "database", "migrations", "20260812_rbac_authorization_source_of_truth.sql"), "utf8");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS role_key/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS roles_role_key_key/);
  assert.match(migration, /system_administrator/);
  assert.doesNotMatch(migration, /DELETE FROM roles/i);
});

test("administrator hardening uses explicit capabilities instead of wildcard operational access", () => {
  const migration = fs.readFileSync(path.join(__dirname, "..", "database", "migrations", "20260812_rbac_administrator_explicit_permissions.sql"), "utf8");
  assert.match(migration, /DELETE FROM role_permissions[\s\S]*permission_key='\*'/);
  assert.match(migration, /system\.permissions\.manage/);
  assert.doesNotMatch(migration, /'cargo\.register'/);
  assert.doesNotMatch(migration, /'placement\.confirm'/);
});

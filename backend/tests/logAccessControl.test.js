const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PORTAL_ROLES,
  canAccessRoute,
  requireRole
} = require("../middleware/authMiddleware");

const RAW_LOG_PATHS = [
  "/audit-logs",
  "/user-sessions",
  "/placement/logs",
  "/placement/failures",
  "/supervisor/staff-activity",
  "/supervisor/placement-monitoring"
];

test("only System Admin can access raw log routes", () => {
  for (const path of RAW_LOG_PATHS) {
    assert.equal(canAccessRoute(PORTAL_ROLES.SYSTEM_ADMIN, "GET", path), true, path);
    assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "GET", path), false, path);
    assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "GET", path), false, path);
    assert.equal(canAccessRoute("customs-officer", "GET", path), false, path);
  }
});

test("supervisor placement summary exposes a separate non-log endpoint", () => {
  assert.equal(
    canAccessRoute(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "GET", "/supervisor/placement-summary"),
    true
  );
  assert.equal(
    canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "GET", "/supervisor/placement-summary"),
    false
  );
});

test("System Admin role middleware returns 403 for non-admin users", () => {
  const middleware = requireRole("System Admin");
  let statusCode = null;
  let payload = null;
  let nextCalled = false;

  middleware(
    { auth: { role: PORTAL_ROLES.WAREHOUSE_SUPERVISOR } },
    {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        payload = body;
      }
    },
    () => {
      nextCalled = true;
    }
  );

  assert.equal(statusCode, 403);
  assert.equal(payload.success, false);
  assert.equal(nextCalled, false);
});

test("System Admin role middleware allows administrators", () => {
  const middleware = requireRole("System Admin");
  let nextCalled = false;

  middleware(
    { auth: { role: PORTAL_ROLES.SYSTEM_ADMIN } },
    {},
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, true);
});

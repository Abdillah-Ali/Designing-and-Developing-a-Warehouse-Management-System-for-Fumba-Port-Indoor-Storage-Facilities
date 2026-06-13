const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  normalizeFirstAdminPayload
} = require("../controllers/bootstrapController");

const validPayload = {
  full_name: "Real System Administrator",
  username: "real.admin",
  email: "real.admin@example.com",
  phone_number: "+255712345678",
  password: "Secure@123",
  confirm_password: "Secure@123",
  shift_id: 1
};

test("bootstrap setup accepts a complete first administrator payload", () => {
  const payload = normalizeFirstAdminPayload(validPayload);

  assert.equal(payload.username, validPayload.username);
  assert.equal(payload.warehouse_id, undefined);
  assert.equal(payload.shift_id, 1);
});

test("bootstrap setup enforces password policy and confirmation", () => {
  assert.throws(
    () => normalizeFirstAdminPayload({ ...validPayload, password: "weak", confirm_password: "weak" }),
    /uppercase, lowercase, number, and special character/
  );
  assert.throws(
    () => normalizeFirstAdminPayload({ ...validPayload, confirm_password: "Different@123" }),
    /confirmation does not match/
  );
});

test("bootstrap setup defaults to all warehouses and requires a shift assignment", () => {
  const payload = normalizeFirstAdminPayload({ ...validPayload, warehouse_id: 999 });
  assert.equal(payload.warehouse_id, undefined);

  assert.throws(
    () => normalizeFirstAdminPayload({ ...validPayload, shift_id: "" }),
    /Shift is required/
  );
});

test("database initialization reads bootstrap identity only from environment variables", () => {
  const initDbPath = path.join(__dirname, "../database/initDb.js");
  const source = fs.readFileSync(initDbPath, "utf8");

  assert.match(source, /BOOTSTRAP_ADMIN_FULL_NAME/);
  assert.match(source, /BOOTSTRAP_ADMIN_PASSWORD/);
  assert.doesNotMatch(source, /DEFAULT_ADMIN_PASSWORD|SEED_DEFAULT_ADMIN|admin@fumbaport\.tz|Admin@123/);
});

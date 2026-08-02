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
  confirm_password: "Secure@123"
};

test("bootstrap setup accepts a complete first administrator payload", () => {
  const payload = normalizeFirstAdminPayload(validPayload);

  assert.equal(payload.username, validPayload.username);
  assert.equal(payload.warehouse_id, undefined);
  assert.equal(payload.shift_id, undefined);
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

test("initial setup does not depend on warehouses or shifts", () => {
  const payload = normalizeFirstAdminPayload({ ...validPayload, warehouse_id: 999, shift_id: 999 });
  assert.equal(payload.warehouse_id, undefined);
  assert.equal(payload.shift_id, undefined);
});

test("database initialization never creates a bootstrap identity", () => {
  const initDbPath = path.join(__dirname, "../database/initDb.js");
  const source = fs.readFileSync(initDbPath, "utf8");

  assert.doesNotMatch(source, /BOOTSTRAP_ADMIN_FULL_NAME/);
  assert.doesNotMatch(source, /BOOTSTRAP_ADMIN_PASSWORD/);
  assert.doesNotMatch(source, /seedBootstrapAdmin/);
  assert.match(source, /connectWithRetry/);
  assert.doesNotMatch(source, /DEFAULT_ADMIN_PASSWORD|SEED_DEFAULT_ADMIN|admin@fumbaport\.tz|Admin@123/);
  assert.match(source, /warehouse_configuration_srs\.sql/);
  assert.match(source, /finance_customs_gate_workflows\.sql/);
});

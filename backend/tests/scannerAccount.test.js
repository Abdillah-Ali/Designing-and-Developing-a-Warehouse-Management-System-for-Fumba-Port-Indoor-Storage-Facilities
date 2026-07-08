const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../config/db");
const { createScanner, login } = require("../controllers/adminController");
const { hashPassword } = require("../utils/password");
const { verifyToken } = require("../utils/token");

const response = () => ({
  statusCode: 200,
  payload: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  }
});

const runController = async (controller, req) => {
  const res = response();
  let nextError = null;
  await controller(req, res, (error) => {
    nextError = error || null;
  });
  return { res, nextError };
};

test("scanner creation rejects the linked user's normal password", async () => {
  const normalPassword = "NormalPass1!";
  const normalHash = await hashPassword(normalPassword);
  const client = {
    async query(sql) {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
      if (sql.includes("FROM users u") && sql.includes("FOR UPDATE")) {
        return {
          rowCount: 1,
          rows: [{
            id: 7,
            full_name: "Warehouse User",
            username: "staff1",
            email: "staff1@example.com",
            password_hash: normalHash,
            status: "active",
            is_bootstrap_admin: false,
            role_id: 2,
            role_name: "Warehouse Staff",
            department_name: "Warehouse"
          }]
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {}
  };
  db.pool = { connect: async () => client };

  const { nextError } = await runController(createScanner, {
    auth: { userId: 1 },
    body: { user_id: 7, password: normalPassword }
  });

  assert.equal(nextError.statusCode, 400);
  assert.equal(
    nextError.message,
    "Scanner password must be different from the user’s normal account password."
  );
});

test("scanner password signs in through the normal login endpoint with scanner-only claims", async () => {
  const normalHash = await hashPassword("NormalPass1!");
  const scannerHash = await hashPassword("ScannerPass1!");
  let createdSessionIdentity = null;
  const client = {
    async query(sql, params = []) {
      if (sql === "BEGIN" || sql === "COMMIT") return { rowCount: 0, rows: [] };
      if (sql.includes("FROM users u") && sql.includes("scanner_password_hash")) {
        return {
          rowCount: 1,
          rows: [{
            id: 7,
            full_name: "Warehouse User",
            username: "staff1",
            email: "staff1@example.com",
            password_hash: normalHash,
            status: "active",
            must_change_password: false,
            is_system_user: false,
            is_bootstrap_admin: false,
            bootstrap_completed: false,
            role_id: 2,
            role_name: "Warehouse Staff",
            scanner_account_id: 14,
            scanner_password_hash: scannerHash,
            scanner_account_status: "active",
            scanner_role_id: 5,
            warehouse_id: 3,
            warehouse_name: "Warehouse A",
            shift_id: 4,
            shift_name: "Morning"
          }]
        };
      }
      if (sql.includes("INSERT INTO user_sessions")) {
        createdSessionIdentity = {
          identityType: params[1],
          scannerAccountId: params[2]
        };
        return {
          rowCount: 1,
          rows: [{ id: 22, login_time: new Date().toISOString(), session_status: "active" }]
        };
      }
      if (sql.includes("UPDATE scanner_accounts")) return { rowCount: 1, rows: [] };
      if (sql.includes("INSERT INTO audit_logs")) return { rowCount: 1, rows: [{ id: 1 }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {}
  };
  db.pool = { connect: async () => client };

  const { res, nextError } = await runController(login, {
    body: { username: "staff1", password: "ScannerPass1!" },
    ip: "127.0.0.1",
    socket: {}
  });

  assert.equal(nextError, null);
  assert.equal(res.payload.data.user.role_name, "Scanner");
  assert.deepEqual(createdSessionIdentity, {
    identityType: "scanner",
    scannerAccountId: 14
  });

  const claims = verifyToken(res.payload.data.token);
  assert.equal(claims.role, "Scanner");
  assert.equal(claims.userId, 7);
  assert.equal(claims.scannerAccountId, 14);
  assert.equal(claims.scannerStaffId, 7);
  assert.equal(claims.mustChangePassword, false);
});

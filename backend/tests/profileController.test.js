const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");

const db = require("../config/db");
const {
  changePassword,
  getProfile,
  updateProfile
} = require("../controllers/adminController");
const { hashPassword } = require("../utils/password");

const originalQuery = db.query;
const originalPool = db.pool;

const baseUser = {
  id: 7,
  full_name: "Abdillah Ali",
  username: "abdillah",
  email: "abdillah@example.com",
  phone_number: "+255 700 123 456",
  role_id: 2,
  role_name: "Warehouse Staff",
  role_description: "Warehouse staff member",
  warehouse_id: 1,
  warehouse_name: "Warehouse A",
  warehouse_code: "WHA",
  shift_id: 1,
  shift_name: "Morning",
  start_time: "08:00:00",
  end_time: "16:00:00",
  status: "active",
  must_change_password: false,
  is_system_user: false,
  is_bootstrap_admin: false,
  bootstrap_completed: false,
  last_login: "2026-06-27T06:00:00.000Z",
  created_at: "2026-05-01T08:00:00.000Z",
  updated_at: "2026-06-01T08:00:00.000Z"
};

function createResponse() {
  const response = {
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
  };
  return response;
}

async function runController(controller, req) {
  const res = createResponse();
  let nextError = null;
  await controller(req, res, (error) => {
    nextError = error;
  });
  return { res, nextError };
}

afterEach(() => {
  db.query = originalQuery;
  db.pool = originalPool;
});

test("profile read returns authenticated user data without sessions or password hash", async () => {
  db.query = async (sql, params = []) => {
    assert.match(sql, /FROM users u/);
    assert.deepEqual(params, [baseUser.id]);
    return { rowCount: 1, rows: [baseUser] };
  };

  const { res, nextError } = await runController(getProfile, {
    auth: { userId: baseUser.id }
  });

  assert.equal(nextError, null);
  assert.equal(res.payload.success, true);
  assert.equal(res.payload.data.user.full_name, "Abdillah Ali");
  assert.equal(res.payload.data.user.last_login, baseUser.last_login);
  assert.equal(Object.prototype.hasOwnProperty.call(res.payload.data.user, "password_hash"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(res.payload.data, "sessions"), false);
});

test("profile update validates writable fields and writes UPDATE_PROFILE audit log", async () => {
  const state = {
    user: { ...baseUser },
    auditLogs: [],
    committed: false
  };
  const client = {
    async query(sql, params = []) {
      if (sql === "BEGIN") return { rowCount: 0, rows: [] };
      if (sql === "COMMIT") {
        state.committed = true;
        return { rowCount: 0, rows: [] };
      }
      if (sql === "ROLLBACK") return { rowCount: 0, rows: [] };
      if (sql.includes("FROM users u")) return { rowCount: 1, rows: [state.user] };
      if (sql.includes("LOWER(email)")) return { rowCount: 0, rows: [] };
      if (sql.startsWith("UPDATE users")) {
        state.user = {
          ...state.user,
          email: params[0],
          phone_number: params[1]
        };
        return { rowCount: 1, rows: [{ id: state.user.id }] };
      }
      if (sql.includes("INSERT INTO audit_logs")) {
        state.auditLogs.push({
          action: params[4],
          metadata: JSON.parse(params[7])
        });
        return { rowCount: 1, rows: [{ id: state.auditLogs.length }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {}
  };

  db.pool = { connect: async () => client };

  const { res, nextError } = await runController(updateProfile, {
    auth: { userId: baseUser.id },
    body: {
      email: "abdillah.ali@example.com",
      phone_number: "+255 711 111 111"
    }
  });

  assert.equal(nextError, null);
  assert.equal(state.committed, true);
  assert.equal(res.payload.data.user.email, "abdillah.ali@example.com");
  assert.equal(state.auditLogs.at(-1).action, "UPDATE_PROFILE");
  assert.deepEqual(state.auditLogs.at(-1).metadata.changed_fields, ["email", "phone_number"]);
});

test("profile update rejects read-only assignment fields", async () => {
  const client = {
    async query() {
      return { rowCount: 0, rows: [] };
    },
    release() {}
  };
  db.pool = { connect: async () => client };

  const { nextError } = await runController(updateProfile, {
    auth: { userId: baseUser.id },
    body: {
      role_id: 1,
      email: "abdillah@example.com"
    }
  });

  assert.equal(nextError.statusCode, 400);
  assert.match(nextError.message, /cannot be changed/i);
});

test("change password rejects confirmation mismatch before writing password hash", async () => {
  const client = {
    queries: [],
    async query(sql) {
      this.queries.push(sql);
      return { rowCount: 0, rows: [] };
    },
    release() {}
  };
  db.pool = { connect: async () => client };

  const { nextError } = await runController(changePassword, {
    auth: { userId: baseUser.id, sessionId: 12 },
    body: {
      currentPassword: "OldPass1!",
      newPassword: "NewPass1!",
      confirmPassword: "Different1!"
    }
  });

  assert.equal(nextError.statusCode, 400);
  assert.match(nextError.message, /do not match/i);
  assert.equal(client.queries.some((sql) => String(sql).startsWith("UPDATE users")), false);
});

test("change password validates current password", async () => {
  const currentHash = await hashPassword("OldPass1!");
  const client = {
    async query(sql) {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
      if (sql.includes("FROM users u")) {
        return {
          rowCount: 1,
          rows: [{
            ...baseUser,
            password_hash: currentHash
          }]
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {}
  };
  db.pool = { connect: async () => client };

  const { nextError } = await runController(changePassword, {
    auth: { userId: baseUser.id, sessionId: 12 },
    body: {
      currentPassword: "WrongPass1!",
      newPassword: "NewPass1!",
      confirmPassword: "NewPass1!"
    }
  });

  assert.equal(nextError.statusCode, 400);
  assert.match(nextError.message, /incorrect current password/i);
});

test("change password updates hash, invalidates other sessions, and audits actions", async () => {
  const currentHash = await hashPassword("OldPass1!");
  const auditActions = [];
  let updatedPasswordHash = currentHash;
  let invalidatedSessions = false;
  const client = {
    async query(sql, params = []) {
      if (sql === "BEGIN") return { rowCount: 0, rows: [] };
      if (sql === "COMMIT") return { rowCount: 0, rows: [] };
      if (sql === "ROLLBACK") return { rowCount: 0, rows: [] };
      if (sql.includes("FROM users u")) {
        return {
          rowCount: 1,
          rows: [{
            ...baseUser,
            password_hash: updatedPasswordHash
          }]
        };
      }
      if (sql.includes("FROM scanner_accounts")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.startsWith("UPDATE users")) {
        updatedPasswordHash = params[0];
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("UPDATE user_sessions")) {
        invalidatedSessions = true;
        assert.equal(params[0], baseUser.id);
        assert.equal(params[1], 12);
        return { rowCount: 2, rows: [{ id: 31 }, { id: 32 }] };
      }
      if (sql.includes("INSERT INTO audit_logs")) {
        auditActions.push(params[4]);
        return { rowCount: 1, rows: [{ id: auditActions.length }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {}
  };
  db.pool = { connect: async () => client };

  const { res, nextError } = await runController(changePassword, {
    auth: { userId: baseUser.id, sessionId: 12 },
    body: {
      currentPassword: "OldPass1!",
      newPassword: "NewPass1!",
      confirmPassword: "NewPass1!"
    }
  });

  assert.equal(nextError, null);
  assert.equal(res.payload.success, true);
  assert.ok(res.payload.data.token);
  assert.notEqual(updatedPasswordHash, currentHash);
  assert.equal(invalidatedSessions, true);
  assert.deepEqual(auditActions, ["CHANGE_PASSWORD", "USER_SESSIONS_INVALIDATED"]);
});

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET ||= "phase-1-test-secret-that-is-at-least-32-characters";

const db = require("../config/db");
const { verifyToken } = require("../utils/token");
const { requireAuthenticated } = require("../middleware/authMiddleware");
const {
  createRefreshCredential,
  getAuthLifetimes,
  hashToken,
  issueAccessToken,
  rotateRefreshCredential
} = require("../services/authSessionService");

const authenticate = async (token) => {
  const req = { get: (name) => name === "authorization" ? `Bearer ${token}` : null };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  let nextError = null;
  let passed = false;
  await requireAuthenticated(req, res, (error) => { nextError = error || null; passed = !error; });
  return { req, res, nextError, passed };
};

test("Phase 1 access tokens are purpose-bound and refresh credentials are opaque hashes", async (t) => {
  let user;
  try {
    user = (await db.query(`SELECT u.id,u.username,u.role_id,r.role_name,u.warehouse_id,u.shift_id,
      u.must_change_password,u.is_system_user,u.is_bootstrap_admin,u.bootstrap_completed
      FROM users u JOIN roles r ON r.id=u.role_id WHERE u.status='active' ORDER BY u.id LIMIT 1`)).rows[0];
  } catch (error) {
    t.skip(`Live database is unavailable for Phase 1 session tests: ${error.code || error.message}`);
    return;
  }
  assert.ok(user, "Phase 1 session test requires an existing active user.");
  const lifetimes = await getAuthLifetimes();
  const session = (await db.query(
    `INSERT INTO user_sessions (user_id,identity_type,session_status,public_reference,expires_at,last_activity_at)
     VALUES ($1,'user','active','SES-PHASE1-' || UPPER(ENCODE(GEN_RANDOM_BYTES(6),'hex')),$2,CURRENT_TIMESTAMP) RETURNING id,expires_at`,
    [user.id, new Date(Date.now() + lifetimes.sessionMs)]
  )).rows[0];
  try {
    const access = issueAccessToken({ ...user, userId: user.id, role: user.role_name }, session.id, lifetimes.accessMs);
    const claims = verifyToken(access);
    assert.equal(claims.typ, "access");
    assert.equal(claims.sid, session.id);
    assert.equal(claims.sub, String(user.id));
    assert.equal((await authenticate(access)).passed, true);

    const refresh = await createRefreshCredential({
      sessionId: session.id,
      expiresAt: new Date(Date.now() + lifetimes.refreshMs),
      ipAddress: "127.0.0.1",
      userAgent: "phase-1-test"
    }, db);
    assert.equal(refresh.token.includes("."), false);
    const stored = (await db.query("SELECT token_hash FROM session_refresh_tokens WHERE id=$1", [refresh.id])).rows[0];
    assert.equal(stored.token_hash, hashToken(refresh.token));
    assert.notEqual(stored.token_hash, refresh.token);

    const rotated = await rotateRefreshCredential({ token: refresh.token, ipAddress: "127.0.0.1", userAgent: "phase-1-test" });
    assert.equal(verifyToken(rotated.accessToken).typ, "access");
    assert.notEqual(rotated.refreshToken, refresh.token);
    await assert.rejects(
      rotateRefreshCredential({ token: refresh.token, ipAddress: "127.0.0.1", userAgent: "phase-1-replay" }),
      (error) => error.errorCode === "AUTH_REFRESH_TOKEN_REPLAY"
    );
    const revoked = (await db.query("SELECT session_status,revoked_at FROM user_sessions WHERE id=$1", [session.id])).rows[0];
    assert.equal(revoked.session_status, "closed");
    assert.ok(revoked.revoked_at);
    assert.equal((await authenticate(access)).res.statusCode, 401);
    await assert.rejects(
      rotateRefreshCredential({ token: rotated.refreshToken, ipAddress: "127.0.0.1", userAgent: "phase-1-test" }),
      (error) => ["AUTH_REFRESH_TOKEN_REPLAY", "AUTH_SESSION_REVOKED"].includes(error.errorCode)
    );
  } finally {
    await db.query("DELETE FROM audit_logs WHERE metadata->>'session_id'=$1", [String(session.id)]);
    await db.query("DELETE FROM user_sessions WHERE id=$1", [session.id]);
  }
});

test("an access JWT is rejected as a refresh credential", async () => {
  const token = issueAccessToken({ userId: 1, role: "System Admin" }, 1, 60000);
  await assert.rejects(
    rotateRefreshCredential({ token }),
    (error) => error.errorCode === "AUTH_TOKEN_TYPE_INVALID"
  );
});

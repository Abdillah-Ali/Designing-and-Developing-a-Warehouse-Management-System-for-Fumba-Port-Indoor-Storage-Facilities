const crypto = require("node:crypto");
const db = require("../config/db");
const { buildError } = require("../utils/apiError");
const { createToken } = require("../utils/token");
const { getDurationSetting, requireValidSetting } = require("./systemConfigurationService");

const REFRESH_COOKIE = "fumba_wms_refresh";
const ACCESS_TYPE = "access";
const SESSION_SELECTOR_HEADER = "x-fumba-wms-session";
const SESSION_SELECTOR_PATTERN = /^SES-[A-F0-9]{24}$/;

const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
const randomRefreshToken = () => crypto.randomBytes(48).toString("base64url");
const hashUserAgent = (value) => value ? hashToken(value) : null;

const getAuthLifetimes = async (executor = db) => ({
  accessMs: requireValidSetting(await getDurationSetting("auth_access_token_lifetime_ms", {}, executor)),
  refreshMs: requireValidSetting(await getDurationSetting("auth_refresh_token_lifetime_ms", {}, executor)),
  sessionMs: requireValidSetting(await getDurationSetting("auth_session_lifetime_ms", {}, executor))
});

const issueAccessToken = (claims, sessionId, accessMs) => createToken({
  ...claims,
  typ: ACCESS_TYPE,
  sub: String(claims.userId || claims.user_id),
  sid: Number(sessionId),
  sessionId: Number(sessionId),
  session_id: Number(sessionId)
}, Math.max(1, Math.floor(accessMs / 1000)));

const createRefreshCredential = async ({ sessionId, familyId = null, parentTokenId = null, expiresAt, ipAddress, userAgent }, executor) => {
  const plaintext = randomRefreshToken();
  const result = await executor.query(
    `INSERT INTO session_refresh_tokens
       (session_id, token_family_id, token_hash, parent_token_id, expires_at, created_ip, user_agent_hash)
     VALUES ($1, COALESCE($2::uuid, GEN_RANDOM_UUID()), $3, $4, $5, $6, $7)
     RETURNING id, token_family_id, expires_at`,
    [sessionId, familyId, hashToken(plaintext), parentTokenId, expiresAt, ipAddress || null, hashUserAgent(userAgent)]
  );
  return { token: plaintext, ...result.rows[0] };
};

const revokeSession = async (sessionId, reason, executor, revokedBy = null) => {
  const session = await executor.query(
    `UPDATE user_sessions SET session_status='closed', logout_time=COALESCE(logout_time,CURRENT_TIMESTAMP),
       revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP), revoked_by=COALESCE(revoked_by,$3),
       revocation_reason=COALESCE(revocation_reason,$2)
     WHERE id=$1 RETURNING id`,
    [sessionId, reason, revokedBy]
  );
  await executor.query(
    `UPDATE session_refresh_tokens SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP),
       revocation_reason=COALESCE(revocation_reason,$2)
     WHERE session_id=$1 AND revoked_at IS NULL`,
    [sessionId, reason]
  );
  return session;
};

const authError = (code, message = "Session expired. Please sign in again.") => buildError(message, 401, undefined, code);

const normalizeSessionSelector = (value) => {
  const selector = String(value || "").trim().toUpperCase();
  return SESSION_SELECTOR_PATTERN.test(selector) ? selector : null;
};

const getRefreshCookieName = (sessionSelector) => {
  const selector = normalizeSessionSelector(sessionSelector);
  return selector ? `${REFRESH_COOKIE}_${selector}` : null;
};

const rotateRefreshCredential = async ({ token, sessionSelector, ipAddress, userAgent }) => {
  const selector = normalizeSessionSelector(sessionSelector);
  if (!token || String(token).includes(".") || !selector) throw authError("AUTH_TOKEN_TYPE_INVALID");
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const tokenResult = await client.query(
      `SELECT rt.*, us.user_id, us.identity_type, us.scanner_account_id, us.session_status,
              us.expires_at AS session_expires_at, u.status AS user_status,
              u.username,u.role_id,u.warehouse_id,u.shift_id,u.must_change_password,u.is_system_user,
              u.is_bootstrap_admin,u.bootstrap_completed,r.role_name,r.role_key,
              sa.status AS scanner_status,sr.id AS scanner_role_id,sr.role_key AS scanner_role_key
       FROM session_refresh_tokens rt
       JOIN user_sessions us ON us.id=rt.session_id
       JOIN users u ON u.id=us.user_id
       JOIN roles r ON r.id=u.role_id
       LEFT JOIN scanner_accounts sa ON sa.id=us.scanner_account_id AND sa.user_id=u.id
       LEFT JOIN roles sr ON sr.role_key='scanner'
       WHERE rt.token_hash=$1
         AND us.public_reference=$2
       FOR UPDATE OF rt,us`,
      [hashToken(token), selector]
    );
    if (!tokenResult.rowCount) throw authError("AUTH_INVALID_REFRESH_TOKEN");
    const row = tokenResult.rows[0];
    if (row.used_at || row.replaced_by_token_id || row.revoked_at) {
      await client.query(`UPDATE session_refresh_tokens SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP),revocation_reason='refresh replay' WHERE token_family_id=$1`, [row.token_family_id]);
      await revokeSession(row.session_id, "refresh token replay", client);
      await client.query(
        `INSERT INTO audit_logs (user_id,action,module,description,metadata)
         VALUES ($1,'REFRESH_TOKEN_REPLAY_DETECTED','Authentication','A reused refresh credential was detected and its session was revoked.',$2::jsonb)`,
        [row.user_id, JSON.stringify({ session_id: row.session_id, identity_type: row.identity_type })]
      );
      await client.query("COMMIT");
      throw authError("AUTH_REFRESH_TOKEN_REPLAY");
    }
    if (new Date(row.expires_at) <= new Date()) throw authError("AUTH_REFRESH_TOKEN_EXPIRED");
    if (row.session_status !== "active" || row.revoked_at) throw authError("AUTH_SESSION_REVOKED");
    if (!row.session_expires_at || new Date(row.session_expires_at) <= new Date()) {
      await revokeSession(row.session_id, "session expired", client);
      await client.query("COMMIT");
      throw authError("AUTH_SESSION_EXPIRED");
    }
    if (row.user_status !== "active") throw authError("AUTH_ACCOUNT_INACTIVE");
    if (row.identity_type === "scanner" && row.scanner_status !== "active") throw authError("AUTH_ACCOUNT_INACTIVE");
    const lifetimes = await getAuthLifetimes(client);
    const replacement = await createRefreshCredential({
      sessionId: row.session_id, familyId: row.token_family_id, parentTokenId: row.id,
      expiresAt: new Date(Math.min(Date.now() + lifetimes.refreshMs, new Date(row.session_expires_at).getTime())),
      ipAddress, userAgent
    }, client);
    await client.query(
      `UPDATE session_refresh_tokens SET used_at=CURRENT_TIMESTAMP,last_used_ip=$2,replaced_by_token_id=$3 WHERE id=$1`,
      [row.id, ipAddress || null, replacement.id]
    );
    await client.query("UPDATE user_sessions SET last_activity_at=CURRENT_TIMESTAMP WHERE id=$1", [row.session_id]);
    await client.query(
      `INSERT INTO audit_logs (user_id,action,module,description,metadata)
       VALUES ($1,'REFRESH_TOKEN_ROTATED','Authentication','Refresh credential rotated.',$2::jsonb)`,
      [row.user_id, JSON.stringify({ session_id: row.session_id, identity_type: row.identity_type })]
    );
    const scanner = row.identity_type === "scanner";
    const claims = {
      userId: row.user_id, user_id: row.user_id, username: row.username,
      role: scanner ? "Scanner" : row.role_name,
      roleKey: scanner ? row.scanner_role_key : row.role_key,
      role_key: scanner ? row.scanner_role_key : row.role_key,
      roleId: scanner ? row.scanner_role_id : row.role_id,
      role_id: scanner ? row.scanner_role_id : row.role_id,
      warehouseId: row.warehouse_id || null, warehouse_id: row.warehouse_id || null,
      shiftId: row.shift_id || null, shift_id: row.shift_id || null,
      scannerStaffId: scanner ? row.user_id : null, scanner_staff_id: scanner ? row.user_id : null,
      scannerAccountId: scanner ? row.scanner_account_id : null, scanner_account_id: scanner ? row.scanner_account_id : null,
      identityType: row.identity_type, identity_type: row.identity_type,
      mustChangePassword: scanner ? false : row.must_change_password, must_change_password: scanner ? false : row.must_change_password,
      isSystemUser: scanner ? false : row.is_system_user, is_system_user: scanner ? false : row.is_system_user,
      isBootstrapAdmin: scanner ? false : row.is_bootstrap_admin, is_bootstrap_admin: scanner ? false : row.is_bootstrap_admin,
      bootstrapCompleted: scanner ? false : row.bootstrap_completed, bootstrap_completed: scanner ? false : row.bootstrap_completed
    };
    const accessToken = issueAccessToken(claims, row.session_id, lifetimes.accessMs);
    await client.query("COMMIT");
    return { accessToken, refreshToken: replacement.token, refreshExpiresAt: replacement.expires_at, sessionSelector: selector };
  } catch (error) {
    if (!error.transactionComplete) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
};

const cookieOptions = (maxAge) => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/api/auth", maxAge });
const setRefreshCookie = (res, sessionSelector, token, maxAge) => {
  const cookieName = getRefreshCookieName(sessionSelector);
  if (!cookieName) throw new Error("A valid session selector is required for refresh cookies.");
  return res.cookie
    ? res.cookie(cookieName, token, cookieOptions(maxAge))
    : res.setHeader("Set-Cookie", `${cookieName}=${token}; Max-Age=${Math.floor(maxAge / 1000)}; Path=/api/auth; HttpOnly; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
};
const clearRefreshCookie = (res, sessionSelector) => {
  const cookieName = getRefreshCookieName(sessionSelector);
  if (!cookieName) return undefined;
  return res.clearCookie
    ? res.clearCookie(cookieName, cookieOptions(0))
    : res.setHeader("Set-Cookie", `${cookieName}=; Max-Age=0; Path=/api/auth; HttpOnly; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
};
const readRefreshCookie = (req, sessionSelector) => {
  const cookieName = getRefreshCookieName(sessionSelector);
  if (!cookieName) return null;
  return String(req.headers?.cookie || "").split(";").map((value) => value.trim())
    .find((value) => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || null;
};

module.exports = { ACCESS_TYPE, REFRESH_COOKIE, SESSION_SELECTOR_HEADER, clearRefreshCookie, createRefreshCredential, getAuthLifetimes, getRefreshCookieName, hashToken, issueAccessToken, normalizeSessionSelector, readRefreshCookie, revokeSession, rotateRefreshCredential, setRefreshCookie };

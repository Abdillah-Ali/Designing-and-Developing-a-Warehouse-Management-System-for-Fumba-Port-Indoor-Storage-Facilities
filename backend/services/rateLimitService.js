const crypto = require("node:crypto");
const db = require("../config/db");

const digest = (value) => crypto.createHash("sha256").update(String(value || "unknown")).digest("hex");
const normalizeAccount = (value) => String(value || "").trim().toLowerCase().slice(0, 150);

const consumeRateLimit = async ({ scope, keys, limit, windowMs }, executor = db) => {
  const safeLimit = Math.max(1, Number(limit) || 1);
  const safeWindowMs = Math.max(1000, Number(windowMs) || 60000);
  const uniqueKeys = [...new Set((keys || []).filter(Boolean).map((key) => digest(key)))];
  let retryAfterMs = 0;

  for (const keyHash of uniqueKeys) {
    const result = await executor.query(
      `INSERT INTO api_rate_limits (scope, key_hash, attempt_count, window_started_at, expires_at)
       VALUES ($1,$2,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + ($3 * INTERVAL '1 millisecond'))
       ON CONFLICT (scope,key_hash) DO UPDATE SET
         attempt_count = CASE WHEN api_rate_limits.expires_at <= CURRENT_TIMESTAMP THEN 1 ELSE api_rate_limits.attempt_count + 1 END,
         window_started_at = CASE WHEN api_rate_limits.expires_at <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP ELSE api_rate_limits.window_started_at END,
         expires_at = CASE WHEN api_rate_limits.expires_at <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP + ($3 * INTERVAL '1 millisecond') ELSE api_rate_limits.expires_at END
       RETURNING attempt_count, GREATEST(0, EXTRACT(EPOCH FROM (expires_at - CURRENT_TIMESTAMP)) * 1000)::bigint AS retry_after_ms`,
      [String(scope).slice(0, 80), keyHash, safeWindowMs]
    );
    if (Number(result.rows[0].attempt_count) > safeLimit) {
      retryAfterMs = Math.max(retryAfterMs, Number(result.rows[0].retry_after_ms || 0));
    }
  }

  return { allowed: retryAfterMs === 0, retryAfterMs };
};

const clearRateLimit = async ({ scope, keys }, executor = db) => {
  const hashes = [...new Set((keys || []).filter(Boolean).map((key) => digest(key)))];
  if (!hashes.length) return;
  await executor.query("DELETE FROM api_rate_limits WHERE scope=$1 AND key_hash=ANY($2::text[])", [scope, hashes]);
};

const createRateLimiter = ({ scope, limit, windowMs, accountField, clearOnSuccess = false }) => async (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const account = accountField ? normalizeAccount(req.body?.[accountField]) : "";
    const keys = [`ip:${ip}`];
    if (account) keys.push(`account:${account}`);
    const result = await consumeRateLimit({ scope, keys, limit, windowMs });
    if (!result.allowed) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
      res.status(429).json({ success: false, code: "RATE_LIMITED", message: "Too many requests. Please try again later." });
      return;
    }
    if (clearOnSuccess) {
      res.on("finish", () => {
        if (res.statusCode < 400) clearRateLimit({ scope, keys }).catch(() => {});
      });
    }
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = { clearRateLimit, consumeRateLimit, createRateLimiter, digest, normalizeAccount };

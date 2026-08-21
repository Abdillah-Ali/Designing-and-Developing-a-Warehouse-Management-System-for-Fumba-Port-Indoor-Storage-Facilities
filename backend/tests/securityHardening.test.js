const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { securityHeaders } = require("../middleware/securityHeaders");
const { validateRequestShape } = require("../middleware/requestValidation");
const { sanitize } = require("../middleware/responseMinimization");
const { assertFileSignature, decodeStrictBase64, normalizeDisplayFilename } = require("../utils/fileValidation");
const { consumeRateLimit } = require("../services/rateLimitService");

test("security headers deny framing and content sniffing without disclosing Express", () => {
  const headers = new Map();
  securityHeaders({}, { setHeader: (key, value) => headers.set(key, value) }, () => {});
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.match(headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
});

test("response minimization removes secrets and filesystem paths recursively", () => {
  const result = sanitize({ data: { id: 1, password_hash: "hash", file_path: "/private/file", token_hash: "hash", name: "safe" } });
  assert.deepEqual(result, { data: { id: 1, name: "safe" } });
});

test("strict upload validation accepts supported signatures and rejects spoofed content", () => {
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x01]);
  assert.doesNotThrow(() => assertFileSignature("image/png", png));
  assert.throws(() => assertFileSignature("application/pdf", png), (error) => error.errorCode === "UPLOAD_SIGNATURE_MISMATCH");
  assert.deepEqual(decodeStrictBase64(png.toString("base64")), png);
  assert.throws(() => decodeStrictBase64("%%%not-base64%%%"), (error) => error.errorCode === "UPLOAD_BASE64_INVALID");
  assert.equal(normalizeDisplayFilename("../safe.pdf"), "safe.pdf");
  assert.throws(() => normalizeDisplayFilename("a".repeat(181)), (error) => error.errorCode === "UPLOAD_FILENAME_INVALID");
});

test("request shape validation rejects prototype keys and oversized queries", () => {
  const body = JSON.parse('{"__proto__":{"admin":true}}');
  let received;
  validateRequestShape({ query: {}, body }, {}, (error) => { received = error; });
  assert.equal(received.errorCode, "INPUT_PROPERTY_PROHIBITED");
  validateRequestShape({ query: { search: "x".repeat(1001) }, body: {} }, {}, (error) => { received = error; });
  assert.equal(received.errorCode, "QUERY_INVALID");
});

test("database-backed limiter uses atomic conflict update and combined keys", async () => {
  const calls = [];
  const executor = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ attempt_count: calls.length, retry_after_ms: calls.length >= 2 ? 60000 : 0 }] };
  } };
  const result = await consumeRateLimit({ scope: "test", keys: ["ip:1", "account:a"], limit: 1, windowMs: 60000 }, executor);
  assert.equal(result.allowed, false);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /ON CONFLICT/);
});

test("production deployment separates TLS edge, migrator, runtime DB identity, and internal database", () => {
  const candidates = [
    path.join(__dirname, "../.."),
    path.join(__dirname, ".."),
    process.cwd(),
    path.join(process.cwd(), "..")
  ];
  const root = candidates.find((dir) => fs.existsSync(path.join(dir, "docker-compose.production.yml")));
  if (!root || !fs.existsSync(path.join(root, "docker-compose.production.yml"))) return;
  const compose = fs.readFileSync(path.join(root, "docker-compose.production.yml"), "utf8");
  const edge = fs.readFileSync(path.join(root, "deployment/nginx/wms-production.conf"), "utf8");
  const grants = fs.readFileSync(path.join(root, "backend/database/applyRuntimeGrants.js"), "utf8");
  assert.match(compose, /service_completed_successfully/);
  assert.match(compose, /internal: true/);
  assert.doesNotMatch(compose.match(/postgres:[\s\S]*?migrator:/)[0], /ports:/);
  assert.match(edge, /return 301 https:/);
  assert.match(edge, /proxy_set_header Upgrade/);
  assert.match(grants, /NOSUPERUSER NOCREATEDB NOCREATEROLE/);
  assert.match(grants, /REVOKE UPDATE,DELETE,TRUNCATE ON audit_logs/);
});

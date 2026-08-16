const blockedResponseKeys = new Set([
  "password",
  "password_hash",
  "scanner_password_hash",
  "token_hash",
  "refresh_token_hash",
  "file_path"
]);

const sanitize = (value, seen = new WeakSet()) => {
  if (!value || typeof value !== "object") return value;
  if (Buffer.isBuffer(value) || value instanceof Date) return value;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, seen));
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !blockedResponseKeys.has(key.toLowerCase()))
    .map(([key, item]) => [key, sanitize(item, seen)]));
};

const minimizeJsonResponses = (_req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => originalJson(sanitize(body));
  next();
};

module.exports = { blockedResponseKeys, minimizeJsonResponses, sanitize };

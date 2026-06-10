const crypto = require("crypto");

const DEFAULT_EXPIRES_IN = "24h";

const getSecret = () => (
  process.env.JWT_SECRET
  || process.env.AUTH_TOKEN_SECRET
  || "fumba-port-development-token-secret"
);

const toBase64Url = (value) => Buffer
  .from(typeof value === "string" ? value : JSON.stringify(value))
  .toString("base64url");

const fromBase64Url = (value) => JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

const parseExpiresIn = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }

  const match = String(value || DEFAULT_EXPIRES_IN).match(/^(\d+)([smhd])$/i);
  if (!match) return 24 * 60 * 60;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60
  };

  return amount * multipliers[unit];
};

const sign = (content) => crypto
  .createHmac("sha256", getSecret())
  .update(content)
  .digest("base64url");

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) return false;

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const createToken = (payload, expiresIn = DEFAULT_EXPIRES_IN) => {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "HS256",
    typ: "JWT"
  };
  const body = {
    ...payload,
    iat: now,
    exp: now + parseExpiresIn(expiresIn)
  };
  const content = `${toBase64Url(header)}.${toBase64Url(body)}`;

  return `${content}.${sign(content)}`;
};

const verifyToken = (token) => {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, signature] = parts;
    const content = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = sign(content);

    if (!safeEqual(signature, expectedSignature)) return null;

    const header = fromBase64Url(encodedHeader);
    if (header.alg !== "HS256" || header.typ !== "JWT") return null;

    const payload = fromBase64Url(encodedPayload);
    const now = Math.floor(Date.now() / 1000);

    if (!payload.exp || payload.exp <= now) return null;

    return payload;
  } catch (error) {
    return null;
  }
};

module.exports = {
  createToken,
  verifyToken
};

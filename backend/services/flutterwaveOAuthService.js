const { buildError } = require("../utils/apiError");

const REFRESH_SKEW_MS = 60_000;
let cachedToken = null;
let expiresAt = 0;
let pendingTokenRequest = null;

const readOAuthConfig = () => ({
  tokenUrl: process.env.FLUTTERWAVE_OAUTH_TOKEN_URL
    || "https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token",
  clientId: process.env.FLUTTERWAVE_CLIENT_ID,
  clientSecret: process.env.FLUTTERWAVE_CLIENT_SECRET
});

const requestAccessToken = async ({ fetchImpl = global.fetch, now = Date.now } = {}) => {
  const { tokenUrl, clientId, clientSecret } = readOAuthConfig();
  if (!clientId || !clientSecret) throw buildError("Flutterwave v4 OAuth credentials are not configured.", 503, null, "PAYMENT_PROVIDER_NOT_CONFIGURED");
  const response = await fetchImpl(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }).toString()
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw buildError("Flutterwave OAuth authentication failed.", 502, null, "PAYMENT_PROVIDER_AUTHENTICATION_FAILED");
  cachedToken = String(body.access_token);
  expiresAt = now() + (Math.max(Number(body.expires_in) || 600, 1) * 1000);
  return cachedToken;
};

const getAccessToken = async ({ fetchImpl = global.fetch, now = Date.now } = {}) => {
  if (cachedToken && now() < expiresAt - REFRESH_SKEW_MS) return cachedToken;
  if (!pendingTokenRequest) pendingTokenRequest = requestAccessToken({ fetchImpl, now }).finally(() => { pendingTokenRequest = null; });
  return pendingTokenRequest;
};

const resetTokenCacheForTests = () => { cachedToken = null; expiresAt = 0; pendingTokenRequest = null; };
module.exports = { getAccessToken, readOAuthConfig, requestAccessToken, resetTokenCacheForTests };

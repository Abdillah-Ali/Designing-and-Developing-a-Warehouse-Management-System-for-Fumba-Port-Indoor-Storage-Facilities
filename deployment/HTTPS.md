# Production HTTPS

Local development intentionally uses HTTP. Production must terminate TLS at a trusted reverse proxy and forward `X-Forwarded-Proto: https` to the backend. The backend trusts one proxy hop, rejects non-HTTPS production requests, restricts CORS to `CORS_ORIGIN`, and emits the refresh credential as an HTTP-only, Secure, SameSite=Strict cookie.

Use `nginx/wms-https.conf.example` as a deployment template. Supply certificates through the deployment secret store; never commit private keys. Replace the example hostname and set `NODE_ENV=production` and an HTTPS `CORS_ORIGIN`.

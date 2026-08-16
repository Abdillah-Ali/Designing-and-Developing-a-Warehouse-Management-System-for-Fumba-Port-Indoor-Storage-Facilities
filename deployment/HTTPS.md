# Production HTTPS

Local development intentionally uses HTTP. Production must terminate TLS at a trusted reverse proxy and forward `X-Forwarded-Proto: https` to the backend. The backend trusts one proxy hop, rejects non-HTTPS production requests, restricts CORS to `CORS_ORIGIN`, and emits the refresh credential as an HTTP-only, Secure, SameSite=Strict cookie.

The supported production path is `docker-compose.production.yml` with `deployment/nginx/wms-production.conf`. It builds static frontend assets, serves them without Vite/Vitest, terminates TLS at the edge, forwards HTTPS and WebSocket upgrades, keeps PostgreSQL on an internal network, and runs migrations separately from the restricted application identity.

1. Copy `.env.production.example` to an untracked `.env.production` and replace every example public value.
2. Create the referenced secret files outside Git with unique random values. Database and JWT values must be at least 16 and 32 characters respectively; use substantially longer generated values in practice.
3. Provide a trusted certificate/private key for the exact UAT or production hostname.
4. Validate with `docker compose --env-file .env.production -f docker-compose.production.yml config`.
5. Start with `docker compose --env-file .env.production -f docker-compose.production.yml up --build`.
6. Verify HTTPS redirect, HSTS, exact-origin CORS, Secure refresh cookie, WSS upgrade, runtime database grants, and that ports 5000/5432 are not published.

Do not reuse the owner and runtime database credentials. The migrator uses the owner only for schema work and then applies runtime grants. The Express runtime role is non-superuser, cannot create roles/databases, and cannot update/delete audit history. Rotate target-environment credentials through the secret files and rerun the one-shot migrator before restarting the backend.

Local `docker-compose.yml` intentionally remains a development stack and is not approved for UAT or production.

Encrypted off-host PostgreSQL backup, retention, restore drills, and key custody are deployment requirements. The application configuration export is not a database backup.

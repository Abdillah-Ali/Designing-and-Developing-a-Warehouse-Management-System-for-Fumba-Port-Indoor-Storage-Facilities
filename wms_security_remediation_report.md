# Fumba Port WMS Security Remediation Report

**Date:** 2026-08-15  
**Authoritative inputs:** `wms_security_audit_report.md`, `wms_security_remediation_plan.md`  
**Architecture preserved:** React → Express → PostgreSQL. No frontend database credential, direct frontend database connection, or PostgreSQL RLS was introduced.

## Change safety

Before remediation, the repository already contained modified work in `backend/controllers/binController.js`, `backend/controllers/cargoController.js`, two placement services, three backend tests, four frontend components/pages, `frontend/src/services/api.test.js`, and an untracked placement timeline test. Those changes were preserved. The only overlapping production file was `cargoController.js`; the pre-existing cargo-reference search change was retained and security changes were applied narrowly around document handling.

No database was dropped or reset, no volume was removed, no Git reset/history rewrite was used, and no legitimate records were intentionally modified. Migration 031 was applied idempotently to the development database.

## Finding-to-remediation evidence

### R-01 / F-01 — Production frontend and dependency hardening

- **Files:** `frontend/Dockerfile.production`, `frontend/deployment/frontend.conf`, `frontend/package.json`, `frontend/package-lock.json`, `docker-compose.production.yml`.
- **Changes:** Multi-stage frontend build uses `npm ci`; runtime is unprivileged Nginx and contains only `dist`, not Vite/Vitest/source/dev dependencies. SPA fallback is `try_files ... /index.html`. Development Compose remains separate.
- **Versions:** Vitest 3.2.4 → 3.2.7; React Router DOM 6.30.1 → 6.30.4; PostCSS lock tree 8.5.15 → 8.5.26; js-yaml 4.1.1 → 4.3.1; form-data 4.0.5 → 4.0.6; nanoid 3.3.12 → 3.3.18; brace-expansion 1.1.14 → 1.1.18.
- **Verification:** Frontend 44/44 tests passed; Vite production build passed; bundle secret-marker scan returned no matches; production Compose parsed successfully. Full image assembly is not claimed: both bounded Docker builds stalled during package retrieval after their pinned base layers downloaded.
- **Remaining limitation:** Vite 5 has a High development-server advisory and React Router 6 has Moderate advisories requiring major upgrades. Vite is build-only and absent from the production runtime; the Vitest UI is absent. React Router advisories remain a planned tested major migration and are not used for SSR hydration; WMS navigation does not accept arbitrary external redirect destinations.

### R-02 / F-02 — HTTPS/WSS production path

- **Files:** `docker-compose.production.yml`, `deployment/nginx/wms-production.conf`, `deployment/HTTPS.md`, `.env.production.example`, frontend production config.
- **Changes:** Dedicated TLS edge; port 80 redirect; TLS 1.2/1.3; HSTS; proxy forwarding; WebSocket upgrade; same-origin `/api` and `/socket.io`; `NODE_ENV=production`; exact HTTPS CORS origin; frontend/API/database have no direct published production ports.
- **Verification:** Compose configuration validation passed; static tests verify redirect and upgrade directives; development API exact-origin CORS positive and unauthorized-origin 403 tests passed.
- **Remaining limitation:** No trusted target hostname certificate or UAT secret set was supplied, so the TLS stack was not launched end-to-end. Certificate scan, Secure-cookie observation and remote WSS/camera verification remain deployment gates.

### R-03 / F-03 — PostgreSQL least privilege and credentials

- **Files:** `docker-compose.production.yml`, `backend/database/applyRuntimeGrants.js`, `backend/Dockerfile.production`, `.env.production.example`, `deployment/HTTPS.md`.
- **Changes:** Separate owner/migrator and `APP_DB_USER`; runtime role is forced `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`; grants cover required tables/sequences/functions; database network is internal; production has no PostgreSQL host port. Owner/runtime passwords are separate secret files and production DB password must be at least 16 characters.
- **Verification:** Compose parsed; grant script syntax passed; static test confirms identity separation, internal network and prohibited role capabilities.
- **Remaining limitation:** The development stack intentionally retains its existing owner identity and localhost port. Target UAT credentials were not supplied/rotated and live `rolsuper`/grant-denial tests against the new UAT runtime identity therefore remain unverified. Old weak target credentials must be disabled during deployment.

### R-04 / F-04 — Socket.IO parser vulnerability

- **Files:** backend/frontend lockfiles.
- **Versions:** `socket.io-parser` 4.2.6 → 4.2.7 on server and client; public `socket.io`/`socket.io-client` remain compatible 4.8.3.
- **Verification:** Backend audit has zero advisories; scanner policy and session tests passed; unauthorized live WebSocket connection was rejected; live authenticated workflow/concurrency suite passed.
- **Remaining limitation:** Full remote WSS upgrade/polling/reconnect must be repeated on the certificate-backed UAT deployment.

### R-05 / F-08 — Secret management

- **Files:** `backend/config/env.js`, `.env.production.example`, `.gitignore`, production Compose and deployment documentation.
- **Changes:** `DB_PASSWORD_FILE` and `JWT_SECRET_FILE` support; production DB password strength validation; secret files mounted under `/run/secrets`; `secrets/` ignored; tracked examples contain paths/placeholders only; frontend build arguments contain only public relative endpoints.
- **Verification:** Final frontend bundle contained none of the searched secret names/private-key markers; production Compose requires every secret path and public origin; existing Git-secret result remains unchanged.
- **Remaining limitation:** Secret-store ACLs, real rotation and old-secret rejection are deployment operations and were not fabricated in the repository.

### R-06 / F-05 — HTTP headers and CORS

- **Files:** `backend/middleware/securityHeaders.js`, `backend/app.js`, frontend Nginx config, edge Nginx config.
- **Changes:** CSP, HSTS in production, nosniff, DENY/frame-ancestors, no-referrer, Permissions-Policy, CORP, disabled `X-Powered-By`; frontend CSP permits required same-origin assets, data/blob images, inline generated styles and WSS. CORS remains exact-origin and credential-safe; denied origins now return 403 with `CORS_ORIGIN_DENIED`.
- **Verification:** Live headers observed; `X-Powered-By` absent; allowed origin returned its exact ACAO; unauthorized origin returned 403.
- **Remaining limitation:** CSP/camera/printing observation on the final HTTPS hostname remains a UAT browser test.

### R-07 / F-06 — Shared throttling and abuse protection

- **Files:** migration `031_security_hardening`, `rateLimitService.js`, auth/bootstrap/admin/audit/finance/cargo routes, `socketServer.js`.
- **Changes:** Atomic PostgreSQL-backed windows keyed by hashed IP and normalized account; login success clears its keys; temporary Retry-After response; separate refresh/bootstrap limits; quotas for configuration backup/restore, audit operations, finance reports, cargo documents, Socket.IO connections and events.
- **Verification:** Migration applied; unit test proves atomic conflict update and multiple keys; live invalid login returned 429 on attempt four with Retry-After 120; no permanent lockout is introduced.
- **Remaining limitation:** Threshold tuning and multi-replica load/false-positive telemetry require UAT traffic.

### R-08 / F-07 — Upload hardening

- **Files:** `backend/utils/fileValidation.js`, `cargoController.js`, response/header middleware.
- **Changes:** Strict canonical base64; NFKC display-name normalization and 180-character limit; PDF/JPEG/PNG magic bytes; DOCX ZIP plus required container entries; MIME/signature agreement; existing random private exclusive storage/authorization preserved; responses no longer expose `file_path`; download JSON is no-store/nosniff.
- **Verification:** Valid PNG accepted; spoofed MIME, malformed base64 and excessive filename unit tests rejected with stable 400 codes; backend suite passed.
- **Remaining limitation:** No real malware-scanning service was available. Quarantine/AV remains a documented deployment control, so this item is only partially closed.

### R-09 / record scope — IDOR/BOLA verification

- **Files:** existing authorization/workflow tests plus enabled Windows execution in `finalConcurrencyValidation.test.js`.
- **Changes:** Removed a Windows-only skip; corrected its stale billing fixture from one hour to 48 hours so finance setup creates a billable period.
- **Verification:** Full backend suite passed 215/216 with only the explicitly separated live concurrency test skipped in that aggregate run; the same live suite was then executed and passed 12/12. It covers authenticated placement/relocation, invoice/payment, Customs, dispatch, double Gate release and transactional rollback. Existing regression suite verified warehouse isolation, other-owner cargo denial, task ownership, notification visibility, role isolation and configuration/audit permissions. Unauthenticated and invalid-token live requests returned 401.
- **Remaining limitation:** A single exhaustive HTTP table containing every read-only resource/public-reference combination was not created; intentional Customs/Finance/Management global scopes remain permission-controlled. Existing route registry fails closed for unregistered paths.

### R-10 / F-10 — Input validation

- **Files:** `requestValidation.js`, `app.js`, notification and upload controllers.
- **Changes:** Global prohibited prototype keys, nesting/property/query cardinality and length bounds; explicit announcement title/message and upload filename bounds; existing domain validators remain authoritative.
- **Verification:** Prototype-constructor payload returned 400 `INPUT_PROPERTY_PROHIBITED`; excessive queries and filenames fail in unit tests; all regression tests passed.
- **Remaining limitation:** Validation remains intentionally incremental; not every legacy free-text field has a dedicated route schema.

### R-11 / API responses

- **Files:** `responseMinimization.js`, `app.js`, cargo upload/content controller.
- **Changes:** Global recursive omission of password/scanner hashes, refresh/token hashes and filesystem paths; cargo upload returns an explicit DTO; 500 responses remain generic.
- **Verification:** Recursive sanitizer unit test passed; live invalid/CORS responses expose no stack/SQL/path; frontend contracts passed.
- **Remaining limitation:** Some internal numeric IDs remain because the current frontend requires them; public-reference conversion should be incremental.

### R-12 / F-09 — Access token storage

- **Files:** `frontend/src/lib/portal-access.js`, `frontend/src/services/api.js`.
- **Changes:** Default access token storage is module memory; stale `sessionStorage` token is removed on module load; protected requests restore through the HttpOnly refresh cookie; role/permission non-secret UI hints may remain in session storage. Bearer authentication, refresh rotation/replay and CSRF posture are unchanged.
- **Verification:** Portal/API focused tests passed 20/20; full frontend passed 44/44; reload restoration code path and retry tests passed.
- **Remaining limitation:** Multi-tab access-token sharing is intentionally not added; each tab restores its own short-lived token.

### R-13 / F-11 — Audit integrity

- **Files:** `applyRuntimeGrants.js`, production Compose/deployment documentation.
- **Changes:** Runtime role loses UPDATE/DELETE/TRUNCATE on current and archived audit tables while retaining insert/select required by WMS and archival copy operations.
- **Verification:** Static grant test passed; full audit creation/archive/regression behavior passed under the development owner identity.
- **Remaining limitation:** Live denial under the target restricted role and an external append-only/tamper-evident sink remain deployment/defense-in-depth requirements.

## Database and backup distinction

The application configuration export/validate/restore APIs remain RBAC protected and audited; they are not PostgreSQL backups and contain configuration snapshots, not database credentials. Encrypted off-host database backup storage, retention, key custody and restore drills are **NOT VERIFIED / DEPLOYMENT REQUIREMENT**.

## Files created by remediation

Production Dockerfiles/configuration, TLS Nginx config, DB grant script, migration 031, three backend middleware modules, rate-limit service, file validator, security hardening tests, `.env.production.example`, and the three closure reports. Existing local `.env` values were not copied into tracked files or reports.

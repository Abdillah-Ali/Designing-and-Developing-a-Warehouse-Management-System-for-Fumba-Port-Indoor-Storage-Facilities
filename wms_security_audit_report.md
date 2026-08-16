# Fumba Port WMS Security Audit Report

**Audit date:** 2026-08-15  
**Scope:** Entire repository: React/Vite frontend, Express API, PostgreSQL schema/migrations, Socket.IO scanner workflow, Docker/Compose, configuration, tests, and Git history available locally.  
**Method:** Read-only source and history review; route/middleware/controller/service/database tracing; lockfile vulnerability audit; safe requests to the running API; selected non-destructive tests. No source, schema, Docker, package, credential, role, or data changes were made.

## Executive summary

The application has materially better application-level controls than a typical development build: protected API routes pass through a fail-closed permission registry, access tokens are tied to server-side sessions, refresh credentials rotate and are hashed, passwords use bcrypt cost 12, warehouse/ownership checks exist in key workflows, financial/customs/gate transitions are server-owned, and Socket.IO revalidates sessions for each scanner event.

It is not production-ready. The supplied deployment runs development servers over exposed plaintext ports, uses the PostgreSQL bootstrap/superuser identity as the application identity, exposes PostgreSQL to the host, and contains a trivially weak local database password. The frontend tree contains a critical Vitest advisory, although the vulnerable Vitest UI is not started by the supplied command; the Socket.IO parser has a high-severity remotely reachable memory-exhaustion advisory. Express supplies no security-header layer. Uploads trust a claimed MIME string without checking file signatures. Authentication throttling is process-local and IP-only.

## Audit limitations

- The running API at `http://127.0.0.1:5000` was tested without valid user credentials; authenticated cross-role and cross-warehouse runtime requests were therefore verified through code and existing tests, not a full live role matrix.
- Docker API access was unavailable to the audit process. The running HTTP API and Compose files were inspected, but container runtime user/capability and live PostgreSQL grants were not queried.
- No destructive database test suite was run. Selected mock/static suites produced **90 passes, 0 failures, 3 skips**; the skips explicitly reported an unavailable configured live database host.
- Git history available in the local clone was inspected. External forks, CI logs, registries, deployed hosts, backups, and secret-manager state were outside the repository scope.
- `npm audit` reflects advisories current on the audit date and does not prove exploitability by itself; reachability is assessed below.

## Confirmed findings

### F-01 — HIGH — Development server deployment and vulnerable frontend toolchain

**Evidence:** `frontend/package.json` declares `vitest` 3.2.4; the lockfile resolves a version below 3.2.6. `npm audit` reports GHSA-5xrq-8626-4rwp (arbitrary file read/execution through a listening Vitest UI server). The supplied command does **not** start that UI, so critical exploitability was not established. `docker-compose.yml` does run `npm run dev -- --host` and publishes `3000:3000`; `frontend/Dockerfile` also defaults to the Vite development server. The audit additionally reports high issues in PostCSS, js-yaml, form-data, nanoid, brace-expansion and Socket.IO parser, and moderate issues in React Router and esbuild.

**Consequence:** The current deployment deliberately exposes a development toolchain. The critical Vitest issue becomes exploitable if its UI/server is later started on a reachable interface; it is currently a latent dependency risk, not a confirmed reachable Critical path. The Vite/esbuild development-server exposure and other vulnerable build dependencies still make the supplied runtime unsuitable for untrusted networks.

### F-02 — HIGH — Production transport is not established; supplied deployment sends credentials over HTTP

**Evidence:** `docker-compose.yml` publishes frontend `3000`, API `5000`, and PostgreSQL `5433` without a TLS reverse proxy or certificates and does not set `NODE_ENV=production`. `frontend/src/services/api.js:3-12` derives an HTTP API URL whenever the page is HTTP. The running API responded at `http://127.0.0.1:5000`. `backend/app.js:96-101` rejects insecure requests only when `NODE_ENV === "production"`; that condition is not active in Compose. Socket.IO derives the same origin in `frontend/src/services/scannerSocket.js:5-14`.

**Consequence:** Login passwords, bearer access tokens, refresh cookies, cargo data, documents, customs and finance information can cross the network in plaintext if the supplied stack is reachable beyond a trusted local machine. Camera/scanner secure-context behavior may also fail remotely.

### F-03 — HIGH — Database credential and least-privilege controls are unsafe

**Evidence:** Root `.env` and `backend/.env` contain a three-character PostgreSQL password (value intentionally redacted). `docker-compose.yml` passes `POSTGRES_USER` into both database bootstrap and backend `DB_USER`; `backend/config/db.js:4-12` uses that identity. No migration/deployment file creates or grants a restricted application role. The official PostgreSQL image makes `POSTGRES_USER` the database superuser. Compose publishes the database as `5433:5432`.

**Consequence:** A guessed/leaked password can yield direct database access, and compromise of the backend yields database-owner/superuser capability rather than only the CRUD privileges the application needs. This magnifies SQL injection, RCE, backup, and audit-log impact.

### F-04 — HIGH — Reachable Socket.IO dependency permits unauthenticated memory exhaustion

**Evidence:** Backend `socket.io` and frontend `socket.io-client` resolve `socket.io-parser` 4.2.6. `npm audit` reports GHSA-2m8v-j782-fhvr for versions below 4.2.7. `backend/realtime/socketServer.js:224-240` creates a public Socket.IO server; parser processing occurs at the transport/protocol boundary before application event authorization can fully mitigate malformed packets.

**Consequence:** A remote client able to reach port 5000 can exhaust server memory and deny WMS/scanner operations. Authentication does not reliably remove parser-level exposure.

### F-05 — MEDIUM — HTTP security headers are absent

**Evidence:** `backend/package.json` has no Helmet dependency and `backend/app.js` has no equivalent header middleware. A live `/api/health` response exposed `X-Powered-By: Express` and lacked CSP, HSTS, `X-Content-Type-Options`, frame protection, Referrer-Policy, and Permissions-Policy.

**Consequence:** Browser defense-in-depth against framing, MIME confusion, referrer leakage, unsafe content execution, and protocol downgrade is missing. The lack of CSP increases the impact of any future XSS.

### F-06 — MEDIUM — Authentication and abuse throttling is incomplete and not horizontally safe

**Evidence:** `backend/routes/authRoutes.js:7-39` stores counters in a process-local `Map`, keys only by IP, increments all attempts, and clears after any successful response. Only `/api/auth/login` uses it (`:42`). `/api/auth/refresh` (`:56`) and `/api/bootstrap/create-admin` have no throttling; Socket.IO has no connection/event rate limit. The limiter loses state on restart and is independent per replica. There is no bounded cleanup of stale IP entries until those IPs return.

**Consequence:** Distributed attempts, restarts, replicas, refresh-token guessing/abuse, Socket.IO connection floods, and expensive endpoints can bypass a single-process login limit. Shared-IP users can temporarily deny one another, although the two-minute default window prevents permanent lockout.

### F-07 — MEDIUM — Upload type validation trusts client metadata and stores unscanned active content

**Evidence:** `backend/controllers/cargoController.js:864-879` maps the submitted `file_type` to an extension and decodes base64, but does not validate PDF/DOCX/JPEG/PNG magic bytes, parse container structure, or malware-scan content. It does enforce a size cap, random storage name, exclusive creation, non-public storage, workflow/ownership authorization, and download path containment (`:832-849`, `:881-936`). The original filename is metadata, not the storage path.

**Consequence:** An authenticated user can store arbitrary bytes under an approved extension. Direct server execution/path traversal is prevented by the current design, so severity is Medium; downstream download/opening can still expose staff workstations or document processors.

### F-08 — MEDIUM — Secrets are filesystem environment values with weak production separation

**Evidence:** `.env` and `backend/.env` contain real-looking local credentials. They are ignored and not tracked. Compose injects secrets as ordinary environment variables and mounts the entire backend source tree. `backend/.env.example` includes safe placeholders and `backend/config/env.js:35-57` fail-closes on missing variables and weak/short JWT secrets, but it does not validate database password strength. No Docker secret/file mechanism or documented external secret source exists.

**Consequence:** Local/deployment filesystem or container-inspection access exposes credentials; copying this Compose pattern to production risks reuse of weak development values. This is separate from Git exposure, which passed for the available history.

### F-09 — LOW — Access tokens are readable by any successful same-origin script

**Evidence:** `frontend/src/lib/portal-access.js:366-398` stores bearer access tokens in `sessionStorage`; `frontend/src/services/api.js:82-95` sends them in `Authorization`. Refresh credentials are better protected in an HttpOnly, Strict, production-Secure cookie (`backend/services/authSessionService.js:145-149`).

**Consequence:** A future same-origin XSS or compromised frontend dependency could exfiltrate the current access token. Short lifetimes and per-request server session checks reduce persistence. No exploitable WMS XSS was confirmed in this audit.

### F-10 — LOW — Upload/original text length and uniform schema validation remain uneven

**Evidence:** Validation is implemented through controller/service-specific readers rather than one schema boundary. Strong examples include bootstrap length/enums (`bootstrapController.js:8-34`), finance allowlists (`financeService.js:99-129`), and cargo configured-field checks. However, upload `file_name` at `cargoController.js:864` has no explicit length/character bound, and several note/message fields are converted with `String(...).trim()` without uniform maximum lengths. Express accepts JSON bodies up to 15 MB globally (`backend/app.js:95`).

**Consequence:** Oversized metadata/notes can cause storage, UI, logging, and operational nuisance. PostgreSQL column limits may reject some values, but database errors are not a consistent validation boundary.

### F-11 — INFORMATIONAL — Audit logs are application-append-only, not independently tamper-evident

**Evidence:** No production route updates/deletes `audit_logs`. `/api/audit-logs` is permission protected; archival copies eligible rows without deleting originals (`backend/services/auditArchiveService.js:5-23`) and logs the action. Actors and timestamps are populated server-side. However, the backend connects with the PostgreSQL bootstrap identity (F-03), and no cryptographic chaining, immutable external sink, or restricted insert-only database role exists.

**Consequence:** Ordinary portal users cannot alter audit history, but a database/backend compromise can. This is an architectural assurance gap rather than a demonstrated ordinary-user bypass.

## Security control matrix

| Control | Status | Highest severity | Evidence | Main issue | Required action |
|---|---|---:|---|---|---|
| 1. Secret/API key protection | PARTIAL | HIGH | `.gitignore`; `config/env.js:9-57`; local env review; Compose | Weak DB secret; environment-only deployment pattern | Rotate weak credentials and use production secret injection |
| 2. Git secret exposure | PASS | INFORMATIONAL | `git ls-files`; all-history path/pattern scan | No tracked/historical secret found in available clone | Keep scanning in CI; no history purge/rotation required from Git evidence |
| 3. Sensitive-data encryption | PARTIAL | HIGH | bcrypt, hashed refresh tokens; Compose/API URL | At-rest controls/backup encryption not evidenced; transport plaintext | Enforce edge TLS and define encrypted backup/storage handling |
| 4. Server authentication/authorization | PASS | INFORMATIONAL | `app.js:122-151`; `authMiddleware.js`; authorization registry; RBAC tests | No confirmed backend bypass | Maintain route-registry completeness tests |
| 5. Record-level access control | PARTIAL | MEDIUM | Cargo ownership/warehouse assertions; placement tests; workflow services | Broad full live IDOR matrix not executed; some global-role scope is intentional | Add authenticated cross-role/cross-warehouse API tests for every `:id` route |
| 6. Field tampering | PASS | INFORMATIONAL | Cargo `cargoFields` allowlist (`cargoController.js:991-1094`); normalized admin/finance/workflow payloads | No confirmed protected-field mutation | Preserve allowlists and negative tests |
| 7. Session/cookie handling | PASS | INFORMATIONAL | `authSessionService.js:10-154`; `authMiddleware.js`; change/reset invalidation | Strong rotation/replay/revocation design | Keep lifetime and revocation integration tests |
| 8. Password hashing | PASS | INFORMATIONAL | `utils/password.js:1-14`; bootstrap/admin flows | bcrypt cost 12, compare API, policy, no plaintext response | Monitor cost and prohibit secrets in logs |
| 9. Login rate limiting | PARTIAL | MEDIUM | `authRoutes.js:7-42` | In-memory IP-only limiter; incomplete endpoint coverage | Use shared bounded IP+account throttling |
| 10. Bot/automated abuse | PARTIAL | MEDIUM | Auth limiter; permissions; no socket/report throttles | Expensive and real-time paths lack quotas | Risk-based quotas; CAPTCHA only if public abuse warrants it |
| 11. SQL parameterization | PASS | INFORMATIONAL | Repository query review; `$1...`; identifier allowlists such as `financeService.js:99-129`; sort allowlists | Dynamic clauses are code-built; no user SQL fragment confirmed | Add static query lint/review checks |
| 12. Server input validation | PARTIAL | LOW | Per-domain validators and workflow registries | Uneven maximum lengths and no uniform unknown-property rejection | Add route schemas and bounds incrementally |
| 13. XSS/escaping | PASS | INFORMATIONAL | React text rendering; review of `dangerouslySetInnerHTML` chart style and barcode print | Dangerous APIs use code/config or React-escaped DOM; no exploit path confirmed | Add CSP and keep user values out of raw HTML/style config |
| 14. File uploads | PARTIAL | MEDIUM | `cargoController.js:820-943` | Claimed type only; no signature/malware verification | Inspect bytes, scan/quarantine, cap names |
| 15. API response minimization | PARTIAL | LOW | Explicit auth responses/error handler; upload INSERT `RETURNING *` | Several domain responses expose internal IDs/paths/metadata more broadly than necessary | Introduce response DTOs; never return `file_path` |
| 16. HTTP security headers | FAIL | MEDIUM | Live response and `app.js` | Missing header middleware and Express disclosure | Configure tested production headers/CSP |
| 17. HTTPS/TLS | FAIL | HIGH | Compose, frontend API derivation, live HTTP | No TLS edge; production guard not activated | Deploy TLS proxy/load balancer, production mode, redirects/HSTS |
| 18. Dependency management | FAIL | HIGH | Backend/frontend `npm audit`, Dockerfiles | 3 backend and 12 frontend advisories; Critical Vitest path installed but not started; reachable high Socket.IO issue | Apply targeted lockfile fixes after review and build immutable production images |

## Authentication, authorization, and record-scope trace

The principal protected path is:

`Request → app.use('/api', requirePortalAccess) → signed access-token verification → active user_sessions/user/scanner lookup → current DB role permissions → exact method/path authorization registry → route permission middleware where present → controller/service warehouse/ownership/workflow checks → parameterized PostgreSQL query → minimized JSON/error handler`.

Unknown protected routes fail with `AUTH_ROUTE_PERMISSION_UNREGISTERED`; this prevents a newly added backend route from silently inheriting UI-only protection. Login/profile/scanner/bootstrap routes sit before the global gate but use their own authentication or one-time bootstrap control. Live unauthenticated requests to `/api/users` and `/api/auth/me` returned 401; an invalid login returned 401 with a generic message.

Important verified domain paths:

- **Cargo/placement:** `cargoController` checks warehouse readability and staff ownership; editable fields are allowlisted. `placementService` re-loads cargo/bin data, enforces approval/state/ownership/capacity/rules, locks rows, and writes movements/audits. Tests confirmed a staff user cannot validate another user's cargo and manual placement cannot bypass supervisor approval.
- **Customs:** `customsRoutes` requires explicit permissions. `customsWorkflowService` uses trusted transition/condition/effect registries and expected state keys. Tests confirmed management/scanner isolation and no finance/gate mutation side effects.
- **Finance:** routes independently permission tariff creation/update/activation, invoice issue/cancel, payment record/confirm, and reports. Server-side services generate references, derive tariffs and totals, use integer monetary arithmetic, and fail closed on tariff gaps. Client-supplied invoice totals/payment confirmation were not found as authoritative inputs.
- **Dispatch/Gate:** route permissions plus workflow services enforce dispatch authorization and the normal five-condition release policy. Gate-out executes the trusted final transition transactionally and records charge end; emergency release remains separately permissioned and cannot directly invent released state.
- **Notifications:** service queries bind visibility to recipient user/role/warehouse and lifecycle state. Mutations operate on the current user's visible notification. Deep-link/resolution strategies come from trusted registries.
- **Administration/RBAC:** role changes and user lifecycle are permissioned and normalized; critical self-lockout/admin-count protections use transactions and advisory locks. Security-sensitive changes revoke active sessions. Scanner permissions cannot be assigned through portal RBAC; management is held read-only.
- **Warehouse hierarchy:** mutations require `warehouse.hierarchy.manage`; parent/warehouse consistency and capacity are checked server-side. Reads are permission-registry protected globally. A complete live cross-warehouse hierarchy ID matrix remains a required regression test (matrix status PARTIAL).

## Sessions, cookies, passwords, CSRF, and abuse

- Access JWTs include type and session ID and are rejected unless the server-side session and account remain active. Role and permissions are refreshed from PostgreSQL on each request; disabled users and revoked/expired sessions fail.
- Refresh tokens are random 48-byte values, stored only as SHA-256 hashes, rotated on use, and protected by family replay detection. The cookie is `HttpOnly`, `SameSite=Strict`, path-limited to `/api/auth`, and `Secure` in production. Logout/password/admin-sensitive changes revoke sessions.
- Access tokens use bearer headers, so ordinary state-changing APIs are not cookie-authenticated. The refresh endpoint is cookie-authenticated but Strict SameSite and origin-restricted CORS materially mitigate CSRF. No separate CSRF token is required for the present same-site design; deployment must not weaken SameSite/CORS.
- Passwords use bcryptjs cost 12 and compare with `bcrypt.compare`. Password policies cover bootstrap, users, reset/change, and scanner accounts. Password hashes are not returned by auth/profile endpoints and logger fields matching password/token/secret are filtered.
- The login limiter works for a single process but F-06 prevents PASS. CAPTCHA is not generally justified for an authenticated internal WMS; shared throttling is appropriate for login/bootstrap/refresh, Socket.IO connection/events, exports, backup validation/restore, and large document operations.

## SQL injection and validation

Repository searches and manual review found parameter binding throughout controllers/services. Dynamic `WHERE` fragments are assembled from fixed clauses; dynamic sort columns/directions and finance identifier pairs are allowlisted. Pagination values are parsed/clamped before interpolation. Cargo update column identifiers come exclusively from the server-owned `cargoFields` array. No input-to-user-controlled SQL fragment path was confirmed.

Validation is domain-aware and often strong (enums, dates, monetary arithmetic, positive capacity, workflow state, expected state/concurrency, catalog values), but it is distributed and inconsistent for free text/unknown properties. This yields PARTIAL rather than FAIL.

## XSS and content rendering

React escapes ordinary cargo, user, notification, audit, finance, and configuration strings. The two notable raw sinks were reviewed:

- `frontend/src/components/ui/chart.jsx:32-45` builds CSS through `dangerouslySetInnerHTML`; current chart configs are developer-owned rather than API/user supplied.
- `frontend/src/components/wms/BarcodeLabel.jsx:121-143` writes a print document using a static title and `outerHTML` produced by React, so text nodes are already escaped.

No stored/reflected XSS execution path was confirmed. CSP remains required as defense-in-depth (F-05), and sessionStorage makes any future XSS more consequential (F-09).

## API responses and error handling

`errorMiddleware.js:7-22` returns generic 500 messages and no stack/SQL/path, including in development for 500-class errors. Auth failures are generic. Several domain endpoints still use `RETURNING *` or return internal numeric IDs and, for uploaded documents, the database row can include `file_path`; these are unnecessary exposure even though document content access is authorized. Response DTOs are needed before production.

## Docker, database, backups, and audit integrity

- Compose uses mutable bind mounts, installs dependencies on every start with `--no-audit`, runs schema initialization/migration automatically, publishes all service ports, and runs development servers. Dockerfiles use unpinned `node:20-alpine`, `npm install`, and default root users. No privileged flag exists, but root execution and mutable builds remain.
- PostgreSQL is directly published and the backend uses the bootstrap identity (F-03). Live grants were not verified; the configuration itself demonstrates lack of an independent least-privilege application role.
- Configuration backup/validate/restore routes are protected by configuration permissions and operate on configuration snapshots, not raw database dumps. No repository mechanism demonstrates encrypted off-host database backups, access controls, retention, or restore auditing: backup-at-rest assurance is **NOT VERIFIED**.
- Audit log APIs are read/export/archive only. Workflow audit actors, roles, warehouses and timestamps are server-derived. F-11 describes the residual database-compromise risk.

## WebSocket/scanner security

`socketServer.js:69-169` verifies a typed JWT, binds user/session/scanner account, and checks active session/account state. `:171-185` revalidates persistent authority for every event; handlers call scanner services that lock sessions, enforce server-owned two-step workflow, warehouse/staff association, expiry, and duplicate scan receipts. Unauthorized Socket.IO handshakes are rejected in code; tests confirm per-event revalidation and duplicate protections. CORS becomes production-restricted only with correct environment configuration, and the parser vulnerability/rate-limit gap remain F-04/F-06.

## Safe verification results

- Running API health: 200 and database connected.
- Unauthenticated `/api/users`: 401.
- Unauthenticated `/api/auth/me`: 401.
- Invalid nonexistent-user login: 401 with generic `Invalid username or password`.
- Live headers: confirmed no hardening headers and disclosed Express.
- Selected security/authority suites: 90 passed, 0 failed, 3 skipped due unavailable configured live DB host.
- Backend dependency audit: 0 critical, 2 high, 0 moderate, 1 low.
- Frontend dependency audit: 1 critical, 7 high, 4 moderate, 0 low.
- Destructive/cross-role authenticated tests, oversized uploads, and live unauthorized Socket.IO connections were not run without isolated credentials/data; they remain required before UAT.

## Required suitability decision

- **Continued development/testing:** Suitable only on isolated developer networks with non-production data and prompt remediation of the high dependency and credential issues.
- **Controlled UAT:** Not suitable in the supplied configuration. It may proceed only after High items are fixed, TLS is enabled, secrets are rotated, the database is not publicly exposed, and the authenticated negative-test matrix passes.
- **Production deployment:** Not suitable. Critical and High findings remain unresolved.

The system cannot receive a higher verdict because the supplied runtime exposes development tooling and plaintext services, includes reachable High dependency risk, and gives the application a weakly protected PostgreSQL superuser identity. No confirmed Critical exploit path was established; the critical Vitest advisory remains latent unless its UI server is started.

SECURITY REMEDIATION REQUIRED

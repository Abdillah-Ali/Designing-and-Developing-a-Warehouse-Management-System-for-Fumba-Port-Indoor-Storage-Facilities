# Fumba Port WMS Security Remediation Plan

Only confirmed `FAIL` and `PARTIAL` audit findings are included. Work is ordered by severity. Do not apply changes until this audit is approved. Preserve the architecture `React → Express → PostgreSQL`; do not add frontend database credentials or PostgreSQL RLS.

## Critical

No confirmed reachable Critical finding was established. The critical Vitest advisory is installed but its vulnerable UI server is not started by the supplied deployment; it is handled urgently under R-01.

## High

### R-01 — Replace exposed development tooling with an immutable production frontend

- **Vulnerability:** High-risk development-server deployment and vulnerable frontend dependency tree. The critical Vitest advisory is latent unless its UI server is started.
- **Affected component:** `frontend/package-lock.json`, `frontend/package.json`, `frontend/Dockerfile`, `docker-compose.yml`.
- **Recommended solution:** Apply the smallest compatible lockfile updates that resolve Vitest, Socket.IO parser, PostCSS, js-yaml, form-data, nanoid, brace-expansion and React Router advisories. Build static frontend assets in a pinned multi-stage image and serve them from a hardened web server; do not ship Vitest/Vite development servers or dev dependencies in the runtime image. Use `npm ci` and fail CI on applicable critical/high production advisories.
- **Expected improvement:** Removes a reachable development/test attack surface and makes runtime contents reproducible.
- **Regression risk:** Build/plugin incompatibility, changed router redirect behavior, and test-runner behavior changes.
- **Tests required:** Clean locked install; frontend unit suite; production build; route/deep-link/redirect tests; asset and SPA fallback tests; container scan; verify no Vite/Vitest listener or dev dependency in runtime.

### R-02 — Establish HTTPS/WSS production deployment

- **Vulnerability:** Credentials, tokens and operational data can traverse plaintext HTTP; current production mode is not activated.
- **Affected component:** Deployment proxy/load balancer, Compose production override, frontend API/Socket.IO URLs, Express proxy/HTTPS settings.
- **Recommended solution:** Terminate TLS at a trusted reverse proxy/load balancer, expose only 443 publicly, route frontend/API/Socket.IO on the approved origin, set `NODE_ENV=production`, provide exact HTTPS CORS origins, retain `trust proxy`, redirect HTTP at the edge, and enable HSTS only after HTTPS validation. Keep container-internal HTTP on an isolated network unless the deployment threat model requires mTLS.
- **Expected improvement:** Protects login, sessions, documents, cargo, finance, customs, gate and scanner traffic in transit.
- **Regression risk:** Proxy-loop/misreported `req.secure`, CORS failures, secure-cookie failures, Socket.IO upgrade failures, camera/scanner origin issues.
- **Tests required:** TLS/certificate scan; HTTP-to-HTTPS redirect; Secure refresh cookie; login/refresh/logout; WebSocket and polling fallback over WSS/HTTPS; exact-origin CORS positive/negative tests; remote scanner/camera secure-context test.

### R-03 — Rotate database credentials and introduce a least-privilege application role

- **Vulnerability:** Three-character DB password, direct database port publication, and backend use of PostgreSQL bootstrap/superuser identity.
- **Affected component:** PostgreSQL deployment, backend DB configuration, external secret storage, Compose networking.
- **Recommended solution:** Generate and rotate strong unique production credentials; create a separate non-superuser/non-owner backend role with only required schema/table/sequence/function privileges; retain a separate migration owner used only by controlled migrations; remove public host port publication in production or firewall it to an administrative network. Do not create a frontend DB role and do not enable RLS.
- **Expected improvement:** Prevents trivial credential guessing and limits backend/database compromise impact, including audit tampering.
- **Regression risk:** Missing sequence/function/DDL privileges and migration startup failures.
- **Tests required:** Full API/integration suite under restricted role; prove `rolsuper=false`, no role creation/database creation, no schema ownership, and denied direct audit update/delete; migration pipeline test using separate owner; network port scan.

### R-04 — Resolve reachable Socket.IO parser vulnerability

- **Vulnerability:** GHSA-2m8v-j782-fhvr permits parser-level memory exhaustion.
- **Affected component:** Backend and frontend Socket.IO lockfile dependency trees.
- **Recommended solution:** Update to dependency versions resolving `socket.io-parser` (at least the advisory-fixed line), keeping server/client compatibility; add transport payload/connection controls at proxy and application layers.
- **Expected improvement:** Removes known unauthenticated denial-of-service primitive.
- **Regression risk:** Server/client protocol mismatch and scanner reconnection behavior changes.
- **Tests required:** Scanner handshake, authentication denial, session recovery, polling/WebSocket upgrades, duplicate scan behavior, reconnect and expiry; malformed/zero-attachment packet regression under resource monitoring.

### R-05 — Improve production secret handling

- **Vulnerability:** Real-looking filesystem env values, ordinary container environment injection, and weak separation between development and production.
- **Affected component:** `.env` operational process, Compose/deployment secret injection, JWT/DB credentials.
- **Recommended solution:** Keep `.env` files untracked, add automated secret scanning for commits/history/CI artifacts, source production secrets from an approved secret store or protected runtime files, validate DB password strength in production, document distinct development/test/UAT/production secrets, and rotate the current weak DB credential. Never prefix server secrets with `VITE_`.
- **Expected improvement:** Reduces leakage/reuse and prevents weak values entering production.
- **Regression risk:** Startup failures from missing mounts/permissions or rotation ordering.
- **Tests required:** Secret-free frontend bundle scan; startup fail-closed tests; old credential rejection/new credential success; container inspection; Git/CI secret scan.

## Medium

### R-06 — Add HTTP security headers and a tested CSP

- **Vulnerability:** Missing CSP, HSTS, MIME/frame/referrer/permissions protections; Express fingerprint disclosure.
- **Affected component:** Express middleware and TLS edge.
- **Recommended solution:** Configure Helmet or equivalent explicitly; disable `X-Powered-By`; deploy a CSP compatible with Vite-built assets and Socket.IO; set `nosniff`, frame denial/ancestors, strict referrer policy, appropriate Permissions-Policy, and HSTS at the TLS edge/production API.
- **Expected improvement:** Reduces XSS impact, framing, MIME confusion, referrer leakage and downgrade risk.
- **Regression risk:** Blocked scripts/styles/images/WebSockets, barcode printing, charts, camera access.
- **Tests required:** Automated header assertions; CSP violation monitoring; all portals, charts, print labels, document download, Socket.IO and scanner/camera tests.

### R-07 — Replace process-local login limiter with risk-based shared throttling

- **Vulnerability:** IP-only in-memory login limiter; no refresh/bootstrap/Socket.IO/expensive-route controls.
- **Affected component:** Authentication routes, bootstrap, refresh, Socket.IO, exports/reports/configuration backup operations.
- **Recommended solution:** Use a bounded shared store with combined IP and normalized-account keys, exponential cooldown or sliding windows, trusted-proxy configuration, generic responses, and cleanup/expiry. Add conservative refresh and Socket.IO connection/event quotas and endpoint-specific limits for expensive exports/validation. Keep lockouts temporary; do not require CAPTCHA for ordinary internal workflows unless exposure/telemetry justifies it.
- **Expected improvement:** Limits brute force and resource abuse across replicas while reducing shared-IP denial of service.
- **Regression risk:** Legitimate port users behind NAT may be throttled; proxy misconfiguration can collapse all users to one key.
- **Tests required:** Repeated incorrect login; correct login after cooldown; account/IP distribution; replica/shared-store test; spoofed forwarding headers; refresh flood; Socket.IO connect/event flood; no permanent lockout.

### R-08 — Verify upload bytes and quarantine/scan documents

- **Vulnerability:** Claimed MIME is accepted without signature/container verification or malware scanning.
- **Affected component:** Cargo document upload/download and storage.
- **Recommended solution:** Decode strictly; inspect magic bytes and, for DOCX, validate ZIP/container structure; require extension/MIME/signature agreement; cap original filename length and normalize display characters; quarantine new files and scan with an approved malware service before staff download; serve downloads as attachment with `nosniff` and safe content type. Keep random names, `wx`, private storage, path containment, ownership and workflow checks.
- **Expected improvement:** Prevents disguised executable/malicious documents reaching users and processors.
- **Regression risk:** False positives, scanner latency/unavailability, rejection of valid uncommon documents.
- **Tests required:** Valid fixtures; extension/MIME/signature mismatches; polyglots; malformed base64/ZIP; EICAR test in isolated scanner; oversized/empty files; traversal filenames; unauthorized upload/download; duplicate/overwrite attempt.

### R-09 — Complete authenticated record-scope verification

- **Vulnerability:** Code shows extensive scoping, but a complete live cross-role/cross-warehouse IDOR/BOLA matrix was not executed.
- **Affected component:** Every backend `:id`/reference route for cargo, documents, hierarchy, users/scanners, shifts, approvals, dispatch, finance, customs, gate, notifications, audit/configuration.
- **Recommended solution:** Create isolated fixtures in two warehouses and automated API tests for unauthenticated, wrong-role, same-role-other-owner, other-warehouse, invalid-state and valid-control cases. Treat 404 vs 403 consistently where record enumeration matters. Include Socket.IO session/cargo/bin cross-scope cases.
- **Expected improvement:** Converts record-scope assurance from partial static evidence to repeatable verification and catches future registry/controller drift.
- **Regression risk:** Tests may expose intentional global-role behavior that must be documented rather than restricted.
- **Tests required:** The matrix itself, run against disposable DB data in CI/UAT, with cleanup and audit assertions.

## Low

### R-10 — Standardize server-side request schemas and bounds

- **Vulnerability:** Uneven free-text/filename length limits and unknown-property handling.
- **Affected component:** Upload metadata, notes/remarks/messages, query parameters, and remaining controller-specific payloads.
- **Recommended solution:** Introduce per-route schemas at the API boundary with maximum lengths, strict enums, numeric/date ranges, pagination caps and explicit unknown-property rejection where safe. Preserve domain/service validation as defense-in-depth and roll out incrementally to avoid breaking configured cargo fields.
- **Expected improvement:** Predictable 400 errors and reduced storage/log/UI abuse or database-error leakage.
- **Regression risk:** Existing clients may send harmless extra fields or values outside newly documented limits.
- **Tests required:** Boundary values, excessive lengths, unexpected keys, negative/overflow numbers, invalid dates/enums/JSON, prototype keys, configured custom cargo fields.

### R-11 — Minimize API response shapes

- **Vulnerability:** Some endpoints return `RETURNING *`, internal numeric IDs, broad joined rows, or document storage metadata.
- **Affected component:** Cargo documents and CRUD/workflow responses across controllers/services.
- **Recommended solution:** Define response DTOs per role/use case; omit password hashes, token hashes, file paths, internal audit/security metadata and unrelated PII. Prefer public references externally while retaining internal IDs only when the client genuinely requires them.
- **Expected improvement:** Reduces data exposure and future accidental leakage when table columns are added.
- **Regression risk:** Frontend components may depend on undocumented fields.
- **Tests required:** Contract tests for every route; frontend suite; explicit assertions that password/token hashes, filesystem paths and unrelated fields never appear.

### R-12 — Reduce access-token exposure to same-origin script

- **Vulnerability:** Bearer access token is stored in `sessionStorage`.
- **Affected component:** Frontend auth state/API client.
- **Recommended solution:** Prefer an in-memory access token with refresh-cookie restoration after reload; keep short access lifetimes and current server session validation. Do not move state-changing API authentication to an ambient cookie without designing CSRF protection.
- **Expected improvement:** Reduces token persistence and opportunistic extraction after a transient injection.
- **Regression risk:** Reload/multi-tab behavior and refresh races.
- **Tests required:** Login/reload/refresh/logout, expired/revoked/disabled sessions, multiple tabs, refresh replay, XSS-oriented storage assertions, CSRF regression.

## Informational

### R-13 — Add independent audit-log integrity assurance

- **Vulnerability:** Portal paths are append-only, but privileged database/backend compromise can rewrite history.
- **Affected component:** Database privileges, audit pipeline, archival/monitoring.
- **Recommended solution:** After R-03, deny the runtime role direct update/delete on audit tables and expose only the required audited insert path; replicate/sign events to access-controlled append-only external storage and monitor gaps. Preserve authorized retention/archive behavior and legal requirements.
- **Expected improvement:** Makes post-compromise alteration detectable and limits ordinary backend credential misuse.
- **Regression risk:** Audit writes or retention jobs can fail if grants/pipeline availability are wrong.
- **Tests required:** Successful normal audit inserts; denied update/delete; archive/retention; external sequence/hash verification; outage/retry and alert tests.

## Exit criteria

Before controlled UAT: all Critical/High items closed, HTTPS/WSS active, production images immutable, database role restricted, secrets rotated, and the authenticated negative matrix passing. Before production: Medium items affecting headers, throttling and uploads closed; dependency audits have no applicable Critical/High runtime findings; backup encryption/restore authorization is independently verified; monitoring and incident response are documented.

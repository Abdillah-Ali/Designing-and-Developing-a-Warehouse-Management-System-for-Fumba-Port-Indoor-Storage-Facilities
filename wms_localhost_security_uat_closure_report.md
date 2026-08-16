# Fumba Port WMS Localhost Security UAT Closure Report

**Assessment date:** 2026-08-15  
**Deployment scope:** Single-PC localhost academic/development deployment  
**Architecture:** React → Express → PostgreSQL  
**Authoritative inputs reviewed completely:** `wms_security_audit_report.md`, `wms_security_remediation_plan.md`, `wms_security_remediation_report.md`, `wms_security_regression_report.md`, and `wms_security_closure_report.md`.

## Executive assessment

The earlier rejection correctly assessed an unprovisioned public/network production target. It is not the correct result for the actual single-PC scope. Public TLS, public WSS, a public reverse proxy, external secret management, production image assembly, external malware scanning, off-site encrypted database backups, and centralized monitoring are not localhost acceptance prerequisites.

Application-level controls remain mandatory and passed reassessment. The development Compose ports were the one confirmed localhost-scope issue: they were published on every host interface. They are now explicitly bound to `127.0.0.1`. The stack was recreated without resetting its database or volumes; frontend, backend, PostgreSQL, migrations, authenticated workflow races, negative security paths, and browser tests passed afterward.

No confirmed blocking vulnerability remains reachable within the declared localhost academic scope. The accepted limitations below do not imply readiness for LAN, institutional, cloud, port-network, or public deployment.

## Environment and actual listening exposure

| Component | Local address | Docker path | Verified state |
|---|---|---|---|
| Frontend | `http://localhost:3000` | Host `127.0.0.1:3000` → frontend `3000/tcp` | HTTP 200; Vite development UI loaded |
| Express API | `http://localhost:5000` | Host `127.0.0.1:5000` → backend `5000/tcp` | Health 200; PostgreSQL connected |
| Socket.IO | `http://localhost:5000/socket.io` | Shares loopback-only backend publication | Invalid session handshake rejected |
| PostgreSQL | `127.0.0.1:5433` | Host `127.0.0.1:5433` → postgres `5432/tcp` | Container healthy; local test/database connections passed |

`docker compose ps`, Docker port inspection, and host `netstat` all showed only `127.0.0.1` listeners for 3000, 5000, and 5433. Requests to `192.168.150.38:5000` and `192.168.56.1:5000` were refused. Container-internal listeners and the frontend's Docker-network address remain necessary only for service-to-service traffic and are not host/LAN publications.

The running services were:

- `fumba-frontend`: healthy process and HTTP 200.
- `fumba-backend`: successful database connectivity, schema initialization, migrations through `031_security_hardening.sql`, and successful startup.
- `fumba-postgres`: PostgreSQL 17, healthy, persistent existing volume retained.

The backend readiness log reports missing active Finance tariff configuration. This is a business-configuration readiness condition, not a security bypass; Finance charging fails closed until configured.

## Localhost-relevant security results

### Authentication, passwords, and sessions

- Protected API requests without authentication returned 401.
- A malformed bearer token returned 401 without technical or secret detail.
- Passwords remain bcrypt-hashed at cost 12; no plaintext-password storage or response path was found.
- Access JWTs remain purpose-bound to an active server-side session. Expiry, revocation, logout, disabled-account rejection, password-change invalidation, and security-sensitive role/status invalidation passed the regression suite.
- Refresh credentials remain random, hashed in PostgreSQL, rotating, replay-protected, HttpOnly, Strict SameSite, and restricted to the authentication path.
- Frontend access tokens remain in module memory rather than persistent browser storage.

### Server-side authorization and record scope

- The backend permission registry remains fail-closed for unknown protected routes.
- RBAC is evaluated from the current database role/permissions rather than frontend visibility or stale token role labels.
- Warehouse Staff ownership, other-owner cargo denial, warehouse isolation, notification visibility, scanner-to-staff relationship, and supervisor/administrator scope passed.
- Management remains read-only; Scanner permissions remain separate from portal administration; ordinary users cannot promote themselves.
- Maximum-administrator capacity, critical self-lockout protection, and last/required-administrator safeguards remain enforced.

### WMS workflow authority

- **Cargo:** ownership, warehouse scope, supervisor decisions, registration state, and protected field allowlists remain server-controlled.
- **Placement:** cargo/bin eligibility, capacity, configured active rules, warehouse/ownership scope, supervisor approval, scanner authorization, row locking, and relocation rules passed.
- **Finance:** tariffs, charge dates, accrued charges, invoice totals, duplicate periods, payment recording, and payment confirmation remain backend-derived and transactionally serialized.
- **Customs:** only explicit permissions can approve, reject, or hold cargo; conflicting actions serialize and cannot mutate Finance/Gate state improperly.
- **Dispatch/Gate:** direct state fabrication is unavailable; payment, Customs, dispatch, and Gate prerequisites remain server-owned. Double release and injected rollback tests passed.
- **Scanner:** typed identity, active scanner account, linked staff, persistent session revalidation, warehouse scope, expiry/cancellation, two-step workflow, row locking, relocation authorization, and duplicate scan receipts passed.

### Input, injection, XSS, uploads, and response safety

- SQL uses parameter binding and fixed server allowlists for dynamic identifiers. A live SQL-injection-style username returned the generic 401 result and caused no SQL error or authentication bypass.
- Prototype/constructor pollution was rejected with 400 `INPUT_PROPERTY_PROHIBITED`.
- Global request-shape bounds and domain validators remain active; protected workflow fields are allowlisted or backend-derived.
- React escapes ordinary user-controlled content. Reviewed raw sinks remain developer/static-data driven, and API CSP/frame/MIME protections remain enabled.
- Upload checks enforce authorization, size, canonical base64, normalized filename length, allowed MIME types, PDF/JPEG/PNG signatures, DOCX container structure, random private storage, exclusive creation, and path containment.
- Spoofed signatures, malformed base64, and excessive filenames are rejected by regression tests.
- Password/token hashes, refresh material, filesystem paths, and known secret fields are recursively removed from JSON responses.

### Headers, CORS, throttling, audit, and scanner transport

- Live API headers included CSP, `nosniff`, `DENY` framing, no-referrer, Permissions-Policy, and no `X-Powered-By` disclosure.
- Unauthorized Origin returned 403 `CORS_ORIGIN_DENIED`.
- Shared PostgreSQL-backed login throttling returned 429 and `Retry-After: 120`; refresh, bootstrap, expensive routes, Socket.IO connections, and events retain endpoint-specific quotas.
- Invalid Socket.IO authentication was rejected with “A valid signed-in session is required.”
- Ordinary users have no audit update/delete route. Audit actors and timestamps are server-derived; audit/archive/configuration permissions and history preservation passed.

## Live negative-test evidence

| Scenario | Result |
|---|---|
| Unauthenticated protected API | 401 |
| Invalid bearer token | 401 |
| Wrong role / unauthorized workflow | Rejected by permission and workflow regression cases |
| Other staff member's cargo/activity | Rejected by ownership and scope regression cases |
| Protected-field tampering | Rejected by allowlist/workflow-authority cases |
| SQL-injection-style login value | Generic 401; no bypass or database error |
| Prototype pollution | 400 `INPUT_PROPERTY_PROHIBITED` |
| Invalid upload signature | Rejected |
| Malformed base64 | Rejected |
| Excessive filename | Rejected |
| Repeated invalid login | 429 with 120-second retry window |
| Unauthorized Socket.IO handshake | Rejected |
| Sensitive response fields | Removed recursively |
| Unauthorized Origin | 403 |

Disposable authenticated workflow fixtures were created and cleaned by the existing regression suite. No database reset, volume removal, Git reset, or destructive schema action was performed.

## Dependency verification

| Dependency set | Critical | High | Moderate | Low | Assessment |
|---|---:|---:|---:|---:|---|
| Backend complete tree | 0 | 0 | 0 | 0 | PASS |
| Frontend complete tree | 0 | 1 | 3 | 0 | ACCEPTED LOCAL LIMITATION |
| Frontend production dependencies (`--omit=dev`) | 0 | 0 | 2 | 0 | PASS WITH MODERATE DEBT |

The frontend aggregate High is assigned to Vite's development-server advisory group. The High Windows alternate-path issue is not applicable to this runtime because Vite executes inside a Linux container; the service is additionally published only on host loopback. Remaining Vite/esbuild items concern the local development server and are not shipped in the static production runtime design. They are acceptable for this controlled single-PC academic environment but must not be exposed to an untrusted network.

The two production dependency findings are React Router Moderate advisories requiring a major v7 migration. The WMS is a client-only SPA without SSR hydration/deserialization, and reviewed navigation does not accept arbitrary external destinations. No applicable Critical/High production dependency finding remains.

## Regression results

| Suite | Passed | Failed | Skipped | Result |
|---|---:|---:|---:|---|
| Full backend, including live database and authenticated concurrency/workflow closure | 227 | 0 | 0 | PASS |
| Full frontend Vitest | 44 | 0 | 0 | PASS |
| Frontend production build | 1 | 0 | 0 | PASS |
| Development Compose parse/start/migrations/service health | 1 | 0 | 0 | PASS |

There were no skipped tests. The earlier separately skipped concurrency test now ran within the full backend command; its eleven named subtests and parent test are included in the Node test runner's 227 count. It covered capacity competition, double placement, relocation, duplicate invoice, double payment confirmation, Customs conflict and normal action, Dispatch conflict, double/single Gate release, and transactional rollback.

## Reclassification of previous deployment blockers

| Previous requirement | Previous status | Localhost applicability | Local verification | Final classification |
|---|---|---|---|---|
| Public TLS certificate | Blocker | Not required | Host services restricted to loopback | N/A — LOCALHOST DEPLOYMENT |
| HTTPS | Not verified | Local HTTP accepted on one PC | API/frontend reachable only on `127.0.0.1` | N/A locally; FUTURE PRODUCTION REQUIREMENT |
| Public WSS | Not verified | Not required | Local Socket.IO authentication/session tests passed | PASS locally; FUTURE PRODUCTION REQUIREMENT |
| Production reverse proxy | Not verified | Not required | Direct loopback services work; hardened config preserved | N/A — LOCALHOST DEPLOYMENT |
| Strong external secret store | Pending | Not required | Local env files ignored/untracked; bundle scan clean | PASS |
| DB credential rotation | Pending | Conditional | No Git exposure found; local-only DB | RECOMMENDED |
| Restricted production DB identity | Pending | Defense-in-depth | DB loopback-only; parameterization/RBAC passed; production grant path preserved | RECOMMENDED |
| Malware scanner | Missing | Not required | Byte/MIME/name/size/storage/authorization controls passed | ACCEPTED LOCALHOST LIMITATION |
| Off-site encrypted backup | Not verified | Not required | Configuration backup/restore remains permissioned and audited | FUTURE PRODUCTION REQUIREMENT |
| Production Docker image | Not verified | Not required | Actual development stack, migrations, connectivity and functions passed | FUTURE DEPLOYMENT VERIFICATION |
| Application RBAC | PASS | Required | Full authorization and workflow regression | PASS |
| SQL parameterization | PASS | Required | Review, regression, and safe live injection-style input | PASS |
| Session security | PASS | Required | Full session/auth regression and live rejection | PASS |
| Upload validation | Partial | Required | Signature/base64/name and existing containment controls passed | PASS for localhost |
| Scanner authorization | PASS | Required | Session/policy/duplicate/live unauthorized handshake tests | PASS |

## Final acceptance matrix

| Control | Local status | Basis |
|---|---|---|
| Loopback-only service exposure | PASS | All published ports bound to `127.0.0.1`; LAN address requests refused |
| Authentication | PASS | Live 401s and regression |
| Server-side RBAC | PASS | Fail-closed route registry and full permission tests |
| Password hashing | PASS | bcrypt cost 12 and protected flows |
| Session validation/revocation | PASS | Active-session checks, rotation/replay, logout and account-change invalidation |
| Record-level authorization | PASS | Ownership and warehouse-scope tests |
| SQL injection protection | PASS | Parameter binding/allowlists; live injection-style input safe |
| Input validation / prototype defense | PASS | Live 400 plus boundary tests |
| Field-tampering prevention | PASS | Explicit DTOs/allowlists and server workflow authority |
| XSS and browser headers | PASS | React escaping review, CSP, frame/MIME/referrer protections |
| Cargo/placement security | PASS | Ownership, approval, capacity, eligibility, locks and scanner authority |
| Finance authority | PASS | Server calculation, duplicate/race and payment-state tests |
| Customs authority | PASS | Explicit permissions and conflict tests |
| Dispatch/Gate authority | PASS | Prerequisite policy, double-release and rollback tests |
| Scanner/Socket.IO security | PASS | Typed account/session/scope/duplicate controls and live rejection |
| Administrator safeguards | PASS | Capacity, self-lockout, role boundaries and revocation |
| Upload protection | PASS | Local threat-model requirements verified |
| Response minimization | PASS | Sensitive keys and paths excluded |
| Rate limiting | PASS | Shared limits and live temporary 429 |
| Audit integrity for ordinary users | PASS | No mutation API; server actors/timestamps and audit regression |
| Local secret handling | PASS | Env files ignored/untracked; no frontend bundle markers |
| Applicable Critical/High runtime dependencies | PASS | Backend clean; production frontend has none; dev High not applicable to Linux/loopback boundary |
| Public TLS/WSS/reverse proxy | N/A | Outside localhost scope |
| External AV/SIEM/off-site backup | N/A | Future operational/production controls |
| Production image assembly | N/A | Actual localhost development stack verified |

## Remaining local risks and documented limitations

1. The local Vite development server and its development dependency tree must remain loopback-only. Do not use the development Compose file on a LAN or public interface.
2. React Router has Moderate advisories requiring a planned, tested major upgrade. Current client-only navigation and absence of SSR reduce applicability; arbitrary external destinations must not be introduced.
3. Local `.env` secrets are readable to anyone who compromises or shares the developer's Windows account. The PC should retain a login password, screen lock, current OS/browser/Docker updates, and restricted project-folder access.
4. Uploaded documents are signature-validated but not antivirus-scanned. Only trusted academic/demo documents should be used locally.
5. The local development backend retains the PostgreSQL owner identity. Loopback restriction, parameterized SQL, backend-only credentials, and no untrusted database clients make this non-blocking here; it is unacceptable for network production.
6. Finance is fail-closed until an administrator configures a valid active tariff. Demonstrations needing Finance should complete that functional configuration first.

## Future deployment security requirements

Before any LAN, university-server, cloud, port-network, multi-PC, or public deployment, repeat the threat assessment and require: HTTPS/TLS and WSS; exact deployed-origin testing; a hardened static frontend/runtime image; non-development process execution; strong rotated secrets; separate migration owner and restricted runtime DB role; no public PostgreSQL exposure; malware scanning/quarantine; encrypted and restore-tested database backups; centralized logging/monitoring; incident-response procedures; dependency major upgrades; and host/network firewall validation.

Localhost acceptance does not assert public or production readiness.

## Readiness declaration

- **Local development/testing:** READY
- **Local university demonstration:** READY
- **Localhost UAT:** READY
- **Network/public production deployment:** NOT READY

LOCAL SECURITY UAT ACCEPTED WITH DOCUMENTED LIMITATIONS

# Fumba Port WMS Security Closure Report

**Date:** 2026-08-15

## Closure matrix

| Finding | Original severity | Original status | Remediation | Verification | Final status |
|---|---|---|---|---|---|
| F-01 | High | FAIL | Static unprivileged frontend runtime; compatible dependency fixes | 44 tests, local production build, bundle scan, Compose parse; Docker image assembly not verified due stalled package retrieval | CLOSED by design/code; target image build remains a deployment gate |
| F-02 | High | FAIL | TLS/WSS edge and production separation | Config/static validation only; no target cert | PARTIALLY CLOSED |
| F-03 | High | FAIL/PARTIAL | Separate migrator/runtime role, internal DB, minimum secret strength | Config/static grant validation; target role not deployed | PARTIALLY CLOSED |
| F-04 | High | FAIL | Parser 4.2.7 server/client | Audit, scanner tests, unauthorized handshake | CLOSED |
| F-05 | Medium | FAIL | CSP/HSTS/nosniff/frame/referrer/permissions headers | Live header and CORS tests | CLOSED |
| F-06 | Medium | PARTIAL | PostgreSQL-backed combined-key limits and endpoint/socket quotas | Unit plus live 429/Retry-After | CLOSED |
| F-07 | Medium | PARTIAL | Strict bytes/base64/name checks and DTO | Negative unit tests; full regression | PARTIALLY CLOSED (external AV absent) |
| F-08 | Medium | PARTIAL | Secret files, fail-closed production vars, bundle scan | Config/build validation; target rotation pending | PARTIALLY CLOSED |
| F-09 | Low | PARTIAL | In-memory access token plus refresh restoration | Frontend token/API tests | CLOSED |
| F-10 | Low | PARTIAL | Global shape/prototype/query bounds and selected field limits | Negative/unit/full regression | PARTIALLY CLOSED |
| F-11 | Informational | PARTIAL | Runtime audit mutation revocation model | Static grant test; live target denial pending | ACCEPTED DEPLOYMENT REQUIREMENT |

## Final security-control matrix

| Control | Original | Final | Change |
|---|---|---|---|
| Secret protection | PARTIAL | PARTIAL | Secret-file production path added; real rotation/ACL pending |
| Git secret exposure | PASS | PASS | No regression; secrets directory ignored and bundle clean |
| Sensitive-data encryption | PARTIAL | PARTIAL | TLS path configured; target TLS/backup encryption unverified |
| Server authentication/authorization | PASS | PASS | Full RBAC/session regression passed |
| Record-level access | PARTIAL | PASS | Full regression plus live authenticated workflow races passed |
| Field tampering | PASS | PASS | Allowlists/workflow authority retained |
| Sessions/cookies | PASS | PASS | Refresh/session model retained; access token moved to memory |
| Password hashing | PASS | PASS | bcrypt cost and flows unchanged |
| Login rate limiting | PARTIAL | PASS | Shared DB-backed IP/account limits verified |
| Automated abuse | PARTIAL | PASS | Auth, socket, report, backup and document quotas added |
| SQL parameterization | PASS | PASS | No regression; new limiter uses parameters |
| Input validation | PARTIAL | PARTIAL | Material improvement; legacy route schemas remain incremental |
| XSS/escaping | PASS | PASS | CSP added; frontend suite/build passed |
| File uploads | PARTIAL | PARTIAL | Byte validation closed spoofing; malware service absent |
| API responses | PARTIAL | PASS | Sensitive keys/path filtered and upload DTO added |
| HTTP headers | FAIL | PASS | Live headers verified |
| HTTPS/TLS | FAIL | NOT VERIFIED | Complete deployment path exists; real target TLS not launched |
| Dependencies | FAIL | PASS for applicable runtime | Backend clean; parser fixed; production excludes dev server; Moderate router debt documented |

No regression was identified in authentication, RBAC, warehouse/cargo scope, session revocation, password hashing, SQL parameterization, finance, Customs, Gate, placement, scanner, notifications, administrator safeguards or audit creation.

## Unresolved risk and deployment requirements

1. Provision a controlled UAT hostname, trusted certificate and separate strong owner/runtime/JWT secrets; launch `docker-compose.production.yml` rather than development Compose.
2. Run the grant script through the migrator and prove the runtime role is non-superuser, cannot create roles/databases, and cannot update/delete/truncate audit history; verify the old password fails.
3. Repeat HTTPS redirect/HSTS, Secure refresh cookie, exact-origin CORS and WSS upgrade/polling/reconnect/camera tests remotely.
4. Provide a real malware scanner/quarantine service or formally accept and compensate the document risk for UAT.
5. Establish encrypted off-host PostgreSQL backup, retention, access controls and a restore drill. This is **NOT VERIFIED / DEPLOYMENT REQUIREMENT**.
6. Plan a tested React Router v7/Vite major migration. The remaining advisories are not present as an applicable High production runtime service in the supplied production design.

## Acceptance assessment

The code and production deployment design remediate the confirmed reachable dependency, header, abuse, upload-spoofing, token-storage and response-exposure weaknesses. Application regression evidence is sufficient for continued isolated development.

Controlled UAT cannot yet be accepted because the two original High deployment boundaries—real HTTPS/WSS and a live rotated least-privilege database identity—exist as configuration but were not provisioned or verified with target certificates/secrets. This is not a severity downgrade: the current running development stack remains HTTP and owner-credential based and must not be used as UAT.

- **Development/testing:** READY (isolated network and non-production data only)
- **Controlled UAT:** NOT READY until requirements 1–3 are completed and evidenced
- **Production:** NOT READY; additionally requires requirements 4–6 and backup/operational controls

SECURITY UAT REJECTED

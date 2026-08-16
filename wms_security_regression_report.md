# Fumba Port WMS Security Regression Report

**Date:** 2026-08-15

## Test summary

| Suite | Passed | Failed | Skipped | Result |
|---|---:|---:|---:|---|
| Full backend (`node --test tests/*.test.js`) | 215 | 0 | 1 | PASS |
| Live authenticated concurrency/workflow closure | 12 | 0 | 0 | PASS |
| Full frontend Vitest | 44 | 0 | 0 | PASS |
| Focused frontend token/notification/API rerun | 20 | 0 | 0 | PASS |
| Production frontend build | 1 | 0 | 0 | PASS |
| Production Compose parse | 1 | 0 | 0 | PASS |
| Production container image assembly | 0 | 0 | 2 | NOT VERIFIED — both bounded builds stalled during package retrieval after pinned base-image download; local production build and Compose validation remain PASS |
| Backend dependency audit | 0 vulnerabilities | — | — | PASS |
| Frontend dependency audit | 0 Critical, 1 High, 3 Moderate | — | — | CONDITIONAL |

The one aggregate backend skip was `final validation closure executes real authenticated HTTP races and Gate rollback`, because the aggregate runner treats it as a separately provisioned live test. It was run immediately afterward against the Docker-backed development database/API and passed all 12 subtests. There are therefore no unresolved skipped security scenarios from that suite.

## Live negative tests

| Test | Result |
|---|---|
| Unauthenticated protected API | 401 |
| Invalid bearer token | 401 |
| Unauthorized Origin | 403 `CORS_ORIGIN_DENIED` |
| Approved development Origin | 200 with exact ACAO |
| Prototype/constructor pollution payload | 400 `INPUT_PROPERTY_PROHIBITED` |
| Repeated invalid login | First three 401; fourth 429; Retry-After 120 |
| Unauthorized Socket.IO token | Handshake rejected |
| Spoofed file signature | 400 `UPLOAD_SIGNATURE_MISMATCH` (unit/controller boundary) |
| Malformed base64 | 400 `UPLOAD_BASE64_INVALID` (unit/controller boundary) |
| Excessive filename | 400 `UPLOAD_FILENAME_INVALID` (unit/controller boundary) |
| Response password/token/file path fields | Removed recursively |

Oversized live upload and authenticated unauthorized document download were not sent to legitimate records. Size/path/ownership behavior remains covered in code and existing fixture tests; final UAT should repeat them with dedicated documents in its disposable matrix.

## Authorization and IDOR/BOLA evidence

- Unknown protected routes fail closed through the method/path authorization registry.
- Unauthenticated access and invalid tokens fail 401.
- Warehouse staff ownership tests deny validation/confirmation of another staff member's cargo.
- Placement activity tests hide another staff member's activity and other-warehouse activity while permitting supervisor warehouse scope and administrator global scope.
- Regression phases verify warehouse hierarchy isolation, task transfer protection, RBAC mutation restrictions and audit preservation.
- Notification tests bind recipients by user, role and warehouse and exclude inactive users/scanners where required.
- Customs, Finance, Gate and Management routes remain explicit-permission isolated; Management stays read-only.
- Scanner tests retain typed identities, persistent session revalidation, expiry, cancellation, row locks and duplicate receipts.
- Intentional global access: Customs and Finance operational roles operate across warehouses where their permission policy is global; Management has global read-only reports; System Administrator scope is explicit rather than wildcard.

## Workflow regression

- **Cargo:** registration validation, supervisor approval/resubmission, protected fields and ownership passed.
- **Placement:** recommendations, capacity/rules, supervisor requirement, scan/manual validation, placement and relocation passed.
- **Customs:** trusted state transitions, concurrent conflict handling and role isolation passed.
- **Finance:** authoritative tariff calculators, invoice duplication race, payment confirmation race and tariff-gap fail-closed behavior passed.
- **Dispatch/Gate:** approve/reject race, double release serialization, normal release and injected transactional rollback passed.
- **Scanner:** authentication rejection, policies, session expiry/cancellation/recovery logic and duplicate scan behavior passed.
- **Administration:** permission source of truth, administrator safeguards, configuration validation, audit and notification policy tests passed.

## Administrator and integrity regression

Maximum administrator capacity remains fail-closed; critical self-permission removal is blocked; Scanner permissions remain outside portal RBAC; Management cannot receive mutation permissions; password/status/role changes retain session invalidation paths. No security mechanism that originally passed was removed.

## Dependency reachability

- **Backend:** 0 Critical / 0 High / 0 Moderate / 0 Low after compatible lock update. Server parser is 4.2.7.
- **Frontend:** 0 Critical / 1 High / 3 Moderate / 0 Low.
  - The High Vite issue is development-server-only. Production uses Vite during the isolated build stage and serves only static files from unprivileged Nginx; Vite/esbuild are absent at runtime.
  - React Router Moderate advisories require a tested major v7 migration. The application is a client SPA (no SSR hydration/deserialization), and reviewed navigation does not accept arbitrary external destinations. This is documented non-blocking technical debt, not an applicable High runtime blocker.

## Deployment verification not completed

The production Compose model parsed, but real certificate/secret files were deliberately not invented. The two production image builds downloaded their pinned base layers and then stalled without progress during `npm ci`; they were stopped after bounded observation, so image assembly is not claimed as verified. The equivalent frontend production build passed locally. End-to-end HTTPS/WSS, Secure cookie, live restricted DB grants, credential rotation/old-password rejection, malware scanner, off-host encrypted database backup and restore drill remain target-environment checks.

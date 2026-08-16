# Management Release Implementation Report

## Architecture

Management Release is an independent, backend-authoritative financial classification attached to cargo. Supervisor registration approval remains the sole Management-independent placement prerequisite. A revisioned `management_release_requests` table preserves every submission and decision while trusted cargo columns expose the current state to Finance and Gate.

States are `NOT_REQUIRED`, `PENDING`, `APPROVED`, and `REJECTED`; release types are `NORMAL` and `MANAGEMENT`. Supervisor submission, Management decision, invoice reconciliation, notifications, cargo state, and audit writes share database transactions and row locks.

## Schema and migration

Migration `20260816_management_release_workflow.sql` adds current release state, actor/timestamp/reason fields, submission count, waived amount, and Finance-review flag to cargo. Existing cargo defaults to Normal Release / `NOT_REQUIRED`. It creates immutable request history with one-pending-request enforcement, queue indexes, explicit RBAC permissions, and Management Gate release classification.

Both fresh initialization and incremental migration runners apply migration 032.

## Backend changes

- Supervisor approval accepts `release_type` and an optional/required Management reason in the existing approval transaction.
- Rejected requests can be converted to Normal Release or revised and resubmitted only by authorized Supervisor users.
- Management has read-only queue/detail endpoints plus narrowly scoped approve/reject mutations.
- Decisions lock both cargo and the pending request. Stale or competing decisions fail with conflict status.
- Placement code was deliberately unchanged and contains no Management Release prerequisite.
- Approval stops accrual using the server decision timestamp without modifying registration or charge-start timestamps.

## Finance treatment

Approved Management Release cargo returns a tariff-independent zero payable snapshot with explicit `WAIVED_BY_MANAGEMENT_RELEASE` treatment. Historical/waived value is retained separately. Draft and issued unpaid invoices are cancelled with reason `Management Release Approved`; confirmed/partial payment history remains intact and sets `management_release_finance_review_required` for manual adjustment/refund review. No refund workflow was fabricated.

Draft generation and invoice issuance re-lock/revalidate cargo and reject approved Management Release cargo with `MANAGEMENT_RELEASE_NO_CHARGES`. Pending and rejected requests continue normal charging.

## Gate and other release controls

Gate displays `MANAGEMENT RELEASE` and `No Charges / Waived`. Central release eligibility sees zero warehouse balance only for `APPROVED`; `PENDING`, `REJECTED`, and `NOT_REQUIRED` retain normal Finance behavior. Customs, Supervisor approval, dispatch authorization, release state, Gate authorization, scanner, and placement checks remain enforced. Final Management release Gate-Out has a distinct audit action.

## Frontend changes

- The existing Supervisor approval modal now includes Release Type and conditional Management reason.
- Management has a filterable Pending/Approved/Rejected/All queue with approve/reject actions.
- Executive reports include release classification, cargo count, and waived amount.
- Finance and Gate APIs expose consistent classification and charge-treatment fields for their existing tables/details.

## Permissions, notifications, and audit

Permissions: `management_release.request`, `management_release.view`, and `management_release.decide`. Management retains read-only access outside its explicit decision permission. Supervisor, Finance, Gate, Staff, and Administrator grants follow existing permission-based middleware.

Notifications are sent to Management on submission, the requesting Supervisor on decision, and Finance on approval. Audit records include server-derived actor/time, cargo/request references, before/after state, reason, submission number, historical accrued amount, waived amount, and Finance-review status.

## Files modified or added

- `backend/database/migrations/20260816_management_release_workflow.sql`
- `backend/database/initDb.js`, `backend/database/updateSchema.js`
- `backend/services/managementReleaseService.js`, `backend/services/financeService.js`
- `backend/controllers/supervisorController.js`, `backend/controllers/managementController.js`, `backend/controllers/gateController.js`, `backend/controllers/permissionController.js`
- `backend/routes/supervisorRoutes.js`, `backend/routes/managementRoutes.js`
- `backend/config/authorizationRegistry.js`
- `frontend/src/components/wms/ReviewActionModal.jsx`
- `frontend/src/pages/ManagementPortal.jsx`, `frontend/src/services/api.js`
- `backend/tests/managementReleaseWorkflow.test.js`, `backend/tests/managementReleaseLiveUat.test.js`

## Tests and results

- New workflow authority tests: 10/10 passed.
- Docker live Management Release UAT: 1/1 passed, rollback-safe.
- Frontend: 44/44 passed.
- Frontend production build: passed.
- Docker backend: 236/237 passed in the first complete run. All database, workflow, security, placement, Finance, Customs, dispatch, Gate, scanner, and 11 live concurrency subtests passed. The sole failure is an existing container-only test path assumption looking for `/docker-compose.production.yml`; the same security test passes from the host workspace.
- Host backend: 205 passed, 7 database-dependent tests skipped, and one live test failed only because hostname `postgres` is unavailable outside Docker. The corresponding live concurrency test passed inside Docker.

## Known limitations

- Paid or partially paid invoices are preserved and flagged for Finance review; there is no automatic refund because the WMS has no trusted refund workflow.
- The Management queue uses the existing compact interaction style for remarks. A richer details drawer can be added later without changing workflow authority.
- The pre-existing container path assumption in `securityHardening.test.js` is unrelated to Management Release and was not redesigned.

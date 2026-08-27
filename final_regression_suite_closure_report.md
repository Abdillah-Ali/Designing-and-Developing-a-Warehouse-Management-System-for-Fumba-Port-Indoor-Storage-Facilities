# Final Regression Suite Closure Report

Date: 2026-08-26

## Scope

This closure inspected only the two reported regression fixtures. Reports & Analytics production code was not changed.

## Original failures and remediation

### `finalConcurrencyValidation.test.js`

- Original symptom: login returned `401 Invalid username or password`.
- Root cause: the live test inserted fixture users through the host's configured database connection while sending login requests to the Docker API. The host default connection can be a different PostgreSQL instance from Docker's published port `5433`, so the API could not see the fixture user.
- Fixture changes: the test now owns a PostgreSQL pool configured for the Docker validation database (with `FPWMS_VALIDATION_DB_*` overrides) and creates a random password per run. The password is bcrypt-hashed into each fixture user and the test authenticates normally through `/auth/login`.
- Isolation: the test retains its `finally` cleanup for test data and closes its owned pool with `test.after`.

The authentication assertion now succeeds against the Docker API. Continuing the real HTTP race uncovered a separate production defect, so this test cannot be marked passing.

**Production defect discovered — no change made in this closure**

- Expected behavior: authenticated Finance requests used by the concurrency scenario can draft and issue invoices at `POST /api/finance/invoices/draft` and `POST /api/finance/invoices/:invoiceNumber/issue`.
- Actual behavior: both endpoints return `404 Route not found`.
- Evidence: `backend/routes/financeRoutes.js` registers invoice read routes only, while `backend/controllers/financeController.js` already exports the issue handler and the frontend API client calls both endpoints.
- Affected code: `backend/routes/financeRoutes.js`; affected test: `backend/tests/finalConcurrencyValidation.test.js` (C03, then C04/C07/Gate scenarios).
- Proposed correction: register the existing draft, issue, and cancel invoice controller handlers with their authoritative permissions, then rerun the concurrency test. This is a production Finance routing change and is deliberately outside this fixture-only closure.

### `phase11bArchitectureClosure.test.js`

- Original symptom: `409 Tariff versions must not overlap for the same cargo type and charging unit`.
- Root cause: deactivating tariffs did not make their historical date ranges irrelevant; the authoritative overlap rule correctly checks all tariff versions.
- Fixture changes: inside its existing transaction, the test closes historical Default tariff periods at a temporary current boundary and moves open cargo charge origins into that temporary coverage period before creating its one active Default fixture tariff. The transaction is rolled back in all cases.
- Production behavior: unchanged. The actual overlap guard remains intact and genuine overlaps are still rejected.

## Verification

- `phase11bArchitectureClosure.test.js`, run 1: 9 passed, 0 failed.
- `phase11bArchitectureClosure.test.js`, run 2: 9 passed, 0 failed.
- Reporting backend tests: 12 passed, 0 failed.
- Frontend full suite: 58 passed, 0 failed.
- Frontend production build: passed.
- Docker: PostgreSQL healthy; backend and frontend running.

The complete backend suite was not run because its required prerequisite—both repaired individual regression tests passing—was not met. The remaining blocker is the documented Finance routing defect, not a suppressed test failure.

## Final acceptance matrix

| Check | Result | Reason when not passing |
| --- | --- | --- |
| `finalConcurrencyValidation.test.js` | FAIL | Fixture authentication is fixed; the real HTTP workflow then receives 404 for unregistered Finance invoice routes. |
| `phase11bArchitectureClosure.test.js` | PASS | Transactional fixture is isolated and repeatable. |
| Repeated Fixture Run | PARTIAL | Phase 11B passed twice; concurrency remains blocked by the documented routing defect. |
| Reporting Backend Tests | PASS | 12/12 passed. |
| Full Backend Regression Suite | NOT RUN | Blocked pending the above production routing decision. |
| Frontend Full Suite | PASS | 58/58 passed. |
| Frontend Production Build | PASS | Build completed successfully. |
| Docker/PostgreSQL Health | PASS | PostgreSQL healthy; backend and frontend running. |
| Authentication Integrity | PASS | Fixture-created credentials authenticate normally through the Docker API. |
| Tariff Overlap Protection | PASS | Production guard was unchanged; the fixture adapts within a rollback transaction. |
| Reports & Analytics Regression | PASS | Focused backend report tests passed; frontend suite and production build passed. |

## Remaining warnings/issues

- The frontend test run emits React Router v7 future-flag warnings only.
- Full Regression Tests must remain **FAIL** until the Finance invoice routing defect is explicitly corrected and the complete backend suite terminates green.

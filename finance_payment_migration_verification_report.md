# Finance, Tariff Approval, Automatic Billing & Flutterwave Migration Verification Report

## A. Environment
- **PostgreSQL Version**: 17.10 (`postgres:17` in Docker container `fumba-postgres`)
- **Database Name**: `fumbaport_wms`
- **Docker Container**: `fumba-postgres` (Service: `postgres`)
- **Internal Database Host / Port**: `postgres:5432`
- **External Windows Host / Port**: `127.0.0.1:5433`
- **Container Health**: Healthy

---

## B. schema_migrations Structure
- **Primary Key**: `migration_name` (`VARCHAR(180) PRIMARY KEY`)
- **Columns**:
  - `migration_name` (`VARCHAR(180) NOT NULL PRIMARY KEY`)
  - `checksum` (`VARCHAR(64) NOT NULL`)
  - `applied_at` (`TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`)
  - `execution_status` (`VARCHAR(20) NOT NULL CHECK (execution_status IN ('applied', 'failed'))`)
  - `last_error` (`TEXT`)
  - `updated_at` (`TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`)
- **Explanation of Previous Query Failure**: The query `SELECT * FROM schema_migrations ORDER BY id;` failed with `ERROR: column "id" does not exist` because `schema_migrations` uses `migration_name` as its primary key column rather than an integer `id` column.

---

## C. Migration 035 Status
- **State**: `APPLIED`
- **Migration Identifier**: `035_finance_payment_release_workflow.sql`
- **Source Migration File**: `backend/database/migrations/20260820_finance_payment_release_workflow.sql`
- **Recorded Checksum**: `14719f03051c9ec65e4013a48e96019a3ebbc27685147bdd8da71ae6d49de319`
- **Applied Timestamp**: `2026-08-21 00:53:53.170106`

---

## D. Schema Verification Summary

| Target Table | Verification Status | Notes / Key Additions |
| :--- | :--- | :--- |
| `tariff_versions` | **PASS** | `approval_status`, `submitted_by`, `submitted_at`, `approved_by`, `approved_at`, `rejected_by`, `rejected_at`, `rejection_reason`, `supporting_notes`, `minimum_charge`, `operationally_used_at` verified. |
| `tariff_approval_history` | **PASS** | Table verified with PK `id`, FK `tariff_version_id`, FK `actor_id`, `action` constraint, `snapshot` JSONB, `created_at`. |
| `invoices` | **PASS** | `payment_reference`, `auto_generated` verified. Unique indexes `invoices_payment_reference_unique` and `invoices_one_open_auto_invoice_per_cargo` verified. |
| `payments` | **PASS** | All gateway & payment fields (`cargo_id`, `payment_reference`, `expected_amount`, `amount_received`, `currency`, `gateway_provider`, `gateway_transaction_id`, `gateway_event_id`, `gateway_status`, `payment_method`, `initiated_at`, `verified_at`, `failed_at`, `failure_reason`, `reconciliation_status`, `gateway_response`) verified. |
| `payment_webhook_events` | **PASS** | Idempotency protection table verified with `provider`, `event_id`, `payload_hash`, `payment_id`, `processing_status`, `received_at`, `processed_at`, and `UNIQUE(provider, event_id)`. |
| `cargo` | **PASS** | `release_readiness_status`, `release_readiness_blockers`, `ready_for_release_at`, `release_workflow_version` verified. |
| `permissions` | **PASS** | All 5 new permissions (`finance.tariffs.submit`, `finance.payments.initiate`, `management.tariffs.view`, `management.tariffs.decide`, `staff.release_queue.view`) verified in DB. |
| `role_permissions` | **PASS** | Role assignments verified for Finance Officer, Management, and Warehouse Staff. Manual legacy permissions (`finance.invoices.create`, `finance.invoices.issue`, `finance.payments.confirm`) revoked via corrective migration 036. |

---

## E. Verified Constraints & Indexes

- `tariff_versions_approval_status_check`: `CHECK (approval_status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'))`
- `idx_tariff_versions_approval`: `INDEX ON tariff_versions (approval_status, is_active, effective_from)`
- `tariff_approval_history_action_check`: `CHECK (action IN ('CREATED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ACTIVATED', 'DEACTIVATED'))`
- `invoices_payment_reference_unique`: `UNIQUE INDEX ON invoices (payment_reference) WHERE payment_reference IS NOT NULL`
- `invoices_one_open_auto_invoice_per_cargo`: `UNIQUE INDEX ON invoices (cargo_id) WHERE auto_generated = true AND status <> 'Cancelled'`
- `payments_status_check`: `CHECK (status IN ('Pending Confirmation', 'Confirmed', 'Reversed', 'Gateway Pending', 'Gateway Failed', 'Gateway Exception'))`
- `payments_gateway_event_unique`: `UNIQUE INDEX ON payments (gateway_event_id) WHERE gateway_event_id IS NOT NULL`
- `payments_gateway_transaction_unique`: `UNIQUE INDEX ON payments (gateway_provider, gateway_transaction_id) WHERE gateway_transaction_id IS NOT NULL`
- `payments_public_reference_key`: `UNIQUE CONSTRAINT ON payments (public_reference)`
- `payments_wms_reference_idx`: `INDEX ON payments (payment_reference)`
- `payment_webhook_events_provider_event_id_key`: `UNIQUE CONSTRAINT ON payment_webhook_events (provider, event_id)`

---

## F. Payment Reference Uniqueness
- **Status**: Database-enforced correctly.
- **Details**: Every generated payment reference is globally unique. On `invoices`, it is enforced by `invoices_payment_reference_unique`. On `payments`, payment reference is passed as `public_reference` during creation, which is strictly enforced by `payments_public_reference_key` (`UNIQUE CONSTRAINT`).

---

## G. Database Test Suite Execution

- **Passed**: 281
- **Failed**: 0
- **Skipped**: 1 (`Docker UAT: reject, convert, resubmit, approve, waive, and preserve placement # SKIP No approved UAT cargo fixture is available`)

---

## H. Concurrency Validation Test
- **Status**: **PASSED**
- **Details**: All 11 subtests executed successfully under live PostgreSQL transaction isolation (C01 competing capacity, C02 double placement, relocation, C03 duplicate invoice period, C04 double payment confirmation, C05 Customs conflicting decisions, normal Customs, C06 Dispatch approve vs reject, C07 double Gate release, single Gate release, T01 Gate injected rollback).

---

## I. Modifications & Corrective Actions Made

1. **Discovered Role Permission Seeding Discrepancy & Created Migration 036**:
   - `ensureStandardRolePermissions.js` contained a wildcard `p.permission_key LIKE 'finance.%'` for `finance_officer`, which re-granted legacy manual invoice creation, issuance, and payment confirmation permissions during startup/migration execution, counteracting migration 035's intentional revocation.
   - Created corrective migration file `backend/database/migrations/20260821_revoke_finance_legacy_manual_permissions.sql` (migration `036_revoke_finance_legacy_manual_permissions.sql`) to revoke `finance.invoices.create`, `finance.invoices.issue`, and `finance.payments.confirm` from `Finance Officer`.
   - Registered migration 036 in `backend/database/updateSchema.js` and `backend/database/initDb.js`.
   - Updated `backend/database/ensureRolePermissions.js` to exclude those 3 manual permissions from `finance_officer` standard seeding.
   - Applied migration 036 using `npm run migrate` in Docker. Verified `role_permissions` in PostgreSQL.

2. **Fixed SQL Parameter Placeholder Typo in `financeService.js`**:
   - In `createTariffVersion`, parameter `$15` (`data.isActive`) was omitted in the SQL `VALUES` clause (`FALSE` was hardcoded), causing PostgreSQL error `could not determine data type of parameter $15`. Restored `$15` in the `VALUES` clause.

3. **Updated Test Fixtures**:
   - Updated `backend/tests/finalConcurrencyValidation.test.js` to create and assign an active 24h operational shift to test staff users (`OPERATIONAL_SHIFT_REQUIRED` policy) and to authenticate manual invoice test fixture creation with the `system_administrator` role.
   - Updated `backend/tests/securityHardening.test.js` and `backend/tests/workflowGapRemediation.test.js` to resolve repository root configuration files (`docker-compose.production.yml` and `README.md`) safely when running inside isolated Docker volume mounts.

---

## J. Remaining Issues
None.

---

## K. Final Migration Verdict

**MIGRATION VERIFIED AND ACCEPTED**

---

### Verification Answer

Is the live PostgreSQL database now correctly migrated and ready for the Flutterwave Sandbox end-to-end payment test?

**YES**

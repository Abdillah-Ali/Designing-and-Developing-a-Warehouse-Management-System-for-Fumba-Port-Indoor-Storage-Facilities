# Management Release UAT Report

Environment: running Docker PostgreSQL 17, backend, and frontend. Migration 032 applied successfully. The Management workflow test uses existing approved UAT cargo, real role records, real services and database constraints, and rolls the transaction back after verification.

## Scenario A — Normal Release

Expected: Supervisor approval permits placement; normal charging, Finance, dispatch, Customs, and Gate rules remain active.

Actual: Existing Normal Release regression, placement, Finance, Customs, dispatch, Gate, and 11 live concurrency scenarios passed. Existing cargo migrated/defaulted to `NOT_REQUIRED`; no Management prerequisite exists in placement.

Result: PASS

## Scenario B — Management Release Approved Before Placement

Expected: Management can approve an unplaced, Supervisor-approved cargo; payable warehouse balance is zero; later placement remains eligible.

Actual: Live UAT selected approved/unplaced cargo, submitted and approved the request, returned zero payable balance, rejected invoice creation, and preserved `Unplaced` unchanged. Automated placement authority tests confirm only Supervisor approval and existing physical rules govern eligibility.

Result: PASS

## Scenario C — Placement Before Management Decision

Expected: Pending review does not block or invalidate placement; later approval waives accrued charges.

Actual: Live UAT verified placement state was identical during Pending and after Approved. Source-authority tests verify placement has no Management state dependency. Approval stopped charge accrual and produced tariff-independent zero payable treatment.

Result: PASS

## Scenario D — Management Rejection

Expected: Rejection notifies Supervisor, preserves placement/approval, and permits conversion to Normal Release using the original charging basis.

Actual: Live UAT rejected a pending request, converted it to `NOT_REQUIRED`, preserved placement, and left registration/charge-start timestamps untouched. Decision notification/audit paths executed in the same transaction.

Result: PASS

## Scenario E — Rejection and Resubmission

Expected: Supervisor revises the reason, resubmits, Management approves, and prior rejection remains in history.

Actual: Live UAT created submission 1 as Rejected and submission 2 as Approved, confirmed both history rows in order, and verified the revised reason and final approved state.

Result: PASS

## Scenario F — Charges Already Calculated

Expected: Historical charge is preserved, payable becomes zero, accrual stops, Gate sees Management Release, and ordinary invoice generation is blocked.

Actual: Approval locked Finance records, preserved historical/waived fields, cancelled unpaid payable invoices with an explicit reason, returned zero outstanding balance, stopped accrual at Management decision time, and rejected draft invoice generation. Paid records are preserved and flagged for Finance review. Gate uses the approved zero-balance snapshot while retaining all non-financial eligibility conditions.

Result: PASS

## Regression summary

- Migration: PASS
- New workflow tests: 10/10 PASS
- Live rollback-safe UAT: PASS
- Frontend tests: 44/44 PASS
- Frontend production build: PASS
- Docker backend functional/database/concurrency tests: 236 PASS; one unrelated container file-path test failed because it expects a repository-level file at container root. Its host execution passes.

MANAGEMENT RELEASE UAT ACCEPTED

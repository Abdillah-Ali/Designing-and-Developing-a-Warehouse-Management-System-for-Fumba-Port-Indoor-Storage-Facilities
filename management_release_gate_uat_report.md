# Management Release Mandatory Gate UAT Report

Environment: live Docker PostgreSQL 17, backend, frontend, migration 033, active Gate policy revision 2. Disposable invoice/payment records and Management transitions were executed inside a rollback-safe database transaction.

## Scenario 1 — Pending Management cargo

Expected: Supervisor-approved cargo may remain or become placed, but Gate-Out is blocked with Management approval pending.

Actual: Central release eligibility returned `eligible=false` and `MANAGEMENT_RELEASE_PENDING`. Placement status was captured before submission and remained identical during Pending and after later decisions. The Gate UI disables release and displays the returned reason.

Result: PASS

Evidence: `managementReleaseLiveUat.test.js`; matrix tests 2 and 7; active normal Gate policy revision 2.

## Scenario 2 — Pending but paid or zero balance

Expected: payment and zero outstanding balance do not substitute for Management authorization.

Actual: The Management evaluator depends only on trusted release type/status. Both paid-pending and zero-balance-pending tests returned `MANAGEMENT_RELEASE_PENDING`. The live UAT inserted a confirmed payment while Pending; Gate authorization remained unsatisfied until explicit approval.

Result: PASS

Evidence: matrix tests 9 and 10; live confirmed-payment fixture.

## Scenario 3 — Management approved

Expected: historical charge and waived value remain, payable is zero, future accrual stops, unpaid invoice is cancelled, and Customs/dispatch remain required.

Actual: Management approval set `APPROVED`, decision-time charge end, zero outstanding balance, and `WAIVED_BY_MANAGEMENT_RELEASE`. The issued unpaid UAT invoice became `Cancelled`; its row and amount remained. The Management requirement disappeared from blocked requirements, while Customs and/or dispatch remained blocked in the live eligibility result.

Result: PASS

Evidence: live UAT financial snapshot and invoice query; matrix tests 4–6, 11, 12, and 14.

## Scenario 4 — Management rejected

Expected: placement remains valid, Gate-Out is blocked, and Supervisor action is required.

Actual: Central eligibility returned `MANAGEMENT_RELEASE_REJECTED`; placement status remained unchanged. Gate exposes the Supervisor-action message and disables release.

Result: PASS

Evidence: live UAT rejection query; matrix tests 3 and 8.

## Scenario 5 — Rejected then Normal

Expected: Management block is removed, normal Finance/payment Gate rules return, and original charging basis remains.

Actual: Supervisor conversion produced `release_type=NORMAL` and `management_release_status=NOT_REQUIRED`. The evaluator passed the Management requirement, leaving ordinary Finance/Customs/dispatch requirements. Registration and `charge_start_at` were not modified.

Result: PASS

Evidence: live UAT conversion; matrix tests 1 and 15.

## Scenario 6 — Rejected then resubmitted

Expected: resubmission returns to Pending, preserves placement/history, and Gate remains blocked until later approval.

Actual: Submission 1 remained Rejected and submission 2 was created Pending. Central eligibility returned a Pending block. After explicit approval, payable became zero and prior request history remained intact.

Result: PASS

Evidence: live UAT ordered history assertion; matrix test 16.

## Scenario 7 — Payment before approval

Expected: approval remains valid; invoice/payment history survives; Finance review is required; future payable is zero; no automatic refund occurs.

Actual: Live UAT inserted a Paid invoice and Confirmed payment before approval. After approval, both statuses remained unchanged, `finance_review_required=true`, outstanding balance was zero, and no refund/reversal record was fabricated. A separate unpaid issued invoice was cancelled in the same approval transaction.

Result: PASS

Evidence: live UAT invoice/payment/status assertions; matrix test 13.

## Direct API and concurrency evidence

Normal and emergency Gate APIs use the central revision-2 policy. Pending/rejected Management errors return structured reason codes, and emergency authorization cannot bypass them. Cargo/request/invoice row locks and final revalidation protect Management-vs-Gate and Management-vs-Finance races. The authenticated HTTP concurrency suite passed all 11 scenarios, including double Gate release and rollback integrity.

Result: PASS

## Regression summary

- Gate correction matrix: 22/22 PASS
- Focused policy/concurrency/UAT: 41/41 PASS
- Frontend: 44/44 PASS
- Production frontend build: PASS
- Docker backend: 259/260 PASS
- Unrelated Docker-only path failure: `securityHardening.test.js` expects `/docker-compose.production.yml`; unchanged and unrelated
- Same host security suite: 6/6 PASS

### MANAGEMENT RELEASE GATE UAT ACCEPTED

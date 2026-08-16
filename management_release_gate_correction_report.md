# Management Release Mandatory Gate Correction Report

## Root cause and previous behavior

The accepted Management Release implementation correctly separated placement from financial treatment and returned zero payable charges after approval. Its central `normal_gate_release` eligibility policy, however, contained only registration, Customs, Finance, dispatch, and release-state requirements. It had no explicit Management authorization evaluator. Consequently, `MANAGEMENT + PENDING` or `MANAGEMENT + REJECTED` cargo could become Gate-eligible if its financial balance and other requirements passed. The emergency Gate path also lacked this mandatory authorization.

## Business-rule correction

Management Release remains irrelevant to physical placement, but is now a mandatory Gate authorization. The trusted matrix is:

- `NORMAL + NOT_REQUIRED`: normal Finance/payment Gate path.
- `MANAGEMENT + PENDING`: placement allowed; Gate blocked with `MANAGEMENT_RELEASE_PENDING`.
- `MANAGEMENT + REJECTED`: placement remains valid; Gate blocked with `MANAGEMENT_RELEASE_REJECTED`.
- `MANAGEMENT + APPROVED`: warehouse Finance requirement is waived; Management requirement passes; registration, Customs, dispatch, release state, and Gate authorization still apply.

Inconsistent mixed states fail closed with `MANAGEMENT_RELEASE_STATE_INVALID`. Emergency release authorization cannot bypass the Management requirement.

## Central release eligibility

Migration 033 creates revision 2 of both normal and emergency Gate policies and adds the code-owned `management_release_authorization` evaluator. Revision 1 is retained but deactivated. The evaluator reads trusted cargo columns only.

The release service evaluates Management authorization before Finance. This ensures pending/rejected cargo returns its authoritative Management block even when tariffs are missing, payment is complete, or balance is zero. Approved cargo proceeds to the existing policy requirements. Direct Gate API requests and emergency-reference requests use these same policies.

## Finance correction

The existing approval reconciliation remains active:

- accrued/calculated value is retained as historical and waived value;
- decision time stops future accrual;
- final outstanding/payable amount is zero;
- draft or issued unpaid invoices are cancelled with `Management Release Approved`;
- paid invoice and confirmed payment rows remain unchanged;
- a pre-approval payment sets `management_release_finance_review_required`;
- draft generation and invoice issuance re-lock cargo and reject approved Management cargo.

Finance charge rows now expose the Finance-review flag. The Finance portal displays Normal/Pending/Approved/Rejected classification, explains provisional pending invoices through the action tooltip, disables invoice creation after approval, and highlights payment-received review cases.

## Gate, Management, Supervisor, notification, and audit changes

- Gate queue and detail display Management state and disable Gate-Out while ineligible.
- Emergency action is not offered for a Management authorization block.
- Gate dashboard counts Management-blocked cargo and excludes it from Ready for Release.
- Approved Management cargo displays `No Charges / Waived` while retaining other blockers.
- Management UI states that its explicit decision is mandatory for Gate-Out.
- Supervisor UI states that placement may continue but Gate-Out requires Management approval.
- Notifications now explicitly describe the Gate block, post-approval remaining controls, rejection/Supervisor action, and Finance invoice/payment review.
- A failed direct Gate attempt caused by pending/rejected Management status creates `BLOCK_MANAGEMENT_RELEASE_GATE_OUT` audit history with the server actor, cargo, reason code, and timestamp.
- Final Management Gate-Out retains `CONFIRM_MANAGEMENT_RELEASE_GATE_OUT` auditing.

## Concurrency protection

Gate locks the cargo row before calculating eligibility. Management approval locks the same cargo and pending request rows, then locks related invoices. Invoice generation locks cargo before creation; issuance re-locks and revalidates cargo. These lock/revalidation paths serialize Management-vs-Gate and Management-vs-Finance operations. Whichever transaction commits first, an approved Management cargo cannot finish with a payable invoice or release from stale pending state.

## Files modified or added

- `backend/database/migrations/20260816_management_release_gate_authority.sql`
- `backend/database/initDb.js`
- `backend/database/updateSchema.js`
- `backend/services/eligibilityEvaluatorRegistry.js`
- `backend/services/releaseEligibilityService.js`
- `backend/services/managementReleaseService.js`
- `backend/services/financeService.js`
- `backend/controllers/gateController.js`
- `frontend/src/pages/GatePortal.jsx`
- `frontend/src/pages/FinancePortal.jsx`
- `frontend/src/pages/ManagementPortal.jsx`
- `frontend/src/components/wms/ReviewActionModal.jsx`
- `backend/tests/dispatchGatePolicyAuthority.test.js`
- `backend/tests/managementReleaseGateCorrection.test.js`
- `backend/tests/managementReleaseLiveUat.test.js`
- `management_release_gate_correction_report.md`
- `management_release_gate_uat_report.md`

## Tests and exact results

- Mandatory Gate decision-matrix tests: 22/22 passed.
- Focused Gate policy, authenticated HTTP concurrency, matrix, and live UAT run: 41/41 passed.
- Live Management Release Docker UAT: passed with rollback-safe real database invoice/payment records.
- Frontend: 44/44 passed.
- Frontend production build: passed.
- Final Docker backend suite: 259/260 passed. All Management Release, Finance, Customs, dispatch, Gate, placement, scanner, RBAC, notification, audit, regression, and live concurrency scenarios passed. The sole failure remains the documented unrelated `securityHardening.test.js` container path assumption for `/docker-compose.production.yml`.
- Host execution of `securityHardening.test.js`: 6/6 passed, confirming the failure is only the pre-existing container filesystem-path assumption.

Placement service remains unchanged and contains no Management Release dependency.

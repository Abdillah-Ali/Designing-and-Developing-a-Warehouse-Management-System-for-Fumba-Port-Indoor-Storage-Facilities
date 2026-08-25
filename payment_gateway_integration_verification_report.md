# Payment Gateway Integration Verification Report

Date: 25 August 2026  
Provider: Flutterwave v4 Sandbox

## Previous problem and root cause

The provider-backed payment service, public payment route, invoice activation, and webhook verifier were already present. The UAT failure was primarily an exposed-workflow failure:

- Finance Invoices showed only **Details**, so Finance could neither copy the customer payment link nor resend the email.
- The Finance Payments page contained an intentionally hidden legacy manual-payment form. This made the documented “Record Payment / Confirm Payment” steps appear to be required even though the intended provider-backed workflow forbids Finance from manually marking an invoice paid.
- The UAT invoice for `CARGO-2026-00047` showed no customer email, so the automatically queued email was correctly marked `SKIPPED`.

## Changes made

- `frontend/src/pages/FinancePortal.jsx`
  - Added Finance **Copy link** and **Resend email** controls to issued invoices.
  - Disabled link copying when no secure token-backed link exists or the invoice is cancelled.
  - Removed the hidden legacy manual payment form from the Finance Payments page.
  - Kept payment initiation customer-only through `/pay/:token`; Finance still cannot manually confirm provider payments.
- `frontend/src/pages/financeGatewayInitiation.test.js`
  - Added checks for the new Finance link/email controls and absence of the legacy manual form.
- `backend/tests/customerPaymentWorkflowIntegration.test.js`
  - Updated the integration fixture for the current safe activation order: issue the token first, then issue the invoice, then set the single master PAY reference.
- `backend/services/paymentService.js`
  - Enables the Sandbox-only `scenario:auth_redirect` header, returns Flutterwave `next_action` to the public page, and exposes verified, reserved, available, and remaining totals.
  - Corrected the settlement query’s PostgreSQL parameter typing. Before this correction, provider polling silently retained an actual succeeded charge as pending.
- `frontend/src/pages/PublicPayment.jsx`
  - Shows the provider-hosted **Continue to Flutterwave Sandbox Authorization** action rather than attempting to collect an authorization PIN in WMS.

Earlier working-tree changes retained by this task also correct draft-invoice activation timing and the automatic-invoice token constraint:

- `backend/services/financeService.js`
- `backend/services/paymentService.js`
- `backend/database/initDb.js`
- `backend/database/updateSchema.js`
- `backend/database/migrations/20260825_draft_invoice_payment_token_constraint.sql`

## Implemented payment flow

1. Registration creates one automatic draft invoice.
2. Supervisor rejection cancels the automatic invoice and clears its PAY reference and public token.
3. Supervisor approval activates the existing invoice, creates one `PAY-...` reference, generates a 256-bit token, queues the secure `/pay/:token` link email, and issues the invoice.
4. A customer without a WMS account uses `/pay/:token` to see cargo/invoice/PAY totals, verified paid total, remaining balance, installment amount, phone, and provider network.
5. Every payment initiation creates a unique `PMT-...` attempt, Flutterwave charge, and idempotency key. Previous attempts are retained.
6. In Sandbox, a mobile-money charge can request Flutterwave’s `auth_redirect` scenario. The public page exposes the returned provider-hosted redirect; the WMS never collects a PIN or treats the redirect click as payment success.
7. The raw-body HMAC-SHA256 webhook handler and polling both use the same centralized provider verification and settlement path. A customer click never settles an invoice.
8. Settlement accepts only a verified Flutterwave charge whose charge ID, PMT reference, invoice relationship, expected amount, currency, and `succeeded` status match. It then refreshes invoice/cargo financial status and release readiness.

## Installments and release safety

- Only verified matched attempts contribute to paid total.
- Pending, failed, rejected, voided, wrong-amount, and wrong-currency attempts remain in history but do not reduce the balance.
- Active attempts reserve balance, preventing concurrent over-commitment.
- A fully paid invoice stops further payment attempts, but it does **not** release cargo. Registration approval, valid placement, Customs clearance, release readiness, staff release workflow, and Gate-Out remain separate controls.

## Email and public payment flow

The email template includes cargo reference, invoice reference, master PAY reference, invoice total, verified amount paid, remaining balance, and a secure payment URL. SMTP delivery status is persisted as `SENT`, `FAILED`, or `SKIPPED`; Finance can now resend it and copy the secure link. Missing cargo email or missing SMTP configuration remains visible rather than being silently treated as delivered.

## Security controls

- OAuth client credentials are backend-only.
- Webhook signature verification uses HMAC-SHA256 over the exact raw request body and the `flutterwave-signature` header.
- Webhook event IDs are claimed with database idempotency protection before settlement.
- Provider verification uses `GET /charges/{charge_id}` before financial settlement.
- PINs/passwords are neither requested by the WMS UI nor stored or logged.
- Network input is normalized and backend-validated: M-Pesa → `vodacom`, Airtel Money → `airtel`, Mixx by Yas/Tigo Pesa → `tigo`, HaloPesa → `halotel`.

## Automated verification

Passed:

- Frontend: 14 files, 51 tests passed.
- Production frontend build: passed.
- Targeted backend payment suite: 45 tests passed, including OAuth, charges, public token access, installments, pending/failed/voided handling, amount/currency/reference mismatches, replay protection, polling, release readiness, and email behavior.

Full backend suite result at the time of verification: 308 passed, 4 failed, 1 skipped. One failed payment fixture was corrected above. The remaining failures are unrelated test-environment/fixture issues: invalid HTTP test credentials, an overlapping tariff fixture, and a scanner refresh-session fixture. They were not suppressed or relabeled as payment successes.

## Actual Flutterwave Sandbox evidence

| Scenario | Result | Evidence |
| --- | --- | --- |
| OAuth client-credentials authentication | Executed successfully | Sandbox access token obtained; token length 1753 (token intentionally not recorded). |
| Live partial mobile-money authorization and settlement | Executed successfully | Cargo `CARGO-2026-00048`; invoice `INV-2026-AARMZMRN`; master `PAY-2026-P3F60AXH`; attempt `PMT-2026-T7XO4NMY`; Flutterwave charge `chg_7a9cQRYMyd`. The customer completed the real Flutterwave Developer Sandbox hosted authorization page. Authoritative `GET /charges/chg_7a9cQRYMyd` then returned `succeeded`, reference `PMT-2026-T7XO4NMY`, amount `TZS 100`, currency `TZS`. Centralized WMS polling settled it as `SUCCESSFUL` / `MATCHED`. |
| Post-settlement balances | Verified | Invoice total `TZS 1,000`; verified paid `TZS 100`; outstanding `TZS 900`; invoice and cargo both `Partially Paid`. Release readiness remains `WAITING_PLACEMENT` with payment, placement, and Customs blockers. |
| Webhook delivery | Not observed for this charge | No provider webhook event ID was recorded. The configured Quick Tunnel must remain live for a later webhook UAT. Polling provided the authoritative settlement above. |
| Pending, failure, retry, full payment | Not executed live | Covered by automated provider-mocked tests only; not represented as successful Sandbox outcomes. |

## Remaining issues

1. Complete a live remaining-balance payment and capture the final `Paid` / `Fully Paid` outcome; the demonstrated payment is deliberately partial.
2. Keep a public HTTPS webhook URL live and demonstrate an actual webhook event ID and replay handling.
3. Implement and verify the defined expiry/reconciliation policy for older pending attempts, so stale reservations cannot indefinitely consume the available balance.
4. Resolve the unrelated full-suite fixtures before claiming an all-green backend regression run.

## Final verdict

**PAYMENT GATEWAY INTEGRATION NOT ACCEPTED**

The implementation and automated verification are substantially in place. A real Flutterwave Sandbox partial charge and authoritative polling settlement are now evidenced above. Acceptance remains blocked by the absence of a live webhook, live failure/retry/full-settlement evidence, a defined stale-pending reconciliation policy, and an all-green full regression run. This verdict deliberately does not treat mocks, direct database updates, or forged webhooks as live payment UAT.

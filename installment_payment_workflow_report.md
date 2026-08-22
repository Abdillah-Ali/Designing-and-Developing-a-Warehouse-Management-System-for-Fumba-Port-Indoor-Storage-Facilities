# Installment Payment Workflow Report

## Verdict

**INSTALLMENT PAYMENT WORKFLOW ACCEPTED WITH MINOR OBSERVATIONS**

**YES** — one cargo invoice can accept multiple verified customer payments over time, retain one master WMS payment reference, keep each attempt and provider charge separately auditable, calculate the verified paid total and remaining balance, and become Fully Paid only when matched verified installments settle the invoice.

## Previous one-payment model

The Flutterwave initiation path used the invoice's `PAY-...` master reference as the payment row reference, provider charge reference, and idempotency key. It reused an existing pending row/charge and always requested the complete outstanding balance. This effectively imposed one invoice → one charge.

## New multi-payment model

The model is now one cargo → one automatic invoice → one stable `PAY-...` obligation → many `PMT-...` attempts → many Flutterwave charge IDs. Every initiation inserts a new payment row and never overwrites a prior successful installment.

## Master reference and attempt model

- `invoices.payment_reference` remains the stable master reference.
- `payments.payment_reference` links every attempt to that master.
- `payments.attempt_reference` / `payments.public_reference` is a unique `PMT-...` identity.
- Each attempt gets a unique server-derived `idempotency_key`.
- Flutterwave receives the attempt reference as its charge `reference`; the master reference remains in provider metadata.

## Database changes

Migration `20260822_installment_payment_workflow.sql` adds an unguessable invoice payment token, attempt reference, idempotency key, uniqueness constraints, and an installment-history index. Existing rows are backfilled as legacy single-attempt histories. Migrations 035 and 036 were not edited.

## API changes

Token-scoped public APIs:

- `GET /api/public/payments/:token` — safe invoice/payment summary.
- `POST /api/public/payments/:token/attempts` — validate and initiate a chosen installment.
- `GET /api/public/payments/:token/attempts/:attemptReference` — attempt outcome.

Protected Finance API:

- `GET /api/payments/:paymentReference/history` — full ordered installment history.

The existing protected invoice initiation API accepts `amount` and now creates a fresh attempt.

## Flutterwave mapping and reconciliation

Webhook resolution uses the unique attempt reference plus provider charge ID. A charge counts only when Flutterwave retrieval confirms the exact charge ID, attempt reference, amount, currency, and `succeeded` state. Pending, failed, voided, wrong-currency, wrong-amount, rejected, and exception rows stay auditable but do not count toward settlement. Duplicate event protection remains in `payment_webhook_events`.

## Outstanding balance and statuses

The authoritative calculation is the sum of matched, verified Flutterwave rows (plus compatible confirmed legacy non-gateway rows). Invoice paid and outstanding values are recalculated after each webhook. Zero paid maps to Outstanding, a positive remaining balance maps to Partially Paid, and zero balance maps to Fully Paid. Release readiness is recalculated after every event.

## Concurrency controls

Initiation locks the invoice inside a database transaction, recalculates verified paid value, subtracts active pending/processing attempt reservations, and rejects a requested installment above the currently available balance. This prevents two devices from normally reserving more than the obligation. Provider mismatch/overpayment remains a reconciliation exception rather than silently becoming ordinary settlement.

## Public payment security

Public access uses a 256-bit random token instead of exposing the guessable `PAY-...` reference alone. Responses contain only cargo reference, invoice reference, master reference, currency, totals, status, and attempt outcome. Public routes cannot edit cargo, tariffs, invoices, Customs, readiness, or payment confirmation. No PIN field or PIN storage exists.

## Finance UI

Finance can choose an installment amount up to the displayed outstanding balance. Monitoring now distinguishes the master reference, attempt reference, provider charge, verified time, and reconciliation state. Finance's legacy manual entry remains hidden, and the role still lacks manual gateway-confirmation permission.

## Tests and UAT coverage

Automated tests cover verified-total/outstanding calculation, first/partial/final status mapping, exclusion of pending/failed/voided/mismatched outcomes, unique attempt/idempotency architecture, public token scope, Customs blocking, Management Release compatibility, and readiness after final settlement. Existing Flutterwave mapping and webhook idempotency tests were retained and updated for `PMT-...` references.

UAT arithmetic represented by the tests:

1. TZS 500,000 invoice; TZS 100,000 matched → paid 100,000, outstanding 400,000, Partially Paid.
2. TZS 150,000 matched → paid 250,000, outstanding 250,000, Partially Paid.
3. TZS 250,000 matched → paid 500,000, outstanding 0, Fully Paid; readiness becomes ready only if registration, placement, and Customs also pass.

## Remaining observations

- Apply the new migration before exercising the APIs.
- The repository has no configured outbound customer email/SMS delivery provider. The secure token/link architecture is present; actual delivery remains a separate integration and is not simulated.
- A dedicated branded external `/pay/...` React page was not added; the core public backend and the existing Finance sandbox initiation interface provide the required test surface.
- Live PostgreSQL concurrency/UAT tests require valid local database credentials. Unit and source-level workflow tests run without that dependency.


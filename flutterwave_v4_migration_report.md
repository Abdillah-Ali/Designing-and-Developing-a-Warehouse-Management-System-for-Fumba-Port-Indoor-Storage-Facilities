# Flutterwave v4 Migration Report

## A. Previous Integration

The WMS used Flutterwave v3 at `https://api.flutterwave.com/v3`, authenticated by sending `FLUTTERWAVE_SECRET_KEY` directly as a bearer credential, initiated hosted checkout with `POST /payments`, verified with `GET /transactions/{id}/verify`, expected `tx_ref` and `successful`, and directly compared a webhook header with the configured secret.

## B. New Integration

The active provider path now targets Flutterwave v4 Sandbox at `https://developersandbox-api.flutterwave.com`. It obtains OAuth credentials, creates or accepts v4 customer/payment-method resources, creates an idempotent charge, stores the `chg_...` ID separately from the WMS `PAY-...` reference, accepts signed `charge.completed` events, retrieves the authoritative charge, and then invokes the existing invoice, financial-status, notification, audit, and centralized release-readiness services.

## C. Authentication

`FLUTTERWAVE_CLIENT_ID` and `FLUTTERWAVE_CLIENT_SECRET` are sent as form-encoded OAuth client credentials to `FLUTTERWAVE_OAUTH_TOKEN_URL`. The returned access token is used only in backend `Authorization: Bearer` headers. No v3 secret-key bearer path remains.

## D. Token Management

`flutterwaveOAuthService.js` caches the token and expiry in process memory, refreshes one minute before expiry, and coalesces simultaneous refresh requests through one shared promise. Tokens are never stored in PostgreSQL, returned to React, or logged.

## E. Charge Creation

The backend uses `POST /charges` with amount, currency, customer ID, payment-method ID, the authoritative WMS payment reference, callback URL, and cargo/invoice metadata. `X-Idempotency-Key` is the `PAY-...` reference and `X-Trace-Id` is derived from it. Repeated WMS initiation returns the stored charge when one already exists. Where IDs are not supplied, explicit external-customer email, phone, and network are used to create `/customers` and `/payment-methods` resources first.

## F. Charge Verification

The backend retrieves `GET /charges/{charge_id}` and verifies charge ID, WMS reference, status, amount, and currency before settlement. `succeeded`, `pending`, `failed`, and `voided` map safely into existing database states. Partial payments, overpayments, and currency mismatches retain the existing reconciliation behavior.

## G. Webhook Security

`POST /api/payments/webhook` remains public but isolated. Express captures the exact raw JSON bytes before global JSON parsing. The backend computes Base64 HMAC-SHA256 over those bytes using `FLUTTERWAVE_WEBHOOK_SECRET` and compares it in constant time with `flutterwave-signature`. Missing, altered, or invalid signatures are rejected before database work.

## H. Webhook Mapping

`payload.id` is the event ID, `payload.type` must be `charge.completed`, `payload.data.id` is the Flutterwave charge ID, `payload.data.reference` is the WMS payment reference, and the authoritative retrieved charge supplies the final status, amount, currency, and reference.

## I. Idempotency

Charge creation uses the WMS payment reference as the provider idempotency key and persists the returned charge ID. Webhook replay protection continues to use the unique `(provider,event_id)` record in `payment_webhook_events`. A duplicate event returns successfully without provider retrieval, settlement, readiness changes, audit duplication, or notification duplication.

## J. Environment Variables

- `PAYMENT_PROVIDER`
- `PAYMENT_ENVIRONMENT`
- `FLUTTERWAVE_API_BASE_URL`
- `FLUTTERWAVE_OAUTH_TOKEN_URL`
- `FLUTTERWAVE_CLIENT_ID`
- `FLUTTERWAVE_CLIENT_SECRET`
- `FLUTTERWAVE_WEBHOOK_SECRET`
- `PAYMENT_CALLBACK_URL`
- `PAYMENT_WEBHOOK_URL`

Previously exposed sandbox credentials must be regenerated/reset before use. No credential values are included here.

## K. Files Modified

- `backend/services/flutterwaveOAuthService.js`
- `backend/services/paymentService.js`
- `backend/controllers/paymentController.js`
- `backend/app.js`
- `backend/.env.example`
- `docker-compose.yml`
- `docker-compose.production.yml`
- `backend/tests/flutterwaveV4Migration.test.js`
- `payment_sandbox_setup_guide.md`
- `flutterwave_v4_migration_report.md`

## L. Database Changes

None. Applied migrations 035 and 036 were not edited. Existing gateway transaction, event, response, status, and webhook-event fields support v4 charge IDs and events.

## M. Tests

- OAuth tests: **4/4**
- Charge creation tests: **2/2**
- Charge verification tests: **1/1**
- Webhook HMAC/raw-body tests: **2/2** (including valid, missing, altered body, wrong body, and wrong secret assertions)
- Webhook idempotency tests: **1/1**
- Payment integrity/status tests: **1/1** (exact, pending, failed, voided, partial, overpayment, and wrong currency assertions)
- Release readiness tests: **7/7**
- Gate regression tests: **1/1**
- Finance authorization regression tests: **1/1**
- Tariff approval/billing regression tests: **1/1**
- Focused v4 and workflow tests: **22/22**
- Concurrency tests: **0/1 completed in this run**; the live suite failed before assertions because hostname `postgres` was unavailable. The supplied accepted baseline remains 11/11 but was not claimed as rerun.
- Database/live tests: **NOT EXECUTED in this run** because hostname `postgres` was unavailable; eight database-dependent tests were skipped. The supplied accepted baseline remains 281 passed.
- Backend tests: **263/272 passed**, **1 environment failure**, **8 skipped**
- Frontend tests: **45/45** across 12 files
- Production build: **PASSED**
- Source syntax and diff validation: **PASSED**

No unrelated test failure was hidden.

## N. Live Sandbox Status

**READY FOR LIVE V4 SANDBOX UAT**

Live credentials and a public webhook URL were not configured, therefore:

**LIVE FLUTTERWAVE V4 SANDBOX E2E: NOT EXECUTED**

## O. Final Verdict

**FLUTTERWAVE V4 MIGRATION ACCEPTED WITH MINOR OBSERVATIONS**

The remaining observation is environmental/live validation: regenerate any exposed test credentials, configure Client ID, Client Secret, Secret Hash, callback and public webhook URL, then run the manual sandbox transaction and live database/concurrency regression.

> Is the Fumba Port WMS now technically compatible with the current Flutterwave v4 developer sandbox and ready for Client ID, Client Secret, webhook URL, and Secret Hash configuration?

**YES**

# Flutterwave v4 Sandbox Setup Guide

The WMS uses Flutterwave v4 Sandbox with OAuth 2.0 client credentials, v4 charges, authoritative charge retrieval, and signed webhooks. Customers remain external to the WMS.

## Before configuration

Regenerate/reset any sandbox Client Secret, Encryption Key, or other credential that was previously displayed in setup logs, screenshots, or shared documentation. Never reuse exposed credentials and never commit credentials to Git.

## Dashboard and backend setup

1. Sign in at `developersandbox.flutterwave.com` and obtain the sandbox **Client ID** and **Client Secret**.
2. Configure a strong independent webhook Secret Hash.
3. Configure the public HTTPS webhook URL as `https://your-test-host/api/payments/webhook`.
4. Configure these backend-only variables: `PAYMENT_PROVIDER`, `PAYMENT_ENVIRONMENT`, `FLUTTERWAVE_API_BASE_URL`, `FLUTTERWAVE_OAUTH_TOKEN_URL`, `FLUTTERWAVE_CLIENT_ID`, `FLUTTERWAVE_CLIENT_SECRET`, `FLUTTERWAVE_WEBHOOK_SECRET`, `PAYMENT_CALLBACK_URL`, and `PAYMENT_WEBHOOK_URL`.
5. Use `https://developersandbox-api.flutterwave.com` as the sandbox API base and `https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token` as the OAuth token URL.
6. Restart the backend/Docker service. No payment credential belongs in React/Vite configuration.

For local webhook testing, expose only backend port 5000 through a secure HTTPS development tunnel such as Cloudflare Tunnel or ngrok. Keep the temporary URL in environment/dashboard configuration, not source code.

## Initiating and verifying a test

Initiation accepts existing v4 `customer_id` and `payment_method_id`, or explicit external-customer email, Tanzanian phone number, and mobile-money network so the backend can create them. The backend obtains and caches a short-lived OAuth access token, sends an idempotent `POST /charges`, and stores the returned `chg_...` charge ID separately from the WMS `PAY-...` reference.

Complete or simulate the charge in the v4 sandbox. Flutterwave sends `charge.completed` to the WMS. The backend validates the Base64 HMAC-SHA256 `flutterwave-signature` over the exact raw body, retrieves `GET /charges/{charge_id}`, and checks ID, WMS reference, status, amount, and currency before settlement.

Inspect `payments`, `payment_webhook_events`, `invoices`, `cargo`, `audit_logs`, and `notifications`. Exact `succeeded` payment should settle the invoice and make cargo `Fully Paid`; readiness becomes `READY_FOR_RELEASE` only when registration, placement, and Customs also pass. `pending`, `failed`, `voided`, wrong-reference, wrong-amount, and wrong-currency cases must remain blocked or reconciled.

Production later requires live v4 credentials, a stable HTTPS endpoint, provider onboarding/KYC, monitoring, and secure secret delivery. OAuth tokens remain process-memory only and must never be logged or stored in PostgreSQL.

# Flutterwave Sandbox Setup Guide

## Provider choice

Phase 1 uses Flutterwave Sandbox. It provides a test environment, hosted checkout/mobile-money options suitable for Tanzania, TZS transactions, webhooks, and a server-side transaction verification API. The WMS integrates only this provider; customers remain external and do not receive WMS accounts.

## Account and configuration

1. Create a Flutterwave developer/business account and open its dashboard.
2. Switch the dashboard to Test Mode.
3. Copy the test public key and test secret key from API settings.
4. Create a strong webhook secret hash in the dashboard. Do not reuse an API key.
5. Copy `backend/.env.example` to `backend/.env` and set `PAYMENT_PROVIDER=flutterwave`, `PAYMENT_ENVIRONMENT=sandbox`, `FLUTTERWAVE_PUBLIC_KEY`, `FLUTTERWAVE_SECRET_KEY`, and `FLUTTERWAVE_WEBHOOK_SECRET`.
6. Set `PAYMENT_CALLBACK_URL` to the Finance return page. Set `PAYMENT_WEBHOOK_URL` to the public HTTPS webhook address ending in `/api/payments/webhook`.
7. For Docker, pass those backend-only variables into the backend service environment and restart it. Never add secret keys to React/Vite variables.
8. For localhost, run the backend on port 5000 and use a secure HTTPS development tunnel (for example Cloudflare Tunnel or ngrok) to `http://localhost:5000`. Put the temporary public address only in environment/dashboard configuration, never source code.
9. Configure the Flutterwave Test Mode webhook URL and secret hash, then initiate checkout from an issued automatic invoice.

## Test transactions

Use Flutterwave's current Test Mode payment credentials/options shown in its dashboard/documentation. Complete a successful test payment for the exact TZS amount. For FAILED and PENDING scenarios use the provider's Test Mode failure/pending simulation; do not edit WMS payment rows or click “Mark Paid.” Flutterwave must deliver the event and the backend must verify the transaction API response.

Verify delivery in the Flutterwave webhook dashboard. In PostgreSQL inspect `invoices`, `payments`, `payment_webhook_events`, `cargo`, `audit_logs`, and `notifications` using the WMS payment reference. A success with exact amount/currency should show invoice `Paid`, outstanding `0`, cargo `Fully Paid`, then `READY_FOR_RELEASE` when registration, placement, and Customs also pass. Failed/pending/wrong amount/wrong currency remain blocked; partial and overpayments are flagged for reconciliation.

Production later uses live credentials, a stable HTTPS domain, production webhook secret, production callback URL, provider onboarding/KYC, monitoring, and operational reconciliation. Never copy sandbox or live secrets into Git, logs, frontend code, or database records.

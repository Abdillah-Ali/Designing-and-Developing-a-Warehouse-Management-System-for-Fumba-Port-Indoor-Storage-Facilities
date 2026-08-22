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

## Public installment page

Automatic invoices now receive a 64-character random public token. The customer URL is generated as:

```text
PUBLIC_PAYMENT_BASE_URL + /pay/ + payment_public_token
```

The `/pay/:token` React page requires no WMS account. It shows only the cargo, invoice, master payment reference, total, verified paid value, remaining balance, and payment state. Each submission creates a separate `PMT-...` attempt and Flutterwave charge. The page never asks for a mobile-money PIN.

Set the backend URL used in generated links:

```env
PUBLIC_PAYMENT_BASE_URL=http://localhost:3000
```

## Gmail SMTP demonstration

Use a Google App Password, never the normal Google account password. Gmail requires 2-Step Verification before an App Password can be created. Keep all values in backend/Docker environment configuration; none belong in React:

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-demo-account@example.com
SMTP_PASSWORD=your-google-app-password
EMAIL_FROM=Fumba Port WMS <your-demo-account@example.com>
PUBLIC_PAYMENT_BASE_URL=http://192.168.x.x:3000
```

Do not paste the App Password into chat, source control, screenshots, or reports. Restart/recreate the backend container after changing environment configuration. Email failure does not undo an invoice; Finance can retry the same durable delivery and secure link.

## Same-network demonstration

Docker remains localhost-only by default. For an explicit demo, set the bind address and Wi-Fi URL before recreating the frontend/backend containers:

```env
WMS_DEMO_BIND_ADDRESS=0.0.0.0
PUBLIC_PAYMENT_BASE_URL=http://<WMS-PC-WIFI-IP>:3000
CORS_ORIGIN=http://localhost:3000,http://<WMS-PC-WIFI-IP>:3000
```

Then recreate only the application services; do not remove volumes:

```text
docker compose up -d --force-recreate backend frontend
```

Allow inbound TCP 3000 and 5000 on the Windows Firewall for the Private network profile only, and remove/disable those demo rules afterward. The customer page uses the LAN URL. Flutterwave webhooks remain independently configured with the public HTTPS Cloudflare Tunnel URL.

Production later requires live v4 credentials, a stable HTTPS endpoint, provider onboarding/KYC, monitoring, and secure secret delivery. OAuth tokens remain process-memory only and must never be logged or stored in PostgreSQL.

# Installment Payment Public Portal and Email Report

## Final verdict

**PUBLIC INSTALLMENT PAYMENT & EMAIL WORKFLOW ACCEPTED WITH MINOR OBSERVATIONS**

**YES** — the implemented workflow can generate one secure tokenized payment link per automatic invoice, durably send or retry it through configured SMTP, accept external token-scoped installment payments without a WMS account, and settle cargo only from the combined matched Flutterwave payments. Live Gmail receipt and a second-device LAN test remain environment-dependent observations described below.

## A. Migration application

The installment migration is registered in both official runners as `038_installment_payment_workflow.sql`. It was applied through `npm run migrate` inside `fumba-backend`, then rerun and correctly reported as already applied. The durable email outbox and token invariants were applied as migrations 039 and 040. All three have one `applied` ledger row with checksum, timestamps, no error, and no duplicate execution.

## B. Public payment architecture

`/pay/:token` is outside all portal authentication gates. It calls only the token-scoped public summary, initiation, and attempt-status APIs. The backend locks the invoice, recomputes matched verified paid value, accounts for active reservations, validates the requested amount, creates a unique `PMT-...`, and creates a new Flutterwave charge.

## C. LAN demonstration configuration

Docker defaults to `127.0.0.1`. `WMS_DEMO_BIND_ADDRESS=0.0.0.0` explicitly enables LAN publication for ports 3000 and 5000. `PUBLIC_PAYMENT_BASE_URL` supplies the Wi-Fi address without hardcoding it. The detected Wi-Fi IPv4 during implementation was `192.168.157.38`; this is environment evidence only and is not embedded in source. Windows Firewall must allow ports 3000/5000 on the Private profile during the demo.

The LAN customer link and Cloudflare webhook remain separate: customer → LAN page/backend; Flutterwave → public HTTPS tunnel → webhook.

## D. Email architecture

`emailService.js` centralizes SMTP configuration, URL generation, database loading, reusable template rendering, delivery, safe failure logging, and retry. Nodemailer is backend-only. Controllers do not create SMTP transports.

## E. SMTP configuration

Supported variables are `EMAIL_PROVIDER`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`, and `PUBLIC_PAYMENT_BASE_URL`. Gmail demonstrations require 2-Step Verification and a Google App Password. The normal Gmail password must not be used. Secrets are neither returned to React nor written to audit metadata.

## F. Dynamic email template

The subject and body are built from cargo/invoice records: cargo reference, invoice reference, master PAY reference, currency, total, paid, remaining, and the tokenized link. Provider credentials, internal IDs, Customs/Management notes, users, and audit details are excluded.

## G. Trigger and idempotency

New automatic invoices queue one `INITIAL_PAYMENT_LINK` row, enforced unique per invoice. Existing delivery rows prevent duplicate initial email after recalculation or restart. Missing email records `SKIPPED`; SMTP errors record `FAILED` with attempt count and remain retryable. Neither case rolls back the invoice. Finance resend uses the same invoice token and URL.

## H. Public token security

Live verification found two applicable invoices, two unique populated tokens, and a minimum token length of 64. Database checks enforce lowercase hexadecimal format and require a token for automatic invoices. Public APIs validate tokens and attempt references, expose no internal identifiers, and use database-backed per-IP/per-email rate limits.

## I. Installment payment page

The responsive page displays safe obligation data, installment amount, name/email/phone/network inputs, provider next action, polling status, and a fully-paid completion state. Initiation is disabled at zero remaining balance. It explicitly states that PIN entry occurs only in the provider flow. Browser verification passed at desktop and 390×844 mobile sizing with no horizontal overflow.

## J. Multiple-payment UAT

Automated tests cover zero/partial/final totals, exclusion of pending/failed/voided/mismatched payments, unique attempts, idempotency, duplicate webhooks, active-attempt reservations, amount limits, history, and legacy compatibility. The same token URL reloads current totals after verified installments.

## K. Release readiness

Final verified settlement updates invoice and cargo to Fully Paid and invokes the centralized readiness service. Registration, placement, and Customs must still pass before `READY_FOR_RELEASE`.

## L. Customs, Management, and Gate regression

Customs remains mandatory. Approved Management Release remains an alternative financial path. Dispatch authorization is not reintroduced. Payment completion never marks physical release; only Gate-Out does. Live concurrency tests covered Customs conflicts and single/double Gate release plus rollback.

## M. Files modified

Payment/email services, public and protected payment controllers/routes, schema runners and migrations, Docker/environment examples, Finance monitoring, React routing/API client, the public payment page, tests, this report, and the sandbox guide. Migrations 035 and 036 were not edited.

## N. Database changes

- `invoices.payment_public_token` plus uniqueness and automatic-invoice/format checks.
- `payments.attempt_reference` and `idempotency_key` plus unique/history indexes.
- `payment_email_deliveries` durable delivery state with recipient, status, attempts, sent time, and safe failure details.
- Existing historical payment and provider charge data remained present after migration.

## O. Tests

- Complete backend suite in Docker/live PostgreSQL: **322 passed, 0 failed, 0 skipped**.
- Live concurrency validation: **12 passed, 0 failed, 0 skipped**.
- Focused installment/public/email/payment set: **44 passed, 0 failed**.
- Frontend: **49 passed, 0 failed** across 14 files.
- Production frontend build: passed; 2,546 modules transformed.
- Desktop and mobile-width browser verification: passed.

## P. Live email UAT

Not executed: this environment did not contain configured SMTP credentials or a designated safe recipient. Automated SMTP success/failure/template/idempotency tests use a mock transport and never send real email. Configure a Gmail App Password locally, recreate the backend container, and perform the documented one-recipient demonstration. No password was requested or exposed.

## Q. LAN device UAT

The Wi-Fi address was detected and the development-only binding option was implemented. A second phone/device was not available to prove access, so LAN device success is not claimed. Browser verification on the WMS PC passed. Enable the explicit bind option and Private-profile firewall rules, then validate from a phone on the same Wi-Fi.

## R. Remaining issues

1. Complete one real Gmail App Password delivery/receipt UAT using a safe recipient.
2. Complete one phone-on-Wi-Fi LAN UAT after enabling the demo binding and firewall rules.
3. SMS remains a future integration; no SMS delivery is simulated.

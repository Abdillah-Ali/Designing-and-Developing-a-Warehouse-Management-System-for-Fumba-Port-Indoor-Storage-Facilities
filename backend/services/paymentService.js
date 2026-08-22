const crypto = require("node:crypto");
const db = require("../config/db");
const { buildError } = require("../utils/apiError");
const { writeAuditLog } = require("../models/adminModel");
const { createNotificationsForAudience } = require("./notificationService");
const { createOrRegenerateDraftInvoice, issueInvoice, generatePublicReference, refreshInvoicePaymentStatus, updateCargoFinancialStatus, centsFromAmount } = require("./financeService");
const { recalculateReleaseReadiness } = require("./releaseReadinessService");
const { getAccessToken } = require("./flutterwaveOAuthService");
const { logEvent } = require("../utils/logger");
const { queueAndAttemptPaymentEmail } = require("./emailService");

const config = () => ({
  provider: (process.env.PAYMENT_PROVIDER || "flutterwave").toLowerCase(),
  environment: (process.env.PAYMENT_ENVIRONMENT || "sandbox").toLowerCase(),
  base: process.env.FLUTTERWAVE_API_BASE_URL || "https://developersandbox-api.flutterwave.com",
  webhookSecret: process.env.FLUTTERWAVE_WEBHOOK_SECRET,
  callback: process.env.PAYMENT_CALLBACK_URL
});
const publicHttpsUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname) ? url.toString() : "";
  } catch { return ""; }
};
const timingSafe = (a, b) => { const aa = Buffer.from(String(a || "")); const bb = Buffer.from(String(b || "")); return aa.length === bb.length && crypto.timingSafeEqual(aa, bb); };
const createWebhookSignature = (rawBody, secret) => crypto.createHmac("sha256", String(secret || "")).update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ""))).digest("base64");
const verifyWebhookSignature = ({ rawBody, signature, secret }) => Boolean(signature && secret) && timingSafe(signature, createWebhookSignature(rawBody, secret));
const readVerifiedWebhookEnvelope = ({ headers, rawBody }) => {
  const signature = headers["flutterwave-signature"];
  if (!verifyWebhookSignature({ rawBody, signature, secret: config().webhookSecret })) throw buildError("Invalid payment webhook signature.", 401, null, "INVALID_WEBHOOK_SIGNATURE");
  let payload; try { payload = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody)); } catch { throw buildError("Payment webhook body is not valid JSON.", 400, null, "INVALID_WEBHOOK_BODY"); }
  const data = payload?.data || {}; const eventId = String(payload?.id || ""); const chargeId = String(data.id || ""); const reference = String(data.reference || "");
  if (!eventId || !chargeId || !reference) throw buildError("Webhook event is missing its event ID, charge ID, or WMS reference.", 400);
  if (payload.type !== "charge.completed") throw buildError("Unsupported Flutterwave webhook event type.", 400);
  const bytes = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
  return { payload, data, eventId, chargeId, reference, payloadHash: crypto.createHash("sha256").update(bytes).digest("hex") };
};

const claimWebhookEvent = async ({ eventId, payloadHash, executor }) => {
  const inserted = await executor.query(`INSERT INTO payment_webhook_events(provider,event_id,payload_hash,processing_status) VALUES('flutterwave',$1,$2,'RECEIVED') ON CONFLICT(provider,event_id) DO NOTHING RETURNING id,processing_status`, [eventId, payloadHash]);
  if (inserted.rowCount) return { claimed: true, event: inserted.rows[0] };
  const existing = await executor.query("SELECT id,processing_status,payload_hash FROM payment_webhook_events WHERE provider='flutterwave' AND event_id=$1 FOR UPDATE", [eventId]);
  const event = existing.rows[0];
  if (!event) throw buildError("Webhook event claim could not be resolved.", 409, null, "WEBHOOK_EVENT_CLAIM_FAILED");
  if (event.processing_status === "PROCESSED") return { claimed: false, duplicate: true, event };
  const retry = await executor.query("UPDATE payment_webhook_events SET payload_hash=$1,processing_status='RECEIVED',processed_at=NULL WHERE id=$2 AND processing_status IN ('RECEIVED','FAILED') RETURNING id,processing_status", [payloadHash, event.id]);
  if (!retry.rowCount) return { claimed: false, duplicate: true, event };
  return { claimed: true, retry: true, event: retry.rows[0] };
};

const recordWebhookFailure = async ({ headers, rawBody, executor = db }) => {
  let envelope;
  try { envelope = readVerifiedWebhookEnvelope({ headers, rawBody }); } catch { return false; }
  await executor.query(`INSERT INTO payment_webhook_events(provider,event_id,payload_hash,processing_status,processed_at) VALUES('flutterwave',$1,$2,'FAILED',CURRENT_TIMESTAMP)
    ON CONFLICT(provider,event_id) DO UPDATE SET payload_hash=EXCLUDED.payload_hash,processing_status='FAILED',processed_at=CURRENT_TIMESTAMP
    WHERE payment_webhook_events.processing_status IN ('RECEIVED','FAILED')`, [envelope.eventId, envelope.payloadHash]);
  return true;
};
const markWebhookProcessed = async ({ eventRecordId, paymentId, executor }) => {
  const result = await executor.query("UPDATE payment_webhook_events SET payment_id=$1,processing_status='PROCESSED',processed_at=CURRENT_TIMESTAMP WHERE id=$2 AND processing_status='RECEIVED'", [paymentId, eventRecordId]);
  if (result.rowCount !== 1) throw buildError("Webhook event could not be finalized.", 409, null, "WEBHOOK_EVENT_FINALIZATION_FAILED");
  return result;
};

const providerRequest = async ({ path, method = "GET", payload, headers = {}, fetchImpl = global.fetch }) => {
  const cfg = config();
  if (cfg.provider !== "flutterwave" || cfg.environment !== "sandbox") throw buildError("Flutterwave v4 Sandbox is not the configured payment provider.", 500);
  const accessToken = await getAccessToken({ fetchImpl });
  const response = await fetchImpl(`${cfg.base}${path}`, { method, headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...headers }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.status === "failed") {
    logEvent("error", {
      operation: "flutterwave_provider_request",
      result: "failure",
      provider_path: path,
      http_status: response.status,
      provider_code: body?.error?.code || body?.code || null,
      provider_message: body?.message || body?.error?.message || "Provider request rejected"
    });
    const error = buildError("Flutterwave v4 rejected the payment request.", 502, null, "PAYMENT_PROVIDER_REQUEST_FAILED");
    error.providerCode = String(body?.error?.code || body?.code || "");
    error.providerStatus = response.status;
    throw error;
  }
  return body.data || body;
};

const createRegistrationInvoice = async ({ cargoReference, executor = db }) => {
  const existing = await executor.query(`SELECT i.*,c.cargo_id AS cargo_reference FROM invoices i JOIN cargo c ON c.id=i.cargo_id WHERE c.cargo_id=$1 AND i.auto_generated=TRUE ORDER BY i.created_at DESC LIMIT 1 FOR UPDATE OF i`, [cargoReference]);
  if (existing.rowCount) return existing.rows[0];
  const draft = await createOrRegenerateDraftInvoice({ payload: { cargo_reference: cargoReference }, auth: { username: "SYSTEM" }, executor });
  const updated = await executor.query(`UPDATE invoices SET auto_generated=TRUE,issued_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE public_invoice_number=$1 RETURNING *`, [draft.invoice_number]);
  await writeAuditLog({ user_id:null, action:"AUTOMATIC_INVOICE_CREATED_AT_REGISTRATION", module:"Billing and Payment", description:`System created pending-approval invoice ${draft.invoice_number} for ${cargoReference}.`, metadata:{system_actor:true,cargo_reference:cargoReference,invoice_reference:draft.invoice_number,payment_reference:null} }, executor);
  return { ...updated.rows[0], cargo_reference: cargoReference };
};

const activateRegistrationInvoice = async ({ cargoReference, executor = db }) => {
  let existing = (await executor.query(`SELECT i.*,c.cargo_id AS cargo_reference FROM invoices i JOIN cargo c ON c.id=i.cargo_id WHERE c.cargo_id=$1 AND i.auto_generated=TRUE AND i.status<>'Cancelled' ORDER BY i.created_at DESC LIMIT 1 FOR UPDATE OF i`, [cargoReference])).rows[0];
  if (!existing) { await createRegistrationInvoice({ cargoReference, executor }); existing = (await executor.query(`SELECT i.*,c.cargo_id AS cargo_reference FROM invoices i JOIN cargo c ON c.id=i.cargo_id WHERE c.cargo_id=$1 AND i.auto_generated=TRUE AND i.status<>'Cancelled' ORDER BY i.created_at DESC LIMIT 1 FOR UPDATE OF i`, [cargoReference])).rows[0]; }
  if (existing.payment_reference) return existing;
  if (existing.status === "Draft") await issueInvoice({ invoiceNumber: existing.public_invoice_number, auth: { username: "SYSTEM" }, executor });
  const paymentReference = await generatePublicReference("PAY", executor, "payments", "public_reference");
  const publicToken = crypto.randomBytes(32).toString("hex");
  const updated = await executor.query(`UPDATE invoices SET payment_reference=$1,payment_public_token=COALESCE(payment_public_token,$2),issued_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$3 RETURNING *`, [paymentReference, publicToken, existing.id]);
  await executor.query(`UPDATE tariff_versions SET operationally_used_at=COALESCE(operationally_used_at,CURRENT_TIMESTAMP) WHERE id=$1`, [updated.rows[0].tariff_version_id]);
  await writeAuditLog({ user_id:null, action:"AUTOMATIC_PAYMENT_REFERENCE_GENERATED", module:"Billing and Payment", description:`System activated invoice ${existing.public_invoice_number} after supervisor approval.`, metadata:{system_actor:true,cargo_reference:cargoReference,invoice_reference:existing.public_invoice_number,payment_reference:paymentReference} }, executor);
  await queueAndAttemptPaymentEmail({invoiceId:updated.rows[0].id,executor});
  return { ...updated.rows[0], cargo_reference: cargoReference };
};

const cancelRegistrationInvoice = async ({ cargoReference, reason, executor = db }) => {
  const invoice=(await executor.query(`SELECT i.* FROM invoices i JOIN cargo c ON c.id=i.cargo_id WHERE c.cargo_id=$1 AND i.auto_generated=TRUE AND i.status<>'Cancelled' ORDER BY i.created_at DESC LIMIT 1 FOR UPDATE OF i`,[cargoReference])).rows[0];
  if(!invoice) return null;
  if(centsFromAmount(invoice.amount_paid)>0n) throw buildError("A paid invoice cannot be cancelled automatically.",409);
  const updated=(await executor.query(`UPDATE invoices SET status='Cancelled',payment_reference=NULL,payment_public_token=NULL,cancelled_at=CURRENT_TIMESTAMP,cancellation_reason=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING *`,[reason,invoice.id])).rows[0];
  await updateCargoFinancialStatus({cargoId:invoice.cargo_id,executor});
  await writeAuditLog({user_id:null,action:"AUTOMATIC_INVOICE_CANCELLED_CARGO_REJECTED",module:"Billing and Payment",description:`System cancelled invoice ${invoice.public_invoice_number} because cargo ${cargoReference} was rejected.`,metadata:{system_actor:true,cargo_reference:cargoReference,invoice_reference:invoice.public_invoice_number,reason}},executor);
  return updated;
};

const normalizeName = (name) => { const parts = String(name || "External Cargo Customer").trim().split(/\s+/); return { first: parts.shift() || "External", last: parts.join(" ") || "Customer" }; };
const idempotencyKey = (scope, value) => `wms-${scope}-${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32)}`;
const findCustomerByEmail = async ({ email, fetchImpl }) => {
  const expected = String(email).trim().toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const customers = await providerRequest({ path: `/customers?page=${page}&size=50`, fetchImpl });
    const rows = Array.isArray(customers) ? customers : [];
    const match = rows.find((item) => String(item?.email || "").trim().toLowerCase() === expected);
    if (match) return match;
    if (rows.length < 50) break;
  }
  return null;
};
const resolveCustomerAndPaymentMethod = async ({ customer, fetchImpl }) => {
  if (customer.customer_id && customer.payment_method_id) return { customerId: String(customer.customer_id), paymentMethodId: String(customer.payment_method_id) };
  if (!customer.email || !customer.phone || !customer.network) throw buildError("Flutterwave v4 requires customer_id and payment_method_id, or external customer email, phone, and mobile-money network.", 400, null, "PAYMENT_CUSTOMER_DETAILS_REQUIRED");
  const digits = String(customer.phone).replace(/\D/g, ""); const countryCode = String(customer.country_code || "255").replace(/\D/g, ""); const localNumber = digits.startsWith(countryCode) ? digits.slice(countryCode.length) : digits.replace(/^0/, "");
  const email = String(customer.email).trim();
  let customerRecord;
  try {
    customerRecord = await providerRequest({ path: "/customers", method: "POST", fetchImpl, headers: { "X-Idempotency-Key": idempotencyKey("customer", email.toLowerCase()), "X-Trace-Id": idempotencyKey("customer-trace", email.toLowerCase()) }, payload: { email, name: normalizeName(customer.name), phone: { country_code: countryCode, number: localNumber }, meta: { source: "fumba_port_wms" } } });
  } catch (error) {
    if (error.providerCode !== "10409") throw error;
    customerRecord = await findCustomerByEmail({ email, fetchImpl });
    if (!customerRecord) throw buildError("Flutterwave reported an existing customer but it could not be retrieved.", 502, null, "PAYMENT_PROVIDER_CUSTOMER_CONFLICT");
  }
  if (!customerRecord.id) throw buildError("Flutterwave did not return a customer ID.", 502);
  const methodIdentity = `${customerRecord.id}:${countryCode}:${localNumber}:${String(customer.network).toLowerCase()}`;
  const paymentMethod = await providerRequest({ path: "/payment-methods", method: "POST", fetchImpl, headers: { "X-Idempotency-Key": idempotencyKey("payment-method", methodIdentity), "X-Trace-Id": idempotencyKey("payment-method-trace", methodIdentity) }, payload: { type: "mobile_money", customer_id: String(customerRecord.id), mobile_money: { country_code: countryCode, network: String(customer.network), phone_number: localNumber } } });
  if (!paymentMethod.id) throw buildError("Flutterwave did not return a payment-method ID.", 502);
  return { customerId: String(customerRecord.id), paymentMethodId: String(paymentMethod.id) };
};

const verifiedPaymentPredicate = `(gateway_provider='flutterwave' AND gateway_status='SUCCESSFUL' AND reconciliation_status='MATCHED') OR (gateway_provider IS NULL AND status='Confirmed')`;
const activeAttemptPredicate = `gateway_provider='flutterwave' AND gateway_status IN ('NOT_INITIATED','PENDING','PROCESSING')`;
const validateCustomerPaymentInput=({amount,customer,token,attemptReference})=>{
  if(token!==undefined&&!/^[a-f0-9]{64}$/i.test(String(token))) throw buildError("Invalid payment token.",400,null,"INVALID_PAYMENT_TOKEN");
  if(attemptReference!==undefined&&!/^PMT-[A-Z0-9-]{6,46}$/i.test(String(attemptReference))) throw buildError("Invalid payment attempt reference.",400,null,"INVALID_PAYMENT_ATTEMPT");
  if(amount!==undefined&&(!/^\d+(?:\.\d{1,2})?$/.test(String(amount))||centsFromAmount(amount)<=0n)) throw buildError("Installment amount must be a positive monetary value.",400,null,"INVALID_INSTALLMENT_AMOUNT");
  if(customer&&!customer.customer_id&&!customer.payment_method_id){
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(customer.email||"").trim())) throw buildError("Enter a valid customer email address.",400,null,"INVALID_CUSTOMER_EMAIL");
    if(!/^\+?[0-9\s()-]{7,24}$/.test(String(customer.phone||"").trim())) throw buildError("Enter a valid customer phone number.",400,null,"INVALID_CUSTOMER_PHONE");
    if(!/^[a-z0-9_-]{2,30}$/i.test(String(customer.network||"").trim())) throw buildError("Select a valid mobile-money network.",400,null,"INVALID_PAYMENT_NETWORK");
  }
};

const getPaymentSummary = async ({ token, paymentReference, executor = db, internal = false }) => {
  if(token) validateCustomerPaymentInput({token});
  const value = String(token || paymentReference || "").trim();
  const lookup = token ? "i.payment_public_token=$1" : "i.payment_reference=$1";
  const result = await executor.query(`SELECT i.id,i.public_invoice_number,i.payment_reference,i.total_amount,i.currency,i.status,i.payment_status,c.cargo_id AS cargo_reference FROM invoices i JOIN cargo c ON c.id=i.cargo_id WHERE ${lookup} AND i.status<>'Cancelled' LIMIT 1`, [value]);
  const invoice = result.rows[0];
  if (!invoice) throw buildError("Payment obligation was not found.", 404, null, "PAYMENT_NOT_FOUND");
  const totals = await executor.query(`SELECT COALESCE(SUM(COALESCE(amount_received,amount)) FILTER (WHERE ${verifiedPaymentPredicate}),0) AS paid,COUNT(*)::int AS installment_count FROM payments WHERE invoice_id=$1`, [invoice.id]);
  const total = centsFromAmount(invoice.total_amount); const paid = centsFromAmount(totals.rows[0]?.paid || 0); const outstanding = total > paid ? total - paid : 0n;
  const data = { cargo_reference:invoice.cargo_reference,invoice_reference:invoice.public_invoice_number,payment_reference:invoice.payment_reference,currency:invoice.currency,invoice_total:(Number(total)/100).toFixed(2),total_verified_paid:(Number(paid)/100).toFixed(2),outstanding_balance:(Number(outstanding)/100).toFixed(2),financial_status:outstanding===0n?"Fully Paid":paid>0n?"Partially Paid":"Outstanding",installment_count:totals.rows[0]?.installment_count||0 };
  if (internal) data.invoice_id=invoice.id;
  return data;
};

const getPaymentHistory = async ({ paymentReference, executor = db }) => {
  const summary = await getPaymentSummary({ paymentReference, executor, internal:true });
  const rows = await executor.query(`SELECT attempt_reference,public_reference,gateway_provider,gateway_transaction_id,expected_amount,amount_received,currency,gateway_status,status,payment_method,initiated_at,verified_at,reconciliation_status,failure_reason FROM payments WHERE invoice_id=$1 ORDER BY created_at ASC,id ASC`,[summary.invoice_id]);
  delete summary.invoice_id;
  return { ...summary, installments:rows.rows.map(row=>({ ...row,attempt_reference:row.attempt_reference||row.public_reference })) };
};

const getPaymentAttemptStatus = async ({ attemptReference, token, executor = db, internal = false }) => {
  validateCustomerPaymentInput({attemptReference,...(!internal?{token}:{})});
  const values=[String(attemptReference||"").trim()]; let tokenClause="";
  if (!internal) { values.push(String(token||"").trim()); tokenClause=" AND i.payment_public_token=$2"; }
  const result=await executor.query(`SELECT p.attempt_reference,p.payment_reference,p.gateway_transaction_id,p.expected_amount,p.amount_received,p.currency,p.gateway_status,p.status,p.reconciliation_status,p.failure_reason,p.initiated_at,p.verified_at FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE (p.attempt_reference=$1 OR p.public_reference=$1)${tokenClause} LIMIT 1`,values);
  if (!result.rowCount) throw buildError("Payment attempt was not found.",404,null,"PAYMENT_ATTEMPT_NOT_FOUND");
  return result.rows[0];
};

const initiatePayment = async ({ invoiceNumber, token, amount, customer = {}, auth, executor = db, fetchImpl = global.fetch }) => {
  validateCustomerPaymentInput({amount,customer,...(token?{token}:{})});
  const invoice = (await executor.query(`SELECT i.*,c.cargo_id AS cargo_reference,c.id AS cargo_record_id FROM invoices i JOIN cargo c ON c.id=i.cargo_id WHERE i.public_invoice_number=$1 FOR UPDATE OF i`, [invoiceNumber])).rows[0];
  if (!invoice || invoice.status === "Cancelled" || invoice.payment_status === "Paid" || (token && token !== invoice.payment_public_token)) throw buildError("A payable invoice was not found.", 409);
  const cfg = config(); if (cfg.provider !== "flutterwave" || !process.env.FLUTTERWAVE_CLIENT_ID || !process.env.FLUTTERWAVE_CLIENT_SECRET) throw buildError("Flutterwave v4 Sandbox credentials are not configured.", 503, null, "PAYMENT_PROVIDER_NOT_CONFIGURED");
  const paidRow=await executor.query(`SELECT COALESCE(SUM(amount_received) FILTER (WHERE ${verifiedPaymentPredicate}),0) AS paid,COALESCE(SUM(expected_amount) FILTER (WHERE ${activeAttemptPredicate}),0) AS reserved FROM payments WHERE invoice_id=$1`,[invoice.id]);
  const total=centsFromAmount(invoice.total_amount ?? invoice.outstanding_balance),paid=centsFromAmount(paidRow.rows[0]?.paid||0),reserved=centsFromAmount(paidRow.rows[0]?.reserved||0); const outstanding=total>paid?total-paid:0n; const available=outstanding>reserved?outstanding-reserved:0n;
  const requested=centsFromAmount(amount === undefined ? (Number(available)/100).toFixed(2) : amount);
  if(requested<=0n) throw buildError("Installment amount must be greater than zero.",400,null,"INVALID_INSTALLMENT_AMOUNT");
  if(requested>available) throw buildError("Installment amount exceeds the currently available outstanding balance.",409,{outstanding_balance:(Number(outstanding)/100).toFixed(2),available_balance:(Number(available)/100).toFixed(2)},"INSTALLMENT_EXCEEDS_OUTSTANDING");
  const attemptReference=await generatePublicReference("PMT",executor,"payments","public_reference"); const attemptKey=idempotencyKey("installment",`${invoice.payment_reference}:${attemptReference}`);
  const payment=(await executor.query(`INSERT INTO payments(public_reference,attempt_reference,idempotency_key,invoice_id,cargo_id,payment_reference,amount,expected_amount,currency,bank_name,payment_date,status,gateway_status,gateway_provider,recorded_by) VALUES($1,$1,$2,$3,$4,$5,$6,$6,$7,'Flutterwave v4 Sandbox',CURRENT_TIMESTAMP,'Gateway Pending','NOT_INITIATED','flutterwave',$8) RETURNING *`,[attemptReference,attemptKey,invoice.id,invoice.cargo_record_id,invoice.payment_reference,(Number(requested)/100).toFixed(2),invoice.currency,auth?.userId||null])).rows[0];
  const identifiers = await resolveCustomerAndPaymentMethod({ customer, fetchImpl });
  const callback = publicHttpsUrl(cfg.callback);
  const validatedAmount=(Number(requested)/100).toFixed(2);
  const charge = await providerRequest({ path: "/charges", method: "POST", fetchImpl, headers: { "X-Idempotency-Key": attemptKey, "X-Trace-Id": `wms-${attemptReference}` }, payload: { amount: Number(validatedAmount), currency: String(invoice.currency).toUpperCase(), customer_id: identifiers.customerId, payment_method_id: identifiers.paymentMethodId, reference: attemptReference, ...(callback ? { redirect_url: callback } : {}), meta: { wms_payment_reference: invoice.payment_reference,wms_payment_attempt:attemptReference,cargo_reference: invoice.cargo_reference, invoice_reference: invoice.public_invoice_number } } });
  if (!charge.id) throw buildError("Flutterwave v4 did not return a charge ID.", 502);
  const gatewayStatus = String(charge.status || "pending").toLowerCase() === "succeeded" ? "PROCESSING" : "PENDING";
  await executor.query(`UPDATE payments SET gateway_status=$1,initiated_at=COALESCE(initiated_at,CURRENT_TIMESTAMP),gateway_transaction_id=$2,payment_method='mobile_money',gateway_response=$3::jsonb WHERE id=$4`, [gatewayStatus, String(charge.id), JSON.stringify({ id: charge.id, status: charge.status, reference: charge.reference, next_action: charge.next_action || null }), payment.id]);
  await writeAuditLog({ user_id: auth?.userId || null, action: "PAYMENT_INITIATED", module: "Billing and Payment", description: `Initiated Flutterwave v4 charge ${charge.id} for ${invoice.payment_reference}.`, metadata: { payment_reference: invoice.payment_reference, invoice_reference: invoice.public_invoice_number, cargo_reference: invoice.cargo_reference, charge_id: String(charge.id) } }, executor);
  return { payment_reference: invoice.payment_reference,attempt_reference:attemptReference, invoice_reference: invoice.public_invoice_number, cargo_reference: invoice.cargo_reference,amount:validatedAmount, charge_id: String(charge.id), status: gatewayStatus, next_action: charge.next_action || null };
};

const verifyCharge = async (id, fetchImpl = global.fetch) => providerRequest({ path: `/charges/${encodeURIComponent(id)}`, fetchImpl });
const classifyVerifiedCharge = ({ providerStatus, received, expected, currency, expectedCurrency }) => {
  let status = "FAILED", reconciliation = "PENDING", failure = null;
  if (providerStatus === "succeeded") {
    if (currency !== expectedCurrency) { reconciliation = "EXCEPTION"; failure = "Currency mismatch"; }
    else if (received < expected) { reconciliation = "EXCEPTION"; failure = "Provider amount is below the validated installment"; }
    else if (received > expected) { reconciliation = "EXCEPTION"; failure = "Provider amount exceeds the validated installment"; }
    else { status = "SUCCESSFUL"; reconciliation = "MATCHED"; }
  } else if (providerStatus === "pending") status = "PENDING";
  else failure = `Provider status: ${providerStatus || "unknown"}`;
  return { status, reconciliation, failure };
};
const processWebhook = async ({ headers, rawBody, executor = db, fetchImpl = global.fetch }) => {
  const { data, eventId, chargeId, reference, payloadHash } = readVerifiedWebhookEnvelope({ headers, rawBody });
  const claim = await claimWebhookEvent({ eventId, payloadHash, executor });
  if (!claim.claimed) return { duplicate: true, event_id: eventId, processing_status: "PROCESSED" };
  const payment = (await executor.query(`SELECT p.*,i.total_amount,i.outstanding_balance,i.public_invoice_number,c.cargo_id AS cargo_reference FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN cargo c ON c.id=p.cargo_id WHERE (p.attempt_reference=$1 OR p.public_reference=$1) AND (p.gateway_transaction_id=$2 OR p.gateway_transaction_id IS NULL) FOR UPDATE OF p,i,c`, [reference,chargeId])).rows[0];
  if (!payment) throw buildError("Unknown WMS payment reference.", 404, null, "UNKNOWN_PAYMENT_REFERENCE");
  if (payment.gateway_transaction_id && String(payment.gateway_transaction_id) !== chargeId) throw buildError("Webhook charge does not belong to this payment.", 409, null, "PAYMENT_CHARGE_MISMATCH");
  let verified; try { verified = await verifyCharge(chargeId, fetchImpl); } catch (error) { await executor.query(`UPDATE payments SET gateway_status='PROCESSING',failure_reason='Verification temporarily failed' WHERE id=$1`, [payment.id]); throw error; }
  if (String(verified.id || "") !== chargeId || String(verified.reference || "") !== reference || reference !== String(payment.attempt_reference||payment.public_reference)) throw buildError("Verified charge reference or identity does not match the WMS payment.", 409, null, "PAYMENT_REFERENCE_MISMATCH");
  const received = centsFromAmount(verified.amount || 0); const expected = centsFromAmount(payment.expected_amount); const currency = String(verified.currency || "").toUpperCase(); const providerStatus = String(verified.status || "").toLowerCase();
  const { status, reconciliation, failure } = classifyVerifiedCharge({ providerStatus, received, expected, currency, expectedCurrency: String(payment.currency).toUpperCase() });
  await executor.query(`UPDATE payments SET amount=$1,amount_received=$1,currency=$2,gateway_status=$3,status=CASE WHEN $3='SUCCESSFUL' THEN 'Confirmed' WHEN $3='FAILED' THEN 'Gateway Failed' ELSE 'Gateway Pending' END,gateway_transaction_id=$4,gateway_event_id=$5,payment_method=$6,verified_at=CASE WHEN $3='SUCCESSFUL' THEN CURRENT_TIMESTAMP END,failed_at=CASE WHEN $3='FAILED' THEN CURRENT_TIMESTAMP END,failure_reason=$7,reconciliation_status=$8,gateway_response=$9::jsonb,confirmed_at=CASE WHEN $3='SUCCESSFUL' THEN CURRENT_TIMESTAMP ELSE confirmed_at END WHERE id=$10`, [verified.amount || 0, currency, status, chargeId, eventId, verified.payment_method_details?.type || payment.payment_method || null, failure, reconciliation, JSON.stringify({ id: chargeId, status: providerStatus, amount: verified.amount, currency, reference: verified.reference }), payment.id]);
  await markWebhookProcessed({ eventRecordId: claim.event.id, paymentId: payment.id, executor });
  const invoice = await refreshInvoicePaymentStatus({ invoiceId: payment.invoice_id, executor }); const cargo = await updateCargoFinancialStatus({ cargoId: payment.cargo_id, executor }); const readiness = await recalculateReleaseReadiness({ cargoId: payment.cargo_id, executor, trigger: "PAYMENT_WEBHOOK" });
  await writeAuditLog({ user_id: null, action: status === "SUCCESSFUL" ? "PAYMENT_VERIFIED" : status === "FAILED" ? "PAYMENT_FAILED" : "PAYMENT_PENDING", module: "Billing and Payment", description: `Flutterwave v4 charge ${chargeId} for ${reference} verified as ${status}.`, metadata: { system_actor: true, event_id: eventId, charge_id: chargeId, expected_amount: payment.expected_amount, received_amount: String(verified.amount), currency, reconciliation } }, executor);
  await createNotificationsForAudience({ notification_type: "finance_payment_update", title: `Payment ${status}`, message: `${reference} for ${payment.cargo_reference}: ${currency} ${verified.amount}.`, related_module: "Billing and Payment", priority: status === "SUCCESSFUL" ? "high" : "normal", metadata: { deep_link: "/finance?section=payments" } }, { roleName: "Finance Officer" }, executor, { fallbackBroadTarget: true });
  return { payment_reference: payment.payment_reference,attempt_reference:reference, charge_id: chargeId, status, reconciliation_status: reconciliation, invoice_status: invoice?.status, cargo_financial_status: cargo?.financial_status, release_readiness: readiness };
};

module.exports = { activateRegistrationInvoice, cancelRegistrationInvoice, claimWebhookEvent, classifyVerifiedCharge, config, createRegistrationInvoice, createWebhookSignature, ensureAutomaticInvoice: activateRegistrationInvoice, findCustomerByEmail,getPaymentAttemptStatus,getPaymentHistory,getPaymentSummary, initiatePayment, markWebhookProcessed, processWebhook, providerRequest, publicHttpsUrl, readVerifiedWebhookEnvelope, recordWebhookFailure, resolveCustomerAndPaymentMethod, timingSafe,validateCustomerPaymentInput, verifyCharge, verifyWebhookSignature };

const test = require("node:test");
const assert = require("node:assert/strict");
const payment = require("../services/paymentService");
const email = require("../services/emailService");
const { evaluate } = require("../services/releaseReadinessService");

test("complete customer payment workflow lifecycle, scenarios, and invariants", async () => {
  // Mock DB state simulating invoice, cargo, payments, and webhooks
  let invoiceRow = {
    id: 101,
    public_invoice_number: "INV-2026-TEST01",
    cargo_id: 501,
    cargo_reference: "CRG-2026-TEST01",
    total_amount: "500000.00",
    amount_paid: "0.00",
    outstanding_balance: "500000.00",
    currency: "TZS",
    status: "Draft",
    payment_status: "Unpaid",
    auto_generated: true,
    payment_reference: null,
    payment_public_token: null
  };

  const payments = [];
  const emailDeliveries = [];

  const executor = {
    query: async (sql, params = []) => {
      const queryStr = String(sql);

      if (queryStr.includes("FROM notifications")) {
        return { rows: [], rowCount: 0 };
      }

      if (queryStr.includes("INSERT INTO notifications") || queryStr.includes("INSERT INTO notification_recipients")) {
        return { rows: [{ id: 1 }], rowCount: 1 };
      }

      if (queryStr.includes("FROM system_users")) {
        return { rows: [{ user_id: 1, role_code: "finance-officer" }], rowCount: 1 };
      }

      if (queryStr.includes("FROM cargo WHERE") || queryStr.includes("FROM cargo c WHERE")) {
        return { rows: [{ id: 501, cargo_id: "CRG-2026-TEST01", cargo_type: "Standard", financial_status: invoiceRow.payment_status, charge_start_at: new Date(Date.now() - 24 * 3600000), charge_end_at: new Date(), created_at: new Date() }], rowCount: 1 };
      }

      if (queryStr.includes("tariff_versions")) {
        return { rows: [{ public_reference: "TV-1", tariff_name: "Standard Tariff", cargo_type: "Standard", charging_unit: "fixed_daily_charge", calculator_key: "storage_started_day", daily_rate: "10000.00", currency: "TZS", minimum_billable_days: 1, grace_period_days: 0, penalty_type: "none", effective_from: new Date("2020-01-01"), effective_to: null, is_active: true, approval_status: "APPROVED" }], rowCount: 1 };
      }

      if (queryStr.includes("SELECT i.payment_public_token") || queryStr.includes("FROM invoices i JOIN cargo c")) {
        return { rows: [{ ...invoiceRow, invoice_reference: invoiceRow.public_invoice_number, recipient: "customer@example.com" }], rowCount: 1 };
      }

      if (queryStr.includes("SELECT i.*, c.cargo_id AS cargo_reference") || queryStr.includes("SELECT i.*,c.cargo_id AS cargo_reference FROM invoices i") || queryStr.includes("public_invoice_number")) {
        if (invoiceRow.status === "Cancelled") return { rows: [], rowCount: 0 };
        return { rows: [invoiceRow], rowCount: 1 };
      }

      if (queryStr.includes("status = 'Issued'")) {
        invoiceRow.status = "Issued";
        return { rows: [invoiceRow], rowCount: 1 };
      }

      if (queryStr.includes("UPDATE invoices SET payment_public_token")) {
        invoiceRow.payment_public_token = params[0];
        return { rows: [invoiceRow], rowCount: 1 };
      }

      if (queryStr.includes("UPDATE invoices SET payment_reference=")) {
        invoiceRow.payment_reference = params[0];
        invoiceRow.status = "Issued";
        return { rows: [invoiceRow], rowCount: 1 };
      }

      if (queryStr.includes("UPDATE invoices SET status='Cancelled'")) {
        invoiceRow.status = "Cancelled";
        invoiceRow.payment_reference = null;
        invoiceRow.payment_public_token = null;
        return { rows: [invoiceRow], rowCount: 1 };
      }

      if (queryStr.includes("INSERT INTO payment_email_deliveries")) {
        const del = { invoice_id: params[0], recipient: params[1], delivery_status: params[2], last_error: params[3] };
        emailDeliveries.push(del);
        return { rows: [del], rowCount: 1 };
      }

      if (queryStr.includes("SELECT * FROM payment_email_deliveries")) {
        return { rows: emailDeliveries, rowCount: emailDeliveries.length };
      }

      if (queryStr.includes("UPDATE payment_email_deliveries")) {
        if (emailDeliveries.length > 0) emailDeliveries[0].delivery_status = params[0] || "SENT";
        return { rows: emailDeliveries, rowCount: emailDeliveries.length };
      }

      if (queryStr.includes("SELECT COALESCE(SUM(COALESCE(amount_received,amount)) FILTER (WHERE")) {
        const verifiedPayments = payments.filter((p) => p.gateway_status === "SUCCESSFUL" && p.reconciliation_status === "MATCHED");
        const paidSum = verifiedPayments.reduce((acc, p) => acc + Number(p.amount_received || p.amount || 0), 0);
        return { rows: [{ paid: paidSum.toFixed(2), installment_count: payments.length }], rowCount: 1 };
      }

      if (queryStr.includes("SELECT COALESCE(SUM(amount_received) FILTER (WHERE")) {
        const verifiedPayments = payments.filter((p) => p.gateway_status === "SUCCESSFUL" && p.reconciliation_status === "MATCHED");
        const paidSum = verifiedPayments.reduce((acc, p) => acc + Number(p.amount_received || p.amount || 0), 0);
        const activeAttempts = payments.filter((p) => ["NOT_INITIATED", "PENDING", "PROCESSING"].includes(p.gateway_status));
        const reservedSum = activeAttempts.reduce((acc, p) => acc + Number(p.expected_amount || 0), 0);
        return { rows: [{ paid: paidSum.toFixed(2), reserved: reservedSum.toFixed(2) }], rowCount: 1 };
      }

      if (queryStr.includes("SELECT attempt_reference,public_reference")) {
        return { rows: payments, rowCount: payments.length };
      }

      if (queryStr.includes("INSERT INTO payments")) {
        const pmt = {
          id: payments.length + 1,
          public_reference: params[0],
          attempt_reference: params[0],
          idempotency_key: params[1],
          invoice_id: params[2],
          cargo_id: params[3],
          payment_reference: params[4],
          amount: params[5],
          expected_amount: params[5],
          amount_received: "0.00",
          currency: params[6],
          gateway_provider: "flutterwave",
          gateway_status: "NOT_INITIATED",
          status: "Gateway Pending",
          reconciliation_status: "PENDING",
          created_at: new Date()
        };
        payments.push(pmt);
        return { rows: [pmt], rowCount: 1 };
      }

      if (queryStr.includes("UPDATE payments SET gateway_status=$1")) {
        const pmt = payments.find((p) => p.id === params[3] || p.attempt_reference === params[3]);
        if (pmt) {
          pmt.gateway_status = params[0];
          pmt.gateway_transaction_id = params[1];
        }
        return { rows: payments, rowCount: payments.length };
      }

      if (queryStr.toLowerCase().includes("update payments")) {
        const pmtId = params[9] || params[3];
        const pmt = payments.find((p) => p.id === pmtId || p.attempt_reference === pmtId || p.gateway_transaction_id === pmtId) || payments[payments.length - 1];
        if (pmt) {
          pmt.amount = String(params[0]);
          pmt.amount_received = String(params[0]);
          pmt.currency = params[1];
          pmt.gateway_status = params[2];
          pmt.status = params[2] === "SUCCESSFUL" ? "Confirmed" : params[2] === "FAILED" ? "Gateway Failed" : "Gateway Pending";
          pmt.gateway_transaction_id = params[3];
          pmt.failure_reason = params[6];
          pmt.reconciliation_status = params[7];
        }
        return { rows: payments, rowCount: payments.length };
      }

      if (queryStr.includes("UPDATE invoices SET status = $1")) {
        invoiceRow.status = params[0];
        invoiceRow.payment_status = params[1];
        invoiceRow.amount_paid = String(params[2]);
        invoiceRow.outstanding_balance = String(params[3]);
        return { rows: [invoiceRow], rowCount: 1 };
      }

      if (queryStr.includes("SELECT * FROM invoices WHERE id = $1")) {
        return { rows: [invoiceRow], rowCount: 1 };
      }

      if (queryStr.includes("SELECT 1 FROM payments WHERE public_reference")) {
        return { rows: [], rowCount: 0 };
      }

      return { rows: [], rowCount: 0 };
    }
  };

  // 1. Cargo Registration & Approval Activation
  const activated = await payment.activateRegistrationInvoice({ cargoReference: "CRG-2026-TEST01", executor });
  assert.ok(activated.payment_reference.startsWith("PAY-"));
  assert.ok(activated.payment_public_token);
  assert.equal(activated.status, "Issued");

  // Email Render Check
  const emailData = await email.loadDeliveryData({ invoiceId: activated.id, executor });
  const rendered = email.renderPaymentEmail(emailData);
  assert.match(rendered.text, /Cargo Reference: CRG-2026-TEST01/);
  assert.match(rendered.text, /Invoice Reference: INV-2026-TEST01/);
  assert.match(rendered.text, /PAY Payment Reference: PAY-/);
  assert.match(rendered.text, /Total Invoice Amount: TZS 500000.00/);

  // 2. Public Payment Portal Summary
  const token = activated.payment_public_token;
  const summary = await payment.getPaymentSummary({ token, executor });
  assert.equal(summary.invoice_total, "500000.00");
  assert.equal(summary.total_verified_paid, "0.00");
  assert.equal(summary.outstanding_balance, "500000.00");

  // 3. Installment 1: PMT-001 (TZS 100,000) -> SUCCESS
  const mockFetchSuccess = async (url) => {
    if (url.includes("/customers")) return { ok: true, json: async () => ({ id: "cus_1" }) };
    if (url.includes("/payment-methods")) return { ok: true, json: async () => ({ id: "pmd_1" }) };
    if (url.includes("/charges/chg_100")) return { ok: true, json: async () => ({ id: "chg_100", reference: payments[0].attempt_reference, amount: 100000, currency: "TZS", status: "succeeded" }) };
    if (url.includes("/charges")) return { ok: true, json: async () => ({ id: "chg_100", status: "pending", reference: payments[0]?.attempt_reference || "PMT-1", next_action: { type: "payment_instruction", payment_instruction: { note: "Authorize on 255712345678" } } }) };
    return { ok: true, json: async () => ({ access_token: "mock-token", expires_in: 600 }) };
  };

  const pmt1 = await payment.initiatePayment({
    invoiceNumber: summary.invoice_reference,
    token,
    amount: "100000.00",
    customer: { email: "customer@example.com", phone: "0712345678", network: "airtel" },
    executor,
    fetchImpl: mockFetchSuccess
  });
  assert.ok(pmt1.attempt_reference.startsWith("PMT-"));
  assert.equal(pmt1.amount, "100000.00");

  // Settle PMT1 as SUCCESSFUL
  const targetPmt1 = payments[0];
  await payment.settlePaymentAttempt({ payment: targetPmt1, verified: { id: "chg_100", reference: targetPmt1.attempt_reference, amount: 100000, currency: "TZS", status: "succeeded" }, executor });

  const summaryAfterPmt1 = await payment.getPaymentSummary({ token, executor });
  assert.equal(summaryAfterPmt1.total_verified_paid, "100000.00");
  assert.equal(summaryAfterPmt1.outstanding_balance, "400000.00");
  assert.equal(summaryAfterPmt1.financial_status, "Partially Paid");

  // 4. Installment 2: PMT-002 (TZS 150,000) -> PENDING
  const mockFetchPending = async (url) => {
    if (url.includes("/customers")) return { ok: true, json: async () => ({ id: "cus_1" }) };
    if (url.includes("/payment-methods")) return { ok: true, json: async () => ({ id: "pmd_1" }) };
    if (url.includes("/charges/chg_150_pend")) return { ok: true, json: async () => ({ id: "chg_150_pend", reference: payments[1].attempt_reference, amount: 150000, currency: "TZS", status: "pending" }) };
    if (url.includes("/charges")) return { ok: true, json: async () => ({ id: "chg_150_pend", status: "pending", reference: payments[1]?.attempt_reference || "PMT-2" }) };
    return { ok: true, json: async () => ({ access_token: "mock-token", expires_in: 600 }) };
  };

  const pmt2 = await payment.initiatePayment({
    invoiceNumber: summary.invoice_reference,
    token,
    amount: "150000.00",
    customer: { email: "customer@example.com", phone: "0712345678", network: "tigo" },
    executor,
    fetchImpl: mockFetchPending
  });

  const targetPmt2 = payments[1];
  await payment.settlePaymentAttempt({ payment: targetPmt2, verified: { id: "chg_150_pend", reference: targetPmt2.attempt_reference, amount: 150000, currency: "TZS", status: "pending" }, executor });

  const summaryAfterPmt2 = await payment.getPaymentSummary({ token, executor });
  assert.equal(summaryAfterPmt2.total_verified_paid, "100000.00"); // Balance unchanged for pending
  assert.equal(summaryAfterPmt2.outstanding_balance, "400000.00");

  // 5. Installment 3: PMT-003 (TZS 150,000) -> FAILED
  const targetPmt3 = { id: 3, attempt_reference: "PMT-TEST-FAILED", expected_amount: "150000.00", currency: "TZS", invoice_id: activated.id, cargo_id: 501, payment_reference: activated.payment_reference };
  payments.push(targetPmt3);
  await payment.settlePaymentAttempt({ payment: targetPmt3, verified: { id: "chg_failed", reference: "PMT-TEST-FAILED", amount: 0, currency: "TZS", status: "failed" }, executor });

  const summaryAfterPmt3 = await payment.getPaymentSummary({ token, executor });
  assert.equal(summaryAfterPmt3.total_verified_paid, "100000.00"); // Balance unchanged for failed
  assert.equal(summaryAfterPmt3.outstanding_balance, "400000.00");

  // 6. Retried Installment: PMT-004 (TZS 150,000) -> SUCCESS
  const targetPmt4 = { id: 4, attempt_reference: "PMT-TEST-RETRY", expected_amount: "150000.00", currency: "TZS", invoice_id: activated.id, cargo_id: 501, payment_reference: activated.payment_reference };
  payments.push(targetPmt4);
  await payment.settlePaymentAttempt({ payment: targetPmt4, verified: { id: "chg_retry_ok", reference: "PMT-TEST-RETRY", amount: 150000, currency: "TZS", status: "succeeded" }, executor });

  const summaryAfterPmt4 = await payment.getPaymentSummary({ token, executor });
  assert.equal(summaryAfterPmt4.total_verified_paid, "250000.00");
  assert.equal(summaryAfterPmt4.outstanding_balance, "250000.00");

  // 7. Final Installment: PMT-005 (TZS 250,000) -> SUCCESS -> Fully Paid
  const targetPmt5 = { id: 5, attempt_reference: "PMT-TEST-FINAL", expected_amount: "250000.00", currency: "TZS", invoice_id: activated.id, cargo_id: 501, payment_reference: activated.payment_reference };
  payments.push(targetPmt5);
  await payment.settlePaymentAttempt({ payment: targetPmt5, verified: { id: "chg_final_ok", reference: "PMT-TEST-FINAL", amount: 250000, currency: "TZS", status: "succeeded" }, executor });

  const finalSummary = await payment.getPaymentSummary({ token, executor });
  assert.equal(finalSummary.total_verified_paid, "500000.00");
  assert.equal(finalSummary.outstanding_balance, "0.00");
  assert.equal(finalSummary.financial_status, "Fully Paid");

  // Release readiness check with Customs Cleared
  const readiness = evaluate({
    registration_status: "Approved",
    placement_status: "Placed",
    current_bin_id: 10,
    customs_status: "Cleared",
    financial_status: "Fully Paid",
    release_type: "NORMAL",
    management_release_status: "NOT_REQUIRED",
    gate_out_status: "Not Released"
  });
  assert.equal(readiness.status, "READY_FOR_RELEASE");

  // Release readiness check with Customs Pending
  const readinessCustomsBlocked = evaluate({
    registration_status: "Approved",
    placement_status: "Placed",
    current_bin_id: 10,
    customs_status: "Pending Inspection",
    financial_status: "Fully Paid",
    release_type: "NORMAL",
    management_release_status: "NOT_REQUIRED",
    gate_out_status: "Not Released"
  });
  assert.equal(readinessCustomsBlocked.status, "WAITING_CUSTOMS");

  // Payment History Check
  const history = await payment.getPaymentHistory({ paymentReference: activated.payment_reference, executor });
  assert.equal(history.installments.length, 5);
});

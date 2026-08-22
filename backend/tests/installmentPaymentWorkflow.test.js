const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const payment=require("../services/paymentService");
const { evaluate }=require("../services/releaseReadinessService");

test("payment summary sums only verified matched installments and calculates the balance",async()=>{
  const executor={query:async(sql)=>{
    if(sql.includes("FROM invoices i")) return {rows:[{id:1,public_invoice_number:"INV-1",payment_reference:"PAY-1",total_amount:"500000.00",currency:"TZS",status:"Partially Paid",payment_status:"Partially Paid",cargo_reference:"CRG-1"}],rowCount:1};
    assert.match(sql,/gateway_status='SUCCESSFUL'.*reconciliation_status='MATCHED'/s);
    return {rows:[{paid:"250000.00",installment_count:4}],rowCount:1};
  }};
  const result=await payment.getPaymentSummary({token:"a".repeat(64),executor});
  assert.equal(result.total_verified_paid,"250000.00");
  assert.equal(result.outstanding_balance,"250000.00");
  assert.equal(result.financial_status,"Partially Paid");
  assert.equal(result.installment_count,4);
});

test("final combined verified total maps to Fully Paid",async()=>{
  const executor={query:async(sql)=>sql.includes("FROM invoices i")?{rows:[{id:1,public_invoice_number:"INV-1",payment_reference:"PAY-1",total_amount:"500000.00",currency:"TZS",cargo_reference:"CRG-1"}],rowCount:1}:{rows:[{paid:"500000.00",installment_count:3}],rowCount:1}};
  assert.equal((await payment.getPaymentSummary({paymentReference:"PAY-1",executor})).financial_status,"Fully Paid");
});

test("pending failed voided wrong amount and wrong currency cannot become matched success",()=>{
  const classify=(status,received=100n,currency="TZS")=>payment.classifyVerifiedCharge({providerStatus:status,received,expected:100n,currency,expectedCurrency:"TZS"});
  assert.notEqual(classify("pending").status,"SUCCESSFUL");
  assert.notEqual(classify("failed").status,"SUCCESSFUL");
  assert.notEqual(classify("voided").status,"SUCCESSFUL");
  assert.equal(classify("succeeded",99n).reconciliation,"EXCEPTION");
  assert.equal(classify("succeeded",100n,"USD").reconciliation,"EXCEPTION");
});

test("installment architecture uses unique attempts, active reservations, charge identity, and token-only public APIs",()=>{
  const service=fs.readFileSync(path.join(__dirname,"../services/paymentService.js"),"utf8");
  const migration=fs.readFileSync(path.join(__dirname,"../database/migrations/20260822_installment_payment_workflow.sql"),"utf8");
  const routes=fs.readFileSync(path.join(__dirname,"../routes/publicPaymentRoutes.js"),"utf8");
  assert.match(service,/generatePublicReference\("PMT"/);
  assert.match(service,/X-Idempotency-Key": attemptKey/);
  assert.match(service,/wms_payment_reference: invoice\.payment_reference/);
  assert.match(service,/activeAttemptPredicate/);
  assert.match(service,/FOR UPDATE OF i/);
  assert.match(migration,/payment_public_token/);
  assert.match(migration,/payments_attempt_reference_unique/);
  assert.match(routes,/publicSummary/);
  assert.doesNotMatch(routes,/requirePermission/);
});

test("partial payment remains blocked, final payment is ready only when Customs and other checks pass",()=>{
  const base={registration_status:"Approved",placement_status:"Placed",current_bin_id:1,customs_status:"Cleared",financial_status:"Partially Paid",release_type:"NORMAL",management_release_status:"NOT_REQUIRED",gate_out_status:"Not Released"};
  assert.equal(evaluate(base).status,"WAITING_PAYMENT");
  assert.equal(evaluate({...base,financial_status:"Fully Paid"}).status,"READY_FOR_RELEASE");
  assert.equal(evaluate({...base,financial_status:"Fully Paid",customs_status:"Pending Inspection"}).status,"WAITING_CUSTOMS");
  assert.equal(evaluate({...base,release_type:"MANAGEMENT",management_release_status:"APPROVED"}).status,"READY_FOR_RELEASE");
});

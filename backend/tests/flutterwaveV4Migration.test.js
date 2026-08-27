const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const oauth = require("../services/flutterwaveOAuthService");
const payment = require("../services/paymentService");

const response = (body, ok = true) => ({ ok, status: ok ? 200 : 401, json: async () => body });
const setCredentials = () => {
  process.env.PAYMENT_PROVIDER = "flutterwave";
  process.env.PAYMENT_ENVIRONMENT = "sandbox";
  process.env.FLUTTERWAVE_API_BASE_URL = "https://developersandbox-api.flutterwave.com";
  process.env.FLUTTERWAVE_OAUTH_TOKEN_URL = "https://idp.flutterwave.test/token";
  process.env.FLUTTERWAVE_CLIENT_ID = "test-client-id";
  process.env.FLUTTERWAVE_CLIENT_SECRET = "test-client-secret";
  process.env.FLUTTERWAVE_WEBHOOK_SECRET = "test-webhook-secret";
};

test.beforeEach(() => { setCredentials(); oauth.resetTokenCacheForTests(); });

test("OAuth client credentials obtain an access token without JSON or query credentials", async () => {
  let request;
  const token = await oauth.getAccessToken({ fetchImpl: async (url, options) => { request = { url, options }; return response({ access_token: "token-one", expires_in: 600 }); }, now: () => 1000 });
  assert.equal(token, "token-one");
  assert.equal(request.options.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.match(request.options.body, /client_id=test-client-id/);
  assert.match(request.options.body, /grant_type=client_credentials/);
});

test("valid cached OAuth token is reused", async () => {
  let calls = 0; const fetchImpl = async () => { calls += 1; return response({ access_token: "cached", expires_in: 600 }); };
  assert.equal(await oauth.getAccessToken({ fetchImpl, now: () => 1000 }), "cached");
  assert.equal(await oauth.getAccessToken({ fetchImpl, now: () => 2000 }), "cached");
  assert.equal(calls, 1);
});

test("expired OAuth token is refreshed and concurrent refresh is coalesced", async () => {
  let calls = 0; const fetchImpl = async () => { calls += 1; return response({ access_token: `token-${calls}`, expires_in: 61 }); };
  await oauth.getAccessToken({ fetchImpl, now: () => 1000 });
  const values = await Promise.all([oauth.getAccessToken({ fetchImpl, now: () => 3000 }), oauth.getAccessToken({ fetchImpl, now: () => 3000 })]);
  assert.deepEqual(values, ["token-2", "token-2"]); assert.equal(calls, 2);
});

test("OAuth failure safely rejects provider access", async () => {
  await assert.rejects(() => oauth.getAccessToken({ fetchImpl: async () => response({ error: "invalid_client" }, false) }), /OAuth authentication failed/);
});

test("v4 provider request uses OAuth bearer token and creates an idempotent charge", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return calls.length === 1 ? response({ access_token: "oauth-token", expires_in: 600 }) : response({ status: "success", data: { id: "chg_123", status: "pending", reference: "PAY-2026-ABCDEF" } }); };
  const charge = await payment.providerRequest({ path: "/charges", method: "POST", payload: { amount: 100000, currency: "TZS", customer_id: "cus_1", payment_method_id: "pmd_1", reference: "PAY-2026-ABCDEF" }, headers: { "X-Idempotency-Key": "PAY-2026-ABCDEF" }, fetchImpl });
  assert.equal(charge.id, "chg_123"); assert.equal(calls[1].url, "https://developersandbox-api.flutterwave.com/charges");
  assert.equal(calls[1].options.headers.Authorization, "Bearer oauth-token"); assert.equal(calls[1].options.headers["X-Idempotency-Key"], "PAY-2026-ABCDEF");
});

test("provider rejection remains a safe application error", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return response({ access_token: "oauth-token", expires_in: 600 });
    return { ok: false, status: 400, json: async () => ({ status: "failed", message: "Invalid request", error: { code: "VALIDATION_ERROR" } }) };
  };
  await assert.rejects(
    () => payment.providerRequest({ path: "/customers", method: "POST", payload: { email: "uat@example.invalid" }, fetchImpl }),
    (error) => error.errorCode === "PAYMENT_PROVIDER_REQUEST_FAILED" && !String(error.message).includes("oauth-token")
  );
});

test("existing Flutterwave customer conflict is resolved and reused", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (calls.length === 1) return response({ access_token: "oauth-token", expires_in: 600 });
    if (url.endsWith("/customers") && options.method === "POST") return { ok: false, status: 409, json: async () => ({ status: "failed", message: "Customer already exists", error: { code: "10409" } }) };
    if (url.includes("/customers?page=1")) return response({ status: "success", data: [{ id: "cus_existing", email: "uat@example.invalid" }] });
    if (url.endsWith("/payment-methods")) return response({ status: "success", data: { id: "pmd_new" } });
    throw new Error(`Unexpected request: ${url}`);
  };
  const result = await payment.resolveCustomerAndPaymentMethod({ customer: { email: "UAT@example.invalid", phone: "0712345678", country_code: "255", network: "airtel" }, fetchImpl });
  assert.deepEqual(result, { customerId: "cus_existing", paymentMethodId: "pmd_new" });
  const methodCall = calls.find((item) => item.url.endsWith("/payment-methods"));
  assert.match(methodCall.options.headers["X-Idempotency-Key"], /^wms-payment-method-/);
});

test("charge retrieval uses GET /charges/{charge_id}", async () => {
  const urls=[]; const fetchImpl=async(url)=>{urls.push(url);return urls.length===1?response({access_token:"t",expires_in:600}):response({status:"success",data:{id:"chg_X",status:"succeeded"}})};
  assert.equal((await payment.verifyCharge("chg_X",fetchImpl)).status,"succeeded"); assert.equal(urls[1],"https://developersandbox-api.flutterwave.com/charges/chg_X");
});

test("payment initiation maps WMS invoice data and stores the returned charge ID", async () => {
  const queries=[];
  const executor={query:async(sql,params=[])=>{queries.push({sql,params});if(sql.includes("SELECT i.*,c.cargo_id"))return{rows:[{id:4,public_invoice_number:"INV-2026-A",cargo_reference:"CRG-2026-A",cargo_record_id:7,payment_reference:"PAY-2026-ABCDEF",outstanding_balance:"100000.00",currency:"TZS",status:"Issued",payment_status:"Unpaid"}],rowCount:1};if(sql.includes("SELECT 1 FROM payments WHERE public_reference"))return{rows:[],rowCount:0};if(sql.includes("INSERT INTO payments"))return{rows:[{id:9}],rowCount:1};return{rows:[{}],rowCount:1}}};
  const calls=[];const fetchImpl=async(url,options)=>{calls.push({url,options});if(calls.length===1)return response({access_token:"oauth",expires_in:600});const body=JSON.parse(options.body);return response({status:"success",data:{id:"chg_WMS",status:"pending",reference:body.reference,next_action:{type:"payment_instruction"}}})};
  const result=await payment.initiatePayment({invoiceNumber:"INV-2026-A",customer:{customer_id:"cus_1",payment_method_id:"pmd_1"},auth:{userId:3},executor,fetchImpl});
  assert.equal(result.charge_id,"chg_WMS");const chargeBody=JSON.parse(calls[1].options.body);assert.equal(chargeBody.amount,100000);assert.equal(chargeBody.currency,"TZS");assert.match(chargeBody.reference,/^PMT-/);assert.equal(chargeBody.meta.wms_payment_reference,"PAY-2026-ABCDEF");assert.equal(chargeBody.meta.cargo_reference,"CRG-2026-A");assert.notEqual(calls[1].options.headers["X-Idempotency-Key"],"PAY-2026-ABCDEF");assert.equal(calls[1].options.headers["X-Scenario-Key"],"scenario:auth_redirect");
  const update=queries.find(item=>item.sql.includes("gateway_transaction_id=$2"));assert.equal(update.params[1],"chg_WMS");
});

test("localhost callback is omitted while a public HTTPS callback is accepted", () => {
  assert.equal(payment.publicHttpsUrl("http://localhost:3000/finance/payments/return"), "");
  assert.equal(payment.publicHttpsUrl("http://127.0.0.1:3000/return"), "");
  assert.equal(payment.publicHttpsUrl("https://payments.example.test/return"), "https://payments.example.test/return");
});

test("public payment return URL restores the same token-scoped payment page", () => {
  const original = process.env.PUBLIC_PAYMENT_BASE_URL;
  process.env.PUBLIC_PAYMENT_BASE_URL = "https://payments.example.test";
  try {
    assert.equal(
      payment.publicPaymentReturnUrl({ token: "secure-token", attemptReference: "PMT-2026-RETURN" }),
      "https://payments.example.test/pay/secure-token?attempt=PMT-2026-RETURN"
    );
  } finally {
    if (original === undefined) delete process.env.PUBLIC_PAYMENT_BASE_URL;
    else process.env.PUBLIC_PAYMENT_BASE_URL = original;
  }
});

test("duplicate signed processed webhook event is acknowledged without verification or settlement", async () => {
  const raw=Buffer.from(JSON.stringify({id:"wbk_duplicate",type:"charge.completed",data:{id:"chg_1",reference:"PAY-2026-ABCDEF",status:"succeeded"}}));
  let queries=0,fetches=0;const executor={query:async(sql)=>{queries+=1;if(sql.startsWith("SELECT id,processing_status"))return{rows:[{id:1,processing_status:"PROCESSED"}],rowCount:1};return{rows:[],rowCount:0}}};
  const result=await payment.processWebhook({headers:{"flutterwave-signature":payment.createWebhookSignature(raw,process.env.FLUTTERWAVE_WEBHOOK_SECRET)},rawBody:raw,executor,fetchImpl:async()=>{fetches+=1;throw new Error("must not fetch")}});
  assert.deepEqual(result,{duplicate:true,event_id:"wbk_duplicate",processing_status:"PROCESSED"});assert.equal(queries,2);assert.equal(fetches,0);
});

test("HMAC accepts the exact raw body and rejects missing, altered, or wrong-body signatures", () => {
  const raw=Buffer.from('{"id":"wbk_1","type":"charge.completed"}'); const signature=payment.createWebhookSignature(raw,"secret");
  assert.equal(payment.verifyWebhookSignature({rawBody:raw,signature,secret:"secret"}),true);
  assert.equal(payment.verifyWebhookSignature({rawBody:raw,signature:null,secret:"secret"}),false);
  assert.equal(payment.verifyWebhookSignature({rawBody:Buffer.from(`${raw} `),signature,secret:"secret"}),false);
  assert.equal(payment.verifyWebhookSignature({rawBody:Buffer.from("{}"),signature,secret:"secret"}),false);
  assert.equal(payment.verifyWebhookSignature({rawBody:raw,signature,secret:"wrong"}),false);
});

test("v4 status, amount, and currency mapping preserves financial integrity", () => {
  const classify=(providerStatus,received=100n,currency="TZS")=>payment.classifyVerifiedCharge({providerStatus,received,expected:100n,currency,expectedCurrency:"TZS"});
  assert.deepEqual(classify("succeeded"),{status:"SUCCESSFUL",reconciliation:"MATCHED",failure:null});
  assert.equal(classify("pending").status,"PENDING"); assert.equal(classify("failed").status,"FAILED"); assert.equal(classify("voided").status,"FAILED");
  assert.equal(classify("succeeded",80n).reconciliation,"EXCEPTION"); assert.equal(classify("succeeded",110n).reconciliation,"EXCEPTION"); assert.equal(classify("succeeded",100n,"USD").reconciliation,"EXCEPTION");
});

test("webhook route captures raw JSON before global parser and v3 paths are absent", () => {
  const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8"); const service=fs.readFileSync(path.join(__dirname,"../services/paymentService.js"),"utf8");
  assert.ok(app.indexOf('app.post("/api/payments/webhook", express.raw') < app.indexOf('app.use(express.json'));
  assert.doesNotMatch(service,/api\.flutterwave\.com\/v3|\/transactions\/|verif-hash|data\.tx_ref|FLUTTERWAVE_SECRET_KEY/);
});

test("Finance gateway migration does not restore manual invoice issue or payment confirmation permissions", () => {
  const grants=fs.readFileSync(path.join(__dirname,"../database/ensureRolePermissions.js"),"utf8");
  assert.match(grants,/finance\.invoices\.create.*finance\.invoices\.issue.*finance\.payments\.confirm/);
  assert.match(grants,/NOT IN/);
});

test("tariff billing remains limited to Management-approved active versions", () => {
  const finance=fs.readFileSync(path.join(__dirname,"../services/financeService.js"),"utf8");
  assert.match(finance,/tv\.is_active\s*=\s*TRUE[^;]+tv\.approval_status\s*=\s*'APPROVED'/s);
  assert.doesNotMatch(finance,/approval_status\s+IN\s*\([^)]*PENDING_APPROVAL|approval_status\s+IN\s*\([^)]*REJECTED/);
});

test("Gate and readiness controls still require Customs and do not require normal dispatch approval", () => {
  const readiness=fs.readFileSync(path.join(__dirname,"../services/releaseReadinessService.js"),"utf8");
  const eligibility=fs.readFileSync(path.join(__dirname,"../services/releaseEligibilityService.js"),"utf8");
  assert.match(readiness,/cargo\.customs_status !== "Cleared"/);
  assert.match(eligibility,/target==='normal_gate_release'&&r\.evaluator_key==='dispatch_approval'/);
});

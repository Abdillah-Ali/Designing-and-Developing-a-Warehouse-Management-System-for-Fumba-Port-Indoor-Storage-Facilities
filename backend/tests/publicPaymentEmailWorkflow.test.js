const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const email=require("../services/emailService");
const payment=require("../services/paymentService");

test("dynamic payment email contains safe invoice values and the secure URL",()=>{
  const data={cargo_reference:"CRG-1",invoice_reference:"INV-1",payment_reference:"PAY-1",currency:"TZS",invoice_total:"500000.00",amount_paid:"250000.00",outstanding_balance:"250000.00",payment_url:"http://192.168.1.2:3000/pay/secure"};
  const result=email.renderPaymentEmail(data);
  assert.match(result.subject,/CRG-1/);assert.match(result.text,/INV-1/);assert.match(result.text,/PAY-1/);assert.match(result.text,/250000\.00/);assert.match(result.text,/\/pay\/secure/);
  assert.doesNotMatch(result.text,/SMTP_PASSWORD|FLUTTERWAVE_CLIENT_SECRET|webhook/i);
});

test("Management Release review email contains no payment reference or payment link",()=>{
  const result=email.renderManagementReleaseEmail({cargo_reference:"CRG-2",cargo_type:"General Goods",warehouse_name:"Warehouse A",management_release_reason:"Office cargo"});
  assert.match(result.subject,/Management Release Review/);assert.match(result.text,/Cargo Reference: CRG-2/);
  assert.match(result.text,/No payment is requested/);
  assert.doesNotMatch(result.text,/PAY-|Payment Link:|\/pay\//);
});

test("payment URL uses configuration and never hardcodes a LAN address",()=>{
  const previous=process.env.PUBLIC_PAYMENT_BASE_URL;process.env.PUBLIC_PAYMENT_BASE_URL="http://10.0.0.20:3000/";
  assert.equal(email.buildPaymentUrl("a".repeat(64)),`http://10.0.0.20:3000/pay/${"a".repeat(64)}`);
  process.env.PUBLIC_PAYMENT_BASE_URL=previous;
});

test("public inputs reject invalid token, zero amount, malformed contact, and attempt reference",()=>{
  assert.throws(()=>payment.validateCustomerPaymentInput({token:"PAY-guessable"}),/Invalid payment token/);
  assert.throws(()=>payment.validateCustomerPaymentInput({amount:"0"}),/positive monetary/);
  assert.throws(()=>payment.validateCustomerPaymentInput({customer:{email:"bad",phone:"1",network:"!"}}),/email/);
  assert.throws(()=>payment.validateCustomerPaymentInput({attemptReference:"PAY-1"}),/attempt/);
});

test("missing customer email records SKIPPED without throwing",async()=>{
  const executor={query:async(sql)=>{
    if(sql.includes("FROM invoices i JOIN cargo"))return{rows:[{id:1,invoice_reference:"INV-1",payment_reference:"PAY-1",payment_public_token:"a".repeat(64),invoice_total:"10",amount_paid:"0",outstanding_balance:"10",currency:"TZS",cargo_reference:"CRG-1",recipient:null}],rowCount:1};
    if(sql.includes("INSERT INTO payment_email_deliveries"))return{rows:[{id:2,delivery_status:"SKIPPED"}],rowCount:1};
    return{rows:[{}],rowCount:1};
  }};
  assert.equal((await email.queuePaymentLinkEmail({invoiceId:1,executor})).delivery.delivery_status,"SKIPPED");
});

test("SMTP failure is persisted as retryable and does not expose credentials",async()=>{
  const old={provider:process.env.EMAIL_PROVIDER,from:process.env.EMAIL_FROM,host:process.env.SMTP_HOST,user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD};
  Object.assign(process.env,{EMAIL_PROVIDER:"smtp",EMAIL_FROM:"wms@example.test",SMTP_HOST:"smtp.example.test",SMTP_USER:"wms",SMTP_PASSWORD:"secret-app-password",PUBLIC_PAYMENT_BASE_URL:"http://localhost:3000"});
  const queries=[];const executor={query:async(sql,params=[])=>{queries.push({sql,params});
    if(sql.includes("FROM invoices i JOIN cargo"))return{rows:[{id:1,invoice_reference:"INV-1",payment_reference:"PAY-1",payment_public_token:"a".repeat(64),invoice_total:"10",amount_paid:"0",outstanding_balance:"10",currency:"TZS",cargo_reference:"CRG-1",recipient:"customer@example.test"}],rowCount:1};
    if(sql.includes("SELECT * FROM payment_email_deliveries"))return{rows:[{id:2,delivery_status:"FAILED"}],rowCount:1};
    if(sql.includes("UPDATE payment_email_deliveries SET delivery_status='FAILED'"))return{rows:[{id:2,delivery_status:"FAILED",attempt_count:2}],rowCount:1};
    return{rows:[{}],rowCount:1};}};
  const result=await email.sendPaymentLinkEmail({invoiceId:1,executor,resent:true,transportFactory:()=>({sendMail:async()=>{throw new Error("temporary SMTP outage")}})});
  assert.equal(result.delivery_status,"FAILED");assert.equal(result.attempt_count,2);
  assert.doesNotMatch(JSON.stringify(queries),/secret-app-password/);
  Object.assign(process.env,{EMAIL_PROVIDER:old.provider||"",EMAIL_FROM:old.from||"",SMTP_HOST:old.host||"",SMTP_USER:old.user||"",SMTP_PASSWORD:old.pass||""});
});

test("public route is login-free and rate limited",()=>{
  const route=fs.readFileSync(path.join(__dirname,"../routes/publicPaymentRoutes.js"),"utf8");
  assert.match(route,/createRateLimiter/);assert.doesNotMatch(route,/requirePermission/);
});

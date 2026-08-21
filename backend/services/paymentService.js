const crypto=require("node:crypto");
const db=require("../config/db");
const { buildError }=require("../utils/apiError");
const { writeAuditLog }=require("../models/adminModel");
const { createNotificationsForAudience }=require("./notificationService");
const { createOrRegenerateDraftInvoice,issueInvoice,generatePublicReference,refreshInvoicePaymentStatus,updateCargoFinancialStatus,centsFromAmount }=require("./financeService");
const { recalculateReleaseReadiness }=require("./releaseReadinessService");

const config=()=>({provider:(process.env.PAYMENT_PROVIDER||"flutterwave").toLowerCase(),base:process.env.FLUTTERWAVE_API_BASE_URL||"https://api.flutterwave.com/v3",secret:process.env.FLUTTERWAVE_SECRET_KEY,webhookSecret:process.env.FLUTTERWAVE_WEBHOOK_SECRET,callback:process.env.PAYMENT_CALLBACK_URL});
const timingSafe=(a,b)=>{const aa=Buffer.from(String(a||"")),bb=Buffer.from(String(b||""));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb)};

const ensureAutomaticInvoice=async({cargoReference,executor=db})=>{
 const existing=await executor.query(`SELECT i.*,c.cargo_id AS cargo_reference FROM invoices i JOIN cargo c ON c.id=i.cargo_id WHERE c.cargo_id=$1 AND i.auto_generated=TRUE AND i.status<>'Cancelled' ORDER BY i.created_at DESC LIMIT 1 FOR UPDATE OF i`,[cargoReference]);
 if(existing.rowCount)return existing.rows[0];
 const draft=await createOrRegenerateDraftInvoice({payload:{cargo_reference:cargoReference},auth:{username:"SYSTEM"},executor});
 await issueInvoice({invoiceNumber:draft.invoice_number,auth:{username:"SYSTEM"},executor});
 const paymentReference=await generatePublicReference("PAY",executor,"payments","public_reference");
 const updated=await executor.query(`UPDATE invoices SET auto_generated=TRUE,payment_reference=$1,issued_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE public_invoice_number=$2 RETURNING *`,[paymentReference,draft.invoice_number]);
 await executor.query(`UPDATE tariff_versions SET operationally_used_at=COALESCE(operationally_used_at,CURRENT_TIMESTAMP) WHERE id=$1`,[updated.rows[0].tariff_version_id]);
 await writeAuditLog({user_id:null,action:"AUTOMATIC_INVOICE_GENERATED",module:"Billing and Payment",description:`System generated invoice ${draft.invoice_number} and payment reference ${paymentReference} for ${cargoReference}.`,metadata:{system_actor:true,cargo_reference:cargoReference,invoice_reference:draft.invoice_number,payment_reference:paymentReference}},executor);
 return {...updated.rows[0],cargo_reference:cargoReference};
};

const initiatePayment=async({invoiceNumber,customer={},auth,executor=db,fetchImpl=global.fetch})=>{
 const invoice=(await executor.query(`SELECT i.*,c.cargo_id AS cargo_reference,c.id AS cargo_record_id FROM invoices i JOIN cargo c ON c.id=i.cargo_id WHERE i.public_invoice_number=$1 FOR UPDATE OF i`,[invoiceNumber])).rows[0];
 if(!invoice||invoice.status==="Cancelled"||invoice.payment_status==="Paid")throw buildError("A payable invoice was not found.",409);
 const cfg=config(); if(cfg.provider!=="flutterwave")throw buildError("Unsupported payment provider configuration.",500); if(!cfg.secret)throw buildError("Flutterwave sandbox credentials are not configured.",503,null,"PAYMENT_PROVIDER_NOT_CONFIGURED");
 let payment=(await executor.query("SELECT * FROM payments WHERE invoice_id=$1 AND payment_reference=$2 AND gateway_status IN ('NOT_INITIATED','PENDING','PROCESSING') ORDER BY id DESC LIMIT 1 FOR UPDATE",[invoice.id,invoice.payment_reference])).rows[0];
 if(!payment){payment=(await executor.query(`INSERT INTO payments(public_reference,invoice_id,cargo_id,payment_reference,amount,expected_amount,currency,bank_name,payment_date,status,gateway_status,gateway_provider,recorded_by) VALUES($1,$2,$3,$1,$4,$4,$5,'Flutterwave Sandbox',CURRENT_TIMESTAMP,'Gateway Pending','NOT_INITIATED','flutterwave',$6) RETURNING *`,[invoice.payment_reference,invoice.id,invoice.cargo_record_id,invoice.outstanding_balance,invoice.currency,auth?.userId||null])).rows[0]}
 const payload={tx_ref:invoice.payment_reference,amount:String(invoice.outstanding_balance),currency:invoice.currency,redirect_url:cfg.callback,customer:{email:customer.email||"external.customer@invalid.example",phonenumber:customer.phone||undefined,name:customer.name||"External cargo customer"},customizations:{title:"Fumba Port WMS",description:`Invoice ${invoice.public_invoice_number}`},meta:{wms_payment_reference:invoice.payment_reference,cargo_reference:invoice.cargo_reference,invoice_reference:invoice.public_invoice_number}};
 const response=await fetchImpl(`${cfg.base}/payments`,{method:"POST",headers:{Authorization:`Bearer ${cfg.secret}`,"Content-Type":"application/json"},body:JSON.stringify(payload)}); const body=await response.json();
 if(!response.ok||body.status!=="success")throw buildError("The payment provider rejected initiation.",502,body.message);
 await executor.query(`UPDATE payments SET gateway_status='PENDING',initiated_at=CURRENT_TIMESTAMP,gateway_response=$1::jsonb WHERE id=$2`,[JSON.stringify({checkout_link:body.data?.link||null,status:body.status}),payment.id]);
 await writeAuditLog({user_id:auth?.userId||null,action:"PAYMENT_INITIATED",module:"Billing and Payment",description:`Initiated Flutterwave payment ${invoice.payment_reference}.`,metadata:{payment_reference:invoice.payment_reference,invoice_reference:invoice.public_invoice_number,cargo_reference:invoice.cargo_reference}},executor);
 return {payment_reference:invoice.payment_reference,invoice_reference:invoice.public_invoice_number,cargo_reference:invoice.cargo_reference,status:"PENDING",checkout_url:body.data?.link};
};

const verifyTransaction=async(id,fetchImpl=global.fetch)=>{const cfg=config();const response=await fetchImpl(`${cfg.base}/transactions/${encodeURIComponent(id)}/verify`,{headers:{Authorization:`Bearer ${cfg.secret}`}});const body=await response.json();if(!response.ok||body.status!=="success")throw buildError("Provider transaction verification failed.",502);return body.data};

const processWebhook=async({headers,payload,executor=db,fetchImpl=global.fetch})=>{
 const cfg=config(); const signature=headers["verif-hash"]||headers["flutterwave-signature"];
 if(!cfg.webhookSecret||!timingSafe(signature,cfg.webhookSecret))throw buildError("Invalid payment webhook signature.",401,null,"INVALID_WEBHOOK_SIGNATURE");
 const data=payload?.data||{}; const eventId=String(payload?.id||data?.id||data?.flw_ref||""); if(!eventId)throw buildError("Webhook event has no stable identifier.",400);
 const hash=crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
 const inserted=await executor.query(`INSERT INTO payment_webhook_events(provider,event_id,payload_hash) VALUES('flutterwave',$1,$2) ON CONFLICT(provider,event_id) DO NOTHING RETURNING id`,[eventId,hash]);
 if(!inserted.rowCount)return {duplicate:true,event_id:eventId};
 const reference=String(data.tx_ref||data.meta?.wms_payment_reference||"");
 const payment=(await executor.query(`SELECT p.*,i.total_amount,i.outstanding_balance,i.public_invoice_number,c.cargo_id AS cargo_reference FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN cargo c ON c.id=p.cargo_id WHERE p.payment_reference=$1 FOR UPDATE OF p,i,c`,[reference])).rows[0];
 if(!payment){await executor.query("UPDATE payment_webhook_events SET processing_status='UNKNOWN_REFERENCE',processed_at=CURRENT_TIMESTAMP WHERE id=$1",[inserted.rows[0].id]);throw buildError("Unknown WMS payment reference.",404,null,"UNKNOWN_PAYMENT_REFERENCE")}
 let verified; try{verified=await verifyTransaction(data.id,fetchImpl)}catch(error){await executor.query(`UPDATE payments SET gateway_status='PROCESSING',failure_reason='Verification temporarily failed' WHERE id=$1`,[payment.id]);throw error}
 const received=centsFromAmount(verified.amount||0),expected=centsFromAmount(payment.expected_amount),currency=String(verified.currency||"").toUpperCase();
 let status="FAILED",reconciliation="PENDING",failure=null;
 if(String(verified.status).toLowerCase()==="successful"){
   if(currency!==payment.currency){status="FAILED";reconciliation="EXCEPTION";failure="Currency mismatch"}
   else if(received<expected){status="SUCCESSFUL";reconciliation="PARTIAL";failure="Underpayment"}
   else if(received>expected){status="SUCCESSFUL";reconciliation="OVERPAYMENT";failure="Overpayment"}
   else{status="SUCCESSFUL";reconciliation="MATCHED"}
 }else if(["pending","processing"].includes(String(verified.status).toLowerCase())) status="PENDING"; else failure=`Provider status: ${verified.status}`;
 await executor.query(`UPDATE payments SET amount=$1,amount_received=$1,currency=$2,gateway_status=$3,status=CASE WHEN $3='SUCCESSFUL' THEN 'Confirmed' WHEN $3='FAILED' THEN 'Gateway Failed' ELSE 'Gateway Pending' END,gateway_transaction_id=$4,gateway_event_id=$5,payment_method=$6,verified_at=CASE WHEN $3='SUCCESSFUL' THEN CURRENT_TIMESTAMP END,failed_at=CASE WHEN $3='FAILED' THEN CURRENT_TIMESTAMP END,failure_reason=$7,reconciliation_status=$8,gateway_response=$9::jsonb,confirmed_at=CASE WHEN $3='SUCCESSFUL' THEN CURRENT_TIMESTAMP ELSE confirmed_at END WHERE id=$10`,[verified.amount||0,currency,status,String(verified.id),eventId,verified.payment_type||null,failure,reconciliation,JSON.stringify({id:verified.id,status:verified.status,amount:verified.amount,currency:verified.currency,tx_ref:verified.tx_ref}),payment.id]);
 await executor.query("UPDATE payment_webhook_events SET payment_id=$1,processing_status='PROCESSED',processed_at=CURRENT_TIMESTAMP WHERE id=$2",[payment.id,inserted.rows[0].id]);
 const invoice=await refreshInvoicePaymentStatus({invoiceId:payment.invoice_id,executor}); const cargo=await updateCargoFinancialStatus({cargoId:payment.cargo_id,executor});
 const readiness=await recalculateReleaseReadiness({cargoId:payment.cargo_id,executor,trigger:"PAYMENT_WEBHOOK"});
 await writeAuditLog({user_id:null,action:status==="SUCCESSFUL"?"PAYMENT_VERIFIED":status==="FAILED"?"PAYMENT_FAILED":"PAYMENT_PENDING",module:"Billing and Payment",description:`Gateway payment ${reference} verified as ${status}.`,metadata:{system_actor:true,event_id:eventId,transaction_id:String(verified.id),expected_amount:payment.expected_amount,received_amount:String(verified.amount),currency,reconciliation}},executor);
 await createNotificationsForAudience({notification_type:"finance_payment_update",title:`Payment ${status}`,message:`${reference} for ${payment.cargo_reference}: ${currency} ${verified.amount}.`,related_module:"Billing and Payment",priority:status==="SUCCESSFUL"?"high":"normal",metadata:{deep_link:"/finance?section=payments"}},{roleName:"Finance Officer"},executor,{fallbackBroadTarget:true});
 return {payment_reference:reference,status,reconciliation_status:reconciliation,invoice_status:invoice?.status,cargo_financial_status:cargo?.financial_status,release_readiness:readiness};
};
module.exports={config,timingSafe,ensureAutomaticInvoice,initiatePayment,processWebhook,verifyTransaction};

const nodemailer=require("nodemailer");
const db=require("../config/db");
const { buildError }=require("../utils/apiError");
const { writeAuditLog }=require("../models/adminModel");
const { logEvent }=require("../utils/logger");

const centsFromAmount=(val)=>BigInt(Math.round(Number(val||0)*100));

const cleanBaseUrl=()=>String(process.env.PUBLIC_PAYMENT_BASE_URL||"").trim().replace(/\/+$/,"");
const buildPaymentUrl=(token)=>{
  const base=cleanBaseUrl();
  if(!base || !/^https?:\/\//i.test(base)) return null;
  return `${base}/pay/${encodeURIComponent(String(token||""))}`;
};

const smtpConfig=()=>({
  host:String(process.env.SMTP_HOST||""),
  port:Number(process.env.SMTP_PORT||587),
  secure:String(process.env.SMTP_SECURE||"false").toLowerCase()==="true",
  auth:{user:String(process.env.SMTP_USER||""),pass:String(process.env.SMTP_PASSWORD||"")}
});

const createTransport=(factory=nodemailer.createTransport)=>{
  if(String(process.env.EMAIL_PROVIDER||"").toLowerCase()!=="smtp") throw buildError("SMTP email delivery is not configured.",503,null,"EMAIL_NOT_CONFIGURED");
  const cfg=smtpConfig();
  if(!cfg.host||!cfg.auth.user||!cfg.auth.pass||!process.env.EMAIL_FROM) throw buildError("SMTP email delivery is incomplete.",503,null,"EMAIL_NOT_CONFIGURED");
  return factory(cfg);
};

const renderPaymentEmail=(data)=>({
  subject:`Fumba Port Cargo Payment Request - ${data.cargo_reference}`,
  text:[
    "Hello,","",`A payment obligation has been created for cargo ${data.cargo_reference}.`,"",
    `Cargo Reference: ${data.cargo_reference}`,
    `Invoice Reference: ${data.invoice_reference}`,
    `PAY Payment Reference: ${data.payment_reference}`,
    `Total Invoice Amount: ${data.currency} ${data.invoice_total}`,
    `Amount Already Paid: ${data.currency} ${data.amount_paid}`,
    `Remaining Balance: ${data.currency} ${data.outstanding_balance}`,"",
    "You may pay the balance in one or more installments.",`Payment Link: ${data.payment_url}`,"","Regards,","Fumba Port WMS"
  ].join("\n")
});

const renderManagementReleaseEmail=(data)=>({
  subject:`Fumba Port Management Release Review - ${data.cargo_reference}`,
  text:[
    "Hello,","",`Cargo ${data.cargo_reference} has been approved by the Warehouse Supervisor and submitted for Management Release review.`,"",
    `Cargo Reference: ${data.cargo_reference}`,
    `Cargo Type: ${data.cargo_type||"Not specified"}`,
    `Warehouse: ${data.warehouse_name||"Not specified"}`,
    `Release Request Reason: ${data.management_release_reason||"Not specified"}`,"",
    "No payment is requested while Management Release is under review.",
    "You will be notified when the release decision is made.","","Regards,","Fumba Port WMS"
  ].join("\n")
});

const loadManagementReleaseEmailData=async({cargoReference,executor=db})=>{
  const result=await executor.query(`SELECT c.id,c.cargo_id AS cargo_reference,c.email AS recipient,c.cargo_type,c.management_release_reason,w.warehouse_name
    FROM cargo c LEFT JOIN warehouses w ON w.id=c.warehouse_id WHERE c.cargo_id=$1 LIMIT 1`,[cargoReference]);
  if(!result.rowCount) throw buildError("Cargo was not found for the Management Release email.",404);
  return result.rows[0];
};

const queueAndAttemptManagementReleaseEmail=async({cargoReference,executor=db,transportFactory})=>{
  const data=await loadManagementReleaseEmailData({cargoReference,executor});
  const status=data.recipient?"PENDING":"SKIPPED";
  const delivery=(await executor.query(`INSERT INTO payment_email_deliveries(invoice_id,email_type,recipient,delivery_status,last_error)
    SELECT i.id,'MANAGEMENT_RELEASE_NOTICE',$2,$3,$4 FROM invoices i WHERE i.cargo_id=$1 ORDER BY i.created_at DESC LIMIT 1
    ON CONFLICT(invoice_id,email_type) DO NOTHING RETURNING *`,[data.id,data.recipient||null,status,data.recipient?null:"Customer email unavailable"])).rows[0];
  if(!delivery||delivery.delivery_status==="SKIPPED") return delivery||null;
  try{
    const transport=createTransport(transportFactory); const template=renderManagementReleaseEmail(data);
    await transport.sendMail({from:process.env.EMAIL_FROM,to:data.recipient,subject:template.subject,text:template.text});
    const sent=(await executor.query(`UPDATE payment_email_deliveries SET delivery_status='SENT',attempt_count=attempt_count+1,last_attempt_at=CURRENT_TIMESTAMP,sent_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,[delivery.id])).rows[0];
    await writeAuditLog({user_id:null,action:"MANAGEMENT_RELEASE_EMAIL_SENT",module:"Management Release",description:`Management Release review email sent for cargo ${data.cargo_reference}.`,metadata:{system_actor:true,cargo_reference:data.cargo_reference,recipient:data.recipient}},executor);
    return sent;
  }catch(error){
    const safeError=String(error?.message||"SMTP delivery failed").slice(0,500);
    return (await executor.query(`UPDATE payment_email_deliveries SET delivery_status='FAILED',attempt_count=attempt_count+1,last_attempt_at=CURRENT_TIMESTAMP,last_error=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,[delivery.id,safeError])).rows[0];
  }
};

const loadDeliveryData=async({invoiceId,executor=db})=>{
  const result=await executor.query(`SELECT i.id,i.public_invoice_number AS invoice_reference,i.payment_reference,i.payment_public_token,i.total_amount,i.amount_paid,i.outstanding_balance,i.currency,c.cargo_id AS cargo_reference,c.email AS recipient FROM invoices i JOIN cargo c ON c.id=i.cargo_id WHERE i.id=$1 LIMIT 1`,[invoiceId]);
  if(!result.rowCount) throw buildError("Invoice was not found for payment email.",404);
  const row=result.rows[0];
  const totalCents=centsFromAmount(row.total_amount||0);
  const paidCents=centsFromAmount(row.amount_paid||0);
  const remainingCents=row.outstanding_balance!==null&&row.outstanding_balance!==undefined
    ? centsFromAmount(row.outstanding_balance)
    : (totalCents>paidCents?totalCents-paidCents:0n);

  return {
    ...row,
    invoice_total:(Number(totalCents)/100).toFixed(2),
    amount_paid:(Number(paidCents)/100).toFixed(2),
    outstanding_balance:(Number(remainingCents)/100).toFixed(2),
    payment_url:buildPaymentUrl(row.payment_public_token)
  };
};

const queuePaymentLinkEmail=async({invoiceId,executor=db})=>{
  const data=await loadDeliveryData({invoiceId,executor});
  const status=!data.recipient?"SKIPPED":"PENDING"; const reason=!data.recipient?"Customer email unavailable":!data.payment_url?"Public payment base URL unavailable":null;
  const delivery=await executor.query(`INSERT INTO payment_email_deliveries(invoice_id,email_type,recipient,delivery_status,last_error) VALUES($1,'INITIAL_PAYMENT_LINK',$2,$3,$4) ON CONFLICT(invoice_id,email_type) DO NOTHING RETURNING *`,[invoiceId,data.recipient||null,status,reason]);
  if(delivery.rowCount) await writeAuditLog({user_id:null,action:"PAYMENT_LINK_GENERATED",module:"Billing and Payment",description:`Generated secure payment link for invoice ${data.invoice_reference}.`,metadata:{system_actor:true,invoice_reference:data.invoice_reference,cargo_reference:data.cargo_reference,email_status:status}},executor);
  return {data,delivery:delivery.rows[0]||null,duplicate:!delivery.rowCount};
};

const sendPaymentLinkEmail=async({invoiceId,executor=db,transportFactory,resent=false})=>{
  const data=await loadDeliveryData({invoiceId,executor});
  let current=(await executor.query(`SELECT * FROM payment_email_deliveries WHERE invoice_id=$1 AND email_type='INITIAL_PAYMENT_LINK' FOR UPDATE`,[invoiceId])).rows[0];
  if(!current){await queuePaymentLinkEmail({invoiceId,executor});current=(await executor.query(`SELECT * FROM payment_email_deliveries WHERE invoice_id=$1 AND email_type='INITIAL_PAYMENT_LINK' FOR UPDATE`,[invoiceId])).rows[0];}
  if(!current) throw buildError("Payment email delivery could not be queued.",409);
  if(current.delivery_status==="SENT"&&!resent) return current;
  if(!data.recipient||!data.payment_url) {
    const reason=!data.recipient?"Customer email unavailable":"Public payment base URL unavailable";
    return (await executor.query(`UPDATE payment_email_deliveries SET delivery_status='SKIPPED',last_error=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,[current.id,reason])).rows[0];
  }
  const template=renderPaymentEmail(data);
  try{
    const transport=createTransport(transportFactory);
    await transport.sendMail({from:process.env.EMAIL_FROM,to:data.recipient,subject:template.subject,text:template.text});
    const sent=(await executor.query(`UPDATE payment_email_deliveries SET delivery_status='SENT',recipient=$2,attempt_count=attempt_count+1,last_attempt_at=CURRENT_TIMESTAMP,sent_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,[current.id,data.recipient])).rows[0];
    await writeAuditLog({user_id:null,action:resent?"PAYMENT_EMAIL_RESENT":"PAYMENT_EMAIL_SENT",module:"Billing and Payment",description:`Payment-link email sent for invoice ${data.invoice_reference}.`,metadata:{system_actor:true,invoice_reference:data.invoice_reference,cargo_reference:data.cargo_reference,recipient:data.recipient}},executor);
    return sent;
  }catch(error){
    const safeError=String(error?.message||"SMTP delivery failed").slice(0,500);
    const failed=(await executor.query(`UPDATE payment_email_deliveries SET delivery_status='FAILED',attempt_count=attempt_count+1,last_attempt_at=CURRENT_TIMESTAMP,last_error=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,[current.id,safeError])).rows[0];
    await writeAuditLog({user_id:null,action:"PAYMENT_EMAIL_FAILED",module:"Billing and Payment",description:`Payment-link email delivery failed for invoice ${data.invoice_reference}.`,metadata:{system_actor:true,invoice_reference:data.invoice_reference,cargo_reference:data.cargo_reference,retryable:true}},executor);
    logEvent("warn",{operation:"payment_email_delivery",result:"failure",invoice_reference:data.invoice_reference,error:safeError});
    return failed;
  }
};

const queueAndAttemptPaymentEmail=async({invoiceId,executor=db,transportFactory})=>{
  const queued=await queuePaymentLinkEmail({invoiceId,executor});
  if(queued.duplicate||!queued.delivery||queued.delivery.delivery_status==="SKIPPED") return queued.delivery;
  return sendPaymentLinkEmail({invoiceId,executor,transportFactory});
};

module.exports={buildPaymentUrl,createTransport,loadDeliveryData,loadManagementReleaseEmailData,queueAndAttemptManagementReleaseEmail,queueAndAttemptPaymentEmail,queuePaymentLinkEmail,renderManagementReleaseEmail,renderPaymentEmail,sendPaymentLinkEmail,smtpConfig};

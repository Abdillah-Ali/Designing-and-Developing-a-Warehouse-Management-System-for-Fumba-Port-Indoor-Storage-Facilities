const db=require('../config/db');
const {queuePaymentLinkEmail,sendPaymentLinkEmail}=require('./emailService');
const {logEvent}=require('../utils/logger');
let timer;let running=false;

async function queueMissingPaymentEmails(executor){
  const rows=await executor.query(`SELECT i.id FROM invoices i JOIN cargo c ON c.id=i.cargo_id
    WHERE i.status NOT IN ('Draft','Cancelled') AND c.registration_status='Approved'
      AND i.payment_reference IS NOT NULL AND i.payment_public_token IS NOT NULL
      AND i.outstanding_balance>0 AND c.email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND NOT EXISTS(SELECT 1 FROM payment_email_deliveries d WHERE d.invoice_id=i.id AND d.email_type='INITIAL_PAYMENT_LINK')
    ORDER BY i.issued_at,i.id LIMIT 50`);
  for(const row of rows.rows){try{await queuePaymentLinkEmail({invoiceId:row.id,executor});}catch(error){logEvent('warn',{operation:'automatic_payment_email_queue',result:'failure',invoice_id:row.id,error_category:error.errorCode||error.code||error.name});}}
  return rows.rowCount;
}

async function sendQueuedPaymentEmails(executor){
  let sent=0;
  for(let index=0;index<50;index+=1){
    const candidate=await executor.query(`SELECT invoice_id FROM payment_email_deliveries
      WHERE email_type='INITIAL_PAYMENT_LINK' AND attempt_count<5
        AND (delivery_status='PENDING' OR (delivery_status='FAILED' AND (last_attempt_at IS NULL OR last_attempt_at<=CURRENT_TIMESTAMP-INTERVAL '1 minute')))
      ORDER BY created_at,id LIMIT 1`);
    if(!candidate.rowCount)break;
    const delivery=await sendPaymentLinkEmail({invoiceId:candidate.rows[0].invoice_id,executor});
    if(delivery?.delivery_status==='SENT')sent+=1;
  }
  return sent;
}

async function flushPaymentEmails(){
  if(running)return {skipped:true};running=true;const client=await db.pool.connect();
  try{
    const lock=await client.query("SELECT pg_try_advisory_lock(hashtext('payment_email_scheduler')) locked");
    if(!lock.rows[0]?.locked)return {skipped:true};
    try{const queued=await queueMissingPaymentEmails(client);const sent=await sendQueuedPaymentEmails(client);return{queued,sent};}
    finally{await client.query("SELECT pg_advisory_unlock(hashtext('payment_email_scheduler'))");}
  }finally{client.release();running=false;}
}

function startPaymentEmailScheduler(){if(timer)return timer;const run=()=>flushPaymentEmails().catch(error=>logEvent('error',{operation:'payment_email_scheduler',result:'failure',error_category:error.errorCode||error.code||error.name}));timer=setInterval(run,1000);timer.unref();run();return timer;}
module.exports={flushPaymentEmails,queueMissingPaymentEmails,sendQueuedPaymentEmails,startPaymentEmailScheduler};

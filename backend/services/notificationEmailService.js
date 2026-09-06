const db=require('../config/db');
const {createTransport}=require('./emailService');
const {writeAuditLog}=require('../models/adminModel');
const {logEvent}=require('../utils/logger');

const renderNotificationEmail=(row)=>({
  subject:`Fumba Port WMS: ${row.title}`,
  text:[`Hello ${row.full_name||row.username||'User'},`,'',row.message,'',`Notification: ${row.public_reference}`,`Module: ${row.related_module||'Fumba Port WMS'}`,`Priority: ${row.priority||'normal'}`,`Created: ${new Date(row.notification_created_at).toLocaleString('en-TZ',{timeZone:'Africa/Dar_es_Salaam'})}`,'','Please sign in to Fumba Port WMS to view the notification and take any required action.','','Regards,','Fumba Port WMS'].join('\n')
});

const claimDelivery=async(executor)=>{
  const result=await executor.query(`WITH candidate AS (
    SELECT id FROM notification_email_deliveries
    WHERE delivery_status IN ('PENDING','FAILED') AND next_attempt_at<=CURRENT_TIMESTAMP AND attempt_count<5
    ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE notification_email_deliveries d SET delivery_status='PROCESSING',last_attempt_at=CURRENT_TIMESTAMP,attempt_count=attempt_count+1,updated_at=CURRENT_TIMESTAMP
    FROM candidate WHERE d.id=candidate.id RETURNING d.*`);
  return result.rows[0]||null;
};

const loadDelivery=async(id,executor=db)=>(await executor.query(`SELECT d.*,n.public_reference,n.title,n.message,n.related_module,n.priority,n.created_at notification_created_at,u.full_name,u.username
  FROM notification_email_deliveries d JOIN notifications n ON n.id=d.notification_id JOIN users u ON u.id=d.recipient_user_id WHERE d.id=$1`,[id])).rows[0];

const deliverOne=async({transportFactory,executor=db,pool=db.pool}={})=>{
  const client=await pool.connect();let claimed;
  try{await client.query('BEGIN');claimed=await claimDelivery(client);await client.query('COMMIT');}
  catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  if(!claimed)return null;
  const row=await loadDelivery(claimed.id,executor);
  try{
    const template=renderNotificationEmail(row);const transport=createTransport(transportFactory);
    await transport.sendMail({from:process.env.EMAIL_FROM,to:row.recipient,subject:template.subject,text:template.text});
    await executor.query("UPDATE notification_email_deliveries SET delivery_status='SENT',sent_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1",[row.id]);
    await writeAuditLog({user_id:null,action:'NOTIFICATION_EMAIL_SENT',module:'Notifications',description:`Notification email sent for ${row.public_reference}.`,metadata:{system_actor:true,notification_reference:row.public_reference,recipient_user_id:row.recipient_user_id,recipient:row.recipient}},executor);
    return {id:row.id,status:'SENT'};
  }catch(error){
    const safe=String(error?.message||'Email delivery failed').slice(0,500);const terminal=Number(row.attempt_count)>=5;
    await executor.query(`UPDATE notification_email_deliveries SET delivery_status='FAILED',last_error=$2,next_attempt_at=CURRENT_TIMESTAMP+($3::int*INTERVAL '1 minute'),updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[row.id,safe,terminal?60:Math.max(1,Number(row.attempt_count))]);
    await writeAuditLog({user_id:null,action:'NOTIFICATION_EMAIL_FAILED',module:'Notifications',description:`Notification email delivery failed for ${row.public_reference}.`,metadata:{system_actor:true,notification_reference:row.public_reference,recipient_user_id:row.recipient_user_id,attempt_count:row.attempt_count,retryable:!terminal}},executor);
    logEvent('warn',{operation:'notification_email_delivery',result:'failure',notification_reference:row.public_reference,error_category:error.errorCode||error.code||error.name});
    return {id:row.id,status:'FAILED'};
  }
};

module.exports={claimDelivery,deliverOne,loadDelivery,renderNotificationEmail};

const db=require("../config/db");
const { buildError }=require("../utils/apiError");
const { writeAuditLog }=require("../models/adminModel");
const { createNotificationsForAudience }=require("./notificationService");

const select=`SELECT tv.*,t.public_reference AS tariff_reference,t.tariff_name,u.full_name AS submitted_by_name,
 (SELECT previous.daily_rate FROM tariff_versions previous WHERE previous.tariff_id=tv.tariff_id AND previous.approval_status='APPROVED' AND previous.id<>tv.id ORDER BY previous.version_number DESC LIMIT 1) AS existing_approved_rate
 FROM tariff_versions tv JOIN tariffs t ON t.id=tv.tariff_id LEFT JOIN users u ON u.id=tv.submitted_by`;

const list=async({status,executor=db}={})=>(await executor.query(`${select}${status?" WHERE tv.approval_status=$1":""} ORDER BY COALESCE(tv.submitted_at,tv.created_at) DESC`,status?[status]:[])).rows;

const submit=async({reference,auth,executor=db})=>{
 const found=await executor.query(`${select} WHERE tv.public_reference=$1 FOR UPDATE OF tv`,[reference]);
 if(!found.rowCount)throw buildError("Tariff version not found.",404); const row=found.rows[0];
 if(!["DRAFT","REJECTED"].includes(row.approval_status))throw buildError("Only Draft or Rejected tariff versions can be submitted.",409);
 await executor.query("UPDATE tariff_versions SET approval_status='PENDING_APPROVAL',submitted_by=$1,submitted_at=CURRENT_TIMESTAMP,rejection_reason=NULL,rejected_by=NULL,rejected_at=NULL,is_active=FALSE,updated_at=CURRENT_TIMESTAMP WHERE id=$2",[auth?.userId||null,row.id]);
 await executor.query("INSERT INTO tariff_approval_history(tariff_version_id,action,actor_id,snapshot) VALUES($1,'SUBMITTED',$2,$3::jsonb)",[row.id,auth?.userId||null,JSON.stringify(row)]);
 await writeAuditLog({user_id:auth?.userId||null,action:"SUBMIT_TARIFF_APPROVAL",module:"Tariff Governance",description:`Submitted tariff ${reference} for Management approval.`,metadata:{entity_reference:reference,rate:row.daily_rate,currency:row.currency}},executor);
 await createNotificationsForAudience({notification_type:"pending_approval",title:"Tariff Approval Request",message:`${row.tariff_name} (${reference}) requires Management review.`,related_module:"Tariff Governance",priority:"high",created_by:auth?.userId,metadata:{deep_link:"/management?section=tariff-approvals"}},{roleName:"Management"},executor,{fallbackBroadTarget:true});
 return {tariff_version_reference:reference,approval_status:"PENDING_APPROVAL"};
};

const decide=async({reference,decision,reason,auth,executor=db})=>{
 const found=await executor.query(`${select} WHERE tv.public_reference=$1 FOR UPDATE OF tv`,[reference]);
 if(!found.rowCount)throw buildError("Tariff version not found.",404); const row=found.rows[0];
 if(row.approval_status!=="PENDING_APPROVAL")throw buildError("Only pending tariff versions can be decided.",409);
 if(decision==="REJECTED"&&!String(reason||"").trim())throw buildError("A rejection reason is required.",400);
 await executor.query(`UPDATE tariff_versions SET approval_status=$1,approved_by=CASE WHEN $1='APPROVED' THEN $2 END,approved_at=CASE WHEN $1='APPROVED' THEN CURRENT_TIMESTAMP END,rejected_by=CASE WHEN $1='REJECTED' THEN $2 END,rejected_at=CASE WHEN $1='REJECTED' THEN CURRENT_TIMESTAMP END,rejection_reason=CASE WHEN $1='REJECTED' THEN $3 END,is_active=CASE WHEN $1='REJECTED' THEN FALSE ELSE is_active END,updated_at=CURRENT_TIMESTAMP WHERE id=$4`,[decision,auth?.userId||null,String(reason||"").trim()||null,row.id]);
 await executor.query("INSERT INTO tariff_approval_history(tariff_version_id,action,actor_id,reason,snapshot) VALUES($1,$2,$3,$4,$5::jsonb)",[row.id,decision==="APPROVED"?"APPROVED":"REJECTED",auth?.userId||null,String(reason||"").trim()||null,JSON.stringify(row)]);
 await writeAuditLog({user_id:auth?.userId||null,action:`${decision}_TARIFF`,module:"Tariff Governance",description:`${decision} tariff ${reference}.`,metadata:{entity_reference:reference,reason:reason||null,submitted_by:row.submitted_by}},executor);
 await createNotificationsForAudience({notification_type:"approval_decision",title:`Tariff ${decision===`APPROVED`?`Approved`:`Rejected`}`,message:`${row.tariff_name} (${reference}) was ${decision.toLowerCase()}${reason?`: ${reason}`:""}.`,related_module:"Tariff Governance",priority:"high",created_by:auth?.userId,metadata:{deep_link:"/finance?section=tariffs"}},{userIds:[row.submitted_by].filter(Boolean),roleName:"Finance Officer"},executor,{fallbackBroadTarget:true});
 return {tariff_version_reference:reference,approval_status:decision,rejection_reason:decision==="REJECTED"?reason:null};
};
module.exports={list,submit,decide};

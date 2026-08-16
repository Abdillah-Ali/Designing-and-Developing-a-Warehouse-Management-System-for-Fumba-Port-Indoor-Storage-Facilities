const crypto = require("node:crypto");
const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { buildError } = require("../utils/apiError");
const { createNotificationsForAudience, NOTIFICATION_TYPES } = require("./notificationService");
const { getCargoFinancialSnapshot, amountFromCents } = require("./financeService");

const STATUS = Object.freeze({ NOT_REQUIRED: "NOT_REQUIRED", PENDING: "PENDING", APPROVED: "APPROVED", REJECTED: "REJECTED" });
const clean = (value) => String(value ?? "").trim();
const reference = () => `MRR-${new Date().getFullYear()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
const validateRemarks = (value, label, required = false) => {
  const text = clean(value);
  if (required && !text) throw buildError(`${label} is required.`, 400);
  if (text.length > 1000) throw buildError(`${label} cannot exceed 1000 characters.`, 400);
  return text;
};
const notify = (cargo, title, message, audience, actorId, executor, priority = "high") => createNotificationsForAudience({
  notification_type: NOTIFICATION_TYPES.WAREHOUSE_ALERT, title, message,
  related_module: "Management Release", related_entity_type: "cargo", related_entity_id: cargo.id,
  priority, created_by: actorId, metadata: { cargo_identifier: cargo.cargo_id, management_release_status: cargo.management_release_status }
}, audience, executor, { fallbackBroadTarget: true });

const selectCargo = async (executor, cargoRef, lock = false) => (await executor.query(
  `SELECT * FROM cargo WHERE (cargo_id=$1 OR barcode=$1 OR id::text=$1) AND is_deleted=FALSE LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
  [String(cargoRef)]
)).rows[0] || null;

const submit = async ({ cargoRef, reason, actor, executor }) => {
  const cargo = await selectCargo(executor, cargoRef, true);
  if (!cargo) throw buildError("Cargo record not found.", 404);
  const requestReason = validateRemarks(reason, "Reason for Management Release", true);
  if (![STATUS.NOT_REQUIRED, STATUS.REJECTED].includes(cargo.management_release_status)) throw buildError("Only normal or rejected cargo can be submitted to Management.", 409);
  const count = Number(cargo.management_release_submission_count || 0) + 1;
  const publicReference = reference();
  await executor.query(`INSERT INTO management_release_requests(public_reference,cargo_id,submission_number,requested_by,request_reason) VALUES($1,$2,$3,$4,$5)`, [publicReference,cargo.id,count,actor?.userId||null,requestReason]);
  await executor.query(`UPDATE cargo SET release_type='MANAGEMENT',management_release_status='PENDING',management_release_requested_by=$1,management_release_requested_at=CURRENT_TIMESTAMP,management_release_reason=$2,management_release_decided_by=NULL,management_release_decided_at=NULL,management_release_decision_remarks=NULL,management_release_submission_count=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$4`, [actor?.userId||null,requestReason,count,cargo.id]);
  await writeAuditLog({ user_id:actor?.userId||null,action:count>1?"RESUBMIT_MANAGEMENT_RELEASE":"REQUEST_MANAGEMENT_RELEASE",module:"Management Release",description:`Submitted cargo ${cargo.cargo_id} for Management Release.`,metadata:{cargo_reference:cargo.cargo_id,before:{status:cargo.management_release_status},after:{status:STATUS.PENDING},reason:requestReason,submission_number:count}},executor);
  await notify({...cargo,management_release_status:STATUS.PENDING},"Management Release approval required before Gate-Out",`${cargo.cargo_id}: ${requestReason}`,{roleKey:"management"},actor?.userId,executor);
  return { cargo_reference:cargo.cargo_id,request_reference:publicReference,release_type:"MANAGEMENT",management_release_status:STATUS.PENDING,submission_number:count,reason:requestReason };
};

const convertToNormal = async ({ cargoRef, remarks, actor, executor }) => {
  const cargo = await selectCargo(executor,cargoRef,true); if(!cargo) throw buildError("Cargo record not found.",404);
  if(![STATUS.NOT_REQUIRED,STATUS.REJECTED].includes(cargo.management_release_status)) throw buildError("Only rejected Management Release cargo can be converted to Normal Release.",409);
  const note=validateRemarks(remarks,"Release remarks");
  await executor.query(`UPDATE cargo SET release_type='NORMAL',management_release_status='NOT_REQUIRED',management_release_reason=NULL,management_release_decided_by=NULL,management_release_decided_at=NULL,management_release_decision_remarks=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2`,[note||null,cargo.id]);
  await writeAuditLog({user_id:actor?.userId||null,action:"SELECT_NORMAL_RELEASE",module:"Management Release",description:`Selected Normal Release for cargo ${cargo.cargo_id}.`,metadata:{cargo_reference:cargo.cargo_id,before:{status:cargo.management_release_status},after:{status:STATUS.NOT_REQUIRED},reason:note||null}},executor);
  return {cargo_reference:cargo.cargo_id,release_type:"NORMAL",management_release_status:STATUS.NOT_REQUIRED};
};

const decide = async ({ requestRef, decision, remarks, actor, executor }) => {
  const note=validateRemarks(remarks,"Management remarks",decision===STATUS.REJECTED);
  const result=await executor.query(`SELECT mrr.*,c.* ,c.id AS cargo_record_id,mrr.id AS request_id,mrr.status AS request_status,mrr.requested_by AS release_requested_by FROM management_release_requests mrr JOIN cargo c ON c.id=mrr.cargo_id WHERE mrr.public_reference=$1 LIMIT 1 FOR UPDATE OF mrr,c`,[requestRef]);
  if(!result.rowCount) throw buildError("Management Release request not found.",404); const cargo=result.rows[0];
  if(cargo.request_status!==STATUS.PENDING || cargo.management_release_status!==STATUS.PENDING) throw buildError("This Management Release request is no longer pending.",409);
  let historical="0.00", financeReview=false;
  if(decision===STATUS.APPROVED){
    try { historical=(await getCargoFinancialSnapshot({cargoId:cargo.cargo_record_id,executor})).charge.total_amount; } catch { historical="0.00"; }
    await executor.query(`SELECT id FROM invoices WHERE cargo_id=$1 AND status<>'Cancelled' FOR UPDATE`,[cargo.cargo_record_id]);
    const invoiceTotals=(await executor.query(`SELECT COALESCE(SUM(total_amount),0) total,COALESCE(SUM(amount_paid),0) paid FROM invoices WHERE cargo_id=$1 AND status<>'Cancelled'`,[cargo.cargo_record_id])).rows[0];
    if(Number(invoiceTotals.total)>Number(historical)) historical=invoiceTotals.total;
    financeReview=Number(invoiceTotals.paid)>0;
    await executor.query(`UPDATE invoices SET status='Cancelled',cancelled_by=$1,cancelled_at=CURRENT_TIMESTAMP,cancellation_reason='Management Release Approved',updated_at=CURRENT_TIMESTAMP WHERE cargo_id=$2 AND status<>'Cancelled' AND amount_paid=0`,[actor?.userId||null,cargo.cargo_record_id]);
  }
  await executor.query(`UPDATE management_release_requests SET status=$1::varchar,decided_by=$2,decided_at=CURRENT_TIMESTAMP,decision_remarks=$3,historical_accrued_amount=$4,waived_amount=CASE WHEN $1::varchar='APPROVED' THEN $4::numeric ELSE 0 END,finance_review_required=$5,updated_at=CURRENT_TIMESTAMP WHERE id=$6`,[decision,actor?.userId||null,note||null,historical,financeReview,cargo.request_id]);
  await executor.query(`UPDATE cargo SET management_release_status=$1::varchar,management_release_decided_by=$2,management_release_decided_at=CURRENT_TIMESTAMP,management_release_decision_remarks=$3,charge_end_at=CASE WHEN $1::varchar='APPROVED' THEN CURRENT_TIMESTAMP ELSE charge_end_at END,management_release_waived_amount=CASE WHEN $1::varchar='APPROVED' THEN $4::numeric ELSE 0 END,management_release_finance_review_required=$5,financial_status=CASE WHEN $1::varchar='APPROVED' THEN 'Fully Paid' ELSE financial_status END,updated_at=CURRENT_TIMESTAMP WHERE id=$6`,[decision,actor?.userId||null,note||null,historical,financeReview,cargo.cargo_record_id]);
  const action=decision===STATUS.APPROVED?"APPROVE_MANAGEMENT_RELEASE":"REJECT_MANAGEMENT_RELEASE";
  await writeAuditLog({user_id:actor?.userId||null,action,module:"Management Release",description:`${decision} Management Release ${requestRef} for cargo ${cargo.cargo_id}.`,metadata:{entity_reference:requestRef,cargo_reference:cargo.cargo_id,before:{status:STATUS.PENDING},after:{status:decision},reason:note||null,historical_accrued_amount:historical,waived_amount:decision===STATUS.APPROVED?historical:"0.00",finance_review_required:financeReview}},executor);
  const updated={...cargo,management_release_status:decision};
  await notify(updated,decision===STATUS.APPROVED?"Management Release approved — other release controls still apply":"Management Release rejected — Gate-Out remains blocked pending Supervisor action",`${cargo.cargo_id}${note?`: ${note}`:""}`,{userIds:[cargo.release_requested_by].filter(Boolean)},actor?.userId,executor);
  if(decision===STATUS.APPROVED) await notify(updated,"Management Release approved — warehouse charges waived",`${cargo.cargo_id}: review existing invoices/payments if applicable. Waived ${amountFromCents(BigInt(Math.round(Number(historical)*100)))}.`,{roleKey:"finance_officer"},actor?.userId,executor);
  return {request_reference:requestRef,cargo_reference:cargo.cargo_id,management_release_status:decision,historical_accrued_amount:historical,waived_amount:decision===STATUS.APPROVED?historical:"0.00",finance_review_required:financeReview,decision_remarks:note||null};
};

module.exports={STATUS,selectCargo,submit,convertToNormal,decide};

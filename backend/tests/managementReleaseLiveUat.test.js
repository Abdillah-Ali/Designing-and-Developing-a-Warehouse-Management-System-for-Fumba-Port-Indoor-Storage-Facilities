const test=require("node:test");
const assert=require("node:assert/strict");
const db=require("../config/db");
const {submit,decide,convertToNormal}=require("../services/managementReleaseService");
const {getCargoFinancialSnapshot,createOrRegenerateDraftInvoice}=require("../services/financeService");
const {evaluateEligibility}=require("../services/releaseEligibilityService");
test.after(()=>db.pool.end());

test("Docker UAT: reject, convert, resubmit, approve, waive, and preserve placement",async t=>{
  const client=await db.pool.connect().catch(()=>null); if(!client){t.skip("Live database unavailable");return}
  try{
    await client.query("BEGIN");
    const cargo=(await client.query(`SELECT * FROM cargo WHERE is_deleted=FALSE AND registration_status='Approved' AND management_release_status='NOT_REQUIRED' ORDER BY id DESC LIMIT 1 FOR UPDATE`)).rows[0];
    if(!cargo){t.skip("No approved UAT cargo fixture is available");await client.query("ROLLBACK");return}
    const users=await client.query(`SELECT r.role_key,u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.status='active' AND r.role_key IN ('warehouse_supervisor','management') ORDER BY u.id DESC`);
    const supervisor=users.rows.find(row=>row.role_key==='warehouse_supervisor'); const management=users.rows.find(row=>row.role_key==='management');
    assert.ok(supervisor&&management,"UAT Supervisor and Management users are required");
    const initialPlacement=cargo.placement_status;

    const first=await submit({cargoRef:cargo.cargo_id,reason:"UAT initial waiver request",actor:{userId:supervisor.id},executor:client});
    assert.equal(first.management_release_status,"PENDING");
    let liveCargo=(await client.query("SELECT * FROM cargo WHERE id=$1",[cargo.id])).rows[0];
    let eligibility=await evaluateEligibility({target:"normal_gate_release",cargo:liveCargo,executor:client});
    assert.equal(eligibility.blocked_requirements[0].reason_code,"MANAGEMENT_RELEASE_PENDING");
    assert.equal((await client.query("SELECT placement_status FROM cargo WHERE id=$1",[cargo.id])).rows[0].placement_status,initialPlacement);
    const rejected=await decide({requestRef:first.request_reference,decision:"REJECTED",remarks:"UAT insufficient justification",actor:{userId:management.id},executor:client});
    assert.equal(rejected.management_release_status,"REJECTED");
    liveCargo=(await client.query("SELECT * FROM cargo WHERE id=$1",[cargo.id])).rows[0];
    eligibility=await evaluateEligibility({target:"normal_gate_release",cargo:liveCargo,executor:client});
    assert.equal(eligibility.blocked_requirements[0].reason_code,"MANAGEMENT_RELEASE_REJECTED");
    await convertToNormal({cargoRef:cargo.cargo_id,remarks:"UAT Normal Release",actor:{userId:supervisor.id},executor:client});

    const second=await submit({cargoRef:cargo.cargo_id,reason:"UAT revised qualifying justification",actor:{userId:supervisor.id},executor:client});
    assert.equal(second.submission_number,Number(cargo.management_release_submission_count||0)+2);
    liveCargo=(await client.query("SELECT * FROM cargo WHERE id=$1",[cargo.id])).rows[0];
    eligibility=await evaluateEligibility({target:"normal_gate_release",cargo:liveCargo,executor:client});
    assert.equal(eligibility.eligible,false);
    const paidInvoice=(await client.query(`INSERT INTO invoices(public_invoice_number,cargo_id,status,billing_period_start,billing_period_end,charge_start_at,charge_end_at,billable_days,currency,base_charge,total_amount,amount_paid,outstanding_balance,payment_status) VALUES($1,$2,'Paid',CURRENT_TIMESTAMP-INTERVAL '2 days',CURRENT_TIMESTAMP-INTERVAL '1 day',CURRENT_TIMESTAMP-INTERVAL '2 days',CURRENT_TIMESTAMP-INTERVAL '1 day',1,'TZS',125,125,125,0,'Paid') RETURNING *`,[`INV-UAT-PAID-${cargo.id}`,cargo.id])).rows[0];
    await client.query(`INSERT INTO payments(public_reference,invoice_id,amount,bank_name,bank_reference,payment_date,status,recorded_by,confirmed_by) VALUES($1,$2,125,'UAT Bank',$3,CURRENT_TIMESTAMP,'Confirmed',$4,$4)`,[`PAY-UAT-${cargo.id}`,paidInvoice.id,`BANK-UAT-${cargo.id}`,management.id]);
    const unpaidInvoice=(await client.query(`INSERT INTO invoices(public_invoice_number,cargo_id,status,billing_period_start,billing_period_end,charge_start_at,charge_end_at,billable_days,currency,base_charge,total_amount,amount_paid,outstanding_balance,payment_status) VALUES($1,$2,'Issued',CURRENT_TIMESTAMP-INTERVAL '4 days',CURRENT_TIMESTAMP-INTERVAL '3 days',CURRENT_TIMESTAMP-INTERVAL '4 days',CURRENT_TIMESTAMP-INTERVAL '3 days',1,'TZS',75,75,0,75,'Unpaid') RETURNING *`,[`INV-UAT-UNPAID-${cargo.id}`,cargo.id])).rows[0];
    const approved=await decide({requestRef:second.request_reference,decision:"APPROVED",remarks:"UAT approved",actor:{userId:management.id},executor:client});
    assert.equal(approved.management_release_status,"APPROVED");
    assert.equal(approved.finance_review_required,true);
    assert.equal((await client.query("SELECT status FROM invoices WHERE id=$1",[unpaidInvoice.id])).rows[0].status,"Cancelled");
    assert.equal((await client.query("SELECT status FROM invoices WHERE id=$1",[paidInvoice.id])).rows[0].status,"Paid");
    assert.equal((await client.query("SELECT status FROM payments WHERE invoice_id=$1",[paidInvoice.id])).rows[0].status,"Confirmed");
    const snapshot=await getCargoFinancialSnapshot({cargoId:cargo.id,executor:client});
    assert.equal(snapshot.outstanding_balance,"0.00");
    assert.equal(snapshot.charge_treatment,"WAIVED_BY_MANAGEMENT_RELEASE");
    assert.equal((await client.query("SELECT placement_status FROM cargo WHERE id=$1",[cargo.id])).rows[0].placement_status,initialPlacement);
    liveCargo=(await client.query("SELECT * FROM cargo WHERE id=$1",[cargo.id])).rows[0];
    eligibility=await evaluateEligibility({target:"normal_gate_release",cargo:liveCargo,executor:client});
    assert.equal(eligibility.blocked_requirements.some(item=>item.evaluator_key==="management_release_authorization"),false);
    assert.equal(eligibility.blocked_requirements.some(item=>item.evaluator_key==="dispatch_approval"),false);
    if(liveCargo.customs_status!=="Cleared") assert.equal(eligibility.blocked_requirements.some(item=>item.evaluator_key==="customs_clearance"),true);
    await assert.rejects(()=>createOrRegenerateDraftInvoice({payload:{cargo_reference:cargo.cargo_id},auth:{userId:management.id},executor:client}),error=>error.errorCode==="MANAGEMENT_RELEASE_NO_CHARGES");
    const histories=await client.query("SELECT status FROM management_release_requests WHERE cargo_id=$1 ORDER BY submission_number",[cargo.id]);
    assert.deepEqual(histories.rows.map(row=>row.status),["REJECTED","APPROVED"]);
    await client.query("ROLLBACK");
  }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
});

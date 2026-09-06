const test=require('node:test');
const assert=require('node:assert/strict');
const db=require('../config/db');
const {getCargoFinancialSnapshot}=require('../services/financeService');
const {evaluateEligibility}=require('../services/releaseEligibilityService');

test('PostgreSQL: storage, installments, grace, penalties, repayment and Gate-Out',{timeout:30000},async()=>{
  const client=await db.pool.connect();
  try{
    await client.query('BEGIN');
    // All fixtures and trigger changes are rolled back; no external payment,
    // notification delivery, or operational cargo is modified.
    await client.query('ALTER TABLE payments DISABLE TRIGGER payment_billing_verification');
    const tariff=(await client.query("SELECT * FROM tariff_versions WHERE approval_status='APPROVED' AND is_active AND tariff_scope='default' LIMIT 1")).rows[0];
    assert.ok(tariff,'An approved default tariff fixture is required');
    await client.query('UPDATE tariff_versions SET daily_rate=1000,minimum_billable_days=1 WHERE id=$1',[tariff.id]);
    const type=(await client.query("SELECT storage_value FROM cargo_option_values WHERE catalog_key='cargo_type' LIMIT 1")).rows[0].storage_value;
    const ref=`BILL-TEST-${Date.now()}`;
    const start=new Date();
    const at=h=>new Date(+start+h*3600000);
    const cargo=(await client.query(`INSERT INTO cargo(cargo_id,barcode,reference_number,consignee_name,cargo_type,charge_start_at,registration_status,customs_status,customs_status_key)
      VALUES($1,$1,$1,'Billing fixture',$3,$2::timestamptz AT TIME ZONE current_setting('TimeZone'),'Approved','Cleared','cleared') RETURNING *`,[ref,start,type])).rows[0];
    const invoice=(await client.query(`INSERT INTO invoices(public_invoice_number,cargo_id,tariff_version_id,status,billing_period_start,billing_period_end,charge_start_at,billable_days,base_charge,total_amount,outstanding_balance)
      VALUES($1,$2,$3,'Issued',$4,$5,$4,1,1000,1000,1000) RETURNING *`,[ref,cargo.id,tariff.id,start,at(1)])).rows[0];
    let counter=0;
    const pay=async(h,amount)=>client.query(`INSERT INTO payments(public_reference,invoice_id,cargo_id,amount,bank_name,payment_date,status,gateway_provider,gateway_status,reconciliation_status,billing_verified_at)
      VALUES($1,$2,$3,$4,'Flutterwave', $5::timestamptz,'Confirmed','flutterwave','SUCCESSFUL','MATCHED',$5::timestamptz)`,[`${ref}-${++counter}`,invoice.id,cargo.id,amount,at(h)]);
    const snapshot=h=>getCargoFinancialSnapshot({cargoId:cargo.id,at:at(h),executor:client});
    assert.equal((await snapshot(1)).charge.total_amount,'1000.00');
    await pay(2,500);
    assert.equal((await snapshot(49)).outstanding_balance,'2500.00');
    await pay(50,2500);
    assert.equal((await snapshot(50)).outstanding_balance,'0.00');
    assert.equal((await snapshot(73.999)).charge.base_charge,'3000.00');
    assert.equal((await snapshot(73.999)).charge.penalties,'0.00');
    assert.equal((await snapshot(74)).outstanding_balance,'1050.00');
    const blocked=await evaluateEligibility({target:'normal_gate_release',cargo,at:at(74),executor:client});
    assert.equal(blocked.eligible,false);
    assert.ok(blocked.blocked_requirements.some(r=>r.evaluator_key==='financial_clearance'));
    assert.equal((await snapshot(98)).outstanding_balance,'2100.00');
    const count=(await client.query('SELECT COUNT(*) FROM invoice_line_items WHERE invoice_id=$1',[invoice.id])).rows[0].count;
    await snapshot(98);
    assert.equal((await client.query('SELECT COUNT(*) FROM invoice_line_items WHERE invoice_id=$1',[invoice.id])).rows[0].count,count);
    await pay(99,2100);
    await client.query("INSERT INTO dispatch_requests(cargo_id,status,reason,decided_at) VALUES($1,'Approved','Test authorization',$2)",[cargo.id,at(99)]);
    await client.query("UPDATE cargo SET placement_status='Placed',customer_presence_status='PRESENT_READY',customer_present_at=$2 WHERE id=$1",[cargo.id,at(100)]);
    assert.equal((await snapshot(122.999)).outstanding_balance,'0.00');
    assert.equal(+(await client.query('SELECT fully_paid_at FROM cargo WHERE id=$1',[cargo.id])).rows[0].fully_paid_at,+at(99));
    const cleared=await evaluateEligibility({target:'normal_gate_release',cargo,at:at(122),executor:client});
    assert.equal(cleared.eligible,true,JSON.stringify(cleared.blocked_requirements));
    const queueCargo=async(suffix,h)=>{
      const reference=ref+suffix;
      const row=(await client.query(`INSERT INTO cargo(cargo_id,barcode,reference_number,consignee_name,cargo_type,charge_start_at,registration_status,placement_status,customs_status,customs_status_key)
        VALUES($1,$1,$1,'Queue fixture',$2,$3::timestamptz AT TIME ZONE current_setting('TimeZone'),'Approved','Placed','Cleared','cleared') RETURNING id`,[reference,type,at(h-1)])).rows[0];
      const inv=(await client.query(`INSERT INTO invoices(public_invoice_number,cargo_id,tariff_version_id,status,billing_period_start,billing_period_end,charge_start_at,billable_days,base_charge,total_amount,outstanding_balance)
        VALUES($1,$2,$3,'Issued',$4,$5,$4,1,1000,1000,1000) RETURNING id`,[reference,row.id,tariff.id,at(h-1),at(h)])).rows[0];
      await client.query(`INSERT INTO payments(public_reference,invoice_id,cargo_id,amount,bank_name,payment_date,status,gateway_provider,gateway_status,reconciliation_status,billing_verified_at)
        VALUES($1,$2,$3,1000,'Flutterwave',$4::timestamptz,'Confirmed','flutterwave','SUCCESSFUL','MATCHED',$4::timestamptz)`,[reference,inv.id,row.id,at(h)]);
      await client.query("INSERT INTO dispatch_requests(cargo_id,status,reason,decided_at) VALUES($1,'Approved','Test authorization',$2)",[row.id,at(h)]);
      if(!suffix.includes('EXPIRED')) await client.query("UPDATE cargo SET customer_presence_status='PRESENT_READY',customer_present_at=$2 WHERE id=$1",[row.id,at(h)]);
      return {reference,id:row.id};
    };
    const c=await queueCargo('-C',98.5);
    const b=await queueCargo('-B',98.1);
    await queueCargo('-EXPIRED',90);
    // Exercise the real queue and Gate controller against this transaction.
    const originalQuery=db.query, originalConnect=db.pool.connect;
    const testQuery=async(sql,params)=>String(sql).includes('SELECT clock_timestamp() AS now')
      ? {rows:[{now:at(122)}],rowCount:1}
      : ['BEGIN','COMMIT','ROLLBACK'].includes(sql)?{rows:[],rowCount:0}:client.query(sql,params);
    db.query=testQuery;
    db.pool.connect=async()=>({query:testQuery,release(){}});
    try {
      const gate=require('../controllers/gateController');
      const actor=(await client.query("SELECT u.id,u.role_id,u.username FROM users u JOIN role_permissions rp ON rp.role_id=u.role_id WHERE rp.permission_key='gate.gate_out.confirm' LIMIT 1")).rows[0];
      assert.ok(actor,'Gate-authorized fixture actor is required');
      let queue;
      await gate.getReleaseQueue({query:{search:ref}},{json:body=>{queue=body;}},error=>{throw error;});
      assert.deepEqual(queue.data.map(row=>row.cargo_reference),[b.reference,c.reference,ref,ref+'-EXPIRED']);
      assert.equal(queue.data[0].allowed_to_gate_out,true);
      assert.equal(queue.data[2].queue_state,'Blocked by Earlier Present Cargo');
      let bypassError;
      await gate.confirmGateOut({params:{cargoReference:ref},body:{vehicle_number:'TEST-001',driver_name:'Test Driver'},auth:{userId:actor.id,roleId:actor.role_id,username:actor.username}},{status(){return this;},json(){}},error=>{bypassError=error;});
      assert.equal(bypassError?.errorCode,'FPFG_ORDER_VIOLATION');
      let presenceError;
      await gate.updateCustomerPresence({params:{cargoReference:ref},body:{status:'WAITING_FOR_CUSTOMER'},auth:{userId:actor.id}},{json(){}},error=>{presenceError=error;});
      assert.equal(presenceError?.errorCode,'PRESENCE_REASON_REQUIRED');
      await gate.updateCustomerPresence({params:{cargoReference:ref},body:{status:'WAITING_FOR_CUSTOMER',reason:'Customer temporarily left collection area.'},auth:{userId:actor.id}},{json(){}},error=>{throw error;});
      assert.equal((await client.query("SELECT COUNT(*)::int count FROM cargo_collection_status_history WHERE cargo_id=$1 AND reason IS NOT NULL",[cargo.id])).rows[0].count,1);
      const release=async reference=>{let body;await gate.confirmGateOut({params:{cargoReference:reference},body:{vehicle_number:'TEST-001',driver_name:'Test Driver'},auth:{userId:actor.id,roleId:actor.role_id,username:actor.username}},{status(){return this;},json(value){body=value;}},error=>{throw error;});return body;};
      await release(b.reference);
      await release(c.reference);
      await gate.updateCustomerPresence({params:{cargoReference:ref},body:{status:'PRESENT_READY',collector_name:'Test Collector'},auth:{userId:actor.id}},{json(){}},error=>{throw error;});
      const released=await release(ref);
      assert.equal(released.data.release_type,'Normal');
      assert.equal((await client.query('SELECT COUNT(*)::int count FROM gate_out_records WHERE cargo_id=$1',[cargo.id])).rows[0].count,1);
    } finally {db.query=originalQuery;db.pool.connect=originalConnect;}

    assert.equal((await snapshot(500)).charge.total_amount,'5100.00');
    const final=(await client.query('SELECT total_amount,outstanding_balance,payment_status FROM invoices WHERE id=$1',[invoice.id])).rows[0];
    assert.equal(final.total_amount,'5100.00');assert.equal(final.outstanding_balance,'0.00');assert.equal(final.payment_status,'Paid');
    await client.query('ALTER TABLE payments ENABLE TRIGGER payment_billing_verification');
    const before=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
    const verified=(await client.query(`INSERT INTO payments(public_reference,invoice_id,cargo_id,amount,bank_name,payment_date,status,gateway_provider,gateway_status,reconciliation_status,billing_verified_at)
      VALUES($1,$2,$3,1,'Flutterwave',CURRENT_TIMESTAMP,'Confirmed','flutterwave','SUCCESSFUL','MATCHED',$4) RETURNING id,billing_verified_at`,[ref+'-CLOCK',invoice.id,cargo.id,at(10000)])).rows[0];
    const after=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
    assert.ok(verified.billing_verified_at>=before && verified.billing_verified_at<=after,'Verification ignores supplied timestamps and records database time');
    const duplicate=(await client.query("UPDATE payments SET gateway_status='SUCCESSFUL' WHERE id=$1 RETURNING billing_verified_at",[verified.id])).rows[0];
    assert.equal(+duplicate.billing_verified_at,+verified.billing_verified_at,'Duplicate verification preserves timestamp');

  } finally{await client.query('ROLLBACK');client.release();}
});


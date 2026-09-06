const test=require('node:test');
const assert=require('node:assert/strict');
const db=require('../config/db');
const gate=require('../controllers/gateController');
const {getCargoFinancialSnapshot}=require('../services/financeService');

test('concurrent direct Gate-Out requests cannot release later-paid cargo before earlier-paid cargo',{timeout:30000},async()=>{
  const references=[`FPFG-CONC-A-${Date.now()}`,`FPFG-CONC-B-${Date.now()}`];
  const ids=[];
  try {
    const type=(await db.query("SELECT storage_value FROM cargo_option_values WHERE catalog_key='cargo_type' LIMIT 1")).rows[0].storage_value;
    const tariff=(await db.query("SELECT id FROM tariff_versions WHERE approval_status='APPROVED' AND is_active AND tariff_scope='default' LIMIT 1")).rows[0];
    const actor=(await db.query("SELECT u.id,u.role_id,u.username FROM users u JOIN role_permissions rp ON rp.role_id=u.role_id WHERE rp.permission_key='gate.gate_out.confirm' LIMIT 1")).rows[0];
    assert.ok(type&&tariff&&actor,'Required authoritative fixtures must exist');
    for(let index=0;index<references.length;index+=1){
      const cargo=(await db.query(`INSERT INTO cargo(cargo_id,barcode,reference_number,consignee_name,cargo_type,registration_status,placement_status,customs_status,customs_status_key,customer_presence_status,customer_present_at)
        VALUES($1,$1,$1,'Concurrency collector',$2,'Approved','Placed','Cleared','cleared','PRESENT_READY',clock_timestamp()) RETURNING id,charge_start_at`,[references[index],type])).rows[0];
      ids.push(cargo.id);
      const invoice=(await db.query(`INSERT INTO invoices(public_invoice_number,cargo_id,tariff_version_id,status,billing_period_start,billing_period_end,charge_start_at,billable_days,base_charge,total_amount,outstanding_balance)
        VALUES($1,$2,$3,'Issued',$4::timestamp,$4::timestamp+interval '1 millisecond',$4::timestamp,1,1000,1000,1000) RETURNING id`,[references[index],cargo.id,tariff.id,cargo.charge_start_at])).rows[0];
      await db.query(`INSERT INTO payments(public_reference,invoice_id,cargo_id,amount,bank_name,payment_date,status,gateway_provider,gateway_status,reconciliation_status)
        VALUES($1,$2,$3,1000,'Flutterwave',clock_timestamp(),'Confirmed','flutterwave','SUCCESSFUL','MATCHED')`,[references[index],invoice.id,cargo.id]);
      await db.query("INSERT INTO dispatch_requests(cargo_id,status,reason,decided_at) VALUES($1,'Approved','Concurrency authorization',clock_timestamp())",[cargo.id]);
      await getCargoFinancialSnapshot({cargoId:cargo.id});
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    const call=reference=>new Promise(resolve=>{
      let settled=false;
      const finish=value=>{if(!settled){settled=true;resolve(value);}};
      gate.confirmGateOut({params:{cargoReference:reference},body:{vehicle_number:'CONC-001',driver_name:'Concurrency Driver'},auth:{userId:actor.id,roleId:actor.role_id,username:actor.username}},{status(){return this;},json(body){finish({body});}},error=>finish({error}));
    });
    const [a,b]=await Promise.all(references.map(call));
    assert.ok(a.body,'Earlier-paid cargo must be released');
    if(b.error) assert.equal(b.error.errorCode,'FPFG_ORDER_VIOLATION');
    const released=(await db.query('SELECT c.cargo_id,g.released_at FROM gate_out_records g JOIN cargo c ON c.id=g.cargo_id WHERE c.id=ANY($1::int[]) ORDER BY g.released_at,g.id',[ids])).rows;
    assert.equal(released[0]?.cargo_id,references[0]);
    if(released.length===2) assert.equal(released[1].cargo_id,references[1]);
  } finally {
    if(ids.length){
      await db.query('DELETE FROM notification_recipients WHERE notification_id IN (SELECT id FROM notifications WHERE related_entity_id=ANY($1::int[]))',[ids]).catch(()=>{});
      await db.query('DELETE FROM notifications WHERE related_entity_id=ANY($1::int[])',[ids]).catch(()=>{});
      await db.query('DELETE FROM cargo_collection_status_history WHERE cargo_id=ANY($1::int[])',[ids]);
      await db.query('DELETE FROM cargo_movements WHERE cargo_id=ANY($1::int[])',[ids]);
      await db.query('DELETE FROM gate_out_records WHERE cargo_id=ANY($1::int[])',[ids]);
      await db.query('DELETE FROM dispatch_requests WHERE cargo_id=ANY($1::int[])',[ids]);
      await db.query('DELETE FROM payments WHERE cargo_id=ANY($1::int[])',[ids]);
      await db.query('DELETE FROM invoice_line_items WHERE invoice_id IN (SELECT id FROM invoices WHERE cargo_id=ANY($1::int[]))',[ids]);
      await db.query('DELETE FROM invoices WHERE cargo_id=ANY($1::int[])',[ids]);
      await db.query('DELETE FROM workflow_transition_history WHERE entity_reference=ANY($1::text[])',[references]);
      await db.query("DELETE FROM audit_logs WHERE metadata->>'cargo_reference'=ANY($1::text[])",[references]);
      await db.query('DELETE FROM cargo WHERE id=ANY($1::int[])',[ids]);
    }
  }
});

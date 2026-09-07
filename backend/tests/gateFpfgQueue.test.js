const test=require('node:test');
const assert=require('node:assert/strict');
const {compareFpfg,paginate,queueState,validatePresenceChange}=require('../services/gateQueueService');

test('FPFG orders latest settlement, registration, then cargo reference',()=>{
  const rows=[
    {cargo_reference:'C',latest_fully_paid_at:'2026-01-02T00:00:00Z',registration_time:'2026-01-01T00:00:00Z'},
    {cargo_reference:'B',latest_fully_paid_at:'2026-01-01T00:00:00Z',registration_time:'2025-12-02T00:00:00Z'},
    {cargo_reference:'A',latest_fully_paid_at:'2026-01-01T00:00:00Z',registration_time:'2025-12-02T00:00:00Z'}
  ];
  assert.deepEqual(rows.sort(compareFpfg).map(row=>row.cargo_reference),['A','B','C']);
});

test('backend pagination is applied after complete FPFG ordering',()=>{
  const rows=Array.from({length:25},(_,index)=>({cargo_reference:String(index+1)}));
  const page=paginate(rows,2,10);
  assert.deepEqual(page.rows.map(row=>row.cargo_reference),Array.from({length:10},(_,index)=>String(index+11)));
  assert.deepEqual({page:page.page,page_size:page.page_size,total:page.total,total_pages:page.total_pages},{page:2,page_size:10,total:25,total_pages:3});
});

test('only first present eligible cargo is Ready Now while absent cargo does not block',()=>{
  assert.equal(queueState({financiallyCleared:true,operationallyEligible:true,firstPresent:true}),'Ready Now');
  assert.equal(queueState({financiallyCleared:true,operationallyEligible:true,firstPresent:false,customerUnavailable:true}),'Customer Unavailable — Skipped');
  assert.equal(queueState({financiallyCleared:true,operationallyEligible:true,firstPresent:false,managementReleaseApproved:true}),'Management Release Ready');
  assert.equal(queueState({financiallyCleared:true,operationallyEligible:true,firstPresent:false}),'Blocked by Earlier Present Cargo');
  assert.equal(queueState({financiallyCleared:false,operationallyEligible:true,firstPresent:false}),'Payment/Penalty Required');
});

test('present-to-absent manipulation requires an accountable reason',()=>{
  assert.throws(()=>validatePresenceChange({oldStatus:'PRESENT_READY',newStatus:'WAITING_FOR_CUSTOMER',reason:''}),error=>error.errorCode==='PRESENCE_REASON_REQUIRED');
  assert.doesNotThrow(()=>validatePresenceChange({oldStatus:'PRESENT_READY',newStatus:'TEMPORARILY_UNAVAILABLE',reason:'Customer temporarily left collection area.'}));
  assert.throws(()=>validatePresenceChange({oldStatus:'WAITING_FOR_CUSTOMER',newStatus:'GATED_OUT',reason:''}),/Unsupported/);
});

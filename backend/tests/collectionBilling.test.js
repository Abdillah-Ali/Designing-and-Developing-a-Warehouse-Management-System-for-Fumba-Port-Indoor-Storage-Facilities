const test = require('node:test');
const assert = require('node:assert/strict');
const {calculateCollectionBilling,penaltyDays,penaltyRate}=require('../services/collectionBilling');
const {getFinanceCalculator}=require('../services/financeCalculatorRegistry');
const start=new Date('2026-01-01T00:00:00Z');
const hour=h=>new Date(+start+h*3600000);
const tariff={calculator_key:'storage_started_day',charging_unit:'per_cargo_per_day',daily_rate:'1000',minimum_billable_days:1};
const storageAt=async at=>{
  const c=getFinanceCalculator(tariff.calculator_key).calculate({cargo:{},tariff,periodStart:start,periodEnd:at});
  return {...c,total_cents:c.base_charge_cents,daily_cents:100000n,late_collection_penalty_percent:"5.0000"};
};
const payment=(id,h,cents)=>({id,paid_at:hour(h),cents});
const calculate=(h,payments=[],releasedAt=null)=>calculateCollectionBilling({payments,at:hour(h),releasedAt,storageAt});

test('one day, multiple days and minimum days use daily rate',async()=>{
  assert.equal((await calculate(24)).total,100000n);
  assert.equal((await calculate(72)).total,300000n);
  const c=getFinanceCalculator('storage_started_day').calculate({cargo:{},tariff:{...tariff,minimum_billable_days:4},periodStart:start,periodEnd:hour(1)});
  assert.equal(c.base_charge_cents,400000n);
});
test('partial payments continue normal storage accrual',async()=>{
  const c=await calculate(49,[payment(1,2,50000n)]);
  assert.equal(c.total,300000n);assert.equal(c.outstanding,250000n);assert.equal(c.firstPaidAt,null);
});
test('full payment freezes normal storage; grace excludes every instant below 24h',async()=>{
  const payments=[payment(1,2,100000n)];
  for(const h of [2,10,25.999999]) {
    const c=await calculate(h,payments);assert.equal(c.total,100000n);assert.equal(c.outstanding,0n);
    assert.equal(+c.firstPaidAt,+hour(2));
  }
});
test('exactly 24h and over 24h charge 105%; subsequent days accrue once',async()=>{
  const payments=[payment(1,2,100000n)];
  assert.equal(penaltyRate(100000n,"5"),105000n);
  assert.equal(penaltyRate(100000n,"10"),110000n);
  assert.equal(penaltyRate(100000n,"0"),100000n);
  assert.throws(()=>penaltyRate(100000n,"-1"),/between 0 and 100/);
  assert.throws(()=>penaltyRate(100000n,"101"),/between 0 and 100/);
  for(const h of [26,26.001,49.999]) assert.equal((await calculate(h,payments)).penalties,105000n);
  assert.equal((await calculate(50,payments)).penalties,210000n);
  assert.equal((await calculate(74,payments)).outstanding,315000n);
  assert.deepEqual(await calculate(74,payments),await calculate(74,payments));
});
test('penalty payment resets collection period; partial penalty payment does not',async()=>{
  const p=[payment(1,2,100000n),payment(2,27,50000n)];
  assert.equal((await calculate(50,p)).outstanding,160000n);
  p.push(payment(3,51,160000n));
  const cleared=await calculate(74.999,p);
  assert.equal(cleared.outstanding,0n);assert.equal(+cleared.fullyPaidAt,+hour(51));
  assert.equal((await calculate(75,p)).outstanding,105000n);
  assert.equal((await calculate(75,p)).storage.total_cents,100000n);
});
test('successful Gate-Out permanently stops accrual',async()=>{
  const payments=[payment(1,2,100000n)];
  assert.equal((await calculate(2400,payments,hour(20))).total,100000n);
  assert.equal((await calculate(2400,payments,hour(27))).total,205000n);
});
test('frozen historical tariff percentage controls late collection penalties',async()=>{
  const changingStorage=async at=>{
    const c=getFinanceCalculator(tariff.calculator_key).calculate({cargo:{},tariff,periodStart:start,periodEnd:at});
    return {...c,total_cents:c.base_charge_cents,daily_cents:100000n,late_collection_penalty_percent:new Date(at)<hour(10)?"5":"10"};
  };
  const frozen=await calculateCollectionBilling({payments:[payment(1,2,100000n)],at:hour(50),storageAt:changingStorage});
  assert.equal(frozen.penalties,200000n+10000n);
});
test('timezone offsets describe identical exact 24h boundaries',()=>{
  assert.equal(penaltyDays('2026-01-01T03:00:00+03:00','2026-01-02T00:00:00Z'),1);
  assert.equal(penaltyDays('2026-01-01T03:00:00+03:00','2026-01-01T23:59:59.999Z'),0);
});

test('payments after emergency Gate-Out can settle balance without adding storage',async()=>{
  const c=await calculate(100,[payment(1,99,100000n)],hour(20));
  assert.equal(c.total,100000n);assert.equal(c.outstanding,0n);
});

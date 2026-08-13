const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {getFinanceCalculator,listFinanceCalculators}=require('../services/financeCalculatorRegistry');
const {calculateSegmentedStorageCharge}=require('../services/financeService');
const {canAccessRoute,PORTAL_ROLES}=require('../middleware/authMiddleware');

const cargo={weight:'250.00',volume:'4.5'};
const tariff={calculator_key:'storage_started_day',charging_unit:'per_cargo_per_day',daily_rate:'10000.00',minimum_billable_days:1};

test('trusted calculator registry resolves known identity and fails closed for unknown identity',()=>{
  assert.deepEqual(listFinanceCalculators().map((item)=>item.calculator_key),['storage_started_day']);
  assert.throws(()=>getFinanceCalculator('arbitrary_formula'),/Unsupported trusted finance calculator/);
});

test('started 24-hour calculator is deterministic and uses monetary integer arithmetic',()=>{
  const result=getFinanceCalculator('storage_started_day').calculate({cargo,tariff,periodStart:'2026-08-01T10:00:00Z',periodEnd:'2026-08-03T09:59:59Z'});
  assert.equal(result.billable_days,2); assert.equal(result.base_charge,'20000.00');
});

test('tariff display names and codes cannot choose executable calculation',()=>{
  const calculator=getFinanceCalculator(tariff.calculator_key);
  const first=calculator.calculate({cargo,tariff:{...tariff,tariff_name:'A',tariff_code:'OLD'},periodStart:'2026-08-01T00:00:00Z',periodEnd:'2026-08-02T00:00:00Z'});
  const second=calculator.calculate({cargo,tariff:{...tariff,tariff_name:'Renamed',tariff_code:'NEW'},periodStart:'2026-08-01T00:00:00Z',periodEnd:'2026-08-02T00:00:00Z'});
  assert.equal(first.base_charge,second.base_charge);
});

test('mid-stay tariff changes are segmented at effective-date boundaries',async()=>{
  const rows=[
    {...tariff,id:1,public_reference:'TRV-A',tariff_name:'A',cargo_type_key:'general_goods',tariff_scope:'cargo_type',effective_from:new Date('2026-08-01T00:00:00Z'),effective_to:new Date('2026-08-11T00:00:00Z')},
    {...tariff,id:2,public_reference:'TRV-B',tariff_name:'B',cargo_type_key:'general_goods',tariff_scope:'cargo_type',daily_rate:'12000.00',effective_from:new Date('2026-08-11T00:00:00Z'),effective_to:null}
  ];
  const executor={query:async()=>({rows,rowCount:rows.length})};
  const result=await calculateSegmentedStorageCharge({cargo:{...cargo,cargo_type_key:'general_goods'},periodStart:new Date('2026-08-01T00:00:00Z'),periodEnd:new Date('2026-08-16T00:00:00Z'),executor});
  assert.equal(result.segments.length,2); assert.equal(result.segments[0].billable_days,10); assert.equal(result.segments[1].billable_days,5); assert.equal(result.total_amount,'160000.00');
});

test('a tariff gap fails closed instead of producing a zero charge',async()=>{
  const rows=[{...tariff,id:1,public_reference:'TRV-A',cargo_type_key:'general_goods',tariff_scope:'cargo_type',effective_from:new Date('2026-08-01T00:00:00Z'),effective_to:new Date('2026-08-05T00:00:00Z')}];
  await assert.rejects(()=>calculateSegmentedStorageCharge({cargo:{...cargo,cargo_type_key:'general_goods'},periodStart:new Date('2026-08-01T00:00:00Z'),periodEnd:new Date('2026-08-10T00:00:00Z'),executor:{query:async()=>({rows,rowCount:1})}}),/No tariff policy covers/);
});

test('payment record and confirmation are independently permissioned routes',()=>{
  assert.equal(canAccessRoute(PORTAL_ROLES.FINANCE_OFFICER,'POST','/finance/payments'),true);
  assert.equal(canAccessRoute(PORTAL_ROLES.FINANCE_OFFICER,'POST','/finance/payments/PAY-1/confirm'),true);
  assert.equal(canAccessRoute(PORTAL_ROLES.MANAGEMENT,'POST','/finance/payments/PAY-1/confirm'),false);
  assert.equal(canAccessRoute(PORTAL_ROLES.SCANNER,'POST','/finance/payments/PAY-1/confirm'),false);
});

test('production payment recording persists pending and confirmation is a distinct mutation',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../services/financeService.js'),'utf8');
  assert.match(source,/VALUES \(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,'Pending Confirmation','TZS'\)/);
  assert.match(source,/const confirmPayment = async/);
  assert.doesNotMatch(source,/VALUES \(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$9\)/);
});

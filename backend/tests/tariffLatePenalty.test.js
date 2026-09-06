const test=require("node:test");
const assert=require("node:assert/strict");
const {readTariffPayload}=require("../services/financeService");
const base={tariff_name:"Storage",cargo_type:"default",charging_unit:"per_cargo_per_day",daily_rate:"1000",currency:"TZS",minimum_billable_days:1,effective_from:"2026-01-01T00:00:00Z"};
test("tariff accepts configured 0, 5 and 10 percent late-collection rates",()=>{
  assert.equal(readTariffPayload({...base,late_collection_penalty_percent:0}).latePenaltyPercent,"0.0000");
  assert.equal(readTariffPayload({...base,late_collection_penalty_percent:5}).latePenaltyPercent,"5.0000");
  assert.equal(readTariffPayload({...base,late_collection_penalty_percent:10}).latePenaltyPercent,"10.0000");
});
test("tariff rejects missing, negative and excessive late-collection rates",()=>{
  assert.throws(()=>readTariffPayload(base),/between 0 and 100/);
  assert.throws(()=>readTariffPayload({...base,late_collection_penalty_percent:-1}),/between 0 and 100/);
  assert.throws(()=>readTariffPayload({...base,late_collection_penalty_percent:101}),/between 0 and 100/);
});

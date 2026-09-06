const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizeTanzanianNumber,validateTanzanianMobileMoney}=require("../services/tanzaniaMobileMoney");

test("normalizes Tanzanian local and international mobile formats",()=>{
  for(const input of ["074 123 4567","255741234567","+255 741 234 567","741234567","(0741)-234-567"]) assert.equal(normalizeTanzanianNumber(input),"255741234567");
});
test("accepts configured prefixes for every supported mobile-money network",()=>{
  assert.equal(validateTanzanianMobileMoney({phone:"0751234567",network:"vodacom"}).canonical,"255751234567");
  assert.equal(validateTanzanianMobileMoney({phone:"0681234567",network:"airtel"}).canonical,"255681234567");
  assert.equal(validateTanzanianMobileMoney({phone:"0711234567",network:"tigo"}).canonical,"255711234567");
  assert.equal(validateTanzanianMobileMoney({phone:"0611234567",network:"halotel"}).canonical,"255611234567");
});
test("rejects malformed numbers and selected-network mismatches",()=>{
  for(const phone of ["", "123", "074ABC4567", "+1 555 123 4567", "2557412345678"]) assert.throws(()=>normalizeTanzanianNumber(phone),/Tanzanian mobile number/);
  assert.throws(()=>validateTanzanianMobileMoney({phone:"0751234567",network:"airtel"}),error=>error.errorCode==="MOBILE_NETWORK_MISMATCH"&&/Airtel Money/.test(error.message));
});

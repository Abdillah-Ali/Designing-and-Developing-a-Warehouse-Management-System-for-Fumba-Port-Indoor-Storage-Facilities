const test=require("node:test");
const assert=require("node:assert/strict");
const {assertScope,allowed}=require("../controllers/roleReportController");

const canonical={finance:"finance-officer",auditor:"auditor",supervisor:"warehouse-supervisor",admin:"system-admin",customs:"customs-officer",gate:"gate-officer",warehouse:"warehouse-staff"};
test("every specialized report scope has exactly one approved role",()=>assert.deepEqual(allowed,canonical));
for(const [scope,role] of Object.entries(canonical)){
  test(`${role} can select only the ${scope} report scope`,()=>{
    assert.equal(assertScope({params:{scope},auth:{role}}),scope);
    for(const other of [...Object.values(canonical),"management","scanner"].filter(x=>x!==role))assert.throws(()=>assertScope({params:{scope},auth:{role:other}}),e=>e.statusCode===403);
  });
}
test("scanner is forbidden from every report API scope",()=>{for(const scope of Object.keys(canonical))assert.throws(()=>assertScope({params:{scope},auth:{role:"scanner"}}),e=>e.statusCode===403)});

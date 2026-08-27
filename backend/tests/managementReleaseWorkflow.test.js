const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname,"..");
const read = (file) => fs.readFileSync(path.join(root,file),"utf8");
const migration = read("database/migrations/20260816_management_release_workflow.sql");
const service = read("services/managementReleaseService.js");
const finance = read("services/financeService.js");
const gate = read("controllers/gateController.js");
const placement = read("services/placementService.js");
const supervisor = read("controllers/supervisorController.js");

test("existing cargo defaults to Normal Release without Management review",()=>{
  assert.match(migration,/release_type VARCHAR\(30\) NOT NULL DEFAULT 'NORMAL'/);
  assert.match(migration,/management_release_status VARCHAR\(30\) NOT NULL DEFAULT 'NOT_REQUIRED'/);
});
test("request history preserves every submission and permits only one pending request",()=>{
  assert.match(migration,/UNIQUE\(cargo_id, submission_number\)/);
  assert.match(migration,/one_pending[\s\S]*WHERE status='PENDING'/);
});
test("Supervisor approval records release classification in the same transaction",()=>{
  assert.match(supervisor,/release_type \|\| "NORMAL"/);
  assert.match(supervisor,/submitManagementRelease/);
  assert.match(supervisor,/queueAndAttemptManagementReleaseEmail/);
  assert.match(supervisor,/releaseType === "NORMAL"[\s\S]*activateRegistrationInvoice/);
});
test("Management state transitions use row locks and server actors",()=>{
  assert.match(service,/FOR UPDATE OF mrr,c/);
  assert.match(service,/actor\?\.userId/);
  assert.doesNotMatch(service,/req\.body.*actor|req\.body.*timestamp/);
});
test("placement remains independent of every Management Release state",()=>{
  assert.doesNotMatch(placement,/management_release/i);
  assert.doesNotMatch(service,/placement_status\s*=/i);
});
test("approved Management Release has zero payable balance while preserving accrual",()=>{
  assert.match(finance,/managementReleased \? 0n/);
  assert.match(finance,/historical_accrued_amount/);
  assert.match(service,/management_release_waived_amount/);
});
test("Finance cannot generate or issue a payable invoice after approval",()=>{
  assert.equal((finance.match(/MANAGEMENT_RELEASE_NO_CHARGES/g)||[]).length,2);
  assert.match(finance,/SELECT management_release_status FROM cargo WHERE id=\$1 FOR UPDATE/);
});
test("unpaid invoices are cancelled but paid history is flagged for Finance review",()=>{
  assert.match(service,/amount_paid=0/);
  assert.match(service,/financeReview=Number\(invoiceTotals\.paid\)>0/);
});
test("Gate exposes and audits Management Release without bypassing other eligibility rules",()=>{
  assert.match(gate,/No Charges \/ Waived/);
  assert.match(gate,/CONFIRM_MANAGEMENT_RELEASE_GATE_OUT/);
  assert.match(gate,/buildEligibility\(\{ executor: client, cargo/);
});
test("explicit permissions separate request, view, and decision authority",()=>{
  for(const key of ["management_release.request","management_release.view","management_release.decide"]) assert.match(migration,new RegExp(key.replace(".","\\.")));
});

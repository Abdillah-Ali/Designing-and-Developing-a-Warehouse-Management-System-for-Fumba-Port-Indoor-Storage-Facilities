const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {getNotificationEvent,listNotificationEvents,listRequiredNotificationEvents,validateEventPolicyContract}=require("../services/notificationEventRegistry");
const {getRecipientResolver,validateRecipientParameters}=require("../services/notificationRecipientResolverRegistry");
const {getDeepLinkBuilder}=require("../services/notificationDeepLinkRegistry");
const {canArchive,RESOLUTION_KEYS}=require("../services/notificationLifecycleRegistry");
const {policyIssues}=require("../services/notificationAuthorityService");

test("Phase 10 migration establishes revisioned policy and historical notification snapshots",()=>{
 const sql=fs.readFileSync(path.join(__dirname,"../database/migrations/20260813_notification_policy_authority.sql"),"utf8");
 assert.match(sql,/CREATE TABLE IF NOT EXISTS notification_policies/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS notification_policy_recipients/);
 assert.match(sql,/ADD COLUMN IF NOT EXISTS event_key/);
 assert.match(sql,/policy_mapping_status/);
 assert.match(sql,/idx_notifications_active_action_dedup/);
 assert.doesNotMatch(sql,/\('invoice_pending'/);
});

test("approved critical events are immutable trusted identities",()=>{
 for(const key of ["cargo.review_required","cargo.review_overdue","customs.inspection_required","gate.release_ready","gate.release_blocked","finance.charge_started"])
  assert.ok(getNotificationEvent(key),key);
 assert.equal(getNotificationEvent("editable title"),null);
 assert.ok(listRequiredNotificationEvents().includes("customs.inspection_required"));
});

test("recipient registry validates permission scope and excludes role-label execution",()=>{
 assert.ok(getRecipientResolver("users_with_permission"));
 assert.equal(getRecipientResolver("Warehouse Supervisor"),null);
 assert.deepEqual(validateRecipientParameters("users_with_permission",{permission_key:"cargo.approve",scope:"warehouse"}),[]);
 assert.ok(validateRecipientParameters("users_with_permission",{permission_key:"cargo.approve",scope:"arbitrary"}).length);
});

test("warehouse permission resolution is scoped and Scanner is excluded",async()=>{
 const calls=[]; const executor={query:async(sql,values)=>{calls.push({sql,values});return{rows:[]};}};
 await getRecipientResolver("users_with_permission")({warehouse_id:7},{permission_key:"cargo.approve",scope:"warehouse"},executor);
 assert.deepEqual(calls[0].values,["cargo.approve",7]);
 assert.match(calls[0].sql,/u\.warehouse_id=\$2/);
 assert.match(calls[0].sql,/role_key<>'scanner'/);
});

test("Customs global resolution does not invent warehouse scope",async()=>{
 const calls=[]; const executor={query:async(sql,values)=>{calls.push({sql,values});return{rows:[]};}};
 await getRecipientResolver("users_with_permission")({warehouse_id:7},{permission_key:"customs.inspections.create",scope:"global"},executor);
 assert.deepEqual(calls[0].values,["customs.inspections.create"]);
 assert.doesNotMatch(calls[0].sql,/u\.warehouse_id=/);
});

test("trusted deep links use business references and never arbitrary URLs",()=>{
 const context={cargo:{cargo_id:"CG-2026-0042"}};
 assert.equal(getDeepLinkBuilder("cargo_review")(context),"/supervisor/cargo/pending-approvals?cargoRef=CG-2026-0042");
 assert.equal(getDeepLinkBuilder("cargo_correction")(context),"/staff/cargo/registration?tab=reviews&cargoRef=CG-2026-0042");
 assert.equal(getDeepLinkBuilder("https://attacker.invalid"),null);
});

test("read state is independent and unresolved actionable notifications cannot archive",()=>{
 assert.equal(canArchive({archive_policy_key:"actionable_until_resolved",status:"pending",is_read:true}),false);
 assert.equal(canArchive({archive_policy_key:"actionable_until_resolved",status:"completed",is_read:false}),true);
 assert.equal(canArchive({archive_policy_key:"informational_archiveable",status:"pending",is_read:false}),true);
});

test("approved Customs and Gate automatic resolution strategies are trusted",()=>{
 assert.ok(RESOLUTION_KEYS.has("customs_left_pending"));
 assert.ok(RESOLUTION_KEYS.has("gate_released"));
});

test("invalid executable policy keys fail closed",()=>{
 const issues=policyIssues({event_key:"cargo.review_required",deep_link_builder_key:"javascript",resolution_strategy_key:"shell",archive_policy_key:"hide",actionable:true,configuration_status:"ready",recipients:[{resolver_key:"role display",parameters:{}}]});
 assert.ok(issues.length>=4);
});

test("every operational event owns an exact semantic policy contract",()=>{
 for(const eventKey of listNotificationEvents()){
  const event=getNotificationEvent(eventKey);
  const policy={event_key:eventKey,...event.contract,recipients:event.contract.recipients};
  assert.deepEqual(validateEventPolicyContract(policy),[],eventKey);
  assert.ok(validateEventPolicyContract({...policy,notification_type:`${policy.notification_type}.wrong`}).length,eventKey);
  assert.ok(validateEventPolicyContract({...policy,recipients:[...policy.recipients,{resolver_key:"specific_user",parameters:{source:"actor_user_id"}}]}).length,eventKey);
 }
});

test("business workflows centralize approved Phase 10 automatic resolution",()=>{
 const customs=fs.readFileSync(path.join(__dirname,"../services/customsWorkflowService.js"),"utf8");
 const gate=fs.readFileSync(path.join(__dirname,"../controllers/gateController.js"),"utf8");
 assert.match(customs,/resolveNotificationStrategy\(['"]customs_left_pending['"]/);
 assert.match(gate,/resolveNotificationStrategy\(['"]gate_released['"]/);
});

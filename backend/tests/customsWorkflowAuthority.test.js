const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {workflowConditionRegistry}=require('../services/workflowConditionRegistry');
const {workflowEffectRegistry}=require('../services/workflowEffectRegistry');
const {STATUS_ACTIONS}=require('../services/customsWorkflowService');
const {canAccessRoute,PORTAL_ROLES}=require('../middleware/authMiddleware');

const migration=fs.readFileSync(path.join(__dirname,'../database/migrations/20260813_customs_workflow_authority.sql'),'utf8');
const controller=fs.readFileSync(path.join(__dirname,'../controllers/customsController.js'),'utf8');

test('migration 026 defines protected Customs states and revisioned transition policy',()=>{
  for(const key of ['pending_inspection','inspection_in_progress','documents_required','on_hold','cleared','rejected']) assert.match(migration,new RegExp(`'customs','${key}'`));
  for(const key of Object.values(STATUS_ACTIONS)) assert.match(migration,new RegExp(`'${key}'`));
});

test('trusted Customs condition and effect identities are code-owned',()=>{
  assert.equal(workflowConditionRegistry.cargo_not_gate_released.supported_workflows.includes('customs'),true);
  assert.equal(workflowEffectRegistry.update_customs_state.supported_workflows.includes('customs'),true);
  assert.equal(workflowConditionRegistry.unknown_customs_condition,undefined);
});

test('notes and confirmation policy preserve prior Customs behavior',()=>{
  assert.match(migration,/'request_documents'.*'required',FALSE/);
  assert.match(migration,/'place_on_hold'.*'required',FALSE/);
  assert.match(migration,/'reject_customs'.*'required',FALSE/);
  assert.match(migration,/'clear_customs'.*'optional',TRUE/);
  assert.match(migration,/'start_inspection'.*'optional',FALSE/);
});

test('ordinary Customs controller delegates mutations to the trusted workflow service',()=>{
  assert.match(controller,/transitionCustoms/);
  assert.doesNotMatch(controller,/action: "UPDATE_CUSTOMS_STATUS"/);
  assert.doesNotMatch(controller,/action: "START_CUSTOMS_INSPECTION"/);
});

test('Customs mutations remain isolated from Management and Scanner',()=>{
  assert.equal(canAccessRoute(PORTAL_ROLES.CUSTOMS_OFFICER,'POST','/customs/cargo/C-1/start'),true);
  assert.equal(canAccessRoute(PORTAL_ROLES.CUSTOMS_OFFICER,'POST','/customs/cargo/C-1/status'),true);
  assert.equal(canAccessRoute(PORTAL_ROLES.MANAGEMENT,'POST','/customs/cargo/C-1/status'),false);
  assert.equal(canAccessRoute(PORTAL_ROLES.SCANNER,'POST','/customs/cargo/C-1/status'),false);
});

test('Customs effect does not mutate charging, Finance, dispatch, or Gate fields',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../services/workflowEffectRegistry.js'),'utf8');
  const customsEffect=source.slice(source.indexOf('update_customs_state'));
  assert.doesNotMatch(customsEffect,/SET charge_start_at|SET financial_status|SET gate_out_status|SET dispatch/i);
});

test('stale and concurrent Customs actions carry an expected stable source state',()=>{
  const service=fs.readFileSync(path.join(__dirname,'../services/customsWorkflowService.js'),'utf8');
  assert.match(service,/input\.expected_state_key.*customs_status_key/);
});

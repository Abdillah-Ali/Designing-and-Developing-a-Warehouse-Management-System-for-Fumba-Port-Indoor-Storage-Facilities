const db=require('../config/db');
const {executeTransition}=require('./cargoWorkflowEngine');
const {buildError}=require('../utils/apiError');

const STATUS_ACTIONS=Object.freeze({'Inspection In Progress':'start_inspection','Documents Required':'request_documents','On Hold':'place_on_hold','Cleared':'clear_customs','Rejected':'reject_customs'});
const transitionCustoms=async({cargoReference,transitionKey,actor,input={},executor})=>{
  const cargo=(await executor.query(`SELECT * FROM cargo WHERE (cargo_id=$1 OR barcode=$1 OR reference_number=$1) AND is_deleted=FALSE LIMIT 1 FOR UPDATE`,[cargoReference])).rows[0];
  if(!cargo) throw buildError('Cargo record not found.',404);
  if(input.expected_state_key && cargo.customs_status_key!==input.expected_state_key) throw buildError('Customs state changed before this action was applied.',409,null,'WORKFLOW_TRANSITION_NOT_ALLOWED');
  const result=await executeTransition({workflowKey:'customs',transitionKey,cargoId:cargo.id,actor,input,executor,lockedCargo:cargo});
  if(cargo.customs_status_key==='pending_inspection'&&result.policy.to_state_key!=='pending_inspection'){
    const {resolveNotificationStrategy}=require('./notificationAuthorityService');
    await resolveNotificationStrategy('customs_left_pending',{subjectReference:cargo.cargo_id,executor});
  }
  return result;
};
const getAllowedCustomsActions=async({cargo,actor,executor=db})=>{
  const result=await executor.query(`SELECT wt.transition_key,wt.display_label,wt.notes_requirement,wt.confirmation_requirement,wt.required_permission_key,ts.state_key AS to_state_key,ts.storage_value AS to_storage_value FROM workflow_definitions wd JOIN workflow_states fs ON fs.workflow_key=wd.workflow_key AND fs.storage_value=$1 JOIN workflow_transitions wt ON wt.workflow_key=wd.workflow_key AND wt.revision=wd.active_revision AND wt.from_state_key=fs.state_key AND wt.active JOIN workflow_states ts ON ts.workflow_key=wt.workflow_key AND ts.state_key=wt.to_state_key JOIN role_permissions rp ON rp.permission_key=wt.required_permission_key AND rp.role_id=$2 WHERE wd.workflow_key='customs' AND wd.active ORDER BY wt.priority`,[cargo.customs_status,actor?.roleId||actor?.role_id||0]);
  return result.rows;
};
module.exports={STATUS_ACTIONS,transitionCustoms,getAllowedCustomsActions};

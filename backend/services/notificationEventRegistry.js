const contract=(notificationType,resolver,parameters,deepLink,resolution,actionable,archive)=>Object.freeze({
  notification_type:notificationType,
  recipients:Object.freeze([{resolver_key:resolver,parameters:Object.freeze(parameters)}]),
  deep_link_builder_key:deepLink,
  resolution_strategy_key:resolution,
  actionable,
  archive_policy_key:archive
});
const event=(domain,build,policyContract,required=false)=>Object.freeze({domain,build,contract:policyContract,required});
const ref=(context)=>context.cargo?.cargo_id||context.cargo?.public_reference||context.subject_reference||"cargo";
const INFO="informational_archiveable"; const ACTION="actionable_until_resolved";
const specific={context_key:"recipient_user_id"};
const permission=(permission_key,scope)=>({permission_key,scope});

const EVENTS=Object.freeze({
 "cargo.review_required":event("cargo",c=>({title:"New cargo registration pending review",message:`New cargo registration pending review: ${ref(c)}`,module:"Cargo Approvals"}),contract("pending_approval","users_with_permission",permission("cargo.approve","warehouse"),"cargo_review","cargo_review_completed",true,ACTION),true),
 "cargo.review_overdue":event("cargo",c=>({title:`Cargo approval overdue: ${ref(c)}`,message:`${ref(c)} has waited ${Number(c.waiting_hours||0).toFixed(1)} hours for supervisor approval.`,module:"Cargo Approvals"}),contract("warehouse_alert","users_with_permission",permission("cargo.approve","warehouse"),"cargo_review","cargo_review_completed",true,ACTION),true),
 "cargo.correction_requested":event("cargo",c=>({title:`Correction required for ${ref(c)}`,message:c.notes||"Supervisor requested registration changes.",module:"Cargo Corrections"}),contract("correction_request","cargo_owner",{},"cargo_correction","correction_resubmitted",true,ACTION),true),
 "cargo.registration_approved":event("cargo",c=>({title:`Cargo registration approved: ${ref(c)}`,message:c.notes||"Cargo registration was approved.",module:"Cargo Approvals"}),contract("approval_decision","specific_user",specific,"cargo_correction","none",false,INFO)),
 "cargo.registration_rejected":event("cargo",c=>({title:`Cargo registration rejected: ${ref(c)}`,message:c.notes||"Cargo registration was rejected.",module:"Cargo Approvals"}),contract("approval_decision","specific_user",specific,"cargo_correction","none",false,INFO)),
 "finance.charge_started":event("finance",c=>({title:`Cargo registered and charging started: ${ref(c)}`,message:`Storage charging started from registration time for ${ref(c)}.`,module:"Billing and Payment"}),contract("finance_charge_started","users_with_permission",permission("finance.charges.view","global"),"finance_cargo","none",false,INFO),true),
 "customs.inspection_required":event("customs",c=>({title:`Cargo awaiting customs inspection: ${ref(c)}`,message:`Cargo ${ref(c)} is registered and available for customs processing.`,module:"Customs Management"}),contract("customs_inspection","users_with_permission",permission("customs.inspections.create","global"),"customs_queue","customs_left_pending",true,ACTION),true),
 "placement.override_requested":event("placement",c=>({title:"Placement override pending approval",message:`Placement override request pending approval for ${ref(c)}.`,module:"Cargo Placement"}),contract("placement_override","users_with_permission",permission("cargo.approve","warehouse"),"placement_override","placement_override_decided",true,ACTION),true),
 "placement.override_approved":event("placement",c=>({title:"Placement override approved",message:c.notes||`Approved placement override request for ${ref(c)}.`,module:"Cargo Placement"}),contract("approval_decision","specific_user",specific,"staff_placement","none",false,INFO)),
 "placement.override_rejected":event("placement",c=>({title:"Placement override rejected",message:c.notes||`Rejected placement override request for ${ref(c)}.`,module:"Cargo Placement"}),contract("approval_decision","specific_user",specific,"staff_placement","none",false,INFO)),
 "dispatch.requested":event("dispatch",c=>({title:"Dispatch request pending action",message:`Dispatch request submitted for ${ref(c)}.`,module:"Dispatch Operations"}),contract("dispatch_request","users_with_permission",permission("dispatch.requests.decide","warehouse"),"dispatch_request","dispatch_decided",true,ACTION),true),
 "dispatch.submitted":event("dispatch",c=>({title:"Dispatch request submitted",message:`Dispatch request submitted for ${ref(c)}.`,module:"Dispatch Operations"}),contract("dispatch_update","specific_user",specific,"staff_dispatch","none",false,INFO)),
 "dispatch.approved":event("dispatch",c=>({title:"Dispatch request approved",message:c.notes||`Dispatch request approved for ${ref(c)}.`,module:"Dispatch Operations"}),contract("dispatch_update","specific_user",specific,"staff_dispatch","none",false,INFO)),
 "dispatch.rejected":event("dispatch",c=>({title:"Dispatch request rejected",message:c.notes||`Dispatch request rejected for ${ref(c)}.`,module:"Dispatch Operations"}),contract("dispatch_update","specific_user",specific,"staff_dispatch","none",false,INFO)),
 "gate.release_ready":event("gate",c=>({title:`Cargo approved for gate release: ${ref(c)}`,message:`Dispatch was approved for ${ref(c)}. Validate customs and payment before release.`,module:"Dispatch and Gate"}),contract("gate_release_update","users_with_permission",permission("gate.gate_out.confirm","global"),"gate_release","gate_released",true,ACTION),true),
 "gate.release_blocked":event("gate",c=>({title:`Release blocked: ${ref(c)}`,message:`Release for ${ref(c)} is blocked because one or more prerequisites remain unsatisfied.`,module:"Dispatch and Gate"}),contract("gate_release_update","users_with_permission",permission("gate.gate_out.confirm","global"),"gate_release","none",false,INFO)),
 "finance.release_blocked":event("finance",c=>({title:`Dispatch blocked by unpaid charges: ${ref(c)}`,message:`Gate release for ${ref(c)} is blocked. Outstanding balance: ${c.outstanding_amount||"0.00"}.`,module:"Billing and Payment"}),contract("finance_payment_update","users_with_permission",permission("finance.payments.record","global"),"finance_cargo","none",false,INFO)),
 "finance.emergency_balance":event("finance",c=>({title:`Emergency release completed with balance: ${ref(c)}`,message:`Emergency release completed for ${ref(c)}. Outstanding balance remains ${c.outstanding_amount||"0.00"}.`,module:"Billing and Payment"}),contract("finance_payment_update","users_with_permission",permission("finance.payments.record","global"),"finance_cargo","none",false,INFO)),
 "warehouse.alert":event("warehouse",c=>({title:c.title,message:c.message,module:"Warehouse Alerts"}),contract("warehouse_alert","users_with_permission",permission("cargo.approve","warehouse"),"none","none",false,INFO))
});

const getNotificationEvent=(key)=>EVENTS[key]||null;
const listNotificationEvents=()=>Object.keys(EVENTS);
const listRequiredNotificationEvents=()=>Object.entries(EVENTS).filter(([,value])=>value.required).map(([key])=>key);
const canonical=(value)=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const sameParameters=(left={},right={})=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
const validateEventPolicyContract=(policy)=>{
 const eventDefinition=getNotificationEvent(policy.event_key); if(!eventDefinition)return[{code:"NOTIFICATION_EVENT_UNKNOWN",event_key:policy.event_key}];
 const expected=eventDefinition.contract; const issues=[];
 const mismatch=(field,code)=>{if(policy[field]!==expected[field])issues.push({code,event_key:policy.event_key,field});};
 mismatch("notification_type","NOTIFICATION_TYPE_NOT_ALLOWED"); mismatch("deep_link_builder_key","NOTIFICATION_DEEP_LINK_NOT_ALLOWED"); mismatch("resolution_strategy_key","NOTIFICATION_RESOLUTION_NOT_ALLOWED"); mismatch("archive_policy_key","NOTIFICATION_ARCHIVE_NOT_ALLOWED"); mismatch("actionable","NOTIFICATION_ACTIONABILITY_NOT_ALLOWED");
 const recipients=policy.recipients||[];
 if(recipients.length!==expected.recipients.length)issues.push({code:"NOTIFICATION_RECIPIENT_NOT_ALLOWED",event_key:policy.event_key});
 else for(let index=0;index<recipients.length;index++){const actual=recipients[index],allowed=expected.recipients[index];if(actual.resolver_key!==allowed.resolver_key)issues.push({code:"NOTIFICATION_RECIPIENT_NOT_ALLOWED",event_key:policy.event_key});else if(!sameParameters(actual.parameters,allowed.parameters))issues.push({code:"NOTIFICATION_RECIPIENT_PARAMETERS_NOT_ALLOWED",event_key:policy.event_key});}
 return issues;
};
module.exports={getNotificationEvent,listNotificationEvents,listRequiredNotificationEvents,validateEventPolicyContract};

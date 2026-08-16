const {buildError}=require('../utils/apiError');
const targets=Object.freeze(['dispatch_request','normal_gate_release','emergency_gate_release']);
const result=(passed,reason_code,message,details={})=>({passed,reason_code:passed?null:reason_code,message:passed?null:message,...details});
const managementReleaseAuthorization=(c)=>{
 const releaseType=String(c.cargo?.release_type||'NORMAL').toUpperCase();
 const status=String(c.cargo?.management_release_status||'NOT_REQUIRED').toUpperCase();
 if(releaseType==='NORMAL'&&status==='NOT_REQUIRED')return result(true);
 if(releaseType!=='MANAGEMENT')return result(false,'MANAGEMENT_RELEASE_STATE_INVALID','Cargo release classification is inconsistent and requires authorized correction.');
 if(status==='APPROVED')return result(true);
 if(status==='PENDING')return result(false,'MANAGEMENT_RELEASE_PENDING','Management Release approval is pending. Management approval is required before Gate-Out.');
 if(status==='REJECTED')return result(false,'MANAGEMENT_RELEASE_REJECTED','Management Release was rejected. Supervisor action is required before Gate-Out.');
 return result(false,'MANAGEMENT_RELEASE_APPROVAL_REQUIRED','Explicit Management Release approval is required before Gate-Out.');
};
const definitions=Object.freeze({
 registration_state:{supported_policy_targets:['dispatch_request','normal_gate_release'],parameter_schema:{allowed:'state_keys'},evaluate:(c,p)=>result((p.allowed||[]).includes(c.registration_state_key),'REGISTRATION_STATE_BLOCKED','Cargo registration is not approved.')},
 placement_state:{supported_policy_targets:['dispatch_request'],parameter_schema:{allowed:'state_keys'},evaluate:(c,p)=>result((p.allowed||[]).includes(c.placement_state_key),'PLACEMENT_STATE_BLOCKED','Cargo must be placed before dispatch request.')},
 customs_clearance:{supported_policy_targets:['normal_gate_release'],parameter_schema:{required_state:'state_key'},evaluate:(c,p)=>result(c.customs_state_key===p.required_state,'CUSTOMS_NOT_CLEARED','Cargo must be cleared by Customs.')},
 financial_clearance:{supported_policy_targets:['normal_gate_release'],parameter_schema:{maximum_outstanding:'money'},evaluate:(c)=>result(c.outstanding_cents===0n,'OUTSTANDING_BALANCE','Finance confirmation is required.',{outstanding_amount:c.outstanding_amount})},
 dispatch_approval:{supported_policy_targets:['normal_gate_release'],parameter_schema:{},evaluate:(c)=>result(Boolean(c.dispatch_request),'DISPATCH_APPROVAL_MISSING','An active approved dispatch request is required.')},
 management_release_authorization:{supported_policy_targets:['normal_gate_release','emergency_gate_release'],parameter_schema:{},evaluate:managementReleaseAuthorization},
 release_state:{supported_policy_targets:targets,parameter_schema:{allowed:'state_keys'},evaluate:(c,p)=>result((p.allowed||[]).includes(c.release_state_key),'ALREADY_RELEASED','Cargo has already been released.')},
 emergency_authorization:{supported_policy_targets:['emergency_gate_release'],parameter_schema:{},evaluate:(c)=>result(Boolean(c.emergency_authorization),'EMERGENCY_RELEASE_NOT_APPROVED','An approved unused emergency authorization is required.')}
});
const validateEligibilityRequirement=(target,key,parameters={})=>{
 const d=definitions[key]; if(!d)return ['Unknown eligibility evaluator.']; if(!d.supported_policy_targets.includes(target))return ['Evaluator does not support target.'];
 if(!parameters||typeof parameters!=='object'||Array.isArray(parameters))return ['Parameters must be an object.']; return [];
};
const evaluateRequirement=(target,key,context,parameters)=>{const errors=validateEligibilityRequirement(target,key,parameters);if(errors.length)throw buildError('Eligibility policy configuration is invalid.',409,errors,'ELIGIBILITY_POLICY_INVALID');return definitions[key].evaluate(context,parameters)};
module.exports={ELIGIBILITY_TARGETS:targets,eligibilityEvaluatorRegistry:definitions,evaluateRequirement,validateEligibilityRequirement};

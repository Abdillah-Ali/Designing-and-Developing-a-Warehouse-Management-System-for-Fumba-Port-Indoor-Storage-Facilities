const db=require("../config/db");
const {buildError}=require("../utils/apiError");
const {createNotification}=require("./notificationService");
const {getNotificationEvent,listRequiredNotificationEvents,validateEventPolicyContract}=require("./notificationEventRegistry");
const {getRecipientResolver,validateRecipientParameters}=require("./notificationRecipientResolverRegistry");
const {getDeepLinkBuilder}=require("./notificationDeepLinkRegistry");
const {ARCHIVE_KEYS,RESOLUTION_KEYS}=require("./notificationLifecycleRegistry");
const {writeConfigurationAudit}=require("./configurationAuditService");
const ALLOWED_PRIORITIES=new Set(["low","normal","high","urgent"]);

const loadPolicy=async(eventKey,executor=db)=>{
 const result=await executor.query(`SELECT p.*,COALESCE(jsonb_agg(jsonb_build_object('resolver_key',r.resolver_key,'parameters',r.parameters) ORDER BY r.sequence) FILTER(WHERE r.resolver_key IS NOT NULL),'[]'::jsonb) recipients FROM notification_policies p LEFT JOIN notification_policy_recipients r ON r.event_key=p.event_key AND r.policy_revision=p.revision WHERE p.event_key=$1 AND p.active GROUP BY p.event_key,p.revision`,[eventKey]);
 if(result.rowCount!==1)throw buildError(`Notification policy '${eventKey}' is missing or ambiguous.`,503,null,"NOTIFICATION_POLICY_NOT_READY");
 return result.rows[0];
};

const policyIssues=(policy)=>{
 const issues=[];
 if(!getNotificationEvent(policy.event_key))issues.push({code:"NOTIFICATION_EVENT_UNKNOWN",event_key:policy.event_key});
 if(!getDeepLinkBuilder(policy.deep_link_builder_key))issues.push({code:"NOTIFICATION_DEEP_LINK_UNKNOWN",event_key:policy.event_key});
 if(!RESOLUTION_KEYS.has(policy.resolution_strategy_key))issues.push({code:"NOTIFICATION_RESOLUTION_UNKNOWN",event_key:policy.event_key});
 if(!ARCHIVE_KEYS.has(policy.archive_policy_key))issues.push({code:"NOTIFICATION_ARCHIVE_UNKNOWN",event_key:policy.event_key});
 if(policy.actionable&&policy.resolution_strategy_key==="none")issues.push({code:"NOTIFICATION_ACTIONABLE_WITHOUT_RESOLUTION",event_key:policy.event_key});
 for(const r of policy.recipients||[]){if(!getRecipientResolver(r.resolver_key))issues.push({code:"NOTIFICATION_RECIPIENT_UNKNOWN",event_key:policy.event_key});else if(validateRecipientParameters(r.resolver_key,r.parameters).length)issues.push({code:"NOTIFICATION_RECIPIENT_PARAMETERS_INVALID",event_key:policy.event_key});}
 if(!(policy.recipients||[]).length)issues.push({code:"NOTIFICATION_RECIPIENT_MISSING",event_key:policy.event_key});
 if(policy.configuration_status!=="ready")issues.push({code:"NOTIFICATION_POLICY_REVIEW_REQUIRED",event_key:policy.event_key});
 issues.push(...validateEventPolicyContract(policy));
 return issues;
};

const emitNotificationEvent=async(eventKey,context={},executor=db)=>{
 const event=getNotificationEvent(eventKey); if(!event)throw buildError("Notification event is not supported.",400,null,"NOTIFICATION_EVENT_UNKNOWN");
 const policy=await loadPolicy(eventKey,executor); const issues=policyIssues(policy); if(issues.length)throw buildError("Notification policy is invalid.",503,issues,"NOTIFICATION_POLICY_NOT_READY");
 const recipients=[];
 for(const row of policy.recipients){const resolved=await getRecipientResolver(row.resolver_key)(context,row.parameters||{},executor);for(const user of resolved)if(!recipients.some(x=>Number(x.id)===Number(user.id)))recipients.push({...user,resolver_key:row.resolver_key});}
 if(!recipients.length)throw buildError("Notification policy resolved no eligible recipients.",503,null,"NOTIFICATION_RECIPIENTS_EMPTY");
 const presentation=event.build(context); const destination=getDeepLinkBuilder(policy.deep_link_builder_key)(context);
 const subject=String(context.subject_reference||context.cargo?.cargo_id||context.cargo?.public_reference||"").trim()||null;
 const action=String(context.action_reference||context.dispatch_public_reference||context.approval_public_reference||"").trim()||null;
 const created=[];
 for(const user of recipients)created.push(await createNotification({recipient_user_id:user.id,recipient_role_id:user.role_id,recipient_warehouse_id:user.warehouse_id,notification_type:policy.notification_type,title:presentation.title,message:presentation.message,related_module:presentation.module,related_entity_type:context.related_entity_type||"cargo",related_entity_id:context.cargo?.id||context.related_entity_id||null,priority:policy.priority,created_by:context.actor_id||null,event_key:eventKey,policy_revision:policy.revision,actionable:policy.actionable,recipient_strategy:user.resolver_key,deep_link_builder_key:policy.deep_link_builder_key,resolution_strategy_key:policy.resolution_strategy_key,archive_policy_key:policy.archive_policy_key,subject_reference:subject,action_reference:action,metadata:{...(context.metadata||{}),deep_link:destination,subject_reference:subject,action_reference:action}},executor,{actorId:context.actor_id||null,deduplicate:policy.actionable}));
 return created;
};

const resolveNotificationStrategy=async(strategyKey,{subjectReference,actionReference=null,executor=db})=>{
 if(!RESOLUTION_KEYS.has(strategyKey)||strategyKey==="none")throw buildError("Notification resolution strategy is unsupported.",400,null,"NOTIFICATION_RESOLUTION_UNKNOWN");
 const values=[strategyKey,subjectReference]; let action="";
 if(actionReference){values.push(actionReference);action=`AND action_reference=$${values.length}`;}
 const result=await executor.query(`UPDATE notifications SET status='completed',completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP) WHERE status='pending' AND resolution_strategy_key=$1 AND subject_reference=$2 ${action} RETURNING public_reference,event_key,status,completed_at`,values);
 return {rowCount:result.rowCount,rows:result.rows};
};

const validateNotificationPolicies=async(executor=db)=>{
 const rows=(await executor.query(`SELECT p.*,COALESCE(jsonb_agg(jsonb_build_object('resolver_key',r.resolver_key,'parameters',r.parameters) ORDER BY r.sequence) FILTER(WHERE r.resolver_key IS NOT NULL),'[]'::jsonb) recipients FROM notification_policies p LEFT JOIN notification_policy_recipients r ON r.event_key=p.event_key AND r.policy_revision=p.revision WHERE p.active GROUP BY p.event_key,p.revision`)).rows;
 const issues=rows.flatMap(policyIssues); const active=new Set(rows.map(r=>r.event_key));
 for(const key of listRequiredNotificationEvents()){if(!active.has(key))issues.push({code:"NOTIFICATION_POLICY_MISSING",event_key:key});}
 const permissionRows=(await executor.query(`SELECT r.event_key,r.parameters->>'permission_key' permission_key,p.permission_key existing_permission FROM notification_policy_recipients r LEFT JOIN permissions p ON p.permission_key=r.parameters->>'permission_key' WHERE r.resolver_key='users_with_permission'`)).rows;
 for(const row of permissionRows)if(!row.existing_permission)issues.push({code:"NOTIFICATION_PERMISSION_UNKNOWN",event_key:row.event_key,permission_key:row.permission_key});
 return {ready:issues.length===0,issues,policies:rows};
};

const listNotificationPolicies=async(executor=db)=>(await executor.query(`SELECT p.*,COALESCE(jsonb_agg(jsonb_build_object('sequence',r.sequence,'resolver_key',r.resolver_key,'parameters',r.parameters) ORDER BY r.sequence) FILTER(WHERE r.resolver_key IS NOT NULL),'[]'::jsonb) recipients FROM notification_policies p LEFT JOIN notification_policy_recipients r ON r.event_key=p.event_key AND r.policy_revision=p.revision WHERE p.active GROUP BY p.event_key,p.revision ORDER BY p.event_key`)).rows;

const updateNotificationPolicy=async(eventKey,payload,actorId,executor)=>{
 const current=await loadPolicy(eventKey,executor);
 const recipients=payload.recipients===undefined?current.recipients:payload.recipients;
 const next={...current,priority:payload.priority??current.priority,actionable:payload.actionable??current.actionable,deep_link_builder_key:payload.deep_link_builder_key??current.deep_link_builder_key,resolution_strategy_key:payload.resolution_strategy_key??current.resolution_strategy_key,archive_policy_key:payload.archive_policy_key??current.archive_policy_key,recipients};
 if(!ALLOWED_PRIORITIES.has(next.priority))throw buildError("Notification priority is invalid.",400);
 if(typeof next.actionable!=="boolean")throw buildError("Notification actionability must be boolean.",400);
 const issues=policyIssues(next);
 if(issues.length)throw buildError("Notification policy is invalid.",400,issues,"NOTIFICATION_POLICY_INVALID");
 for(const recipient of recipients){if(recipient.resolver_key==="users_with_permission"){const permission=await executor.query("SELECT 1 FROM permissions WHERE permission_key=$1",[recipient.parameters?.permission_key]);if(!permission.rowCount)throw buildError("Notification recipient permission is unknown.",400,null,"NOTIFICATION_PERMISSION_UNKNOWN");}}
 const revision=Number(current.revision)+1;
 await executor.query("UPDATE notification_policies SET active=FALSE,updated_by=$3,updated_at=CURRENT_TIMESTAMP WHERE event_key=$1 AND revision=$2",[eventKey,current.revision,actorId||null]);
 await executor.query(`INSERT INTO notification_policies(event_key,revision,notification_type,priority,actionable,deep_link_builder_key,resolution_strategy_key,archive_policy_key,protected,active,configuration_status,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,'ready',$10,$10)`,[eventKey,revision,current.notification_type,next.priority,next.actionable,next.deep_link_builder_key,next.resolution_strategy_key,next.archive_policy_key,current.protected,actorId||null]);
 for(let i=0;i<recipients.length;i++)await executor.query("INSERT INTO notification_policy_recipients(event_key,policy_revision,sequence,resolver_key,parameters) VALUES($1,$2,$3,$4,$5)",[eventKey,revision,i+1,recipients[i].resolver_key,recipients[i].parameters||{}]);
 const updated=await loadPolicy(eventKey,executor);
 await writeConfigurationAudit({actorId,module:"Notifications",action:"UPDATE_NOTIFICATION_POLICY",settingKey:eventKey,definition:{is_secret:false},previousValue:current,newValue:updated,previousRevision:current.revision,newRevision:revision,validation:{valid:true,status:"ready",issues:[]}},executor);
 return updated;
};
module.exports={emitNotificationEvent,listNotificationPolicies,loadPolicy,policyIssues,resolveNotificationStrategy,updateNotificationPolicy,validateNotificationPolicies};

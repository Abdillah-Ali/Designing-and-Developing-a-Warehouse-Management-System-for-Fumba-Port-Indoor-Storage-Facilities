const resolvers = Object.freeze({
  users_with_permission: async (context, parameters, executor) => {
    const values=[parameters.permission_key];
    let scope="";
    if(parameters.scope==="warehouse") { values.push(context.warehouse_id||0); scope=`AND u.warehouse_id=$${values.length}`; }
    const result=await executor.query(`SELECT DISTINCT u.id,u.role_id,u.warehouse_id FROM users u JOIN roles r ON r.id=u.role_id JOIN role_permissions rp ON rp.role_id=u.role_id WHERE u.status='active' AND r.role_key<>'scanner' AND rp.permission_key=$1 ${scope} ORDER BY u.id`,values);
    return result.rows;
  },
  cargo_owner: async (context, _parameters, executor) => {
    const id=Number(context.cargo?.assigned_staff_id||context.cargo?.created_by||context.cargo?.received_by_user_id);
    if(!id)return [];
    return (await executor.query(`SELECT u.id,u.role_id,u.warehouse_id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1 AND u.status='active' AND r.role_key<>'scanner'`,[id])).rows;
  },
  specific_user: async (context, parameters, executor) => {
    const id=Number(context[parameters.context_key||"recipient_user_id"]);
    if(!id)return [];
    return (await executor.query(`SELECT u.id,u.role_id,u.warehouse_id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1 AND u.status='active' AND r.role_key<>'scanner'`,[id])).rows;
  }
});
const getRecipientResolver=(key)=>resolvers[key]||null;
const validateRecipientParameters=(key,p={})=>key==="users_with_permission"&&(!p.permission_key||!["global","warehouse"].includes(p.scope))?["permission_key and valid scope are required"]:key==="specific_user"&&!p.context_key?["context_key is required"]:[];
module.exports={getRecipientResolver,validateRecipientParameters};

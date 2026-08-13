const db = require("../config/db");
const { referencedPermissions } = require("../config/authorizationRegistry");

const REQUIRED_ROLE_KEYS = Object.freeze([
  "system_administrator", "warehouse_staff", "warehouse_supervisor", "finance_officer",
  "customs_officer", "gate_officer", "management", "scanner"
]);

const issue = (code, message) => ({ code, message, impact: "blocked", criticality: "critical_policy" });

const validateRbacConfiguration = async (executor = db) => {
  const issues = [];
  const [roles, permissions, adminAccess] = await Promise.all([
    executor.query("SELECT role_key,system_protected FROM roles"),
    executor.query("SELECT permission_key FROM permissions WHERE permission_key=ANY($1::text[])", [referencedPermissions]),
    executor.query(`SELECT 1 FROM roles r JOIN role_permissions rp ON rp.role_id=r.id WHERE r.role_key='system_administrator' AND rp.permission_key='system.permissions.manage'`)
  ]);
  const rolesByKey = new Map(roles.rows.map((role) => [role.role_key, role]));
  for (const roleKey of REQUIRED_ROLE_KEYS) {
    const role = rolesByKey.get(roleKey);
    if (!role) issues.push(issue("RBAC_PROTECTED_ROLE_MISSING", `Protected role ${roleKey} is missing.`));
    else if (!role.system_protected) issues.push(issue("RBAC_ROLE_NOT_PROTECTED", `Role ${roleKey} must remain system protected.`));
  }
  const available = new Set(permissions.rows.map((row) => row.permission_key));
  for (const permission of referencedPermissions) if (!available.has(permission)) issues.push(issue("RBAC_ROUTE_PERMISSION_MISSING", `Route permission ${permission} is missing.`));
  if (!adminAccess.rowCount) issues.push(issue("RBAC_ADMIN_LOCKOUT_RISK", "The protected administrator role cannot manage permissions."));
  return { valid: issues.length === 0, issues };
};

module.exports = { REQUIRED_ROLE_KEYS, validateRbacConfiguration };

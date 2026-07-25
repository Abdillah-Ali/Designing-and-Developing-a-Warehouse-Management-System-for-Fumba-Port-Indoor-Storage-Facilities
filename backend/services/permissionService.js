const db = require("../config/db");

const CACHE_TTL_MS = Number(process.env.PERMISSION_CACHE_TTL_MS || 60_000);
const cache = new Map();

const clearPermissionCache = (roleId = null) => {
  if (roleId) {
    cache.delete(Number(roleId));
    return;
  }
  cache.clear();
};

const loadRolePermissions = async (roleId, executor = db) => {
  const numericRoleId = Number(roleId);
  if (!Number.isInteger(numericRoleId) || numericRoleId <= 0) return [];

  const cached = cache.get(numericRoleId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.permissions;
  }

  const result = await executor.query(
    `SELECT rp.permission_key
     FROM role_permissions rp
     WHERE rp.role_id = $1
     ORDER BY rp.permission_key`,
    [numericRoleId]
  );
  const permissions = result.rows.map((row) => row.permission_key);
  cache.set(numericRoleId, {
    permissions,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
  return permissions;
};

const listPermissions = async (executor = db) => {
  return executor.query(
    `SELECT
       permission_key,
       description,
       COALESCE(module, split_part(permission_key, '.', 1), 'system') AS module,
       COALESCE(system_protected, FALSE) AS system_protected,
       created_at
     FROM permissions
     ORDER BY COALESCE(module, split_part(permission_key, '.', 1), 'system'), permission_key`
  );
};

const getRolePermissions = async (roleReference, executor = db) => {
  return executor.query(
    `SELECT
       r.id,
       r.public_reference,
       r.role_name,
       r.role_description,
       COALESCE(
         jsonb_agg(rp.permission_key ORDER BY rp.permission_key)
           FILTER (WHERE rp.permission_key IS NOT NULL),
         '[]'::jsonb
       ) AS permission_keys
     FROM roles r
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     WHERE r.public_reference = $1
     GROUP BY r.id`,
    [roleReference]
  );
};

module.exports = {
  clearPermissionCache,
  getRolePermissions,
  listPermissions,
  loadRolePermissions
};

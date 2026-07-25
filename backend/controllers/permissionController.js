const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { buildError } = require("../utils/apiError");
const {
  clearPermissionCache,
  getRolePermissions,
  listPermissions,
  loadRolePermissions
} = require("../services/permissionService");
const { readEscalationSettings } = require("../services/notificationScheduler");

const sendRows = (res, result) => res.json({
  success: true,
  count: result.rowCount,
  data: result.rows
});

const getMe = async (req, res, next) => {
  try {
    const permissions = await loadRolePermissions(req.auth.roleId);
    res.json({
      success: true,
      data: {
        user: {
          public_reference: req.auth.publicReference || null,
          username: req.auth.username,
          role: req.auth.role,
          must_change_password: req.auth.mustChangePassword
        },
        permissions
      }
    });
  } catch (error) {
    next(error);
  }
};

const getMyPermissions = async (req, res, next) => {
  try {
    const permissions = await loadRolePermissions(req.auth.roleId);
    res.json({ success: true, count: permissions.length, data: permissions });
  } catch (error) {
    next(error);
  }
};

const getAdminPermissions = async (req, res, next) => {
  try {
    sendRows(res, await listPermissions());
  } catch (error) {
    next(error);
  }
};

const getAdminRoles = async (req, res, next) => {
  try {
    sendRows(res, await db.query(
      `SELECT
         r.public_reference,
         r.role_name,
         r.role_description,
         r.created_at,
         COUNT(u.id)::int AS user_count
       FROM roles r
       LEFT JOIN users u ON u.role_id = r.id
       GROUP BY r.id
       ORDER BY r.role_name`
    ));
  } catch (error) {
    next(error);
  }
};

const getAdminRolePermissions = async (req, res, next) => {
  try {
    const result = await getRolePermissions(req.params.publicReference);
    if (result.rowCount === 0) throw buildError("Role not found.", 404);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

const updateAdminRolePermissions = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const requestedKeys = Array.isArray(req.body?.permission_keys)
      ? req.body.permission_keys.map((key) => String(key).trim()).filter(Boolean)
      : null;
    if (!requestedKeys) throw buildError("permission_keys must be an array.", 400);

    await client.query("BEGIN");
    const roleResult = await client.query(
      "SELECT id, public_reference, role_name FROM roles WHERE public_reference = $1 FOR UPDATE",
      [req.params.publicReference]
    );
    if (roleResult.rowCount === 0) throw buildError("Role not found.", 404);
    const role = roleResult.rows[0];

    const permissionResult = await client.query(
      `SELECT permission_key, COALESCE(system_protected, FALSE) AS system_protected
       FROM permissions`
    );
    const permissionMap = new Map(permissionResult.rows.map((row) => [row.permission_key, row]));
    const unknown = requestedKeys.filter((key) => !permissionMap.has(key));
    if (unknown.length > 0) {
      throw buildError(`Unknown permission keys: ${unknown.join(", ")}`, 400);
    }

    const existingResult = await client.query(
      "SELECT permission_key FROM role_permissions WHERE role_id = $1",
      [role.id]
    );
    const existingKeys = existingResult.rows.map((row) => row.permission_key);
    const protectedExisting = existingKeys.filter((key) => permissionMap.get(key)?.system_protected);
    const finalKeys = Array.from(new Set([...requestedKeys, ...protectedExisting]));

    if (Number(role.id) === Number(req.auth.roleId)) {
      const keepsCriticalAccess = finalKeys.includes("*") || finalKeys.includes("system.permissions.manage");
      if (!keepsCriticalAccess) {
        throw buildError("You cannot remove your own permission-management access.", 409);
      }
    }

    await client.query("DELETE FROM role_permissions WHERE role_id = $1", [role.id]);
    for (const key of finalKeys) {
      await client.query(
        "INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)",
        [role.id, key]
      );
    }

    await writeAuditLog({
      user_id: req.auth.userId,
      action: "UPDATE_ROLE_PERMISSIONS",
      module: "Role-Based Access Control",
      description: `Updated permissions for ${role.role_name}.`,
      metadata: {
        role_reference: role.public_reference,
        added: finalKeys.filter((key) => !existingKeys.includes(key)),
        removed: existingKeys.filter((key) => !finalKeys.includes(key))
      }
    }, client);

    await client.query("COMMIT");
    clearPermissionCache(role.id);

    const refreshed = await getRolePermissions(role.public_reference);
    res.json({ success: true, data: refreshed.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

const updateSetting = async (client, key, value, actorId) => {
  await client.query(
    `INSERT INTO system_settings (setting_key, setting_value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (setting_key) DO UPDATE
     SET setting_value = EXCLUDED.setting_value,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
    [key, JSON.stringify(value), actorId || null]
  );
};

const getNotificationEscalationSettings = async (req, res, next) => {
  try {
    const settings = await readEscalationSettings();
    res.json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

const updateNotificationEscalationSettings = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const enabled = req.body.enabled !== undefined ? Boolean(req.body.enabled) : undefined;
    const thresholdHours = req.body.threshold_hours ?? req.body.thresholdHours;
    const intervalMs = req.body.interval_ms ?? req.body.intervalMs;
    const targetRoleName = req.body.target_role ?? req.body.targetRoleName;

    await client.query("BEGIN");
    if (enabled !== undefined) {
      await updateSetting(client, "cargo_pending_review_escalation_enabled", enabled, req.auth?.userId);
    }
    if (thresholdHours !== undefined) {
      const hours = Number(thresholdHours);
      if (!Number.isFinite(hours) || hours <= 0) throw buildError("Escalation threshold must be greater than zero.", 400);
      await updateSetting(client, "cargo_pending_review_escalation_hours", hours, req.auth?.userId);
    }
    if (intervalMs !== undefined) {
      const interval = Number(intervalMs);
      if (!Number.isFinite(interval) || interval < 60_000) throw buildError("Scheduler interval must be at least 60000 ms.", 400);
      await updateSetting(client, "cargo_pending_review_escalation_interval_ms", interval, req.auth?.userId);
    }
    if (targetRoleName !== undefined) {
      const roleResult = await client.query("SELECT role_name FROM roles WHERE role_name = $1", [String(targetRoleName)]);
      if (!roleResult.rowCount) throw buildError("Target role was not found.", 400);
      await updateSetting(client, "cargo_pending_review_escalation_target_role", roleResult.rows[0].role_name, req.auth?.userId);
    }

    await writeAuditLog({
      user_id: req.auth?.userId,
      action: "UPDATE_NOTIFICATION_ESCALATION_SETTINGS",
      module: "Notifications",
      description: "Updated pending review escalation settings.",
      metadata: {
        enabled,
        threshold_hours: thresholdHours,
        interval_ms: intervalMs,
        target_role: targetRoleName
      }
    }, client);
    await client.query("COMMIT");

    const settings = await readEscalationSettings();
    res.json({ success: true, data: settings });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

module.exports = {
  getAdminPermissions,
  getAdminRolePermissions,
  getAdminRoles,
  getMe,
  getMyPermissions,
  getNotificationEscalationSettings,
  updateNotificationEscalationSettings,
  updateAdminRolePermissions
};

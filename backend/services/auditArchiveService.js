const db = require("../config/db");
const { buildError } = require("../utils/apiError");
const { writeAuditLog } = require("../models/adminModel");

const archiveEligibleAuditLogs = async ({ actorId }, database = db) => {
  const client = await database.pool.connect();
  try {
    await client.query("BEGIN");
    const setting = await client.query("SELECT (setting_value #>> '{}')::integer AS days FROM system_settings WHERE setting_key='audit_retention_days' FOR UPDATE");
    const days = Number(setting.rows[0]?.days);
    if (!Number.isInteger(days) || days < 30) throw buildError("Audit retention must be configured to at least 30 days.", 503, undefined, "AUDIT_RETENTION_INVALID");
    const batch = `AAB-${Date.now()}`;
    const archived = await client.query(`INSERT INTO archived_audit_logs
      (id,user_id,target_user_id,role_id_at_action,warehouse_id_at_action,actor_reference,action,module,description,metadata,created_at,archive_batch_reference)
      SELECT al.id,al.user_id,al.target_user_id,al.role_id_at_action,al.warehouse_id_at_action,al.actor_reference,al.action,al.module,al.description,al.metadata,al.created_at,$2
      FROM audit_logs al LEFT JOIN archived_audit_logs aa ON aa.id=al.id
      WHERE aa.id IS NULL AND al.created_at < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day')
      ON CONFLICT (id) DO NOTHING RETURNING id`, [days, batch]);
    await writeAuditLog({ user_id: actorId, action: "ARCHIVE_AUDIT_LOGS", module: "Audit", description: `Archived ${archived.rowCount} eligible audit events.`, metadata: { archive_batch_reference: batch, retention_days: days, archived_count: archived.rowCount } }, client);
    await client.query("COMMIT");
    return { archive_batch_reference: batch, retention_days: days, archived_count: archived.rowCount };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
};

module.exports = { archiveEligibleAuditLogs };

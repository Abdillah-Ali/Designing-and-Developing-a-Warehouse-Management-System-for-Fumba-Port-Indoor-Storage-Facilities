const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { requireScannerPolicy } = require("./scannerPolicyService");

let cleanupHandle = null;

const expireStaleScannerSessions = async (executor = db) => {
  const result = await executor.query(
    `UPDATE scanner_sessions
     SET status='expired', expired_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP,
         last_error='Scanner session expired due to inactivity.'
     WHERE status='active' AND expires_at <= CURRENT_TIMESTAMP
     RETURNING id, staff_user_id, workflow_type`
  );
  for (const row of result.rows) {
    await writeAuditLog({
      target_user_id: row.staff_user_id,
      action: "SCAN_SESSION_EXPIRED",
      module: "Barcode Scanner",
      description: `Scanner session ${row.id} expired due to inactivity.`,
      metadata: { scanner_session_id: row.id, workflow_type: row.workflow_type, expiry_source: "cleanup" }
    }, executor);
  }
  return result.rows;
};

const startScannerSessionCleanup = async () => {
  const policy = await requireScannerPolicy();
  await expireStaleScannerSessions();
  if (cleanupHandle) clearInterval(cleanupHandle);
  cleanupHandle = setInterval(() => expireStaleScannerSessions().catch(() => {}), policy.cleanup_interval_ms);
  cleanupHandle.unref?.();
  return cleanupHandle;
};

const stopScannerSessionCleanup = () => {
  if (cleanupHandle) clearInterval(cleanupHandle);
  cleanupHandle = null;
};

module.exports = { expireStaleScannerSessions, startScannerSessionCleanup, stopScannerSessionCleanup };

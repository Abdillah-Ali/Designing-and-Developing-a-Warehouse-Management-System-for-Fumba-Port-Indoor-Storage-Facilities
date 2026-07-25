const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { notifyPendingReviewEscalations } = require("./notificationService");
const { logEvent } = require("../utils/logger");

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
let schedulerHandle = null;

const parseSettingValue = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const readEscalationSettings = async (executor = db) => {
  const result = await executor.query(
    `SELECT setting_key, setting_value
     FROM system_settings
     WHERE setting_key IN (
       'cargo_pending_review_escalation_enabled',
       'cargo_pending_review_escalation_hours',
       'cargo_pending_review_escalation_interval_ms',
       'cargo_pending_review_escalation_target_role'
     )`
  );
  const settings = Object.fromEntries(result.rows.map((row) => [
    row.setting_key,
    parseSettingValue(row.setting_value, null)
  ]));

  return {
    enabled: settings.cargo_pending_review_escalation_enabled !== false,
    thresholdHours: Number(settings.cargo_pending_review_escalation_hours || 2),
    intervalMs: Math.max(Number(settings.cargo_pending_review_escalation_interval_ms || DEFAULT_INTERVAL_MS), 60_000),
    targetRoleName: String(settings.cargo_pending_review_escalation_target_role || "System Admin")
  };
};

const runPendingReviewEscalationJob = async () => {
  const client = await db.pool.connect();
  try {
    const settings = await readEscalationSettings(client);
    if (!settings.enabled) {
      logEvent("info", { operation: "pending_review_escalation", result: "disabled" });
      return { created: 0 };
    }

    const lock = await client.query("SELECT pg_try_advisory_lock(hashtext('pending_review_escalation_scheduler')) AS locked");
    if (!lock.rows[0]?.locked) {
      logEvent("info", { operation: "pending_review_escalation", result: "skipped_lock_unavailable" });
      return { created: 0 };
    }

    try {
      const notifications = await notifyPendingReviewEscalations({
        thresholdHours: settings.thresholdHours,
        targetRoleName: settings.targetRoleName
      }, client);

      await writeAuditLog({
        action: "RUN_NOTIFICATION_ESCALATION",
        module: "Notifications",
        description: "Pending cargo review escalation scheduler completed.",
        metadata: {
          created_notification_count: notifications.length,
          threshold_hours: settings.thresholdHours,
          target_role: settings.targetRoleName,
          notification_references: notifications.map((item) => item.public_reference).filter(Boolean)
        }
      }, client);

      logEvent("info", { operation: "pending_review_escalation", result: "success" });
      return { created: notifications.length };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('pending_review_escalation_scheduler'))");
    }
  } catch (error) {
    logEvent("error", {
      operation: "pending_review_escalation",
      result: "failure",
      error_category: error.code || error.name || "scheduler_error"
    });
    return { created: 0, error };
  } finally {
    client.release();
  }
};

const startNotificationSchedulers = async () => {
  if (schedulerHandle) return schedulerHandle;
  const settings = await readEscalationSettings();
  schedulerHandle = setInterval(runPendingReviewEscalationJob, settings.intervalMs);
  schedulerHandle.unref?.();
  runPendingReviewEscalationJob();
  return schedulerHandle;
};

module.exports = {
  readEscalationSettings,
  runPendingReviewEscalationJob,
  startNotificationSchedulers
};

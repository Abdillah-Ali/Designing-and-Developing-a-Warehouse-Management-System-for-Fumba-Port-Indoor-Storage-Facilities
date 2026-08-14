const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { notifyPendingReviewEscalations } = require("./notificationService");
const { logEvent } = require("../utils/logger");
const {getBooleanSetting,getDecimalSetting,getDurationSetting,requireValidSetting}=require("./systemConfigurationService");

let schedulerHandle = null;

const readEscalationSettings = async (executor = db) => {
  const [enabled,threshold,interval]=await Promise.all([
    getBooleanSetting("cargo_pending_review_escalation_enabled",{},executor),
    getDecimalSetting("cargo_pending_review_escalation_hours",{},executor),
    getDurationSetting("cargo_pending_review_escalation_interval_ms",{},executor)
  ]);
  return {
    enabled: requireValidSetting(enabled),
    thresholdHours: requireValidSetting(threshold),
    intervalMs: requireValidSetting(interval)
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
        thresholdHours: settings.thresholdHours
      }, client);

      await writeAuditLog({
        action: "RUN_NOTIFICATION_ESCALATION",
        module: "Notifications",
        description: "Pending cargo review escalation scheduler completed.",
        metadata: {
          created_notification_count: notifications.length,
          threshold_hours: settings.thresholdHours,
          recipient_authority: "cargo.review_overdue:users_with_permission:cargo.approve:warehouse",
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

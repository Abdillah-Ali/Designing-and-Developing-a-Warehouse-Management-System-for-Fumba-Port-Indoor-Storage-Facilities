const db = require("../config/db");
const { buildError } = require("../utils/apiError");
const { getDurationSetting, getIntegerSetting, requireValidSetting } = require("./systemConfigurationService");
const { getScannerWorkflow, PLACEMENT_WORKFLOW } = require("./scannerWorkflowRegistry");

const SETTING_KEYS = Object.freeze({
  timeoutMinutes: "scanner_session_timeout_minutes",
  duplicateWindowMs: "scanner_duplicate_scan_window_ms",
  cleanupIntervalMs: "scanner_session_cleanup_interval_ms"
});

const readScannerPolicy = async (executor = db) => {
  const timeout = await getIntegerSetting(SETTING_KEYS.timeoutMinutes, {}, executor);
  const duplicate = await getDurationSetting(SETTING_KEYS.duplicateWindowMs, {}, executor);
  const cleanup = await getDurationSetting(SETTING_KEYS.cleanupIntervalMs, {}, executor);
  const settings = [timeout, duplicate, cleanup];
  const issues = settings.flatMap((entry) => entry.valid ? [] : (entry.issues || []).map((item) => ({ ...item, setting_key: entry.setting_key })));
  if (!getScannerWorkflow(PLACEMENT_WORKFLOW)) issues.push({ code: "SCANNER_WORKFLOW_NOT_SUPPORTED", message: "The trusted scanner workflow is unavailable." });
  return {
    ready: issues.length === 0,
    issues,
    timeout_minutes: timeout.valid ? timeout.value : null,
    duplicate_window_ms: duplicate.valid ? duplicate.value : null,
    cleanup_interval_ms: cleanup.valid ? cleanup.value : null,
    workflow_key: PLACEMENT_WORKFLOW
  };
};

const requireScannerPolicy = async (executor = db) => {
  const policy = await readScannerPolicy(executor);
  if (!policy.ready) throw buildError("Scanner operational policy is not ready.", 503, policy.issues, "SCANNER_POLICY_NOT_READY");
  return policy;
};

const validateScannerConfiguration = async (executor = db) => {
  const policy = await readScannerPolicy(executor);
  const issues = [...policy.issues];
  const schema = await executor.query(
    `SELECT to_regclass('public.scanner_sessions') IS NOT NULL AS sessions_ready,
            to_regclass('public.scanner_scan_attempts') IS NOT NULL AS attempts_ready`
  );
  if (!schema.rows[0]?.sessions_ready || !schema.rows[0]?.attempts_ready) {
    issues.push({ code: "SCANNER_SCHEMA_NOT_READY", message: "Scanner session persistence is unavailable." });
  }
  const role = await executor.query("SELECT id FROM roles WHERE role_key='scanner' AND system_protected=TRUE LIMIT 1");
  if (!role.rowCount) issues.push({ code: "SCANNER_PROTECTED_IDENTITY_INVALID", message: "The protected Scanner identity is unavailable." });
  return { ...policy, ready: issues.length === 0, issues };
};

module.exports = { SETTING_KEYS, readScannerPolicy, requireScannerPolicy, validateScannerConfiguration };

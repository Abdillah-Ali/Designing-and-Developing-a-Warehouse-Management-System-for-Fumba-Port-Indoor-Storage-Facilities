const { writeAuditLog } = require("../models/adminModel");

const safeAuditValue = (definition, value) => definition?.is_secret
  ? { redacted: true, present: value !== undefined && value !== null }
  : value;

const writeConfigurationAudit = async ({
  actorId,
  module = "System Configuration",
  action = "UPDATE_SYSTEM_SETTING",
  settingKey,
  definition,
  previousValue,
  newValue,
  previousRevision,
  newRevision,
  validation
}, executor) => writeAuditLog({
  user_id: actorId || null,
  action,
  module,
  description: `Updated registered system setting ${settingKey}.`,
  metadata: {
    setting_key: settingKey,
    previous_value: safeAuditValue(definition, previousValue),
    new_value: safeAuditValue(definition, newValue),
    previous_revision: previousRevision,
    new_revision: newRevision,
    validation: {
      valid: Boolean(validation?.valid),
      status: validation?.status || "unknown",
      issue_codes: (validation?.issues || []).map((entry) => entry.code)
    }
  }
}, executor);

module.exports = { safeAuditValue, writeConfigurationAudit };

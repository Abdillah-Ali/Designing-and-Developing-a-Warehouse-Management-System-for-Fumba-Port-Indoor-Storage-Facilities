const { buildError } = require("../utils/apiError");
const { getSettingDefinition, validateSettingValue } = require("../services/configurationRegistryService");
const { getSystemReadiness } = require("../services/readinessService");
const { exportSnapshot, restoreSnapshot, validateSnapshot } = require("../services/configurationSnapshotService");

const getReadiness = async (_req, res, next) => {
  try {
    res.json({ success: true, data: await getSystemReadiness() });
  } catch (error) {
    next(error);
  }
};

const exportConfiguration = async (req, res, next) => { try { res.json({ success: true, data: await exportSnapshot(req.auth?.userId) }); } catch (error) { next(error); } };
const validateConfigurationBackup = async (req, res, next) => { try { const data = await validateSnapshot(req.body?.snapshot); res.status(data.valid ? 200 : 400).json({ success: data.valid, data, message: data.valid ? "Configuration backup is valid." : "Configuration backup validation failed." }); } catch (error) { next(error); } };
const restoreConfiguration = async (req, res, next) => { try { res.json({ success: true, data: await restoreSnapshot(req.body?.snapshot, req.auth?.userId), message: "Configuration restored successfully." }); } catch (error) { next(error); } };

const validateConfiguration = async (req, res, next) => {
  try {
    const settingKey = String(req.body?.setting_key || "").trim();
    if (!settingKey) throw buildError("setting_key is required.", 400, undefined, "CONFIG_SETTING_NOT_DEFINED");
    const definition = await getSettingDefinition(settingKey);
    const validation = validateSettingValue(definition, req.body?.value);
    if (!validation.valid) {
      throw buildError("Configuration validation failed.", 400, validation.issues, validation.issues[0]?.code || "CONFIG_VALIDATION_FAILED");
    }
    res.json({
      success: true,
      data: {
        setting_key: settingKey,
        valid: true,
        status: validation.status,
        value_type: definition.value_type,
        criticality: definition.criticality
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { exportConfiguration, getReadiness, restoreConfiguration, validateConfiguration, validateConfigurationBackup };

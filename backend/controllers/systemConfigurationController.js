const { buildError } = require("../utils/apiError");
const { getSettingDefinition, validateSettingValue } = require("../services/configurationRegistryService");
const { getSystemReadiness } = require("../services/readinessService");

const getReadiness = async (_req, res, next) => {
  try {
    res.json({ success: true, data: await getSystemReadiness() });
  } catch (error) {
    next(error);
  }
};

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

module.exports = { getReadiness, validateConfiguration };

const db = require("../config/db");
const { buildError } = require("../utils/apiError");

const SYSTEM_SETTING_KEYS = Object.freeze({
  maximumActiveSystemAdministrators: "maximum_active_system_administrators"
});

const readPositiveIntegerSetting = async (settingKey, executor = db) => {
  const result = await executor.query(
    `SELECT setting_value
     FROM system_settings
     WHERE setting_key = $1
     LIMIT 1`,
    [settingKey]
  );

  if (result.rowCount === 0) {
    throw buildError(`Required system configuration '${settingKey}' is unavailable.`, 503);
  }

  const value = Number(result.rows[0].setting_value);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw buildError(`System configuration '${settingKey}' must be a positive integer.`, 503);
  }

  return value;
};

const getMaximumActiveSystemAdministrators = (executor = db) => (
  readPositiveIntegerSetting(
    SYSTEM_SETTING_KEYS.maximumActiveSystemAdministrators,
    executor
  )
);

module.exports = {
  SYSTEM_SETTING_KEYS,
  getMaximumActiveSystemAdministrators,
  readPositiveIntegerSetting
};

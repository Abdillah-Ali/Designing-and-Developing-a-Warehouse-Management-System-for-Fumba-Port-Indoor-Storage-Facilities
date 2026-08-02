const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const {
  getPublishedConfiguration,
  listAvailableFields,
  normalizeConfiguration,
  resetConfiguration,
  updateConfiguration
} = require("../services/cargoRegistrationFormService");

const getPublished = async (_req, res, next) => {
  try {
    const result = await getPublishedConfiguration();
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

const getAvailable = async (_req, res, next) => {
  try {
    const result = await listAvailableFields();
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

const validateConfiguration = async (req, res, next) => {
  try {
    const fields = await normalizeConfiguration(req.body?.fields);
    res.json({ success: true, data: { valid: true, fields } });
  } catch (error) {
    next(error);
  }
};

const update = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await updateConfiguration({
      fields: req.body?.fields,
      actorId: req.auth?.userId,
      executor: client
    });
    await writeAuditLog({
      user_id: req.auth?.userId,
      action: "UPDATE_CARGO_REGISTRATION_FORM",
      module: "System Configuration",
      description: `Updated ${result.changes.length} cargo registration field configuration(s).`,
      metadata: {
        fields_affected: result.changes.map((change) => change.field_key),
        changes: result.changes
      }
    }, client);
    await client.query("COMMIT");
    res.json({ success: true, data: result.fields });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

const reset = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await resetConfiguration({
      actorId: req.auth?.userId,
      executor: client
    });
    await writeAuditLog({
      user_id: req.auth?.userId,
      action: "RESET_CARGO_REGISTRATION_FORM",
      module: "System Configuration",
      description: "Reset the cargo registration form configuration to system defaults.",
      metadata: {
        fields_affected: result.fields.map((field) => field.field_key),
        previous_values: result.previous,
        new_values: result.fields
      }
    }, client);
    await client.query("COMMIT");
    res.json({ success: true, data: result.fields });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

module.exports = {
  getAvailable,
  getPublished,
  reset,
  update,
  validateConfiguration
};

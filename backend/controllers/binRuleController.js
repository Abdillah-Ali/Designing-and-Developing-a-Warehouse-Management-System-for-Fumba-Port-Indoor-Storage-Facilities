const db = require("../config/db");
const { buildError } = require("../utils/apiError");

const MANDATORY_PLACEMENT_RULES = new Set([
  "compatibility",
  "hazardous",
  "volume",
  "weight"
]);

const getRules = async (req, res, next) => {
  try {
    const result = await db.query("SELECT * FROM bin_rules ORDER BY rule_key");
    res.json({
      success: true,
      count: result.rowCount,
      data: result.rows
    });
  } catch (error) {
    next(error);
  }
};

const updateRule = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const { id } = req.params;
    const { is_active, parameters } = req.body;

    if (is_active === undefined && parameters === undefined) {
      throw buildError("Active status or parameters are required for update.", 400);
    }
    if (is_active !== undefined && typeof is_active !== "boolean") {
      throw buildError("Rule active status must be true or false.", 400);
    }

    await client.query("BEGIN");

    // Fetch rule to verify existence
    const ruleCheck = await client.query("SELECT rule_key, rule_name FROM bin_rules WHERE id = $1", [id]);
    if (ruleCheck.rowCount === 0) {
      throw buildError("Bin rule not found.", 404);
    }

    const rule = ruleCheck.rows[0];
    if (MANDATORY_PLACEMENT_RULES.has(rule.rule_key) && is_active === false) {
      throw buildError(
        `${rule.rule_name} is a mandatory placement safety rule and cannot be disabled.`,
        400
      );
    }
    const activeState = is_active;
    const params = parameters !== undefined ? (typeof parameters === "object" ? JSON.stringify(parameters) : parameters) : undefined;

    const result = await client.query(
      `UPDATE bin_rules
       SET is_active = COALESCE($1, is_active),
           parameters = COALESCE($2, parameters),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [activeState === undefined ? null : activeState, params || null, id]
    );

    const updatedRule = result.rows[0];

    // Audit log
    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, $2, $3, $4)`,
      [
        req.auth?.userId || null,
        "UPDATE_BIN_RULE",
        "Warehouse Configuration",
        `Updated bin rule '${rule.rule_name}' (${rule.rule_key}): active=${updatedRule.is_active}.`
      ]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      data: updatedRule
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

module.exports = {
  getRules,
  updateRule
};

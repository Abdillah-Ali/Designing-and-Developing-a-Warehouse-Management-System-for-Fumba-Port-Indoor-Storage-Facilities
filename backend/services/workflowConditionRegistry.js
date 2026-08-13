const definitions = Object.freeze({
  cargo_not_archived: {
    description: "Cargo must remain operational and not archived.",
    supported_workflows: ["cargo_registration", "cargo_placement"],
    parameter_schema: { type: "object", properties: {}, additionalProperties: false },
    evaluate: ({ cargo }) => !cargo.is_deleted
  }
});

const validateCondition = (key, parameters = {}) => {
  const definition = definitions[key];
  if (!definition) return [`Unknown workflow condition: ${key}.`];
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return ["Condition parameters must be an object."];
  return Object.keys(parameters).length ? ["This condition does not accept parameters."] : [];
};

module.exports = { workflowConditionRegistry: definitions, validateCondition };

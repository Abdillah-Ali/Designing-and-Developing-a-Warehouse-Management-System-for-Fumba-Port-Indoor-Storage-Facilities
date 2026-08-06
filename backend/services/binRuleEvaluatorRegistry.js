const EXECUTION_TARGETS = Object.freeze([
  "cargo_registration",
  "placement_recommendation",
  "placement_confirmation",
  "relocation",
  "dispatch",
  "customs",
  "finance",
  "gate_out"
]);

const VIOLATION_ACTIONS = Object.freeze([
  "warning",
  "block",
  "supervisor_approval",
  "customs_approval",
  "finance_approval",
  "manual_override"
]);

const SEVERITIES = Object.freeze(["info", "low", "medium", "high", "critical"]);

const placementTargets = Object.freeze([
  "placement_recommendation",
  "placement_confirmation",
  "relocation"
]);

const splitTypes = (value) => String(value || "")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const cargoAllowed = (cargoType, configuredTypes) => {
  const allowed = splitTypes(configuredTypes);
  if (allowed.length === 0 || allowed.includes("all")) return true;
  if (allowed.includes(String(cargoType || "").toLowerCase())) return true;
  return allowed.includes("mixed cargo") && String(cargoType) !== "Hazardous Cargo";
};

const result = (passed, message, details = {}) => ({ passed, message, details });

const evaluatorDefinitions = Object.freeze({
  capacity_limits: {
    label: "Capacity limits",
    description: "Checks cargo weight and volume against the destination bin's remaining capacity.",
    supported_targets: placementTargets,
    parameter_schema: {
      type: "object",
      properties: {
        enforce_weight: { type: "boolean", default: true },
        enforce_volume: { type: "boolean", default: true }
      },
      additionalProperties: false
    },
    evaluate: ({ cargo, bin, derived }, parameters) => {
      const enforceWeight = parameters.enforce_weight !== false;
      const enforceVolume = parameters.enforce_volume !== false;
      const failures = [];
      if (enforceWeight && Number(cargo.weight || 0) > derived.remaining_weight) failures.push("weight");
      if (enforceVolume && Number(cargo.volume || 0) > derived.remaining_volume) failures.push("volume");
      return result(failures.length === 0, failures.length
        ? `Destination bin capacity is insufficient for cargo ${failures.join(" and ")}.`
        : "Destination bin has sufficient weight and volume capacity.", { failures });
    }
  },
  cargo_storage_compatibility: {
    label: "Cargo/storage compatibility",
    description: "Checks cargo type against zone and bin cargo classifications.",
    supported_targets: placementTargets,
    parameter_schema: { type: "object", properties: {}, additionalProperties: false },
    evaluate: ({ cargo, bin }) => {
      const zoneAllowed = cargoAllowed(cargo.cargo_type, bin.zone_allowed_cargo_type);
      const binAllowed = cargoAllowed(cargo.cargo_type, bin.allowed_cargo_type);
      return result(zoneAllowed && binAllowed, zoneAllowed
        ? `${cargo.cargo_type} is not permitted in the destination bin.`
        : `${cargo.cargo_type} is not permitted in the destination zone.`);
    }
  },
  hazard_zone_compatibility: {
    label: "Hazard-zone compatibility",
    description: "Separates hazardous and non-hazardous cargo using warehouse hazard-zone configuration.",
    supported_targets: placementTargets,
    parameter_schema: { type: "object", properties: { hazardous_cargo_type: { type: "string", minLength: 1 } }, required: ["hazardous_cargo_type"], additionalProperties: false },
    evaluate: ({ cargo, bin }, parameters) => {
      const hazardous = cargo.cargo_type === parameters.hazardous_cargo_type;
      const passed = hazardous ? Boolean(bin.is_hazard_zone) : !bin.is_hazard_zone;
      return result(passed, passed ? "Hazard-zone compatibility passed." : "Cargo hazard classification is incompatible with the destination zone.");
    }
  },
  storage_status: {
    label: "Storage status",
    description: "Rejects inactive or operationally unavailable storage locations.",
    supported_targets: placementTargets,
    parameter_schema: { type: "object", properties: { allowed_statuses: { type: "array", items: { type: "string" }, minItems: 1 } }, required: ["allowed_statuses"], additionalProperties: false },
    evaluate: ({ bin }, parameters) => {
      const hierarchyActive = Boolean(bin.active && bin.level_active && bin.rack_active && bin.zone_active && bin.warehouse_status !== "inactive");
      const statusAllowed = parameters.allowed_statuses.includes(bin.status);
      return result(hierarchyActive && statusAllowed, hierarchyActive ? `Bin status ${bin.status} is not available for this operation.` : "The bin or a parent storage location is inactive.");
    }
  },
  reserved_storage: {
    label: "Reserved storage",
    description: "Controls placement into bins reserved for a cargo classification.",
    supported_targets: placementTargets,
    parameter_schema: { type: "object", properties: {}, additionalProperties: false },
    evaluate: ({ cargo, bin }) => result(
      bin.status !== "Reserved" && (!bin.reserved_for_cargo_type || cargoAllowed(cargo.cargo_type, bin.reserved_for_cargo_type)),
      "Destination bin is reserved for another cargo classification."
    )
  },
  restricted_zone_approval: {
    label: "Restricted-zone approval",
    description: "Requires an approved placement override for restricted zones.",
    supported_targets: placementTargets,
    parameter_schema: { type: "object", properties: { restricted_zone_type: { type: "string", minLength: 1 } }, required: ["restricted_zone_type"], additionalProperties: false },
    evaluate: ({ bin, approvals }, parameters) => result(
      String(bin.zone_type || "").toLowerCase() !== parameters.restricted_zone_type.toLowerCase() || Boolean(approvals.supervisor_override),
      "Placement into this restricted zone requires an approved supervisor override."
    )
  },
  customs_hold_storage: {
    label: "Customs-hold storage",
    description: "Requires customs-held cargo to use explicitly compatible storage.",
    supported_targets: placementTargets,
    parameter_schema: { type: "object", properties: { hold_marker: { type: "string", minLength: 1 }, storage_marker: { type: "string", minLength: 1 } }, required: ["hold_marker", "storage_marker"], additionalProperties: false },
    evaluate: ({ cargo, bin }, parameters) => result(
      !String(cargo.customs_status || "").toLowerCase().includes(parameters.hold_marker.toLowerCase())
        || String(bin.cargo_restrictions || "").toLowerCase().includes(parameters.storage_marker.toLowerCase()),
      "Cargo under customs hold requires explicitly compatible storage."
    )
  },
  fragile_handling: {
    label: "Fragile handling",
    description: "Requires configured handling conditions for a selected cargo classification.",
    supported_targets: placementTargets,
    parameter_schema: { type: "object", properties: { cargo_type: { type: "string", minLength: 1 }, handling_marker: { type: "string", minLength: 1 } }, required: ["cargo_type", "handling_marker"], additionalProperties: false },
    evaluate: ({ cargo, bin }, parameters) => result(
      cargo.cargo_type !== parameters.cargo_type || String(bin.handling_condition || "").toLowerCase().includes(parameters.handling_marker.toLowerCase()),
      "Cargo requires a destination configured with the required handling condition."
    )
  },
  candidate_ordering: {
    label: "Candidate ordering",
    description: "Orders eligible bin candidates using a trusted storage attribute.",
    supported_targets: Object.freeze(["placement_recommendation"]),
    rule_type: "ordering",
    parameter_schema: { type: "object", properties: { field: { type: "string", enum: ["created_at", "available_weight", "available_volume", "status"] }, direction: { type: "string", enum: ["asc", "desc"] } }, required: ["field", "direction"], additionalProperties: false },
    evaluate: () => result(true, "Candidate ordering rule loaded.")
  }
});

const REQUIRED_PLACEMENT_CAPABILITIES = Object.freeze([
  "capacity_limits",
  "cargo_storage_compatibility",
  "hazard_zone_compatibility",
  "storage_status",
  "reserved_storage",
  "restricted_zone_approval",
  "customs_hold_storage",
  "fragile_handling"
]);

const validateValue = (value, schema, path, errors) => {
  if (schema.type === "boolean" && typeof value !== "boolean") errors.push(`${path} must be a boolean.`);
  if (schema.type === "string") {
    if (typeof value !== "string") errors.push(`${path} must be text.`);
    else if (schema.minLength && value.trim().length < schema.minLength) errors.push(`${path} cannot be empty.`);
    else if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of: ${schema.enum.join(", ")}.`);
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) errors.push(`${path} must be a list.`);
    else {
      if (schema.minItems && value.length < schema.minItems) errors.push(`${path} must contain at least ${schema.minItems} item(s).`);
      value.forEach((item, index) => validateValue(item, schema.items, `${path}[${index}]`, errors));
    }
  }
};

const validateParameters = (evaluatorType, parameters = {}) => {
  const definition = evaluatorDefinitions[evaluatorType];
  if (!definition) return [`Unknown evaluator type: ${evaluatorType}.`];
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return ["Parameters must be a JSON object."];
  const schema = definition.parameter_schema;
  const errors = [];
  for (const required of schema.required || []) {
    if (parameters[required] === undefined || parameters[required] === null) errors.push(`parameters.${required} is required.`);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(parameters)) {
      if (!schema.properties[key]) errors.push(`parameters.${key} is not supported by this evaluator.`);
    }
  }
  for (const [key, value] of Object.entries(parameters)) {
    if (schema.properties[key]) validateValue(value, schema.properties[key], `parameters.${key}`, errors);
  }
  return errors;
};

const listEvaluatorDefinitions = () => Object.entries(evaluatorDefinitions).map(([value, definition]) => ({
  value,
  label: definition.label,
  description: definition.description,
  rule_type: definition.rule_type || "validation",
  supported_targets: definition.supported_targets,
  parameter_schema: definition.parameter_schema
}));

module.exports = {
  EXECUTION_TARGETS,
  REQUIRED_PLACEMENT_CAPABILITIES,
  SEVERITIES,
  VIOLATION_ACTIONS,
  evaluatorDefinitions,
  listEvaluatorDefinitions,
  validateParameters
};

import { formatDateTime, formatMeasure } from "./wms-operational";

/**
 * Warehouse, Zone, Rack, Level, Bin detail view field mappings
 * Each mapping defines which fields to display and how to format them
 */

const NOT_SPECIFIED = "Not specified";

const isPresent = (value) => value !== null && value !== undefined && value !== "";

const formatText = (...values) => {
  for (const value of values) {
    if (isPresent(value)) return String(value);
  }
  return NOT_SPECIFIED;
};

const formatMeasureValue = (value, unit) => {
  if (!isPresent(value)) return NOT_SPECIFIED;
  const formatted = formatMeasure(value, unit);
  return formatted === "No data" ? NOT_SPECIFIED : formatted;
};

const formatCountValue = (value) => {
  if (!isPresent(value)) return NOT_SPECIFIED;
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : NOT_SPECIFIED;
};

const formatBoolean = (value) => {
  if (!isPresent(value)) return NOT_SPECIFIED;
  if (value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true" || String(value).toLowerCase() === "yes") return "Yes";
  if (value === false || value === 0 || value === "0" || String(value).toLowerCase() === "false" || String(value).toLowerCase() === "no") return "No";
  return NOT_SPECIFIED;
};

const formatDimensions = (length, width, height) => {
  if (![length, width, height].every(isPresent)) return NOT_SPECIFIED;
  return `${length} × ${width} × ${height} m`;
};

const formatDateTimeValue = (datetime) => (isPresent(datetime) ? formatDateTime(datetime) : NOT_SPECIFIED);

const formatHierarchy = (...segments) => {
  const path = segments.map((segment) => formatText(segment)).filter((segment) => segment !== NOT_SPECIFIED);
  return path.length > 0 ? path.join(" → ") : NOT_SPECIFIED;
};

const formatStatus = (record, { fallback = null } = {}) => {
  if (isPresent(record?.status)) return String(record.status);
  if (isPresent(record?.creation_status)) return String(record.creation_status);
  if (record?.active === true) return "Active";
  if (record?.active === false) return "Inactive";
  if (isPresent(fallback)) return String(fallback);
  return NOT_SPECIFIED;
};

const formatOccupancy = (record) => {
  if (isPresent(record?.current_occupancy)) {
    const number = Number(record.current_occupancy);
    return Number.isFinite(number) ? `${number.toLocaleString()}%` : formatText(record.current_occupancy);
  }

  const currentWeight = Number(record?.current_weight);
  const maxWeight = Number(record?.max_weight);
  if (Number.isFinite(currentWeight) && Number.isFinite(maxWeight) && maxWeight > 0) {
    return `${((currentWeight / maxWeight) * 100).toFixed(1)}%`;
  }

  const currentVolume = Number(record?.current_volume);
  const maxVolume = Number(record?.max_volume);
  if (Number.isFinite(currentVolume) && Number.isFinite(maxVolume) && maxVolume > 0) {
    return `${((currentVolume / maxVolume) * 100).toFixed(1)}%`;
  }

  return NOT_SPECIFIED;
};

const formatParent = (code, name) => formatHierarchy(code, name);

// ====================================================================
// WAREHOUSE VIEW FIELDS
// ====================================================================
export const getWarehouseViewFields = (record) => {
  if (!record) return [];

  return [
    ["Warehouse Name", formatText(record.warehouse_name, record.name)],
    ["Warehouse Code", formatText(record.warehouse_code, record.code)],
    ["Description", formatText(record.description)],
    ["Total Capacity", formatMeasureValue(record.total_capacity, "kg")],
    ["Status", formatStatus(record)],
    ["Zones Count", formatCountValue(record.zone_count ?? record.zones_count)],
    ["Racks Count", formatCountValue(record.rack_total ?? record.rack_count)],
    ["Levels Count", formatCountValue(record.level_total ?? record.level_count)],
    ["Bins Count", formatCountValue(record.bin_total ?? record.bin_count)],
    ["Created At", formatDateTimeValue(record.created_at)],
    ["Updated At", formatDateTimeValue(record.updated_at)]
  ];
};

// ====================================================================
// ZONE VIEW FIELDS
// ====================================================================
export const getZoneViewFields = (record) => {
  if (!record) return [];

  return [
    ["Zone Name", formatText(record.zone_name, record.name)],
    ["Zone Code", formatText(record.zone_code, record.code)],
    ["Warehouse", formatParent(record.warehouse_code, record.warehouse_name)],
    ["Cargo Type Allowed", formatText(record.allowed_cargo_type, record.cargo_type_allowed)],
    ["Zone Type", formatText(record.zone_type, record.type)],
    ["Handling Condition", formatText(record.handling_condition)],
    ["Hazard Zone", formatBoolean(record.is_hazard_zone)],
    ["Maximum Weight", formatMeasureValue(record.max_weight, "kg")],
    ["Maximum Volume", formatMeasureValue(record.max_volume, "m³")],
    ["Status", formatStatus(record)],
    ["Racks Count", formatCountValue(record.rack_total ?? record.rack_count)],
    ["Bins Count", formatCountValue(record.bin_total ?? record.bin_count)],
    ["Created At", formatDateTimeValue(record.created_at)],
    ["Updated At", formatDateTimeValue(record.updated_at)]
  ];
};

// ====================================================================
// RACK VIEW FIELDS
// ====================================================================
export const getRackViewFields = (record) => {
  if (!record) return [];

  return [
    ["Rack Name", formatText(record.rack_name, record.name)],
    ["Rack Code", formatText(record.rack_code, record.code)],
    ["Warehouse", formatParent(record.warehouse_code, record.warehouse_name)],
    ["Zone", formatParent(record.zone_code, record.zone_name)],
    ["Maximum Weight Capacity", formatMeasureValue(record.max_weight, "kg")],
    ["Status", formatStatus(record)],
    ["Levels Count", formatCountValue(record.level_total ?? record.level_count)],
    ["Bins Count", formatCountValue(record.bin_total ?? record.bin_count)],
    ["Created At", formatDateTimeValue(record.created_at)],
    ["Updated At", formatDateTimeValue(record.updated_at)]
  ];
};

// ====================================================================
// LEVEL VIEW FIELDS
// ====================================================================
export const getLevelViewFields = (record) => {
  if (!record) return [];

  return [
    ["Level Name", formatText(record.level_name, record.name)],
    ["Level Code", formatText(record.level_code, record.code)],
    ["Warehouse", formatParent(record.warehouse_code, record.warehouse_name)],
    ["Zone", formatParent(record.zone_code, record.zone_name)],
    ["Rack", formatParent(record.rack_code, record.rack_name)],
    ["Level Number", formatText(record.level_number)],
    ["Maximum Weight Capacity", formatMeasureValue(record.max_weight, "kg")],
    ["Status", formatStatus(record)],
    ["Bins Count", formatCountValue(record.bin_total ?? record.bin_count)],
    ["Created At", formatDateTimeValue(record.created_at)],
    ["Updated At", formatDateTimeValue(record.updated_at)]
  ];
};

// ====================================================================
// BIN VIEW FIELDS
// ====================================================================
export const getBinViewFields = (record) => {
  if (!record) return [];

  return [
    ["Hierarchy", formatHierarchy(record.warehouse_code, record.zone_code, record.rack_code, record.level_code, record.bin_code)],
    ["Bin Name", formatText(record.bin_name, record.name)],
    ["Bin Code", formatText(record.bin_code, record.code)],
    ["Warehouse", formatParent(record.warehouse_code, record.warehouse_name)],
    ["Zone", formatParent(record.zone_code, record.zone_name)],
    ["Rack", formatParent(record.rack_code, record.rack_name)],
    ["Level", formatParent(record.level_code, record.level_name)],
    ["Bin Type", formatText(record.bin_type, record.type)],
    ["Dimensions", formatDimensions(record.length, record.width, record.height)],
    ["Volume Capacity", formatMeasureValue(record.volume_capacity ?? record.capacity_volume ?? record.max_volume, "m³")],
    ["Weight Capacity", formatMeasureValue(record.weight_capacity ?? record.capacity_weight ?? record.max_weight, "kg")],
    ["Current Occupancy", formatOccupancy(record)],
    ["Operational Status", formatText(record.operational_status, record.status)],
    ["Creation Status", formatText(record.creation_status)],
    ["Cargo Restrictions", formatText(record.cargo_restrictions, record.allowed_cargo_type)],
    ["Created At", formatDateTimeValue(record.created_at)],
    ["Updated At", formatDateTimeValue(record.updated_at)]
  ];
};

// ====================================================================
// BIN RULE VIEW FIELDS
// ====================================================================
export const getBinRuleViewFields = (record) => {
  if (!record) return [];

  return [
    ["Rule Reference", formatText(record.public_reference)],
    ["Rule Name", formatText(record.rule_name)],
    ["Rule Code", formatText(record.rule_code)],
    ["Category", formatText(record.category_name)],
    ["Trusted Evaluator", formatText(record.evaluator_type)],
    ["Rule Type", formatText(record.rule_type)],
    ["Execution Targets", Array.isArray(record.execution_targets) ? record.execution_targets.join(", ") : "Not specified"],
    ["Violation Action", formatText(record.violation_action)],
    ["Severity", formatText(record.severity)],
    ["Priority", formatCountValue(record.priority)],
    ["Parameters", JSON.stringify(record.parameters || {})],
    ["Status", record.is_active ? "Active" : "Inactive"],
    ["Created At", formatDateTimeValue(record.created_at)],
    ["Updated At", formatDateTimeValue(record.updated_at)]
  ];
};

// ====================================================================
// CAPACITY CONFIGURATION VIEW FIELDS
// ====================================================================
export const getCapacityConfigViewFields = (record) => {
  if (!record) return [];

  const entityName = formatText(record.entity_name, record.configuration_name);
  const status = formatStatus(record, { fallback: record.is_active ? "Active" : record.is_active === false ? "Inactive" : null });

  return [
    ["Configuration Name", entityName],
    ["Warehouse", formatParent(record.warehouse_code, record.warehouse_name)],
    ["Zone", formatParent(record.zone_code, record.zone_name)],
    ["Rack", formatParent(record.rack_code, record.rack_name)],
    ["Level", formatParent(record.level_code, record.level_name)],
    ["Bin", formatParent(record.bin_code, record.bin_name)],
    ["Maximum Weight", formatMeasureValue(record.max_weight ?? record.weight_capacity, "kg")],
    ["Maximum Volume", formatMeasureValue(record.max_volume ?? record.volume_capacity, "m³")],
    ["Warning Threshold", isPresent(record.occupancy_warning_threshold) ? `${record.occupancy_warning_threshold}%` : NOT_SPECIFIED],
    ["Full Threshold", isPresent(record.full_threshold) ? `${record.full_threshold}%` : NOT_SPECIFIED],
    ["Status", status],
    ["Created At", formatDateTimeValue(record.created_at)],
    ["Updated At", formatDateTimeValue(record.updated_at)]
  ];
};

// ====================================================================
// DISPATCHER FUNCTION
// ====================================================================
export const getDetailViewFields = (scope, record) => {
  switch (scope) {
    case "warehouses":
      return getWarehouseViewFields(record);
    case "zones":
      return getZoneViewFields(record);
    case "racks":
      return getRackViewFields(record);
    case "levels":
      return getLevelViewFields(record);
    case "bins":
      return getBinViewFields(record);
    case "bin-rules":
      return getBinRuleViewFields(record);
    case "capacity-config":
      return getCapacityConfigViewFields(record);
    default:
      return [];
  }
};

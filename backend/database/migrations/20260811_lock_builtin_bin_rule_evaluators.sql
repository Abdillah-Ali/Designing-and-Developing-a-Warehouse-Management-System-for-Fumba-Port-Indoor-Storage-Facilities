-- Preserve the approved evaluator relationship for built-in rules. The lock is
-- configuration metadata only: the runtime still executes evaluator_type.
ALTER TABLE bin_rules
  ADD COLUMN IF NOT EXISTS required_evaluator_type VARCHAR(100);

UPDATE bin_rules
SET required_evaluator_type = CASE rule_name
  WHEN 'Bin Volume Capacity Limit' THEN 'capacity_limits'
  WHEN 'Bin Weight Capacity Limit' THEN 'capacity_limits'
  WHEN 'Cargo-Zone Compatibility' THEN 'cargo_storage_compatibility'
  WHEN 'Hazardous Zone Compliance' THEN 'hazard_zone_compatibility'
  WHEN 'Avoid Unavailable Bins' THEN 'storage_status'
  WHEN 'Reserved Bin Restrictions' THEN 'reserved_storage'
  WHEN 'Zone Restriction' THEN 'restricted_zone_approval'
  WHEN 'Customs Hold Restriction' THEN 'customs_hold_storage'
  WHEN 'Fragile Cargo Handling' THEN 'fragile_handling'
  WHEN 'Assignment Priority' THEN 'candidate_ordering'
  WHEN 'First Available Bin' THEN 'candidate_ordering'
  ELSE required_evaluator_type
END
WHERE rule_name IN (
  'Bin Volume Capacity Limit', 'Bin Weight Capacity Limit',
  'Cargo-Zone Compatibility', 'Hazardous Zone Compliance',
  'Avoid Unavailable Bins', 'Reserved Bin Restrictions', 'Zone Restriction',
  'Customs Hold Restriction', 'Fragile Cargo Handling',
  'Assignment Priority', 'First Available Bin'
);

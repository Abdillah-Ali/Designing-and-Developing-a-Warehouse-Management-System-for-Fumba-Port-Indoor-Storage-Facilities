-- Repair the legacy built-in Bin Rules that predate trusted evaluator metadata.
-- Only rules with no evaluator are changed; administrator-configured rules remain untouched.
WITH built_in_rule_mapping (rule_keys, rule_names, evaluator_type, execution_targets, violation_action, severity, priority, parameters) AS (
  VALUES
    (ARRAY['volume']::text[], ARRAY['Bin Volume Capacity Limit']::text[],
      'capacity_limits', ARRAY['placement_recommendation','placement_confirmation','relocation']::text[], 'block', 'critical', 10,
      '{"enforce_weight": false, "enforce_volume": true}'::jsonb),
    (ARRAY['weight']::text[], ARRAY['Bin Weight Capacity Limit']::text[],
      'capacity_limits', ARRAY['placement_recommendation','placement_confirmation','relocation']::text[], 'block', 'critical', 20,
      '{"enforce_weight": true, "enforce_volume": false}'::jsonb),
    (ARRAY['compatibility']::text[], ARRAY['Cargo-Zone Compatibility']::text[],
      'cargo_storage_compatibility', ARRAY['placement_recommendation','placement_confirmation','relocation']::text[], 'block', 'critical', 30,
      '{}'::jsonb),
    (ARRAY['hazardous']::text[], ARRAY['Hazardous Zone Compliance']::text[],
      'hazard_zone_compatibility', ARRAY['placement_recommendation','placement_confirmation','relocation']::text[], 'block', 'critical', 40,
      '{"hazardous_cargo_type": "Hazardous Cargo"}'::jsonb),
    (ARRAY['avoid_unavailable']::text[], ARRAY['Avoid Unavailable Bins']::text[],
      'storage_status', ARRAY['placement_recommendation','placement_confirmation','relocation']::text[], 'block', 'critical', 50,
      '{"allowed_statuses": ["Available", "Occupied"]}'::jsonb),
    (ARRAY['restricted','zone_restriction']::text[], ARRAY['Zone Restriction']::text[],
      'restricted_zone_approval', ARRAY['placement_recommendation','placement_confirmation','relocation']::text[], 'supervisor_approval', 'high', 60,
      '{"restricted_zone_type": "Restricted"}'::jsonb),
    (ARRAY['customs_hold']::text[], ARRAY['Customs Hold Restriction']::text[],
      'customs_hold_storage', ARRAY['placement_recommendation','placement_confirmation','relocation']::text[], 'customs_approval', 'high', 70,
      '{"hold_marker": "hold", "storage_marker": "customs hold"}'::jsonb),
    (ARRAY['fragile_handling']::text[], ARRAY['Fragile Cargo Handling']::text[],
      'fragile_handling', ARRAY['placement_recommendation','placement_confirmation','relocation']::text[], 'block', 'high', 80,
      '{"cargo_type": "Fragile Goods", "handling_marker": "fragile"}'::jsonb),
    (ARRAY['reserved']::text[], ARRAY['Reserved Bin Restrictions']::text[],
      'reserved_storage', ARRAY['placement_recommendation','placement_confirmation','relocation']::text[], 'block', 'high', 90,
      '{}'::jsonb),
    (ARRAY['priority','first_available']::text[], ARRAY['Assignment Priority','First Available Bin']::text[],
      'candidate_ordering', ARRAY['placement_recommendation']::text[], 'warning', 'info', 100,
      '{"field": "created_at", "direction": "asc"}'::jsonb)
)
UPDATE bin_rules AS rule
SET rule_type = CASE WHEN mapping.evaluator_type = 'candidate_ordering' THEN 'ordering' ELSE 'validation' END,
    evaluator_type = mapping.evaluator_type,
    execution_targets = mapping.execution_targets,
    violation_action = mapping.violation_action,
    severity = mapping.severity,
    priority = mapping.priority,
    parameters = mapping.parameters,
    updated_at = CURRENT_TIMESTAMP
FROM built_in_rule_mapping AS mapping
WHERE (rule.evaluator_type IS NULL OR BTRIM(rule.evaluator_type) = '')
  AND (
    LOWER(rule.rule_key) = ANY(mapping.rule_keys)
    OR rule.rule_name = ANY(mapping.rule_names)
  );

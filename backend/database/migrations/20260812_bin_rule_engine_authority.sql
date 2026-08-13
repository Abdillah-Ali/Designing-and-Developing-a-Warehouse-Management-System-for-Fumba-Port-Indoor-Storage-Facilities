-- Phase 4: make trusted evaluator configuration explicit and normalize legacy actions/parameters.
UPDATE bin_rules
SET violation_action = 'block', updated_at = CURRENT_TIMESTAMP
WHERE evaluator_type = 'customs_hold_storage'
  AND violation_action = 'customs_approval';

UPDATE bin_rules
SET parameters = (parameters - 'hazardous_cargo_type') || jsonb_build_object('hazardous_cargo_type_key', 'hazardous_cargo'),
    updated_at = CURRENT_TIMESTAMP
WHERE evaluator_type = 'hazard_zone_compatibility'
  AND NOT (parameters ? 'hazardous_cargo_type_key');

UPDATE bin_rules
SET parameters = (parameters - 'cargo_type') || jsonb_build_object('cargo_type_key', 'fragile_goods'),
    updated_at = CURRENT_TIMESTAMP
WHERE evaluator_type = 'fragile_handling'
  AND NOT (parameters ? 'cargo_type_key');

CREATE INDEX IF NOT EXISTS idx_bin_rules_active_execution_priority
  ON bin_rules (priority, created_at, public_reference)
  WHERE is_active = TRUE;

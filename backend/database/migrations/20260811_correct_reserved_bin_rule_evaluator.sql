-- The legacy key "restricted" belongs to the displayed "Reserved Bin
-- Restrictions" rule. Repair it by name, avoiding ambiguous legacy keys.
UPDATE bin_rules
SET rule_type = 'validation',
    evaluator_type = 'reserved_storage',
    execution_targets = ARRAY['placement_recommendation','placement_confirmation','relocation']::text[],
    violation_action = 'block',
    severity = 'high',
    priority = 90,
    parameters = '{}'::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE rule_name = 'Reserved Bin Restrictions';

UPDATE bin_rules
SET rule_type = 'validation',
    evaluator_type = 'restricted_zone_approval',
    execution_targets = ARRAY['placement_recommendation','placement_confirmation','relocation']::text[],
    violation_action = 'supervisor_approval',
    severity = 'high',
    priority = 60,
    parameters = '{"restricted_zone_type": "Restricted"}'::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE rule_name = 'Zone Restriction';

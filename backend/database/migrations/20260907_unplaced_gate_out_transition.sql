-- Cargo approved for release may leave the port before warehouse placement.
-- The Gate eligibility policy remains responsible for registration, Customs,
-- finance or Management approval, and customer-presence checks.
INSERT INTO workflow_transitions(
  workflow_key, revision, transition_key, display_label,
  from_state_key, to_state_key, required_permission_key,
  notes_requirement, confirmation_requirement, conditions, effects,
  audit_event_key, priority
)
SELECT
  workflow_key, active_revision, 'finalize_gate_release', 'Finalize Gate release',
  'unplaced', 'dispatched', 'gate.gate_out.confirm',
  'none', TRUE, '[{"condition_key":"cargo_not_archived","parameters":{}}]'::jsonb,
  '["update_placement_state"]'::jsonb, 'GATE_FINALIZE_DISPATCH', 89
FROM workflow_definitions
WHERE workflow_key='cargo_placement' AND active=TRUE
ON CONFLICT DO NOTHING;

-- A Customs hold is reversible only through a recorded, reasoned return to inspection.
INSERT INTO workflow_transitions(
  workflow_key, revision, transition_key, display_label, from_state_key, to_state_key,
  required_permission_key, notes_requirement, confirmation_requirement, conditions,
  effects, notification_event_key, audit_event_key, priority, active
)
VALUES(
  'customs', 1, 'release_hold', 'Release hold', 'on_hold', 'inspection_in_progress',
  'customs.clearance.update', 'required', FALSE,
  '[{"condition_key":"cargo_not_archived","parameters":{}},{"condition_key":"cargo_not_gate_released","parameters":{}}]'::jsonb,
  '["update_customs_state"]'::jsonb, NULL, 'CUSTOMS_RELEASE_HOLD', 35, TRUE
)
ON CONFLICT(workflow_key, revision, transition_key, from_state_key) DO NOTHING;

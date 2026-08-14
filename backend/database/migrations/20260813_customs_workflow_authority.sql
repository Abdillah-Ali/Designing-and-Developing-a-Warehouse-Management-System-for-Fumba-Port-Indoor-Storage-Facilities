-- Phase 7: trusted Customs states and database-owned transition policy.
ALTER TABLE cargo ADD COLUMN IF NOT EXISTS customs_status_key VARCHAR(80);
UPDATE cargo SET customs_status_key=CASE customs_status
 WHEN 'Pending Inspection' THEN 'pending_inspection' WHEN 'Inspection In Progress' THEN 'inspection_in_progress'
 WHEN 'Documents Required' THEN 'documents_required' WHEN 'On Hold' THEN 'on_hold'
 WHEN 'Cleared' THEN 'cleared' WHEN 'Rejected' THEN 'rejected' END
WHERE customs_status_key IS NULL;

ALTER TABLE customs_records ADD COLUMN IF NOT EXISTS status_key VARCHAR(80);
UPDATE customs_records SET status_key=CASE status
 WHEN 'Pending Inspection' THEN 'pending_inspection' WHEN 'Inspection In Progress' THEN 'inspection_in_progress'
 WHEN 'Documents Required' THEN 'documents_required' WHEN 'On Hold' THEN 'on_hold'
 WHEN 'Cleared' THEN 'cleared' WHEN 'Rejected' THEN 'rejected' END
WHERE status_key IS NULL;
ALTER TABLE customs_status_history ADD COLUMN IF NOT EXISTS transition_key VARCHAR(100), ADD COLUMN IF NOT EXISTS from_state_key VARCHAR(80), ADD COLUMN IF NOT EXISTS to_state_key VARCHAR(80), ADD COLUMN IF NOT EXISTS policy_revision INTEGER;

INSERT INTO workflow_definitions(workflow_key,display_name,description,active_revision,system_protected)
VALUES('customs','Customs','Inspection, documents, hold, rejection and clearance lifecycle.',1,TRUE)
ON CONFLICT(workflow_key) DO NOTHING;
INSERT INTO workflow_states(workflow_key,state_key,storage_value,display_label,terminal,system_protected) VALUES
('customs','pending_inspection','Pending Inspection','Pending Inspection',FALSE,TRUE),
('customs','inspection_in_progress','Inspection In Progress','Inspection In Progress',FALSE,TRUE),
('customs','documents_required','Documents Required','Documents Required',FALSE,TRUE),
('customs','on_hold','On Hold','On Hold',FALSE,TRUE),
('customs','cleared','Cleared','Cleared',FALSE,TRUE),
('customs','rejected','Rejected','Rejected',FALSE,TRUE)
ON CONFLICT(workflow_key,state_key) DO NOTHING;

WITH sources AS (SELECT state_key FROM workflow_states WHERE workflow_key='customs'), actions(transition_key,label,to_key,permission_key,notes,confirmation,audit_key,priority) AS (VALUES
('start_inspection','Start inspection','inspection_in_progress','customs.inspections.create','optional',FALSE,'CUSTOMS_START_INSPECTION',10),
('request_documents','Request documents','documents_required','customs.clearance.update','required',FALSE,'CUSTOMS_REQUEST_DOCUMENTS',20),
('place_on_hold','Place on hold','on_hold','customs.clearance.update','required',FALSE,'CUSTOMS_PLACE_ON_HOLD',30),
('clear_customs','Clear Customs','cleared','customs.clearance.update','optional',TRUE,'CUSTOMS_CLEAR',40),
('reject_customs','Reject','rejected','customs.clearance.update','required',FALSE,'CUSTOMS_REJECT',50))
INSERT INTO workflow_transitions(workflow_key,revision,transition_key,display_label,from_state_key,to_state_key,required_permission_key,notes_requirement,confirmation_requirement,conditions,effects,notification_event_key,audit_event_key,priority)
SELECT 'customs',1,a.transition_key,a.label,s.state_key,a.to_key,a.permission_key,a.notes,a.confirmation,'[{"condition_key":"cargo_not_archived","parameters":{}},{"condition_key":"cargo_not_gate_released","parameters":{}}]'::jsonb,'["update_customs_state"]'::jsonb,NULL,a.audit_key,a.priority
FROM sources s CROSS JOIN actions a ON CONFLICT(workflow_key,revision,transition_key,from_state_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_cargo_customs_state_key ON cargo(customs_status_key);
CREATE INDEX IF NOT EXISTS idx_customs_history_transition ON customs_status_history(cargo_id,transition_key,changed_at DESC);

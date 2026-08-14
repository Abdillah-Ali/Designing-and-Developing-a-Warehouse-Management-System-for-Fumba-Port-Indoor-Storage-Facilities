CREATE TABLE IF NOT EXISTS notification_policies (
  event_key VARCHAR(120) NOT NULL,
  revision INTEGER NOT NULL,
  notification_type VARCHAR(80) NOT NULL,
  priority VARCHAR(20) NOT NULL,
  actionable BOOLEAN NOT NULL,
  deep_link_builder_key VARCHAR(80) NOT NULL,
  resolution_strategy_key VARCHAR(80) NOT NULL,
  archive_policy_key VARCHAR(80) NOT NULL,
  protected BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  configuration_status VARCHAR(30) NOT NULL DEFAULT 'ready',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(event_key, revision),
  CHECK (revision >= 1),
  CHECK (priority IN ('low','normal','high','urgent')),
  CHECK (configuration_status IN ('ready','review_required','invalid'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_policy_one_active
  ON notification_policies(event_key) WHERE active;

CREATE TABLE IF NOT EXISTS notification_policy_recipients (
  event_key VARCHAR(120) NOT NULL,
  policy_revision INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  resolver_key VARCHAR(80) NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(event_key, policy_revision, sequence),
  FOREIGN KEY(event_key, policy_revision) REFERENCES notification_policies(event_key, revision) ON DELETE CASCADE,
  CHECK (sequence >= 1),
  CHECK (jsonb_typeof(parameters) = 'object')
);

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS event_key VARCHAR(120),
  ADD COLUMN IF NOT EXISTS policy_revision INTEGER,
  ADD COLUMN IF NOT EXISTS actionable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS recipient_strategy VARCHAR(80),
  ADD COLUMN IF NOT EXISTS deep_link_builder_key VARCHAR(80),
  ADD COLUMN IF NOT EXISTS resolution_strategy_key VARCHAR(80),
  ADD COLUMN IF NOT EXISTS archive_policy_key VARCHAR(80),
  ADD COLUMN IF NOT EXISTS subject_reference VARCHAR(160),
  ADD COLUMN IF NOT EXISTS action_reference VARCHAR(160),
  ADD COLUMN IF NOT EXISTS policy_mapping_status VARCHAR(30) NOT NULL DEFAULT 'ready';

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_policy_mapping_status_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_policy_mapping_status_check
  CHECK (policy_mapping_status IN ('ready','review_required'));

UPDATE notifications
SET event_key = CASE notification_type
  WHEN 'pending_approval' THEN 'cargo.review_required'
  WHEN 'correction_request' THEN 'cargo.correction_requested'
  WHEN 'placement_override' THEN 'placement.override_requested'
  WHEN 'dispatch_request' THEN 'dispatch.requested'
  WHEN 'customs_inspection' THEN 'customs.inspection_required'
  WHEN 'finance_charge_started' THEN 'finance.charge_started'
  ELSE event_key
END,
policy_mapping_status = CASE
  WHEN notification_type IN ('pending_approval','correction_request','placement_override','dispatch_request','customs_inspection','finance_charge_started') THEN 'ready'
  ELSE 'review_required'
END
WHERE event_key IS NULL;

INSERT INTO notification_policies
  (event_key,revision,notification_type,priority,actionable,deep_link_builder_key,resolution_strategy_key,archive_policy_key,protected)
VALUES
('cargo.review_required',1,'pending_approval','normal',TRUE,'cargo_review','cargo_review_completed','actionable_until_resolved',TRUE),
('cargo.review_overdue',1,'warehouse_alert','high',TRUE,'cargo_review','cargo_review_completed','actionable_until_resolved',TRUE),
('cargo.correction_requested',1,'correction_request','high',TRUE,'cargo_correction','correction_resubmitted','actionable_until_resolved',TRUE),
('cargo.registration_approved',1,'approval_decision','normal',FALSE,'cargo_correction','none','informational_archiveable',FALSE),
('cargo.registration_rejected',1,'approval_decision','high',FALSE,'cargo_correction','none','informational_archiveable',FALSE),
('finance.charge_started',1,'finance_charge_started','normal',FALSE,'finance_cargo','none','informational_archiveable',TRUE),
('customs.inspection_required',1,'customs_inspection','normal',TRUE,'customs_queue','customs_left_pending','actionable_until_resolved',TRUE),
('placement.override_requested',1,'placement_override','high',TRUE,'placement_override','placement_override_decided','actionable_until_resolved',TRUE),
('placement.override_approved',1,'approval_decision','normal',FALSE,'staff_placement','none','informational_archiveable',FALSE),
('placement.override_rejected',1,'approval_decision','high',FALSE,'staff_placement','none','informational_archiveable',FALSE),
('dispatch.requested',1,'dispatch_request','high',TRUE,'dispatch_request','dispatch_decided','actionable_until_resolved',TRUE),
('dispatch.submitted',1,'dispatch_update','normal',FALSE,'staff_dispatch','none','informational_archiveable',FALSE),
('dispatch.approved',1,'dispatch_update','normal',FALSE,'staff_dispatch','none','informational_archiveable',FALSE),
('dispatch.rejected',1,'dispatch_update','high',FALSE,'staff_dispatch','none','informational_archiveable',FALSE),
('gate.release_ready',1,'gate_release_update','high',TRUE,'gate_release','gate_released','actionable_until_resolved',TRUE),
('gate.release_blocked',1,'gate_release_update','high',FALSE,'gate_release','none','informational_archiveable',FALSE),
('finance.release_blocked',1,'finance_payment_update','high',FALSE,'finance_cargo','none','informational_archiveable',FALSE),
('finance.emergency_balance',1,'finance_payment_update','urgent',FALSE,'finance_cargo','none','informational_archiveable',FALSE),
('warehouse.alert',1,'warehouse_alert','high',FALSE,'none','none','informational_archiveable',FALSE)
ON CONFLICT DO NOTHING;

INSERT INTO notification_policy_recipients(event_key,policy_revision,sequence,resolver_key,parameters)
VALUES
('cargo.review_required',1,1,'users_with_permission','{"permission_key":"cargo.approve","scope":"warehouse"}'),
('cargo.review_overdue',1,1,'users_with_permission','{"permission_key":"cargo.approve","scope":"warehouse"}'),
('cargo.correction_requested',1,1,'cargo_owner','{}'),
('cargo.registration_approved',1,1,'specific_user','{"context_key":"recipient_user_id"}'),
('cargo.registration_rejected',1,1,'specific_user','{"context_key":"recipient_user_id"}'),
('finance.charge_started',1,1,'users_with_permission','{"permission_key":"finance.charges.view","scope":"global"}'),
('customs.inspection_required',1,1,'users_with_permission','{"permission_key":"customs.inspections.create","scope":"global"}'),
('placement.override_requested',1,1,'users_with_permission','{"permission_key":"cargo.approve","scope":"warehouse"}'),
('placement.override_approved',1,1,'specific_user','{"context_key":"recipient_user_id"}'),
('placement.override_rejected',1,1,'specific_user','{"context_key":"recipient_user_id"}'),
('dispatch.requested',1,1,'users_with_permission','{"permission_key":"dispatch.requests.decide","scope":"warehouse"}'),
('dispatch.submitted',1,1,'specific_user','{"context_key":"recipient_user_id"}'),
('dispatch.approved',1,1,'specific_user','{"context_key":"recipient_user_id"}'),
('dispatch.rejected',1,1,'specific_user','{"context_key":"recipient_user_id"}'),
('gate.release_ready',1,1,'users_with_permission','{"permission_key":"gate.gate_out.confirm","scope":"global"}'),
('gate.release_blocked',1,1,'users_with_permission','{"permission_key":"gate.gate_out.confirm","scope":"global"}'),
('finance.release_blocked',1,1,'users_with_permission','{"permission_key":"finance.payments.record","scope":"global"}'),
('finance.emergency_balance',1,1,'users_with_permission','{"permission_key":"finance.payments.record","scope":"global"}'),
('warehouse.alert',1,1,'users_with_permission','{"permission_key":"cargo.approve","scope":"warehouse"}')
ON CONFLICT DO NOTHING;

UPDATE notifications n
SET policy_revision=p.revision,
    actionable=p.actionable,
    deep_link_builder_key=p.deep_link_builder_key,
    resolution_strategy_key=p.resolution_strategy_key,
    archive_policy_key=p.archive_policy_key
FROM notification_policies p
WHERE n.event_key=p.event_key AND p.active AND n.policy_mapping_status='ready';

CREATE INDEX IF NOT EXISTS idx_notifications_event_subject_status
  ON notifications(event_key,subject_reference,status,created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_active_action_dedup
  ON notifications(recipient_user_id,event_key,subject_reference,COALESCE(action_reference,''))
  WHERE actionable=TRUE AND status='pending' AND archived_at IS NULL;

-- Phase 5: trusted cargo state identities and database-owned transition policy.
CREATE TABLE IF NOT EXISTS workflow_definitions (
  workflow_key VARCHAR(80) PRIMARY KEY,
  display_name VARCHAR(120) NOT NULL,
  description TEXT,
  active_revision INTEGER NOT NULL CHECK (active_revision > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  system_protected BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow_states (
  workflow_key VARCHAR(80) NOT NULL REFERENCES workflow_definitions(workflow_key) ON DELETE RESTRICT,
  state_key VARCHAR(80) NOT NULL,
  storage_value VARCHAR(80) NOT NULL,
  display_label VARCHAR(120) NOT NULL,
  terminal BOOLEAN NOT NULL DEFAULT FALSE,
  system_protected BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(workflow_key,state_key),
  UNIQUE(workflow_key,storage_value)
);

CREATE TABLE IF NOT EXISTS workflow_transitions (
  id BIGSERIAL PRIMARY KEY,
  workflow_key VARCHAR(80) NOT NULL REFERENCES workflow_definitions(workflow_key) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  transition_key VARCHAR(100) NOT NULL,
  display_label VARCHAR(120) NOT NULL,
  from_state_key VARCHAR(80) NOT NULL,
  to_state_key VARCHAR(80) NOT NULL,
  required_permission_key VARCHAR(120) NOT NULL REFERENCES permissions(permission_key) ON DELETE RESTRICT,
  notes_requirement VARCHAR(20) NOT NULL DEFAULT 'optional' CHECK(notes_requirement IN ('none','optional','required')),
  confirmation_requirement BOOLEAN NOT NULL DEFAULT FALSE,
  conditions JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(conditions)='array'),
  effects JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(effects)='array'),
  notification_event_key VARCHAR(100),
  audit_event_key VARCHAR(120) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 100 CHECK(priority > 0),
  system_protected BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workflow_key,from_state_key) REFERENCES workflow_states(workflow_key,state_key) ON DELETE RESTRICT,
  FOREIGN KEY(workflow_key,to_state_key) REFERENCES workflow_states(workflow_key,state_key) ON DELETE RESTRICT,
  UNIQUE(workflow_key,revision,transition_key,from_state_key)
);

CREATE TABLE IF NOT EXISTS workflow_transition_history (
  id BIGSERIAL PRIMARY KEY,
  public_reference UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  workflow_key VARCHAR(80) NOT NULL,
  transition_key VARCHAR(100) NOT NULL,
  entity_reference VARCHAR(120) NOT NULL,
  from_state_key VARCHAR(80) NOT NULL,
  to_state_key VARCHAR(80) NOT NULL,
  policy_revision INTEGER NOT NULL,
  performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  performed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workflow_transitions_active_lookup ON workflow_transitions(workflow_key,revision,transition_key,from_state_key,priority) WHERE active=TRUE;
CREATE INDEX IF NOT EXISTS idx_workflow_history_entity ON workflow_transition_history(entity_reference,performed_at DESC);

INSERT INTO workflow_definitions(workflow_key,display_name,description,active_revision,system_protected) VALUES
('cargo_registration','Cargo Registration','Supervisor review and staff revision lifecycle.',1,TRUE),
('cargo_placement','Cargo Placement','Placement state changes after trusted Bin Rule validation.',1,TRUE)
ON CONFLICT(workflow_key) DO NOTHING;

INSERT INTO workflow_states(workflow_key,state_key,storage_value,display_label,terminal,system_protected) VALUES
('cargo_registration','pending_review','Pending Review','Pending Review',FALSE,TRUE),
('cargo_registration','approved','Approved','Approved',FALSE,TRUE),
('cargo_registration','correction_required','Correction Required','Correction Required',FALSE,TRUE),
('cargo_registration','rejected','Rejected','Rejected',TRUE,TRUE),
('cargo_placement','unplaced','Unplaced','Unplaced',FALSE,TRUE),
('cargo_placement','placed','Placed','Placed',FALSE,TRUE),
('cargo_placement','relocated','Relocated','Relocated',FALSE,TRUE),
('cargo_placement','dispatched','Dispatched','Dispatched',TRUE,TRUE)
ON CONFLICT(workflow_key,state_key) DO NOTHING;

INSERT INTO workflow_transitions
(workflow_key,revision,transition_key,display_label,from_state_key,to_state_key,required_permission_key,notes_requirement,confirmation_requirement,conditions,effects,notification_event_key,audit_event_key,priority) VALUES
('cargo_registration',1,'approve_registration','Approve','pending_review','approved','cargo.approve','optional',TRUE,'[{"condition_key":"cargo_not_archived","parameters":{}}]','["update_registration_state"]','registration_approved','CARGO_WORKFLOW_APPROVE_REGISTRATION',10),
('cargo_registration',1,'request_registration_correction','Request correction','pending_review','correction_required','cargo.approve','required',TRUE,'[{"condition_key":"cargo_not_archived","parameters":{}}]','["update_registration_state"]','registration_correction_requested','CARGO_WORKFLOW_REQUEST_CORRECTION',20),
('cargo_registration',1,'reject_registration','Reject','pending_review','rejected','cargo.approve','required',TRUE,'[{"condition_key":"cargo_not_archived","parameters":{}}]','["update_registration_state"]','registration_rejected','CARGO_WORKFLOW_REJECT_REGISTRATION',30),
('cargo_registration',1,'resubmit_registration','Resubmit','correction_required','pending_review','cargo.resubmit','optional',TRUE,'[{"condition_key":"cargo_not_archived","parameters":{}}]','["update_registration_state"]','registration_pending','CARGO_WORKFLOW_RESUBMIT_CORRECTION',40),
('cargo_registration',1,'resubmit_registration','Resubmit','rejected','pending_review','cargo.resubmit','optional',TRUE,'[{"condition_key":"cargo_not_archived","parameters":{}}]','["update_registration_state"]','registration_pending','CARGO_WORKFLOW_RESUBMIT_REJECTION',41),
('cargo_registration',1,'resubmit_registration','Revise approved registration','approved','pending_review','cargo.resubmit','optional',TRUE,'[{"condition_key":"cargo_not_archived","parameters":{}}]','["update_registration_state"]','registration_pending','CARGO_WORKFLOW_REVISE_APPROVED',42),
('cargo_placement',1,'confirm_placement','Confirm placement','unplaced','placed','placement.confirm','none',TRUE,'[{"condition_key":"cargo_not_archived","parameters":{}}]','["update_placement_state"]',NULL,'CARGO_WORKFLOW_CONFIRM_PLACEMENT',10),
('cargo_placement',1,'relocate_cargo','Relocate cargo','placed','relocated','placement.confirm','none',TRUE,'[{"condition_key":"cargo_not_archived","parameters":{}}]','["update_placement_state"]',NULL,'CARGO_WORKFLOW_RELOCATE',20),
('cargo_placement',1,'relocate_cargo','Relocate cargo','relocated','relocated','placement.confirm','none',TRUE,'[{"condition_key":"cargo_not_archived","parameters":{}}]','["update_placement_state"]',NULL,'CARGO_WORKFLOW_RELOCATE',21)
ON CONFLICT(workflow_key,revision,transition_key,from_state_key) DO NOTHING;

-- Phase 8: database-owned dispatch and Gate eligibility policy.
CREATE TABLE IF NOT EXISTS eligibility_policies(
 policy_key VARCHAR(100) NOT NULL,revision INTEGER NOT NULL,target VARCHAR(80) NOT NULL,display_name VARCHAR(160) NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,configuration_status VARCHAR(30) NOT NULL DEFAULT 'ready',effective_from TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(policy_key,revision),CHECK(configuration_status IN('ready','review_required')));
CREATE TABLE IF NOT EXISTS eligibility_policy_requirements(
 id BIGSERIAL PRIMARY KEY,policy_key VARCHAR(100) NOT NULL,revision INTEGER NOT NULL,evaluator_key VARCHAR(100) NOT NULL,parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
 failure_action VARCHAR(20) NOT NULL DEFAULT 'block',priority INTEGER NOT NULL,is_required BOOLEAN NOT NULL DEFAULT TRUE,
 FOREIGN KEY(policy_key,revision) REFERENCES eligibility_policies(policy_key,revision) ON DELETE RESTRICT,
 UNIQUE(policy_key,revision,priority),UNIQUE(policy_key,revision,evaluator_key),CHECK(jsonb_typeof(parameters)='object'),CHECK(failure_action='block'),CHECK(priority>0));
INSERT INTO eligibility_policies(policy_key,revision,target,display_name) VALUES
('dispatch_request',1,'dispatch_request','Dispatch Request Eligibility'),('normal_gate_release',1,'normal_gate_release','Normal Gate Release'),('emergency_gate_release',1,'emergency_gate_release','Emergency Gate Release') ON CONFLICT DO NOTHING;
INSERT INTO eligibility_policy_requirements(policy_key,revision,evaluator_key,parameters,priority) VALUES
('dispatch_request',1,'registration_state','{"allowed":["approved"]}',10),('dispatch_request',1,'placement_state','{"allowed":["placed","relocated"]}',20),('dispatch_request',1,'release_state','{"allowed":["not_released"]}',30),
('normal_gate_release',1,'registration_state','{"allowed":["approved"]}',10),('normal_gate_release',1,'customs_clearance','{"required_state":"cleared"}',20),('normal_gate_release',1,'financial_clearance','{"maximum_outstanding":"0.00"}',30),('normal_gate_release',1,'dispatch_approval','{}',40),('normal_gate_release',1,'release_state','{"allowed":["not_released"]}',50),
('emergency_gate_release',1,'emergency_authorization','{}',10),('emergency_gate_release',1,'release_state','{"allowed":["not_released"]}',20)
ON CONFLICT DO NOTHING;
INSERT INTO workflow_transitions(workflow_key,revision,transition_key,display_label,from_state_key,to_state_key,required_permission_key,notes_requirement,confirmation_requirement,conditions,effects,audit_event_key,priority)
VALUES('cargo_placement',1,'finalize_gate_release','Finalize Gate release','placed','dispatched','gate.gate_out.confirm','none',TRUE,'[{"condition_key":"cargo_not_archived","parameters":{}}]','["update_placement_state"]','GATE_FINALIZE_DISPATCH',90),
('cargo_placement',1,'finalize_gate_release','Finalize Gate release','relocated','dispatched','gate.gate_out.confirm','none',TRUE,'[{"condition_key":"cargo_not_archived","parameters":{}}]','["update_placement_state"]','GATE_FINALIZE_DISPATCH',91)
ON CONFLICT DO NOTHING;
ALTER TABLE gate_out_records ADD COLUMN IF NOT EXISTS eligibility_policy_key VARCHAR(100),ADD COLUMN IF NOT EXISTS eligibility_policy_revision INTEGER,ADD COLUMN IF NOT EXISTS emergency_request_id INTEGER REFERENCES emergency_release_requests(id) ON DELETE RESTRICT;
ALTER TABLE emergency_release_requests ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMP,ADD COLUMN IF NOT EXISTS consumed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_one_pending ON dispatch_requests(cargo_id) WHERE status='Pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_emergency_one_active ON emergency_release_requests(cargo_id) WHERE status IN('Pending','Approved');
CREATE INDEX IF NOT EXISTS idx_eligibility_active ON eligibility_policies(target,active,effective_from DESC);

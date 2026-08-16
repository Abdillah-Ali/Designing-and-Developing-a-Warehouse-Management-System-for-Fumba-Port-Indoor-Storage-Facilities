-- Revision 2 makes explicit Management approval a mandatory Gate authorization
-- for every cargo classified as MANAGEMENT. Placement policy is intentionally unchanged.
UPDATE eligibility_policies
SET active=FALSE,updated_at=CURRENT_TIMESTAMP
WHERE policy_key IN ('normal_gate_release','emergency_gate_release') AND active=TRUE;

INSERT INTO eligibility_policies(policy_key,revision,target,display_name,active,configuration_status,effective_from)
VALUES
 ('normal_gate_release',2,'normal_gate_release','Normal Gate Release with Management Release Authority',TRUE,'ready',CURRENT_TIMESTAMP),
 ('emergency_gate_release',2,'emergency_gate_release','Emergency Gate Release with Management Release Authority',TRUE,'ready',CURRENT_TIMESTAMP)
ON CONFLICT(policy_key,revision) DO UPDATE SET active=TRUE,configuration_status='ready',updated_at=CURRENT_TIMESTAMP;

INSERT INTO eligibility_policy_requirements(policy_key,revision,evaluator_key,parameters,priority) VALUES
 ('normal_gate_release',2,'registration_state','{"allowed":["approved"]}',10),
 ('normal_gate_release',2,'management_release_authorization','{}',15),
 ('normal_gate_release',2,'customs_clearance','{"required_state":"cleared"}',20),
 ('normal_gate_release',2,'financial_clearance','{"maximum_outstanding":"0.00"}',30),
 ('normal_gate_release',2,'dispatch_approval','{}',40),
 ('normal_gate_release',2,'release_state','{"allowed":["not_released"]}',50),
 ('emergency_gate_release',2,'management_release_authorization','{}',5),
 ('emergency_gate_release',2,'emergency_authorization','{}',10),
 ('emergency_gate_release',2,'release_state','{"allowed":["not_released"]}',20)
ON CONFLICT DO NOTHING;

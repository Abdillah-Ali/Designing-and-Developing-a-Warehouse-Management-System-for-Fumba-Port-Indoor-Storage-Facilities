-- Gate-Out is automatically available once the required release conditions pass.
-- Dispatch authorization and warehouse placement are not Gate-Out requirements.
UPDATE eligibility_policies
SET active=FALSE,updated_at=CURRENT_TIMESTAMP
WHERE policy_key='normal_gate_release' AND active=TRUE;

INSERT INTO eligibility_policies(policy_key,revision,target,display_name,active,configuration_status,effective_from)
VALUES ('normal_gate_release',3,'normal_gate_release','Automatic Normal Gate Release',TRUE,'ready',CURRENT_TIMESTAMP)
ON CONFLICT(policy_key,revision) DO UPDATE
SET active=TRUE,configuration_status='ready',updated_at=CURRENT_TIMESTAMP;

INSERT INTO eligibility_policy_requirements(policy_key,revision,evaluator_key,parameters,priority) VALUES
 ('normal_gate_release',3,'registration_state','{"allowed":["approved"]}',10),
 ('normal_gate_release',3,'management_release_authorization','{}',20),
 ('normal_gate_release',3,'customs_clearance','{"required_state":"cleared"}',30),
 ('normal_gate_release',3,'financial_clearance','{"maximum_outstanding":"0.00"}',40),
 ('normal_gate_release',3,'release_state','{"allowed":["not_released"]}',50)
ON CONFLICT DO NOTHING;

-- Targeted Phase 1 UAT/SRS closure: Auditor, audit archive, and unallocated cargo.
INSERT INTO roles (role_name, role_description, public_reference, role_key, system_protected)
VALUES ('Auditor', 'Read-only access to audit history and management reports.', generate_role_public_reference(), 'auditor', TRUE)
ON CONFLICT (role_key) DO UPDATE
SET role_description = EXCLUDED.role_description,
    system_protected = TRUE;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
JOIN permissions p ON p.permission_key IN ('system.audit.view', 'management.dashboard.view', 'management.reports.view')
WHERE r.role_key = 'auditor'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS archived_audit_logs (
  id BIGINT PRIMARY KEY,
  user_id INTEGER,
  target_user_id INTEGER,
  role_id_at_action INTEGER,
  warehouse_id_at_action INTEGER,
  actor_reference VARCHAR(80),
  action VARCHAR(120) NOT NULL,
  module VARCHAR(120) NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL,
  archived_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archive_batch_reference VARCHAR(80) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_archived_audit_logs_created_at ON archived_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_archived_audit_logs_action_module ON archived_audit_logs(action, module);

CREATE OR REPLACE FUNCTION reject_archived_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Archived audit records are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS archived_audit_logs_immutable_update ON archived_audit_logs;
CREATE TRIGGER archived_audit_logs_immutable_update
BEFORE UPDATE OR DELETE ON archived_audit_logs
FOR EACH ROW EXECUTE FUNCTION reject_archived_audit_mutation();

INSERT INTO system_setting_definitions
  (setting_key, value_type, criticality, validation_schema, is_secret, description, is_active)
VALUES
  ('audit_retention_days', 'integer', 'critical_policy', '{"minimum":30,"maximum":3650}'::jsonb, FALSE,
   'Minimum number of days audit events remain in the active audit dataset before archive eligibility.', TRUE)
ON CONFLICT (setting_key) DO UPDATE
SET value_type = EXCLUDED.value_type,
    criticality = EXCLUDED.criticality,
    validation_schema = EXCLUDED.validation_schema,
    is_secret = FALSE,
    description = EXCLUDED.description,
    is_active = TRUE;

INSERT INTO system_settings (setting_key, setting_value, revision, validation_status, validated_at)
VALUES ('audit_retention_days', '30'::jsonb, 1, 'valid', CURRENT_TIMESTAMP)
ON CONFLICT (setting_key) DO NOTHING;

ALTER TABLE cargo
  ADD COLUMN IF NOT EXISTS storage_exception_key VARCHAR(80),
  ADD COLUMN IF NOT EXISTS storage_exception_reason TEXT,
  ADD COLUMN IF NOT EXISTS storage_exception_at TIMESTAMP;

ALTER TABLE cargo DROP CONSTRAINT IF EXISTS cargo_storage_exception_key_check;
ALTER TABLE cargo ADD CONSTRAINT cargo_storage_exception_key_check
  CHECK (storage_exception_key IS NULL OR storage_exception_key = 'unallocated_exception') NOT VALID;

CREATE INDEX IF NOT EXISTS idx_cargo_storage_exception
  ON cargo(storage_exception_key, storage_exception_at DESC)
  WHERE storage_exception_key IS NOT NULL AND is_deleted = FALSE;

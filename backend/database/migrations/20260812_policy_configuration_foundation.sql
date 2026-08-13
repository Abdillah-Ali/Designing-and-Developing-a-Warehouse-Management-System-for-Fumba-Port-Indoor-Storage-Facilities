CREATE TABLE IF NOT EXISTS system_setting_definitions (
  setting_key VARCHAR(120) PRIMARY KEY,
  value_type VARCHAR(30) NOT NULL,
  criticality VARCHAR(30) NOT NULL,
  validation_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_secret BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (value_type IN ('boolean', 'integer', 'decimal', 'string', 'json', 'duration_ms')),
  CHECK (criticality IN ('technical', 'operational', 'critical_policy')),
  CHECK (jsonb_typeof(validation_schema) = 'object')
);

ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS validation_status VARCHAR(20) NOT NULL DEFAULT 'unvalidated',
  ADD COLUMN IF NOT EXISTS validated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS validation_error TEXT;

ALTER TABLE system_settings DROP CONSTRAINT IF EXISTS system_settings_revision_check;
ALTER TABLE system_settings
  ADD CONSTRAINT system_settings_revision_check CHECK (revision >= 1) NOT VALID;

ALTER TABLE system_settings DROP CONSTRAINT IF EXISTS system_settings_validation_status_check;
ALTER TABLE system_settings
  ADD CONSTRAINT system_settings_validation_status_check
  CHECK (validation_status IN ('unvalidated', 'valid', 'invalid')) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_system_setting_definitions_active_criticality
  ON system_setting_definitions(is_active, criticality);

CREATE INDEX IF NOT EXISTS idx_system_settings_validation_status
  ON system_settings(validation_status);

INSERT INTO system_setting_definitions
  (setting_key, value_type, criticality, validation_schema, is_secret, description)
VALUES
  ('maximum_active_system_administrators', 'integer', 'critical_policy',
    '{"minimum":1}'::jsonb, FALSE,
    'Maximum number of active System Administrator accounts.'),
  ('manual_placement_enabled', 'boolean', 'operational',
    '{}'::jsonb, FALSE,
    'Controls whether authorized users may use manual cargo placement.'),
  ('cargo_pending_review_escalation_enabled', 'boolean', 'operational',
    '{}'::jsonb, FALSE,
    'Controls pending cargo review escalation notifications.'),
  ('cargo_pending_review_escalation_hours', 'decimal', 'operational',
    '{"exclusiveMinimum":0}'::jsonb, FALSE,
    'Hours before a pending cargo review is escalated.'),
  ('cargo_pending_review_escalation_interval_ms', 'duration_ms', 'operational',
    '{"minimum":60000}'::jsonb, FALSE,
    'Interval in milliseconds for the pending review escalation scheduler.'),
  ('cargo_pending_review_escalation_target_role', 'string', 'operational',
    '{"minLength":1,"maxLength":120}'::jsonb, FALSE,
    'Role receiving pending cargo review escalations.'),
  ('cargo_pending_review_escalation_repeat_hours', 'decimal', 'operational',
    '{"minimum":0}'::jsonb, FALSE,
    'Minimum hours before repeating a pending review escalation.')
ON CONFLICT (setting_key) DO UPDATE
SET value_type = EXCLUDED.value_type,
    criticality = EXCLUDED.criticality,
    validation_schema = EXCLUDED.validation_schema,
    is_secret = EXCLUDED.is_secret,
    description = EXCLUDED.description,
    is_active = TRUE,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO permissions (permission_key, description, module, system_protected)
VALUES
  ('system.configuration.view', 'View system configuration readiness and validation metadata.', 'system', TRUE),
  ('system.configuration.manage', 'Validate and update registered system configuration.', 'system', TRUE)
ON CONFLICT (permission_key) DO UPDATE
SET description = EXCLUDED.description,
    module = EXCLUDED.module,
    system_protected = EXCLUDED.system_protected;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'System Admin'
  AND p.permission_key IN ('system.configuration.view', 'system.configuration.manage')
ON CONFLICT DO NOTHING;

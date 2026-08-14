ALTER TABLE scanner_sessions
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMP;

UPDATE scanner_sessions
SET last_activity_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP),
    expires_at = COALESCE(expires_at, COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) + INTERVAL '20 minutes')
WHERE status = 'active';

UPDATE scanner_sessions
SET status = 'expired', expired_at = CURRENT_TIMESTAMP
WHERE status = 'active' AND expires_at <= CURRENT_TIMESTAMP;

ALTER TABLE scanner_sessions DROP CONSTRAINT IF EXISTS scanner_sessions_status_check;
ALTER TABLE scanner_sessions DROP CONSTRAINT IF EXISTS scanner_sessions_status_check1;
ALTER TABLE scanner_sessions
  ADD CONSTRAINT scanner_sessions_status_check
  CHECK (status IN ('active', 'completed', 'cancelled', 'expired'));

ALTER TABLE scanner_sessions DROP CONSTRAINT IF EXISTS scanner_sessions_active_expiry_check;
ALTER TABLE scanner_sessions
  ADD CONSTRAINT scanner_sessions_active_expiry_check
  CHECK (status <> 'active' OR expires_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_scanner_sessions_active_expiry
  ON scanner_sessions(expires_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS scanner_scan_attempts (
  id BIGSERIAL PRIMARY KEY,
  scanner_session_id INTEGER NOT NULL REFERENCES scanner_sessions(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  normalized_reference VARCHAR(255) NOT NULL,
  outcome VARCHAR(30) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (step_index >= 0),
  CHECK (outcome IN ('accepted', 'rejected', 'duplicate'))
);

CREATE INDEX IF NOT EXISTS idx_scanner_scan_attempts_duplicate_lookup
  ON scanner_scan_attempts(scanner_session_id, step_index, normalized_reference, created_at DESC);

INSERT INTO system_setting_definitions
  (setting_key, value_type, criticality, validation_schema, is_secret, description)
VALUES
  ('scanner_session_timeout_minutes', 'integer', 'critical_policy',
   '{"minimum":1,"maximum":480}'::jsonb, FALSE,
   'Sliding inactivity timeout in minutes for operational scanner workflow sessions.'),
  ('scanner_duplicate_scan_window_ms', 'duration_ms', 'critical_policy',
   '{"minimum":1,"maximum":60000}'::jsonb, FALSE,
   'Server-authoritative duplicate scanner input suppression window.'),
  ('scanner_session_cleanup_interval_ms', 'duration_ms', 'critical_policy',
   '{"minimum":1000,"maximum":3600000}'::jsonb, FALSE,
   'Interval for hygienic expiry of inactive scanner workflow sessions.')
ON CONFLICT (setting_key) DO UPDATE
SET value_type = EXCLUDED.value_type,
    criticality = EXCLUDED.criticality,
    validation_schema = EXCLUDED.validation_schema,
    is_secret = EXCLUDED.is_secret,
    description = EXCLUDED.description,
    is_active = TRUE,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO system_settings
  (setting_key, setting_value, revision, validation_status, validated_at)
VALUES
  ('scanner_session_timeout_minutes', '20'::jsonb, 1, 'valid', CURRENT_TIMESTAMP),
  ('scanner_duplicate_scan_window_ms', '3000'::jsonb, 1, 'valid', CURRENT_TIMESTAMP),
  ('scanner_session_cleanup_interval_ms', '60000'::jsonb, 1, 'valid', CURRENT_TIMESTAMP)
ON CONFLICT (setting_key) DO NOTHING;

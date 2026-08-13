ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS public_reference VARCHAR(80),
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revocation_reason VARCHAR(180),
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;

UPDATE user_sessions
SET public_reference = 'SES-' || UPPER(ENCODE(GEN_RANDOM_BYTES(12), 'hex'))
WHERE public_reference IS NULL;

ALTER TABLE user_sessions ALTER COLUMN public_reference SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_public_reference ON user_sessions(public_reference);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active_expiry ON user_sessions(expires_at) WHERE session_status = 'active';

CREATE TABLE IF NOT EXISTS session_refresh_tokens (
  id BIGSERIAL PRIMARY KEY,
  public_reference VARCHAR(80) NOT NULL DEFAULT ('RFT-' || UPPER(ENCODE(GEN_RANDOM_BYTES(12), 'hex'))),
  session_id INTEGER NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
  token_family_id UUID NOT NULL DEFAULT GEN_RANDOM_UUID(),
  token_hash VARCHAR(64) NOT NULL,
  parent_token_id BIGINT REFERENCES session_refresh_tokens(id) ON DELETE SET NULL,
  issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  revoked_at TIMESTAMP,
  revocation_reason VARCHAR(180),
  replaced_by_token_id BIGINT REFERENCES session_refresh_tokens(id) ON DELETE SET NULL,
  created_ip VARCHAR(80),
  last_used_ip VARCHAR(80),
  user_agent_hash VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT session_refresh_tokens_public_reference_key UNIQUE (public_reference),
  CONSTRAINT session_refresh_tokens_token_hash_key UNIQUE (token_hash),
  CONSTRAINT session_refresh_tokens_expiry_check CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session_active
  ON session_refresh_tokens(session_id, revoked_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_issued
  ON session_refresh_tokens(token_family_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expiry ON session_refresh_tokens(expires_at);

INSERT INTO system_setting_definitions
  (setting_key, value_type, criticality, validation_schema, is_secret, description)
VALUES
  ('auth_access_token_lifetime_ms', 'duration_ms', 'critical_policy',
   '{"minimum":60000,"maximum":3600000}'::jsonb, FALSE, 'Lifetime of API access tokens in milliseconds.'),
  ('auth_refresh_token_lifetime_ms', 'duration_ms', 'critical_policy',
   '{"minimum":3600000,"maximum":7776000000}'::jsonb, FALSE, 'Lifetime of rotating refresh credentials in milliseconds.'),
  ('auth_session_lifetime_ms', 'duration_ms', 'critical_policy',
   '{"minimum":3600000,"maximum":7776000000}'::jsonb, FALSE, 'Maximum lifetime of a persistent authenticated session in milliseconds.')
ON CONFLICT (setting_key) DO UPDATE SET
  value_type = EXCLUDED.value_type,
  criticality = EXCLUDED.criticality,
  validation_schema = EXCLUDED.validation_schema,
  is_secret = EXCLUDED.is_secret,
  description = EXCLUDED.description,
  is_active = TRUE,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO system_settings
  (setting_key, setting_value, revision, validation_status, validated_at)
VALUES
  ('auth_access_token_lifetime_ms', '900000'::jsonb, 1, 'valid', CURRENT_TIMESTAMP),
  ('auth_refresh_token_lifetime_ms', '2592000000'::jsonb, 1, 'valid', CURRENT_TIMESTAMP),
  ('auth_session_lifetime_ms', '2592000000'::jsonb, 1, 'valid', CURRENT_TIMESTAMP)
ON CONFLICT (setting_key) DO NOTHING;

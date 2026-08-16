CREATE TABLE IF NOT EXISTS api_rate_limits (
  scope VARCHAR(80) NOT NULL,
  key_hash CHAR(64) NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, key_hash)
);

CREATE INDEX IF NOT EXISTS idx_api_rate_limits_expiry ON api_rate_limits(expires_at);

DELETE FROM api_rate_limits WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day';

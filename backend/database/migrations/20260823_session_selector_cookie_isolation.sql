UPDATE user_sessions
SET session_status = 'closed',
    logout_time = COALESCE(logout_time, CURRENT_TIMESTAMP),
    revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
    revocation_reason = COALESCE(revocation_reason, 'session selector security upgrade')
WHERE session_status = 'active';

UPDATE session_refresh_tokens
SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
    revocation_reason = COALESCE(revocation_reason, 'session selector security upgrade')
WHERE revoked_at IS NULL
  AND session_id IN (
    SELECT id
    FROM user_sessions
    WHERE revocation_reason = 'session selector security upgrade'
  );

CREATE OR REPLACE FUNCTION generate_user_public_reference()
RETURNS VARCHAR AS $$
DECLARE
  generated_reference VARCHAR;
BEGIN
  LOOP
    generated_reference := 'USR-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' ||
      UPPER(ENCODE(GEN_RANDOM_BYTES(6), 'hex'));
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM users WHERE public_reference = generated_reference
    );
  END LOOP;
  RETURN generated_reference;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS public_reference VARCHAR(80);

ALTER TABLE users
  ALTER COLUMN public_reference SET DEFAULT generate_user_public_reference();

UPDATE users
SET public_reference = generate_user_public_reference()
WHERE public_reference IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_public_reference_key
  ON users(public_reference);

ALTER TABLE users
  ALTER COLUMN public_reference SET NOT NULL;

-- Bootstrap-era flags no longer confer protection or privileges. Authorization
-- is determined by the assigned role and permissions.
UPDATE users
SET is_system_user = FALSE,
    is_bootstrap_admin = FALSE,
    bootstrap_completed = FALSE
WHERE is_system_user = TRUE
   OR is_bootstrap_admin = TRUE
   OR bootstrap_completed = TRUE;

CREATE TABLE IF NOT EXISTS installation_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  initial_setup_completed BOOLEAN NOT NULL DEFAULT FALSE,
  initialized_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  initialized_at TIMESTAMP,
  CHECK (
    (initial_setup_completed = FALSE AND initialized_by_user_id IS NULL AND initialized_at IS NULL)
    OR
    (initial_setup_completed = TRUE AND initialized_by_user_id IS NOT NULL AND initialized_at IS NOT NULL)
  )
);

INSERT INTO installation_state (singleton, initial_setup_completed)
VALUES (TRUE, FALSE)
ON CONFLICT (singleton) DO NOTHING;

-- Preserve initialized installations upgraded from an earlier setup flow.
UPDATE installation_state state
SET initial_setup_completed = TRUE,
    initialized_by_user_id = administrator.id,
    initialized_at = COALESCE(administrator.created_at, CURRENT_TIMESTAMP)
FROM (
  SELECT u.id, u.created_at
  FROM users u
  JOIN roles r ON r.id = u.role_id
  WHERE r.role_name = 'System Admin'
  ORDER BY u.created_at, u.id
  LIMIT 1
) administrator
WHERE state.singleton = TRUE
  AND state.initial_setup_completed = FALSE;

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_reference VARCHAR(80);


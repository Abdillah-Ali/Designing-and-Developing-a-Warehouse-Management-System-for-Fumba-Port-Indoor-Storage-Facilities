CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION generate_role_public_reference()
RETURNS VARCHAR(80) AS $$
DECLARE
  generated_reference VARCHAR(80);
BEGIN
  LOOP
    generated_reference := 'ROLE-' || EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER || '-' || UPPER(ENCODE(gen_random_bytes(6), 'hex'));

    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM roles
      WHERE public_reference = generated_reference
    );
  END LOOP;

  RETURN generated_reference;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS public_reference VARCHAR(80);

ALTER TABLE roles
  ALTER COLUMN public_reference SET DEFAULT generate_role_public_reference();

DO $$
DECLARE
  role_record RECORD;
BEGIN
  FOR role_record IN
    SELECT role_name
    FROM roles
    WHERE public_reference IS NULL
    ORDER BY role_name
  LOOP
    UPDATE roles
    SET public_reference = generate_role_public_reference()
    WHERE role_name = role_record.role_name
      AND public_reference IS NULL;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM roles WHERE public_reference IS NULL) THEN
    RAISE EXCEPTION 'Role public reference backfill failed: NULL values remain.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM roles
    WHERE public_reference IS NOT NULL
    GROUP BY public_reference
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Role public reference backfill failed: duplicate values remain.';
  END IF;

  IF to_regclass('public.roles_public_reference_key') IS NULL THEN
    CREATE UNIQUE INDEX roles_public_reference_key
      ON roles(public_reference);
  END IF;

  ALTER TABLE roles ALTER COLUMN public_reference SET NOT NULL;
END;
$$;

ALTER TABLE permissions
  ADD COLUMN IF NOT EXISTS module VARCHAR(80),
  ADD COLUMN IF NOT EXISTS system_protected BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO permissions (permission_key, description, module, system_protected)
VALUES
  ('*', 'Full system access.', 'system', TRUE),
  ('system.dashboard.view', 'View system administration dashboard.', 'system', TRUE),
  ('system.users.view', 'View users.', 'system', TRUE),
  ('system.users.manage', 'Create, update, deactivate, and reassign users.', 'system', TRUE),
  ('system.roles.view', 'View roles.', 'system', TRUE),
  ('system.permissions.view', 'View permission assignments.', 'system', TRUE),
  ('system.permissions.manage', 'Update configurable role permission assignments.', 'system', TRUE),
  ('system.audit.view', 'View audit logs.', 'system', TRUE),
  ('system.sessions.view', 'View user sessions.', 'system', TRUE),
  ('system.notifications.announce', 'Send system announcements.', 'system', TRUE),
  ('system.notifications.configure', 'Configure notification escalation settings.', 'system', TRUE),
  ('warehouse.configuration.view', 'View warehouse configuration.', 'warehouse', TRUE),
  ('warehouse.configuration.manage', 'Create and update warehouse configuration.', 'warehouse', TRUE),
  ('warehouse.shifts.view', 'View shift configuration.', 'warehouse', TRUE),
  ('warehouse.shifts.manage', 'Create, update, activate, deactivate, and assign shifts.', 'warehouse', TRUE),
  ('placement.failures.view', 'View placement validation failures.', 'placement', FALSE),
  ('supervisor.monitoring.view', 'View supervisor operational monitoring.', 'supervisor', FALSE),
  ('notifications.view', 'View notifications.', 'notifications', TRUE),
  ('notifications.manage', 'Read, archive, restore, and resolve notifications.', 'notifications', TRUE)
ON CONFLICT (permission_key) DO UPDATE
SET description = EXCLUDED.description,
    module = EXCLUDED.module,
    system_protected = EXCLUDED.system_protected;

UPDATE permissions
SET module = COALESCE(module, split_part(permission_key, '.', 1), 'system')
WHERE module IS NULL;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
JOIN permissions p ON p.permission_key = '*'
WHERE r.role_name = 'System Admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
JOIN permissions p ON p.permission_key = ANY(ARRAY[
  'notifications.view',
  'notifications.manage'
])
WHERE r.role_name IN ('Warehouse Staff', 'Supervisor', 'Finance Officer', 'Customs Officer', 'Gate Officer')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
JOIN permissions p ON p.permission_key = ANY(ARRAY[
  'placement.failures.view',
  'supervisor.monitoring.view'
])
WHERE r.role_name IN ('Supervisor', 'System Admin')
ON CONFLICT DO NOTHING;

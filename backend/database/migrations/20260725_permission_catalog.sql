ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS public_reference VARCHAR(80);

UPDATE roles
SET public_reference = 'ROLE-' || UPPER(REGEXP_REPLACE(role_name, '[^A-Za-z0-9]+', '-', 'g'))
WHERE public_reference IS NULL;

ALTER TABLE roles ALTER COLUMN public_reference SET NOT NULL;
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_public_reference_key;
ALTER TABLE roles ADD CONSTRAINT roles_public_reference_key UNIQUE (public_reference);

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

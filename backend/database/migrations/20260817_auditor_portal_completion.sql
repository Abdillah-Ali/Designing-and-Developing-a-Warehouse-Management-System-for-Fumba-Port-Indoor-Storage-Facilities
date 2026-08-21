-- Complete the existing Auditor role with the least-privilege read permissions
-- needed by its portal. Operational mutation permissions are intentionally absent.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
JOIN permissions p ON p.permission_key IN (
  'system.audit.view',
  'management.dashboard.view',
  'management.reports.view',
  'cargo.view',
  'notifications.view',
  'notifications.manage'
)
WHERE r.role_key = 'auditor'
ON CONFLICT DO NOTHING;

-- Management can inspect cargo traceability, but retains no operational cargo
-- mutation permissions. This supports the read-only oversight route.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
JOIN permissions p ON p.permission_key = 'cargo.view'
WHERE r.role_key = 'management'
ON CONFLICT DO NOTHING;

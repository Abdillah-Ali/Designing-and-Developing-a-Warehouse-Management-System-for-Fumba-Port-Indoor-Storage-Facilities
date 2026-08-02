INSERT INTO permissions (permission_key, description, module, system_protected)
VALUES
  ('management.dashboard.view', 'View read-only executive KPIs.', 'management', TRUE),
  ('management.reports.view', 'View read-only executive reports and analytics.', 'management', TRUE)
ON CONFLICT (permission_key) DO UPDATE
SET description = EXCLUDED.description,
    module = EXCLUDED.module,
    system_protected = EXCLUDED.system_protected;

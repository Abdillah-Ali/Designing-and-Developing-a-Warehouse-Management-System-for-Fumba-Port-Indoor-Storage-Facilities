DELETE FROM role_permissions rp USING roles r
WHERE rp.role_id=r.id AND r.role_key='system_administrator' AND rp.permission_key='*';

INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.permission_key FROM roles r CROSS JOIN permissions p
WHERE r.role_key='system_administrator' AND p.permission_key IN (
  'system.dashboard.view','system.users.view','system.users.manage','system.roles.view',
  'system.permissions.view','system.permissions.manage','system.audit.view','system.sessions.view',
  'system.notifications.announce','system.notifications.configure','system.configuration.view','system.configuration.manage',
  'system.cargo_registration_form.view','system.cargo_registration_form.manage',
  'warehouse.configuration.view','warehouse.configuration.manage','warehouse.shifts.view','warehouse.shifts.manage',
  'warehouse.hierarchy.view','warehouse.hierarchy.manage','warehouse.labels.print',
  'cargo.view','cargo.documents.manage','cargo.approve','cargo.registration_metadata.view',
  'placement.logs.view','placement.failures.view','placement.activity.view','placement.settings.view','placement.settings.manage',
  'supervisor.dashboard.view','supervisor.approvals.view','supervisor.monitoring.view',
  'dispatch.requests.view','bin_rules.view','bin_rules.manage',
  'finance.dashboard.view','finance.charges.view','finance.invoices.create','finance.invoices.issue','finance.invoices.view',
  'finance.invoices.cancel','finance.payments.record','finance.payments.confirm','finance.reports.view',
  'finance.tariffs.view','finance.tariffs.create','finance.tariffs.update','finance.tariffs.activate',
  'customs.dashboard.view','customs.cargo.view','customs.inspections.create','customs.inspections.update','customs.clearance.update','customs.history.view',
  'gate.dashboard.view','gate.release_queue.view','gate.release.validate','gate.gate_out.confirm',
  'gate.emergency_release.request','gate.emergency_release.approve','gate.history.view',
  'notifications.view','notifications.manage'
) ON CONFLICT DO NOTHING;

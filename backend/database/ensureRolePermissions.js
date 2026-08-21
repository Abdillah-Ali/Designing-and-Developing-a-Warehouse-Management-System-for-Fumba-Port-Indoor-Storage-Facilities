const ensureStandardRolePermissions = async (client) => {
  const query = `
    INSERT INTO role_permissions (role_id, permission_key)
    SELECT r.id, p.permission_key
    FROM roles r
    CROSS JOIN permissions p
    WHERE
      (r.role_key = 'warehouse_staff' AND p.permission_key IN (
        'cargo.view', 'cargo.register', 'cargo.edit', 'cargo.documents.manage',
        'cargo.barcode.print', 'cargo.resubmit', 'cargo.registration_metadata.view',
        'warehouse.hierarchy.view', 'warehouse.labels.print', 'placement.activity.view',
        'placement.settings.view', 'placement.validate', 'placement.confirm',
        'placement.override.request', 'dispatch.requests.view', 'dispatch.requests.create',
        'notifications.view', 'notifications.manage', 'management_release.view'
      )) OR
      (r.role_key = 'warehouse_supervisor' AND p.permission_key IN (
        'cargo.view', 'cargo.documents.manage', 'cargo.registration_metadata.view',
        'cargo.approve', 'warehouse.hierarchy.view', 'warehouse.labels.print',
        'placement.activity.view', 'placement.failures.view', 'placement.settings.view',
        'placement.settings.manage', 'supervisor.dashboard.view', 'supervisor.approvals.view',
        'supervisor.monitoring.view', 'dispatch.requests.view', 'dispatch.requests.decide',
        'gate.history.view', 'gate.emergency_release.approve', 'notifications.view',
        'notifications.manage', 'management_release.view', 'management_release.request'
      )) OR
      (r.role_key = 'finance_officer' AND ((p.permission_key LIKE 'finance.%' AND p.permission_key NOT IN ('finance.invoices.create', 'finance.invoices.issue', 'finance.payments.confirm')) OR p.permission_key IN ('cargo.registration_metadata.view', 'notifications.view', 'notifications.manage'))) OR
      (r.role_key = 'customs_officer' AND (p.permission_key LIKE 'customs.%' OR p.permission_key IN ('cargo.registration_metadata.view', 'notifications.view', 'notifications.manage'))) OR
      (r.role_key = 'gate_officer' AND (p.permission_key LIKE 'gate.%' OR p.permission_key IN ('cargo.registration_metadata.view', 'notifications.view', 'notifications.manage'))) OR
      (r.role_key = 'management' AND p.permission_key IN ('management.dashboard.view', 'management.reports.view', 'cargo.registration_metadata.view', 'notifications.view', 'notifications.manage', 'management_release.view', 'management_release.decide')) OR
      (r.role_key = 'auditor' AND p.permission_key IN ('system.audit.view', 'cargo.view', 'cargo.registration_metadata.view', 'placement.activity.view', 'placement.logs.view', 'notifications.view', 'notifications.manage'))
    ON CONFLICT DO NOTHING;
  `;
  await client.query(query);
};

module.exports = { ensureStandardRolePermissions };

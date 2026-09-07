// Assignment limits reflect the duties supported by each built-in portal.
// A permission still has to be assigned before it authorizes an action.
const common = ['cargo.registration_metadata.view', 'notifications.view', 'notifications.manage'];
const policies = {
  warehouse_staff: [...common, 'cargo.view', 'cargo.register', 'cargo.edit', 'cargo.documents.manage',
    'cargo.barcode.print', 'cargo.resubmit', 'warehouse.hierarchy.view', 'warehouse.labels.print',
    'placement.activity.view', 'placement.settings.view', 'placement.validate', 'placement.confirm',
    'placement.override.request', 'dispatch.requests.view', 'dispatch.requests.create',
    'management_release.view', 'staff.release_queue.view'],
  warehouse_supervisor: [...common, 'cargo.view', 'cargo.documents.manage', 'cargo.approve',
    'warehouse.hierarchy.view', 'warehouse.labels.print', 'placement.activity.view',
    'placement.failures.view', 'placement.settings.view', 'placement.settings.manage',
    'supervisor.dashboard.view', 'supervisor.approvals.view', 'supervisor.monitoring.view',
    'dispatch.requests.view', 'dispatch.requests.decide', 'gate.history.view',
    'gate.emergency_release.approve', 'management_release.view', 'management_release.request'],
  finance_officer: [...common, 'finance.dashboard.view', 'finance.charges.view', 'finance.invoices.view',
    'finance.payments.record', 'finance.payments.initiate', 'finance.reports.view',
    'finance.tariffs.view', 'finance.tariffs.create', 'finance.tariffs.update',
    'finance.tariffs.activate', 'finance.tariffs.submit', 'management_release.view'],
  customs_officer: [...common, 'customs.dashboard.view', 'customs.cargo.view', 'customs.history.view',
    'customs.inspections.create', 'customs.inspections.update', 'customs.clearance.update'],
  gate_officer: [...common, 'gate.dashboard.view', 'gate.release_queue.view', 'gate.release.validate',
    'gate.gate_out.confirm', 'gate.history.view', 'gate.emergency_release.request', 'management_release.view'],
  management: [...common, 'cargo.view', 'management.dashboard.view', 'management.reports.view',
    'management.tariffs.view', 'management.tariffs.decide', 'management_release.view', 'management_release.decide'],
  auditor: [...common, 'cargo.view', 'system.audit.view', 'management.dashboard.view',
    'management.reports.view', 'placement.activity.view', 'placement.logs.view'],
  scanner: [],
};

const isRolePermissionAllowed = (roleKey, permissionKey) => {
  if (permissionKey === '*') return false;
  // Custom roles have no built-in duty template; retain their existing configurability.
  if (roleKey?.startsWith('custom_')) return true;
  // Administrator overrides are retained, but staff-only execution is unavailable.
  if (roleKey === 'system_administrator') {
    return !['cargo.register', 'cargo.edit', 'cargo.resubmit', 'placement.validate',
      'placement.confirm', 'placement.override.request', 'dispatch.requests.create',
      'staff.release_queue.view'].includes(permissionKey);
  }
  return policies[roleKey]?.includes(permissionKey) ?? false;
};

module.exports = { isRolePermissionAllowed };

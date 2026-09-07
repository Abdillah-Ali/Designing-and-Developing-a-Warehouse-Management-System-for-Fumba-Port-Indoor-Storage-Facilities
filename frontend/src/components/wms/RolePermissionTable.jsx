import { DataTable, StatusBadge } from "./OperationalUi";

export function RolePermissionTable({ permissions, allowedKeys, assigned, loading, error, disabled, onToggle }) {
  return <DataTable
    loading={loading && !error}
    error={error}
    rows={permissions.filter((row) => allowedKeys.includes(row.permission_key))}
    emptyTitle="No configurable permissions for this role"
    columns={[
      { key: "module", label: "Module", className: "font-semibold" },
      { key: "permission_key", label: "Permission", className: "font-mono" },
      { key: "description", label: "Description" },
      { key: "system_protected", label: "Protected", render: (row) => row.system_protected ? <StatusBadge tone="warning">Protected</StatusBadge> : <StatusBadge tone="muted">Configurable</StatusBadge> },
      { key: "assigned", label: "Assigned", render: (row) => <input
        type="checkbox"
        checked={assigned.includes(row.permission_key)}
        disabled={disabled || loading || (row.system_protected && assigned.includes(row.permission_key))}
        onChange={() => onToggle(row.permission_key)}
        aria-label={`Toggle ${row.permission_key}`}
      /> },
    ]}
  />;
}

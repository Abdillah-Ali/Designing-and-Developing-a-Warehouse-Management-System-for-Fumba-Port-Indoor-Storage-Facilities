ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS role_key VARCHAR(80),
  ADD COLUMN IF NOT EXISTS system_protected BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE roles SET role_key = CASE role_name
  WHEN 'System Admin' THEN 'system_administrator'
  WHEN 'Warehouse Staff' THEN 'warehouse_staff'
  WHEN 'Supervisor' THEN 'warehouse_supervisor'
  WHEN 'Finance Officer' THEN 'finance_officer'
  WHEN 'Customs Officer' THEN 'customs_officer'
  WHEN 'Gate Officer' THEN 'gate_officer'
  WHEN 'Management' THEN 'management'
  WHEN 'Scanner' THEN 'scanner'
  ELSE 'custom_' || LOWER(REGEXP_REPLACE(public_reference, '[^a-zA-Z0-9]+', '_', 'g'))
END WHERE role_key IS NULL;

UPDATE roles SET system_protected = TRUE
WHERE role_key IN ('system_administrator','warehouse_staff','warehouse_supervisor','finance_officer','customs_officer','gate_officer','management','scanner');

ALTER TABLE roles ALTER COLUMN role_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS roles_role_key_key ON roles(role_key);

INSERT INTO permissions(permission_key,description,module,system_protected) VALUES
('cargo.view','View cargo records allowed by warehouse and ownership scope.','cargo',FALSE),
('cargo.register','Register cargo.','cargo',FALSE),
('cargo.edit','Edit permitted cargo records.','cargo',FALSE),
('cargo.documents.manage','Upload and read cargo documents.','cargo',FALSE),
('cargo.barcode.print','Print cargo barcodes.','cargo',FALSE),
('cargo.resubmit','Resubmit cargo corrections.','cargo',FALSE),
('cargo.approve','Approve, reject, or request correction for cargo.','cargo',FALSE),
('cargo.registration_metadata.view','View published cargo registration metadata.','cargo',FALSE),
('warehouse.hierarchy.view','View warehouse storage hierarchy.','warehouse',FALSE),
('warehouse.hierarchy.manage','Manage warehouse storage hierarchy.','warehouse',TRUE),
('warehouse.labels.print','Print bin labels.','warehouse',FALSE),
('placement.activity.view','View placement activity allowed by scope.','placement',FALSE),
('placement.logs.view','View system placement logs.','placement',TRUE),
('placement.settings.view','View placement settings.','placement',TRUE),
('placement.settings.manage','Manage placement settings.','placement',TRUE),
('placement.validate','Validate cargo placement.','placement',FALSE),
('placement.confirm','Confirm cargo placement.','placement',FALSE),
('placement.override.request','Request a placement override.','placement',FALSE),
('supervisor.dashboard.view','View supervisor dashboard and review history.','supervisor',FALSE),
('supervisor.approvals.view','View cargo approval requests.','supervisor',FALSE),
('dispatch.requests.view','View dispatch authorization requests.','dispatch',FALSE),
('dispatch.requests.create','Request dispatch authorization.','dispatch',FALSE),
('dispatch.requests.decide','Approve or reject dispatch authorization.','dispatch',FALSE),
('bin_rules.view','View Bin Rules configuration.','bin_rules',FALSE),
('bin_rules.manage','Manage Bin Rules configuration.','bin_rules',FALSE),
('notifications.announce','Send system announcements.','notifications',TRUE)
ON CONFLICT(permission_key) DO UPDATE SET description=EXCLUDED.description,module=EXCLUDED.module,system_protected=EXCLUDED.system_protected;

INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.permission_key FROM roles r CROSS JOIN permissions p
WHERE
 (r.role_key='warehouse_staff' AND p.permission_key IN ('cargo.view','cargo.register','cargo.edit','cargo.documents.manage','cargo.barcode.print','cargo.resubmit','warehouse.hierarchy.view','warehouse.labels.print','placement.activity.view','placement.settings.view','placement.validate','placement.confirm','placement.override.request','dispatch.requests.view','dispatch.requests.create')) OR
 (r.role_key='warehouse_supervisor' AND p.permission_key IN ('cargo.view','cargo.documents.manage','warehouse.hierarchy.view','warehouse.labels.print','placement.activity.view','placement.failures.view','placement.settings.view','placement.settings.manage','supervisor.dashboard.view','supervisor.approvals.view','supervisor.monitoring.view','cargo.approve','dispatch.requests.view','dispatch.requests.decide','gate.history.view','gate.emergency_release.approve')) OR
 (r.role_key='system_administrator' AND p.permission_key='*') OR
 (r.role_key='finance_officer' AND p.permission_key LIKE 'finance.%') OR
 (r.role_key='customs_officer' AND p.permission_key LIKE 'customs.%') OR
 (r.role_key='gate_officer' AND p.permission_key LIKE 'gate.%') OR
 (r.role_key='management' AND p.permission_key IN ('management.dashboard.view','management.reports.view')) OR
 (r.role_key <> 'scanner' AND p.permission_key='cargo.registration_metadata.view') OR
 (r.role_key IN ('warehouse_staff','warehouse_supervisor','finance_officer','customs_officer','gate_officer','management') AND p.permission_key IN ('notifications.view','notifications.manage'))
ON CONFLICT DO NOTHING;

DELETE FROM role_permissions rp USING roles r
WHERE rp.role_id=r.id AND r.role_key='finance_officer' AND rp.permission_key LIKE 'customs.%';

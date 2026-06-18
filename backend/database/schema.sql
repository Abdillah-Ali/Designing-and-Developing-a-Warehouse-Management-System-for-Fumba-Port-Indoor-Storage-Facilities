-- Run this file while connected to the fumbaport_wms database.
-- Use `npm run init-db` for normal setup so environment-configured roles and
-- shifts are seeded after this structural schema is applied.

CREATE SEQUENCE IF NOT EXISTS cargo_number_seq START 1;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  role_name VARCHAR(80) UNIQUE NOT NULL,
  role_description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS warehouses (
  id SERIAL PRIMARY KEY,
  warehouse_name VARCHAR(120) NOT NULL,
  warehouse_code VARCHAR(30) UNIQUE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE IF NOT EXISTS shifts (
  id SERIAL PRIMARY KEY,
  shift_name VARCHAR(80) UNIQUE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  username VARCHAR(80) UNIQUE NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  phone_number VARCHAR(40) NOT NULL,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  warehouse_id INTEGER REFERENCES warehouses(id),
  shift_id INTEGER REFERENCES shifts(id),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  is_system_user BOOLEAN NOT NULL DEFAULT FALSE,
  is_bootstrap_admin BOOLEAN NOT NULL DEFAULT FALSE,
  bootstrap_completed BOOLEAN NOT NULL DEFAULT FALSE,
  last_login TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('active', 'inactive', 'suspended'))
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS is_system_user BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_bootstrap_admin BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bootstrap_completed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  login_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  logout_time TIMESTAMP,
  session_status VARCHAR(30) NOT NULL DEFAULT 'active',
  ip_address VARCHAR(80),
  CHECK (session_status IN ('active', 'closed', 'expired'))
);

-- Older tokens do not contain the password-change claim. Close those sessions
-- so affected users sign in again and enter the enforced password-change flow.
UPDATE user_sessions us
SET logout_time = CURRENT_TIMESTAMP,
    session_status = 'closed'
FROM users u
WHERE u.id = us.user_id
  AND u.must_change_password = TRUE
  AND us.session_status = 'active';

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  role_id_at_action INTEGER REFERENCES roles(id) ON DELETE SET NULL,
  warehouse_id_at_action INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(120) NOT NULL,
  module VARCHAR(120) NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS role_id_at_action INTEGER REFERENCES roles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS warehouse_id_at_action INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(120) PRIMARY KEY,
  setting_value JSONB NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_settings (setting_key, setting_value)
VALUES ('manual_placement_enabled', 'false'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;



CREATE TABLE IF NOT EXISTS zones (
  id SERIAL PRIMARY KEY,
  code VARCHAR(10) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  zone_type VARCHAR(80) NOT NULL DEFAULT 'Standard',
  allowed_cargo_type VARCHAR(100) NOT NULL,
  is_hazard_zone BOOLEAN NOT NULL DEFAULT FALSE,
  max_weight NUMERIC(14, 2) NOT NULL DEFAULT 0,
  max_volume NUMERIC(14, 2) NOT NULL DEFAULT 0,
  rack_count INTEGER NOT NULL DEFAULT 1,
  level_count INTEGER NOT NULL DEFAULT 1,
  bins_per_level INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'Active',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('Active', 'Inactive'))
);

CREATE TABLE IF NOT EXISTS racks (
  id SERIAL PRIMARY KEY,
  zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(100),
  max_weight NUMERIC(12, 2) NOT NULL DEFAULT 10000,
  max_volume NUMERIC(12, 2) NOT NULL DEFAULT 80,
  status VARCHAR(20) NOT NULL DEFAULT 'Active',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (zone_id, code),
  CHECK (status IN ('Active', 'Inactive'))
);

CREATE TABLE IF NOT EXISTS levels (
  id SERIAL PRIMARY KEY,
  rack_id INTEGER NOT NULL REFERENCES racks(id) ON DELETE CASCADE,
  code VARCHAR(30) NOT NULL,
  level_number INTEGER NOT NULL,
  max_weight NUMERIC(12, 2) NOT NULL DEFAULT 2500,
  max_volume NUMERIC(12, 2) NOT NULL DEFAULT 20,
  status VARCHAR(20) NOT NULL DEFAULT 'Active',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (rack_id, code),
  UNIQUE (rack_id, level_number),
  CHECK (status IN ('Active', 'Inactive'))
);

CREATE TABLE IF NOT EXISTS bins (
  id SERIAL PRIMARY KEY,
  level_id INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
  code VARCHAR(30) NOT NULL,
  barcode VARCHAR(80) UNIQUE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Available',
  max_weight NUMERIC(12, 2) NOT NULL DEFAULT 500,
  max_volume NUMERIC(12, 2) NOT NULL DEFAULT 4,
  current_weight NUMERIC(12, 2) NOT NULL DEFAULT 0,
  current_volume NUMERIC(12, 2) NOT NULL DEFAULT 0,
  allowed_cargo_type VARCHAR(100),
  reserved_for_cargo_type VARCHAR(100),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (level_id, code),
  CHECK (status IN ('Available', 'Reserved', 'Blocked', 'Maintenance', 'Occupied', 'Full', 'Inactive'))
);

-- Keep databases created from earlier schema versions compatible.
ALTER TABLE zones
  ADD COLUMN IF NOT EXISTS zone_type VARCHAR(80) NOT NULL DEFAULT 'Standard',
  ADD COLUMN IF NOT EXISTS max_weight NUMERIC(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_volume NUMERIC(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'Active',
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE racks
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'Active',
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE levels
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'Active',
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE bins
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allowed_cargo_type VARCHAR(100);

ALTER TABLE bins DROP CONSTRAINT IF EXISTS bins_status_check;

UPDATE zones SET status = CASE WHEN active THEN 'Active' ELSE 'Inactive' END;
UPDATE racks SET status = CASE WHEN active THEN 'Active' ELSE 'Inactive' END;
UPDATE levels SET status = CASE WHEN active THEN 'Active' ELSE 'Inactive' END;
UPDATE bins SET status = 'Inactive' WHERE active = FALSE;
UPDATE bins b
SET allowed_cargo_type = z.allowed_cargo_type
FROM levels l
JOIN racks r ON r.id = l.rack_id
JOIN zones z ON z.id = r.zone_id
WHERE b.level_id = l.id
  AND b.allowed_cargo_type IS NULL;

ALTER TABLE racks DROP CONSTRAINT IF EXISTS racks_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_racks_zone_code_unique ON racks(zone_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_levels_rack_number_unique ON levels(rack_id, level_number);

ALTER TABLE zones DROP CONSTRAINT IF EXISTS zones_status_check;
ALTER TABLE zones
  ADD CONSTRAINT zones_status_check CHECK (status IN ('Active', 'Inactive'));

ALTER TABLE racks DROP CONSTRAINT IF EXISTS racks_status_check;
ALTER TABLE racks
  ADD CONSTRAINT racks_status_check CHECK (status IN ('Active', 'Inactive'));

ALTER TABLE levels DROP CONSTRAINT IF EXISTS levels_status_check;
ALTER TABLE levels
  ADD CONSTRAINT levels_status_check CHECK (status IN ('Active', 'Inactive'));

ALTER TABLE bins
  ADD CONSTRAINT bins_status_check CHECK (status IN ('Available', 'Reserved', 'Blocked', 'Maintenance', 'Occupied', 'Full', 'Inactive'));

CREATE TABLE IF NOT EXISTS cargo (
  id SERIAL PRIMARY KEY,
  cargo_id VARCHAR(40) UNIQUE NOT NULL,
  barcode VARCHAR(80) UNIQUE NOT NULL,
  reference_number VARCHAR(80) UNIQUE NOT NULL,
  consignee_name VARCHAR(150) NOT NULL,
  company_name VARCHAR(150),
  contact_person VARCHAR(150),
  phone_number VARCHAR(40),
  email VARCHAR(150),
  source_of_cargo VARCHAR(80),
  container_number VARCHAR(80),
  vehicle_number VARCHAR(80),
  cargo_description TEXT,
  cargo_type VARCHAR(100) NOT NULL,
  packaging_type VARCHAR(80),
  quantity NUMERIC(12, 2),
  weight NUMERIC(12, 2),
  volume NUMERIC(12, 2),
  cargo_condition VARCHAR(80),
  hazard_class VARCHAR(80),
  inspection_notes TEXT,
  received_by VARCHAR(120),
  received_datetime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivery_note_number VARCHAR(120),
  status VARCHAR(40) NOT NULL DEFAULT 'Pending Review',
  workflow_status VARCHAR(40) NOT NULL DEFAULT 'Pending Review',
  registration_status VARCHAR(40) NOT NULL DEFAULT 'Pending Review',
  placement_status VARCHAR(40) NOT NULL DEFAULT 'Unplaced',
  location TEXT,
  current_bin_id INTEGER REFERENCES bins(id) ON DELETE SET NULL,
  relocation_required BOOLEAN NOT NULL DEFAULT FALSE,
  relocation_reason TEXT,
  relocation_flagged_at TIMESTAMP,
  warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  warehouse_id_at_registration INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_staff_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  received_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMP,
  rejected_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMP,
  rejection_reason TEXT,
  corrective_notes TEXT,
  correction_requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  correction_requested_at TIMESTAMP,
  correction_notes TEXT,
  correction_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  correction_original_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  correction_last_changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMP,
  archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  archive_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('Pending Review', 'Approved', 'Correction Required', 'Rejected')),
  CHECK (workflow_status IN ('Pending Review', 'Approved', 'Correction Required', 'Rejected')),
  CHECK (registration_status IN ('Pending Review', 'Approved', 'Correction Required', 'Rejected')),
  CHECK (placement_status IN ('Unplaced', 'Placed', 'Relocated', 'Dispatched'))
);

ALTER TABLE cargo
  ADD COLUMN IF NOT EXISTS placement_status VARCHAR(40) NOT NULL DEFAULT 'Unplaced',
  ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS received_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workflow_status VARCHAR(40) NOT NULL DEFAULT 'Pending Review',
  ADD COLUMN IF NOT EXISTS registration_status VARCHAR(40) NOT NULL DEFAULT 'Pending Review',
  ADD COLUMN IF NOT EXISTS relocation_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS relocation_reason TEXT,
  ADD COLUMN IF NOT EXISTS relocation_flagged_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS warehouse_id_at_registration INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_staff_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS rejected_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS corrective_notes TEXT,
  ADD COLUMN IF NOT EXISTS correction_requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS correction_requested_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS correction_notes TEXT,
  ADD COLUMN IF NOT EXISTS correction_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS correction_original_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS correction_last_changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

UPDATE cargo
SET created_by = COALESCE(created_by, received_by_user_id),
    assigned_staff_id = COALESCE(assigned_staff_id, created_by, received_by_user_id),
    warehouse_id_at_registration = COALESCE(warehouse_id_at_registration, warehouse_id)
WHERE created_by IS NULL
   OR assigned_staff_id IS NULL
   OR warehouse_id_at_registration IS NULL;

ALTER TABLE cargo DROP CONSTRAINT IF EXISTS cargo_status_check;
ALTER TABLE cargo DROP CONSTRAINT IF EXISTS cargo_workflow_status_check;
ALTER TABLE cargo DROP CONSTRAINT IF EXISTS cargo_placement_status_check;
ALTER TABLE cargo DROP CONSTRAINT IF EXISTS cargo_registration_status_check;

UPDATE cargo
SET registration_status = CASE
      WHEN workflow_status IN ('Rejected', 'Cancelled')
        OR status IN ('Rejected', 'Cancelled')
        THEN 'Rejected'
      WHEN workflow_status = 'Correction Required'
        OR status = 'Correction Required'
        THEN 'Correction Required'
      WHEN workflow_status IN (
        'Approved',
        'Approved For Placement',
        'Stored',
        'Blocked',
        'Dispatch Pending',
        'Released'
      )
        OR status IN (
          'Approved',
          'Approved For Placement',
          'Stored',
          'Blocked',
          'Dispatch Approval Pending',
          'Ready for Dispatch',
          'Dispatch Pending',
          'Released'
        )
        THEN 'Approved'
      ELSE 'Pending Review'
    END,
    placement_status = CASE
      WHEN workflow_status = 'Released'
        OR status = 'Released'
        OR placement_status = 'Dispatched'
        THEN 'Dispatched'
      WHEN placement_status = 'Relocated'
        THEN 'Relocated'
      WHEN current_bin_id IS NOT NULL
        OR workflow_status = 'Stored'
        OR status = 'Stored'
        OR placement_status = 'Stored'
        THEN 'Placed'
      ELSE 'Unplaced'
    END,
    relocation_required = CASE
      WHEN placement_status = 'Relocation Requested' THEN TRUE
      ELSE relocation_required
    END;

UPDATE cargo
SET status = registration_status,
    workflow_status = registration_status;

ALTER TABLE cargo ALTER COLUMN status SET DEFAULT 'Pending Review';
ALTER TABLE cargo ALTER COLUMN workflow_status SET DEFAULT 'Pending Review';
ALTER TABLE cargo ALTER COLUMN registration_status SET DEFAULT 'Pending Review';
ALTER TABLE cargo ALTER COLUMN placement_status SET DEFAULT 'Unplaced';

ALTER TABLE cargo
  ADD CONSTRAINT cargo_status_check
  CHECK (status IN ('Pending Review', 'Approved', 'Correction Required', 'Rejected'));

ALTER TABLE cargo
  ADD CONSTRAINT cargo_workflow_status_check
  CHECK (workflow_status IN ('Pending Review', 'Approved', 'Correction Required', 'Rejected'));

ALTER TABLE cargo
  ADD CONSTRAINT cargo_registration_status_check
  CHECK (registration_status IN ('Pending Review', 'Approved', 'Correction Required', 'Rejected'));

ALTER TABLE cargo
  ADD CONSTRAINT cargo_placement_status_check
  CHECK (placement_status IN ('Unplaced', 'Placed', 'Relocated', 'Dispatched'));

CREATE TABLE IF NOT EXISTS cargo_movements (
  id SERIAL PRIMARY KEY,
  cargo_id INTEGER NOT NULL REFERENCES cargo(id) ON DELETE CASCADE,
  from_bin_id INTEGER REFERENCES bins(id) ON DELETE SET NULL,
  to_bin_id INTEGER REFERENCES bins(id) ON DELETE SET NULL,
  from_location TEXT,
  to_location TEXT,
  moved_by VARCHAR(120),
  moved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  warehouse_id_at_action INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  movement_type VARCHAR(80),
  action VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE cargo_movements
  ADD COLUMN IF NOT EXISTS from_bin_id INTEGER REFERENCES bins(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS to_bin_id INTEGER REFERENCES bins(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS warehouse_id_at_action INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS movement_type VARCHAR(80);

UPDATE cargo_movements
SET movement_type = COALESCE(movement_type, action)
WHERE movement_type IS NULL;

CREATE TABLE IF NOT EXISTS placement_validation_logs (
  id SERIAL PRIMARY KEY,
  cargo_id INTEGER REFERENCES cargo(id) ON DELETE SET NULL,
  cargo_barcode VARCHAR(80),
  bin_id INTEGER REFERENCES bins(id) ON DELETE SET NULL,
  bin_barcode VARCHAR(80),
  placement_mode VARCHAR(20) NOT NULL DEFAULT 'scan',
  attempt_stage VARCHAR(30) NOT NULL DEFAULT 'validation',
  manual_reason VARCHAR(80),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  warehouse_id_at_action INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  result VARCHAR(20),
  previous_location TEXT,
  new_location TEXT,
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  reason VARCHAR(120) NOT NULL,
  detail TEXT,
  checks JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE placement_validation_logs
  ADD COLUMN IF NOT EXISTS placement_mode VARCHAR(20) NOT NULL DEFAULT 'scan',
  ADD COLUMN IF NOT EXISTS attempt_stage VARCHAR(30) NOT NULL DEFAULT 'validation',
  ADD COLUMN IF NOT EXISTS manual_reason VARCHAR(80),
  ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS warehouse_id_at_action INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS result VARCHAR(20),
  ADD COLUMN IF NOT EXISTS previous_location TEXT,
  ADD COLUMN IF NOT EXISTS new_location TEXT;

UPDATE placement_validation_logs
SET performed_by = COALESCE(performed_by, user_id),
    result = COALESCE(result, CASE WHEN approved THEN 'Passed' ELSE 'Failed' END)
WHERE performed_by IS NULL
   OR result IS NULL;

CREATE TABLE IF NOT EXISTS cargo_documents (
  id SERIAL PRIMARY KEY,
  cargo_id INTEGER NOT NULL REFERENCES cargo(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(120) NOT NULL,
  file_size BIGINT NOT NULL,
  file_path TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cargo_locations (
  id SERIAL PRIMARY KEY,
  cargo_id INTEGER NOT NULL REFERENCES cargo(id) ON DELETE CASCADE,
  bin_id INTEGER REFERENCES bins(id) ON DELETE SET NULL,
  location TEXT,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id SERIAL PRIMARY KEY,
  request_type VARCHAR(80) NOT NULL,
  cargo_id INTEGER NOT NULL REFERENCES cargo(id) ON DELETE CASCADE,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_supervisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  warehouse_id_at_request INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  decision_notes TEXT,
  request_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TIMESTAMP,
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Correction Required', 'Cancelled')),
  CHECK (request_type IN (
    'CARGO_REGISTRATION',
    'DAMAGED_CARGO_RECEIVING',
    'HAZARDOUS_CARGO_PLACEMENT',
    'PLACEMENT_OVERRIDE',
    'BLOCKED_CARGO_MOVEMENT',
    'DISPATCH_AUTHORIZATION',
    'EMERGENCY_RELOCATION'
  ))
);

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS warehouse_id_at_request INTEGER REFERENCES warehouses(id) ON DELETE SET NULL;

UPDATE approval_requests ar
SET assigned_to = COALESCE(ar.assigned_to, ar.assigned_supervisor_id),
    warehouse_id_at_request = COALESCE(ar.warehouse_id_at_request, c.warehouse_id)
FROM cargo c
WHERE c.id = ar.cargo_id
  AND (ar.assigned_to IS NULL OR ar.warehouse_id_at_request IS NULL);

ALTER TABLE approval_requests DROP CONSTRAINT IF EXISTS approval_requests_status_check;
ALTER TABLE approval_requests
  ADD CONSTRAINT approval_requests_status_check
  CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Correction Required', 'Cancelled'));

ALTER TABLE approval_requests DROP CONSTRAINT IF EXISTS approval_requests_request_type_check;
ALTER TABLE approval_requests
  ADD CONSTRAINT approval_requests_request_type_check CHECK (request_type IN (
    'CARGO_REGISTRATION',
    'DAMAGED_CARGO_RECEIVING',
    'HAZARDOUS_CARGO_PLACEMENT',
    'PLACEMENT_OVERRIDE',
    'BLOCKED_CARGO_MOVEMENT',
    'DISPATCH_AUTHORIZATION',
    'EMERGENCY_RELOCATION'
  ));

CREATE TABLE IF NOT EXISTS cargo_approval_history (
  id SERIAL PRIMARY KEY,
  cargo_id INTEGER NOT NULL REFERENCES cargo(id) ON DELETE CASCADE,
  action VARCHAR(80) NOT NULL,
  remarks TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  warehouse_id_at_action INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  performed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE cargo_approval_history
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS warehouse_id_at_action INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE cargo_approval_history cah
SET warehouse_id_at_action = COALESCE(cah.warehouse_id_at_action, c.warehouse_id),
    created_at = COALESCE(cah.created_at, cah.performed_at)
FROM cargo c
WHERE c.id = cah.cargo_id
  AND (cah.warehouse_id_at_action IS NULL OR cah.created_at IS NULL);

INSERT INTO approval_requests
  (request_type, cargo_id, requested_by, warehouse_id_at_request, reason, status, request_data)
SELECT
  'CARGO_REGISTRATION',
  c.id,
  COALESCE(c.created_by, c.received_by_user_id),
  c.warehouse_id,
  'Cargo registration requires independent Warehouse Supervisor review and may proceed to placement while review is pending.',
  'Pending',
  jsonb_build_object(
    'cargo_condition', c.cargo_condition,
    'cargo_type', c.cargo_type,
    'hazard_class', c.hazard_class,
    'migrated', TRUE
  )
FROM cargo c
WHERE c.registration_status = 'Pending Review'
  AND NOT EXISTS (
    SELECT 1
    FROM approval_requests ar
    WHERE ar.cargo_id = c.id
      AND ar.request_type = 'CARGO_REGISTRATION'
  );

INSERT INTO cargo_approval_history
  (cargo_id, action, remarks, performed_by, warehouse_id_at_action, created_at, performed_at)
SELECT
  c.id,
  'REGISTRATION_SUBMITTED',
  'Cargo registration entered the independent supervisor review workflow and placement queue.',
  COALESCE(c.created_by, c.received_by_user_id),
  c.warehouse_id,
  c.created_at,
  c.created_at
FROM cargo c
WHERE c.registration_status = 'Pending Review'
  AND NOT EXISTS (
    SELECT 1
    FROM cargo_approval_history cah
    WHERE cah.cargo_id = c.id
      AND cah.action = 'REGISTRATION_SUBMITTED'
  );

CREATE TABLE IF NOT EXISTS barcode_print_logs (
  id SERIAL PRIMARY KEY,
  cargo_id INTEGER NOT NULL REFERENCES cargo(id) ON DELETE CASCADE,
  printed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  print_type VARCHAR(20) NOT NULL DEFAULT 'PRINT',
  printed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (print_type IN ('PRINT', 'REPRINT'))
);

CREATE TABLE IF NOT EXISTS bin_barcode_print_logs (
  id SERIAL PRIMARY KEY,
  bin_id INTEGER NOT NULL REFERENCES bins(id) ON DELETE CASCADE,
  printed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  print_type VARCHAR(20) NOT NULL DEFAULT 'PRINT',
  printed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (print_type IN ('PRINT', 'REPRINT'))
);

CREATE TABLE IF NOT EXISTS dispatch_requests (
  id SERIAL PRIMARY KEY,
  cargo_id INTEGER NOT NULL REFERENCES cargo(id) ON DELETE CASCADE,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  decision_notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TIMESTAMP,
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Cancelled'))
);

CREATE TABLE IF NOT EXISTS bin_rules (
  id SERIAL PRIMARY KEY,
  rule_key VARCHAR(80) UNIQUE NOT NULL,
  rule_name VARCHAR(150) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO bin_rules (rule_key, rule_name, description, is_active, parameters)
VALUES
  ('hazardous', 'Hazardous Zone Compliance', 'Validates hazardous cargo placement against hazard zones.', TRUE, '{}'::jsonb),
  ('weight', 'Bin Weight Capacity Limit', 'Validates remaining bin weight capacity.', TRUE, '{}'::jsonb),
  ('volume', 'Bin Volume Capacity Limit', 'Validates remaining bin volume capacity.', TRUE, '{}'::jsonb),
  ('compatibility', 'Cargo-Zone Compatibility', 'Validates cargo type against the zone allowed cargo types.', TRUE, '{}'::jsonb),
  ('restricted', 'Restricted Zone Rules', 'Requires supervisor approval for restricted storage zones.', TRUE, '{}'::jsonb)
ON CONFLICT (rule_key) DO UPDATE
SET rule_name = EXCLUDED.rule_name,
    description = EXCLUDED.description;

UPDATE bin_rules
SET is_active = TRUE,
    updated_at = CURRENT_TIMESTAMP
WHERE rule_key IN ('hazardous', 'weight', 'volume', 'compatibility');

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_zones_updated_at ON zones;
CREATE TRIGGER set_zones_updated_at
BEFORE UPDATE ON zones
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_racks_updated_at ON racks;
CREATE TRIGGER set_racks_updated_at
BEFORE UPDATE ON racks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_levels_updated_at ON levels;
CREATE TRIGGER set_levels_updated_at
BEFORE UPDATE ON levels
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_bins_updated_at ON bins;
CREATE TRIGGER set_bins_updated_at
BEFORE UPDATE ON bins
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_cargo_updated_at ON cargo;
CREATE TRIGGER set_cargo_updated_at
BEFORE UPDATE ON cargo
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION sync_cargo_status_aliases()
RETURNS TRIGGER AS $$
BEGIN
  -- registration_status is authoritative. These columns remain read-only aliases
  -- for older integrations until they can be removed in a future major migration.
  NEW.status := NEW.registration_status;
  NEW.workflow_status := NEW.registration_status;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_cargo_status_aliases_trigger ON cargo;
CREATE TRIGGER sync_cargo_status_aliases_trigger
BEFORE INSERT OR UPDATE ON cargo
FOR EACH ROW EXECUTE FUNCTION sync_cargo_status_aliases();

DROP TRIGGER IF EXISTS set_users_updated_at ON users;
CREATE TRIGGER set_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_bin_rules_updated_at ON bin_rules;
CREATE TRIGGER set_bin_rules_updated_at
BEFORE UPDATE ON bin_rules
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_cargo_status ON cargo(status);
CREATE INDEX IF NOT EXISTS idx_cargo_type ON cargo(cargo_type);
CREATE INDEX IF NOT EXISTS idx_cargo_barcode ON cargo(barcode);
CREATE INDEX IF NOT EXISTS idx_cargo_warehouse_id ON cargo(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_cargo_created_by ON cargo(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cargo_assigned_staff ON cargo(assigned_staff_id, registration_status, placement_status);
CREATE INDEX IF NOT EXISTS idx_cargo_placement_status ON cargo(placement_status);
CREATE INDEX IF NOT EXISTS idx_bins_barcode ON bins(barcode);
CREATE INDEX IF NOT EXISTS idx_validation_logs_created_at ON placement_validation_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cargo_documents_cargo_id ON cargo_documents(cargo_id);
CREATE INDEX IF NOT EXISTS idx_cargo_locations_current ON cargo_locations(cargo_id, is_current);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_requests_cargo_id ON approval_requests(cargo_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_assigned_to ON approval_requests(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_warehouse_request ON approval_requests(warehouse_id_at_request, status);
CREATE INDEX IF NOT EXISTS idx_cargo_workflow_status ON cargo(workflow_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cargo_registration_status ON cargo(registration_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cargo_received_by_user ON cargo(received_by_user_id, registration_status);
CREATE INDEX IF NOT EXISTS idx_cargo_archive_state ON cargo(is_deleted, archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_cargo_active_delivery_note_identity
  ON cargo (UPPER(REGEXP_REPLACE(BTRIM(delivery_note_number), '[^[:alnum:]]', '', 'g')))
  WHERE is_deleted = FALSE
    AND registration_status IN ('Pending Review', 'Correction Required', 'Approved')
    AND placement_status <> 'Dispatched';
CREATE INDEX IF NOT EXISTS idx_cargo_active_container_identity
  ON cargo (UPPER(REGEXP_REPLACE(BTRIM(container_number), '[^[:alnum:]]', '', 'g')))
  WHERE is_deleted = FALSE
    AND registration_status IN ('Pending Review', 'Correction Required', 'Approved')
    AND placement_status <> 'Dispatched';
CREATE INDEX IF NOT EXISTS idx_cargo_active_vehicle_consignee_type
  ON cargo (
    UPPER(REGEXP_REPLACE(BTRIM(vehicle_number), '[^[:alnum:]]', '', 'g')),
    LOWER(REGEXP_REPLACE(BTRIM(consignee_name), '[[:space:]]+', ' ', 'g')),
    LOWER(REGEXP_REPLACE(BTRIM(cargo_type), '[[:space:]]+', ' ', 'g'))
  )
  WHERE is_deleted = FALSE
    AND registration_status IN ('Pending Review', 'Correction Required', 'Approved')
    AND placement_status <> 'Dispatched';
CREATE INDEX IF NOT EXISTS idx_cargo_approval_history_cargo ON cargo_approval_history(cargo_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_requests_status ON dispatch_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_warehouse_id ON users(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_users_shift_id ON users(shift_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_user_id ON audit_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_role_snapshot ON audit_logs(role_id_at_action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_warehouse_snapshot ON audit_logs(warehouse_id_at_action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_bootstrap_admin ON users(is_bootstrap_admin);

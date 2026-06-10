-- Run this file while connected to the fumbaport_wms database.
-- Example: psql -U postgres -d fumbaport_wms -f backend/database/schema.sql

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
  last_login TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('active', 'inactive', 'suspended'))
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  login_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  logout_time TIMESTAMP,
  session_status VARCHAR(30) NOT NULL DEFAULT 'active',
  ip_address VARCHAR(80),
  CHECK (session_status IN ('active', 'closed', 'expired'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(120) NOT NULL,
  module VARCHAR(120) NOT NULL,
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO roles (role_name, role_description)
VALUES
  ('System Admin', 'Full access to system configuration, user management, monitoring, and audit supervision.'),
  ('Warehouse Staff', 'Operational access for cargo registration, placement scanning, cargo tracking, and dispatch preparation.'),
  ('Supervisor', 'Operational oversight access for warehouse teams, exception review, and activity monitoring.'),
  ('Customs Officer', 'Customs inspection and clearance review access for cargo oversight.'),
  ('Billing Officer', 'Billing and release readiness review access for warehouse operations.')
ON CONFLICT (role_name) DO UPDATE
SET role_description = EXCLUDED.role_description;

INSERT INTO warehouses (warehouse_name, warehouse_code, status)
VALUES
  ('Warehouse A', 'WHA', 'active'),
  ('Warehouse B', 'WHB', 'active')
ON CONFLICT (warehouse_code) DO UPDATE
SET warehouse_name = EXCLUDED.warehouse_name,
    status = EXCLUDED.status;

INSERT INTO shifts (shift_name, start_time, end_time)
VALUES
  ('Morning Shift', '06:00', '14:00'),
  ('Evening Shift', '14:00', '22:00'),
  ('Night Shift', '22:00', '06:00')
ON CONFLICT (shift_name) DO UPDATE
SET start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time;

CREATE TABLE IF NOT EXISTS zones (
  id SERIAL PRIMARY KEY,
  code VARCHAR(10) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  allowed_cargo_type VARCHAR(100) NOT NULL,
  is_hazard_zone BOOLEAN NOT NULL DEFAULT FALSE,
  rack_count INTEGER NOT NULL DEFAULT 1,
  level_count INTEGER NOT NULL DEFAULT 1,
  bins_per_level INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS racks (
  id SERIAL PRIMARY KEY,
  zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  code VARCHAR(30) UNIQUE NOT NULL,
  name VARCHAR(100),
  max_weight NUMERIC(12, 2) NOT NULL DEFAULT 10000,
  max_volume NUMERIC(12, 2) NOT NULL DEFAULT 80,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS levels (
  id SERIAL PRIMARY KEY,
  rack_id INTEGER NOT NULL REFERENCES racks(id) ON DELETE CASCADE,
  code VARCHAR(30) NOT NULL,
  level_number INTEGER NOT NULL,
  max_weight NUMERIC(12, 2) NOT NULL DEFAULT 2500,
  max_volume NUMERIC(12, 2) NOT NULL DEFAULT 20,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (rack_id, code)
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
  reserved_for_cargo_type VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (level_id, code),
  CHECK (status IN ('Available', 'Reserved', 'Blocked', 'Occupied'))
);

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
  status VARCHAR(40) NOT NULL DEFAULT 'Registered',
  location TEXT,
  current_bin_id INTEGER REFERENCES bins(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('Registered', 'Stored', 'Blocked', 'Ready for Dispatch', 'Released'))
);

CREATE TABLE IF NOT EXISTS cargo_movements (
  id SERIAL PRIMARY KEY,
  cargo_id INTEGER NOT NULL REFERENCES cargo(id) ON DELETE CASCADE,
  from_location TEXT,
  to_location TEXT,
  moved_by VARCHAR(120),
  action VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS placement_validation_logs (
  id SERIAL PRIMARY KEY,
  cargo_id INTEGER REFERENCES cargo(id) ON DELETE SET NULL,
  cargo_barcode VARCHAR(80),
  bin_id INTEGER REFERENCES bins(id) ON DELETE SET NULL,
  bin_barcode VARCHAR(80),
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  reason VARCHAR(120) NOT NULL,
  detail TEXT,
  checks JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

DROP TRIGGER IF EXISTS set_users_updated_at ON users;
CREATE TRIGGER set_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_cargo_status ON cargo(status);
CREATE INDEX IF NOT EXISTS idx_cargo_type ON cargo(cargo_type);
CREATE INDEX IF NOT EXISTS idx_cargo_barcode ON cargo(barcode);
CREATE INDEX IF NOT EXISTS idx_bins_barcode ON bins(barcode);
CREATE INDEX IF NOT EXISTS idx_validation_logs_created_at ON placement_validation_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_warehouse_id ON users(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_users_shift_id ON users(shift_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

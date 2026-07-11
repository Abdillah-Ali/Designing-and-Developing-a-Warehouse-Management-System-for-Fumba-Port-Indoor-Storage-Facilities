-- SRS-aligned indoor racked warehouse configuration.
-- This migration is intentionally additive so existing cargo/location history keeps
-- its original foreign keys and remains reportable.

ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS warehouse_letter VARCHAR(1),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS total_capacity NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS max_volume NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS occupancy_warning_threshold NUMERIC(5, 2) NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS full_threshold NUMERIC(5, 2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE warehouses
SET warehouse_letter = UPPER(
      COALESCE(
        NULLIF(SUBSTRING(warehouse_code FROM '([A-Za-z])$'), ''),
        NULLIF(SUBSTRING(warehouse_name FROM '([A-Za-z])$'), '')
      )
    ),
    total_capacity = COALESCE(total_capacity, 1)
WHERE warehouse_letter IS NULL OR total_capacity IS NULL;

ALTER TABLE zones
  ADD COLUMN IF NOT EXISTS zone_letter VARCHAR(1),
  ADD COLUMN IF NOT EXISTS handling_condition TEXT,
  ADD COLUMN IF NOT EXISTS occupancy_warning_threshold NUMERIC(5, 2) NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS full_threshold NUMERIC(5, 2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

UPDATE zones
SET zone_letter = UPPER(NULLIF(SUBSTRING(code FROM '([A-Za-z])$'), '')),
    handling_condition = COALESCE(handling_condition, description)
WHERE zone_letter IS NULL OR handling_condition IS NULL;

ALTER TABLE racks
  ADD COLUMN IF NOT EXISTS rack_letter VARCHAR(1),
  ADD COLUMN IF NOT EXISTS occupancy_warning_threshold NUMERIC(5, 2) NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS full_threshold NUMERIC(5, 2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

UPDATE racks
SET rack_letter = UPPER(NULLIF(SUBSTRING(code FROM '([A-Za-z])$'), ''))
WHERE rack_letter IS NULL;

ALTER TABLE levels
  ADD COLUMN IF NOT EXISTS name VARCHAR(180),
  ADD COLUMN IF NOT EXISTS occupancy_warning_threshold NUMERIC(5, 2) NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS full_threshold NUMERIC(5, 2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE bins
  ADD COLUMN IF NOT EXISTS bin_identifier VARCHAR(20),
  ADD COLUMN IF NOT EXISTS name VARCHAR(220),
  ADD COLUMN IF NOT EXISTS bin_type VARCHAR(80) NOT NULL DEFAULT 'Standard',
  ADD COLUMN IF NOT EXISTS length NUMERIC(12, 3),
  ADD COLUMN IF NOT EXISTS width NUMERIC(12, 3),
  ADD COLUMN IF NOT EXISTS height NUMERIC(12, 3),
  ADD COLUMN IF NOT EXISTS volume_capacity NUMERIC(14, 3),
  ADD COLUMN IF NOT EXISTS weight_capacity NUMERIC(14, 3),
  ADD COLUMN IF NOT EXISTS current_occupancy NUMERIC(14, 3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS creation_status VARCHAR(20) NOT NULL DEFAULT 'Active',
  ADD COLUMN IF NOT EXISTS operational_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS cargo_restrictions TEXT,
  ADD COLUMN IF NOT EXISTS occupancy_warning_threshold NUMERIC(5, 2) NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS full_threshold NUMERIC(5, 2) NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS manual_volume_override BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS status_reason TEXT,
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE cargo
  ADD COLUMN IF NOT EXISTS customs_status VARCHAR(30) NOT NULL DEFAULT 'Not Required',
  ADD COLUMN IF NOT EXISTS emergency_release_approved BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE bins
SET bin_identifier = COALESCE(bin_identifier, REGEXP_REPLACE(code, '^B-', '', 'i')),
    name = COALESCE(name, barcode),
    volume_capacity = COALESCE(volume_capacity, max_volume),
    weight_capacity = COALESCE(weight_capacity, max_weight),
    current_occupancy = COALESCE(current_occupancy, current_volume),
    creation_status = CASE WHEN active THEN 'Active' ELSE 'Inactive' END,
    operational_status = COALESCE(operational_status, status),
    cargo_restrictions = COALESCE(cargo_restrictions, reserved_for_cargo_type)
WHERE bin_identifier IS NULL
   OR name IS NULL
   OR volume_capacity IS NULL
   OR weight_capacity IS NULL
   OR operational_status IS NULL;

ALTER TABLE bins DROP CONSTRAINT IF EXISTS bins_status_check;
ALTER TABLE bins
  ADD CONSTRAINT bins_status_check
  CHECK (status IN ('Available', 'Occupied', 'Full', 'Reserved', 'Restricted', 'Blocked', 'Maintenance', 'Damaged', 'Inactive'));

ALTER TABLE bins DROP CONSTRAINT IF EXISTS bins_creation_status_check;
ALTER TABLE bins
  ADD CONSTRAINT bins_creation_status_check CHECK (creation_status IN ('Active', 'Inactive'));

ALTER TABLE bins DROP CONSTRAINT IF EXISTS bins_operational_status_check;
ALTER TABLE bins
  ADD CONSTRAINT bins_operational_status_check
  CHECK (operational_status IN ('Available', 'Occupied', 'Full', 'Reserved', 'Restricted', 'Blocked', 'Maintenance', 'Damaged', 'Inactive'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_letter_unique
  ON warehouses(UPPER(warehouse_letter))
  WHERE warehouse_letter IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_name_unique
  ON warehouses(UPPER(warehouse_name));
CREATE UNIQUE INDEX IF NOT EXISTS idx_zones_warehouse_name_unique
  ON zones(warehouse_id, UPPER(name));
CREATE UNIQUE INDEX IF NOT EXISTS idx_racks_zone_name_unique
  ON racks(zone_id, UPPER(name))
  WHERE name IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_levels_rack_name_unique
  ON levels(rack_id, UPPER(name))
  WHERE name IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bins_level_name_unique
  ON bins(level_id, UPPER(name))
  WHERE name IS NOT NULL;

CREATE TABLE IF NOT EXISTS capacity_configurations (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(20) NOT NULL,
  entity_id INTEGER NOT NULL,
  max_weight NUMERIC(14, 3) NOT NULL,
  max_volume NUMERIC(14, 3) NOT NULL,
  occupancy_warning_threshold NUMERIC(5, 2) NOT NULL DEFAULT 80,
  full_threshold NUMERIC(5, 2) NOT NULL DEFAULT 100,
  allow_child_capacity_override BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'Active',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (entity_type, entity_id),
  CHECK (entity_type IN ('Warehouse', 'Zone', 'Rack', 'Level', 'Bin')),
  CHECK (max_weight > 0),
  CHECK (max_volume > 0),
  CHECK (occupancy_warning_threshold > 0 AND occupancy_warning_threshold < 100),
  CHECK (full_threshold > occupancy_warning_threshold AND full_threshold <= 100),
  CHECK (status IN ('Active', 'Inactive'))
);

INSERT INTO bin_rules (rule_key, rule_name, description, is_active, parameters)
VALUES
  ('zone_restriction', 'Zone Restriction', 'Searches only zones whose configured cargo type accepts the cargo.', TRUE, '{}'::jsonb),
  ('customs_hold', 'Customs Hold Restriction', 'Routes customs-held cargo only to explicitly compatible restricted storage.', TRUE, '{}'::jsonb),
  ('fragile_handling', 'Fragile Cargo Handling', 'Requires configured fragile handling conditions and compatible bins.', TRUE, '{}'::jsonb),
  ('first_available', 'First Available Bin', 'Uses the first valid active bin after all safety checks pass.', TRUE, '{"order":"created_at"}'::jsonb),
  ('avoid_unavailable', 'Avoid Unavailable Bins', 'Excludes full, blocked, restricted, maintenance, damaged, and inactive bins.', TRUE, '{}'::jsonb),
  ('priority', 'Assignment Priority', 'Controls deterministic ordering when several valid bins are available.', TRUE, '{"priority":100}'::jsonb)
ON CONFLICT (rule_key) DO UPDATE
SET rule_name=EXCLUDED.rule_name, description=EXCLUDED.description;

CREATE INDEX IF NOT EXISTS idx_capacity_configurations_entity
  ON capacity_configurations(entity_type, entity_id);

-- Performance indexes for hierarchy aggregation queries
CREATE INDEX IF NOT EXISTS idx_zones_id
  ON zones(id);
CREATE INDEX IF NOT EXISTS idx_levels_rack_id
  ON levels(rack_id);
CREATE INDEX IF NOT EXISTS idx_bins_level_id
  ON bins(level_id);
CREATE INDEX IF NOT EXISTS idx_bins_status_active
  ON bins(status, active)
  WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_warehouses_id
  ON warehouses(id);

CREATE OR REPLACE FUNCTION sync_bin_configuration_aliases()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.max_weight := COALESCE(NEW.weight_capacity, NEW.max_weight);
    NEW.weight_capacity := NEW.max_weight;
    NEW.max_volume := COALESCE(NEW.volume_capacity, NEW.max_volume);
    NEW.volume_capacity := NEW.max_volume;
  ELSE
    IF NEW.max_weight IS DISTINCT FROM OLD.max_weight THEN
      NEW.weight_capacity := NEW.max_weight;
    ELSIF NEW.weight_capacity IS DISTINCT FROM OLD.weight_capacity THEN
      NEW.max_weight := NEW.weight_capacity;
    END IF;
    IF NEW.max_volume IS DISTINCT FROM OLD.max_volume THEN
      NEW.volume_capacity := NEW.max_volume;
    ELSIF NEW.volume_capacity IS DISTINCT FROM OLD.volume_capacity THEN
      NEW.max_volume := NEW.volume_capacity;
    END IF;
  END IF;
  NEW.current_occupancy := NEW.current_volume;
  NEW.creation_status := CASE WHEN NEW.active THEN 'Active' ELSE 'Inactive' END;
  NEW.operational_status := NEW.status;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_bin_configuration_aliases_trigger ON bins;
CREATE TRIGGER sync_bin_configuration_aliases_trigger
BEFORE INSERT OR UPDATE ON bins
FOR EACH ROW EXECUTE FUNCTION sync_bin_configuration_aliases();

DROP TRIGGER IF EXISTS set_warehouses_updated_at ON warehouses;
CREATE TRIGGER set_warehouses_updated_at
BEFORE UPDATE ON warehouses
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_capacity_configurations_updated_at ON capacity_configurations;
CREATE TRIGGER set_capacity_configurations_updated_at
BEFORE UPDATE ON capacity_configurations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

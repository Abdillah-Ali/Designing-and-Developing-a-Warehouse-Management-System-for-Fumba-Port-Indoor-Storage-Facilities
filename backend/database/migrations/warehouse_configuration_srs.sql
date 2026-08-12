-- SRS-aligned indoor racked warehouse configuration.
-- This migration is intentionally additive so existing cargo/location history keeps
-- its original foreign keys and remains reportable.

ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS warehouse_letter VARCHAR(1),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS total_capacity NUMERIC(18, 2),
  ADD COLUMN IF NOT EXISTS max_volume NUMERIC(18, 2),
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
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'bins'::regclass
      AND conname = 'bins_status_check'
  ) THEN
    ALTER TABLE bins
      ADD CONSTRAINT bins_status_check
      CHECK (status IN ('Available', 'Occupied', 'Full', 'Reserved', 'Restricted', 'Blocked', 'Maintenance', 'Damaged', 'Inactive'))
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE bins DROP CONSTRAINT IF EXISTS bins_creation_status_check;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'bins'::regclass
      AND conname = 'bins_creation_status_check'
  ) THEN
    ALTER TABLE bins
      ADD CONSTRAINT bins_creation_status_check
      CHECK (creation_status IN ('Active', 'Inactive'))
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE bins DROP CONSTRAINT IF EXISTS bins_operational_status_check;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'bins'::regclass
      AND conname = 'bins_operational_status_check'
  ) THEN
    ALTER TABLE bins
      ADD CONSTRAINT bins_operational_status_check
      CHECK (operational_status IN ('Available', 'Occupied', 'Full', 'Reserved', 'Restricted', 'Blocked', 'Maintenance', 'Damaged', 'Inactive'))
      NOT VALID;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.idx_warehouses_letter_unique') IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM warehouses
      WHERE warehouse_letter IS NOT NULL
      GROUP BY UPPER(warehouse_letter)
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'Skipping idx_warehouses_letter_unique because duplicate warehouse letters exist.';
    ELSE
      CREATE UNIQUE INDEX idx_warehouses_letter_unique
        ON warehouses(UPPER(warehouse_letter))
        WHERE warehouse_letter IS NOT NULL;
    END IF;
  END IF;

  IF to_regclass('public.idx_warehouses_name_unique') IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM warehouses
      GROUP BY UPPER(warehouse_name)
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'Skipping idx_warehouses_name_unique because duplicate warehouse names exist.';
    ELSE
      CREATE UNIQUE INDEX idx_warehouses_name_unique
        ON warehouses(UPPER(warehouse_name));
    END IF;
  END IF;

  IF to_regclass('public.idx_zones_warehouse_name_unique') IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM zones
      GROUP BY warehouse_id, UPPER(name)
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'Skipping idx_zones_warehouse_name_unique because duplicate zone names exist in a warehouse.';
    ELSE
      CREATE UNIQUE INDEX idx_zones_warehouse_name_unique
        ON zones(warehouse_id, UPPER(name));
    END IF;
  END IF;

  IF to_regclass('public.idx_racks_zone_name_unique') IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM racks
      WHERE name IS NOT NULL
      GROUP BY zone_id, UPPER(name)
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'Skipping idx_racks_zone_name_unique because duplicate rack names exist in a zone.';
    ELSE
      CREATE UNIQUE INDEX idx_racks_zone_name_unique
        ON racks(zone_id, UPPER(name))
        WHERE name IS NOT NULL;
    END IF;
  END IF;

  IF to_regclass('public.idx_levels_rack_name_unique') IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM levels
      WHERE name IS NOT NULL
      GROUP BY rack_id, UPPER(name)
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'Skipping idx_levels_rack_name_unique because duplicate level names exist in a rack.';
    ELSE
      CREATE UNIQUE INDEX idx_levels_rack_name_unique
        ON levels(rack_id, UPPER(name))
        WHERE name IS NOT NULL;
    END IF;
  END IF;

  IF to_regclass('public.idx_bins_level_name_unique') IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM bins
      WHERE name IS NOT NULL
      GROUP BY level_id, UPPER(name)
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'Skipping idx_bins_level_name_unique because duplicate bin names exist in a level.';
    ELSE
      CREATE UNIQUE INDEX idx_bins_level_name_unique
        ON bins(level_id, UPPER(name))
        WHERE name IS NOT NULL;
    END IF;
  END IF;
END;
$$;

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'sync_bin_configuration_aliases_trigger'
      AND tgrelid = 'bins'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER sync_bin_configuration_aliases_trigger
    BEFORE INSERT OR UPDATE ON bins
    FOR EACH ROW EXECUTE FUNCTION sync_bin_configuration_aliases();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_warehouses_updated_at'
      AND tgrelid = 'warehouses'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER set_warehouses_updated_at
    BEFORE UPDATE ON warehouses
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_capacity_configurations_updated_at'
      AND tgrelid = 'capacity_configurations'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER set_capacity_configurations_updated_at
    BEFORE UPDATE ON capacity_configurations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

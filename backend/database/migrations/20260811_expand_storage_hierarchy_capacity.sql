-- Keep every level of the storage hierarchy compatible with large warehouse
-- capacities. Zones inherit their warehouse capacity during creation.
ALTER TABLE zones
  ALTER COLUMN max_weight TYPE NUMERIC(18, 2),
  ALTER COLUMN max_volume TYPE NUMERIC(18, 2);

ALTER TABLE racks
  ALTER COLUMN max_weight TYPE NUMERIC(18, 2),
  ALTER COLUMN max_volume TYPE NUMERIC(18, 2);

ALTER TABLE levels
  ALTER COLUMN max_weight TYPE NUMERIC(18, 2),
  ALTER COLUMN max_volume TYPE NUMERIC(18, 2);

ALTER TABLE bins
  ALTER COLUMN max_weight TYPE NUMERIC(18, 2),
  ALTER COLUMN max_volume TYPE NUMERIC(18, 2),
  ALTER COLUMN current_weight TYPE NUMERIC(18, 2),
  ALTER COLUMN current_volume TYPE NUMERIC(18, 2),
  ALTER COLUMN weight_capacity TYPE NUMERIC(18, 3),
  ALTER COLUMN volume_capacity TYPE NUMERIC(18, 3),
  ALTER COLUMN current_occupancy TYPE NUMERIC(18, 3);

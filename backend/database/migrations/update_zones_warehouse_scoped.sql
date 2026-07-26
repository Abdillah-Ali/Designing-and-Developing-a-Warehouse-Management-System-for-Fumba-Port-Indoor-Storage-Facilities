-- Add warehouse_id to zones and enforce warehouse-scoped zone codes.
-- Safe on fresh databases, already-upgraded databases, and partially upgraded databases.

ALTER TABLE zones ADD COLUMN IF NOT EXISTS warehouse_id INTEGER;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'warehouses'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'zones'::regclass
      AND conname = 'zones_warehouse_id_fkey'
  ) THEN
    ALTER TABLE zones
      ADD CONSTRAINT zones_warehouse_id_fkey
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END;
$$;

WITH default_warehouse AS (
  SELECT id
  FROM warehouses
  ORDER BY CASE WHEN warehouse_code = 'WHA' THEN 0 ELSE 1 END, id
  LIMIT 1
)
UPDATE zones
SET warehouse_id = (SELECT id FROM default_warehouse)
WHERE warehouse_id IS NULL
  AND EXISTS (SELECT 1 FROM default_warehouse);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM zones WHERE warehouse_id IS NULL) THEN
    ALTER TABLE zones ALTER COLUMN warehouse_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'Skipping zones.warehouse_id NOT NULL because some existing zones do not have an assignable warehouse.';
  END IF;
END;
$$;

ALTER TABLE zones DROP CONSTRAINT IF EXISTS zones_code_key;

DO $$
BEGIN
  IF to_regclass('public.zones_warehouse_code_unique') IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM zones
      WHERE warehouse_id IS NOT NULL
      GROUP BY warehouse_id, code
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'Skipping zones_warehouse_code_unique because duplicate zone codes exist in a warehouse.';
    ELSE
      CREATE UNIQUE INDEX zones_warehouse_code_unique
        ON zones(warehouse_id, code);
    END IF;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_zones_warehouse_id
  ON zones(warehouse_id);

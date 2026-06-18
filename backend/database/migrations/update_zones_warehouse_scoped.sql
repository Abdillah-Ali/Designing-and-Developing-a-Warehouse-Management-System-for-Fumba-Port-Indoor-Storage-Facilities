-- Add warehouse_id to zones and enforce composite unique constraint (warehouse_id, code)

-- 1. Add nullable warehouse_id column to zones
ALTER TABLE zones ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE CASCADE;

-- 2. Associate existing global zones with a default warehouse (Warehouse A)
-- WHA is the code of the first seeded warehouse.
UPDATE zones 
SET warehouse_id = (SELECT id FROM warehouses WHERE warehouse_code = 'WHA' LIMIT 1) 
WHERE warehouse_id IS NULL;

-- 3. Enforce NOT NULL constraint on warehouse_id
ALTER TABLE zones ALTER COLUMN warehouse_id SET NOT NULL;

-- 4. Drop the global unique constraint on zone code
ALTER TABLE zones DROP CONSTRAINT IF EXISTS zones_code_key;

-- 5. Create a composite unique constraint for code within each warehouse
ALTER TABLE zones ADD CONSTRAINT zones_warehouse_code_unique UNIQUE (warehouse_id, code);

-- 6. Create index on warehouse_id for fast queries
CREATE INDEX IF NOT EXISTS idx_zones_warehouse_id ON zones(warehouse_id);

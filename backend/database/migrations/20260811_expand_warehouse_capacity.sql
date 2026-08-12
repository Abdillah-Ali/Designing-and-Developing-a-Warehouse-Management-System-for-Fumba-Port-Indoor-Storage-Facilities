-- Accept operational warehouse capacities through 999,999,999,999,999.99 kg.
-- Existing NUMERIC(14,2) columns rejected 1,000,000,000,000 kg with a 500 error.
ALTER TABLE warehouses
  ALTER COLUMN total_capacity TYPE NUMERIC(18, 2),
  ALTER COLUMN max_volume TYPE NUMERIC(18, 2);

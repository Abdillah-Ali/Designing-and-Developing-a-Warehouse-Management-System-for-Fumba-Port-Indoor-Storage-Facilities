ALTER TABLE tariff_versions ADD COLUMN IF NOT EXISTS late_collection_penalty_percent NUMERIC(7,4);

-- Preserve the behavior of versions approved before this field existed.
UPDATE tariff_versions SET late_collection_penalty_percent = 5.0000 WHERE late_collection_penalty_percent IS NULL;

ALTER TABLE tariff_versions ALTER COLUMN late_collection_penalty_percent SET NOT NULL;
ALTER TABLE tariff_versions DROP CONSTRAINT IF EXISTS tariff_versions_late_collection_penalty_percent_check;
ALTER TABLE tariff_versions ADD CONSTRAINT tariff_versions_late_collection_penalty_percent_check
  CHECK (late_collection_penalty_percent >= 0 AND late_collection_penalty_percent <= 100);

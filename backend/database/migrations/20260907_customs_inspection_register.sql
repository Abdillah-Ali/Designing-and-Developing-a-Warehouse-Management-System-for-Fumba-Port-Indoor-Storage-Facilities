ALTER TABLE customs_records
  ADD COLUMN IF NOT EXISTS inspection_type VARCHAR(120),
  ADD COLUMN IF NOT EXISTS inspection_result VARCHAR(120),
  ADD COLUMN IF NOT EXISTS document_verification VARCHAR(120),
  ADD COLUMN IF NOT EXISTS hold_reason VARCHAR(120),
  ADD COLUMN IF NOT EXISTS hold_released_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS hold_released_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hold_release_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_customs_records_inspection_register
  ON customs_records(created_at DESC, status, cargo_id);

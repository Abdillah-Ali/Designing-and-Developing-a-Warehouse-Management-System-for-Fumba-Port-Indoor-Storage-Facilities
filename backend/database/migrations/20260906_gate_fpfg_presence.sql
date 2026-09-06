ALTER TABLE cargo
  ADD COLUMN IF NOT EXISTS collection_status VARCHAR(40) NOT NULL DEFAULT 'WAITING_FOR_CUSTOMER',
  ADD COLUMN IF NOT EXISTS customer_presence_status VARCHAR(40) NOT NULL DEFAULT 'WAITING_FOR_CUSTOMER',
  ADD COLUMN IF NOT EXISTS customer_present_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS presence_recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collector_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS collection_status_reason TEXT;

ALTER TABLE cargo DROP CONSTRAINT IF EXISTS cargo_collection_status_check;
ALTER TABLE cargo ADD CONSTRAINT cargo_collection_status_check CHECK (collection_status IN (
  'WAITING_FOR_CUSTOMER','PRESENT_READY','GATE_PROCESSING','GATED_OUT',
  'FINANCIALLY_BLOCKED','RELEASE_CONDITION_BLOCKED','TEMPORARILY_UNAVAILABLE'
));
ALTER TABLE cargo DROP CONSTRAINT IF EXISTS cargo_customer_presence_status_check;
ALTER TABLE cargo ADD CONSTRAINT cargo_customer_presence_status_check CHECK (customer_presence_status IN (
  'WAITING_FOR_CUSTOMER','PRESENT_READY','TEMPORARILY_UNAVAILABLE'
));

UPDATE cargo SET collection_status=CASE
  WHEN gate_out_status IN ('Released','Emergency Released') THEN 'GATED_OUT'
  WHEN financial_status <> 'Fully Paid' THEN 'FINANCIALLY_BLOCKED'
  ELSE 'WAITING_FOR_CUSTOMER'
END;

CREATE TABLE IF NOT EXISTS cargo_collection_status_history (
  id BIGSERIAL PRIMARY KEY,
  cargo_id INTEGER NOT NULL REFERENCES cargo(id) ON DELETE RESTRICT,
  cargo_reference VARCHAR(100) NOT NULL,
  old_status VARCHAR(40),
  new_status VARCHAR(40) NOT NULL,
  reason TEXT,
  collector_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS cargo_collection_active_queue_idx
  ON cargo(collection_status,fully_paid_at,created_at,cargo_id)
  WHERE is_deleted=FALSE AND gate_out_status='Not Released';
CREATE INDEX IF NOT EXISTS cargo_collection_history_idx
  ON cargo_collection_status_history(cargo_id,changed_at DESC,id DESC);

ALTER TABLE gate_out_records
  ADD COLUMN IF NOT EXISTS customer_present_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS collector_details JSONB NOT NULL DEFAULT '{}'::jsonb;

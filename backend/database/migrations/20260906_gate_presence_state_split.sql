-- Follow-up kept separate because migration 045 may already be installed.
-- Physical presence must remain independent of computed financial/release state.
ALTER TABLE cargo
  ADD COLUMN IF NOT EXISTS customer_presence_status VARCHAR(40) NOT NULL DEFAULT 'WAITING_FOR_CUSTOMER';

ALTER TABLE cargo DROP CONSTRAINT IF EXISTS cargo_customer_presence_status_check;
ALTER TABLE cargo ADD CONSTRAINT cargo_customer_presence_status_check CHECK (customer_presence_status IN (
  'WAITING_FOR_CUSTOMER','PRESENT_READY','TEMPORARILY_UNAVAILABLE'
));

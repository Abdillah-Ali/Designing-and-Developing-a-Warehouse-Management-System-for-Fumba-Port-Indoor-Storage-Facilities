ALTER TABLE cargo ADD COLUMN IF NOT EXISTS storage_fully_paid_at TIMESTAMPTZ;
ALTER TABLE cargo ADD COLUMN IF NOT EXISTS fully_paid_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fully_paid_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS billing_verified_at TIMESTAMPTZ;

-- Legacy timestamps were recorded in the database session timezone. Use that
-- same timezone for conversion; never substitute migration execution time.
UPDATE payments SET billing_verified_at =
  (CASE WHEN gateway_provider='flutterwave' THEN verified_at ELSE confirmed_at END)
    AT TIME ZONE current_setting('TimeZone')
WHERE billing_verified_at IS NULL AND
 ((gateway_provider='flutterwave' AND gateway_status='SUCCESSFUL' AND reconciliation_status='MATCHED')
  OR (gateway_provider IS NULL AND status='Confirmed'));

CREATE OR REPLACE FUNCTION record_billing_verification() RETURNS trigger AS $$
BEGIN
  IF (NEW.gateway_provider='flutterwave' AND NEW.gateway_status='SUCCESSFUL' AND NEW.reconciliation_status='MATCHED')
     OR (NEW.gateway_provider IS NULL AND NEW.status='Confirmed') THEN
    IF TG_OP='UPDATE' THEN
      NEW.billing_verified_at := COALESCE(OLD.billing_verified_at, clock_timestamp());
    ELSE
      NEW.billing_verified_at := clock_timestamp();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS payment_billing_verification ON payments;
CREATE TRIGGER payment_billing_verification BEFORE INSERT OR UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION record_billing_verification();
CREATE INDEX IF NOT EXISTS cargo_fpfg_order ON cargo(fully_paid_at, created_at, cargo_id)
WHERE is_deleted=FALSE AND gate_out_status='Not Released';

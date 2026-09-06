-- Node/PostgreSQL Date values have millisecond precision. Record that precision
-- at verification rather than losing fractional milliseconds when reading it.
CREATE OR REPLACE FUNCTION record_billing_verification() RETURNS trigger AS $$
BEGIN
  IF (NEW.gateway_provider='flutterwave' AND NEW.gateway_status='SUCCESSFUL' AND NEW.reconciliation_status='MATCHED')
     OR (NEW.gateway_provider IS NULL AND NEW.status='Confirmed') THEN
    IF TG_OP='UPDATE' THEN
      NEW.billing_verified_at := COALESCE(OLD.billing_verified_at, date_trunc('milliseconds',clock_timestamp()));
    ELSE
      NEW.billing_verified_at := date_trunc('milliseconds',clock_timestamp());
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Integrity constraints added after the full-stack implementation audit.

CREATE UNIQUE INDEX IF NOT EXISTS idx_cargo_locations_one_current_per_cargo
  ON cargo_locations(cargo_id)
  WHERE is_current = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_requests_one_pending_per_workflow
  ON approval_requests(cargo_id, request_type)
  WHERE status = 'Pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_requests_one_pending_per_cargo
  ON dispatch_requests(cargo_id)
  WHERE status = 'Pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_customs_records_one_record_per_cargo
  ON customs_records(cargo_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_emergency_release_one_pending_per_cargo
  ON emergency_release_requests(cargo_id)
  WHERE status = 'Pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tariff_versions_one_active_per_tariff
  ON tariff_versions(tariff_id)
  WHERE is_active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_unique_billing_period
  ON invoices(cargo_id, billing_period_start, billing_period_end)
  WHERE status <> 'Cancelled';

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_reference_pending_or_confirmed
  ON payments(LOWER(bank_reference))
  WHERE bank_reference IS NOT NULL AND status = 'Confirmed';

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_totals_consistent_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_totals_consistent_check
  CHECK (
    total_amount = base_charge + penalties + adjustments
    AND outstanding_balance = total_amount - amount_paid
    AND amount_paid <= total_amount
  );

ALTER TABLE cargo_charge_ledgers DROP CONSTRAINT IF EXISTS cargo_charge_ledgers_amount_nonnegative_check;
ALTER TABLE cargo_charge_ledgers
  ADD CONSTRAINT cargo_charge_ledgers_amount_nonnegative_check
  CHECK (
    (ledger_type IN ('payment', 'reversal') AND amount >= 0)
    OR (ledger_type NOT IN ('payment', 'reversal') AND amount >= 0)
  );

CREATE OR REPLACE FUNCTION validate_capacity_configuration_reference()
RETURNS TRIGGER AS $$
DECLARE
  found_record INTEGER;
BEGIN
  IF NEW.entity_type = 'Warehouse' THEN
    SELECT 1 INTO found_record FROM warehouses WHERE id = NEW.entity_id;
  ELSIF NEW.entity_type = 'Zone' THEN
    SELECT 1 INTO found_record FROM zones WHERE id = NEW.entity_id;
  ELSIF NEW.entity_type = 'Rack' THEN
    SELECT 1 INTO found_record FROM racks WHERE id = NEW.entity_id;
  ELSIF NEW.entity_type = 'Level' THEN
    SELECT 1 INTO found_record FROM levels WHERE id = NEW.entity_id;
  ELSIF NEW.entity_type = 'Bin' THEN
    SELECT 1 INTO found_record FROM bins WHERE id = NEW.entity_id;
  ELSE
    RAISE EXCEPTION 'Unsupported capacity configuration entity type';
  END IF;

  IF found_record IS NULL THEN
    RAISE EXCEPTION 'Capacity configuration references a missing entity';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_capacity_configuration_reference_trigger ON capacity_configurations;
CREATE TRIGGER validate_capacity_configuration_reference_trigger
BEFORE INSERT OR UPDATE ON capacity_configurations
FOR EACH ROW EXECUTE FUNCTION validate_capacity_configuration_reference();

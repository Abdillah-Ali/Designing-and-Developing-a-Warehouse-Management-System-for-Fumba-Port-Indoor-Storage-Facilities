-- Integrity constraints added after the full-stack implementation audit.
-- This migration is retry-safe and preserves existing records. If historical
-- data violates a new uniqueness rule, the index is skipped with a notice so
-- the application can start and the data can be cleaned deliberately.

DO $$
BEGIN
  IF to_regclass('public.idx_cargo_locations_one_current_per_cargo') IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM cargo_locations
      WHERE is_current = TRUE
      GROUP BY cargo_id
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'Skipping idx_cargo_locations_one_current_per_cargo because duplicate current cargo locations exist.';
    ELSE
      CREATE UNIQUE INDEX idx_cargo_locations_one_current_per_cargo
        ON cargo_locations(cargo_id)
        WHERE is_current = TRUE;
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.idx_approval_requests_one_pending_per_workflow') IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM approval_requests
      WHERE status = 'Pending'
      GROUP BY cargo_id, request_type
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'Skipping idx_approval_requests_one_pending_per_workflow because duplicate pending approvals exist.';
    ELSE
      CREATE UNIQUE INDEX idx_approval_requests_one_pending_per_workflow
        ON approval_requests(cargo_id, request_type)
        WHERE status = 'Pending';
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.idx_dispatch_requests_one_pending_per_cargo') IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM dispatch_requests
      WHERE status = 'Pending'
      GROUP BY cargo_id
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'Skipping idx_dispatch_requests_one_pending_per_cargo because duplicate pending dispatch requests exist.';
    ELSE
      CREATE UNIQUE INDEX idx_dispatch_requests_one_pending_per_cargo
        ON dispatch_requests(cargo_id)
        WHERE status = 'Pending';
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.idx_customs_records_one_record_per_cargo') IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM customs_records
      GROUP BY cargo_id
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'Skipping idx_customs_records_one_record_per_cargo because duplicate customs records exist.';
    ELSE
      CREATE UNIQUE INDEX idx_customs_records_one_record_per_cargo
        ON customs_records(cargo_id);
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.idx_emergency_release_one_pending_per_cargo') IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM emergency_release_requests
      WHERE status = 'Pending'
      GROUP BY cargo_id
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'Skipping idx_emergency_release_one_pending_per_cargo because duplicate pending emergency releases exist.';
    ELSE
      CREATE UNIQUE INDEX idx_emergency_release_one_pending_per_cargo
        ON emergency_release_requests(cargo_id)
        WHERE status = 'Pending';
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.idx_tariff_versions_one_active_per_tariff') IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM tariff_versions
      WHERE is_active = TRUE
      GROUP BY tariff_id
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'Skipping idx_tariff_versions_one_active_per_tariff because duplicate active tariff versions exist.';
    ELSE
      CREATE UNIQUE INDEX idx_tariff_versions_one_active_per_tariff
        ON tariff_versions(tariff_id)
        WHERE is_active = TRUE;
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.idx_invoices_unique_billing_period') IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM invoices
      WHERE status <> 'Cancelled'
      GROUP BY cargo_id, billing_period_start, billing_period_end
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'Skipping idx_invoices_unique_billing_period because duplicate active invoice billing periods exist.';
    ELSE
      CREATE UNIQUE INDEX idx_invoices_unique_billing_period
        ON invoices(cargo_id, billing_period_start, billing_period_end)
        WHERE status <> 'Cancelled';
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.idx_payments_one_reference_pending_or_confirmed') IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM payments
      WHERE bank_reference IS NOT NULL
        AND status = 'Confirmed'
      GROUP BY LOWER(bank_reference)
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'Skipping idx_payments_one_reference_pending_or_confirmed because duplicate confirmed payment bank references exist.';
    ELSE
      CREATE UNIQUE INDEX idx_payments_one_reference_pending_or_confirmed
        ON payments(LOWER(bank_reference))
        WHERE bank_reference IS NOT NULL AND status = 'Confirmed';
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'invoices'::regclass
      AND conname = 'invoices_totals_consistent_check'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_totals_consistent_check
      CHECK (
        total_amount = base_charge + penalties + adjustments
        AND outstanding_balance = total_amount - amount_paid
        AND amount_paid <= total_amount
      )
      NOT VALID;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'cargo_charge_ledgers'::regclass
      AND conname = 'cargo_charge_ledgers_amount_nonnegative_check'
  ) THEN
    ALTER TABLE cargo_charge_ledgers
      ADD CONSTRAINT cargo_charge_ledgers_amount_nonnegative_check
      CHECK (amount >= 0)
      NOT VALID;
  END IF;
END;
$$;

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'validate_capacity_configuration_reference_trigger'
      AND tgrelid = 'capacity_configurations'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER validate_capacity_configuration_reference_trigger
    BEFORE INSERT OR UPDATE ON capacity_configurations
    FOR EACH ROW EXECUTE FUNCTION validate_capacity_configuration_reference();
  END IF;
END;
$$;

-- Phase 6: authoritative Finance policy, tariff identity, and payment confirmation.
ALTER TABLE cargo ADD COLUMN IF NOT EXISTS cargo_type_key VARCHAR(100);

UPDATE cargo c SET cargo_type_key=o.option_key
FROM cargo_option_values o
WHERE o.catalog_key='cargo_type' AND LOWER(o.storage_value)=LOWER(c.cargo_type)
  AND c.cargo_type_key IS NULL;

CREATE OR REPLACE FUNCTION set_cargo_type_key_from_catalog() RETURNS trigger AS $$
DECLARE resolved_key text;
BEGIN
  SELECT option_key INTO resolved_key FROM cargo_option_values
  WHERE catalog_key='cargo_type' AND (option_key=NEW.cargo_type OR storage_value=NEW.cargo_type)
  LIMIT 1;
  IF resolved_key IS NULL THEN RAISE EXCEPTION 'Cargo type is not present in the authoritative catalog.'; END IF;
  NEW.cargo_type_key := resolved_key;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS cargo_type_key_authority ON cargo;
CREATE TRIGGER cargo_type_key_authority BEFORE INSERT OR UPDATE OF cargo_type ON cargo
FOR EACH ROW EXECUTE FUNCTION set_cargo_type_key_from_catalog();

ALTER TABLE tariff_versions
  ADD COLUMN IF NOT EXISTS calculator_key VARCHAR(100) NOT NULL DEFAULT 'storage_started_day',
  ADD COLUMN IF NOT EXISTS cargo_type_key VARCHAR(100),
  ADD COLUMN IF NOT EXISTS tariff_scope VARCHAR(30) NOT NULL DEFAULT 'cargo_type',
  ADD COLUMN IF NOT EXISTS configuration_status VARCHAR(30) NOT NULL DEFAULT 'review_required',
  ADD COLUMN IF NOT EXISTS parameters JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE tariff_versions tv SET tariff_scope='default', cargo_type_key=NULL, configuration_status='ready'
WHERE LOWER(BTRIM(tv.cargo_type))='default';
UPDATE tariff_versions tv SET cargo_type_key=o.option_key, tariff_scope='cargo_type', configuration_status='ready'
FROM cargo_option_values o
WHERE o.catalog_key='cargo_type' AND LOWER(BTRIM(o.storage_value))=LOWER(BTRIM(tv.cargo_type));

ALTER TABLE tariff_versions DROP CONSTRAINT IF EXISTS tariff_versions_currency_check;
ALTER TABLE tariff_versions ADD CONSTRAINT tariff_versions_currency_check CHECK (currency='TZS');
ALTER TABLE tariff_versions DROP CONSTRAINT IF EXISTS tariff_versions_calculator_check;
ALTER TABLE tariff_versions ADD CONSTRAINT tariff_versions_calculator_check CHECK (calculator_key='storage_started_day');
ALTER TABLE tariff_versions DROP CONSTRAINT IF EXISTS tariff_versions_scope_check;
ALTER TABLE tariff_versions ADD CONSTRAINT tariff_versions_scope_check CHECK (
  (tariff_scope='default' AND cargo_type_key IS NULL) OR
  (tariff_scope='cargo_type' AND cargo_type_key IS NOT NULL));
ALTER TABLE tariff_versions DROP CONSTRAINT IF EXISTS tariff_versions_configuration_status_check;
ALTER TABLE tariff_versions ADD CONSTRAINT tariff_versions_configuration_status_check CHECK (configuration_status IN ('ready','review_required'));
ALTER TABLE tariff_versions DROP CONSTRAINT IF EXISTS tariff_versions_parameters_object_check;
ALTER TABLE tariff_versions ADD CONSTRAINT tariff_versions_parameters_object_check CHECK (jsonb_typeof(parameters)='object');
CREATE INDEX IF NOT EXISTS idx_tariff_versions_policy_match
  ON tariff_versions(configuration_status,is_active,tariff_scope,cargo_type_key,effective_from,effective_to);

ALTER TABLE payments ALTER COLUMN status DROP DEFAULT;
ALTER TABLE payments ALTER COLUMN status SET DEFAULT 'Pending Confirmation';
ALTER TABLE payments ALTER COLUMN confirmed_at DROP NOT NULL;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('Pending Confirmation','Confirmed','Reversed'));
ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'TZS';
ALTER TABLE payments ADD CONSTRAINT payments_currency_check CHECK (currency='TZS');

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_currency_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_currency_check CHECK (currency='TZS');

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_one_open_period
  ON invoices(cargo_id,billing_period_start,billing_period_end)
  WHERE status <> 'Cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_bank_reference_active
  ON payments(LOWER(bank_reference)) WHERE bank_reference IS NOT NULL AND status <> 'Reversed';

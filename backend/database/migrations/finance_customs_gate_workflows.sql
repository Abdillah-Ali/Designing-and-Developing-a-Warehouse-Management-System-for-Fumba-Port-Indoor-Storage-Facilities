-- Finance, Customs, and Gate workflow support.
-- Additive and idempotent so existing warehouse workflows remain intact.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION generate_role_public_reference()
RETURNS VARCHAR(80) AS $$
DECLARE
  generated_reference VARCHAR(80);
BEGIN
  LOOP
    generated_reference := 'ROLE-' || EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER || '-' || UPPER(ENCODE(gen_random_bytes(6), 'hex'));

    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM roles
      WHERE public_reference = generated_reference
    );
  END LOOP;

  RETURN generated_reference;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS public_reference VARCHAR(80);

ALTER TABLE roles
  ALTER COLUMN public_reference SET DEFAULT generate_role_public_reference();

DO $$
DECLARE
  role_record RECORD;
BEGIN
  FOR role_record IN
    SELECT role_name
    FROM roles
    WHERE public_reference IS NULL
    ORDER BY role_name
  LOOP
    UPDATE roles
    SET public_reference = generate_role_public_reference()
    WHERE role_name = role_record.role_name
      AND public_reference IS NULL;
  END LOOP;
END;
$$;

INSERT INTO roles (role_name, role_description, public_reference)
VALUES
  ('Finance Officer', 'Finance access for cargo charges, invoices, payments, tariffs, and financial reports.', generate_role_public_reference()),
  ('Customs Officer', 'Customs access for cargo inspection, hold, document request, rejection, and clearance workflows.', generate_role_public_reference()),
  ('Gate Officer', 'Gate access for release validation, gate-out records, and emergency release requests.', generate_role_public_reference())
ON CONFLICT (role_name) DO UPDATE
SET role_description = EXCLUDED.role_description;

CREATE TABLE IF NOT EXISTS permissions (
  permission_key VARCHAR(120) PRIMARY KEY,
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key VARCHAR(120) NOT NULL REFERENCES permissions(permission_key) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, permission_key)
);

INSERT INTO permissions (permission_key, description)
VALUES
  ('finance.dashboard.view', 'View finance dashboard metrics.'),
  ('finance.charges.view', 'View cargo charge calculations.'),
  ('finance.invoices.create', 'Create draft invoices.'),
  ('finance.invoices.issue', 'Issue invoices.'),
  ('finance.invoices.view', 'View invoices.'),
  ('finance.invoices.cancel', 'Cancel unpaid invoices with justification.'),
  ('finance.payments.record', 'Record and confirm bank payments.'),
  ('finance.payments.confirm', 'Confirm received payment records.'),
  ('finance.reports.view', 'View financial reports.'),
  ('finance.tariffs.view', 'View tariff versions.'),
  ('finance.tariffs.create', 'Create tariff versions.'),
  ('finance.tariffs.update', 'Update unused tariff versions.'),
  ('finance.tariffs.activate', 'Activate or deactivate tariff versions.'),
  ('customs.dashboard.view', 'View customs dashboard metrics.'),
  ('customs.cargo.view', 'View registered cargo for customs processing.'),
  ('customs.inspections.create', 'Start customs inspections.'),
  ('customs.inspections.update', 'Update customs inspection notes and document requests.'),
  ('customs.clearance.update', 'Place cargo on hold, reject, or clear cargo.'),
  ('customs.history.view', 'View customs status history.'),
  ('gate.dashboard.view', 'View gate dashboard metrics.'),
  ('gate.release_queue.view', 'View release queue.'),
  ('gate.release.validate', 'Validate release eligibility.'),
  ('gate.gate_out.confirm', 'Confirm gate-out release.'),
  ('gate.emergency_release.request', 'Request emergency release approval.'),
  ('gate.history.view', 'View gate-out history.'),
  ('gate.emergency_release.approve', 'Approve or reject emergency release requests.')
ON CONFLICT (permission_key) DO UPDATE
SET description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
JOIN permissions p ON p.permission_key = ANY(ARRAY[
  'finance.dashboard.view',
  'finance.charges.view',
  'finance.invoices.create',
  'finance.invoices.issue',
  'finance.invoices.view',
  'finance.invoices.cancel',
  'finance.payments.record',
  'finance.payments.confirm',
  'finance.reports.view',
  'finance.tariffs.view',
  'finance.tariffs.create',
  'finance.tariffs.update',
  'finance.tariffs.activate'
])
WHERE r.role_name = 'Finance Officer'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
JOIN permissions p ON p.permission_key = ANY(ARRAY[
  'customs.dashboard.view',
  'customs.cargo.view',
  'customs.inspections.create',
  'customs.inspections.update',
  'customs.clearance.update',
  'customs.history.view'
])
WHERE r.role_name = 'Customs Officer'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
JOIN permissions p ON p.permission_key = ANY(ARRAY[
  'gate.dashboard.view',
  'gate.release_queue.view',
  'gate.release.validate',
  'gate.gate_out.confirm',
  'gate.emergency_release.request',
  'gate.history.view'
])
WHERE r.role_name = 'Gate Officer'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.permission_key
FROM roles r
JOIN permissions p ON p.permission_key = ANY(ARRAY['gate.history.view', 'gate.emergency_release.approve'])
WHERE r.role_name IN ('Supervisor', 'System Admin')
ON CONFLICT DO NOTHING;

ALTER TABLE cargo
  ADD COLUMN IF NOT EXISTS charge_start_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS charge_end_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS financial_status VARCHAR(40) NOT NULL DEFAULT 'Unbilled',
  ADD COLUMN IF NOT EXISTS dispatch_status VARCHAR(40) NOT NULL DEFAULT 'Not Requested',
  ADD COLUMN IF NOT EXISTS gate_out_status VARCHAR(40) NOT NULL DEFAULT 'Not Released',
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMP;

UPDATE cargo
SET charge_start_at = COALESCE(charge_start_at, created_at, received_datetime, CURRENT_TIMESTAMP),
    charge_end_at = COALESCE(charge_end_at, released_at),
    released_at = COALESCE(released_at, charge_end_at),
    financial_status = COALESCE(NULLIF(financial_status, ''), 'Unbilled'),
    dispatch_status = COALESCE(NULLIF(dispatch_status, ''), 'Not Requested'),
    gate_out_status = CASE
      WHEN placement_status = 'Dispatched' OR released_at IS NOT NULL OR charge_end_at IS NOT NULL THEN 'Released'
      ELSE COALESCE(NULLIF(gate_out_status, ''), 'Not Released')
    END,
    customs_status = CASE
      WHEN customs_status IS NULL OR customs_status = '' OR customs_status = 'Not Required' THEN 'Pending Inspection'
      WHEN LOWER(customs_status) = 'hold' THEN 'On Hold'
      WHEN LOWER(customs_status) = 'clear' THEN 'Cleared'
      ELSE customs_status
    END;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cargo WHERE charge_start_at IS NULL) THEN
    ALTER TABLE cargo ALTER COLUMN charge_start_at SET NOT NULL;
  ELSE
    RAISE NOTICE 'Skipping cargo.charge_start_at NOT NULL because existing cargo still contains NULL charge starts.';
  END IF;
END;
$$;

ALTER TABLE cargo ALTER COLUMN charge_start_at SET DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'cargo'::regclass
      AND conname = 'cargo_customs_status_check'
  ) THEN
    ALTER TABLE cargo
      ADD CONSTRAINT cargo_customs_status_check
      CHECK (customs_status IN (
        'Pending Inspection',
        'Inspection In Progress',
        'Documents Required',
        'On Hold',
        'Cleared',
        'Rejected'
      ))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'cargo'::regclass
      AND conname = 'cargo_financial_status_check'
  ) THEN
    ALTER TABLE cargo
      ADD CONSTRAINT cargo_financial_status_check
      CHECK (financial_status IN (
        'Unbilled',
        'Outstanding',
        'Partially Paid',
        'Fully Paid',
        'Released With Balance'
      ))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'cargo'::regclass
      AND conname = 'cargo_dispatch_status_check'
  ) THEN
    ALTER TABLE cargo
      ADD CONSTRAINT cargo_dispatch_status_check
      CHECK (dispatch_status IN (
        'Not Requested',
        'Awaiting Approval',
        'Approved',
        'Rejected',
        'Released',
        'Emergency Released',
        'Cancelled'
      ))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'cargo'::regclass
      AND conname = 'cargo_gate_out_status_check'
  ) THEN
    ALTER TABLE cargo
      ADD CONSTRAINT cargo_gate_out_status_check
      CHECK (gate_out_status IN ('Not Released', 'Released', 'Emergency Released'))
      NOT VALID;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_cargo_charge_start ON cargo(charge_start_at);
CREATE INDEX IF NOT EXISTS idx_cargo_financial_status ON cargo(financial_status);
CREATE INDEX IF NOT EXISTS idx_cargo_customs_status ON cargo(customs_status);
CREATE INDEX IF NOT EXISTS idx_cargo_dispatch_status ON cargo(dispatch_status);
CREATE INDEX IF NOT EXISTS idx_cargo_gate_out_status ON cargo(gate_out_status);

CREATE TABLE IF NOT EXISTS tariffs (
  id SERIAL PRIMARY KEY,
  public_reference VARCHAR(40) UNIQUE NOT NULL,
  tariff_name VARCHAR(160) NOT NULL,
  cargo_type VARCHAR(100) NOT NULL,
  charging_unit VARCHAR(60) NOT NULL,
  description TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tariff_name, cargo_type, charging_unit)
);

CREATE TABLE IF NOT EXISTS tariff_versions (
  id SERIAL PRIMARY KEY,
  public_reference VARCHAR(40) UNIQUE NOT NULL,
  tariff_id INTEGER NOT NULL REFERENCES tariffs(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL DEFAULT 1,
  cargo_type VARCHAR(100) NOT NULL,
  charging_unit VARCHAR(60) NOT NULL,
  daily_rate NUMERIC(14, 4) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'TZS',
  minimum_billable_days INTEGER NOT NULL DEFAULT 1,
  grace_period_days INTEGER NOT NULL DEFAULT 0,
  penalty_type VARCHAR(30) NOT NULL DEFAULT 'none',
  penalty_rate NUMERIC(14, 4) NOT NULL DEFAULT 0,
  fixed_penalty NUMERIC(14, 4) NOT NULL DEFAULT 0,
  effective_from TIMESTAMP NOT NULL,
  effective_to TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  activated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  activated_at TIMESTAMP,
  deactivated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deactivated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (daily_rate >= 0),
  CHECK (minimum_billable_days >= 1),
  CHECK (grace_period_days >= 0),
  CHECK (penalty_type IN ('none', 'percentage', 'fixed')),
  CHECK (penalty_rate >= 0),
  CHECK (fixed_penalty >= 0),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE (tariff_id, version_number)
);

CREATE TABLE IF NOT EXISTS cargo_charge_ledgers (
  id SERIAL PRIMARY KEY,
  public_reference VARCHAR(40) UNIQUE NOT NULL,
  cargo_id INTEGER NOT NULL REFERENCES cargo(id) ON DELETE RESTRICT,
  tariff_version_id INTEGER REFERENCES tariff_versions(id) ON DELETE RESTRICT,
  invoice_id INTEGER,
  ledger_type VARCHAR(40) NOT NULL,
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'TZS',
  period_start TIMESTAMP,
  period_end TIMESTAMP,
  notes TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'posted',
  authorized_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ledger_type IN ('storage', 'penalty', 'adjustment', 'payment', 'reversal')),
  CHECK (status IN ('draft', 'approved', 'posted', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  public_invoice_number VARCHAR(50) UNIQUE NOT NULL,
  cargo_id INTEGER NOT NULL REFERENCES cargo(id) ON DELETE RESTRICT,
  tariff_version_id INTEGER REFERENCES tariff_versions(id) ON DELETE RESTRICT,
  status VARCHAR(40) NOT NULL DEFAULT 'Draft',
  billing_period_start TIMESTAMP NOT NULL,
  billing_period_end TIMESTAMP NOT NULL,
  charge_start_at TIMESTAMP NOT NULL,
  charge_end_at TIMESTAMP,
  billable_days INTEGER NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'TZS',
  base_charge NUMERIC(14, 2) NOT NULL DEFAULT 0,
  penalties NUMERIC(14, 2) NOT NULL DEFAULT 0,
  adjustments NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
  outstanding_balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  payment_status VARCHAR(40) NOT NULL DEFAULT 'Unpaid',
  tariff_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  calculation_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  issued_at TIMESTAMP,
  cancelled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMP,
  cancellation_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('Draft', 'Issued', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled')),
  CHECK (payment_status IN ('Unpaid', 'Partially Paid', 'Paid')),
  CHECK (billable_days >= 1),
  CHECK (base_charge >= 0),
  CHECK (penalties >= 0),
  CHECK (total_amount >= 0),
  CHECK (amount_paid >= 0),
  CHECK (outstanding_balance >= 0),
  CHECK (billing_period_end > billing_period_start)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'cargo_charge_ledgers'::regclass
      AND conname = 'cargo_charge_ledgers_invoice_fkey'
  ) THEN
    ALTER TABLE cargo_charge_ledgers
      ADD CONSTRAINT cargo_charge_ledgers_invoice_fkey
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
      NOT VALID;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_type VARCHAR(40) NOT NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(14, 4) NOT NULL DEFAULT 1,
  unit_rate NUMERIC(14, 4) NOT NULL DEFAULT 0,
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (line_type IN ('storage', 'penalty', 'adjustment')),
  CHECK (quantity >= 0),
  CHECK (unit_rate >= 0)
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  public_reference VARCHAR(40) UNIQUE NOT NULL,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount NUMERIC(14, 2) NOT NULL,
  bank_name VARCHAR(160) NOT NULL,
  bank_reference VARCHAR(160),
  payment_date TIMESTAMP NOT NULL,
  proof_of_payment TEXT,
  notes TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'Confirmed',
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (amount > 0),
  CHECK (status IN ('Confirmed', 'Reversed'))
);

DO $$
BEGIN
  IF to_regclass('public.idx_payments_unique_bank_reference') IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM payments
      WHERE bank_reference IS NOT NULL
        AND status = 'Confirmed'
      GROUP BY LOWER(bank_reference)
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'Skipping idx_payments_unique_bank_reference because duplicate confirmed payment bank references exist.';
    ELSE
      CREATE UNIQUE INDEX idx_payments_unique_bank_reference
        ON payments(LOWER(bank_reference))
        WHERE bank_reference IS NOT NULL AND status = 'Confirmed';
    END IF;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS payment_reversals (
  id SERIAL PRIMARY KEY,
  public_reference VARCHAR(40) UNIQUE NOT NULL,
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  reversed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reversed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS customs_records (
  id SERIAL PRIMARY KEY,
  public_reference VARCHAR(40) UNIQUE NOT NULL,
  cargo_id INTEGER NOT NULL REFERENCES cargo(id) ON DELETE RESTRICT,
  status VARCHAR(40) NOT NULL DEFAULT 'Pending Inspection',
  inspection_started_at TIMESTAMP,
  inspection_completed_at TIMESTAMP,
  inspection_notes TEXT,
  documents_requested TEXT,
  officer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN (
    'Pending Inspection',
    'Inspection In Progress',
    'Documents Required',
    'On Hold',
    'Cleared',
    'Rejected'
  ))
);

CREATE TABLE IF NOT EXISTS customs_status_history (
  id SERIAL PRIMARY KEY,
  public_reference VARCHAR(40) UNIQUE NOT NULL,
  cargo_id INTEGER NOT NULL REFERENCES cargo(id) ON DELETE RESTRICT,
  customs_record_id INTEGER REFERENCES customs_records(id) ON DELETE SET NULL,
  previous_status VARCHAR(40),
  new_status VARCHAR(40) NOT NULL,
  notes TEXT,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE dispatch_requests
  ADD COLUMN IF NOT EXISTS gate_released_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS gate_released_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS release_notes TEXT;

CREATE TABLE IF NOT EXISTS gate_out_records (
  id SERIAL PRIMARY KEY,
  public_reference VARCHAR(40) UNIQUE NOT NULL,
  cargo_id INTEGER UNIQUE NOT NULL REFERENCES cargo(id) ON DELETE RESTRICT,
  dispatch_request_id INTEGER REFERENCES dispatch_requests(id) ON DELETE SET NULL,
  release_type VARCHAR(30) NOT NULL DEFAULT 'Normal',
  vehicle_number VARCHAR(80) NOT NULL,
  driver_name VARCHAR(150) NOT NULL,
  gate_notes TEXT,
  released_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  outstanding_amount_snapshot NUMERIC(14, 2) NOT NULL DEFAULT 0,
  eligibility_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (release_type IN ('Normal', 'Emergency'))
);

CREATE TABLE IF NOT EXISTS emergency_release_requests (
  id SERIAL PRIMARY KEY,
  public_reference VARCHAR(40) UNIQUE NOT NULL,
  cargo_id INTEGER NOT NULL REFERENCES cargo(id) ON DELETE RESTRICT,
  dispatch_request_id INTEGER REFERENCES dispatch_requests(id) ON DELETE SET NULL,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  justification TEXT NOT NULL,
  blocked_requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(30) NOT NULL DEFAULT 'Pending',
  decision_notes TEXT,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMP,
  rejected_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMP,
  gate_confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  gate_confirmed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Completed', 'Cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_tariff_versions_cargo_unit_dates
  ON tariff_versions(cargo_type, charging_unit, effective_from, COALESCE(effective_to, '9999-12-31'::timestamp));
CREATE INDEX IF NOT EXISTS idx_tariff_versions_active
  ON tariff_versions(is_active, cargo_type, charging_unit);
CREATE INDEX IF NOT EXISTS idx_invoices_cargo_status
  ON invoices(cargo_id, status, billing_period_end DESC);
CREATE INDEX IF NOT EXISTS idx_payments_invoice_status
  ON payments(invoice_id, status, payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_customs_records_cargo_status
  ON customs_records(cargo_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_customs_history_cargo
  ON customs_status_history(cargo_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_gate_out_records_released_at
  ON gate_out_records(released_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergency_release_status
  ON emergency_release_requests(status, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_tariffs_updated_at'
      AND tgrelid = 'tariffs'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER set_tariffs_updated_at
    BEFORE UPDATE ON tariffs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_tariff_versions_updated_at'
      AND tgrelid = 'tariff_versions'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER set_tariff_versions_updated_at
    BEFORE UPDATE ON tariff_versions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_invoices_updated_at'
      AND tgrelid = 'invoices'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER set_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_customs_records_updated_at'
      AND tgrelid = 'customs_records'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER set_customs_records_updated_at
    BEFORE UPDATE ON customs_records
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_emergency_release_requests_updated_at'
      AND tgrelid = 'emergency_release_requests'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER set_emergency_release_requests_updated_at
    BEFORE UPDATE ON emergency_release_requests
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

-- Tariffs and prices are operational business data. They are intentionally not
-- created during schema initialization and must be configured by Finance.

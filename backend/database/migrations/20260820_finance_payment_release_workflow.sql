-- Management-governed tariffs, automatic gateway billing, and dispatch-free release readiness.
ALTER TABLE tariff_versions
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS rejected_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS supporting_notes TEXT,
  ADD COLUMN IF NOT EXISTS minimum_charge NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS operationally_used_at TIMESTAMP;

UPDATE tariff_versions SET approval_status='APPROVED', approved_at=COALESCE(activated_at,created_at)
WHERE is_active=TRUE AND approval_status='DRAFT';

ALTER TABLE tariff_versions DROP CONSTRAINT IF EXISTS tariff_versions_approval_status_check;
ALTER TABLE tariff_versions ADD CONSTRAINT tariff_versions_approval_status_check
  CHECK (approval_status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED'));
CREATE INDEX IF NOT EXISTS idx_tariff_versions_approval ON tariff_versions(approval_status,is_active,effective_from);

CREATE TABLE IF NOT EXISTS tariff_approval_history (
  id BIGSERIAL PRIMARY KEY,
  tariff_version_id INTEGER NOT NULL REFERENCES tariff_versions(id) ON DELETE RESTRICT,
  action VARCHAR(32) NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (action IN ('CREATED','SUBMITTED','APPROVED','REJECTED','ACTIVATED','DEACTIVATED'))
);

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(50),
  ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_payment_reference_unique ON invoices(payment_reference) WHERE payment_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_open_auto_invoice_per_cargo ON invoices(cargo_id)
  WHERE auto_generated=TRUE AND status <> 'Cancelled';

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS cargo_id INTEGER REFERENCES cargo(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(50),
  ADD COLUMN IF NOT EXISTS expected_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS amount_received NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'TZS',
  ADD COLUMN IF NOT EXISTS gateway_provider VARCHAR(40),
  ADD COLUMN IF NOT EXISTS gateway_transaction_id VARCHAR(160),
  ADD COLUMN IF NOT EXISTS gateway_event_id VARCHAR(160),
  ADD COLUMN IF NOT EXISTS gateway_status VARCHAR(24) NOT NULL DEFAULT 'NOT_INITIATED',
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(40),
  ADD COLUMN IF NOT EXISTS initiated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS reconciliation_status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS gateway_response JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('Pending Confirmation','Confirmed','Reversed','Gateway Pending','Gateway Failed','Gateway Exception'));
CREATE UNIQUE INDEX IF NOT EXISTS payments_gateway_event_unique ON payments(gateway_event_id) WHERE gateway_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_gateway_transaction_unique ON payments(gateway_provider,gateway_transaction_id) WHERE gateway_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_wms_reference_idx ON payments(payment_reference);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  provider VARCHAR(40) NOT NULL,
  event_id VARCHAR(160) NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  processing_status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP,
  UNIQUE(provider,event_id)
);

ALTER TABLE cargo
  ADD COLUMN IF NOT EXISTS release_readiness_status VARCHAR(32) NOT NULL DEFAULT 'BLOCKED',
  ADD COLUMN IF NOT EXISTS release_readiness_blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ready_for_release_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS release_workflow_version SMALLINT NOT NULL DEFAULT 2;

INSERT INTO permissions(permission_key,description) VALUES
 ('finance.tariffs.submit','Submit tariff versions for Management approval.'),
 ('finance.payments.initiate','Initiate an external sandbox payment request.'),
 ('management.tariffs.view','View tariff approval requests.'),
 ('management.tariffs.decide','Approve or reject tariff versions.'),
 ('staff.release_queue.view','View cargo automatically ready for release.')
ON CONFLICT(permission_key) DO UPDATE SET description=EXCLUDED.description;

INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.permission_key FROM roles r JOIN permissions p ON
 (r.role_name='Finance Officer' AND p.permission_key IN ('finance.tariffs.submit','finance.payments.initiate')) OR
 (r.role_name='Management' AND p.permission_key IN ('management.tariffs.view','management.tariffs.decide')) OR
 (r.role_name='Warehouse Staff' AND p.permission_key='staff.release_queue.view')
ON CONFLICT DO NOTHING;

-- Manual invoice/payment success permissions are deliberately removed from Finance.
DELETE FROM role_permissions rp USING roles r
WHERE rp.role_id=r.id AND r.role_name='Finance Officer'
  AND rp.permission_key IN ('finance.invoices.create','finance.invoices.issue','finance.payments.confirm');

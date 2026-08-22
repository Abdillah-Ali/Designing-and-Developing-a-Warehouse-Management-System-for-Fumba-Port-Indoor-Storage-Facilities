CREATE TABLE IF NOT EXISTS payment_email_deliveries (
  id BIGSERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  email_type VARCHAR(40) NOT NULL DEFAULT 'INITIAL_PAYMENT_LINK',
  recipient VARCHAR(150),
  delivery_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMP,
  sent_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (delivery_status IN ('PENDING','SENT','FAILED','SKIPPED')),
  CHECK (attempt_count >= 0),
  UNIQUE(invoice_id,email_type)
);

CREATE INDEX IF NOT EXISTS payment_email_deliveries_retry_idx
  ON payment_email_deliveries(delivery_status,last_attempt_at)
  WHERE delivery_status IN ('PENDING','FAILED');

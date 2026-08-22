-- One invoice/master obligation may have many independently verified payment attempts.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS payment_public_token VARCHAR(96);

UPDATE invoices
SET payment_public_token = ENCODE(gen_random_bytes(32), 'hex')
WHERE payment_public_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_payment_public_token_unique
  ON invoices(payment_public_token) WHERE payment_public_token IS NOT NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS attempt_reference VARCHAR(50),
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(120);

-- Existing gateway payments remain valid single-attempt history.
UPDATE payments
SET attempt_reference = public_reference
WHERE attempt_reference IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_attempt_reference_unique
  ON payments(attempt_reference) WHERE attempt_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key_unique
  ON payments(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_invoice_installment_history_idx
  ON payments(invoice_id, created_at, id);


ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_automatic_payment_token_required;
ALTER TABLE invoices ADD CONSTRAINT invoices_automatic_payment_token_required
  CHECK (auto_generated = FALSE OR payment_public_token IS NOT NULL);

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_payment_token_format_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_payment_token_format_check
  CHECK (payment_public_token IS NULL OR payment_public_token ~ '^[0-9a-f]{64}$');

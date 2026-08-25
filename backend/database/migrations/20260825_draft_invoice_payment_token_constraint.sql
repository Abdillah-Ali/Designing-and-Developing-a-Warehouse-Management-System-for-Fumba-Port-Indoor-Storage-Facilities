-- Draft registration invoices intentionally do not expose a public payment
-- link until a supervisor approves the cargo. Cancelled invoices likewise
-- have their payment token revoked.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_automatic_payment_token_required;
ALTER TABLE invoices ADD CONSTRAINT invoices_automatic_payment_token_required
  CHECK (
    auto_generated = FALSE
    OR status IN ('Draft', 'Cancelled')
    OR payment_public_token IS NOT NULL
  );

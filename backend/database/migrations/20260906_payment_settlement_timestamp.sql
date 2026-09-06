-- A payment attempt creation time is not a verified settlement time.
ALTER TABLE payments ALTER COLUMN confirmed_at DROP DEFAULT;

UPDATE payments
SET confirmed_at = NULL
WHERE gateway_provider = 'flutterwave'
  AND NOT (
    status = 'Confirmed'
    AND gateway_status = 'SUCCESSFUL'
    AND reconciliation_status = 'MATCHED'
  );

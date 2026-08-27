-- Reporting filters use these operational columns repeatedly. Partial indexes keep
-- deleted/cancelled history reportable without enlarging the hot indexes.
CREATE INDEX IF NOT EXISTS idx_cargo_reports_created_status
  ON cargo(created_at DESC, registration_status, customs_status)
  WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_cargo_reports_warehouse_type
  ON cargo(warehouse_id, cargo_type, created_at DESC)
  WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_invoices_reports_status_created
  ON invoices(payment_status, created_at DESC)
  WHERE status <> 'Cancelled';
CREATE INDEX IF NOT EXISTS idx_payments_reports_verified
  ON payments(verified_at DESC, invoice_id)
  WHERE status = 'Confirmed' AND reconciliation_status = 'MATCHED';
CREATE INDEX IF NOT EXISTS idx_audit_logs_reports_created
  ON audit_logs(created_at DESC, module, action);
CREATE INDEX IF NOT EXISTS idx_gate_out_reports_released
  ON gate_out_records(released_at DESC);

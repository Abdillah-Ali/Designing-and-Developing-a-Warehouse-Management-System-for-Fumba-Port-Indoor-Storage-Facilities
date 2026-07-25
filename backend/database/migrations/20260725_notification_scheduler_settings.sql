INSERT INTO system_settings (setting_key, setting_value)
VALUES
  ('cargo_pending_review_escalation_enabled', 'true'::jsonb),
  ('cargo_pending_review_escalation_interval_ms', '300000'::jsonb),
  ('cargo_pending_review_escalation_target_role', '"System Admin"'::jsonb),
  ('cargo_pending_review_escalation_repeat_hours', '0'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

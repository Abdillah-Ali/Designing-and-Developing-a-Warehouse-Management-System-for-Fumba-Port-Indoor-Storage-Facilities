INSERT INTO system_settings (setting_key, setting_value)
VALUES ('maximum_active_system_administrators', '3'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

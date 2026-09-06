CREATE TABLE IF NOT EXISTS notification_email_deliveries (
  id BIGSERIAL PRIMARY KEY,
  notification_id BIGINT NOT NULL UNIQUE REFERENCES notifications(id) ON DELETE CASCADE,
  recipient_user_id INTEGER NOT NULL REFERENCES users(id),
  recipient VARCHAR(150) NOT NULL,
  delivery_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  last_error VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notification_email_delivery_status_check CHECK (delivery_status IN ('PENDING','PROCESSING','SENT','FAILED','SKIPPED'))
);

CREATE INDEX IF NOT EXISTS notification_email_delivery_queue_idx
  ON notification_email_deliveries(delivery_status,next_attempt_at,id);

CREATE OR REPLACE FUNCTION queue_notification_email_delivery()
RETURNS TRIGGER AS $$
DECLARE recipient_email VARCHAR(150);
BEGIN
  IF NEW.recipient_user_id IS NULL THEN RETURN NEW; END IF;
  SELECT email INTO recipient_email FROM users WHERE id=NEW.recipient_user_id AND status='active';
  IF recipient_email IS NULL OR recipient_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RETURN NEW; END IF;
  INSERT INTO notification_email_deliveries(notification_id,recipient_user_id,recipient)
  VALUES(NEW.id,NEW.recipient_user_id,recipient_email)
  ON CONFLICT(notification_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notifications_queue_email_delivery ON notifications;
CREATE TRIGGER notifications_queue_email_delivery
AFTER INSERT ON notifications
FOR EACH ROW EXECUTE FUNCTION queue_notification_email_delivery();

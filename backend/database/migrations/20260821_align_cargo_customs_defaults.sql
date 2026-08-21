-- Align legacy display state with the authoritative Customs workflow for new cargo.
UPDATE cargo
SET customs_status = 'Pending Inspection',
    customs_status_key = COALESCE(customs_status_key, 'pending_inspection')
WHERE customs_status = 'Not Required';

ALTER TABLE cargo
  ALTER COLUMN customs_status SET DEFAULT 'Pending Inspection';

ALTER TABLE cargo
  ADD COLUMN IF NOT EXISTS release_type VARCHAR(30) NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS management_release_status VARCHAR(30) NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN IF NOT EXISTS management_release_requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS management_release_requested_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS management_release_reason VARCHAR(1000),
  ADD COLUMN IF NOT EXISTS management_release_decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS management_release_decided_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS management_release_decision_remarks VARCHAR(1000),
  ADD COLUMN IF NOT EXISTS management_release_submission_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS management_release_finance_review_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS management_release_waived_amount NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE cargo DROP CONSTRAINT IF EXISTS cargo_release_type_check;
ALTER TABLE cargo ADD CONSTRAINT cargo_release_type_check CHECK (release_type IN ('NORMAL','MANAGEMENT')) NOT VALID;
ALTER TABLE cargo DROP CONSTRAINT IF EXISTS cargo_management_release_status_check;
ALTER TABLE cargo ADD CONSTRAINT cargo_management_release_status_check CHECK (management_release_status IN ('NOT_REQUIRED','PENDING','APPROVED','REJECTED')) NOT VALID;

CREATE TABLE IF NOT EXISTS management_release_requests (
  id BIGSERIAL PRIMARY KEY,
  public_reference VARCHAR(50) UNIQUE NOT NULL,
  cargo_id INTEGER NOT NULL REFERENCES cargo(id) ON DELETE RESTRICT,
  submission_number INTEGER NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  request_reason VARCHAR(1000) NOT NULL,
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMP,
  decision_remarks VARCHAR(1000),
  historical_accrued_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  waived_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  finance_review_required BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(cargo_id, submission_number),
  CHECK (status IN ('PENDING','APPROVED','REJECTED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_management_release_one_pending ON management_release_requests(cargo_id) WHERE status='PENDING';
CREATE INDEX IF NOT EXISTS idx_management_release_queue ON management_release_requests(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_cargo_management_release ON cargo(management_release_status, warehouse_id);

ALTER TABLE gate_out_records DROP CONSTRAINT IF EXISTS gate_out_records_release_type_check;
ALTER TABLE gate_out_records ADD CONSTRAINT gate_out_records_release_type_check CHECK (release_type IN ('Normal','Emergency','Management')) NOT VALID;

INSERT INTO permissions(permission_key,description,module,system_protected) VALUES
 ('management_release.request','Request, convert, or resubmit a Management Release.','management_release',TRUE),
 ('management_release.view','View Management Release requests and financial treatment.','management_release',TRUE),
 ('management_release.decide','Approve or reject a pending Management Release.','management_release',TRUE)
ON CONFLICT(permission_key) DO UPDATE SET description=EXCLUDED.description,module=EXCLUDED.module,system_protected=EXCLUDED.system_protected;

INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.permission_key FROM roles r CROSS JOIN permissions p
WHERE (r.role_key='warehouse_supervisor' AND p.permission_key IN ('management_release.request','management_release.view'))
   OR (r.role_key='management' AND p.permission_key IN ('management_release.view','management_release.decide'))
   OR (r.role_key IN ('finance_officer','gate_officer','warehouse_staff') AND p.permission_key='management_release.view')
   OR (r.role_key='system_administrator' AND p.permission_key IN ('management_release.request','management_release.view','management_release.decide'))
ON CONFLICT DO NOTHING;

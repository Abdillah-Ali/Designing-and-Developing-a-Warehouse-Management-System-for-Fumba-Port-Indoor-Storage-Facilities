CREATE TABLE IF NOT EXISTS bin_rule_categories (
  id SERIAL PRIMARY KEY,
  public_reference VARCHAR(80) UNIQUE NOT NULL DEFAULT ('BRC-' || UPPER(ENCODE(gen_random_bytes(8), 'hex'))),
  category_code VARCHAR(80) UNIQUE NOT NULL,
  category_name VARCHAR(150) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE bin_rules
  ADD COLUMN IF NOT EXISTS public_reference VARCHAR(80),
  ADD COLUMN IF NOT EXISTS category_id INTEGER,
  ADD COLUMN IF NOT EXISTS rule_type VARCHAR(40) NOT NULL DEFAULT 'validation',
  ADD COLUMN IF NOT EXISTS evaluator_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS execution_targets TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS violation_action VARCHAR(40),
  ADD COLUMN IF NOT EXISTS severity VARCHAR(20),
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

UPDATE bin_rules
SET public_reference = 'BR-' || UPPER(ENCODE(gen_random_bytes(8), 'hex'))
WHERE public_reference IS NULL;

ALTER TABLE bin_rules
  ALTER COLUMN public_reference SET DEFAULT ('BR-' || UPPER(ENCODE(gen_random_bytes(8), 'hex'))),
  ALTER COLUMN public_reference SET NOT NULL,
  ALTER COLUMN is_active SET DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS bin_rules_public_reference_key ON bin_rules(public_reference);
CREATE INDEX IF NOT EXISTS idx_bin_rules_execution_targets ON bin_rules USING GIN(execution_targets);
CREATE INDEX IF NOT EXISTS idx_bin_rules_active_priority ON bin_rules(is_active, priority);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bin_rules_priority_check') THEN
    ALTER TABLE bin_rules ADD CONSTRAINT bin_rules_priority_check CHECK (priority > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bin_rules_rule_type_check') THEN
    ALTER TABLE bin_rules ADD CONSTRAINT bin_rules_rule_type_check
      CHECK (rule_type IN ('validation','filter','ordering')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bin_rules_violation_action_check') THEN
    ALTER TABLE bin_rules ADD CONSTRAINT bin_rules_violation_action_check
      CHECK (violation_action IS NULL OR violation_action IN ('warning','block','supervisor_approval','customs_approval','finance_approval','manual_override')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bin_rules_severity_check') THEN
    ALTER TABLE bin_rules ADD CONSTRAINT bin_rules_severity_check
      CHECK (severity IS NULL OR severity IN ('info','low','medium','high','critical')) NOT VALID;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bin_rules_category_id_fkey'
  ) THEN
    ALTER TABLE bin_rules
      ADD CONSTRAINT bin_rules_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES bin_rule_categories(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS bin_rule_audit_history (
  id BIGSERIAL PRIMARY KEY,
  public_reference VARCHAR(80) UNIQUE NOT NULL DEFAULT ('BRA-' || UPPER(ENCODE(gen_random_bytes(8), 'hex'))),
  rule_id INTEGER REFERENCES bin_rules(id) ON DELETE SET NULL,
  rule_public_reference VARCHAR(80) NOT NULL,
  action VARCHAR(40) NOT NULL,
  previous_values JSONB,
  new_values JSONB,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bin_rule_audit_rule_reference
  ON bin_rule_audit_history(rule_public_reference, created_at DESC);

DROP TRIGGER IF EXISTS set_bin_rule_categories_updated_at ON bin_rule_categories;
CREATE TRIGGER set_bin_rule_categories_updated_at
BEFORE UPDATE ON bin_rule_categories
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

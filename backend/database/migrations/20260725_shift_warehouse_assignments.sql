ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS public_reference VARCHAR(80),
  ADD COLUMN IF NOT EXISTS shift_code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS grace_period_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS effective_date DATE,
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE shifts
SET shift_code = UPPER(REGEXP_REPLACE(COALESCE(shift_code, shift_name), '[^A-Za-z0-9]+', '-', 'g'))
WHERE shift_code IS NULL;

UPDATE shifts
SET public_reference = 'SHIFT-' || UPPER(REGEXP_REPLACE(COALESCE(shift_code, shift_name), '[^A-Za-z0-9]+', '-', 'g'))
WHERE public_reference IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM shifts WHERE public_reference IS NULL) THEN
    ALTER TABLE shifts ALTER COLUMN public_reference SET NOT NULL;
  ELSE
    RAISE NOTICE 'Skipping shifts.public_reference NOT NULL because existing shifts still contain NULL references.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM shifts WHERE shift_code IS NULL) THEN
    ALTER TABLE shifts ALTER COLUMN shift_code SET NOT NULL;
  ELSE
    RAISE NOTICE 'Skipping shifts.shift_code NOT NULL because existing shifts still contain NULL codes.';
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.shifts_public_reference_key') IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM shifts
      WHERE public_reference IS NOT NULL
      GROUP BY public_reference
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'Skipping shifts_public_reference_key because duplicate shift public references exist.';
    ELSE
      CREATE UNIQUE INDEX shifts_public_reference_key
        ON shifts(public_reference);
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'shifts'::regclass
      AND conname = 'shifts_status_check'
  ) THEN
    ALTER TABLE shifts
      ADD CONSTRAINT shifts_status_check CHECK (status IN ('active', 'inactive')) NOT VALID;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'shifts'::regclass
      AND conname = 'shifts_grace_period_check'
  ) THEN
    ALTER TABLE shifts
      ADD CONSTRAINT shifts_grace_period_check
      CHECK (grace_period_minutes IS NULL OR grace_period_minutes >= 0)
      NOT VALID;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.idx_shifts_unique_code') IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM shifts
      WHERE shift_code IS NOT NULL
      GROUP BY LOWER(shift_code)
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'Skipping idx_shifts_unique_code because duplicate shift codes exist.';
    ELSE
      CREATE UNIQUE INDEX idx_shifts_unique_code
        ON shifts(LOWER(shift_code));
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.idx_shifts_unique_name') IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM shifts
      GROUP BY LOWER(shift_name)
      HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'Skipping idx_shifts_unique_name because duplicate shift names exist.';
    ELSE
      CREATE UNIQUE INDEX idx_shifts_unique_name
        ON shifts(LOWER(shift_name));
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'set_shifts_updated_at'
      AND tgrelid = 'shifts'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER set_shifts_updated_at
    BEFORE UPDATE ON shifts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS shift_assignment_history (
  id SERIAL PRIMARY KEY,
  public_reference VARCHAR(80) UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  previous_shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  action VARCHAR(40) NOT NULL,
  reason TEXT,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  effective_from TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effective_to TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (action IN ('Assigned', 'Reassigned', 'Removed')),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_shift_assignment_history_user
  ON shift_assignment_history(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shift_assignment_history_shift
  ON shift_assignment_history(shift_id, created_at DESC);

CREATE TABLE IF NOT EXISTS warehouse_assignment_history (
  id SERIAL PRIMARY KEY,
  public_reference VARCHAR(80) UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  previous_warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
  action VARCHAR(40) NOT NULL,
  reason TEXT,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  effective_from TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effective_to TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (action IN ('Assigned', 'Reassigned', 'Removed')),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_assignment_history_user
  ON warehouse_assignment_history(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_warehouse_assignment_history_warehouse
  ON warehouse_assignment_history(warehouse_id, created_at DESC);

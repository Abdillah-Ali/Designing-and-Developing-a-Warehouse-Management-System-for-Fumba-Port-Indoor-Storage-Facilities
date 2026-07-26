const ROLE_PUBLIC_REFERENCE_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION generate_role_public_reference()
RETURNS VARCHAR(80) AS $$
DECLARE
  generated_reference VARCHAR(80);
BEGIN
  LOOP
    generated_reference := 'ROLE-' || EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER || '-' || UPPER(ENCODE(gen_random_bytes(6), 'hex'));

    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM roles
      WHERE public_reference = generated_reference
    );
  END LOOP;

  RETURN generated_reference;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS public_reference VARCHAR(80);

ALTER TABLE roles
  ALTER COLUMN public_reference SET DEFAULT generate_role_public_reference();

DO $$
DECLARE
  role_record RECORD;
BEGIN
  FOR role_record IN
    SELECT role_name
    FROM roles
    WHERE public_reference IS NULL
    ORDER BY role_name
  LOOP
    UPDATE roles
    SET public_reference = generate_role_public_reference()
    WHERE role_name = role_record.role_name
      AND public_reference IS NULL;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM roles WHERE public_reference IS NULL) THEN
    RAISE EXCEPTION 'Role public reference backfill failed: NULL values remain.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM roles
    WHERE public_reference IS NOT NULL
    GROUP BY public_reference
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Role public reference backfill failed: duplicate values remain.';
  END IF;

  IF to_regclass('public.roles_public_reference_key') IS NULL THEN
    CREATE UNIQUE INDEX roles_public_reference_key
      ON roles(public_reference);
  END IF;

  ALTER TABLE roles ALTER COLUMN public_reference SET NOT NULL;
END;
$$;
`;

const ensureRolePublicReferences = async (client) => {
  await client.query(ROLE_PUBLIC_REFERENCE_SQL);
};

module.exports = {
  ROLE_PUBLIC_REFERENCE_SQL,
  ensureRolePublicReferences
};

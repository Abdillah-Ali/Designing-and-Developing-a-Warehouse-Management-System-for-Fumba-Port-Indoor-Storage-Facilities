const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROLE_PUBLIC_REFERENCE_SQL } = require("../database/rolePublicReferences");
const { seedOperationalConfiguration } = require("../database/initDb");
const { defaultRoleDefinitions } = require("../config/systemConfig");

const repoRoot = path.join(__dirname, "..");
const readDatabaseFile = (...segments) => fs.readFileSync(path.join(repoRoot, "database", ...segments), "utf8");

test("fresh database schema gives roles a generated public reference default", () => {
  const schema = readDatabaseFile("schema.sql");

  assert.match(schema, /CREATE OR REPLACE FUNCTION generate_role_public_reference\(\)/);
  assert.match(schema, /public_reference VARCHAR\(80\) UNIQUE NOT NULL DEFAULT generate_role_public_reference\(\)/);
  assert.match(schema, /ALTER COLUMN public_reference SET DEFAULT generate_role_public_reference\(\)/);
});

test("role public-reference migration backfills nulls and preserves constraints", () => {
  assert.match(ROLE_PUBLIC_REFERENCE_SQL, /ADD COLUMN IF NOT EXISTS public_reference VARCHAR\(80\)/);
  assert.match(ROLE_PUBLIC_REFERENCE_SQL, /ALTER COLUMN public_reference SET DEFAULT generate_role_public_reference\(\)/);
  assert.match(ROLE_PUBLIC_REFERENCE_SQL, /WHERE public_reference IS NULL/);
  assert.match(ROLE_PUBLIC_REFERENCE_SQL, /SET public_reference = generate_role_public_reference\(\)/);
  assert.match(ROLE_PUBLIC_REFERENCE_SQL, /CREATE UNIQUE INDEX roles_public_reference_key/);
  assert.match(ROLE_PUBLIC_REFERENCE_SQL, /ALTER TABLE roles ALTER COLUMN public_reference SET NOT NULL/);
  assert.doesNotMatch(ROLE_PUBLIC_REFERENCE_SQL, /REGEXP_REPLACE\(role_name/);
});

test("operational role seeding creates public references and preserves existing references on repeat", async () => {
  const queries = [];
  const client = {
    query: async (sql, params) => {
      queries.push({ sql: String(sql), params });
      return { rows: [], rowCount: 0 };
    }
  };

  await seedOperationalConfiguration(client);

  assert.match(queries[0].sql, /generate_role_public_reference\(\)/);

  const roleInserts = queries.filter((entry) => entry.sql.includes("INSERT INTO roles"));
  assert.equal(roleInserts.length, defaultRoleDefinitions.length);

  for (const entry of roleInserts) {
    assert.match(entry.sql, /INSERT INTO roles \(role_name, role_description, public_reference, role_key, system_protected\)/);
    assert.match(entry.sql, /generate_role_public_reference\(\)/);
    assert.match(entry.sql, /ON CONFLICT \(role_name\) DO UPDATE/);
    assert.doesNotMatch(entry.sql, /public_reference\s*=\s*EXCLUDED\.public_reference/);
  }
});

test("all role seed migrations include generated public references", () => {
  const updateSchema = readDatabaseFile("updateSchema.js");
  const financeMigration = readDatabaseFile("migrations", "finance_customs_gate_workflows.sql");
  const permissionMigration = readDatabaseFile("migrations", "20260725_permission_catalog.sql");

  assert.match(updateSchema, /INSERT INTO roles \(role_name, role_description, public_reference, role_key\)/);
  assert.match(updateSchema, /generate_role_public_reference\(\)/);

  assert.match(financeMigration, /INSERT INTO roles \(role_name, role_description, public_reference, role_key\)/);
  assert.match(financeMigration, /column_name = 'role_key'/);
  assert.match(financeMigration, /generate_role_public_reference\(\)/);

  assert.match(permissionMigration, /CREATE OR REPLACE FUNCTION generate_role_public_reference\(\)/);
  assert.match(permissionMigration, /SET public_reference = generate_role_public_reference\(\)/);
});

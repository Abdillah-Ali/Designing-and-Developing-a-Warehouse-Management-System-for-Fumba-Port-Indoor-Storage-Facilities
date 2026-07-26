const crypto = require("node:crypto");

const checksum = (content) => crypto
  .createHash("sha256")
  .update(String(content))
  .digest("hex");

const ensureSchemaMigrationsTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_name VARCHAR(180) PRIMARY KEY,
      checksum VARCHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      execution_status VARCHAR(20) NOT NULL,
      last_error TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (execution_status IN ('applied', 'failed'))
    )
  `);

  await client.query(`
    ALTER TABLE schema_migrations
      ADD COLUMN IF NOT EXISTS last_error TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  `);
};

const getMigration = async (client, migrationName) => {
  const result = await client.query(
    "SELECT migration_name, checksum, execution_status FROM schema_migrations WHERE migration_name = $1",
    [migrationName]
  );
  return result.rows[0] || null;
};

const isMigrationApplied = async (client, migrationName, expectedChecksum) => {
  const existing = await getMigration(client, migrationName);
  if (!existing) return false;
  if (existing.execution_status !== "applied") {
    return false;
  }
  if (expectedChecksum && existing.checksum !== expectedChecksum) {
    console.warn(`⚠ Migration checksum changed after apply; treating as already applied: ${migrationName}`);
  }
  return true;
};

const recordMigration = async (client, migrationName, migrationChecksum, status, lastError = null) => {
  await client.query(
    `INSERT INTO schema_migrations (migration_name, checksum, execution_status, applied_at, last_error, updated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (migration_name) DO UPDATE
     SET checksum = EXCLUDED.checksum,
         execution_status = EXCLUDED.execution_status,
         applied_at = CURRENT_TIMESTAMP,
         last_error = $4,
         updated_at = CURRENT_TIMESTAMP`,
    [migrationName, migrationChecksum, status, status === "failed" ? lastError : null]
  );
};

const applySqlMigration = async (client, migrationName, sql) => {
  const migrationChecksum = checksum(sql);
  const existing = await getMigration(client, migrationName);

  if (existing?.execution_status === "applied" && existing.checksum === migrationChecksum) {
    console.log(`✔ Migration already applied: ${migrationName}`);
    return false;
  }

  if (existing?.execution_status === "applied" && existing.checksum !== migrationChecksum) {
    console.warn(`⚠ Migration file changed after apply; reconciling checksum without replay: ${migrationName}`);
    await recordMigration(client, migrationName, migrationChecksum, "applied");
    return false;
  }

  if (existing?.execution_status === "failed") {
    console.warn(`⚠ Retrying previously failed migration: ${migrationName}`);
  }

  try {
    await client.query("BEGIN");
    await client.query(sql);
    await recordMigration(client, migrationName, migrationChecksum, "applied");
    await client.query("COMMIT");
    console.log(`✔ Migration applied: ${migrationName}`);
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    await recordMigration(client, migrationName, migrationChecksum, "failed", error.message);
    throw error;
  }
};

module.exports = {
  applySqlMigration,
  checksum,
  ensureSchemaMigrationsTable,
  isMigrationApplied,
  recordMigration
};

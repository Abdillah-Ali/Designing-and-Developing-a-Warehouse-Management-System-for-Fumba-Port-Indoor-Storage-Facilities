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
      CHECK (execution_status IN ('applied', 'failed'))
    )
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
    throw new Error(`Migration ${migrationName} previously failed and must be repaired before continuing.`);
  }
  if (expectedChecksum && existing.checksum !== expectedChecksum) {
    throw new Error(`Migration ${migrationName} checksum changed after it was applied.`);
  }
  return true;
};

const recordMigration = async (client, migrationName, migrationChecksum, status) => {
  await client.query(
    `INSERT INTO schema_migrations (migration_name, checksum, execution_status, applied_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (migration_name) DO UPDATE
     SET checksum = EXCLUDED.checksum,
         execution_status = EXCLUDED.execution_status,
         applied_at = CURRENT_TIMESTAMP`,
    [migrationName, migrationChecksum, status]
  );
};

const applySqlMigration = async (client, migrationName, sql) => {
  const migrationChecksum = checksum(sql);
  if (await isMigrationApplied(client, migrationName, migrationChecksum)) {
    console.log(`✔ Migration already applied: ${migrationName}`);
    return false;
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
    await recordMigration(client, migrationName, migrationChecksum, "failed");
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

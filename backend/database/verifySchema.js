const { Client } = require("pg");
const path = require("path");
const { validateEnvironment } = require("../config/env");

validateEnvironment();

const clientConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
};

const requiredTables = [
  "schema_migrations",
  "roles",
  "permissions",
  "role_permissions",
  "users",
  "shifts",
  "warehouses",
  "cargo",
  "approval_requests",
  "dispatch_requests",
  "notifications",
  "customs_records",
  "invoices",
  "payments",
  "gate_out_records"
];

const requiredIndexes = [
  "idx_cargo_locations_one_current_per_cargo",
  "idx_approval_requests_one_pending_per_workflow",
  "idx_dispatch_requests_one_pending_per_cargo",
  "idx_customs_records_one_record_per_cargo",
  "idx_invoices_unique_billing_period"
];

const run = async () => {
  const client = new Client(clientConfig);
  await client.connect();

  try {
    const tableResult = await client.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'`
    );
    const tables = new Set(tableResult.rows.map((row) => row.table_name));
    const missingTables = requiredTables.filter((table) => !tables.has(table));

    const indexResult = await client.query(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'`
    );
    const indexes = new Set(indexResult.rows.map((row) => row.indexname));
    const missingIndexes = requiredIndexes.filter((index) => !indexes.has(index));

    const failedMigrations = await client.query(
      "SELECT migration_name FROM schema_migrations WHERE execution_status <> 'applied'"
    );

    if (missingTables.length || missingIndexes.length || failedMigrations.rowCount) {
      throw new Error(JSON.stringify({
        missing_tables: missingTables,
        missing_indexes: missingIndexes,
        failed_migrations: failedMigrations.rows.map((row) => row.migration_name)
      }));
    }

    console.log(JSON.stringify({
      operation: "schema_verification",
      result: "success",
      timestamp: new Date().toISOString()
    }));
  } finally {
    await client.end();
  }
};

run().catch((error) => {
  console.error(JSON.stringify({
    operation: "schema_verification",
    result: "failure",
    error_category: "schema_verification_failed",
    timestamp: new Date().toISOString()
  }));
  console.error(error.message);
  process.exit(1);
});

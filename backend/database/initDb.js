const dotenv = require("dotenv");
const fs = require("fs/promises");
const path = require("path");
const { Client } = require("pg");
const {
  defaultRoleDefinitions,
  roleNames
} = require("../config/systemConfig");
const {
  applySqlMigration,
  ensureSchemaMigrationsTable
} = require("./migrationRunner");
const { ensureRolePublicReferences } = require("./rolePublicReferences");

dotenv.config({ path: path.join(__dirname, "../.env") });

const dbName = process.env.DB_NAME || "fumbaport_wms";
const connectionConfig = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD
};

const DB_CONNECTION_RETRY_LIMIT = 30;
const DB_CONNECTION_RETRY_DELAY_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const connectWithRetry = async (createClient, label) => {
  let lastError;

  for (let attempt = 1; attempt <= DB_CONNECTION_RETRY_LIMIT; attempt += 1) {
    const client = createClient();

    try {
      await client.connect();

      if (attempt > 1) {
        console.log(`Connected to PostgreSQL for ${label} after ${attempt} attempts`);
      }

      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {});

      if (attempt === DB_CONNECTION_RETRY_LIMIT) {
        break;
      }

      console.log(
        `PostgreSQL not ready for ${label} (attempt ${attempt}/${DB_CONNECTION_RETRY_LIMIT}): ${error.message}`
      );
      await sleep(DB_CONNECTION_RETRY_DELAY_MS);
    }
  }

  throw lastError;
};

const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

const createDatabaseIfMissing = async () => {
  const client = await connectWithRetry(
    () => new Client({
      ...connectionConfig,
      database: "postgres"
    }),
    `database ${dbName} creation`
  );

  try {
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);

    if (result.rowCount === 0) {
      await client.query(`CREATE DATABASE ${quoteIdentifier(dbName)}`);
      console.log(`Created database ${dbName}`);
      return;
    }

    console.log(`Database ${dbName} already exists`);
  } finally {
    await client.end();
  }
};

const applySchema = async () => {
  const client = await connectWithRetry(
    () => new Client({
      ...connectionConfig,
      database: dbName
    }),
    `schema application for ${dbName}`
  );
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = await fs.readFile(schemaPath, "utf8");
  const financeCustomsGateMigrationPath = path.join(
    __dirname,
    "migrations",
    "finance_customs_gate_workflows.sql"
  );
  const zoneWarehouseScopeMigrationPath = path.join(
    __dirname,
    "migrations",
    "update_zones_warehouse_scoped.sql"
  );
  const warehouseConfigurationMigrationPath = path.join(
    __dirname,
    "migrations",
    "warehouse_configuration_srs.sql"
  );
  const permissionCatalogMigrationPath = path.join(
    __dirname,
    "migrations",
    "20260725_permission_catalog.sql"
  );
  const integrityConstraintsMigrationPath = path.join(
    __dirname,
    "migrations",
    "20260725_integrity_constraints.sql"
  );
  const shiftWarehouseAssignmentsMigrationPath = path.join(
    __dirname,
    "migrations",
    "20260725_shift_warehouse_assignments.sql"
  );
  const notificationSchedulerMigrationPath = path.join(
    __dirname,
    "migrations",
    "20260725_notification_scheduler_settings.sql"
  );
  const managementPermissionsMigrationPath = path.join(
    __dirname, "migrations", "20260730_management_permissions.sql"
  );
  const initialAdminGovernanceMigrationPath = path.join(
    __dirname, "migrations", "20260730_initial_admin_governance.sql"
  );
  const systemAdministratorLimitSettingMigrationPath = path.join(
    __dirname, "migrations", "20260730_system_administrator_limit_setting.sql"
  );
  const cargoRegistrationFormBuilderMigrationPath = path.join(
    __dirname, "migrations", "20260730_cargo_registration_form_builder.sql"
  );
  const configurableBinRuleEngineMigrationPath = path.join(
    __dirname, "migrations", "20260805_configurable_bin_rule_engine.sql"
  );
  const financeCustomsGateMigration = await fs.readFile(financeCustomsGateMigrationPath, "utf8");
  const zoneWarehouseScopeMigration = await fs.readFile(zoneWarehouseScopeMigrationPath, "utf8");
  const warehouseConfigurationMigration = await fs.readFile(warehouseConfigurationMigrationPath, "utf8");
  const permissionCatalogMigration = await fs.readFile(permissionCatalogMigrationPath, "utf8");
  const integrityConstraintsMigration = await fs.readFile(integrityConstraintsMigrationPath, "utf8");
  const shiftWarehouseAssignmentsMigration = await fs.readFile(shiftWarehouseAssignmentsMigrationPath, "utf8");
  const notificationSchedulerMigration = await fs.readFile(notificationSchedulerMigrationPath, "utf8");
  const managementPermissionsMigration = await fs.readFile(managementPermissionsMigrationPath, "utf8");
  const initialAdminGovernanceMigration = await fs.readFile(initialAdminGovernanceMigrationPath, "utf8");
  const systemAdministratorLimitSettingMigration = await fs.readFile(systemAdministratorLimitSettingMigrationPath, "utf8");
  const cargoRegistrationFormBuilderMigration = await fs.readFile(cargoRegistrationFormBuilderMigrationPath, "utf8");
  const configurableBinRuleEngineMigration = await fs.readFile(configurableBinRuleEngineMigrationPath, "utf8");

  try {
    await moveIncompatibleTables(client);
    await ensureSchemaMigrationsTable(client);
    await applySqlMigration(client, "000_base_schema.sql", schema);
    await seedOperationalConfiguration(client);
    await applySqlMigration(client, "001_update_zones_warehouse_scoped.sql", zoneWarehouseScopeMigration);
    await applySqlMigration(client, "002_warehouse_configuration_srs.sql", warehouseConfigurationMigration);
    await applySqlMigration(client, "003_finance_customs_gate_workflows.sql", financeCustomsGateMigration);
    await applySqlMigration(client, "004_permission_catalog.sql", permissionCatalogMigration);
    await applySqlMigration(client, "005_integrity_constraints.sql", integrityConstraintsMigration);
    await applySqlMigration(client, "006_shift_warehouse_assignments.sql", shiftWarehouseAssignmentsMigration);
    await applySqlMigration(client, "007_notification_scheduler_settings.sql", notificationSchedulerMigration);
    await applySqlMigration(client, "008_management_permissions.sql", managementPermissionsMigration);
    await applySqlMigration(client, "009_initial_admin_governance.sql", initialAdminGovernanceMigration);
    await applySqlMigration(client, "010_system_administrator_limit_setting.sql", systemAdministratorLimitSettingMigration);
    await applySqlMigration(client, "011_cargo_registration_form_builder.sql", cargoRegistrationFormBuilderMigration);
    await applySqlMigration(client, "012_configurable_bin_rule_engine.sql", configurableBinRuleEngineMigration);
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_key)
       SELECT r.id, p.permission_key
       FROM roles r
       JOIN permissions p ON p.permission_key = ANY($2::text[])
       WHERE r.role_name = $1
       ON CONFLICT DO NOTHING`,
      [roleNames.management, ["management.dashboard.view", "management.reports.view", "notifications.view", "notifications.manage"]]
    );
    console.log("✔ Structural role catalog applied");
    console.log("✔ Shifts are not seeded; configure them in the Admin portal");
    console.log("Database schema applied successfully");
  } finally {
    await client.end();
  }
};

const seedOperationalConfiguration = async (client) => {
  await ensureRolePublicReferences(client);

  for (const role of defaultRoleDefinitions) {
    await client.query(
      `INSERT INTO roles (role_name, role_description, public_reference)
       VALUES ($1, $2, generate_role_public_reference())
       ON CONFLICT (role_name) DO UPDATE
       SET role_description = EXCLUDED.role_description`,
      [role.name, role.description || null]
    );
  }

};

const getTableColumns = async (client, tableName) => {
  const result = await client.query(
    `SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );

  return result.rows.map((row) => row.column_name);
};

const getTableIndexes = async (client, tableName) => {
  const result = await client.query(
    `SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = $1`,
    [tableName]
  );

  return result.rows.map((row) => row.indexname);
};

const moveIncompatibleTables = async (client) => {
  const requiredColumns = {
    roles: ["id", "role_name"],
    warehouses: ["id", "warehouse_name", "warehouse_code", "status"],
    shifts: ["id", "shift_name", "start_time", "end_time"],
    users: ["id", "full_name", "username", "email", "password_hash", "role_id", "status", "must_change_password", "is_system_user"],
    user_sessions: ["id", "user_id", "login_time", "session_status"],
    audit_logs: ["id", "user_id", "action", "module"],
    zones: ["id", "code", "name"],
    racks: ["id", "zone_id", "code"],
    levels: ["id", "rack_id", "code"],
    bins: ["id", "level_id", "code", "barcode"]
  };
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);

  for (const [tableName, columns] of Object.entries(requiredColumns)) {
    const existingColumns = await getTableColumns(client, tableName);

    if (existingColumns.length === 0) continue;

    const compatible = columns.every((column) => existingColumns.includes(column));
    if (compatible) continue;

    const legacyName = `legacy_${tableName}_${timestamp}`;
    const indexNames = await getTableIndexes(client, tableName);

    await client.query(
      `ALTER TABLE ${quoteIdentifier(tableName)} RENAME TO ${quoteIdentifier(legacyName)}`
    );

    for (const indexName of indexNames) {
      await client.query(
        `ALTER INDEX IF EXISTS ${quoteIdentifier(indexName)} RENAME TO ${quoteIdentifier(`legacy_${indexName}_${timestamp}`)}`
      );
    }

    console.log(`Moved incompatible table ${tableName} to ${legacyName}`);
  }
};

const run = async () => {
  try {
    await createDatabaseIfMissing();
    await applySchema();
    console.log("Fumba Port WMS database is ready");
  } catch (error) {
    console.error("Database initialization failed:");
    console.error(error.message);
    process.exit(1);
  }
};

if (require.main === module) {
  run();
}

module.exports = {
  applySchema,
  createDatabaseIfMissing,
  run,
  seedOperationalConfiguration
};

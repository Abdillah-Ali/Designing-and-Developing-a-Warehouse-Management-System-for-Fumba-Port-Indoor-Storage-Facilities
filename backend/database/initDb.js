const dotenv = require("dotenv");
const fs = require("fs/promises");
const path = require("path");
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const {
  defaultRoleDefinitions,
  roleNames
} = require("../config/systemConfig");
const {
  applySqlMigration,
  ensureSchemaMigrationsTable
} = require("./migrationRunner");

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
  const financeCustomsGateMigration = await fs.readFile(financeCustomsGateMigrationPath, "utf8");
  const zoneWarehouseScopeMigration = await fs.readFile(zoneWarehouseScopeMigrationPath, "utf8");
  const warehouseConfigurationMigration = await fs.readFile(warehouseConfigurationMigrationPath, "utf8");
  const permissionCatalogMigration = await fs.readFile(permissionCatalogMigrationPath, "utf8");
  const integrityConstraintsMigration = await fs.readFile(integrityConstraintsMigrationPath, "utf8");
  const shiftWarehouseAssignmentsMigration = await fs.readFile(shiftWarehouseAssignmentsMigrationPath, "utf8");
  const notificationSchedulerMigration = await fs.readFile(notificationSchedulerMigrationPath, "utf8");

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
    console.log("✔ Roles seeded");
    console.log("✔ Shifts are not seeded; configure them in the Admin portal");
    await seedBootstrapAdmin(client);
    console.log("Database schema applied successfully");
  } finally {
    await client.end();
  }
};

const seedOperationalConfiguration = async (client) => {
  for (const role of defaultRoleDefinitions) {
    await client.query(
      `INSERT INTO roles (role_name, role_description)
       VALUES ($1, $2)
       ON CONFLICT (role_name) DO UPDATE
       SET role_description = EXCLUDED.role_description`,
      [role.name, role.description || null]
    );
  }

  await client.query(
    `INSERT INTO audit_logs (action, module, description, metadata)
     VALUES ('APPLY_SYSTEM_CONFIGURATION', 'System Configuration', $1, $2)`,
    [
      "Applied configured portal role definitions. Operational shifts are configured by the System Admin in the application.",
      JSON.stringify({
        roles: defaultRoleDefinitions.map((role) => role.name),
        shifts_seeded: false
      })
    ]
  );
};

const readBootstrapAdminConfig = () => {
  const envFields = {
    fullName: "BOOTSTRAP_ADMIN_FULL_NAME",
    username: "BOOTSTRAP_ADMIN_USERNAME",
    email: "BOOTSTRAP_ADMIN_EMAIL",
    phone: "BOOTSTRAP_ADMIN_PHONE",
    password: "BOOTSTRAP_ADMIN_PASSWORD"
  };
  const optionalFields = {
    warehouse: "BOOTSTRAP_ADMIN_WAREHOUSE"
  };
  const config = {};
  const missing = [];

  for (const [key, envName] of Object.entries(envFields)) {
    const value = String(process.env[envName] || "").trim();
    if (!value) {
      missing.push(envName);
    } else {
      config[key] = value;
    }
  }

  for (const [key, envName] of Object.entries(optionalFields)) {
    const value = String(process.env[envName] || "").trim();
    if (value) {
      config[key] = value;
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required bootstrap admin environment variables: ${missing.join(", ")}`);
  }

  return config;
};

const seedBootstrapAdmin = async (client) => {
  const config = readBootstrapAdminConfig();
  const passwordHash = await bcrypt.hash(config.password, 12);

  await client.query("BEGIN");

  try {
    const bootstrapCheck = await client.query(
      `SELECT id, username
       FROM users
       WHERE is_bootstrap_admin = TRUE
       LIMIT 1`
    );

    if (bootstrapCheck.rowCount > 0) {
      console.log(`Bootstrap admin already exists (${bootstrapCheck.rows[0].username}); skipping creation`);
      await client.query("COMMIT");
      return;
    }

    const duplicateCheck = await client.query(
      `SELECT username, email
       FROM users
       WHERE LOWER(username) = LOWER($1)
          OR LOWER(email) = LOWER($2)
       LIMIT 1`,
      [config.username, config.email]
    );
    if (duplicateCheck.rowCount > 0) {
      throw new Error("Configured bootstrap username or email is already used by another account.");
    }

    const roleResult = await client.query(
      "SELECT id FROM roles WHERE role_name = $1",
      [roleNames.systemAdmin]
    );
    if (roleResult.rowCount === 0) {
      throw new Error("System Admin role not found.");
    }
    const roleId = roleResult.rows[0].id;

    let warehouseId = null;
    if (config.warehouse) {
      const warehouseResult = await client.query(
        `SELECT id
         FROM warehouses
         WHERE LOWER(warehouse_name) = LOWER($1)
            OR LOWER(warehouse_code) = LOWER($1)
         LIMIT 1`,
        [config.warehouse]
      );
      if (warehouseResult.rowCount > 0) {
        warehouseId = warehouseResult.rows[0].id;
      } else {
        console.log(`Configured bootstrap warehouse was not found: ${config.warehouse}. Defaulting to NULL.`);
      }
    }

    const insertResult = await client.query(
      `INSERT INTO users (
        full_name,
        username,
        email,
        phone_number,
        password_hash,
        role_id,
        warehouse_id,
        shift_id,
        status,
        must_change_password,
        is_system_user,
        is_bootstrap_admin,
        bootstrap_completed
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', TRUE, TRUE, TRUE, FALSE)
      RETURNING id`,
      [
        config.fullName,
        config.username,
        config.email,
        config.phone,
        passwordHash,
        roleId,
        warehouseId,
        null
      ]
    );
    const newUserId = insertResult.rows[0].id;

    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, $2, $3, $4)`,
      [
        newUserId,
        "SEED_BOOTSTRAP_ADMIN",
        "User Management",
        "Temporary bootstrap administrator account seeded from environment configuration."
      ]
    );

    await client.query("COMMIT");
    console.log("✔ Bootstrap System Admin created successfully");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
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

run();

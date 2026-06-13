const dotenv = require("dotenv");
const fs = require("fs/promises");
const path = require("path");
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const {
  defaultRoleDefinitions,
  defaultShifts,
  roleNames
} = require("../config/systemConfig");

dotenv.config({ path: path.join(__dirname, "../.env") });

const dbName = process.env.DB_NAME || "fumbaport_wms";
const connectionConfig = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD
};

const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

const createDatabaseIfMissing = async () => {
  const client = new Client({
    ...connectionConfig,
    database: "postgres"
  });

  await client.connect();

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
  const client = new Client({
    ...connectionConfig,
    database: dbName
  });
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = await fs.readFile(schemaPath, "utf8");

  await client.connect();

  try {
    await moveIncompatibleTables(client);
    await client.query(schema);
    await seedOperationalConfiguration(client);
    console.log("✔ Roles seeded");
    console.log("✔ Warehouses seeded");
    console.log("✔ Shifts seeded");
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

  for (const shift of defaultShifts) {
    await client.query(
      `INSERT INTO shifts (shift_name, start_time, end_time)
       VALUES ($1, $2, $3)
       ON CONFLICT (shift_name) DO UPDATE
       SET start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time`,
      [shift.name, shift.start, shift.end]
    );
  }

  await client.query(
    `INSERT INTO audit_logs (action, module, description, metadata)
     VALUES ('APPLY_SYSTEM_CONFIGURATION', 'System Configuration', $1, $2)`,
    [
      "Applied configured portal role definitions and warehouse shift definitions.",
      JSON.stringify({
        roles: defaultRoleDefinitions.map((role) => role.name),
        shifts: defaultShifts.map((shift) => shift.name)
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
    password: "BOOTSTRAP_ADMIN_PASSWORD",
    warehouse: "BOOTSTRAP_ADMIN_WAREHOUSE",
    shift: "BOOTSTRAP_ADMIN_SHIFT"
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

    const warehouseResult = await client.query(
      `SELECT id
       FROM warehouses
       WHERE LOWER(warehouse_name) = LOWER($1)
          OR LOWER(warehouse_code) = LOWER($1)
       LIMIT 1`,
      [config.warehouse]
    );
    if (warehouseResult.rowCount === 0) {
      throw new Error(`Configured bootstrap warehouse was not found: ${config.warehouse}`);
    }
    const warehouseId = warehouseResult.rows[0].id;

    const shiftResult = await client.query(
      "SELECT id FROM shifts WHERE LOWER(shift_name) = LOWER($1)",
      [config.shift]
    );
    if (shiftResult.rowCount === 0) {
      throw new Error(`Configured bootstrap shift was not found: ${config.shift}`);
    }
    const shiftId = shiftResult.rows[0].id;

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
        shiftId
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

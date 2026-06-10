const dotenv = require("dotenv");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { Client } = require("pg");
const bcrypt = require("bcryptjs");

dotenv.config();

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
    console.log("✔ Roles seeded");
    console.log("✔ Warehouses seeded");
    console.log("✔ Shifts seeded");
    await seedDefaultAdmin(client);
    console.log("Database schema applied successfully");
  } finally {
    await client.end();
  }
};

const seedDefaultAdmin = async (client) => {
  const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || "Admin@123";

  await client.query("BEGIN");

  try {
    // 1. Existence check
    const adminCheck = await client.query(
      "SELECT id FROM users WHERE username = $1",
      ["admin"]
    );

    if (adminCheck.rowCount > 0) {
      console.log("Default admin already exists");
      await client.query("ROLLBACK");
      return;
    }

    // 2. Role lookup
    const roleResult = await client.query(
      "SELECT id FROM roles WHERE role_name = $1",
      ["System Admin"]
    );
    if (roleResult.rowCount === 0) {
      throw new Error("System Admin role not found.");
    }
    const roleId = roleResult.rows[0].id;

    // 3. Warehouse lookup
    const warehouseResult = await client.query(
      "SELECT id FROM warehouses WHERE warehouse_name = $1 OR warehouse_code = $2",
      ["Warehouse A", "WHA"]
    );
    if (warehouseResult.rowCount === 0) {
      throw new Error("Warehouse A not found.");
    }
    const warehouseId = warehouseResult.rows[0].id;

    // 4. Shift lookup
    const shiftResult = await client.query(
      "SELECT id FROM shifts WHERE shift_name = $1",
      ["Morning Shift"]
    );
    if (shiftResult.rowCount === 0) {
      throw new Error("Morning Shift not found.");
    }
    const shiftId = shiftResult.rows[0].id;

    // 5. Bcrypt password hashing
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    // 6. Admin insertion
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
        is_system_user
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id`,
      [
        "System Administrator",
        "admin",
        "admin@fumbaport.tz",
        "+255000000000",
        passwordHash,
        roleId,
        warehouseId,
        shiftId,
        "active",
        true,
        true
      ]
    );
    const newUserId = insertResult.rows[0].id;

    // 7. Audit log insertion
    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, $2, $3, $4)`,
      [
        newUserId,
        "SEED_DEFAULT_ADMIN",
        "User Management",
        "Default system administrator account seeded during database initialization."
      ]
    );

    await client.query("COMMIT");
    console.log("✔ Default System Admin created successfully");
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

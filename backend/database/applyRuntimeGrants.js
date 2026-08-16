const fs = require("node:fs");
const { Client } = require("pg");

const readSecret = (name, fileName) => {
  if (process.env[name]) return process.env[name];
  const file = process.env[fileName];
  return file ? fs.readFileSync(file, "utf8").trim() : "";
};
const identifier = (value) => {
  const normalized = String(value || "");
  if (!/^[a-z_][a-z0-9_]{2,62}$/.test(normalized)) throw new Error("APP_DB_USER is invalid.");
  return `"${normalized}"`;
};
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;

const run = async () => {
  const runtimeName = process.env.APP_DB_USER;
  const runtimePassword = readSecret("APP_DB_PASSWORD", "APP_DB_PASSWORD_FILE");
  if (runtimePassword.length < 16) throw new Error("APP_DB_PASSWORD must be at least 16 characters.");
  const role = identifier(runtimeName);
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: readSecret("DB_PASSWORD", "DB_PASSWORD_FILE")
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=${literal(runtimeName)}) THEN CREATE ROLE ${role} LOGIN PASSWORD ${literal(runtimePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION; ELSE ALTER ROLE ${role} WITH LOGIN PASSWORD ${literal(runtimePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION; END IF; END $$`);
    await client.query(`GRANT CONNECT ON DATABASE ${identifier(process.env.DB_NAME)} TO ${role}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await client.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${role}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO ${role}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${role}`);
    await client.query(`REVOKE UPDATE,DELETE,TRUNCATE ON audit_logs,archived_audit_logs FROM ${role}`);
    await client.query("COMMIT");
    console.log(JSON.stringify({ operation: "runtime_database_grants", result: "success" }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
};

run().catch((error) => {
  console.error(JSON.stringify({ operation: "runtime_database_grants", result: "failure", error_category: error.code || error.name }));
  process.exit(1);
});

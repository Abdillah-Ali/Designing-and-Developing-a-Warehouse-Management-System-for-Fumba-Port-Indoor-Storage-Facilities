const { Pool } = require("pg");
const { readEnv } = require("./env");

const pool = new Pool({
  host: readEnv("DB_HOST", "localhost"),
  port: Number(readEnv("DB_PORT", 5432)),
  database: readEnv("DB_NAME", "fumbaport_wms"),
  user: readEnv("DB_USER", "postgres"),
  password: process.env.DB_PASSWORD,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000)
});

const query = (text, params) => pool.query(text, params);

const testConnection = async () => {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    console.log(JSON.stringify({
      operation: "database_connectivity_check",
      result: "success",
      timestamp: new Date().toISOString()
    }));
  } finally {
    client.release();
  }
};

module.exports = {
  pool,
  query,
  testConnection
};

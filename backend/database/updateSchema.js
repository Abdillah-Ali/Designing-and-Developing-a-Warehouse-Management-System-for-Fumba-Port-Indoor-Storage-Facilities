const dotenv = require("dotenv");
const { Client } = require("pg");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

const dbName = process.env.DB_NAME || "fumbaport_wms";
const clientConfig = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD,
  database: dbName
};

const runUpdates = async () => {
  const client = new Client(clientConfig);
  await client.connect();

  try {
    await client.query("BEGIN");
    console.log("Starting database schema updates...");

    // 1. Add active columns if missing
    await client.query(`
      ALTER TABLE zones ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
    `);
    console.log("✔ Columns checked/added: zones.active");

    await client.query(`
      ALTER TABLE bins ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
    `);
    console.log("✔ Columns checked/added: bins.active");

    // 2. Create bin_rules table if missing
    await client.query(`
      CREATE TABLE IF NOT EXISTS bin_rules (
        id SERIAL PRIMARY KEY,
        rule_key VARCHAR(80) UNIQUE NOT NULL,
        rule_name VARCHAR(150) NOT NULL,
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        parameters JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✔ Table checked/created: bin_rules");

    // 3. Create set_updated_at trigger for bin_rules
    await client.query(`
      DROP TRIGGER IF EXISTS set_bin_rules_updated_at ON bin_rules;
    `);
    await client.query(`
      CREATE TRIGGER set_bin_rules_updated_at
      BEFORE UPDATE ON bin_rules
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);
    console.log("✔ Trigger set_bin_rules_updated_at configured");

    // 4. Seed default rules
    const defaultRules = [
      {
        key: "hazardous",
        name: "Hazardous Zone Compliance",
        description: "Validates that hazardous cargo is placed only in hazard zones and non-hazardous cargo is not placed in hazard zones.",
        parameters: JSON.stringify({})
      },
      {
        key: "weight",
        name: "Bin Weight Capacity Limit",
        description: "Validates that the placement cargo weight does not exceed the remaining capacity of the bin.",
        parameters: JSON.stringify({})
      },
      {
        key: "volume",
        name: "Bin Volume Capacity Limit",
        description: "Validates that the placement cargo volume does not exceed the remaining capacity of the bin.",
        parameters: JSON.stringify({})
      },
      {
        key: "compatibility",
        name: "Cargo-Zone Compatibility",
        description: "Validates that the cargo's type is permitted inside the zone's allowed cargo types.",
        parameters: JSON.stringify({})
      },
      {
        key: "restricted",
        name: "Reserved Bin Restrictions",
        description: "Validates that if a bin is reserved for a specific cargo type, only cargo of that type can be placed there.",
        parameters: JSON.stringify({})
      }
    ];

    for (const rule of defaultRules) {
      await client.query(
        `INSERT INTO bin_rules (rule_key, rule_name, description, is_active, parameters)
         VALUES ($1, $2, $3, TRUE, $4)
         ON CONFLICT (rule_key) DO UPDATE
         SET rule_name = EXCLUDED.rule_name,
             description = EXCLUDED.description
         WHERE bin_rules.rule_key = EXCLUDED.rule_key`,
        [rule.key, rule.name, rule.description, rule.parameters]
      );
    }
    console.log("✔ Seeded bin_rules defaults");

    await client.query("COMMIT");
    console.log("All database updates applied successfully!");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Failed to run database schema updates:");
    console.error(error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
};

runUpdates();

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

    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS is_system_user BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS is_bootstrap_admin BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS bootstrap_completed BOOLEAN NOT NULL DEFAULT FALSE;
    `);
    console.log("✔ Bootstrap administrator columns checked/added");

    // 1. Add active columns if missing
    await client.query(`
      ALTER TABLE zones ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
    `);
    console.log("✔ Columns checked/added: zones.active");

    await client.query(`
      ALTER TABLE bins
        ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS allowed_cargo_type VARCHAR(100);

      ALTER TABLE bins DROP CONSTRAINT IF EXISTS bins_status_check;
      ALTER TABLE bins
        ADD CONSTRAINT bins_status_check
        CHECK (status IN ('Available', 'Reserved', 'Blocked', 'Maintenance', 'Occupied', 'Full', 'Inactive'));

      UPDATE bins b
      SET allowed_cargo_type = z.allowed_cargo_type
      FROM levels l
      JOIN racks r ON r.id = l.rack_id
      JOIN zones z ON z.id = r.zone_id
      WHERE b.level_id = l.id
        AND b.allowed_cargo_type IS NULL;
    `);
    console.log("✔ Bin activity, cargo category, and maintenance status checked/added");

    await client.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        setting_key VARCHAR(120) PRIMARY KEY,
        setting_value JSONB NOT NULL,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO system_settings (setting_key, setting_value)
      VALUES ('manual_placement_enabled', 'false'::jsonb)
      ON CONFLICT (setting_key) DO NOTHING;

      ALTER TABLE placement_validation_logs
        ADD COLUMN IF NOT EXISTS placement_mode VARCHAR(20) NOT NULL DEFAULT 'scan',
        ADD COLUMN IF NOT EXISTS attempt_stage VARCHAR(30) NOT NULL DEFAULT 'validation',
        ADD COLUMN IF NOT EXISTS manual_reason VARCHAR(80),
        ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS previous_location TEXT,
        ADD COLUMN IF NOT EXISTS new_location TEXT;

      CREATE TABLE IF NOT EXISTS bin_barcode_print_logs (
        id SERIAL PRIMARY KEY,
        bin_id INTEGER NOT NULL REFERENCES bins(id) ON DELETE CASCADE,
        printed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        print_type VARCHAR(20) NOT NULL DEFAULT 'PRINT',
        printed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (print_type IN ('PRINT', 'REPRINT'))
      );
    `);
    console.log("✔ Placement settings and trace tables checked/added");

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
    await client.query(
      `UPDATE bin_rules
       SET is_active = TRUE,
           updated_at = CURRENT_TIMESTAMP
       WHERE rule_key IN ('hazardous', 'weight', 'volume', 'compatibility')`
    );
    console.log("✔ Seeded bin_rules defaults");

    await client.query(`
      ALTER TABLE cargo
        ADD COLUMN IF NOT EXISTS workflow_status VARCHAR(40) NOT NULL DEFAULT 'Pending Review',
        ADD COLUMN IF NOT EXISTS registration_status VARCHAR(40) NOT NULL DEFAULT 'Pending Review',
        ADD COLUMN IF NOT EXISTS placement_status VARCHAR(40) NOT NULL DEFAULT 'Unplaced',
        ADD COLUMN IF NOT EXISTS relocation_required BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS relocation_reason TEXT,
        ADD COLUMN IF NOT EXISTS relocation_flagged_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS archive_reason TEXT;

      ALTER TABLE cargo DROP CONSTRAINT IF EXISTS cargo_status_check;
      ALTER TABLE cargo DROP CONSTRAINT IF EXISTS cargo_workflow_status_check;
      ALTER TABLE cargo DROP CONSTRAINT IF EXISTS cargo_registration_status_check;
      ALTER TABLE cargo DROP CONSTRAINT IF EXISTS cargo_placement_status_check;

      UPDATE cargo
      SET registration_status = CASE
            WHEN workflow_status IN ('Rejected', 'Cancelled')
              OR status IN ('Rejected', 'Cancelled')
              THEN 'Rejected'
            WHEN workflow_status = 'Correction Required'
              OR status = 'Correction Required'
              THEN 'Correction Required'
            WHEN workflow_status IN (
              'Approved',
              'Approved For Placement',
              'Stored',
              'Blocked',
              'Dispatch Pending',
              'Released'
            )
              OR status IN (
                'Approved',
                'Approved For Placement',
                'Stored',
                'Blocked',
                'Dispatch Approval Pending',
                'Ready for Dispatch',
                'Dispatch Pending',
                'Released'
              )
              THEN 'Approved'
            ELSE 'Pending Review'
          END,
          placement_status = CASE
            WHEN workflow_status = 'Released'
              OR status = 'Released'
              OR placement_status = 'Dispatched'
              THEN 'Dispatched'
            WHEN placement_status = 'Relocated'
              THEN 'Relocated'
            WHEN current_bin_id IS NOT NULL
              OR workflow_status = 'Stored'
              OR status = 'Stored'
              OR placement_status = 'Stored'
              THEN 'Placed'
            ELSE 'Unplaced'
          END,
          relocation_required = CASE
            WHEN placement_status = 'Relocation Requested' THEN TRUE
            ELSE relocation_required
          END;

      UPDATE cargo
      SET status = registration_status,
          workflow_status = registration_status;

      ALTER TABLE cargo ALTER COLUMN status SET DEFAULT 'Pending Review';
      ALTER TABLE cargo ALTER COLUMN workflow_status SET DEFAULT 'Pending Review';
      ALTER TABLE cargo ALTER COLUMN registration_status SET DEFAULT 'Pending Review';
      ALTER TABLE cargo ALTER COLUMN placement_status SET DEFAULT 'Unplaced';

      ALTER TABLE cargo
        ADD CONSTRAINT cargo_status_check
        CHECK (status IN ('Pending Review', 'Approved', 'Correction Required', 'Rejected'));

      ALTER TABLE cargo
        ADD CONSTRAINT cargo_workflow_status_check
        CHECK (workflow_status IN ('Pending Review', 'Approved', 'Correction Required', 'Rejected'));

      ALTER TABLE cargo
        ADD CONSTRAINT cargo_registration_status_check
        CHECK (registration_status IN ('Pending Review', 'Approved', 'Correction Required', 'Rejected'));

      ALTER TABLE cargo
        ADD CONSTRAINT cargo_placement_status_check
        CHECK (placement_status IN ('Unplaced', 'Placed', 'Relocated', 'Dispatched'));

      CREATE INDEX IF NOT EXISTS idx_cargo_registration_status
        ON cargo(registration_status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cargo_placement_status
        ON cargo(placement_status);
      CREATE INDEX IF NOT EXISTS idx_cargo_archive_state
        ON cargo(is_deleted, archived_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cargo_active_delivery_note_identity
        ON cargo (UPPER(REGEXP_REPLACE(BTRIM(delivery_note_number), '[^[:alnum:]]', '', 'g')))
        WHERE is_deleted = FALSE
          AND registration_status IN ('Pending Review', 'Correction Required', 'Approved')
          AND placement_status <> 'Dispatched';
      CREATE INDEX IF NOT EXISTS idx_cargo_active_container_identity
        ON cargo (UPPER(REGEXP_REPLACE(BTRIM(container_number), '[^[:alnum:]]', '', 'g')))
        WHERE is_deleted = FALSE
          AND registration_status IN ('Pending Review', 'Correction Required', 'Approved')
          AND placement_status <> 'Dispatched';
      CREATE INDEX IF NOT EXISTS idx_cargo_active_vehicle_consignee_type
        ON cargo (
          UPPER(REGEXP_REPLACE(BTRIM(vehicle_number), '[^[:alnum:]]', '', 'g')),
          LOWER(REGEXP_REPLACE(BTRIM(consignee_name), '[[:space:]]+', ' ', 'g')),
          LOWER(REGEXP_REPLACE(BTRIM(cargo_type), '[[:space:]]+', ' ', 'g'))
        )
        WHERE is_deleted = FALSE
          AND registration_status IN ('Pending Review', 'Correction Required', 'Approved')
          AND placement_status <> 'Dispatched';

      CREATE OR REPLACE FUNCTION sync_cargo_status_aliases()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.status := NEW.registration_status;
        NEW.workflow_status := NEW.registration_status;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS sync_cargo_status_aliases_trigger ON cargo;
      CREATE TRIGGER sync_cargo_status_aliases_trigger
      BEFORE INSERT OR UPDATE ON cargo
      FOR EACH ROW EXECUTE FUNCTION sync_cargo_status_aliases();
    `);
    console.log("✔ Independent cargo registration and placement statuses migrated");

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

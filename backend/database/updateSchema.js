const dotenv = require("dotenv");
const crypto = require("node:crypto");
const fs = require("fs");
const { Client } = require("pg");
const path = require("path");
const { roleNames } = require("../config/systemConfig");
const {
  applySqlMigration,
  checksum,
  ensureSchemaMigrationsTable,
  isMigrationApplied,
  recordMigration
} = require("./migrationRunner");
const { ensureRolePublicReferences } = require("./rolePublicReferences");
const { ensureStandardRolePermissions } = require("./ensureRolePermissions");

dotenv.config({ path: path.join(__dirname, "../.env") });

const dbName = process.env.DB_NAME || "fumbaport_wms";
const clientConfig = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD,
  database: dbName
};

const generateNotificationReference = (createdAt = new Date()) => {
  const year = new Date(createdAt || new Date()).getFullYear();
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let randomPart = "";
  for (let index = 0; index < 6; index += 1) {
    randomPart += chars[crypto.randomInt(chars.length)];
  }
  return `NTF-${year}-${randomPart}`;
};

const runUpdates = async () => {
  const client = new Client(clientConfig);
  await client.connect();
  let transactionOpen = false;
  let legacyStarted = false;
  const legacyMigrationName = "000_legacy_update_schema_inline";
  const legacyMigrationChecksum = checksum("legacy-update-schema-inline-20260725");

  try {
    await ensureSchemaMigrationsTable(client);
    await ensureRolePublicReferences(client);

    const legacyAlreadyApplied = await isMigrationApplied(client, legacyMigrationName, legacyMigrationChecksum);

    if (!legacyAlreadyApplied) {
    await client.query("BEGIN");
    transactionOpen = true;
    legacyStarted = true;
    console.log("Starting database schema updates...");

    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS is_system_user BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS is_bootstrap_admin BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS bootstrap_completed BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS scanner_staff_id INTEGER REFERENCES users(id) ON DELETE RESTRICT;

      CREATE INDEX IF NOT EXISTS idx_users_scanner_staff_id
        ON users(scanner_staff_id);
    `);
    console.log("✔ Bootstrap administrator columns checked/added");

    await client.query(
      `INSERT INTO roles (role_name, role_description, public_reference, role_key)
       VALUES ($1, $2, generate_role_public_reference(), 'scanner')
       ON CONFLICT (role_name) DO UPDATE
       SET role_description = EXCLUDED.role_description`,
      [
        roleNames.scanner,
        "Dedicated barcode scanner identity permanently linked to one active user for scan-only workflows."
      ]
    );
    console.log("✔ Scanner role checked/seeded");

    await client.query(`
      CREATE TABLE IF NOT EXISTS scanner_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        password_hash TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        last_login TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (status IN ('active', 'inactive'))
      );

      ALTER TABLE user_sessions
        ADD COLUMN IF NOT EXISTS identity_type VARCHAR(20) NOT NULL DEFAULT 'user',
        ADD COLUMN IF NOT EXISTS scanner_account_id INTEGER REFERENCES scanner_accounts(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_scanner_accounts_user_id
        ON scanner_accounts(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_scanner_account_id
        ON user_sessions(scanner_account_id);
    `);
    await client.query(`
      INSERT INTO scanner_accounts (user_id, password_hash, status, created_by, created_at, updated_at)
      SELECT
        legacy.scanner_staff_id,
        legacy.password_hash,
        CASE WHEN legacy.status = 'active' THEN 'active' ELSE 'inactive' END,
        legacy.id,
        legacy.created_at,
        legacy.updated_at
      FROM users legacy
      JOIN roles legacy_role ON legacy_role.id = legacy.role_id
      JOIN users linked_user ON linked_user.id = legacy.scanner_staff_id
      WHERE legacy_role.role_name = $1
        AND legacy.scanner_staff_id IS NOT NULL
      ON CONFLICT (user_id) DO NOTHING
    `, [roleNames.scanner]);
    await client.query(`
      UPDATE users legacy
      SET status = 'inactive',
          updated_at = CURRENT_TIMESTAMP
      FROM roles legacy_role
      WHERE legacy.role_id = legacy_role.id
        AND legacy_role.role_name = $1
        AND legacy.scanner_staff_id IS NOT NULL
    `, [roleNames.scanner]);
    await client.query(`
      DROP INDEX IF EXISTS idx_users_scanner_staff_id;
      ALTER TABLE users DROP COLUMN IF EXISTS scanner_staff_id;
    `);
    console.log("✔ Linked scanner identities checked/created");

    await client.query(`
      ALTER TABLE audit_logs
        ADD COLUMN IF NOT EXISTS target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS role_id_at_action INTEGER REFERENCES roles(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS warehouse_id_at_action INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

      CREATE INDEX IF NOT EXISTS idx_audit_logs_role_snapshot
        ON audit_logs(role_id_at_action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_warehouse_snapshot
        ON audit_logs(warehouse_id_at_action);
    `);
    console.log("✔ Audit snapshot columns checked/added");

    // 1. Add active columns if missing
    await client.query(`
      ALTER TABLE zones ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE zones ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE CASCADE;
    `);

    // Seed existing zones with a warehouse (Warehouse A)
    await client.query(`
      UPDATE zones 
      SET warehouse_id = (SELECT id FROM warehouses WHERE warehouse_code = 'WHA' LIMIT 1) 
      WHERE warehouse_id IS NULL;
    `);

    // Make warehouse_id NOT NULL when possible and configure uniqueness without
    // colliding with already-created production indexes/constraints.
    await client.query(`
      WITH default_warehouse AS (
        SELECT id
        FROM warehouses
        ORDER BY CASE WHEN warehouse_code = 'WHA' THEN 0 ELSE 1 END, id
        LIMIT 1
      )
      UPDATE zones
      SET warehouse_id = (SELECT id FROM default_warehouse)
      WHERE warehouse_id IS NULL
        AND EXISTS (SELECT 1 FROM default_warehouse);

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM zones WHERE warehouse_id IS NULL) THEN
          ALTER TABLE zones ALTER COLUMN warehouse_id SET NOT NULL;
        ELSE
          RAISE NOTICE 'Skipping zones.warehouse_id NOT NULL because some existing zones do not have an assignable warehouse.';
        END IF;
      END;
      $$;

      ALTER TABLE zones DROP CONSTRAINT IF EXISTS zones_code_key;
      DO $$
      BEGIN
        IF to_regclass('public.zones_warehouse_code_unique') IS NULL THEN
          IF EXISTS (
            SELECT 1
            FROM zones
            WHERE warehouse_id IS NOT NULL
            GROUP BY warehouse_id, code
            HAVING COUNT(*) > 1
          ) THEN
            RAISE NOTICE 'Skipping zones_warehouse_code_unique because duplicate zone codes exist in a warehouse.';
          ELSE
            CREATE UNIQUE INDEX zones_warehouse_code_unique ON zones(warehouse_id, code);
          END IF;
        END IF;
      END;
      $$;
      CREATE INDEX IF NOT EXISTS idx_zones_warehouse_id ON zones(warehouse_id);
    `);
    console.log("✔ Columns checked/added: zones.active, zones.warehouse_id (warehouse-scoped constraints applied)");

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

      INSERT INTO system_settings (setting_key, setting_value)
      VALUES ('cargo_pending_review_escalation_hours', '2'::jsonb)
      ON CONFLICT (setting_key) DO NOTHING;

      ALTER TABLE placement_validation_logs
        ADD COLUMN IF NOT EXISTS placement_mode VARCHAR(20) NOT NULL DEFAULT 'scan',
        ADD COLUMN IF NOT EXISTS attempt_stage VARCHAR(30) NOT NULL DEFAULT 'validation',
        ADD COLUMN IF NOT EXISTS manual_reason VARCHAR(80),
        ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS warehouse_id_at_action INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS result VARCHAR(20),
        ADD COLUMN IF NOT EXISTS previous_location TEXT,
        ADD COLUMN IF NOT EXISTS new_location TEXT;

      UPDATE placement_validation_logs
      SET performed_by = COALESCE(performed_by, user_id),
          result = COALESCE(result, CASE WHEN approved THEN 'Passed' ELSE 'Failed' END)
      WHERE performed_by IS NULL
         OR result IS NULL;

      CREATE TABLE IF NOT EXISTS bin_barcode_print_logs (
        id SERIAL PRIMARY KEY,
        bin_id INTEGER NOT NULL REFERENCES bins(id) ON DELETE CASCADE,
        printed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        print_type VARCHAR(20) NOT NULL DEFAULT 'PRINT',
        printed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (print_type IN ('PRINT', 'REPRINT'))
      );

      CREATE TABLE IF NOT EXISTS scanner_sessions (
        id SERIAL PRIMARY KEY,
        staff_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        workflow_type VARCHAR(80) NOT NULL,
        workflow_name VARCHAR(120) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'active',
        current_step_index INTEGER NOT NULL DEFAULT 0,
        steps JSONB NOT NULL DEFAULT '[]'::jsonb,
        context JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_error TEXT,
        last_success TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        cancelled_at TIMESTAMP,
        last_activity_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        expired_at TIMESTAMP,
        CHECK (status IN ('active', 'completed', 'cancelled', 'expired')),
        CHECK (current_step_index >= 0)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_scanner_sessions_active_staff
        ON scanner_sessions(staff_user_id)
        WHERE status = 'active';

      CREATE INDEX IF NOT EXISTS idx_scanner_sessions_staff_status
        ON scanner_sessions(staff_user_id, status, updated_at DESC);
    `);
    console.log("✔ Placement settings and trace tables checked/added");

    // 2. Create bin_rules table if missing
    await client.query(`
      CREATE TABLE IF NOT EXISTS bin_rules (
        id SERIAL PRIMARY KEY,
        public_reference VARCHAR(80) UNIQUE NOT NULL DEFAULT ('BR-' || UPPER(ENCODE(gen_random_bytes(8), 'hex'))),
        rule_key VARCHAR(80) UNIQUE NOT NULL,
        rule_name VARCHAR(150) NOT NULL,
        description TEXT,
        category_id INTEGER,
        rule_type VARCHAR(40) NOT NULL DEFAULT 'validation',
        evaluator_type VARCHAR(100),
        execution_targets TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        violation_action VARCHAR(40),
        severity VARCHAR(20),
        priority INTEGER NOT NULL DEFAULT 100,
        is_active BOOLEAN NOT NULL DEFAULT FALSE,
        parameters JSONB NOT NULL DEFAULT '{}',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
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

    await client.query(`
      DROP TRIGGER IF EXISTS set_scanner_sessions_updated_at ON scanner_sessions;
      CREATE TRIGGER set_scanner_sessions_updated_at
      BEFORE UPDATE ON scanner_sessions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);
    console.log("✔ Trigger set_scanner_sessions_updated_at configured");

    await client.query(`
      ALTER TABLE cargo
        ADD COLUMN IF NOT EXISTS workflow_status VARCHAR(40) NOT NULL DEFAULT 'Pending Review',
        ADD COLUMN IF NOT EXISTS registration_status VARCHAR(40) NOT NULL DEFAULT 'Pending Review',
        ADD COLUMN IF NOT EXISTS placement_status VARCHAR(40) NOT NULL DEFAULT 'Unplaced',
        ADD COLUMN IF NOT EXISTS warehouse_id_at_registration INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS assigned_staff_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
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

      UPDATE cargo
      SET created_by = COALESCE(created_by, received_by_user_id),
          assigned_staff_id = COALESCE(assigned_staff_id, created_by, received_by_user_id),
          warehouse_id_at_registration = COALESCE(warehouse_id_at_registration, warehouse_id)
      WHERE created_by IS NULL
         OR assigned_staff_id IS NULL
         OR warehouse_id_at_registration IS NULL;

      CREATE INDEX IF NOT EXISTS idx_cargo_registration_status
        ON cargo(registration_status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cargo_placement_status
        ON cargo(placement_status);
      CREATE INDEX IF NOT EXISTS idx_cargo_created_by
        ON cargo(created_by, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cargo_assigned_staff
        ON cargo(assigned_staff_id, registration_status, placement_status);
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

    await client.query(`
      ALTER TABLE cargo_movements
        ADD COLUMN IF NOT EXISTS from_bin_id INTEGER REFERENCES bins(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS to_bin_id INTEGER REFERENCES bins(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS moved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS warehouse_id_at_action INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS movement_type VARCHAR(80);

      UPDATE cargo_movements
      SET movement_type = COALESCE(movement_type, action)
      WHERE movement_type IS NULL;
    `);
    console.log("✔ Cargo movement ownership snapshots checked/added");

    await client.query(`
      ALTER TABLE approval_requests
        ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS warehouse_id_at_request INTEGER REFERENCES warehouses(id) ON DELETE SET NULL;

      UPDATE approval_requests ar
      SET assigned_to = COALESCE(ar.assigned_to, ar.assigned_supervisor_id),
          warehouse_id_at_request = COALESCE(ar.warehouse_id_at_request, c.warehouse_id)
      FROM cargo c
      WHERE c.id = ar.cargo_id
        AND (ar.assigned_to IS NULL OR ar.warehouse_id_at_request IS NULL);

      CREATE INDEX IF NOT EXISTS idx_approval_requests_assigned_to
        ON approval_requests(assigned_to, status);
      CREATE INDEX IF NOT EXISTS idx_approval_requests_warehouse_request
        ON approval_requests(warehouse_id_at_request, status);
    `);
    console.log("✔ Approval assignment snapshots checked/added");

    await client.query(`
      ALTER TABLE cargo_approval_history
        ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS warehouse_id_at_action INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

      UPDATE cargo_approval_history cah
      SET warehouse_id_at_action = COALESCE(cah.warehouse_id_at_action, c.warehouse_id),
          created_at = COALESCE(cah.created_at, cah.performed_at)
      FROM cargo c
      WHERE c.id = cah.cargo_id
        AND (cah.warehouse_id_at_action IS NULL OR cah.created_at IS NULL);
    `);
    console.log("✔ Cargo approval history snapshots checked/added");

    await client.query(`
      INSERT INTO approval_requests
        (request_type, cargo_id, requested_by, warehouse_id_at_request, reason, status, request_data)
      SELECT
        'CARGO_REGISTRATION',
        c.id,
        c.received_by_user_id,
        c.warehouse_id,
        'Cargo registration requires independent Warehouse Supervisor review before placement can begin.',
        'Pending',
        jsonb_build_object(
          'cargo_condition', c.cargo_condition,
          'cargo_type', c.cargo_type,
          'hazard_class', c.hazard_class,
          'migrated', TRUE
        )
      FROM cargo c
      WHERE c.registration_status = 'Pending Review'
        AND c.is_deleted = FALSE
        AND NOT EXISTS (
          SELECT 1
          FROM approval_requests ar
          WHERE ar.cargo_id = c.id
            AND ar.request_type = 'CARGO_REGISTRATION'
        );
    `);
    console.log("✔ Pending cargo approval requests reconciled");

    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        public_reference VARCHAR(40),
        recipient_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        recipient_role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
        recipient_warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE CASCADE,
        notification_type VARCHAR(80) NOT NULL,
        title VARCHAR(180) NOT NULL,
        message TEXT NOT NULL,
        related_module VARCHAR(120),
        related_entity_type VARCHAR(80),
        related_entity_id INTEGER,
        priority VARCHAR(20) NOT NULL DEFAULT 'normal',
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        read_at TIMESTAMP,
        status VARCHAR(40) NOT NULL DEFAULT 'pending',
        completed_at TIMESTAMP,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        archived_at TIMESTAMP,
        archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      );

      ALTER TABLE notifications
        ADD COLUMN IF NOT EXISTS public_reference VARCHAR(40);
    `);

    // Backfill existing notifications with secure references.
    const selectRes = await client.query("SELECT id, created_at FROM notifications WHERE public_reference IS NULL");
    console.log(`✔ Backfilling ${selectRes.rowCount} notifications with public references...`);
    const generatedReferences = new Set();

    for (const row of selectRes.rows) {
      let success = false;
      let attempts = 0;
      while (!success && attempts < 5) {
        attempts++;
        const publicReference = generateNotificationReference(row.created_at);
        if (generatedReferences.has(publicReference)) continue;
        try {
          await client.query("UPDATE notifications SET public_reference = $1 WHERE id = $2", [publicReference, row.id]);
          generatedReferences.add(publicReference);
          success = true;
        } catch (err) {
          if (
            err.code === "23505"
            && err.constraint === "notifications_public_reference_key"
          ) {
            continue;
          }
          throw err;
        }
      }
      if (!success) {
        throw new Error(`Failed to generate a unique public reference for notification ID ${row.id}`);
      }
    }

    const nullReferenceCheck = await client.query(
      "SELECT COUNT(*)::int AS count FROM notifications WHERE public_reference IS NULL"
    );
    if (nullReferenceCheck.rows[0]?.count > 0) {
      throw new Error("Notification public reference backfill failed: NULL values remain.");
    }

    const duplicateReferenceCheck = await client.query(`
      SELECT public_reference, COUNT(*)::int AS count
      FROM notifications
      GROUP BY public_reference
      HAVING COUNT(*) > 1
      LIMIT 1
    `);
    if (duplicateReferenceCheck.rowCount > 0) {
      throw new Error(`Notification public reference backfill failed: duplicate reference ${duplicateReferenceCheck.rows[0].public_reference}.`);
    }

    // Apply public reference constraints, then lifecycle/archive columns and constraints.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM notifications WHERE public_reference IS NULL) THEN
          ALTER TABLE notifications ALTER COLUMN public_reference SET NOT NULL;
        ELSE
          RAISE NOTICE 'Skipping notifications.public_reference NOT NULL because existing notifications still contain NULL references.';
        END IF;
      END;
      $$;

      DO $$
      BEGIN
        IF to_regclass('public.notifications_public_reference_key') IS NULL THEN
          IF EXISTS (
            SELECT 1
            FROM notifications
            WHERE public_reference IS NOT NULL
            GROUP BY public_reference
            HAVING COUNT(*) > 1
          ) THEN
            RAISE NOTICE 'Skipping notifications_public_reference_key because duplicate notification public references exist.';
          ELSE
            CREATE UNIQUE INDEX notifications_public_reference_key ON notifications(public_reference);
          END IF;
        END IF;
      END;
      $$;

      ALTER TABLE notifications
        ADD COLUMN IF NOT EXISTS recipient_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS recipient_role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS recipient_warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS related_module VARCHAR(120),
        ADD COLUMN IF NOT EXISTS related_entity_type VARCHAR(80),
        ADD COLUMN IF NOT EXISTS related_entity_id INTEGER,
        ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'normal',
        ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS read_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

      ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_priority_check;
      ALTER TABLE notifications
        ADD CONSTRAINT notifications_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

      ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_status_check;
      ALTER TABLE notifications ADD CONSTRAINT notifications_status_check CHECK (status IN ('pending', 'completed', 'dismissed'));

      ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_archived_by_fkey;
      ALTER TABLE notifications ADD CONSTRAINT notifications_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_notifications_recipient_user
        ON notifications(recipient_user_id, is_read, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_recipient_role
        ON notifications(recipient_role_id, is_read, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_recipient_warehouse
        ON notifications(recipient_warehouse_id, is_read, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_type_priority
        ON notifications(notification_type, priority, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_archived ON notifications(archived_at);
    `);

    console.log("✔ Notifications table checked/added/backfilled");

    const warehouseConfigurationMigration = fs.readFileSync(
      path.join(__dirname, "migrations", "warehouse_configuration_srs.sql"),
      "utf8"
    );
    await client.query(warehouseConfigurationMigration);
    console.log("✔ SRS warehouse configuration schema checked/applied");

    const financeCustomsGateMigration = fs.readFileSync(
      path.join(__dirname, "migrations", "finance_customs_gate_workflows.sql"),
      "utf8"
    );
    await client.query(financeCustomsGateMigration);
    console.log("✔ Finance, Customs, and Gate workflow schema checked/applied");

    await recordMigration(client, legacyMigrationName, legacyMigrationChecksum, "applied");
    await client.query("COMMIT");
    transactionOpen = false;
    console.log("All database updates applied successfully!");
    } else {
      console.log("✔ Legacy inline schema updates already applied");
    }

    const permissionCatalogMigration = fs.readFileSync(
      path.join(__dirname, "migrations", "20260725_permission_catalog.sql"),
      "utf8"
    );
    await applySqlMigration(client, "004_permission_catalog.sql", permissionCatalogMigration);

    const integrityConstraintsMigration = fs.readFileSync(
      path.join(__dirname, "migrations", "20260725_integrity_constraints.sql"),
      "utf8"
    );
    await applySqlMigration(client, "005_integrity_constraints.sql", integrityConstraintsMigration);

    const shiftWarehouseAssignmentsMigration = fs.readFileSync(
      path.join(__dirname, "migrations", "20260725_shift_warehouse_assignments.sql"),
      "utf8"
    );
    await applySqlMigration(client, "006_shift_warehouse_assignments.sql", shiftWarehouseAssignmentsMigration);

    const notificationSchedulerMigration = fs.readFileSync(
      path.join(__dirname, "migrations", "20260725_notification_scheduler_settings.sql"),
      "utf8"
    );
    await applySqlMigration(client, "007_notification_scheduler_settings.sql", notificationSchedulerMigration);

    const expandWarehouseCapacityMigration = fs.readFileSync(
      path.join(__dirname, "migrations", "20260811_expand_warehouse_capacity.sql"),
      "utf8"
    );
    await applySqlMigration(client, "013_expand_warehouse_capacity.sql", expandWarehouseCapacityMigration);

    const expandStorageHierarchyCapacityMigration = fs.readFileSync(
      path.join(__dirname, "migrations", "20260811_expand_storage_hierarchy_capacity.sql"),
      "utf8"
    );
    await applySqlMigration(client, "014_expand_storage_hierarchy_capacity.sql", expandStorageHierarchyCapacityMigration);

    const repairBuiltinBinRuleEvaluatorsMigration = fs.readFileSync(
      path.join(__dirname, "migrations", "20260811_repair_builtin_bin_rule_evaluators.sql"),
      "utf8"
    );
    await applySqlMigration(client, "015_repair_builtin_bin_rule_evaluators.sql", repairBuiltinBinRuleEvaluatorsMigration);

    const correctReservedBinRuleEvaluatorMigration = fs.readFileSync(
      path.join(__dirname, "migrations", "20260811_correct_reserved_bin_rule_evaluator.sql"),
      "utf8"
    );
    await applySqlMigration(client, "016_correct_reserved_bin_rule_evaluator.sql", correctReservedBinRuleEvaluatorMigration);

    const lockBuiltinBinRuleEvaluatorsMigration = fs.readFileSync(
      path.join(__dirname, "migrations", "20260811_lock_builtin_bin_rule_evaluators.sql"),
      "utf8"
    );
    await applySqlMigration(client, "017_lock_builtin_bin_rule_evaluators.sql", lockBuiltinBinRuleEvaluatorsMigration);

    const policyConfigurationFoundationMigration = fs.readFileSync(
      path.join(__dirname, "migrations", "20260812_policy_configuration_foundation.sql"),
      "utf8"
    );
    await applySqlMigration(client, "018_policy_configuration_foundation.sql", policyConfigurationFoundationMigration);

    const authRefreshTokenSessionsMigration = fs.readFileSync(
      path.join(__dirname, "migrations", "20260812_auth_refresh_token_sessions.sql"),
      "utf8"
    );
    await applySqlMigration(client, "019_auth_refresh_token_sessions.sql", authRefreshTokenSessionsMigration);

    const cargoRegistrationAuthorityMigration = fs.readFileSync(
      path.join(__dirname, "migrations", "20260812_cargo_registration_configuration_authority.sql"),
      "utf8"
    );
    await applySqlMigration(client, "020_cargo_registration_configuration_authority.sql", cargoRegistrationAuthorityMigration);
    const rbacAuthorizationMigration = fs.readFileSync(path.join(__dirname, "migrations", "20260812_rbac_authorization_source_of_truth.sql"), "utf8");
    await applySqlMigration(client, "021_rbac_authorization_source_of_truth.sql", rbacAuthorizationMigration);
    const rbacAdministratorHardeningMigration = fs.readFileSync(path.join(__dirname, "migrations", "20260812_rbac_administrator_explicit_permissions.sql"), "utf8");
    await applySqlMigration(client, "022_rbac_administrator_explicit_permissions.sql", rbacAdministratorHardeningMigration);
    const binRuleEngineAuthorityMigration = fs.readFileSync(path.join(__dirname, "migrations", "20260812_bin_rule_engine_authority.sql"), "utf8");
    await applySqlMigration(client, "023_bin_rule_engine_authority.sql", binRuleEngineAuthorityMigration);
    const cargoWorkflowPolicyMigration = fs.readFileSync(path.join(__dirname, "migrations", "20260812_cargo_workflow_policy.sql"), "utf8");
    await applySqlMigration(client, "024_cargo_workflow_policy.sql", cargoWorkflowPolicyMigration);
    const financePolicyAuthorityMigration = fs.readFileSync(path.join(__dirname, "migrations", "20260812_finance_policy_authority.sql"), "utf8");
    await applySqlMigration(client, "025_finance_policy_authority.sql", financePolicyAuthorityMigration);
    const customsWorkflowAuthorityMigration = fs.readFileSync(path.join(__dirname, "migrations", "20260813_customs_workflow_authority.sql"), "utf8");
    await applySqlMigration(client, "026_customs_workflow_authority.sql", customsWorkflowAuthorityMigration);
    const dispatchGatePolicyAuthorityMigration = fs.readFileSync(path.join(__dirname, "migrations", "20260813_dispatch_gate_policy_authority.sql"), "utf8");
    await applySqlMigration(client, "027_dispatch_gate_policy_authority.sql", dispatchGatePolicyAuthorityMigration);
    const scannerPolicyAuthorityMigration = fs.readFileSync(path.join(__dirname, "migrations", "20260813_scanner_policy_authority.sql"), "utf8");
    await applySqlMigration(client, "028_scanner_policy_authority.sql", scannerPolicyAuthorityMigration);
    const notificationPolicyAuthorityMigration = fs.readFileSync(path.join(__dirname, "migrations", "20260813_notification_policy_authority.sql"), "utf8");
    await applySqlMigration(client, "029_notification_policy_authority.sql", notificationPolicyAuthorityMigration);
    const uatSrsClosureMigration = fs.readFileSync(path.join(__dirname, "migrations", "20260815_uat_srs_closure.sql"), "utf8");
    await applySqlMigration(client, "030_uat_srs_closure.sql", uatSrsClosureMigration);
    const securityHardeningMigration = fs.readFileSync(path.join(__dirname, "migrations", "20260815_security_hardening.sql"), "utf8");
    await applySqlMigration(client, "031_security_hardening.sql", securityHardeningMigration);
    const managementReleaseMigration = fs.readFileSync(path.join(__dirname, "migrations", "20260816_management_release_workflow.sql"), "utf8");
    await applySqlMigration(client, "032_management_release_workflow.sql", managementReleaseMigration);
    const managementReleaseGateMigration = fs.readFileSync(path.join(__dirname, "migrations", "20260816_management_release_gate_authority.sql"), "utf8");
    await applySqlMigration(client, "033_management_release_gate_authority.sql", managementReleaseGateMigration);
    const auditorPortalCompletionMigration = fs.readFileSync(path.join(__dirname, "migrations", "20260817_auditor_portal_completion.sql"), "utf8");
    await applySqlMigration(client, "034_auditor_portal_completion.sql", auditorPortalCompletionMigration);
    const financePaymentReleaseMigration = fs.readFileSync(path.join(__dirname, "migrations", "20260820_finance_payment_release_workflow.sql"), "utf8");
    await applySqlMigration(client, "035_finance_payment_release_workflow.sql", financePaymentReleaseMigration);
    const revokeFinanceLegacyManualPermissionsMigration = fs.readFileSync(path.join(__dirname, "migrations", "20260821_revoke_finance_legacy_manual_permissions.sql"), "utf8");
    await applySqlMigration(client, "036_revoke_finance_legacy_manual_permissions.sql", revokeFinanceLegacyManualPermissionsMigration);
    const alignCargoCustomsDefaultsMigration = fs.readFileSync(path.join(__dirname, "migrations", "20260821_align_cargo_customs_defaults.sql"), "utf8");
    await applySqlMigration(client, "037_align_cargo_customs_defaults.sql", alignCargoCustomsDefaultsMigration);
    await applySqlMigration(client, "038_installment_payment_workflow.sql", fs.readFileSync(path.join(__dirname, "migrations", "20260822_installment_payment_workflow.sql"), "utf8"));
    await applySqlMigration(client, "039_payment_email_delivery.sql", fs.readFileSync(path.join(__dirname, "migrations", "20260822_payment_email_delivery.sql"), "utf8"));
    await applySqlMigration(client, "040_public_payment_token_invariants.sql", fs.readFileSync(path.join(__dirname, "migrations", "20260822_public_payment_token_invariants.sql"), "utf8"));
    await applySqlMigration(client, "041_session_selector_cookie_isolation.sql", fs.readFileSync(path.join(__dirname, "migrations", "20260823_session_selector_cookie_isolation.sql"), "utf8"));
    await ensureStandardRolePermissions(client);
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    if (legacyStarted) {
      await recordMigration(client, legacyMigrationName, legacyMigrationChecksum, "failed").catch(() => {});
    }
    console.error("Failed to run database schema updates:");
    console.error(error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
};

runUpdates();

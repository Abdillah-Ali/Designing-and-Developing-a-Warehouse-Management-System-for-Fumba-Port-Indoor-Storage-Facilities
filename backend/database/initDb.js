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
  const expandWarehouseCapacityMigrationPath = path.join(
    __dirname, "migrations", "20260811_expand_warehouse_capacity.sql"
  );
  const expandStorageHierarchyCapacityMigrationPath = path.join(
    __dirname, "migrations", "20260811_expand_storage_hierarchy_capacity.sql"
  );
  const repairBuiltinBinRuleEvaluatorsMigrationPath = path.join(
    __dirname, "migrations", "20260811_repair_builtin_bin_rule_evaluators.sql"
  );
  const correctReservedBinRuleEvaluatorMigrationPath = path.join(
    __dirname, "migrations", "20260811_correct_reserved_bin_rule_evaluator.sql"
  );
  const lockBuiltinBinRuleEvaluatorsMigrationPath = path.join(
    __dirname, "migrations", "20260811_lock_builtin_bin_rule_evaluators.sql"
  );
  const policyConfigurationFoundationMigrationPath = path.join(
    __dirname, "migrations", "20260812_policy_configuration_foundation.sql"
  );
  const authRefreshTokenSessionsMigrationPath = path.join(
    __dirname, "migrations", "20260812_auth_refresh_token_sessions.sql"
  );
  const cargoRegistrationAuthorityMigrationPath = path.join(
    __dirname, "migrations", "20260812_cargo_registration_configuration_authority.sql"
  );
  const rbacAuthorizationMigrationPath = path.join(__dirname, "migrations", "20260812_rbac_authorization_source_of_truth.sql");
  const rbacAdministratorHardeningMigrationPath = path.join(__dirname, "migrations", "20260812_rbac_administrator_explicit_permissions.sql");
  const binRuleEngineAuthorityMigrationPath = path.join(__dirname, "migrations", "20260812_bin_rule_engine_authority.sql");
  const cargoWorkflowPolicyMigrationPath = path.join(__dirname, "migrations", "20260812_cargo_workflow_policy.sql");
  const financePolicyAuthorityMigrationPath = path.join(__dirname, "migrations", "20260812_finance_policy_authority.sql");
  const customsWorkflowAuthorityMigrationPath = path.join(__dirname, "migrations", "20260813_customs_workflow_authority.sql");
  const dispatchGatePolicyAuthorityMigrationPath = path.join(__dirname, "migrations", "20260813_dispatch_gate_policy_authority.sql");
  const scannerPolicyAuthorityMigrationPath = path.join(__dirname, "migrations", "20260813_scanner_policy_authority.sql");
  const notificationPolicyAuthorityMigrationPath = path.join(__dirname, "migrations", "20260813_notification_policy_authority.sql");
  const uatSrsClosureMigrationPath = path.join(__dirname, "migrations", "20260815_uat_srs_closure.sql");
  const managementReleaseMigrationPath = path.join(__dirname, "migrations", "20260816_management_release_workflow.sql");
  const managementReleaseGateMigrationPath = path.join(__dirname, "migrations", "20260816_management_release_gate_authority.sql");
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
  const expandWarehouseCapacityMigration = await fs.readFile(expandWarehouseCapacityMigrationPath, "utf8");
  const expandStorageHierarchyCapacityMigration = await fs.readFile(expandStorageHierarchyCapacityMigrationPath, "utf8");
  const repairBuiltinBinRuleEvaluatorsMigration = await fs.readFile(repairBuiltinBinRuleEvaluatorsMigrationPath, "utf8");
  const correctReservedBinRuleEvaluatorMigration = await fs.readFile(correctReservedBinRuleEvaluatorMigrationPath, "utf8");
  const lockBuiltinBinRuleEvaluatorsMigration = await fs.readFile(lockBuiltinBinRuleEvaluatorsMigrationPath, "utf8");
  const policyConfigurationFoundationMigration = await fs.readFile(policyConfigurationFoundationMigrationPath, "utf8");
  const authRefreshTokenSessionsMigration = await fs.readFile(authRefreshTokenSessionsMigrationPath, "utf8");
  const cargoRegistrationAuthorityMigration = await fs.readFile(cargoRegistrationAuthorityMigrationPath, "utf8");
  const rbacAuthorizationMigration = await fs.readFile(rbacAuthorizationMigrationPath, "utf8");
  const rbacAdministratorHardeningMigration = await fs.readFile(rbacAdministratorHardeningMigrationPath, "utf8");
  const binRuleEngineAuthorityMigration = await fs.readFile(binRuleEngineAuthorityMigrationPath, "utf8");
  const cargoWorkflowPolicyMigration = await fs.readFile(cargoWorkflowPolicyMigrationPath, "utf8");
  const financePolicyAuthorityMigration = await fs.readFile(financePolicyAuthorityMigrationPath, "utf8");
  const customsWorkflowAuthorityMigration = await fs.readFile(customsWorkflowAuthorityMigrationPath, "utf8");
  const dispatchGatePolicyAuthorityMigration = await fs.readFile(dispatchGatePolicyAuthorityMigrationPath, "utf8");
  const scannerPolicyAuthorityMigration = await fs.readFile(scannerPolicyAuthorityMigrationPath, "utf8");
  const notificationPolicyAuthorityMigration = await fs.readFile(notificationPolicyAuthorityMigrationPath, "utf8");
  const uatSrsClosureMigration = await fs.readFile(uatSrsClosureMigrationPath, "utf8");

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
    await applySqlMigration(client, "013_expand_warehouse_capacity.sql", expandWarehouseCapacityMigration);
    await applySqlMigration(client, "014_expand_storage_hierarchy_capacity.sql", expandStorageHierarchyCapacityMigration);
    await applySqlMigration(client, "015_repair_builtin_bin_rule_evaluators.sql", repairBuiltinBinRuleEvaluatorsMigration);
    await applySqlMigration(client, "016_correct_reserved_bin_rule_evaluator.sql", correctReservedBinRuleEvaluatorMigration);
    await applySqlMigration(client, "017_lock_builtin_bin_rule_evaluators.sql", lockBuiltinBinRuleEvaluatorsMigration);
    await applySqlMigration(client, "018_policy_configuration_foundation.sql", policyConfigurationFoundationMigration);
    await applySqlMigration(client, "019_auth_refresh_token_sessions.sql", authRefreshTokenSessionsMigration);
    await applySqlMigration(client, "020_cargo_registration_configuration_authority.sql", cargoRegistrationAuthorityMigration);
    await applySqlMigration(client, "021_rbac_authorization_source_of_truth.sql", rbacAuthorizationMigration);
    await applySqlMigration(client, "022_rbac_administrator_explicit_permissions.sql", rbacAdministratorHardeningMigration);
    await applySqlMigration(client, "023_bin_rule_engine_authority.sql", binRuleEngineAuthorityMigration);
    await applySqlMigration(client, "024_cargo_workflow_policy.sql", cargoWorkflowPolicyMigration);
    await applySqlMigration(client, "025_finance_policy_authority.sql", financePolicyAuthorityMigration);
    await applySqlMigration(client, "026_customs_workflow_authority.sql", customsWorkflowAuthorityMigration);
    await applySqlMigration(client, "027_dispatch_gate_policy_authority.sql", dispatchGatePolicyAuthorityMigration);
    await applySqlMigration(client, "028_scanner_policy_authority.sql", scannerPolicyAuthorityMigration);
    await applySqlMigration(client, "029_notification_policy_authority.sql", notificationPolicyAuthorityMigration);
    await applySqlMigration(client, "030_uat_srs_closure.sql", uatSrsClosureMigration);
    await applySqlMigration(client, "032_management_release_workflow.sql", await fs.readFile(managementReleaseMigrationPath, "utf8"));
    await applySqlMigration(client, "033_management_release_gate_authority.sql", await fs.readFile(managementReleaseGateMigrationPath, "utf8"));
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

  const protectedRoleKeys = new Map([
    [roleNames.systemAdmin, "system_administrator"], [roleNames.warehouseStaff, "warehouse_staff"],
    [roleNames.warehouseSupervisor, "warehouse_supervisor"], [roleNames.financeOfficer, "finance_officer"],
    [roleNames.customsOfficer, "customs_officer"], [roleNames.gateOfficer, "gate_officer"],
    [roleNames.management, "management"], [roleNames.scanner, "scanner"]
  ]);

  for (const role of defaultRoleDefinitions) {
    const roleKey = protectedRoleKeys.get(role.name) || `custom_${String(role.name).toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    await client.query(
      `INSERT INTO roles (role_name, role_description, public_reference, role_key)
       VALUES ($1, $2, generate_role_public_reference(), $3)
       ON CONFLICT (role_name) DO UPDATE
       SET role_description = EXCLUDED.role_description`,
      [role.name, role.description || null, roleKey]
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

const path = require("path");
const dotenv = require("dotenv");
const { Client } = require("pg");

dotenv.config({ path: path.join(__dirname, "../.env") });

const dbName = process.env.DB_NAME || "fumbaport_wms";
const clientConfig = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD,
  database: dbName
};

async function cleanup() {
  const client = new Client(clientConfig);
  await client.connect();
  console.log("Connected to database for cleaning up seeded data...");

  try {
    await client.query("BEGIN");

    // 1. Delete seeded cargo locations & cargo
    const seededCargoIds = [
      "CRG-2026-EXCAV-01", "CRG-2026-STEEL-02", "CRG-2026-TURB-03", "CRG-2026-SONY-04",
      "CRG-2026-SAMS-05", "CRG-2026-CISCO-06", "CRG-2026-COLD-07", "CRG-2026-MED-08",
      "CRG-2026-SPICE-09", "CRG-2026-HAZ-10", "CRG-2026-GAS-11", "CRG-2026-AUTO-12",
      "CRG-2026-TEXT-13", "CRG-2026-SOLAR-14"
    ];

    const delLocs = await client.query(
      `DELETE FROM cargo_locations WHERE cargo_id IN (SELECT id FROM cargo WHERE cargo_id = ANY($1::text[]))`,
      [seededCargoIds]
    );
    console.log(`✔ Deleted ${delLocs.rowCount} seeded cargo location records`);

    const delCargo = await client.query(
      `DELETE FROM cargo WHERE cargo_id = ANY($1::text[])`,
      [seededCargoIds]
    );
    console.log(`✔ Deleted ${delCargo.rowCount} seeded cargo records`);

    // 2. Delete seeded Warehouse Admin user accounts
    const seededAdmins = ["admin_wha", "admin_whb", "admin_whc"];
    const delUsers = await client.query(
      `DELETE FROM users WHERE username = ANY($1::text[])`,
      [seededAdmins]
    );
    console.log(`✔ Deleted ${delUsers.rowCount} seeded admin user accounts`);

    // 3. Delete seeded bins, levels, racks, zones for WHA, WHB, WHC hierarchy
    const zoneCodes = [
      "WHA-ZA", "WHA-ZB", "WHA-ZC", "WHA-ZD", "WHA-ZE",
      "WHB-ZA", "WHB-ZB", "WHB-ZC", "WHB-ZD", "WHB-ZE",
      "WHC-ZA", "WHC-ZB", "WHC-ZC", "WHC-ZD", "WHC-ZE"
    ];

    // Delete bins associated with these zones
    const delBins = await client.query(
      `DELETE FROM bins WHERE level_id IN (
         SELECT l.id FROM levels l
         JOIN racks r ON r.id = l.rack_id
         JOIN zones z ON z.id = r.zone_id
         WHERE z.code = ANY($1::text[])
       )`,
      [zoneCodes]
    );
    console.log(`✔ Deleted ${delBins.rowCount} seeded bins`);

    // Delete levels
    const delLevels = await client.query(
      `DELETE FROM levels WHERE rack_id IN (
         SELECT r.id FROM racks r
         JOIN zones z ON z.id = r.zone_id
         WHERE z.code = ANY($1::text[])
       )`,
      [zoneCodes]
    );
    console.log(`✔ Deleted ${delLevels.rowCount} seeded levels`);

    // Delete racks
    const delRacks = await client.query(
      `DELETE FROM racks WHERE zone_id IN (
         SELECT id FROM zones WHERE code = ANY($1::text[])
       )`,
      [zoneCodes]
    );
    console.log(`✔ Deleted ${delRacks.rowCount} seeded racks`);

    // Delete zones
    const delZones = await client.query(
      `DELETE FROM zones WHERE code = ANY($1::text[])`,
      [zoneCodes]
    );
    console.log(`✔ Deleted ${delZones.rowCount} seeded zones`);

    // 4. Delete seeded Warehouse C (WHC)
    const delWhc = await client.query(`DELETE FROM warehouses WHERE warehouse_code = 'WHC'`);
    console.log(`✔ Deleted ${delWhc.rowCount} created warehouse (WHC)`);

    // Reset WHA and WHB names to original default state if desired
    await client.query(
      `UPDATE warehouses
       SET warehouse_name = 'Warehouse A', description = NULL
       WHERE warehouse_code = 'WHA'`
    );
    await client.query(
      `UPDATE warehouses
       SET warehouse_name = 'Warehouse B', description = NULL
       WHERE warehouse_code = 'WHB'`
    );
    console.log("✔ Restored Warehouse A and Warehouse B default names");

    await client.query("COMMIT");
    console.log("\n🎉 All seeded data has been completely deleted and cleaned up!");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Cleanup failed:", error);
    throw error;
  } finally {
    await client.end();
  }
}

cleanup().catch((err) => {
  console.error("Fatal cleanup execution error:", err);
  process.exit(1);
});

const path = require("path");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
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

async function seed() {
  const client = new Client(clientConfig);
  await client.connect();
  console.log("Connected to database for seeding real warehouse hierarchy...");

  try {
    await client.query("BEGIN");

    // 1. Fetch System Roles
    const rolesRes = await client.query("SELECT id, role_name, role_key FROM roles");
    const rolesMap = new Map(rolesRes.rows.map((r) => [r.role_name, r.id]));
    const supervisorRoleId = rolesMap.get("Supervisor") || rolesMap.get("Warehouse Supervisor") || 3;
    const staffRoleId = rolesMap.get("Warehouse Staff") || 2;
    const systemAdminRoleId = rolesMap.get("System Admin") || 1;

    console.log("Loaded system roles. Supervisor Role ID:", supervisorRoleId);

    // 2. Real Fumba Port Warehouses
    const warehouseData = [
      {
        code: "WHA",
        letter: "A",
        name: "Fumba Port Main Freight Hub (Warehouse A)",
        description: "Primary indoor logistics terminal for general cargo, dry goods, automotive parts, machinery, and commercial items.",
        total_capacity: 250000.00,
        max_volume: 1500.00,
        warning: 80.00,
        full: 100.00
      },
      {
        code: "WHB",
        letter: "B",
        name: "Fumba Port Cold & Sensitive Freight Hub (Warehouse B)",
        description: "Specialized climate-controlled indoor terminal for perishable foodstuffs, pharmaceuticals, high-value electronics, and fragile goods.",
        total_capacity: 180000.00,
        max_volume: 1000.00,
        warning: 80.00,
        full: 100.00
      },
      {
        code: "WHC",
        letter: "C",
        name: "Fumba Port Heavy & Bonded Transit Hub (Warehouse C)",
        description: "High-capacity indoor storage facility for heavy industrial machinery, steel, construction materials, chemicals, and bonded international transit freight.",
        total_capacity: 400000.00,
        max_volume: 2500.00,
        warning: 85.00,
        full: 100.00
      }
    ];

    const warehouseMap = new Map();
    for (const wh of warehouseData) {
      const res = await client.query(
        `INSERT INTO warehouses (warehouse_name, warehouse_code, status, warehouse_letter, description, total_capacity, max_volume, occupancy_warning_threshold, full_threshold, updated_at)
         VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
         ON CONFLICT (warehouse_code) DO UPDATE
         SET warehouse_name = EXCLUDED.warehouse_name,
             warehouse_letter = EXCLUDED.warehouse_letter,
             description = EXCLUDED.description,
             total_capacity = EXCLUDED.total_capacity,
             max_volume = EXCLUDED.max_volume,
             status = 'active',
             updated_at = CURRENT_TIMESTAMP
         RETURNING id, warehouse_code`,
        [wh.name, wh.code, wh.letter, wh.description, wh.total_capacity, wh.max_volume, wh.warning, wh.full]
      );
      warehouseMap.set(wh.code, res.rows[0].id);
      console.log(`✔ Warehouse ${wh.code} set up with ID ${res.rows[0].id}`);
    }

    // 3. Active Warehouse Admin User Accounts
    const defaultPasswordHash = await bcrypt.hash("Admin@1234", 10);

    const warehouseAdmins = [
      {
        username: "admin_wha",
        full_name: "Juma Ali - WHA Admin",
        email: "juma.ali@fumbaport.go.tz",
        phone_number: "+255 770 111 222",
        role_id: supervisorRoleId,
        warehouse_id: warehouseMap.get("WHA")
      },
      {
        username: "admin_whb",
        full_name: "Amina Hassan - WHB Admin",
        email: "amina.hassan@fumbaport.go.tz",
        phone_number: "+255 770 333 444",
        role_id: supervisorRoleId,
        warehouse_id: warehouseMap.get("WHB")
      },
      {
        username: "admin_whc",
        full_name: "Said Salum - WHC Admin",
        email: "said.salum@fumbaport.go.tz",
        phone_number: "+255 770 555 666",
        role_id: supervisorRoleId,
        warehouse_id: warehouseMap.get("WHC")
      }
    ];

    for (const admin of warehouseAdmins) {
      await client.query(
        `INSERT INTO users (username, full_name, email, phone_number, password_hash, role_id, warehouse_id, status, must_change_password, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (username) DO UPDATE
         SET full_name = EXCLUDED.full_name,
             email = EXCLUDED.email,
             phone_number = EXCLUDED.phone_number,
             role_id = EXCLUDED.role_id,
             warehouse_id = EXCLUDED.warehouse_id,
             status = 'active',
             must_change_password = FALSE,
             updated_at = CURRENT_TIMESTAMP`,
        [admin.username, admin.full_name, admin.email, admin.phone_number, defaultPasswordHash, admin.role_id, admin.warehouse_id]
      );
      console.log(`✔ Active Warehouse Admin '${admin.username}' set up for Warehouse ID ${admin.warehouse_id}`);
    }

    // Ensure existing accounts are active and mapped properly
    await client.query(
      `UPDATE users
       SET status = 'active', must_change_password = FALSE
       WHERE username IN ('supervisor_uat', 'staff_uat', 'billing_uat', 'customs_uat', 'Abdillah')`
    );

    // 4. Storage Hierarchy Setup (5 Zones x 3 Racks x 4 Levels x 1 Bin = 60 Bins per Warehouse)
    const zoneTemplates = [
      {
        letter: "A",
        name: "General Freight & Commercial Goods",
        type: "Standard",
        allowed_cargo_type: "General Goods",
        is_hazard: false,
        max_weight: 60000.00,
        max_volume: 350.00,
        desc: "Zone A dedicated to dry freight, packaged consumer goods, and general cargo."
      },
      {
        letter: "B",
        name: "Electronics & High-Value Cargo",
        type: "High Density",
        allowed_cargo_type: "Electronics",
        is_hazard: false,
        max_weight: 40000.00,
        max_volume: 250.00,
        desc: "Zone B secured for telecommunications, electronics, appliances, and high-value items."
      },
      {
        letter: "C",
        name: "Heavy Machinery & Industrial Equipment",
        type: "Heavy Duty",
        allowed_cargo_type: "Machinery",
        is_hazard: false,
        max_weight: 120000.00,
        max_volume: 600.00,
        desc: "Zone C heavy-load floor designed for industrial pumps, engines, steel, and machinery."
      },
      {
        letter: "D",
        name: "Perishables & Cold Storage Freight",
        type: "Cold Storage",
        allowed_cargo_type: "Food Products",
        is_hazard: false,
        max_weight: 50000.00,
        max_volume: 300.00,
        desc: "Zone D temperature-controlled storage for foodstuffs, drinks, and medical supplies."
      },
      {
        letter: "E",
        name: "Chemicals & Hazardous Cargo",
        type: "Hazardous",
        allowed_cargo_type: "Hazardous Cargo",
        is_hazard: true,
        max_weight: 45000.00,
        max_volume: 280.00,
        desc: "Zone E hazardous containment area equipped with specialized spill response & safety equipment."
      }
    ];

    const rackTemplates = [
      { codeSuffix: "R01", nameSuffix: "Rack 01 - Primary Shelf", max_weight: 20000.00, max_volume: 120.00 },
      { codeSuffix: "R02", nameSuffix: "Rack 02 - Central Shelf", max_weight: 20000.00, max_volume: 120.00 },
      { codeSuffix: "R03", nameSuffix: "Rack 03 - Secondary Shelf", max_weight: 20000.00, max_volume: 120.00 }
    ];

    const levelTemplates = [
      {
        level_number: 1,
        codeSuffix: "L1",
        name: "Level 1 - Heavy Bulk (Ground)",
        max_weight: 5000.00,
        max_volume: 15.00,
        bin_type: "Heavy Duty",
        dim: { length: 3.00, width: 2.50, height: 2.00 }
      },
      {
        level_number: 2,
        codeSuffix: "L2",
        name: "Level 2 - Industrial Standard",
        max_weight: 1500.00,
        max_volume: 4.50,
        bin_type: "Standard",
        dim: { length: 2.00, width: 1.50, height: 1.50 }
      },
      {
        level_number: 3,
        codeSuffix: "L3",
        name: "Level 3 - Medium & High Density",
        max_weight: 750.00,
        max_volume: 2.16,
        bin_type: "High Density",
        dim: { length: 1.50, width: 1.20, height: 1.20 }
      },
      {
        level_number: 4,
        codeSuffix: "L4",
        name: "Level 4 - Top Tier Compact",
        max_weight: 300.00,
        max_volume: 0.64,
        bin_type: "Small Item Rack",
        dim: { length: 1.00, width: 0.80, height: 0.80 }
      }
    ];

    const createdBins = [];

    for (const [whCode, whId] of warehouseMap.entries()) {
      console.log(`\nGenerating 60 bins hierarchy for Warehouse ${whCode}...`);
      let whBinCount = 0;

      for (const zTpl of zoneTemplates) {
        const zoneCode = `${whCode}-Z${zTpl.letter}`;
        const zoneRes = await client.query(
          `INSERT INTO zones (warehouse_id, code, name, description, zone_type, allowed_cargo_type, is_hazard_zone, max_weight, max_volume, rack_count, level_count, bins_per_level, status, active, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 3, 4, 1, 'Active', TRUE, CURRENT_TIMESTAMP)
           ON CONFLICT (warehouse_id, code) DO UPDATE
           SET name = EXCLUDED.name,
               description = EXCLUDED.description,
               zone_type = EXCLUDED.zone_type,
               allowed_cargo_type = EXCLUDED.allowed_cargo_type,
               is_hazard_zone = EXCLUDED.is_hazard_zone,
               max_weight = EXCLUDED.max_weight,
               max_volume = EXCLUDED.max_volume,
               status = 'Active',
               active = TRUE,
               updated_at = CURRENT_TIMESTAMP
           RETURNING id`,
          [whId, zoneCode, `${zTpl.name} (${whCode})`, zTpl.desc, zTpl.type, zTpl.allowed_cargo_type, zTpl.is_hazard, zTpl.max_weight, zTpl.max_volume]
        );
        const zoneId = zoneRes.rows[0].id;

        for (const rTpl of rackTemplates) {
          const rackCode = `${zoneCode}-${rTpl.codeSuffix}`;
          const rackRes = await client.query(
            `INSERT INTO racks (zone_id, code, name, max_weight, max_volume, status, active, updated_at)
             VALUES ($1, $2, $3, $4, $5, 'Active', TRUE, CURRENT_TIMESTAMP)
             ON CONFLICT (zone_id, code) DO UPDATE
             SET name = EXCLUDED.name,
                 max_weight = EXCLUDED.max_weight,
                 max_volume = EXCLUDED.max_volume,
                 status = 'Active',
                 active = TRUE,
                 updated_at = CURRENT_TIMESTAMP
             RETURNING id`,
            [zoneId, rackCode, `${rackCode} - ${rTpl.nameSuffix}`, rTpl.max_weight, rTpl.max_volume]
          );
          const rackId = rackRes.rows[0].id;

          for (const lTpl of levelTemplates) {
            const levelCode = `${rackCode}-${lTpl.codeSuffix}`;
            const levelRes = await client.query(
              `INSERT INTO levels (rack_id, code, level_number, name, max_weight, max_volume, status, active, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, 'Active', TRUE, CURRENT_TIMESTAMP)
               ON CONFLICT (rack_id, level_number) DO UPDATE
               SET code = EXCLUDED.code,
                   name = EXCLUDED.name,
                   max_weight = EXCLUDED.max_weight,
                   max_volume = EXCLUDED.max_volume,
                   status = 'Active',
                   active = TRUE,
                   updated_at = CURRENT_TIMESTAMP
               RETURNING id`,
              [rackId, levelCode, lTpl.level_number, `${levelCode} (${lTpl.name})`, lTpl.max_weight, lTpl.max_volume]
            );
            const levelId = levelRes.rows[0].id;

            // Bin Creation
            const binCode = `${levelCode}-B01`;
            const barcode = `BIN-${binCode}`;
            const binType = zTpl.type === "Cold Storage" ? "Cold Storage" : (zTpl.type === "Hazardous" ? "Hazardous" : lTpl.bin_type);

            const binRes = await client.query(
              `INSERT INTO bins (
                 level_id, code, barcode, name, status, max_weight, max_volume,
                 length, width, height, allowed_cargo_type, bin_type, active, updated_at
               )
               VALUES ($1, $2, $3, $4, 'Available', $5, $6, $7, $8, $9, $10, $11, TRUE, CURRENT_TIMESTAMP)
               ON CONFLICT (level_id, code) DO UPDATE
               SET barcode = EXCLUDED.barcode,
                   name = EXCLUDED.name,
                   max_weight = EXCLUDED.max_weight,
                   max_volume = EXCLUDED.max_volume,
                   length = EXCLUDED.length,
                   width = EXCLUDED.width,
                   height = EXCLUDED.height,
                   allowed_cargo_type = EXCLUDED.allowed_cargo_type,
                   bin_type = EXCLUDED.bin_type,
                   active = TRUE,
                   updated_at = CURRENT_TIMESTAMP
               RETURNING id, code, barcode, max_weight, max_volume, allowed_cargo_type, bin_type`,
              [
                levelId,
                binCode,
                barcode,
                `Bin ${binCode}`,
                lTpl.max_weight,
                lTpl.max_volume,
                lTpl.dim.length,
                lTpl.dim.width,
                lTpl.dim.height,
                zTpl.allowed_cargo_type,
                binType
              ]
            );

            whBinCount += 1;
            createdBins.push({
              id: binRes.rows[0].id,
              code: binCode,
              warehouse_id: whId,
              wh_code: whCode,
              zone_letter: zTpl.letter,
              level_number: lTpl.level_number,
              max_weight: Number(lTpl.max_weight),
              max_volume: Number(lTpl.max_volume),
              allowed_cargo_type: zTpl.allowed_cargo_type,
              bin_type: binType
            });
          }
        }
      }

      console.log(`✔ Created/Verified ${whBinCount} bins in Warehouse ${whCode}`);
    }

    console.log(`\nTotal Bins Created/Verified across all warehouses: ${createdBins.length}`);

    // 5. Seed Real Cargo & Create Scenarios Across Bins
    console.log("\nPopulating real cargo and distinct operational bin scenarios...");

    const realCargoScenarios = [
      // Scenario A: Heavy Duty Placed Cargo (Level 1 Bins)
      {
        wh_code: "WHA", zone_letter: "C", level: 1,
        cargo_id: "CRG-2026-EXCAV-01", reference_number: "REF-CAT-9921", consignee_name: "Tanzania Mining & Construction Ltd",
        company_name: "Caterpillar East Africa", cargo_description: "CAT Hydraulic Excavator Main Hydraulic Pump & Engine Blocks",
        cargo_type: "Machinery", weight: 3800.00, volume: 11.50, status: "Occupied"
      },
      {
        wh_code: "WHA", zone_letter: "A", level: 1,
        cargo_id: "CRG-2026-STEEL-02", reference_number: "REF-STL-4412", consignee_name: "Fumba Infrastructure Developers",
        company_name: "Zanzibar Steel Works", cargo_description: "Structural I-Beams & Heavy Reinforced Steel Girders",
        cargo_type: "General Goods", weight: 4850.00, volume: 14.20, status: "Full" // Near 100% capacity!
      },
      {
        wh_code: "WHC", zone_letter: "C", level: 1,
        cargo_id: "CRG-2026-TURB-03", reference_number: "REF-SIE-8831", consignee_name: "Zanzibar Power & Light Authority",
        company_name: "Siemens Energy Global", cargo_description: "Industrial Heavy Duty Gas Turbine Rotor Assembly",
        cargo_type: "Machinery", weight: 4950.00, volume: 14.80, status: "Full" // Near max capacity!
      },

      // Scenario B: Electronics & High-Value Items (Zone B, Levels 2-4)
      {
        wh_code: "WHA", zone_letter: "B", level: 2,
        cargo_id: "CRG-2026-SONY-04", reference_number: "REF-SNY-1002", consignee_name: "Zanzibar Electronics Hub",
        company_name: "Sony Middle East & Africa", cargo_description: "Palletized Sony BRAVIA 4K OLED Smart TVs (40 Units)",
        cargo_type: "Electronics", weight: 850.00, volume: 2.80, status: "Occupied"
      },
      {
        wh_code: "WHA", zone_letter: "B", level: 4,
        cargo_id: "CRG-2026-SAMS-05", reference_number: "REF-MOB-7721", consignee_name: "Tigo Telecommunications Zanzibar",
        company_name: "Samsung Electronics", cargo_description: "High-Value Galaxy Smartphones & Tablet Consignment",
        cargo_type: "Electronics", weight: 140.00, volume: 0.38, status: "Occupied"
      },
      {
        wh_code: "WHB", zone_letter: "B", level: 3,
        cargo_id: "CRG-2026-CISCO-06", reference_number: "REF-CSC-5091", consignee_name: "Ministry of Infrastructure & ICT",
        company_name: "Cisco Systems Int.", cargo_description: "Enterprise Optical Network Switches & Server Racks",
        cargo_type: "Electronics", weight: 480.00, volume: 1.45, status: "Occupied"
      },

      // Scenario C: Cold Storage & Perishables (Zone D in WHB & WHA)
      {
        wh_code: "WHB", zone_letter: "D", level: 1,
        cargo_id: "CRG-2026-COLD-07", reference_number: "REF-CLD-3301", consignee_name: "Fumba Resort & Hotel Chain",
        company_name: "Oceanic Seafoods Supplies", cargo_description: "Deep-Frozen Premium Seafood & Salmon Crates (-20C)",
        cargo_type: "Food Products", weight: 3200.00, volume: 9.80, status: "Occupied"
      },
      {
        wh_code: "WHB", zone_letter: "D", level: 4,
        cargo_id: "CRG-2026-MED-08", reference_number: "REF-MED-9912", consignee_name: "Zanzibar Central Medical Store",
        company_name: "GlaxoSmithKline Pharma", cargo_description: "Temperature Sensitive Biological Vaccines & Insulin",
        cargo_type: "Food Products", weight: 95.00, volume: 0.28, status: "Occupied"
      },
      {
        wh_code: "WHA", zone_letter: "D", level: 2,
        cargo_id: "CRG-2026-SPICE-09", reference_number: "REF-SPC-6611", consignee_name: "Zanzibar State Trading Corporation",
        company_name: "Pemba Spice Exporters", cargo_description: "Export Grade Cloves, Cinnamon & Vanilla Extract Drums",
        cargo_type: "Food Products", weight: 920.00, volume: 3.10, status: "Occupied"
      },

      // Scenario D: Hazardous & Chemical Cargo (Zone E in WHA, WHB, WHC)
      {
        wh_code: "WHA", zone_letter: "E", level: 1,
        cargo_id: "CRG-2026-HAZ-10", reference_number: "REF-CHM-4491", consignee_name: "Zanzibar Port Authority Chemical Unit",
        company_name: "BASF Performance Chemicals", cargo_description: "Industrial Solvents, Resins & Degreaser Sealed Drums",
        cargo_type: "Hazardous Cargo", weight: 3400.00, volume: 8.90, status: "Occupied"
      },
      {
        wh_code: "WHC", zone_letter: "E", level: 2,
        cargo_id: "CRG-2026-GAS-11", reference_number: "REF-GAS-8812", consignee_name: "Industrial Gas Cylinder Distributors",
        company_name: "BOC Oxygen & Nitrogen", cargo_description: "High Pressure Compressed Argon & Nitrogen Cylinders",
        cargo_type: "Hazardous Cargo", weight: 1100.00, volume: 3.20, status: "Occupied"
      },

      // Scenario E: Automotive Parts & General Commercial Goods (Zone A)
      {
        wh_code: "WHA", zone_letter: "A", level: 2,
        cargo_id: "CRG-2026-AUTO-12", reference_number: "REF-TOY-2210", consignee_name: "Toyota Zanzibar Motors Ltd",
        company_name: "Toyota Tsusho Corp", cargo_description: "Hilux & Landcruiser Original Transmission Assemblies",
        cargo_type: "General Goods", weight: 1150.00, volume: 3.40, status: "Occupied"
      },
      {
        wh_code: "WHB", zone_letter: "A", level: 3,
        cargo_id: "CRG-2026-TEXT-13", reference_number: "REF-TXT-7711", consignee_name: "Zanzibar Apparel Exporters",
        company_name: "East Africa Garments Ltd", cargo_description: "High Quality Cotton Fabrics & Garments Export Bales",
        cargo_type: "General Goods", weight: 580.00, volume: 1.85, status: "Occupied"
      },
      {
        wh_code: "WHC", zone_letter: "A", level: 2,
        cargo_id: "CRG-2026-SOLAR-14", reference_number: "REF-SLR-3319", consignee_name: "Zanzibar Green Energy Initiative",
        company_name: "JinkoSolar Global", cargo_description: "Industrial Grade Photovoltaic Solar Panels & Inverters",
        cargo_type: "General Goods", weight: 1250.00, volume: 3.90, status: "Occupied"
      }
    ];

    const staffUserRes = await client.query("SELECT id FROM users WHERE username = 'staff_uat' LIMIT 1");
    const staffUserId = staffUserRes.rows[0]?.id || 35;
    const supervisorUserRes = await client.query("SELECT id FROM users WHERE username = 'admin_wha' LIMIT 1");
    const supervisorUserId = supervisorUserRes.rows[0]?.id || 36;

    for (const item of realCargoScenarios) {
      // Find matching bin
      const targetBin = createdBins.find(
        (b) => b.wh_code === item.wh_code && b.zone_letter === item.zone_letter && b.level_number === item.level
      );

      if (!targetBin) continue;

      const barcode = `BC-${item.cargo_id}`;

      // Insert Cargo Record
      const cargoRes = await client.query(
        `INSERT INTO cargo (
           cargo_id, barcode, reference_number, consignee_name, company_name, cargo_description,
           cargo_type, quantity, weight, volume, cargo_condition, status, workflow_status,
           registration_status, placement_status, location, current_bin_id, warehouse_id, created_by,
           approved_by, approved_at, customs_status, financial_status, dispatch_status,
           created_at, updated_at
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, 10, $8, $9, 'Good', 'Approved', 'Approved',
           'Approved', 'Placed', $10, $11, $12, $13, $14, CURRENT_TIMESTAMP, 'Cleared', 'Fully Paid', 'Approved',
           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         )
         ON CONFLICT (cargo_id) DO UPDATE
         SET barcode = EXCLUDED.barcode,
             reference_number = EXCLUDED.reference_number,
             consignee_name = EXCLUDED.consignee_name,
             company_name = EXCLUDED.company_name,
             cargo_description = EXCLUDED.cargo_description,
             cargo_type = EXCLUDED.cargo_type,
             weight = EXCLUDED.weight,
             volume = EXCLUDED.volume,
             status = 'Approved',
             workflow_status = 'Approved',
             registration_status = 'Approved',
             placement_status = 'Placed',
             location = EXCLUDED.location,
             current_bin_id = EXCLUDED.current_bin_id,
             warehouse_id = EXCLUDED.warehouse_id,
             updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [
          item.cargo_id,
          barcode,
          item.reference_number,
          item.consignee_name,
          item.company_name,
          item.cargo_description,
          item.cargo_type,
          item.weight,
          item.volume,
          targetBin.code,
          targetBin.id,
          targetBin.warehouse_id,
          staffUserId,
          supervisorUserId
        ]
      );

      const dbCargoId = cargoRes.rows[0].id;

      // Update Bin Occupancy & Status
      await client.query(
        `UPDATE bins
         SET current_weight = $1,
             current_volume = $2,
             status = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [item.weight, item.volume, item.status, targetBin.id]
      );

      // Insert Cargo Location Tracking Record
      await client.query(
        `INSERT INTO cargo_locations (cargo_id, bin_id, location, is_current, assigned_by, assigned_at)
         VALUES ($1, $2, $3, TRUE, $4, CURRENT_TIMESTAMP)`,
        [dbCargoId, targetBin.id, targetBin.code, staffUserId]
      );

      console.log(`✔ Placed Cargo '${item.cargo_id}' (${item.cargo_type}, ${item.weight}kg) into Bin ${targetBin.code} [Status: ${item.status}]`);
    }

    // 6. Set up Reserved, Maintenance, and Blocked Bins (Scenario 3, 4, 5)
    console.log("\nConfiguring Reserved, Maintenance, and Blocked bin scenarios...");

    // Reserve specific bins in Zone E (Hazardous) and Zone D (Cold Storage)
    const binsToReserve = createdBins.filter((b) => b.level_number === 4 && (b.zone_letter === "E" || b.zone_letter === "D"));
    for (const b of binsToReserve.slice(0, 4)) {
      await client.query(
        `UPDATE bins
         SET status = 'Reserved',
             reserved_for_cargo_type = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND status = 'Available'`,
        [b.allowed_cargo_type, b.id]
      );
    }
    console.log(`✔ Earmarked ${binsToReserve.slice(0, 4).length} specialized bins as Reserved`);

    // Flag Maintenance & Blocked Bins
    const binsToMaintenance = createdBins.filter((b) => b.level_number === 3 && b.zone_letter === "A");
    for (const b of binsToMaintenance.slice(0, 3)) {
      await client.query(
        `UPDATE bins
         SET status = 'Maintenance',
             status_reason = 'Scheduled structural load testing and shelf safety audit',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'Available'`,
        [b.id]
      );
    }
    console.log(`✔ Flagged ${binsToMaintenance.slice(0, 3).length} bins for Maintenance`);

    const binsToBlock = createdBins.filter((b) => b.level_number === 4 && b.zone_letter === "C");
    for (const b of binsToBlock.slice(0, 2)) {
      await client.query(
        `UPDATE bins
         SET status = 'Blocked',
             status_reason = 'Restricted area for customs inspection boundary configuration',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'Available'`,
        [b.id]
      );
    }
    console.log(`✔ Blocked ${binsToBlock.slice(0, 2).length} bins for operational restriction`);

    await client.query("COMMIT");
    console.log("\n🎉 Database seeding completed successfully!");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Database seeding failed:", error);
    throw error;
  } finally {
    await client.end();
  }
}

seed().catch((err) => {
  console.error("Fatal seed execution error:", err);
  process.exit(1);
});

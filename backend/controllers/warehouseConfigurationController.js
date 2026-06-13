const db = require("../config/db");

const DEFAULT_STRUCTURE = [
  { code: "Z-A", name: "General Goods", cargoType: "General Goods", racks: 8, levels: 4, bins: 5 },
  { code: "Z-B", name: "Electronics", cargoType: "Electronics", racks: 4, levels: 3, bins: 4 },
  { code: "Z-C", name: "Machinery", cargoType: "Machinery", racks: 4, levels: 3, bins: 4 },
  { code: "Z-D", name: "Food Products", cargoType: "Food Products", racks: 3, levels: 2, bins: 5 },
  { code: "Z-E", name: "Construction Materials", cargoType: "Construction Materials", racks: 3, levels: 2, bins: 4 },
  { code: "Z-F", name: "Fragile Goods", cargoType: "Fragile Goods", racks: 4, levels: 3, bins: 4 },
  { code: "Z-G", name: "Hazardous Cargo", cargoType: "Hazardous Cargo", racks: 2, levels: 2, bins: 3 },
  { code: "Z-H", name: "Mixed Cargo", cargoType: "Mixed Cargo", racks: 3, levels: 3, bins: 5 }
];

const generateDefaultStructure = async (req, res, next) => {
  const client = await db.pool.connect();
  const summary = {
    zones_created: 0,
    racks_created: 0,
    levels_created: 0,
    bins_created: 0,
    skipped_existing: 0
  };

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fumba-default-warehouse-structure'))");

    for (const zoneDefinition of DEFAULT_STRUCTURE) {
      const zoneLetter = zoneDefinition.code.slice(-1);
      const binCount = zoneDefinition.racks * zoneDefinition.levels * zoneDefinition.bins;
      const zoneMaxWeight = binCount * 500;
      const zoneMaxVolume = binCount * 4;

      let zoneResult = await client.query(
        "SELECT id FROM zones WHERE UPPER(code) = $1",
        [zoneDefinition.code]
      );

      if (zoneResult.rowCount === 0) {
        zoneResult = await client.query(
          `INSERT INTO zones (
            code, name, description, zone_type, allowed_cargo_type, is_hazard_zone,
            max_weight, max_volume, rack_count, level_count, bins_per_level, status, active
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Active', TRUE)
          RETURNING id`,
          [
            zoneDefinition.code,
            zoneDefinition.name,
            `Official Fumba Port ${zoneDefinition.name} storage zone.`,
            zoneDefinition.code === "Z-G" ? "Hazardous" : "Standard",
            zoneDefinition.cargoType,
            zoneDefinition.code === "Z-G",
            zoneMaxWeight,
            zoneMaxVolume,
            zoneDefinition.racks,
            zoneDefinition.levels,
            zoneDefinition.bins
          ]
        );
        summary.zones_created += 1;
      } else {
        summary.skipped_existing += 1;
      }

      const zoneId = zoneResult.rows[0].id;

      for (let rackNumber = 1; rackNumber <= zoneDefinition.racks; rackNumber += 1) {
        const paddedRackNumber = String(rackNumber).padStart(2, "0");
        const rackCode = `R-${zoneLetter}${paddedRackNumber}`;
        let rackResult = await client.query(
          "SELECT id FROM racks WHERE zone_id = $1 AND UPPER(code) = $2",
          [zoneId, rackCode]
        );

        if (rackResult.rowCount === 0) {
          rackResult = await client.query(
            `INSERT INTO racks (zone_id, code, name, max_weight, max_volume, status, active)
             VALUES ($1, $2, $3, 10000, 80, 'Active', TRUE)
             RETURNING id`,
            [zoneId, rackCode, `Rack ${rackCode}`]
          );
          summary.racks_created += 1;
        } else {
          summary.skipped_existing += 1;
        }

        const rackId = rackResult.rows[0].id;

        for (let levelNumber = 1; levelNumber <= zoneDefinition.levels; levelNumber += 1) {
          const levelCode = `L${levelNumber}`;
          let levelResult = await client.query(
            "SELECT id FROM levels WHERE rack_id = $1 AND (UPPER(code) = $2 OR level_number = $3)",
            [rackId, levelCode, levelNumber]
          );

          if (levelResult.rowCount === 0) {
            levelResult = await client.query(
              `INSERT INTO levels (rack_id, code, level_number, max_weight, max_volume, status, active)
               VALUES ($1, $2, $3, 2500, 20, 'Active', TRUE)
               RETURNING id`,
              [rackId, levelCode, levelNumber]
            );
            summary.levels_created += 1;
          } else {
            summary.skipped_existing += 1;
          }

          const levelId = levelResult.rows[0].id;

          for (let binNumber = 1; binNumber <= zoneDefinition.bins; binNumber += 1) {
            const paddedBinNumber = String(binNumber).padStart(2, "0");
            const binCode = `BIN-${zoneLetter}${paddedRackNumber}-${levelCode}-${paddedBinNumber}`;
            const binResult = await client.query(
              "SELECT id FROM bins WHERE UPPER(code) = $1 OR UPPER(barcode) = $1",
              [binCode]
            );

            if (binResult.rowCount > 0) {
              summary.skipped_existing += 1;
              continue;
            }

            await client.query(
              `INSERT INTO bins (
                level_id, code, barcode, max_weight, max_volume, current_weight,
                current_volume, status, active, reserved_for_cargo_type
              )
              VALUES ($1, $2, $2, 500, 4, 0, 0, 'Available', TRUE, NULL)`,
              [levelId, binCode]
            );
            summary.bins_created += 1;
          }
        }
      }
    }

    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description)
       VALUES ($1, 'GENERATE_DEFAULT_WAREHOUSE_STRUCTURE', 'Warehouse Configuration', $2)`,
      [
        req.auth?.userId || null,
        `Generated official warehouse structure: ${summary.zones_created} zones, ${summary.racks_created} racks, ${summary.levels_created} levels, ${summary.bins_created} bins; skipped ${summary.skipped_existing} existing records.`
      ]
    );

    await client.query("COMMIT");
    res.status(201).json({
      success: true,
      message: summary.zones_created + summary.racks_created + summary.levels_created + summary.bins_created > 0
        ? "Default warehouse structure generated successfully"
        : "Default warehouse structure already exists",
      data: summary
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

module.exports = {
  generateDefaultStructure
};

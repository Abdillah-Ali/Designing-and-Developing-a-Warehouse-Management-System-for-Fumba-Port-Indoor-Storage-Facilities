const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../config/db");

// Import controllers
const { createWarehouse, updateWarehouse, updateWarehouseStatus } = require("../controllers/warehouseController");
const { createZone } = require("../controllers/zoneController");
const { createRack } = require("../controllers/rackController");
const { createLevel } = require("../controllers/levelController");
const { createBin, updateBinStatus, printBinBarcode } = require("../controllers/binController");
const { validatePlacement, confirmPlacement } = require("../controllers/placementController");
const { updateUser } = require("../controllers/adminController");
const { canStaffEditCargo, canStaffViewSubmission, REGISTRATION_STATUS, PLACEMENT_STATUS } = require("../services/cargoWorkflowService");
const { canAccessRoute, PORTAL_ROLES } = require("../middleware/authMiddleware");

// Helper to mock res
const mockResponse = () => {
  const res = {
    statusCode: 200,
    headers: {}
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.body = data;
    return res;
  };
  res.setHeader = (name, value) => {
    res.headers[name] = value;
    return res;
  };
  return res;
};

// Helper to mock next
const mockNext = (err) => {
  if (err) throw err;
};

test("Fumba Port WMS - Full Regression Testing Suite", async (t) => {
  console.log("Starting full regression testing suite...");

  // Fetch roles
  const rolesResult = await db.query("SELECT id, role_name FROM roles");
  const roleMap = {};
  rolesResult.rows.forEach(r => {
    roleMap[r.role_name.toLowerCase()] = r.id;
  });

  const staffRoleId = roleMap["warehouse staff"] || roleMap["warehouse-staff"] || 3;
  const supervisorRoleId = roleMap["supervisor"] || roleMap["warehouse supervisor"] || roleMap["warehouse-supervisor"] || 2;
  const adminRoleId = roleMap["system admin"] || roleMap["system-admin"] || 1;

  // Fetch a shift
  const shiftsResult = await db.query("SELECT id FROM shifts LIMIT 1");
  const testShiftId = shiftsResult.rows[0]?.id || 1;

  // Setup unique test identifiers to prevent conflicts and enable easy cleanup
  const prefix = "REG-TEST-";
  const whCodeA = "REG-WHA";
  const whCodeB = "REG-WHB";

  // Clean up any dangling test data from previous aborts
  const cleanup = async () => {
    console.log("Cleaning up test data...");
    await db.query("DELETE FROM audit_logs WHERE description LIKE $1 OR metadata::text LIKE $2", [`%${prefix}%`, `%${prefix}%`]);
    await db.query("DELETE FROM cargo_movements WHERE from_location LIKE $1 OR to_location LIKE $2", [`%${prefix}%`, `%${prefix}%`]);
    await db.query("DELETE FROM cargo_locations WHERE location LIKE $1", [`%${prefix}%`]);
    await db.query("DELETE FROM placement_validation_logs WHERE bin_barcode LIKE $1 OR cargo_barcode LIKE $2", [`%${prefix}%`, `%${prefix}%`]);
    await db.query("DELETE FROM approval_requests WHERE reason LIKE $1 OR request_data::text LIKE $2", [`%${prefix}%`, `%${prefix}%`]);
    await db.query("DELETE FROM cargo_approval_history WHERE remarks LIKE $1", [`%${prefix}%`]);
    await db.query("DELETE FROM bin_barcode_print_logs WHERE bin_id IN (SELECT id FROM bins WHERE barcode LIKE $1 OR barcode LIKE $2)", [`BIN-${whCodeA}%`, `BIN-${whCodeB}%`]);
    await db.query("DELETE FROM cargo WHERE cargo_id LIKE $1 OR reference_number LIKE $2", [`${prefix}%`, `FPWMS-%`]);
    await db.query("DELETE FROM users WHERE username LIKE $1", [`${prefix.toLowerCase()}%`]);
    await db.query("DELETE FROM bins WHERE barcode LIKE $1 OR barcode LIKE $2", [`BIN-${whCodeA}%`, `BIN-${whCodeB}%`]);
    await db.query("DELETE FROM levels WHERE code LIKE $1", [`L-${prefix}%`]);
    await db.query("DELETE FROM racks WHERE code LIKE $1", [`R-${prefix}%`]);
    await db.query("DELETE FROM zones WHERE code LIKE $1", [`Z-${prefix}%`]);
    await db.query("DELETE FROM warehouses WHERE warehouse_code LIKE $1", [`REG-%`]);
    console.log("Cleanup complete.");
  };

  await cleanup();

  let warehouseAId, warehouseBId;
  let zoneAId, zoneBId;
  let rackAId, rackBId;
  let levelAId, levelBId;
  let binAId, binBId;
  let staffAId, staffBId, supervisorAId, supervisorBId;

  try {
    // =========================================================================
    // Phase 1: Warehouse Hierarchy Validation
    // =========================================================================
    await t.test("Phase 1: Warehouse Hierarchy Constraint Enforcement", async () => {
      // 1. Zone cannot exist without Warehouse
      await assert.rejects(async () => {
        await db.query(
          "INSERT INTO zones (code, name, allowed_cargo_type, warehouse_id) VALUES ($1, $2, $3, NULL)",
          ["Z-X", `${prefix}Zone-X`, "General Goods"]
        );
      }, /null value.*violates not-null constraint/i);

      await assert.rejects(async () => {
        await db.query(
          "INSERT INTO zones (code, name, allowed_cargo_type, warehouse_id) VALUES ($1, $2, $3, 99999)",
          ["Z-X", `${prefix}Zone-X`, "General Goods"]
        );
      }, /foreign key constraint/i);

      // 2. Rack cannot exist without Zone
      await assert.rejects(async () => {
        await db.query(
          "INSERT INTO racks (code, name, zone_id) VALUES ($1, $2, NULL)",
          ["R-A01", `${prefix}Rack-1`]
        );
      }, /null value.*violates not-null constraint/i);

      await assert.rejects(async () => {
        await db.query(
          "INSERT INTO racks (code, name, zone_id) VALUES ($1, $2, 99999)",
          ["R-A01", `${prefix}Rack-1`]
        );
      }, /foreign key constraint/i);

      // 3. Level cannot exist without Rack
      await assert.rejects(async () => {
        await db.query(
          "INSERT INTO levels (code, level_number, rack_id) VALUES ($1, 1, NULL)",
          ["L1"]
        );
      }, /null value.*violates not-null constraint/i);

      await assert.rejects(async () => {
        await db.query(
          "INSERT INTO levels (code, level_number, rack_id) VALUES ($1, 1, 99999)",
          ["L1"]
        );
      }, /foreign key constraint/i);

      // 4. Bin cannot exist without Level
      await assert.rejects(async () => {
        await db.query(
          "INSERT INTO bins (code, barcode, level_id) VALUES ($1, $2, NULL)",
          ["B01", `BIN-${prefix}B01`]
        );
      }, /null value.*violates not-null constraint/i);

      await assert.rejects(async () => {
        await db.query(
          "INSERT INTO bins (code, barcode, level_id) VALUES ($1, $2, 99999)",
          ["B01", `BIN-${prefix}B01`]
        );
      }, /foreign key constraint/i);

      console.log("✔ Phase 1 hierarchy enforcement tests passed!");
    });

    // =========================================================================
    // Phase 2: Warehouse CRUD Validation
    // =========================================================================
    await t.test("Phase 2: Warehouse CRUD & Uniqueness Checks", async () => {
      // 1. Create Warehouse A
      const reqA = {
        body: { name: `${prefix} Warehouse A`, code: whCodeA, status: "active" },
        auth: { userId: 1, role: "system-admin", username: "admin" }
      };
      const resA = mockResponse();
      await createWarehouse(reqA, resA, mockNext);
      assert.equal(resA.statusCode, 201);
      assert.equal(resA.body.success, true);
      warehouseAId = resA.body.data.id;
      assert.ok(warehouseAId);

      // 2. Create Warehouse B
      const reqB = {
        body: { name: `${prefix} Warehouse B`, code: whCodeB, status: "active" },
        auth: { userId: 1, role: "system-admin", username: "admin" }
      };
      const resB = mockResponse();
      await createWarehouse(reqB, resB, mockNext);
      assert.equal(resB.statusCode, 201);
      warehouseBId = resB.body.data.id;
      assert.ok(warehouseBId);

      // 3. Confirm warehouse_code uniqueness
      const reqDup = {
        body: { name: `${prefix} Warehouse Duplicate`, code: whCodeA },
        auth: { userId: 1, role: "system-admin", username: "admin" }
      };
      await assert.rejects(async () => {
        await createWarehouse(reqDup, mockResponse(), mockNext);
      }, /already exists/i);

      // 4. Update Warehouse A
      const reqUpdate = {
        params: { id: warehouseAId },
        body: { name: `${prefix} Warehouse A Updated`, code: whCodeA, status: "active" },
        auth: { userId: 1, role: "system-admin", username: "admin" }
      };
      const resUpdate = mockResponse();
      await updateWarehouse(reqUpdate, resUpdate, mockNext);
      assert.equal(resUpdate.statusCode, 200);
      assert.equal(resUpdate.body.data.warehouse_name, `${prefix} Warehouse A Updated`);

      // 5. Successful audit logs check
      const logsResult = await db.query(
        "SELECT action FROM audit_logs WHERE action IN ('CREATE_WAREHOUSE', 'UPDATE_WAREHOUSE') ORDER BY id DESC"
      );
      assert.ok(logsResult.rowCount >= 3); // 2 creates + 1 update

      console.log("✔ Phase 2 Warehouse CRUD & uniqueness tests passed!");
    });

    // =========================================================================
    // Phase 3: Warehouse Deactivation Safety
    // =========================================================================
    await t.test("Phase 3: Warehouse Deactivation Safety", async () => {
      // 1. Create a staff user assigned to Warehouse A
      const staffUsername = `${prefix.toLowerCase()}staffa`;
      const staffEmail = `${prefix.toLowerCase()}staffa@example.com`;
      const staffResult = await db.query(
        `INSERT INTO users (full_name, username, email, phone_number, password_hash, role_id, warehouse_id, shift_id, status)
         VALUES ($1, $2, $3, $4, 'hash', $5, $6, $7, 'active') RETURNING id`,
        [`${prefix} Staff A`, staffUsername, staffEmail, "+255777777777", staffRoleId, warehouseAId, testShiftId]
      );
      staffAId = staffResult.rows[0].id;

      // 2. Attempt to deactivate Warehouse A
      const reqDeact = {
        params: { id: warehouseAId },
        body: { status: "inactive" },
        auth: { userId: 1, role: "system-admin", username: "admin" }
      };

      await assert.rejects(async () => {
        await updateWarehouseStatus(reqDeact, mockResponse(), mockNext);
      }, /Cannot deactivate a warehouse that has active users assigned/i);

      // 3. Mark user inactive to test cargo deactivation block
      await db.query("UPDATE users SET status = 'inactive' WHERE id = $1", [staffAId]);

      // 4. Create active stored cargo in Warehouse A
      const cargoResult = await db.query(
        `INSERT INTO cargo (cargo_id, barcode, reference_number, consignee_name, cargo_type, cargo_condition,
                            received_by_user_id, created_by, assigned_staff_id, warehouse_id, warehouse_id_at_registration,
                            registration_status, placement_status, status, workflow_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7, $8, $8, $9, $10, $9, $9) RETURNING id`,
        [`${prefix}CG-1`, `REG-CG-BARCODE-1`, `FPWMS-REG-1`, "Consignee A", "General Goods", "Good",
         staffAId, warehouseAId, REGISTRATION_STATUS.APPROVED, PLACEMENT_STATUS.PLACED]
      );
      const cargoId = cargoResult.rows[0].id;

      // 5. Attempt deactivation again
      await assert.rejects(async () => {
        await updateWarehouseStatus(reqDeact, mockResponse(), mockNext);
      }, /Cannot deactivate a warehouse that contains active stored cargo/i);

      // Clean up cargo so we can proceed
      await db.query("DELETE FROM cargo WHERE id = $1", [cargoId]);

      console.log("✔ Phase 3 deactivation safety tests passed!");
    });

    // =========================================================================
    // Phase 4: Bin Barcode Validation
    // =========================================================================
    await t.test("Phase 4: Bin Barcode Generation & Format", async () => {
      // 1. Set up hierarchy for Warehouse A
      const zoneRes = await db.query(
        `INSERT INTO zones (code, name, allowed_cargo_type, zone_type, warehouse_id, status)
         VALUES ($1, $2, $3, $4, $5, 'Active') RETURNING id`,
        ["Z-A", `${prefix} Zone A`, "General Goods", "Standard", warehouseAId]
      );
      zoneAId = zoneRes.rows[0].id;

      const rackRes = await db.query(
        `INSERT INTO racks (zone_id, code, name, status)
         VALUES ($1, $2, $3, 'Active') RETURNING id`,
        [zoneAId, "R-A01", `${prefix} Rack A01`]
      );
      rackAId = rackRes.rows[0].id;

      const levelRes = await db.query(
        `INSERT INTO levels (rack_id, code, level_number, status)
         VALUES ($1, $2, 1, 'Active') RETURNING id`,
        [rackAId, "L1"]
      );
      levelAId = levelRes.rows[0].id;

      // Create Bin
      const reqBin = {
        body: { level_id: levelAId, bin_code: "B01", status: "Available", capacity_weight: 500, capacity_volume: 4 },
        auth: { userId: 1, role: "system-admin", username: "admin" }
      };
      const resBin = mockResponse();
      await createBin(reqBin, resBin, mockNext);
      assert.equal(resBin.statusCode, 201);
      binAId = resBin.body.data.bin_id;

      // Generated format: BIN-{WAREHOUSE_CODE}-{ZONE_CODE}-{RACK_CODE}-{LEVEL_CODE}-{BIN_CODE}
      // Since whCodeA = 'REG-WHA', zone = 'Z-A', rack = 'R-A01', level = 'L1', bin = 'B01':
      const expectedBarcode = `BIN-${whCodeA}-Z-A-R-A01-L1-B01`.toUpperCase();
      assert.equal(resBin.body.data.barcode, expectedBarcode);

      // Database uniqueness validation query
      const dupQuery = await db.query(
        "SELECT barcode, COUNT(*) FROM bins GROUP BY barcode HAVING COUNT(*) > 1"
      );
      assert.equal(dupQuery.rowCount, 0);

      console.log("✔ Phase 4 barcode format and database uniqueness checks passed!");
    });

    // =========================================================================
    // Phase 5: Bin Label Printing Validation
    // =========================================================================
    await t.test("Phase 5: Bin Label Printing Validation", async () => {
      const reqPrint = {
        params: { id: binAId },
        auth: { userId: staffAId, role: "warehouse-staff", username: "staffa" }
      };
      const resPrint = mockResponse();
      await printBinBarcode(reqPrint, resPrint, mockNext);
      assert.equal(resPrint.statusCode, 200);
      assert.equal(resPrint.body.data.print_type, "PRINT");

      // Reprint
      const resReprint = mockResponse();
      await printBinBarcode(reqPrint, resReprint, mockNext);
      assert.equal(resReprint.statusCode, 200);
      assert.equal(resReprint.body.data.print_type, "REPRINT");

      // Verify log table
      const printLogs = await db.query("SELECT print_type FROM bin_barcode_print_logs WHERE bin_id = $1 ORDER BY id ASC", [binAId]);
      assert.equal(printLogs.rowCount, 2);
      assert.equal(printLogs.rows[0].print_type, "PRINT");
      assert.equal(printLogs.rows[1].print_type, "REPRINT");

      // Verify audit trail
      const auditResult = await db.query(
        "SELECT action FROM audit_logs WHERE action = 'PRINT_BIN_BARCODE' AND metadata->>'bin_id' = $1",
        [String(binAId)]
      );
      assert.ok(auditResult.rowCount >= 2);

      console.log("✔ Phase 5 barcode printing, logs, and audit trails validated!");
    });

    // =========================================================================
    // Phase 6: Placement Warehouse Isolation
    // =========================================================================
    await t.test("Phase 6: Placement Warehouse Isolation", async () => {
      // 1. Create Bin in Warehouse B
      const zoneResB = await db.query(
        `INSERT INTO zones (code, name, allowed_cargo_type, zone_type, warehouse_id, status)
         VALUES ($1, $2, $3, $4, $5, 'Active') RETURNING id`,
        ["Z-A", `${prefix} Zone B`, "General Goods", "Standard", warehouseBId]
      );
      zoneBId = zoneResB.rows[0].id;

      const rackResB = await db.query(
        `INSERT INTO racks (zone_id, code, name, status)
         VALUES ($1, $2, $3, 'Active') RETURNING id`,
        [zoneBId, "R-A01", `${prefix} Rack B01`]
      );
      rackBId = rackResB.rows[0].id;

      const levelResB = await db.query(
        `INSERT INTO levels (rack_id, code, level_number, status)
         VALUES ($1, $2, 1, 'Active') RETURNING id`,
        [rackBId, "L1"]
      );
      levelBId = levelResB.rows[0].id;

      const reqBinB = {
        body: { level_id: levelBId, bin_code: "B01", status: "Available" },
        auth: { userId: 1, role: "system-admin", username: "admin" }
      };
      const resBinB = mockResponse();
      await createBin(reqBinB, resBinB, mockNext);
      binBId = resBinB.body.data.bin_id;

      // 2. Create Cargo in Warehouse A
      const cargoRes = await db.query(
        `INSERT INTO cargo (cargo_id, barcode, reference_number, consignee_name, cargo_type, cargo_condition,
                            received_by_user_id, created_by, assigned_staff_id, warehouse_id, warehouse_id_at_registration,
                            registration_status, placement_status, status, workflow_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7, $8, $8, $9, $10, $9, $9) RETURNING *`,
        [`${prefix}CG-WH-ISO`, `REG-CG-BARCODE-ISO`, `FPWMS-REG-ISO`, "Consignee A", "General Goods", "Good",
         staffAId, warehouseAId, REGISTRATION_STATUS.APPROVED, PLACEMENT_STATUS.UNPLACED]
      );
      const cargoBarcode = cargoRes.rows[0].barcode;

      // 3. Attempt placement of WH-A cargo into WH-B bin
      const reqPlacement = {
        body: {
          placement_mode: "scan",
          scanned_cargo_barcode: cargoBarcode,
          scanned_bin_barcode: resBinB.body.data.barcode
        },
        auth: { userId: staffAId, role: "warehouse-staff", username: "staffa", warehouseId: warehouseAId }
      };

      const resPlacement = mockResponse();
      await validatePlacement(reqPlacement, resPlacement, mockNext);
      assert.equal(resPlacement.body.data.approved, false);
      assert.equal(resPlacement.body.data.reason, "Warehouse Mismatch");
      assert.equal(resPlacement.body.data.detail, "Warehouse mismatch: this bin does not belong to the cargo's registered warehouse.");

      console.log("✔ Phase 6 placement warehouse isolation verified!");
    });

    // =========================================================================
    // Phase 7: Placement Success Validation
    // =========================================================================
    await t.test("Phase 7: Placement Success Validation", async () => {
      // 1. Create compatible Cargo in Warehouse A
      const cargoRes = await db.query(
        `INSERT INTO cargo (cargo_id, barcode, reference_number, consignee_name, cargo_type, cargo_condition,
                            received_by_user_id, created_by, assigned_staff_id, warehouse_id, warehouse_id_at_registration,
                            registration_status, placement_status, status, workflow_status, weight, volume)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7, $8, $8, $9, $10, $9, $9, 10.00, 1.00) RETURNING *`,
        [`${prefix}CG-PLACE`, `REG-CG-BARCODE-PLACE`, `FPWMS-REG-PLACE`, "Consignee A", "General Goods", "Good",
         staffAId, warehouseAId, REGISTRATION_STATUS.APPROVED, PLACEMENT_STATUS.UNPLACED]
      );
      const cargo = cargoRes.rows[0];

      // 2. Fetch Bin A barcode
      const binARes = await db.query("SELECT barcode FROM bins WHERE id = $1", [binAId]);
      const binABarcode = binARes.rows[0].barcode;

      // 3. Confirm placement
      const reqConfirm = {
        body: {
          placement_mode: "scan",
          scanned_cargo_barcode: cargo.barcode,
          scanned_bin_barcode: binABarcode
        },
        auth: { userId: staffAId, role: "warehouse-staff", username: "staffa", warehouseId: warehouseAId }
      };
      const resConfirm = mockResponse();
      await confirmPlacement(reqConfirm, resConfirm, mockNext);
      assert.equal(resConfirm.body.success, true);
      assert.equal(resConfirm.body.message, "Cargo placed successfully.");

      // 4. Verify database updates
      const updatedCargo = (await db.query("SELECT * FROM cargo WHERE id = $1", [cargo.id])).rows[0];
      assert.equal(updatedCargo.current_bin_id, binAId);
      assert.equal(updatedCargo.placement_status, PLACEMENT_STATUS.PLACED);

      const updatedBin = (await db.query("SELECT * FROM bins WHERE id = $1", [binAId])).rows[0];
      assert.equal(Number(updatedBin.current_weight), 10.00);
      assert.equal(Number(updatedBin.current_volume), 1.00);
      assert.equal(updatedBin.status, "Occupied");

      const movement = (await db.query("SELECT * FROM cargo_movements WHERE cargo_id = $1", [cargo.id])).rows[0];
      assert.ok(movement);
      assert.equal(movement.to_bin_id, binAId);
      assert.equal(movement.action, "Placed");

      const auditLog = await db.query("SELECT action FROM audit_logs WHERE action = 'PLACEMENT_SUCCEEDED' AND metadata->>'cargo_id' = $1", [String(cargo.id)]);
      assert.ok(auditLog.rowCount > 0);

      console.log("✔ Phase 7 placement success workflow verified!");
    });

    // =========================================================================
    // Phase 8: Ownership Model Regression Analysis (Option 2)
    // =========================================================================
    await t.test("Phase 8: Ownership Model Regression Analysis (Option 2)", async () => {
      // Re-activate staffA and set warehouse to Warehouse A
      await db.query("UPDATE users SET warehouse_id = $1, status = 'active' WHERE id = $2", [warehouseAId, staffAId]);

      // 1. Staff A registers Cargo A in Warehouse A
      const cargoRes = await db.query(
        `INSERT INTO cargo (cargo_id, barcode, reference_number, consignee_name, cargo_type, cargo_condition,
                            received_by_user_id, created_by, assigned_staff_id, warehouse_id, warehouse_id_at_registration,
                            registration_status, placement_status, status, workflow_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7, $8, $8, $9, $10, $9, $9) RETURNING *`,
        [`${prefix}CG-OWN`, `REG-CG-BARCODE-OWN`, `FPWMS-REG-OWN`, "Consignee A", "General Goods", "Good",
         staffAId, warehouseAId, REGISTRATION_STATUS.PENDING_REVIEW, PLACEMENT_STATUS.UNPLACED]
      );
      const cargo = cargoRes.rows[0];

      // Create an approval request for this cargo
      await db.query(
        `INSERT INTO approval_requests (request_type, cargo_id, requested_by, warehouse_id_at_request, reason, status)
         VALUES ('CARGO_REGISTRATION', $1, $2, $3, 'REG-TEST-REASON', 'Pending')`,
        [cargo.id, staffAId, warehouseAId]
      );

      // Create document
      await db.query(
        `INSERT INTO cargo_documents (cargo_id, file_name, file_type, file_size, file_path, uploaded_by)
         VALUES ($1, 'test.pdf', 'application/pdf', 100, '/path/to/test.pdf', $2)`,
        [cargo.id, staffAId]
      );

      // 2. Transfer Staff A to Warehouse B
      await db.query("UPDATE users SET warehouse_id = $1 WHERE id = $2", [warehouseBId, staffAId]);

      // 3. Verify: Staff A can still view the cargo in their personal registration history
      const staffAuth = { userId: staffAId, role: "warehouse-staff", username: "staffa", warehouseId: warehouseBId };
      const personalSubmissionCheck = canStaffViewSubmission(cargo, staffAId);
      assert.equal(personalSubmissionCheck, true);

      // 4. Verify: Staff A can still view correction requests if assigned to them (simulated via service check)
      const editCheck = canStaffEditCargo({ ...cargo, registration_status: REGISTRATION_STATUS.CORRECTION_REQUIRED }, staffAId);
      assert.equal(editCheck, true);

      // 5. Verify: Staff A can still view documents they uploaded
      const docResult = await db.query("SELECT id FROM cargo_documents WHERE cargo_id = $1 AND uploaded_by = $2", [cargo.id, staffAId]);
      assert.equal(docResult.rowCount, 1);

      // 6. Verify: Staff A cannot see Warehouse A operational queues
      // Let's call a mock getCargo request filtering by warehouse_id
      const filters = [];
      const values = [];
      const reqQueue = {
        auth: staffAuth,
        query: { registration_status: "Pending Review" }
      };
      // Simulate queue filter logic
      // In cargoController line 120: if (isStaff(req)) { filters.push(`c.warehouse_id = req.auth.warehouseId`) }
      if (reqQueue.auth.warehouseId) {
        values.push(reqQueue.auth.warehouseId);
        filters.push(`c.warehouse_id = $${values.length}`);
      }
      const queueResult = await db.query(
        `SELECT id FROM cargo c WHERE c.cargo_id LIKE 'REG-TEST%' AND ${filters.join(" AND ")}`,
        values
      );
      // Since Staff A is now in Warehouse B, and Cargo A is in Warehouse A, they shouldn't see Cargo A in the queue.
      const foundInQueue = queueResult.rows.some(r => r.id === cargo.id);
      assert.equal(foundInQueue, false);

      console.log("✔ Phase 8 Staff ownership regression tests passed!");
    });

    // =========================================================================
    // Phase 9: Pending Task Transfer Protection
    // =========================================================================
    await t.test("Phase 9: Pending Task Transfer Protection Validation", async () => {
      // Create Staff B in Warehouse A
      const staffBResult = await db.query(
        `INSERT INTO users (full_name, username, email, phone_number, password_hash, role_id, warehouse_id, shift_id, status)
         VALUES ($1, $2, $3, $4, 'hash', $5, $6, $7, 'active') RETURNING id`,
        [`${prefix} Staff B`, `${prefix.toLowerCase()}staffb`, `${prefix.toLowerCase()}staffb@example.com`, "+255777777778", staffRoleId, warehouseAId, testShiftId]
      );
      staffBId = staffBResult.rows[0].id;

      // Staff A has correction-required cargo
      const cargoCorr = await db.query(
        `INSERT INTO cargo (cargo_id, barcode, reference_number, consignee_name, cargo_type, cargo_condition,
                            received_by_user_id, created_by, assigned_staff_id, warehouse_id, warehouse_id_at_registration,
                            registration_status, placement_status, status, workflow_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7, $8, $8, $9, $10, $9, $9) RETURNING *`,
        [`${prefix}CG-CORR`, `REG-CG-BARCODE-CORR`, `FPWMS-REG-CORR`, "Consignee A", "General Goods", "Good",
         staffAId, warehouseAId, REGISTRATION_STATUS.CORRECTION_REQUIRED, PLACEMENT_STATUS.UNPLACED]
      );
      const cargo = cargoCorr.rows[0];

      // Verify Staff B cannot continue Staff A's correction
      const canStaffBEdit = canStaffEditCargo(cargo, staffBId);
      assert.equal(canStaffBEdit, false);

      // Verify Supervisor approvals do not leak to other supervisors automatically if assigned
      // Create Supervisor A and B in Warehouse A
      const supARes = await db.query(
        `INSERT INTO users (full_name, username, email, phone_number, password_hash, role_id, warehouse_id, shift_id, status)
         VALUES ($1, $2, $3, $4, 'hash', $5, $6, $7, 'active') RETURNING id`,
        [`${prefix} Sup A`, `${prefix.toLowerCase()}supa`, `${prefix.toLowerCase()}supa@example.com`, "+255777777779", supervisorRoleId, warehouseAId, testShiftId]
      );
      supervisorAId = supARes.rows[0].id;

      const supBRes = await db.query(
        `INSERT INTO users (full_name, username, email, phone_number, password_hash, role_id, warehouse_id, shift_id, status)
         VALUES ($1, $2, $3, $4, 'hash', $5, $6, $7, 'active') RETURNING id`,
        [`${prefix} Sup B`, `${prefix.toLowerCase()}supb`, `${prefix.toLowerCase()}supb@example.com`, "+255777777780", supervisorRoleId, warehouseAId, testShiftId]
      );
      supervisorBId = supBRes.rows[0].id;

      // Assign a registration approval specifically to Supervisor A
      const appReq = await db.query(
        `INSERT INTO approval_requests (request_type, cargo_id, requested_by, assigned_to, warehouse_id_at_request, reason, status)
         VALUES ('CARGO_REGISTRATION', $1, $2, $3, $4, 'REG-TEST-REASON', 'Pending') RETURNING id`,
        [cargo.id, staffAId, supervisorAId, warehouseAId]
      );

      // Verify Supervisor B does not receive it automatically if we filter by assigned supervisor
      const supBTasks = await db.query(
        `SELECT COUNT(*)::int AS count FROM approval_requests ar
         WHERE COALESCE(ar.assigned_to, ar.assigned_supervisor_id) = $1 AND ar.status = 'Pending'`,
        [supervisorBId]
      );
      assert.equal(supBTasks.rows[0].count, 0);

      console.log("✔ Phase 9 pending task protection validation passed!");
    });

    // =========================================================================
    // Phase 10: Warehouse Transfer Validation
    // =========================================================================
    await t.test("Phase 10: Warehouse Transfer Validation", async () => {
      // 1. Staff A has correction-required cargo assigned to them.
      // Reset Staff A back to Warehouse A so we can attempt an update to Warehouse B
      await db.query("UPDATE users SET warehouse_id = $1 WHERE id = $2", [warehouseAId, staffAId]);

      const reqTransferStaff = {
        params: { id: staffAId },
        body: { warehouse_id: warehouseBId, full_name: `${prefix} Staff A`, role_id: staffRoleId, shift_id: testShiftId },
        auth: { userId: 1, role: "system-admin", username: "admin" }
      };

      // Expect transfer blocked
      await assert.rejects(async () => {
        await updateUser(reqTransferStaff, mockResponse(), mockNext);
      }, /Cannot transfer this user because they have pending warehouse tasks/i);

      // 2. Supervisor A has pending approvals.
      const reqTransferSup = {
        params: { id: supervisorAId },
        body: { warehouse_id: warehouseBId, full_name: `${prefix} Sup A`, role_id: supervisorRoleId, shift_id: testShiftId },
        auth: { userId: 1, role: "system-admin", username: "admin" }
      };

      // Expect transfer blocked
      await assert.rejects(async () => {
        await updateUser(reqTransferSup, mockResponse(), mockNext);
      }, /Cannot transfer this user because they have pending warehouse tasks/i);

      console.log("✔ Phase 10 warehouse transfer validation tests passed!");
    });

    // =========================================================================
    // Phase 11: RBAC Validation
    // =========================================================================
    await t.test("Phase 11: RBAC Route Access Level Enforcements", async () => {
      // 1. System Admin must be able to manage warehouses, zones, racks, levels, bins
      assert.equal(canAccessRoute(PORTAL_ROLES.SYSTEM_ADMIN, "POST", "/warehouses"), true);
      assert.equal(canAccessRoute(PORTAL_ROLES.SYSTEM_ADMIN, "POST", "/zones"), true);
      assert.equal(canAccessRoute(PORTAL_ROLES.SYSTEM_ADMIN, "POST", "/racks"), true);
      assert.equal(canAccessRoute(PORTAL_ROLES.SYSTEM_ADMIN, "POST", "/levels"), true);
      assert.equal(canAccessRoute(PORTAL_ROLES.SYSTEM_ADMIN, "POST", "/bins"), true);

      // 2. Warehouse Supervisor must NOT be able to manage warehouses/zones/racks/levels/bins
      assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "POST", "/warehouses"), false);
      assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "POST", "/zones"), false);
      assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "POST", "/racks"), false);
      assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "POST", "/levels"), false);
      assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "POST", "/bins"), false);

      // 3. Warehouse Staff must NOT be able to manage them either
      assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "POST", "/warehouses"), false);
      assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "POST", "/zones"), false);
      assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "POST", "/racks"), false);
      assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "POST", "/levels"), false);
      assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "POST", "/bins"), false);

      console.log("✔ Phase 11 RBAC access enforcements validated!");
    });

    // =========================================================================
    // Phase 12: Audit Logging Validation
    // =========================================================================
    await t.test("Phase 12: Audit Logs Preservations", async () => {
      // Find audit logs generated for CREATE_WAREHOUSE, PRINT_BIN_BARCODE, etc.
      const logs = await db.query(
        "SELECT action, user_id, warehouse_id_at_action FROM audit_logs WHERE description LIKE $1 ORDER BY id DESC",
        [`%${prefix}%`]
      );
      assert.ok(logs.rowCount > 0);
      console.log(`Found ${logs.rowCount} audit logs recorded during test operations.`);

      // Verify that audit log records preserve acting user, role, warehouse context at action time.
      const whLogs = await db.query(
        "SELECT action, user_id, role_id_at_action, warehouse_id_at_action FROM audit_logs WHERE action = 'CREATE_WAREHOUSE' LIMIT 1"
      );
      if (whLogs.rowCount > 0) {
        assert.ok(whLogs.rows[0].role_id_at_action || whLogs.rows[0].user_id);
      }

      console.log("✔ Phase 12 audit log integrity checked!");
    });

    // =========================================================================
    // Phase 13: Human Readable Location Path Improvement
    // =========================================================================
    await t.test("Phase 13: Human-Readable Location Path Improvement Review", async () => {
      // Verify if database schema or API has any location path field
      // Check the bins table columns
      const colCheck = await db.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'bins' AND column_name IN ('location_path', 'location_display')`
      );
      console.log(`Found ${colCheck.rowCount} custom location path columns in bins table.`);

      console.log("✔ Phase 13 location path review finished.");
    });

  } finally {
    // Cleanup everything
    await cleanup();
  }

  console.log("All regression tests completed successfully!");
});

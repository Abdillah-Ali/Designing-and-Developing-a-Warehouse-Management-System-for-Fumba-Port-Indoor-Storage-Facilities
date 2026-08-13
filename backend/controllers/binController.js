const db = require("../config/db");
const { evaluateRules, loadActiveRules } = require("../services/binRuleEngine");
const { buildError } = require("../utils/apiError");
const { notifyWarehouseAlert } = require("../services/notificationService");
const { writeAuditLog } = require("../models/adminModel");
const {
  ensureCapacityFitsParent,
  getEntityReferenceCount,
  readConfigurationStatus,
  readIdentifier,
  readPositiveNumber,
  readThresholds,
  resolveBinLifecycleState,
  textValue
} = require("../services/warehouseConfigurationService");

const BIN_STATUSES = ["Available", "Occupied", "Full", "Reserved", "Restricted", "Blocked", "Maintenance", "Damaged", "Inactive"];

const isAdmin = (req) => req.auth?.role === "system-admin";

const binSelect = `
  SELECT
    b.id,
    b.id AS bin_id,
    b.level_id,
    b.bin_identifier,
    b.name,
    b.name AS bin_name,
    b.bin_type,
    b.length,
    b.width,
    b.height,
    b.volume_capacity,
    b.weight_capacity,
    b.current_occupancy,
    b.creation_status,
    b.operational_status,
    b.cargo_restrictions,
    b.code,
    b.code AS bin_code,
    b.barcode,
    b.barcode AS bin_barcode,
    b.max_weight,
    b.max_weight AS capacity_weight,
    b.max_volume,
    b.max_volume AS capacity_volume,
    b.current_weight,
    b.current_volume,
    b.status,
    b.active,
    COALESCE(b.allowed_cargo_type, z.allowed_cargo_type) AS allowed_cargo_type,
    b.reserved_for_cargo_type,
    b.created_at,
    b.updated_at,
    l.code AS level_code,
    l.level_number,
    r.id AS rack_id,
    r.code AS rack_code,
    z.id AS zone_id,
    z.code AS zone_code,
    z.name AS zone_name,
    z.warehouse_id,
    w.warehouse_name,
    w.warehouse_code,
    (w.warehouse_name || ' → ' || z.code || ' → ' || r.code || ' → ' || l.code || ' → ' || b.code) AS location_display,
    (w.warehouse_name || ' → ' || z.code || ' → ' || r.code || ' → ' || l.code || ' → ' || b.code) AS location_path,
    (w.warehouse_name || ' → ' || z.code || ' → ' || r.code || ' → ' || l.code || ' → ' || b.code) AS display_location,
    CASE WHEN b.max_weight > 0
      THEN ROUND((b.current_weight / b.max_weight) * 100, 2)
      ELSE 0 END AS weight_occupancy_percent,
    CASE WHEN b.max_volume > 0
      THEN ROUND((b.current_volume / b.max_volume) * 100, 2)
      ELSE 0 END AS volume_occupancy_percent
  FROM bins b
  JOIN levels l ON l.id = b.level_id
  JOIN racks r ON r.id = l.rack_id
  JOIN zones z ON z.id = r.zone_id
  LEFT JOIN warehouses w ON w.id = z.warehouse_id
`;

const runBinList = async (req, res, next, levelId = null) => {
  try {
    const activeOnly = !isAdmin(req);
    const conditions = [];
    const values = [];

    const addFilter = (column, value) => {
      if (value === undefined || value === null || value === "") return;
      values.push(value);
      conditions.push(`${column} = $${values.length}`);
    };

    addFilter("b.level_id", levelId ?? req.query.level_id);
    addFilter("r.id", req.query.rack_id);
    addFilter("z.id", req.query.zone_id);
    addFilter("b.status", req.query.status);

    if (!isAdmin(req)) {
      const warehouseId = req.auth?.warehouseId || 0;
      values.push(warehouseId);
      conditions.push(`z.warehouse_id = $${values.length}`);
    } else if (req.query.warehouse_id) {
      values.push(req.query.warehouse_id);
      conditions.push(`z.warehouse_id = $${values.length}`);
    }

    if (activeOnly) {
      conditions.push("b.active = TRUE");
      conditions.push("b.status <> 'Inactive'");
      conditions.push("l.active = TRUE");
      conditions.push("r.active = TRUE");
      conditions.push("z.active = TRUE");
      conditions.push("w.status = 'active'");
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await db.query(
      `${binSelect}
       ${whereClause}
       ORDER BY z.code, r.code, l.level_number, b.code`,
      values
    );
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

const getBins = (req, res, next) => runBinList(req, res, next);
const getBinsByLevel = (req, res, next) => runBinList(req, res, next, req.params.levelId);

const getBinById = async (req, res, next) => {
  try {
    const activeOnly = !isAdmin(req);
    const conditions = ["b.id = $1"];
    const values = [req.params.id];

    if (!isAdmin(req)) {
      const warehouseId = req.auth?.warehouseId || 0;
      values.push(warehouseId);
      conditions.push(`z.warehouse_id = $${values.length}`);
    }

    if (activeOnly) {
      conditions.push("b.active = TRUE");
      conditions.push("b.status <> 'Inactive'");
      conditions.push("l.active = TRUE");
      conditions.push("r.active = TRUE");
      conditions.push("z.active = TRUE");
      conditions.push("w.status = 'active'");
    }

    const result = await db.query(
      `${binSelect}
       WHERE ${conditions.join(" AND ")}`,
      values
    );
    if (result.rowCount === 0) throw buildError("Bin not found.", 404);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

const getHierarchy = async (client, levelId) => {
  const result = await client.query(
    `SELECT
       l.code AS level_code,
       l.active AS level_active,
       r.code AS rack_code,
       r.active AS rack_active,
       z.code AS zone_code,
       z.active AS zone_active,
       z.allowed_cargo_type,
       w.warehouse_code,
       w.warehouse_name,
       w.status AS warehouse_status,
       l.max_weight AS level_max_weight,
       l.max_volume AS level_max_volume
     FROM levels l
     JOIN racks r ON r.id = l.rack_id
     JOIN zones z ON z.id = r.zone_id
     JOIN warehouses w ON w.id = z.warehouse_id
     WHERE l.id = $1`,
    [levelId]
  );
  if (result.rowCount === 0) throw buildError("Level not found.", 404);
  return result.rows[0];
};

const ensureBinUniqueness = async (client, levelId, code, barcode, excludeId = null) => {
  const values = [levelId, code, barcode];
  let exclude = "";
  if (excludeId !== null) {
    values.push(excludeId);
    exclude = "AND id <> $4";
  }
  const duplicate = await client.query(
    `SELECT code, barcode FROM bins
     WHERE ((level_id = $1 AND UPPER(code) = $2) OR UPPER(barcode) = $3) ${exclude}
     LIMIT 1`,
    values
  );
  if (duplicate.rowCount > 0) {
    const dup = duplicate.rows[0];
    if (dup.barcode.toUpperCase() === barcode.toUpperCase()) {
      throw buildError("Bin barcode must be globally unique.", 409);
    } else {
      throw buildError("Bin code must be unique within this level.", 409);
    }
  }
};

const createBin = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const levelId = req.body.level_id;
    const identifier = readIdentifier(
      req.body.bin_identifier
      ?? String(req.body.bin_code ?? req.body.code ?? "").replace(/^B-/i, "")
    );
    const code = `B-${identifier}`;
    const creationStatus = readConfigurationStatus(req.body.creation_status ?? req.body.status);
    const status = creationStatus === "Active" ? "Available" : "Inactive";

    if (!levelId) throw buildError("Level ID is required.", 400);

    await client.query("BEGIN");
    const hierarchy = await getHierarchy(client, levelId);
    if (
      creationStatus === "Active"
      && (!hierarchy.level_active || !hierarchy.rack_active || !hierarchy.zone_active || hierarchy.warehouse_status !== "active")
    ) {
      throw buildError("An active bin requires an active level, rack, zone, and warehouse.", 400);
    }
    const name = `${hierarchy.warehouse_code}-${hierarchy.zone_code}-${hierarchy.rack_code}-${hierarchy.level_code}-${code}`;
    const barcode = name;
    await ensureBinUniqueness(client, levelId, code, barcode);
    const length = readPositiveNumber(req.body.length, "Bin length");
    const width = readPositiveNumber(req.body.width, "Bin width");
    const height = readPositiveNumber(req.body.height, "Bin height");
    const calculatedVolume = length * width * height;
    const manualVolume = req.body.volume_capacity ?? req.body.capacity_volume ?? req.body.max_volume;
    const volume = manualVolume === undefined || manualVolume === null || manualVolume === ""
      ? calculatedVolume
      : readPositiveNumber(manualVolume, "Bin volume capacity");
    const weight = readPositiveNumber(req.body.weight_capacity ?? req.body.capacity_weight ?? req.body.max_weight, "Bin weight capacity");
    ensureCapacityFitsParent({
      childWeight: weight, childVolume: volume,
      parentWeight: Number(hierarchy.level_max_weight), parentVolume: Number(hierarchy.level_max_volume),
      allowOverride: Boolean(req.body.allow_capacity_override), childLabel: "Bin"
    });
    const thresholds = readThresholds(req.body);

    const result = await client.query(
      `INSERT INTO bins (
        level_id,bin_identifier,code,name,barcode,bin_type,length,width,height,
        max_weight,max_volume,weight_capacity,volume_capacity,current_weight,current_volume,current_occupancy,
        status,operational_status,active,creation_status,allowed_cargo_type,
        reserved_for_cargo_type,cargo_restrictions,manual_volume_override,
        occupancy_warning_threshold,full_threshold,created_by,updated_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10,$11,0,0,0,$12,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21)
      RETURNING *,
        id AS bin_id,
        code AS bin_code,
        max_weight AS capacity_weight,
        max_volume AS capacity_volume`,
      [
        levelId,
        identifier,
        code,
        name,
        barcode,
        textValue(req.body.bin_type) || "Standard",
        length,
        width,
        height,
        weight,
        volume,
        status,
        creationStatus === "Active",
        creationStatus,
        textValue(req.body.allowed_cargo_type) || hierarchy.allowed_cargo_type,
        textValue(req.body.reserved_for_cargo_type),
        textValue(req.body.cargo_restrictions),
        manualVolume !== undefined && manualVolume !== null && manualVolume !== "",
        thresholds.warning,
        thresholds.full,
        req.auth?.userId || null
      ]
    );

    await writeAuditLog({
      user_id: req.auth?.userId, action: "CREATE_BIN", module: "Warehouse Configuration",
      description: `Created bin ${name}.`,
      metadata: { bin_id: result.rows[0].id, level_id: Number(levelId), code, name, calculated_volume: calculatedVolume, configured_volume: volume }
    }, client);
    await client.query("COMMIT");
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const updateBin = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const levelId = req.body.level_id;
    const identifier = readIdentifier(req.body.bin_identifier ?? String(req.body.bin_code ?? req.body.code ?? "").replace(/^B-/i, ""));
    const code = `B-${identifier}`;
    if (!levelId) throw buildError("Level ID is required.", 400);

    await client.query("BEGIN");
    const hierarchy = await getHierarchy(client, levelId);
    const existingResult = await client.query("SELECT * FROM bins WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!existingResult.rowCount) throw buildError("Bin not found.", 404);
    const existing = existingResult.rows[0];
    if (
      existing.active
      && (!hierarchy.level_active || !hierarchy.rack_active || !hierarchy.zone_active || hierarchy.warehouse_status !== "active")
    ) {
      throw buildError("An active bin cannot be moved beneath an inactive parent.", 400);
    }
    const name = `${hierarchy.warehouse_code}-${hierarchy.zone_code}-${hierarchy.rack_code}-${hierarchy.level_code}-${code}`;
    const barcode = name;
    await ensureBinUniqueness(client, levelId, code, barcode, req.params.id);
    const length = readPositiveNumber(req.body.length ?? existing.length, "Bin length");
    const width = readPositiveNumber(req.body.width ?? existing.width, "Bin width");
    const height = readPositiveNumber(req.body.height ?? existing.height, "Bin height");
    const calculatedVolume = length * width * height;
    const manualVolume = req.body.volume_capacity ?? req.body.capacity_volume ?? req.body.max_volume;
    const volume = manualVolume === undefined || manualVolume === null || manualVolume === ""
      ? calculatedVolume
      : readPositiveNumber(manualVolume, "Bin volume capacity");
    const weight = readPositiveNumber(
      req.body.weight_capacity ?? req.body.capacity_weight ?? req.body.max_weight ?? existing.max_weight,
      "Bin weight capacity"
    );
    if (weight < Number(existing.current_weight) || volume < Number(existing.current_volume)) {
      throw buildError("Bin capacity cannot be reduced below its current occupancy.", 400);
    }
    ensureCapacityFitsParent({
      childWeight: weight, childVolume: volume,
      parentWeight: Number(hierarchy.level_max_weight), parentVolume: Number(hierarchy.level_max_volume),
      allowOverride: Boolean(req.body.allow_capacity_override), childLabel: "Bin"
    });
    const thresholds = readThresholds(req.body, existing);
    const lifecycle = resolveBinLifecycleState({
      creationStatus: req.body.creation_status ?? req.body.status,
      existingStatus: existing.operational_status || existing.status || "Available"
    });

    const result = await client.query(
      `UPDATE bins
       SET level_id = $1,
           bin_identifier=$2,code=$3,name=$4,barcode=$5,bin_type=$6,
           length=$7,width=$8,height=$9,max_weight=$10,max_volume=$11,
           weight_capacity=$10,volume_capacity=$11,allowed_cargo_type=$12,
           reserved_for_cargo_type=$13,cargo_restrictions=$14,manual_volume_override=$15,
           occupancy_warning_threshold=$16,full_threshold=$17,
           status=$18,operational_status=$19,active=$20,creation_status=$21,updated_by=$22
       WHERE id = $23
       RETURNING *,
         id AS bin_id,
         code AS bin_code,
         max_weight AS capacity_weight,
         max_volume AS capacity_volume`,
      [
        levelId,
        identifier,
        code,
        name,
        barcode,
        textValue(req.body.bin_type) || existing.bin_type || "Standard",
        length,
        width,
        height,
        weight,
        volume,
        textValue(req.body.allowed_cargo_type) || hierarchy.allowed_cargo_type,
        textValue(req.body.reserved_for_cargo_type),
        textValue(req.body.cargo_restrictions),
        manualVolume !== undefined && manualVolume !== null && manualVolume !== "",
        thresholds.warning,
        thresholds.full,
        lifecycle.status,
        lifecycle.status,
        lifecycle.active,
        lifecycle.creationStatus,
        req.auth?.userId || null,
        req.params.id
      ]
    );
    if (result.rowCount === 0) throw buildError("Bin not found.", 404);

    await writeAuditLog({
      user_id: req.auth?.userId, action: "UPDATE_BIN", module: "Warehouse Configuration",
      description: `Updated bin ${name}.`, metadata: { bin_id: Number(req.params.id), before: existing, code, name }
    }, client);
    await client.query("COMMIT");
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const updateBinStatus = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    let status = textValue(req.body.status);
    if (status === "Active") status = "Available";
    if (!BIN_STATUSES.includes(status)) {
      throw buildError(`Bin status must be one of: ${BIN_STATUSES.join(", ")}.`, 400);
    }

    await client.query("BEGIN");
    const binResult = await client.query(
      `SELECT b.*, z.warehouse_id,
              l.active AS level_active, r.active AS rack_active, z.active AS zone_active,
              w.status AS warehouse_status
       FROM bins b
       JOIN levels l ON l.id = b.level_id
       JOIN racks r ON r.id = l.rack_id
       JOIN zones z ON z.id = r.zone_id
       JOIN warehouses w ON w.id=z.warehouse_id
       WHERE b.id = $1 FOR UPDATE OF b`,
      [req.params.id]
    );
    if (binResult.rowCount === 0) throw buildError("Bin not found.", 404);
    const bin = binResult.rows[0];

    const cargoResult = await client.query(
      `SELECT 1 FROM cargo
       WHERE current_bin_id = $1
         AND is_deleted = FALSE
         AND placement_status IN ('Placed', 'Relocated')
       LIMIT 1`,
      [req.params.id]
    );
    const containsCargo = cargoResult.rowCount > 0 || Number(bin.current_weight) > 0 || Number(bin.current_volume) > 0;

    const reason = textValue(req.body.reason ?? req.body.justification);
    if (status === "Inactive" && containsCargo && !(req.body.override_with_cargo === true && reason)) {
      throw buildError("A bin containing cargo requires an explicit admin override and justification before deactivation.", 400);
    }
    if (["Available", "Reserved"].includes(status) && containsCargo) {
      throw buildError(`Cannot mark a bin ${status.toLowerCase()} while it contains cargo.`, 400);
    }
    if (status === "Occupied" && !containsCargo) {
      throw buildError("A bin can only be marked Occupied by the cargo placement workflow.", 400);
    }
    if (status !== "Inactive" && (!bin.level_active || !bin.rack_active || !bin.zone_active || bin.warehouse_status !== "active")) {
      throw buildError("Cannot activate a bin beneath an inactive level, rack, or zone.", 400);
    }
    if (!["Available", "Occupied", "Full"].includes(status) && !reason) {
      throw buildError("A reason or justification is required for manual bin status changes.", 400);
    }

    const active = status !== "Inactive";
    const reservedFor = status === "Reserved"
      ? textValue(req.body.reserved_for_cargo_type) || bin.reserved_for_cargo_type
      : null;
    const result = await client.query(
      `UPDATE bins
       SET status=$1,operational_status=$1,active=$2,creation_status=$4,
           reserved_for_cargo_type=$3,status_reason=$5,updated_by=$6
       WHERE id=$7
       RETURNING *,
         id AS bin_id,
         code AS bin_code,
         max_weight AS capacity_weight,
         max_volume AS capacity_volume`,
      [status, active, reservedFor, active ? "Active" : "Inactive", reason, req.auth?.userId || null, req.params.id]
    );

    const actions = {
      Available: "ACTIVATE_BIN",
      Reserved: "RESERVE_BIN",
      Blocked: "BLOCK_BIN",
      Maintenance: "SET_BIN_MAINTENANCE",
      Damaged: "SET_BIN_DAMAGED",
      Restricted: "RESTRICT_BIN",
      Occupied: "UPDATE_BIN",
      Inactive: "DEACTIVATE_BIN"
    };
    await writeAuditLog({
      user_id: req.auth?.userId, action: actions[status] || "UPDATE_BIN_STATUS",
      module: "Warehouse Configuration", description: `Changed bin ${bin.code} status to ${status}.`,
      metadata: { bin_id: Number(req.params.id), old_status: bin.status, new_status: status, reason, override_with_cargo: Boolean(req.body.override_with_cargo) }
    }, client);

    if (["Blocked", "Maintenance", "Damaged", "Full"].includes(status)) {
      await notifyWarehouseAlert(
        {
          title: `Bin ${result.rows[0].barcode || bin.barcode} is ${status.toLowerCase()}`,
          message: status === "Full"
            ? `Bin ${result.rows[0].barcode || bin.barcode} is full.`
            : `Bin ${result.rows[0].barcode || bin.barcode} is now ${status.toLowerCase()}.`,
          warehouseId: bin.warehouse_id || req.auth?.warehouseId || null,
          relatedEntityType: "bin",
          relatedEntityId: result.rows[0].id,
          priority: status === "Full" ? "urgent" : "high",
          actorId: req.auth?.userId || null,
          metadata: {
            bin_id: result.rows[0].id,
            bin_barcode: result.rows[0].barcode || bin.barcode,
            status
          }
        },
        client
      );
    }
    await client.query("COMMIT");
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const deleteBin = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT * FROM bins WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!existing.rowCount) throw buildError("Bin not found.", 404);
    if (await getEntityReferenceCount(client, "Bin", req.params.id)) {
      throw buildError("Bin is linked to cargo or warehouse history and cannot be deleted. Deactivate it instead.", 409);
    }
    await client.query("DELETE FROM capacity_configurations WHERE entity_type='Bin' AND entity_id=$1", [req.params.id]);
    await client.query("DELETE FROM bins WHERE id=$1", [req.params.id]);
    await writeAuditLog({
      user_id: req.auth?.userId, action: "DELETE_BIN", module: "Warehouse Configuration",
      description: `Deleted unused bin ${existing.rows[0].code}.`, metadata: { deleted_record: existing.rows[0] }
    }, client);
    await client.query("COMMIT");
    res.json({ success: true, message: "Bin deleted." });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const recommendBin = async (req, res, next) => {
  try {
    const cargoResult = await db.query(
      `SELECT c.*,
              (SELECT cov.option_key FROM cargo_option_values cov
               WHERE cov.catalog_key='cargo_type' AND cov.storage_value=c.cargo_type LIMIT 1) AS cargo_type_key
       FROM cargo c WHERE (c.cargo_id=$1 OR c.barcode=$1) AND c.is_deleted=FALSE LIMIT 1`,
      [req.params.cargoId]
    );
    if (!cargoResult.rowCount) throw buildError("Cargo record not found.", 404);
    const cargo = cargoResult.rows[0];
    const candidates = await db.query(
      `SELECT b.*,l.code AS level_code,l.active AS level_active,r.code AS rack_code,r.active AS rack_active,
              z.code AS zone_code,z.name AS zone_name,z.zone_type,z.allowed_cargo_type AS zone_allowed_cargo_type,
              z.handling_condition,z.is_hazard_zone,z.active AS zone_active,z.warehouse_id,
              w.warehouse_code,w.warehouse_name,w.status AS warehouse_status,
              (b.max_weight-b.current_weight) AS available_weight,
              (b.max_volume-b.current_volume) AS available_volume
       FROM warehouses w JOIN zones z ON z.warehouse_id=w.id JOIN racks r ON r.zone_id=z.id
       JOIN levels l ON l.rack_id=r.id JOIN bins b ON b.level_id=l.id WHERE w.id=$1`,
      [cargo.warehouse_id]
    );
    const rules = await loadActiveRules("placement_recommendation");
    const eligible = [];
    for (const bin of candidates.rows) {
      const remainingWeight = Number(bin.max_weight || 0) - Number(bin.current_weight || 0);
      const remainingVolume = Number(bin.max_volume || 0) - Number(bin.current_volume || 0);
      if (Number(cargo.weight || 0) > remainingWeight || Number(cargo.volume || 0) > remainingVolume) continue;
      const evaluation = await evaluateRules({
        target: "placement_recommendation", rules,
        context: { cargo, bin, approvals: { supervisor_override: null }, derived: {
          remaining_weight: remainingWeight,
          remaining_volume: remainingVolume,
          already_placed_in_bin: Number(cargo.current_bin_id) === Number(bin.id)
        } }
      });
      if (!evaluation.readiness.ready) return res.status(409).json({ success: false, message: evaluation.detail, data: evaluation.readiness });
      if (evaluation.approved) eligible.push(bin);
    }
    if (!eligible.length) throw buildError("No configured-rule-compliant bin is available for this cargo.", 404);
    const orderingRules = rules.filter((rule) => rule.rule_type === "ordering");
    eligible.sort((left, right) => {
      for (const rule of orderingRules) {
        const field = rule.parameters?.field;
        const direction = rule.parameters?.direction === "desc" ? -1 : 1;
        const comparison = String(left[field] ?? "").localeCompare(String(right[field] ?? ""), undefined, { numeric: true });
        if (comparison) return comparison * direction;
      }
      return String(left.created_at).localeCompare(String(right.created_at));
    });
    const { id, level_id, warehouse_id, ...publicBin } = eligible[0];
    res.json({ success: true, data: publicBin });
  } catch (error) {
    next(error);
  }
};

const printBinBarcode = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const binResult = await client.query(
      `${binSelect} WHERE b.id = $1`,
      [req.params.id]
    );
    if (binResult.rowCount === 0) throw buildError("Bin not found.", 404);

    const previousPrint = await client.query(
      "SELECT 1 FROM bin_barcode_print_logs WHERE bin_id = $1 LIMIT 1",
      [req.params.id]
    );
    const printType = previousPrint.rowCount > 0 ? "REPRINT" : "PRINT";
    await client.query(
      `INSERT INTO bin_barcode_print_logs (bin_id, printed_by, print_type)
       VALUES ($1, $2, $3)`,
      [req.params.id, req.auth?.userId || null, printType]
    );
    await client.query(
      `INSERT INTO audit_logs (user_id, action, module, description, metadata)
       VALUES ($1, 'PRINT_BIN_BARCODE', 'Warehouse Configuration', $2, $3)`,
      [
        req.auth?.userId || null,
        `${printType === "REPRINT" ? "Reprinted" : "Printed"} barcode label for bin ${binResult.rows[0].barcode}.`,
        JSON.stringify({ bin_id: Number(req.params.id), print_type: printType })
      ]
    );
    await client.query("COMMIT");
    res.json({
      success: true,
      data: {
        ...binResult.rows[0],
        print_type: printType
      }
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

module.exports = {
  getBins,
  getBinById,
  getBinsByLevel,
  createBin,
  updateBin,
  updateBinStatus,
  printBinBarcode,
  deleteBin,
  recommendBin
};

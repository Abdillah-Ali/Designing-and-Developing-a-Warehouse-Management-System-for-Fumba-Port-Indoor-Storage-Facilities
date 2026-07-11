const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { buildError } = require("../utils/apiError");
const {
  readConfigurationStatus,
  readPositiveNumber,
  readThresholds
} = require("../services/warehouseConfigurationService");

const ENTITY_MAP = Object.freeze({
  Warehouse: { table: "warehouses", weight: "total_capacity", volume: "max_volume" },
  Zone: { table: "zones", weight: "max_weight", volume: "max_volume" },
  Rack: { table: "racks", weight: "max_weight", volume: "max_volume" },
  Level: { table: "levels", weight: "max_weight", volume: "max_volume" },
  Bin: { table: "bins", weight: "max_weight", volume: "max_volume" }
});

const normalizeEntityType = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  const type = Object.keys(ENTITY_MAP).find((item) => item.toLowerCase() === normalized);
  if (!type) throw buildError("Entity type must be Warehouse, Zone, Rack, Level, or Bin.", 400);
  return type;
};

const getCapacityConfigurations = async (req, res, next) => {
  try {
    const values = [];
    const clauses = [];
    if (req.query.entity_type) {
      values.push(normalizeEntityType(req.query.entity_type));
      clauses.push(`capacity.entity_type=$${values.length}`);
    }
    if (req.query.entity_id) {
      values.push(req.query.entity_id);
      clauses.push(`capacity.entity_id=$${values.length}`);
    }
    const result = await db.query(
      `WITH capacity AS (
         SELECT 'Warehouse'::varchar AS entity_type,w.id AS entity_id,NULL::integer AS parent_id,w.warehouse_name AS entity_name,
                w.total_capacity AS max_weight,w.max_volume,
                w.occupancy_warning_threshold,w.full_threshold,w.status,
                COALESCE(SUM(b.current_weight),0) AS current_weight,
                COALESCE(SUM(b.current_volume),0) AS current_volume
         FROM warehouses w
         LEFT JOIN zones z ON z.warehouse_id=w.id LEFT JOIN racks r ON r.zone_id=z.id
         LEFT JOIN levels l ON l.rack_id=r.id LEFT JOIN bins b ON b.level_id=l.id
         GROUP BY w.id
         UNION ALL
         SELECT 'Zone',z.id,z.warehouse_id,z.name,z.max_weight,z.max_volume,z.occupancy_warning_threshold,z.full_threshold,z.status,
                COALESCE(SUM(b.current_weight),0),COALESCE(SUM(b.current_volume),0)
         FROM zones z LEFT JOIN racks r ON r.zone_id=z.id LEFT JOIN levels l ON l.rack_id=r.id
         LEFT JOIN bins b ON b.level_id=l.id GROUP BY z.id
         UNION ALL
         SELECT 'Rack',r.id,r.zone_id,r.name,r.max_weight,r.max_volume,r.occupancy_warning_threshold,r.full_threshold,r.status,
                COALESCE(SUM(b.current_weight),0),COALESCE(SUM(b.current_volume),0)
         FROM racks r LEFT JOIN levels l ON l.rack_id=r.id LEFT JOIN bins b ON b.level_id=l.id GROUP BY r.id
         UNION ALL
         SELECT 'Level',l.id,l.rack_id,l.name,l.max_weight,l.max_volume,l.occupancy_warning_threshold,l.full_threshold,l.status,
                COALESCE(SUM(b.current_weight),0),COALESCE(SUM(b.current_volume),0)
         FROM levels l LEFT JOIN bins b ON b.level_id=l.id GROUP BY l.id
         UNION ALL
         SELECT 'Bin',b.id,b.level_id,b.name,b.max_weight,b.max_volume,b.occupancy_warning_threshold,b.full_threshold,b.creation_status,
                b.current_weight,b.current_volume FROM bins b
       )
       SELECT capacity.*,cfg.id AS configuration_id,
              COALESCE(cfg.allow_child_capacity_override,FALSE) AS allow_child_capacity_override,
              CASE WHEN capacity.max_weight>0 THEN ROUND(capacity.current_weight/capacity.max_weight*100,2) ELSE 0 END AS weight_usage_percent,
              CASE WHEN capacity.max_volume>0 THEN ROUND(capacity.current_volume/capacity.max_volume*100,2) ELSE 0 END AS volume_usage_percent
       FROM capacity
       LEFT JOIN capacity_configurations cfg
         ON cfg.entity_type=capacity.entity_type AND cfg.entity_id=capacity.entity_id
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY capacity.entity_type,capacity.entity_name`,
      values
    );
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

const getParentCapacity = async (client, type, id) => {
  const queries = {
    Zone: `SELECT w.total_capacity AS max_weight,w.max_volume,
                  COALESCE(c.allow_child_capacity_override,FALSE) AS allow_override
           FROM zones z JOIN warehouses w ON w.id=z.warehouse_id
           LEFT JOIN capacity_configurations c ON c.entity_type='Warehouse' AND c.entity_id=w.id
           WHERE z.id=$1`,
    Rack: `SELECT z.max_weight,z.max_volume,COALESCE(c.allow_child_capacity_override,FALSE) AS allow_override
           FROM racks r JOIN zones z ON z.id=r.zone_id
           LEFT JOIN capacity_configurations c ON c.entity_type='Zone' AND c.entity_id=z.id WHERE r.id=$1`,
    Level: `SELECT r.max_weight,r.max_volume,COALESCE(c.allow_child_capacity_override,FALSE) AS allow_override
            FROM levels l JOIN racks r ON r.id=l.rack_id
            LEFT JOIN capacity_configurations c ON c.entity_type='Rack' AND c.entity_id=r.id WHERE l.id=$1`,
    Bin: `SELECT l.max_weight,l.max_volume,COALESCE(c.allow_child_capacity_override,FALSE) AS allow_override
          FROM bins b JOIN levels l ON l.id=b.level_id
          LEFT JOIN capacity_configurations c ON c.entity_type='Level' AND c.entity_id=l.id WHERE b.id=$1`
  };
  if (!queries[type]) return null;
  const result = await client.query(queries[type], [id]);
  return result.rows[0] || null;
};

const getUsage = async (client, type, id) => {
  const queries = {
    Warehouse: `SELECT COALESCE(SUM(b.current_weight),0) AS weight,COALESCE(SUM(b.current_volume),0) AS volume
                FROM zones z LEFT JOIN racks r ON r.zone_id=z.id LEFT JOIN levels l ON l.rack_id=r.id
                LEFT JOIN bins b ON b.level_id=l.id WHERE z.warehouse_id=$1`,
    Zone: `SELECT COALESCE(SUM(b.current_weight),0) AS weight,COALESCE(SUM(b.current_volume),0) AS volume
           FROM racks r LEFT JOIN levels l ON l.rack_id=r.id LEFT JOIN bins b ON b.level_id=l.id WHERE r.zone_id=$1`,
    Rack: `SELECT COALESCE(SUM(b.current_weight),0) AS weight,COALESCE(SUM(b.current_volume),0) AS volume
           FROM levels l LEFT JOIN bins b ON b.level_id=l.id WHERE l.rack_id=$1`,
    Level: "SELECT COALESCE(SUM(current_weight),0) AS weight,COALESCE(SUM(current_volume),0) AS volume FROM bins WHERE level_id=$1",
    Bin: "SELECT current_weight AS weight,current_volume AS volume FROM bins WHERE id=$1"
  };
  const result = await client.query(queries[type], [id]);
  return result.rows[0] || { weight: 0, volume: 0 };
};

const updateCapacityConfiguration = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const type = normalizeEntityType(req.params.entityType ?? req.body.entity_type);
    const id = Number(req.params.entityId ?? req.body.entity_id);
    if (!Number.isInteger(id) || id <= 0) throw buildError("A valid entity ID is required.", 400);
    const maxWeight = readPositiveNumber(req.body.max_weight, "Maximum weight");
    const maxVolume = readPositiveNumber(req.body.max_volume, "Maximum volume");
    const thresholds = readThresholds(req.body);
    const status = readConfigurationStatus(req.body.status);
    const allowOverride = req.body.allow_child_capacity_override === true;
    const entity = ENTITY_MAP[type];

    await client.query("BEGIN");
    const existing = await client.query(`SELECT * FROM ${entity.table} WHERE id=$1 FOR UPDATE`, [id]);
    if (!existing.rowCount) throw buildError(`${type} not found.`, 404);
    const usage = await getUsage(client, type, id);
    if (maxWeight < Number(usage.weight) || maxVolume < Number(usage.volume)) {
      throw buildError("Capacity cannot be reduced below current occupied weight or volume.", 400);
    }
    const parent = await getParentCapacity(client, type, id);
    if (parent && !parent.allow_override) {
      if (Number(parent.max_weight) > 0 && maxWeight > Number(parent.max_weight)) {
        throw buildError(`${type} maximum weight cannot exceed its parent capacity.`, 400);
      }
      if (Number(parent.max_volume) > 0 && maxVolume > Number(parent.max_volume)) {
        throw buildError(`${type} maximum volume cannot exceed its parent capacity.`, 400);
      }
    }
    await client.query(
      `UPDATE ${entity.table}
       SET ${entity.weight}=$1,${entity.volume}=$2,occupancy_warning_threshold=$3,
           full_threshold=$4,updated_by=$5 WHERE id=$6`,
      [maxWeight, maxVolume, thresholds.warning, thresholds.full, req.auth?.userId || null, id]
    );
    const result = await client.query(
      `INSERT INTO capacity_configurations (
         entity_type,entity_id,max_weight,max_volume,occupancy_warning_threshold,full_threshold,
         allow_child_capacity_override,status,created_by,updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       ON CONFLICT (entity_type,entity_id) DO UPDATE SET
         max_weight=EXCLUDED.max_weight,max_volume=EXCLUDED.max_volume,
         occupancy_warning_threshold=EXCLUDED.occupancy_warning_threshold,
         full_threshold=EXCLUDED.full_threshold,
         allow_child_capacity_override=EXCLUDED.allow_child_capacity_override,
         status=EXCLUDED.status,updated_by=EXCLUDED.updated_by
       RETURNING *`,
      [type, id, maxWeight, maxVolume, thresholds.warning, thresholds.full, allowOverride, status, req.auth?.userId || null]
    );
    await writeAuditLog({
      user_id: req.auth?.userId,
      action: "UPDATE_CAPACITY_CONFIGURATION",
      module: "Warehouse Configuration",
      description: `Updated ${type.toLowerCase()} ${id} capacity.`,
      metadata: { entity_type: type, entity_id: id, max_weight: maxWeight, max_volume: maxVolume, ...thresholds, allow_child_capacity_override: allowOverride }
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

module.exports = { getCapacityConfigurations, updateCapacityConfiguration };

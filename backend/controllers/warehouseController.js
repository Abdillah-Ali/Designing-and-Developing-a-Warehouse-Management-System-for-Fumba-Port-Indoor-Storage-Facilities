const db = require("../config/db");
const { buildError } = require("../utils/apiError");
const { writeAuditLog } = require("../models/adminModel");

const WAREHOUSE_CODE_PATTERN = /^[A-Z0-9-]+$/;

const textValue = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const getWarehouses = async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT
        w.id,
        w.warehouse_name,
        w.warehouse_code,
        w.status,
        w.created_at,
        COUNT(DISTINCT u.id)::int AS assigned_user_count,
        COUNT(DISTINCT z.id)::int AS zone_count
      FROM warehouses w
      LEFT JOIN users u ON u.warehouse_id = w.id
      LEFT JOIN zones z ON z.warehouse_id = w.id
      GROUP BY w.id
      ORDER BY w.warehouse_code`
    );
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

const createWarehouse = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const name = textValue(req.body.warehouse_name ?? req.body.name);
    const code = textValue(req.body.warehouse_code ?? req.body.code)?.toUpperCase();
    const status = textValue(req.body.status) || "active";

    if (!name) throw buildError("Warehouse name is required.", 400);
    if (!code || !WAREHOUSE_CODE_PATTERN.test(code)) {
      throw buildError("Warehouse code is required and must be alphanumeric (dashes allowed).", 400);
    }
    if (!["active", "inactive"].includes(status)) {
      throw buildError("Warehouse status must be active or inactive.", 400);
    }

    await client.query("BEGIN");

    const duplicate = await client.query(
      "SELECT id FROM warehouses WHERE UPPER(warehouse_code) = $1",
      [code]
    );
    if (duplicate.rowCount > 0) {
      throw buildError(`Warehouse with code ${code} already exists.`, 409);
    }

    const result = await client.query(
      `INSERT INTO warehouses (warehouse_name, warehouse_code, status)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, code, status]
    );

    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action: "CREATE_WAREHOUSE",
        module: "Warehouse Configuration",
        description: `Created warehouse ${code} (${name}) with status ${status}.`,
        metadata: {
          warehouse_id: result.rows[0].id,
          warehouse_code: code,
          warehouse_name: name,
          status
        }
      },
      client
    );

    await client.query("COMMIT");
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const updateWarehouse = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const id = req.params.id;
    const name = textValue(req.body.warehouse_name ?? req.body.name);
    const code = textValue(req.body.warehouse_code ?? req.body.code)?.toUpperCase();
    const status = textValue(req.body.status);

    if (!name) throw buildError("Warehouse name is required.", 400);
    if (!code || !WAREHOUSE_CODE_PATTERN.test(code)) {
      throw buildError("Warehouse code is required and must be alphanumeric (dashes allowed).", 400);
    }

    await client.query("BEGIN");

    const existingResult = await client.query("SELECT * FROM warehouses WHERE id = $1", [id]);
    if (existingResult.rowCount === 0) {
      throw buildError("Warehouse not found.", 404);
    }
    const existing = existingResult.rows[0];

    const duplicate = await client.query(
      "SELECT id FROM warehouses WHERE UPPER(warehouse_code) = $1 AND id <> $2",
      [code, id]
    );
    if (duplicate.rowCount > 0) {
      throw buildError(`Warehouse with code ${code} already exists.`, 409);
    }

    let nextStatus = existing.status;
    if (status && status !== existing.status) {
      if (!["active", "inactive"].includes(status)) {
        throw buildError("Warehouse status must be active or inactive.", 400);
      }
      if (status === "inactive") {
        await checkWarehouseDeactivationSafety(client, id);
      }
      nextStatus = status;
    }

    const result = await client.query(
      `UPDATE warehouses
       SET warehouse_name = $1,
           warehouse_code = $2,
           status = $3
       WHERE id = $4
       RETURNING *`,
      [name, code, nextStatus, id]
    );

    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action: "UPDATE_WAREHOUSE",
        module: "Warehouse Configuration",
        description: `Updated warehouse ${existing.warehouse_code} -> ${code}.`,
        metadata: {
          warehouse_id: id,
          old_name: existing.warehouse_name,
          new_name: name,
          old_code: existing.warehouse_code,
          new_code: code,
          old_status: existing.status,
          new_status: nextStatus
        }
      },
      client
    );

    await client.query("COMMIT");
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const updateWarehouseStatus = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const id = req.params.id;
    const status = textValue(req.body.status);

    if (!["active", "inactive"].includes(status)) {
      throw buildError("Warehouse status must be active or inactive.", 400);
    }

    await client.query("BEGIN");

    const existingResult = await client.query("SELECT * FROM warehouses WHERE id = $1 FOR UPDATE", [id]);
    if (existingResult.rowCount === 0) {
      throw buildError("Warehouse not found.", 404);
    }
    const existing = existingResult.rows[0];

    if (existing.status === status) {
      throw buildError(`Warehouse is already ${status}.`, 400);
    }

    if (status === "inactive") {
      await checkWarehouseDeactivationSafety(client, id);
    }

    const result = await client.query(
      "UPDATE warehouses SET status = $1 WHERE id = $2 RETURNING *",
      [status, id]
    );

    const action = status === "active" ? "ACTIVATE_WAREHOUSE" : "DEACTIVATE_WAREHOUSE";
    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action,
        module: "Warehouse Configuration",
        description: `${status === "active" ? "Activated" : "Deactivated"} warehouse ${existing.warehouse_code}.`,
        metadata: {
          warehouse_id: id,
          warehouse_code: existing.warehouse_code,
          status
        }
      },
      client
    );

    await client.query("COMMIT");
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const checkWarehouseDeactivationSafety = async (client, warehouseId) => {
  // Check if warehouse contains active stored cargo
  const cargoResult = await client.query(
    `SELECT 1 FROM cargo
     WHERE warehouse_id = $1
       AND is_deleted = FALSE
       AND placement_status IN ('Placed', 'Relocated')
     LIMIT 1`,
    [warehouseId]
  );
  if (cargoResult.rowCount > 0) {
    throw buildError("Cannot deactivate a warehouse that contains active stored cargo.", 400);
  }

  // Check if there are active users assigned
  const usersResult = await client.query(
    `SELECT 1 FROM users
     WHERE warehouse_id = $1
       AND status = 'active'
     LIMIT 1`,
    [warehouseId]
  );
  if (usersResult.rowCount > 0) {
    throw buildError("Cannot deactivate a warehouse that has active users assigned.", 400);
  }
};

module.exports = {
  getWarehouses,
  createWarehouse,
  updateWarehouse,
  updateWarehouseStatus
};

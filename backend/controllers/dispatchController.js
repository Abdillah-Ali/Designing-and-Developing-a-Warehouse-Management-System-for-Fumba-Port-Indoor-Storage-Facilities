const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { buildError } = require("../utils/apiError");
const {
  notifyDispatchDecision,
  notifyDispatchSubmitted
} = require("../services/notificationService");
const {
  PLACEMENT_STATUS,
  REGISTRATION_STATUS
} = require("../services/cargoWorkflowService");
const { STAFF_TASK_OWNER_SQL } = require("../services/taskOwnershipService");

const REQUEST_NOT_AVAILABLE_MESSAGE = "This request could not be found or is not available to your account.";

const dispatchSelect = `
  SELECT
    dr.*,
    dr.cargo_id AS cargo_record_id,
    c.cargo_id,
    c.barcode AS cargo_barcode,
    c.consignee_name,
    c.cargo_type,
    c.registration_status,
    c.placement_status,
    c.location,
    c.warehouse_id,
    requester.full_name AS requested_by_name,
    decider.full_name AS decided_by_name
  FROM dispatch_requests dr
  JOIN cargo c ON c.id = dr.cargo_id
  LEFT JOIN users requester ON requester.id = dr.requested_by
  LEFT JOIN users decider ON decider.id = dr.decided_by
`;

const toPublicDispatchRequest = (row) => {
  const {
    id,
    cargo_record_id,
    requested_by,
    decided_by,
    warehouse_id,
    ...publicRow
  } = row;
  return publicRow;
};

const requestDispatchAuthorization = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");
    const cargoResult = await client.query(
      `SELECT *
       FROM cargo
       WHERE (id::text = $1 OR cargo_id = $1 OR barcode = $1)
         AND is_deleted = FALSE
       FOR UPDATE`,
      [String(req.body.cargo_id || "")]
    );
    if (cargoResult.rowCount === 0) throw buildError(REQUEST_NOT_AVAILABLE_MESSAGE, 404);
    const cargo = cargoResult.rows[0];
    if (
      req.auth?.role === "warehouse-staff"
      && (
        Number(cargo.warehouse_id) !== Number(req.auth?.warehouseId)
        || Number(cargo.assigned_staff_id || cargo.created_by || cargo.received_by_user_id) !== Number(req.auth?.userId)
      )
    ) {
      throw buildError(REQUEST_NOT_AVAILABLE_MESSAGE, 404);
    }
    if (cargo.registration_status !== REGISTRATION_STATUS.APPROVED) {
      throw buildError("Cargo registration must be approved before dispatch processing.", 400);
    }
    if (![PLACEMENT_STATUS.PLACED, PLACEMENT_STATUS.RELOCATED].includes(cargo.placement_status)) {
      throw buildError("Only placed cargo can be submitted for dispatch authorization.", 400);
    }

    const existing = await client.query(
      "SELECT id FROM dispatch_requests WHERE cargo_id = $1 AND status = 'Pending' LIMIT 1",
      [cargo.id]
    );
    if (existing.rowCount > 0) throw buildError("Dispatch authorization is already pending for this cargo.", 409);

    const result = await client.query(
      `INSERT INTO dispatch_requests (cargo_id, requested_by, reason, status)
       VALUES ($1, $2, $3, 'Pending')
       RETURNING *`,
      [cargo.id, req.auth?.userId || null, String(req.body.reason || "").trim() || null]
    );
    await client.query(
      `UPDATE cargo
       SET dispatch_status = 'Awaiting Approval',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [cargo.id]
    );
    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action: "REQUEST_DISPATCH_AUTHORIZATION",
        module: "Dispatch Operations",
        description: `Requested dispatch authorization for cargo ${cargo.cargo_id}.`,
        metadata: { dispatch_request_id: result.rows[0].id }
      },
      client
    );
    await notifyDispatchSubmitted(
      {
        cargo,
        dispatchRequestId: result.rows[0].id,
        requesterId: req.auth?.userId || null,
        actorId: req.auth?.userId || null
      },
      client
    );
    await client.query("COMMIT");
    res.status(201).json({
      success: true,
      data: {
        cargo_id: cargo.cargo_id,
        status: result.rows[0].status,
        reason: result.rows[0].reason,
        created_at: result.rows[0].created_at
      }
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const getDispatchRequests = async (req, res, next) => {
  try {
    const values = [];
    const clauses = ["c.is_deleted = FALSE"];
    if (req.query.cargoRef) {
      values.push(req.query.cargoRef);
      clauses.push(`c.cargo_id = $${values.length}`);
    }
    if (req.query.status) {
      values.push(req.query.status);
      clauses.push(`dr.status = $${values.length}`);
    }
    if (req.auth?.role === "warehouse-supervisor" && req.auth?.warehouseId) {
      values.push(req.auth.warehouseId);
      clauses.push(`c.warehouse_id = $${values.length}`);
    }
    if (req.auth?.role === "warehouse-staff") {
      values.push(req.auth?.userId || 0);
      clauses.push(`(${STAFF_TASK_OWNER_SQL} = $${values.length} OR dr.requested_by = $${values.length})`);
      if (req.auth?.warehouseId) {
        values.push(req.auth.warehouseId);
        clauses.push(`c.warehouse_id = $${values.length}`);
      }
    }
    const result = await db.query(
      `${dispatchSelect}
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY CASE WHEN dr.status = 'Pending' THEN 0 ELSE 1 END,
                dr.created_at DESC, dr.id DESC`,
      values
    );
    if (req.query.cargoRef && result.rowCount === 0) {
      throw buildError(REQUEST_NOT_AVAILABLE_MESSAGE, 404);
    }
    res.json({ success: true, count: result.rowCount, data: result.rows.map(toPublicDispatchRequest) });
  } catch (error) {
    next(error);
  }
};

const decideDispatchRequest = async (req, res, next, decision) => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");
    const requestResult = await client.query(
      `${dispatchSelect}
       WHERE (dr.id::text = $1 OR c.cargo_id = $1)
       ORDER BY CASE WHEN dr.status = 'Pending' THEN 0 ELSE 1 END,
                dr.created_at DESC,
                dr.id DESC
       LIMIT 1
       FOR UPDATE OF dr, c`,
      [String(req.params.id)]
    );
    if (requestResult.rowCount === 0) throw buildError(REQUEST_NOT_AVAILABLE_MESSAGE, 404);
    const request = requestResult.rows[0];
    if (
      req.auth?.role === "warehouse-supervisor"
      && req.auth?.warehouseId
      && Number(request.warehouse_id) !== Number(req.auth.warehouseId)
    ) {
      throw buildError(REQUEST_NOT_AVAILABLE_MESSAGE, 404);
    }
    if (request.status !== "Pending") {
      throw buildError(`Dispatch request has already been ${request.status.toLowerCase()}.`, 409);
    }

    const notes = String(req.body.decision_notes || "").trim();
    await client.query(
      `UPDATE dispatch_requests
       SET status = $1,
           decision_notes = $2,
           decided_at = CURRENT_TIMESTAMP,
           decided_by = $3
       WHERE id = $4`,
      [decision, notes || null, req.auth?.userId || null, request.id]
    );
    await client.query(
      `UPDATE cargo
       SET dispatch_status = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [decision === "Approved" ? "Approved" : "Rejected", request.cargo_record_id]
    );
    const action = decision === "Approved"
      ? "APPROVE_DISPATCH_AUTHORIZATION"
      : "REJECT_DISPATCH_AUTHORIZATION";
    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action,
        module: "Dispatch Operations",
        description: `${decision} dispatch authorization for cargo ${request.cargo_id}.`,
        metadata: {
          dispatch_request_id: request.id,
          cargo_id: request.cargo_record_id,
          decision_notes: notes || null
        }
      },
      client
    );

    await notifyDispatchDecision(
      {
        cargo: {
          ...request,
          id: request.cargo_record_id
        },
        dispatchRequest: request,
        decision,
        notes,
        actorId: req.auth?.userId || null
      },
      client
    );

    // Resolve matching pending dispatch notifications
    const { resolveNotificationsByEntity } = require("../services/notificationService");
    await resolveNotificationsByEntity({
      relatedEntityType: "cargo",
      relatedEntityId: request.cargo_record_id,
      notificationTypes: ["dispatch_request"],
      executor: client
    });

    const result = await client.query(`${dispatchSelect} WHERE dr.id = $1`, [request.id]);
    await client.query("COMMIT");
    res.json({ success: true, data: toPublicDispatchRequest(result.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const approveDispatchRequest = (req, res, next) => decideDispatchRequest(req, res, next, "Approved");
const rejectDispatchRequest = (req, res, next) => decideDispatchRequest(req, res, next, "Rejected");

module.exports = {
  approveDispatchRequest,
  getDispatchRequests,
  rejectDispatchRequest,
  requestDispatchAuthorization
};

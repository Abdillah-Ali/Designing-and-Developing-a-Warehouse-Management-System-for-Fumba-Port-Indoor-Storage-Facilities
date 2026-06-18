const db = require("../config/db");
const { roleNames } = require("../config/systemConfig");
const { writeAuditLog } = require("../models/adminModel");
const { buildError } = require("../utils/apiError");
const {
  CORRECTION_FIELDS,
  REGISTRATION_STATUS,
  REJECTION_REASONS,
  captureCorrectionValues,
  ensurePendingRegistrationApprovals,
  getRejectionReason,
  normalizeCorrectionFields,
  updateCargoRegistrationStatus
} = require("../services/cargoWorkflowService");
const { APPROVAL_ASSIGNEE_SQL } = require("../services/taskOwnershipService");

const approvalSelect = `
  SELECT
    ar.*,
    ar.cargo_id AS cargo_record_id,
    c.cargo_id,
    c.barcode AS cargo_barcode,
    c.cargo_type,
    c.cargo_condition,
    c.consignee_name,
    c.weight,
    c.volume,
    c.container_number,
    c.inspection_notes,
    c.created_at AS registration_date,
    c.registration_status,
    c.warehouse_id,
    c.placement_status,
    COALESCE(ar.assigned_to, ar.assigned_supervisor_id) AS assigned_to,
    ar.warehouse_id_at_request,
    requester.full_name AS requested_by_name,
    requester.username AS requested_by_username,
    registrant.full_name AS registered_by_name,
    registrant.username AS registered_by_username,
    assignee.full_name AS assigned_supervisor_name,
    decider.full_name AS decided_by_name,
    COALESCE((
      SELECT json_agg(json_build_object(
        'id', cd.id,
        'file_name', cd.file_name,
        'file_type', cd.file_type,
        'file_size', cd.file_size,
        'uploaded_at', cd.uploaded_at
      ) ORDER BY cd.uploaded_at DESC, cd.id DESC)
      FROM cargo_documents cd
      WHERE cd.cargo_id = c.id
    ), '[]'::json) AS supporting_documents
  FROM approval_requests ar
  JOIN cargo c ON c.id = ar.cargo_id
  LEFT JOIN users requester ON requester.id = ar.requested_by
  LEFT JOIN users registrant ON registrant.id = c.received_by_user_id
  LEFT JOIN users assignee ON assignee.id = COALESCE(ar.assigned_to, ar.assigned_supervisor_id)
  LEFT JOIN users decider ON decider.id = ar.decided_by
`;

const assertWarehouseAccess = (req, warehouseId) => {
  if (
    req.auth?.role === "warehouse-supervisor"
    && req.auth?.warehouseId
    && Number(warehouseId) !== Number(req.auth.warehouseId)
  ) {
    throw buildError("Approval request not found.", 404);
  }
};

const assertApprovalAccess = (req, approval) => {
  assertWarehouseAccess(req, approval.warehouse_id);

  if (req.auth?.role !== "warehouse-supervisor") return;

  const assignedTo = approval.assigned_to || approval.assigned_supervisor_id;
  if (assignedTo && Number(assignedTo) !== Number(req.auth?.userId)) {
    throw buildError("Approval request not found.", 404);
  }
};

const getSupervisorWarehouseScope = (req) => (
  req.auth?.role === "warehouse-supervisor"
    ? req.auth?.warehouseId || null
    : null
);

const shouldRepairPendingRegistrationApprovals = (req) => {
  const status = String(req.query.status || "").trim();
  const requestType = String(req.query.request_type || "").trim();

  return (!status || status === "Pending")
    && (!requestType || requestType === "CARGO_REGISTRATION");
};

const getReviewConfiguration = (req, res) => {
  res.json({
    success: true,
    data: {
      correction_fields: Object.entries(CORRECTION_FIELDS).map(([value, label]) => ({
        value,
        label
      })),
      rejection_conditions: Object.entries(REJECTION_REASONS).map(([value, label]) => ({
        value,
        label
      }))
    }
  });
};

const getSupervisorDashboard = async (req, res, next) => {
  try {
    const warehouseId = getSupervisorWarehouseScope(req);
    const values = [roleNames.warehouseStaff];
    const warehouseCargo = warehouseId
      ? `AND c.warehouse_id = $${values.push(warehouseId)}`
      : "";
    const warehouseUsers = warehouseId
      ? `AND u.warehouse_id = $2`
      : "";
    const approvalAssignment = req.auth?.role === "warehouse-supervisor"
      ? `AND (${APPROVAL_ASSIGNEE_SQL} IS NULL OR ${APPROVAL_ASSIGNEE_SQL} = $${values.push(req.auth.userId)})`
      : "";

    await ensurePendingRegistrationApprovals(db, warehouseId);

    const metrics = await db.query(
      `SELECT
        (SELECT COUNT(*)::int FROM approval_requests ar
         JOIN cargo c ON c.id = ar.cargo_id
         WHERE ar.status = 'Pending' AND c.is_deleted = FALSE ${warehouseCargo} ${approvalAssignment}) AS pending_approvals,
        (SELECT COUNT(*)::int FROM placement_validation_logs pvl
         LEFT JOIN cargo c ON c.id = pvl.cargo_id
         WHERE pvl.approved = FALSE ${warehouseCargo}) AS rejected_placements,
        (SELECT COUNT(*)::int FROM cargo c
         WHERE c.is_deleted = FALSE
           AND c.placement_status IN ('Placed', 'Relocated')
           AND DATE(c.updated_at) = CURRENT_DATE ${warehouseCargo}) AS stored_today,
        (SELECT COUNT(*)::int FROM bins WHERE status IN ('Blocked', 'Reserved')) AS blocked_reserved_bins,
        (SELECT COALESCE(ROUND(
          (SUM(current_volume) / NULLIF(SUM(max_volume), 0)) * 100, 2
        ), 0) FROM bins WHERE active = TRUE) AS occupancy_percent,
        (SELECT COUNT(DISTINCT us.user_id)::int
         FROM user_sessions us
         JOIN users u ON u.id = us.user_id
         JOIN roles r ON r.id = u.role_id
         WHERE us.session_status = 'active'
           AND r.role_name = $1
           ${warehouseUsers}) AS active_staff`,
      values
    );

    res.json({
      success: true,
      data: {
        metrics: metrics.rows[0]
      }
    });
  } catch (error) {
    next(error);
  }
};

const getApprovals = async (req, res, next) => {
  try {
    const warehouseId = getSupervisorWarehouseScope(req);

    if (shouldRepairPendingRegistrationApprovals(req)) {
      await ensurePendingRegistrationApprovals(db, warehouseId);
    }

    const values = [];
    const clauses = ["c.is_deleted = FALSE"];

    if (req.query.status) {
      values.push(req.query.status);
      clauses.push(`ar.status = $${values.length}`);
    }
    if (req.query.request_type) {
      values.push(req.query.request_type);
      clauses.push(`ar.request_type = $${values.length}`);
    }
    if (warehouseId) {
      values.push(warehouseId);
      clauses.push(`c.warehouse_id = $${values.length}`);
    }
    if (req.auth?.role === "warehouse-supervisor" && req.query.status === "Pending") {
      values.push(req.auth.userId);
      clauses.push(`(${APPROVAL_ASSIGNEE_SQL} IS NULL OR ${APPROVAL_ASSIGNEE_SQL} = $${values.length})`);
    }

    const result = await db.query(
      `${approvalSelect}
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY CASE WHEN ar.status = 'Pending' THEN 0 ELSE 1 END,
                ar.created_at DESC, ar.id DESC`,
      values
    );
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

const getApproval = async (req, res, next) => {
  try {
    const result = await db.query(
      `${approvalSelect}
       WHERE ar.id = $1
         AND c.is_deleted = FALSE
       LIMIT 1`,
      [req.params.id]
    );
    if (result.rowCount === 0) throw buildError("Approval request not found.", 404);
    assertApprovalAccess(req, result.rows[0]);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

const decideApproval = async (req, res, next, decision) => {
  const client = await db.pool.connect();

  try {
    const notes = String(req.body.decision_notes || "").trim();
    await client.query("BEGIN");

    const approvalResult = await client.query(
      `SELECT ar.*, ar.cargo_id AS cargo_record_id, c.cargo_id,
              c.registration_status, c.placement_status, c.warehouse_id,
              COALESCE(ar.assigned_to, ar.assigned_supervisor_id) AS assigned_to
       FROM approval_requests ar
       JOIN cargo c ON c.id = ar.cargo_id
       WHERE ar.id = $1
         AND c.is_deleted = FALSE
       FOR UPDATE OF ar, c`,
      [req.params.id]
    );
    if (approvalResult.rowCount === 0) throw buildError("Approval request not found.", 404);

    const approval = approvalResult.rows[0];
    assertApprovalAccess(req, approval);
    if (approval.status !== "Pending") {
      throw buildError(`Approval request has already been ${approval.status.toLowerCase()}.`, 409);
    }

    const isRegistrationApproval = approval.request_type === "CARGO_REGISTRATION";
    const rejectionCode = String(req.body.rejection_code || "").trim();
    const rejectionCondition = getRejectionReason(rejectionCode);
    const rejectionDetails = String(req.body.rejection_reason || "").trim();
    const correctiveNotes = String(req.body.corrective_notes || "").trim();
    if (
      isRegistrationApproval
      && decision === "Rejected"
      && (!rejectionCondition || !rejectionDetails)
    ) {
      throw buildError(
        `A valid rejection condition and rejection reason are required. Allowed conditions: ${Object.keys(REJECTION_REASONS).join(", ")}.`,
        400
      );
    }
    const rejectionReason = rejectionCondition
      ? `${rejectionCondition} ${rejectionDetails}`.trim()
      : null;

    await client.query(
      `UPDATE approval_requests
       SET status = $1,
           decision_notes = $2,
           assigned_to = COALESCE(assigned_to, $3),
           assigned_supervisor_id = COALESCE(assigned_supervisor_id, $3),
           decided_at = CURRENT_TIMESTAMP,
           decided_by = $3
       WHERE id = $4`,
      [decision, notes || null, req.auth?.userId || null, approval.id]
    );

    let auditAction;
    if (isRegistrationApproval) {
      const isAdminOverride = req.auth?.role === "system-admin";
      auditAction = decision === "Approved"
        ? isAdminOverride ? "ADMIN_FORCE_APPROVE_CARGO" : "SUPERVISOR_APPROVE_CARGO"
        : isAdminOverride ? "ADMIN_FORCE_REJECT_CARGO" : "SUPERVISOR_REJECT_CARGO";

      if (decision === "Approved") {
        await updateCargoRegistrationStatus(
          client,
          approval.cargo_record_id,
          REGISTRATION_STATUS.APPROVED,
          {
            approved_by: req.auth?.userId || null,
            approved_at: new Date(),
            rejected_by: null,
            rejected_at: null,
            rejection_reason: null,
            corrective_notes: null,
            correction_notes: null,
            correction_fields: []
          }
        );
      } else {
        const rejectedCargoResult = await client.query(
          "SELECT * FROM cargo WHERE id = $1",
          [approval.cargo_record_id]
        );
        const rejectionOriginalValues = captureCorrectionValues(
          rejectedCargoResult.rows[0],
          Object.keys(CORRECTION_FIELDS)
        );
        await updateCargoRegistrationStatus(
          client,
          approval.cargo_record_id,
          REGISTRATION_STATUS.REJECTED,
          {
            rejected_by: req.auth?.userId || null,
            rejected_at: new Date(),
            rejection_reason: rejectionReason,
            corrective_notes: correctiveNotes || rejectionReason,
            correction_notes: correctiveNotes || rejectionReason,
            correction_fields: [],
            correction_original_values: rejectionOriginalValues,
            correction_last_changes: {}
          }
        );
        await client.query(
          `UPDATE approval_requests
           SET request_data = COALESCE(request_data, '{}'::jsonb) || jsonb_build_object(
             'rejection_original_values', $1::jsonb
           )
           WHERE id = $2`,
          [JSON.stringify(rejectionOriginalValues), approval.id]
        );
      }

      await client.query(
        `INSERT INTO cargo_approval_history
         (cargo_id, action, remarks, metadata, performed_by, warehouse_id_at_action)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          approval.cargo_record_id,
          decision === "Approved" ? "REGISTRATION_APPROVED" : "REGISTRATION_REJECTED",
          decision === "Approved"
            ? notes || "Cargo registration approved. Placement status was left unchanged."
            : `${rejectionReason}${correctiveNotes ? `\n${correctiveNotes}` : ""}`,
          JSON.stringify(decision === "Rejected"
            ? {
                rejection_code: rejectionCode,
                registration_can_be_revised: true
              }
            : {}),
          req.auth?.userId || null,
          req.auth?.warehouseId || approval.warehouse_id || null
        ]
      );
    } else if (approval.request_type === "PLACEMENT_OVERRIDE") {
      auditAction = decision === "Approved"
        ? "APPROVE_PLACEMENT_OVERRIDE"
        : "REJECT_PLACEMENT_OVERRIDE";
    } else if (["DAMAGED_CARGO_RECEIVING", "HAZARDOUS_CARGO_PLACEMENT"].includes(approval.request_type)) {
      auditAction = decision === "Approved"
        ? "SUPERVISOR_APPROVE_CARGO"
        : "SUPERVISOR_REJECT_CARGO";

      if (decision === "Rejected") {
        await updateCargoRegistrationStatus(
          client,
          approval.cargo_record_id,
          REGISTRATION_STATUS.REJECTED
        );
      }
    } else {
      auditAction = decision === "Approved" ? "SUPERVISOR_APPROVE_CARGO" : "SUPERVISOR_REJECT_CARGO";
    }

    if (!isRegistrationApproval) {
      await client.query(
        `INSERT INTO cargo_approval_history
         (cargo_id, action, remarks, metadata, performed_by, warehouse_id_at_action)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          approval.cargo_record_id,
          `${approval.request_type}_${decision.toUpperCase()}`,
          notes || `${decision} ${approval.request_type} request.`,
          JSON.stringify({ approval_request_id: approval.id }),
          req.auth?.userId || null,
          req.auth?.warehouseId || approval.warehouse_id || null
        ]
      );
    }

    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action: auditAction,
        module: "Supervisor Operations",
        description: `${decision} ${approval.request_type} request for cargo ${approval.cargo_id}.`,
        metadata: {
          approval_request_id: approval.id,
          cargo_id: approval.cargo_record_id,
          warehouse_id: approval.warehouse_id,
          decision_notes: notes || null,
          rejection_code: rejectionCode || null
        }
      },
      client
    );

    const result = await client.query(
      `${approvalSelect}
       WHERE ar.id = $1`,
      [approval.id]
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

const approveApproval = (req, res, next) => decideApproval(req, res, next, "Approved");
const rejectApproval = (req, res, next) => decideApproval(req, res, next, "Rejected");

const requestCorrection = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const notes = String(req.body.correction_notes || "").trim();
    const correctionFields = normalizeCorrectionFields(req.body.correction_fields);
    if (!notes) throw buildError("Correction notes are required.", 400);
    if (correctionFields.length === 0) {
      throw buildError("Select at least one registration field that requires correction.", 400);
    }

    await client.query("BEGIN");
    const approvalResult = await client.query(
      `SELECT ar.id AS approval_id,
              ar.request_type,
              ar.status AS approval_status,
              COALESCE(ar.assigned_to, ar.assigned_supervisor_id) AS assigned_to,
              ar.cargo_id AS cargo_record_id,
              c.*
       FROM approval_requests ar
       JOIN cargo c ON c.id = ar.cargo_id
       WHERE ar.id = $1
         AND c.is_deleted = FALSE
       FOR UPDATE OF ar, c`,
      [req.params.id]
    );
    if (approvalResult.rowCount === 0) throw buildError("Approval request not found.", 404);

    const approval = approvalResult.rows[0];
    assertApprovalAccess(req, approval);
    if (approval.request_type !== "CARGO_REGISTRATION") {
      throw buildError("Corrections can only be requested for cargo registration approvals.", 400);
    }
    if (approval.approval_status !== "Pending") {
      throw buildError(`Approval request has already been ${approval.approval_status.toLowerCase()}.`, 409);
    }
    const originalValues = captureCorrectionValues(approval, correctionFields);

    await client.query(
      `UPDATE approval_requests
       SET status = 'Correction Required',
           decision_notes = $1,
           assigned_to = COALESCE(assigned_to, $2),
           assigned_supervisor_id = COALESCE(assigned_supervisor_id, $2),
           decided_at = CURRENT_TIMESTAMP,
           decided_by = $2,
           request_data = COALESCE(request_data, '{}'::jsonb) || jsonb_build_object(
             'correction_fields', $3::jsonb,
             'correction_original_values', $4::jsonb
           )
       WHERE id = $5`,
      [
        notes,
        req.auth?.userId || null,
        JSON.stringify(correctionFields),
        JSON.stringify(originalValues),
        approval.approval_id
      ]
    );
    await updateCargoRegistrationStatus(
      client,
      approval.cargo_record_id,
      REGISTRATION_STATUS.CORRECTION_REQUIRED,
      {
        correction_requested_by: req.auth?.userId || null,
        correction_requested_at: new Date(),
        correction_notes: notes,
        correction_fields: correctionFields,
        correction_original_values: originalValues,
        correction_last_changes: {},
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null
      }
    );
    await client.query(
      `INSERT INTO cargo_approval_history
       (cargo_id, action, remarks, metadata, performed_by, warehouse_id_at_action)
       VALUES ($1, 'CORRECTION_REQUESTED', $2, $3, $4, $5)`,
      [
        approval.cargo_record_id,
        notes,
        JSON.stringify({
          correction_fields: correctionFields,
          correction_field_labels: correctionFields.map((field) => CORRECTION_FIELDS[field]),
          original_values: originalValues
        }),
        req.auth?.userId || null,
        req.auth?.warehouseId || approval.warehouse_id || null
      ]
    );
    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action: "REQUEST_CARGO_CORRECTION",
        module: "Supervisor Operations",
        description: `Requested registration correction for cargo ${approval.cargo_id}.`,
        metadata: {
          approval_request_id: approval.approval_id,
          cargo_id: approval.cargo_record_id,
          warehouse_id: approval.warehouse_id,
          correction_notes: notes,
          correction_fields: correctionFields
        }
      },
      client
    );

    const result = await client.query(
      `${approvalSelect} WHERE ar.id = $1`,
      [approval.approval_id]
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

const getMyReviewHistory = async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT
         cah.*,
         c.cargo_id,
         c.barcode AS cargo_barcode,
         c.cargo_type,
         c.consignee_name,
         c.registration_status,
         c.placement_status,
         COALESCE(action_warehouse.warehouse_name, current_warehouse.warehouse_name) AS warehouse_name,
         COALESCE(action_warehouse.warehouse_code, current_warehouse.warehouse_code) AS warehouse_code
       FROM cargo_approval_history cah
       JOIN cargo c ON c.id = cah.cargo_id
       LEFT JOIN warehouses action_warehouse ON action_warehouse.id = cah.warehouse_id_at_action
       LEFT JOIN warehouses current_warehouse ON current_warehouse.id = c.warehouse_id
       WHERE cah.performed_by = $1
         AND c.is_deleted = FALSE
       ORDER BY COALESCE(cah.created_at, cah.performed_at) DESC, cah.id DESC
       LIMIT 200`,
      [req.auth?.userId || 0]
    );

    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

const getStaffActivity = async (req, res, next) => {
  try {
    const values = [roleNames.warehouseStaff];
    let warehouseFilter = "";
    if (req.auth?.warehouseId) {
      values.push(req.auth.warehouseId);
      warehouseFilter = `AND u.warehouse_id = $${values.length}`;
    }
    const result = await db.query(
      `SELECT al.*, u.full_name, u.username, w.warehouse_name, w.warehouse_code
       FROM audit_logs al
       JOIN users u ON u.id = al.user_id
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN warehouses w ON w.id = u.warehouse_id
       WHERE r.role_name = $1
         ${warehouseFilter}
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT 200`,
      values
    );
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

const getPlacementMonitoring = async (req, res, next) => {
  try {
    const values = [];
    let warehouseFilter = "";
    if (req.auth?.warehouseId) {
      values.push(req.auth.warehouseId);
      warehouseFilter = `WHERE c.warehouse_id = $${values.length}`;
    }
    const result = await db.query(
      `SELECT pvl.*, c.cargo_id AS cargo_identifier, b.barcode AS bin_identifier
       FROM placement_validation_logs pvl
       LEFT JOIN cargo c ON c.id = pvl.cargo_id
       LEFT JOIN bins b ON b.id = pvl.bin_id
       ${warehouseFilter}
       ORDER BY pvl.created_at DESC, pvl.id DESC
       LIMIT 200`,
      values
    );
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

const getPlacementSummary = async (req, res, next) => {
  try {
    const values = [];
    const warehouseFilter = req.auth?.warehouseId
      ? `AND c.warehouse_id = $${values.push(req.auth.warehouseId)}`
      : "";

    const result = await db.query(
      `SELECT
        COUNT(*) FILTER (
          WHERE pvl.approved = TRUE
            AND pvl.attempt_stage = 'confirmation'
            AND DATE(pvl.created_at) = CURRENT_DATE
        )::int AS successful_placements_today,
        COUNT(*) FILTER (
          WHERE pvl.approved = FALSE
            AND DATE(pvl.created_at) = CURRENT_DATE
        )::int AS rejected_placements_today,
        COUNT(*) FILTER (
          WHERE pvl.attempt_stage = 'validation'
            AND DATE(pvl.created_at) = CURRENT_DATE
        )::int AS validation_attempts_today,
        COUNT(DISTINCT c.id) FILTER (
          WHERE c.placement_status IN ('Placed', 'Relocated')
            AND DATE(c.updated_at) = CURRENT_DATE
        )::int AS stored_cargo_today,
        (
          SELECT COUNT(*)::int
          FROM approval_requests ar
          JOIN cargo approval_cargo ON approval_cargo.id = ar.cargo_id
          WHERE ar.status = 'Pending'
            AND ar.request_type = 'PLACEMENT_OVERRIDE'
            ${req.auth?.warehouseId ? `AND approval_cargo.warehouse_id = $1` : ""}
        ) AS pending_placement_approvals
       FROM placement_validation_logs pvl
       LEFT JOIN cargo c ON c.id = pvl.cargo_id
       WHERE TRUE ${warehouseFilter}`,
      values
    );

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  approveApproval,
  getApproval,
  getApprovals,
  getMyReviewHistory,
  getPlacementMonitoring,
  getPlacementSummary,
  getReviewConfiguration,
  getStaffActivity,
  getSupervisorDashboard,
  requestCorrection,
  rejectApproval
};

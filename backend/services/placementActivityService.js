const db = require("../config/db");
const { roleNames } = require("../config/systemConfig");

const STAFF_OWNER_SQL = "COALESCE(c.assigned_staff_id, c.created_by, c.received_by_user_id)";
const STAFF_ROLE_NAME = roleNames.warehouseStaff;

const ACTIVITY_TYPES = Object.freeze({
  PLACEMENT_QUEUE_ENTERED: "PLACEMENT_QUEUE_ENTERED",
  PLACEMENT_VALIDATED: "PLACEMENT_VALIDATED",
  PLACEMENT_VALIDATION_FAILED: "PLACEMENT_VALIDATION_FAILED",
  PLACEMENT_CONFIRMATION_FAILED: "PLACEMENT_CONFIRMATION_FAILED",
  PLACEMENT_CONFIRMED: "PLACEMENT_CONFIRMED",
  CARGO_RELOCATED: "CARGO_RELOCATED",
  PLACEMENT_OVERRIDE_REQUESTED: "PLACEMENT_OVERRIDE_REQUESTED",
  PLACEMENT_OVERRIDE_APPROVED: "PLACEMENT_OVERRIDE_APPROVED",
  PLACEMENT_OVERRIDE_REJECTED: "PLACEMENT_OVERRIDE_REJECTED",
  MANUAL_PLACEMENT_SETTING_CHANGED: "MANUAL_PLACEMENT_SETTING_CHANGED",
  LOCATION_REVALIDATED: "LOCATION_REVALIDATED",
  LOCATION_REVALIDATION_FAILED: "LOCATION_REVALIDATION_FAILED",
  CARGO_UNALLOCATED_EXCEPTION: "CARGO_UNALLOCATED_EXCEPTION",
  CARGO_UNALLOCATED_RESOLVED: "CARGO_UNALLOCATED_RESOLVED",
  SCANNER_SESSION_STARTED: "SCANNER_SESSION_STARTED",
  SCANNER_SESSION_COMPLETED: "SCANNER_SESSION_COMPLETED",
  SCANNER_SESSION_CANCELLED: "SCANNER_SESSION_CANCELLED"
});

const asPositiveInteger = (value, fallback, max = 500) => {
  const next = Number(value);
  if (!Number.isInteger(next) || next <= 0) return fallback;
  return Math.min(next, max);
};

const getPaging = (filters = {}) => {
  const limit = asPositiveInteger(filters.limit, 100, 500);
  const page = asPositiveInteger(filters.page, 1, 100000);
  return {
    limit,
    page,
    offset: (page - 1) * limit
  };
};

const addParam = (values, value) => {
  values.push(value);
  return `$${values.length}`;
};

const addDateFilters = (clauses, values, column, filters = {}) => {
  if (filters.from_date || filters.date_from) {
    clauses.push(`${column} >= ${addParam(values, filters.from_date || filters.date_from)}::date`);
  }
  if (filters.to_date || filters.date_to) {
    clauses.push(`${column} < (${addParam(values, filters.to_date || filters.date_to)}::date + INTERVAL '1 day')`);
  }
};

const addWarehouseFilter = (clauses, values, column, filters = {}) => {
  if (filters.warehouse_id) {
    clauses.push(`${column} = ${addParam(values, Number(filters.warehouse_id))}`);
  }
};

const addStaffFilter = (clauses, values, column, filters = {}) => {
  if (filters.staff_id || filters.performed_by) {
    clauses.push(`${column} = ${addParam(values, Number(filters.staff_id || filters.performed_by))}`);
  }
};

const addCargoSearchFilter = (clauses, values, filters = {}) => {
  const search = String(filters.cargo_id || filters.cargo_barcode || filters.search || "").trim();
  if (!search) return;
  const placeholder = addParam(values, `%${search}%`);
  clauses.push(`(
    c.id::text = ${placeholder}
    OR c.cargo_id ILIKE ${placeholder}
    OR c.barcode ILIKE ${placeholder}
  )`);
};

const addCargoIdentifierFilter = (clauses, values, identifier) => {
  if (!identifier) return;
  const placeholder = addParam(values, String(identifier));
  clauses.push(`(
    c.id::text = ${placeholder}
    OR c.cargo_id = ${placeholder}
    OR c.barcode = ${placeholder}
  )`);
};

const addRoleScope = ({
  clauses,
  values,
  auth = {},
  warehouseColumn,
  actorColumn,
  actorRoleColumn,
  requestedByColumn = null,
  cargoRequired = false
}) => {
  if (auth.role === "system-admin") return;

  if (auth.role === "warehouse-supervisor") {
    clauses.push(`${warehouseColumn} = ${addParam(values, auth.warehouseId || 0)}`);
    return;
  }

  if (auth.role === "warehouse-staff") {
    const userPlaceholder = addParam(values, auth.userId || 0);
    const actorGate = actorColumn ? `${actorColumn} = ${userPlaceholder}` : "FALSE";
    const requesterGate = requestedByColumn ? `${requestedByColumn} = ${userPlaceholder}` : "FALSE";
    const ownershipGate = cargoRequired
      ? `${STAFF_OWNER_SQL} = ${userPlaceholder}`
      : `(c.id IS NOT NULL AND ${STAFF_OWNER_SQL} = ${userPlaceholder})`;

    clauses.push(`(${ownershipGate} OR ${actorGate} OR ${requesterGate})`);

    if (actorColumn && actorRoleColumn) {
      clauses.push(`NOT (
        ${actorColumn} IS NOT NULL
        AND ${actorColumn} <> ${userPlaceholder}
        AND ${actorRoleColumn} = '${STAFF_ROLE_NAME}'
      )`);
    }

    if (requestedByColumn) {
      clauses.push(`NOT (
        ${requestedByColumn} IS NOT NULL
        AND ${requestedByColumn} <> ${userPlaceholder}
        AND requester_role.role_name = '${STAFF_ROLE_NAME}'
      )`);
    }
  }
};

const baseSelect = `
  c.id AS cargo_record_id,
  c.cargo_id AS cargo_identifier,
  c.barcode AS cargo_barcode,
  c.cargo_type,
  c.consignee_name,
  c.assigned_staff_id,
  c.created_by,
  c.received_by_user_id,
  c.warehouse_id AS cargo_warehouse_id,
  w.warehouse_name,
  w.warehouse_code
`;

const movementRows = async ({ auth, filters, cargoIdentifier, executor }) => {
  const values = [];
  const clauses = ["c.is_deleted = FALSE"];
  addDateFilters(clauses, values, "cm.created_at", filters);
  addWarehouseFilter(clauses, values, "COALESCE(cm.warehouse_id_at_action, c.warehouse_id)", filters);
  addStaffFilter(clauses, values, "cm.moved_by_user_id", filters);
  addCargoSearchFilter(clauses, values, filters);
  addCargoIdentifierFilter(clauses, values, cargoIdentifier);
  addRoleScope({
    clauses,
    values,
    auth,
    warehouseColumn: "COALESCE(cm.warehouse_id_at_action, c.warehouse_id)",
    actorColumn: "cm.moved_by_user_id",
    actorRoleColumn: "actor_role.role_name",
    cargoRequired: true
  });

  const result = await executor.query(
    `SELECT
       ('movement:' || cm.id) AS activity_id,
       'cargo_movements' AS source_table,
       cm.id AS source_id,
       CASE
         WHEN cm.action = 'Registration Submitted' OR cm.movement_type = 'Registration Submitted'
           THEN '${ACTIVITY_TYPES.PLACEMENT_QUEUE_ENTERED}'
         WHEN cm.action = 'Relocated' OR cm.movement_type = 'Relocated'
           THEN '${ACTIVITY_TYPES.CARGO_RELOCATED}'
         ELSE '${ACTIVITY_TYPES.PLACEMENT_CONFIRMED}'
       END AS activity_type,
       cm.created_at AS activity_timestamp,
       cm.moved_by_user_id AS performed_by,
       actor.full_name AS performed_by_name,
       actor.username AS performed_by_username,
       actor_role.role_name AS performed_by_role_name,
       COALESCE(cm.warehouse_id_at_action, c.warehouse_id) AS warehouse_id,
       cm.from_bin_id,
       cm.to_bin_id,
       cm.from_location,
       cm.to_location,
       NULL::text AS placement_mode,
       'success' AS result,
       cm.action AS reason,
       cm.movement_type AS detail,
       jsonb_strip_nulls(jsonb_build_object(
         'moved_by', cm.moved_by,
         'movement_type', cm.movement_type,
         'released_at', release_location.released_at
       )) AS metadata,
       ${baseSelect}
     FROM cargo_movements cm
     JOIN cargo c ON c.id = cm.cargo_id
     LEFT JOIN users actor ON actor.id = cm.moved_by_user_id
     LEFT JOIN roles actor_role ON actor_role.id = actor.role_id
     LEFT JOIN warehouses w ON w.id = COALESCE(cm.warehouse_id_at_action, c.warehouse_id)
     LEFT JOIN LATERAL (
       SELECT cl.released_at
       FROM cargo_locations cl
       WHERE cl.cargo_id = cm.cargo_id
         AND cl.bin_id = cm.from_bin_id
         AND cl.released_at IS NOT NULL
       ORDER BY cl.released_at DESC
       LIMIT 1
     ) release_location ON TRUE
     WHERE ${clauses.join(" AND ")}
     ORDER BY cm.created_at DESC, cm.id DESC`,
    values
  );
  return result.rows;
};

const validationRows = async ({ auth, filters, cargoIdentifier, executor }) => {
  const values = [];
  const clauses = [];
  addDateFilters(clauses, values, "pvl.created_at", filters);
  addWarehouseFilter(clauses, values, "COALESCE(pvl.warehouse_id_at_action, c.warehouse_id)", filters);
  addStaffFilter(clauses, values, "COALESCE(pvl.performed_by, pvl.user_id)", filters);
  addCargoSearchFilter(clauses, values, filters);
  addCargoIdentifierFilter(clauses, values, cargoIdentifier);

  if (filters.placement_mode) {
    clauses.push(`pvl.placement_mode = ${addParam(values, filters.placement_mode)}`);
  }
  if (filters.result) {
    const resultValue = String(filters.result).toLowerCase();
    if (["success", "passed", "approved"].includes(resultValue)) {
      clauses.push("pvl.approved = TRUE");
    } else if (["failed", "rejected", "failure"].includes(resultValue)) {
      clauses.push("pvl.approved = FALSE");
    }
  }

  addRoleScope({
    clauses,
    values,
    auth,
    warehouseColumn: "COALESCE(pvl.warehouse_id_at_action, c.warehouse_id)",
    actorColumn: "COALESCE(pvl.performed_by, pvl.user_id)",
    actorRoleColumn: "actor_role.role_name"
  });

  if (auth.role !== "system-admin") {
    clauses.push("(c.id IS NULL OR c.is_deleted = FALSE)");
  }

  const result = await executor.query(
    `SELECT
       ('validation:' || pvl.id) AS activity_id,
       'placement_validation_logs' AS source_table,
       pvl.id AS source_id,
       CASE
         WHEN pvl.approved = TRUE
           THEN '${ACTIVITY_TYPES.PLACEMENT_VALIDATED}'
         WHEN pvl.attempt_stage = 'confirmation'
           THEN '${ACTIVITY_TYPES.PLACEMENT_CONFIRMATION_FAILED}'
         ELSE '${ACTIVITY_TYPES.PLACEMENT_VALIDATION_FAILED}'
       END AS activity_type,
       pvl.created_at AS activity_timestamp,
       COALESCE(pvl.performed_by, pvl.user_id) AS performed_by,
       actor.full_name AS performed_by_name,
       actor.username AS performed_by_username,
       actor_role.role_name AS performed_by_role_name,
       COALESCE(pvl.warehouse_id_at_action, c.warehouse_id) AS warehouse_id,
       NULL::integer AS from_bin_id,
       pvl.bin_id AS to_bin_id,
       pvl.previous_location AS from_location,
       pvl.new_location AS to_location,
       pvl.placement_mode,
       CASE WHEN pvl.approved THEN 'success' ELSE 'failed' END AS result,
       pvl.reason,
       pvl.detail,
       jsonb_strip_nulls(jsonb_build_object(
         'checks', pvl.checks,
         'manual_reason', pvl.manual_reason,
         'attempt_stage', pvl.attempt_stage,
         'cargo_barcode', pvl.cargo_barcode,
         'bin_barcode', pvl.bin_barcode
       )) AS metadata,
       ${baseSelect}
     FROM placement_validation_logs pvl
     LEFT JOIN cargo c ON c.id = pvl.cargo_id
     LEFT JOIN users actor ON actor.id = COALESCE(pvl.performed_by, pvl.user_id)
     LEFT JOIN roles actor_role ON actor_role.id = actor.role_id
     LEFT JOIN warehouses w ON w.id = COALESCE(pvl.warehouse_id_at_action, c.warehouse_id)
     WHERE ${clauses.length ? clauses.join(" AND ") : "TRUE"}
     ORDER BY pvl.created_at DESC, pvl.id DESC`,
    values
  );
  return result.rows;
};

const overrideRequestRows = async ({ auth, filters, cargoIdentifier, executor }) => {
  const values = [];
  const clauses = ["ar.request_type = 'PLACEMENT_OVERRIDE'", "c.is_deleted = FALSE"];
  addDateFilters(clauses, values, "ar.created_at", filters);
  addWarehouseFilter(clauses, values, "COALESCE(ar.warehouse_id_at_request, c.warehouse_id)", filters);
  addStaffFilter(clauses, values, "ar.requested_by", filters);
  addCargoSearchFilter(clauses, values, filters);
  addCargoIdentifierFilter(clauses, values, cargoIdentifier);
  addRoleScope({
    clauses,
    values,
    auth,
    warehouseColumn: "COALESCE(ar.warehouse_id_at_request, c.warehouse_id)",
    actorColumn: "ar.requested_by",
    actorRoleColumn: "requester_role.role_name",
    requestedByColumn: "ar.requested_by",
    cargoRequired: true
  });

  const result = await executor.query(
    `SELECT
       ('override-request:' || ar.id) AS activity_id,
       'approval_requests' AS source_table,
       ar.id AS source_id,
       '${ACTIVITY_TYPES.PLACEMENT_OVERRIDE_REQUESTED}' AS activity_type,
       ar.created_at AS activity_timestamp,
       ar.requested_by AS performed_by,
       requester.full_name AS performed_by_name,
       requester.username AS performed_by_username,
       requester_role.role_name AS performed_by_role_name,
       COALESCE(ar.warehouse_id_at_request, c.warehouse_id) AS warehouse_id,
       NULL::integer AS from_bin_id,
       NULLIF(ar.request_data->>'bin_id', '')::integer AS to_bin_id,
       NULL::text AS from_location,
       ar.request_data->>'bin_barcode' AS to_location,
       ar.request_data->>'placement_mode' AS placement_mode,
       'pending' AS result,
       'Placement Override Requested' AS reason,
       ar.reason AS detail,
       jsonb_strip_nulls(jsonb_build_object(
         'approval_request_id', ar.id,
         'status', ar.status,
         'requested_by', ar.requested_by,
         'manual_reason', ar.request_data->>'manual_reason',
         'validation_reason', ar.request_data->>'validation_reason',
         'validation_detail', ar.request_data->>'validation_detail',
         'checks', ar.request_data->'checks'
       )) AS metadata,
       ${baseSelect}
     FROM approval_requests ar
     JOIN cargo c ON c.id = ar.cargo_id
     LEFT JOIN users requester ON requester.id = ar.requested_by
     LEFT JOIN roles requester_role ON requester_role.id = requester.role_id
     LEFT JOIN warehouses w ON w.id = COALESCE(ar.warehouse_id_at_request, c.warehouse_id)
     WHERE ${clauses.join(" AND ")}
     ORDER BY ar.created_at DESC, ar.id DESC`,
    values
  );
  return result.rows;
};

const overrideDecisionRows = async ({ auth, filters, cargoIdentifier, executor }) => {
  const values = [];
  const clauses = [
    "ar.request_type = 'PLACEMENT_OVERRIDE'",
    "ar.status IN ('Approved', 'Rejected')",
    "ar.decided_at IS NOT NULL",
    "c.is_deleted = FALSE"
  ];
  addDateFilters(clauses, values, "ar.decided_at", filters);
  addWarehouseFilter(clauses, values, "COALESCE(ar.warehouse_id_at_request, c.warehouse_id)", filters);
  addStaffFilter(clauses, values, "ar.decided_by", filters);
  addCargoSearchFilter(clauses, values, filters);
  addCargoIdentifierFilter(clauses, values, cargoIdentifier);
  addRoleScope({
    clauses,
    values,
    auth,
    warehouseColumn: "COALESCE(ar.warehouse_id_at_request, c.warehouse_id)",
    actorColumn: "ar.decided_by",
    actorRoleColumn: "decider_role.role_name",
    requestedByColumn: "ar.requested_by",
    cargoRequired: true
  });

  const result = await executor.query(
    `SELECT
       ('override-decision:' || ar.id) AS activity_id,
       'approval_requests' AS source_table,
       ar.id AS source_id,
       CASE
         WHEN ar.status = 'Approved' THEN '${ACTIVITY_TYPES.PLACEMENT_OVERRIDE_APPROVED}'
         ELSE '${ACTIVITY_TYPES.PLACEMENT_OVERRIDE_REJECTED}'
       END AS activity_type,
       ar.decided_at AS activity_timestamp,
       ar.decided_by AS performed_by,
       decider.full_name AS performed_by_name,
       decider.username AS performed_by_username,
       decider_role.role_name AS performed_by_role_name,
       COALESCE(ar.warehouse_id_at_request, c.warehouse_id) AS warehouse_id,
       NULL::integer AS from_bin_id,
       NULLIF(ar.request_data->>'bin_id', '')::integer AS to_bin_id,
       NULL::text AS from_location,
       ar.request_data->>'bin_barcode' AS to_location,
       ar.request_data->>'placement_mode' AS placement_mode,
       CASE WHEN ar.status = 'Approved' THEN 'success' ELSE 'failed' END AS result,
       ('Placement Override ' || ar.status) AS reason,
       COALESCE(ar.decision_notes, ar.reason) AS detail,
       jsonb_strip_nulls(jsonb_build_object(
         'approval_request_id', ar.id,
         'status', ar.status,
         'requested_by', ar.requested_by,
         'manual_reason', ar.request_data->>'manual_reason',
         'validation_reason', ar.request_data->>'validation_reason',
         'validation_detail', ar.request_data->>'validation_detail',
         'checks', ar.request_data->'checks'
       )) AS metadata,
       ${baseSelect}
     FROM approval_requests ar
     JOIN cargo c ON c.id = ar.cargo_id
     LEFT JOIN users decider ON decider.id = ar.decided_by
     LEFT JOIN roles decider_role ON decider_role.id = decider.role_id
     LEFT JOIN users requester ON requester.id = ar.requested_by
     LEFT JOIN roles requester_role ON requester_role.id = requester.role_id
     LEFT JOIN warehouses w ON w.id = COALESCE(ar.warehouse_id_at_request, c.warehouse_id)
     WHERE ${clauses.join(" AND ")}
     ORDER BY ar.decided_at DESC, ar.id DESC`,
    values
  );
  return result.rows;
};

const auditSupportRows = async ({ auth, filters, cargoIdentifier, executor }) => {
  const values = [];
  const clauses = [
    `(
      al.action = 'UPDATE_MANUAL_PLACEMENT_SETTING'
      OR al.action IN ('CARGO_UNALLOCATED_EXCEPTION', 'RESOLVE_CARGO_UNALLOCATED_EXCEPTION',
                       'SCAN_SESSION_STARTED', 'SCAN_SESSION_COMPLETED', 'SCAN_SESSION_CANCELLED')
      OR (
        al.action IN ('STAFF_CORRECT_CARGO_REGISTRATION', 'UPDATE_CARGO')
        AND al.metadata->>'location_revalidated' = 'true'
      )
    )`
  ];
  addDateFilters(clauses, values, "al.created_at", filters);
  addWarehouseFilter(clauses, values, "COALESCE(al.warehouse_id_at_action, c.warehouse_id)", filters);
  addStaffFilter(clauses, values, "al.user_id", filters);
  addCargoSearchFilter(clauses, values, filters);
  addCargoIdentifierFilter(clauses, values, cargoIdentifier);
  addRoleScope({
    clauses,
    values,
    auth,
    warehouseColumn: "COALESCE(al.warehouse_id_at_action, c.warehouse_id)",
    actorColumn: "al.user_id",
    actorRoleColumn: "actor_role.role_name"
  });

  const result = await executor.query(
    `SELECT
       ('audit:' || al.id) AS activity_id,
       'audit_logs' AS source_table,
       al.id AS source_id,
       CASE
         WHEN al.action = 'CARGO_UNALLOCATED_EXCEPTION'
           THEN '${ACTIVITY_TYPES.CARGO_UNALLOCATED_EXCEPTION}'
         WHEN al.action = 'RESOLVE_CARGO_UNALLOCATED_EXCEPTION'
           THEN '${ACTIVITY_TYPES.CARGO_UNALLOCATED_RESOLVED}'
         WHEN al.action = 'SCAN_SESSION_STARTED'
           THEN '${ACTIVITY_TYPES.SCANNER_SESSION_STARTED}'
         WHEN al.action = 'SCAN_SESSION_COMPLETED'
           THEN '${ACTIVITY_TYPES.SCANNER_SESSION_COMPLETED}'
         WHEN al.action = 'SCAN_SESSION_CANCELLED'
           THEN '${ACTIVITY_TYPES.SCANNER_SESSION_CANCELLED}'
         WHEN al.action = 'UPDATE_MANUAL_PLACEMENT_SETTING'
           THEN '${ACTIVITY_TYPES.MANUAL_PLACEMENT_SETTING_CHANGED}'
         WHEN al.metadata->>'relocation_required' = 'true'
           THEN '${ACTIVITY_TYPES.LOCATION_REVALIDATION_FAILED}'
         ELSE '${ACTIVITY_TYPES.LOCATION_REVALIDATED}'
       END AS activity_type,
       al.created_at AS activity_timestamp,
       al.user_id AS performed_by,
       al.target_user_id AS target_staff_id,
       actor.full_name AS performed_by_name,
       actor.username AS performed_by_username,
       actor_role.role_name AS performed_by_role_name,
       COALESCE(al.warehouse_id_at_action, c.warehouse_id) AS warehouse_id,
       NULL::integer AS from_bin_id,
       NULL::integer AS to_bin_id,
       al.metadata->>'previous_location' AS from_location,
       al.metadata->>'new_location' AS to_location,
       al.metadata->>'placement_mode' AS placement_mode,
       CASE
         WHEN al.action = 'CARGO_UNALLOCATED_EXCEPTION' OR al.metadata->>'relocation_required' = 'true' THEN 'failed'
         WHEN al.action = 'SCAN_SESSION_CANCELLED' THEN 'failed'
         ELSE 'success'
       END AS result,
       al.action AS reason,
       al.description AS detail,
       al.metadata,
       ${baseSelect}
     FROM audit_logs al
     LEFT JOIN scanner_sessions ss ON ss.id::text = al.metadata->>'scanner_session_id'
     LEFT JOIN cargo c ON c.id::text = COALESCE(al.metadata->>'cargo_id', ss.context->>'cargo_id')
     LEFT JOIN users actor ON actor.id = al.user_id
     LEFT JOIN roles actor_role ON actor_role.id = COALESCE(al.role_id_at_action, actor.role_id)
     LEFT JOIN warehouses w ON w.id = COALESCE(al.warehouse_id_at_action, c.warehouse_id)
     WHERE ${clauses.join(" AND ")}
     ORDER BY al.created_at DESC, al.id DESC`,
    values
  );
  return result.rows;
};

const normalizeRow = (row) => ({
  id: row.activity_id,
  source_table: row.source_table,
  source_id: row.source_id,
  activity_type: row.activity_type,
  timestamp: row.activity_timestamp,
  cargo_id: row.cargo_record_id,
  cargo_identifier: row.cargo_identifier,
  cargo_barcode: row.cargo_barcode,
  cargo_type: row.cargo_type,
  consignee_name: row.consignee_name,
  warehouse_id: row.warehouse_id,
  warehouse_name: row.warehouse_name,
  warehouse_code: row.warehouse_code,
  performed_by: row.performed_by,
  target_staff_id: row.target_staff_id,
  performed_by_name: row.performed_by_name,
  performed_by_username: row.performed_by_username,
  _performed_by_role_name: row.performed_by_role_name,
  assigned_staff_id: row.assigned_staff_id,
  created_by: row.created_by,
  received_by_user_id: row.received_by_user_id,
  from_bin_id: row.from_bin_id,
  to_bin_id: row.to_bin_id,
  from_location: row.from_location,
  to_location: row.to_location,
  placement_mode: row.placement_mode,
  result: row.result,
  reason: row.reason,
  detail: row.detail,
  metadata: row.metadata || {}
});

const applyPostFilters = (rows, filters = {}) => rows.filter((row) => {
  if (filters.activity_type && row.activity_type !== filters.activity_type) return false;
  if (filters.result) {
    const expected = String(filters.result).toLowerCase();
    const actual = String(row.result || "").toLowerCase();
    if (
      (["success", "passed", "approved"].includes(expected) && actual !== "success")
      || (["failed", "rejected", "failure"].includes(expected) && actual !== "failed")
      || (expected === "pending" && actual !== "pending")
    ) {
      return false;
    }
  }
  if (filters.placement_mode && row.placement_mode !== filters.placement_mode) return false;
  return true;
});

const staffOwnerId = (row) => row.assigned_staff_id || row.created_by || row.received_by_user_id || null;

const canViewActivity = (auth = {}, row) => {
  if (auth.role === "system-admin") return true;

  if (auth.role === "warehouse-supervisor") {
    return !auth.warehouseId || Number(row.warehouse_id) === Number(auth.warehouseId);
  }

  if (auth.role !== "warehouse-staff") return false;

  const userId = Number(auth.userId || 0);
  const ownerId = Number(staffOwnerId(row) || 0);
  const actorId = Number(row.performed_by || 0);
  const requestedBy = Number(row.metadata?.requested_by || 0);
  const targetStaffId = Number(row.target_staff_id || 0);

  const hasOwnershipGate = ownerId > 0 && ownerId === userId;
  const hasActorGate = actorId > 0 && actorId === userId;
  const hasRequesterGate = requestedBy > 0 && requestedBy === userId;

  if (!(hasOwnershipGate || hasActorGate || hasRequesterGate || targetStaffId === userId)) return false;

  if (
    row._performed_by_role_name === STAFF_ROLE_NAME
    && actorId > 0
    && actorId !== userId
  ) {
    return false;
  }

  if (
    row.source_table === "approval_requests"
    && requestedBy > 0
    && requestedBy !== userId
    && !hasActorGate
  ) {
    return false;
  }

  return true;
};

const stripInternalFields = (row) => {
  const { _performed_by_role_name, ...publicRow } = row;
  return publicRow;
};

const getPlacementActivity = async ({ auth = {}, filters = {}, cargoIdentifier = null }, executor = db) => {
  const paging = getPaging(filters);
  const queryContext = {
    auth,
    filters,
    cargoIdentifier,
    executor
  };

  const rows = [
    ...await movementRows(queryContext),
    ...await validationRows(queryContext),
    ...await overrideRequestRows(queryContext),
    ...await overrideDecisionRows(queryContext),
    ...await auditSupportRows(queryContext)
  ]
    .map(normalizeRow);

  const filtered = applyPostFilters(rows, filters)
    .filter((row) => canViewActivity(auth, row))
    .sort((left, right) => {
      const timeDiff = new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
      if (timeDiff !== 0) return timeDiff;
      return String(right.id).localeCompare(String(left.id));
    })
    .map(stripInternalFields);

  return {
    rows: filtered.slice(paging.offset, paging.offset + paging.limit),
    total: filtered.length,
    page: paging.page,
    limit: paging.limit
  };
};

const getPlacementActivitySummary = async ({ auth = {}, filters = {} }, executor = db) => {
  const { rows } = await getPlacementActivity({
    auth,
    filters: {
      ...filters,
      limit: 500,
      page: 1
    }
  }, executor);

  const summary = {
    activity_count: rows.length,
    placement_confirmed_count: 0,
    relocation_count: 0,
    validation_failed_count: 0,
    confirmation_failed_count: 0,
    pending_override_count: 0,
    approved_override_count: 0,
    rejected_override_count: 0,
    manual_placement_count: 0,
    scan_placement_count: 0
  };

  for (const row of rows) {
    if (row.activity_type === ACTIVITY_TYPES.PLACEMENT_CONFIRMED) summary.placement_confirmed_count += 1;
    if (row.activity_type === ACTIVITY_TYPES.CARGO_RELOCATED) summary.relocation_count += 1;
    if (row.activity_type === ACTIVITY_TYPES.PLACEMENT_VALIDATION_FAILED) summary.validation_failed_count += 1;
    if (row.activity_type === ACTIVITY_TYPES.PLACEMENT_CONFIRMATION_FAILED) summary.confirmation_failed_count += 1;
    if (row.activity_type === ACTIVITY_TYPES.PLACEMENT_OVERRIDE_REQUESTED) summary.pending_override_count += 1;
    if (row.activity_type === ACTIVITY_TYPES.PLACEMENT_OVERRIDE_APPROVED) summary.approved_override_count += 1;
    if (row.activity_type === ACTIVITY_TYPES.PLACEMENT_OVERRIDE_REJECTED) summary.rejected_override_count += 1;
    if (row.placement_mode === "manual") summary.manual_placement_count += 1;
    if (row.placement_mode === "scan") summary.scan_placement_count += 1;
  }

  return summary;
};

module.exports = {
  ACTIVITY_TYPES,
  getPlacementActivity,
  getPlacementActivitySummary
};

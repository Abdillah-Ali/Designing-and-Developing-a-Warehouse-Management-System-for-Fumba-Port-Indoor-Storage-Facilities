const db = require("../config/db");
const { roleNames } = require("../config/systemConfig");
const { writeAuditLog } = require("../models/adminModel");
const { buildError } = require("../utils/apiError");

const NOTIFICATION_TYPES = Object.freeze({
  PENDING_APPROVAL: "pending_approval",
  CORRECTION_REQUEST: "correction_request",
  APPROVAL_DECISION: "approval_decision",
  PLACEMENT_OVERRIDE: "placement_override",
  DISPATCH_REQUEST: "dispatch_request",
  WAREHOUSE_ALERT: "warehouse_alert",
  SYSTEM_ANNOUNCEMENT: "system_announcement"
});

const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

const normalizePriority = (priority) => {
  const value = String(priority || "normal").trim().toLowerCase();
  return PRIORITIES.has(value) ? value : "normal";
};

const cleanString = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

const readPositiveId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const getRoleIdByName = async (roleName, executor = db) => {
  if (!roleName) return null;
  const result = await executor.query(
    "SELECT id FROM roles WHERE role_name = $1 LIMIT 1",
    [roleName]
  );
  return result.rows[0]?.id || null;
};

const getStaffOwnerId = (cargo) => (
  readPositiveId(cargo?.assigned_staff_id)
  || readPositiveId(cargo?.created_by)
  || readPositiveId(cargo?.received_by_user_id)
);

const notificationSelect = `
  SELECT
    n.*,
    recipient.full_name AS recipient_full_name,
    recipient.username AS recipient_username,
    target_role.role_name AS recipient_role_name,
    target_warehouse.warehouse_name AS recipient_warehouse_name,
    target_warehouse.warehouse_code AS recipient_warehouse_code,
    creator.full_name AS created_by_name,
    creator.username AS created_by_username,
    related_cargo.cargo_id AS related_cargo_identifier,
    related_cargo.barcode AS related_cargo_barcode
  FROM notifications n
  LEFT JOIN users recipient ON recipient.id = n.recipient_user_id
  LEFT JOIN roles target_role ON target_role.id = n.recipient_role_id
  LEFT JOIN warehouses target_warehouse ON target_warehouse.id = n.recipient_warehouse_id
  LEFT JOIN users creator ON creator.id = n.created_by
  LEFT JOIN cargo related_cargo ON related_cargo.id = n.related_entity_id
    AND n.related_entity_type = 'cargo'
`;

const addVisibleNotificationClauses = (auth, clauses, values, alias = "n") => {
  clauses.push(`${alias}.archived_at IS NULL`);
  clauses.push(`(${alias}.expires_at IS NULL OR ${alias}.expires_at > CURRENT_TIMESTAMP)`);

  values.push(auth?.userId || 0);
  const userParam = `$${values.length}`;
  values.push(auth?.roleId || 0);
  const roleParam = `$${values.length}`;
  values.push(auth?.warehouseId || 0);
  const warehouseParam = `$${values.length}`;

  clauses.push(`(
    ${alias}.recipient_user_id = ${userParam}
    OR (
      ${alias}.recipient_user_id IS NULL
      AND (${alias}.recipient_role_id IS NULL OR ${alias}.recipient_role_id = ${roleParam})
      AND (${alias}.recipient_warehouse_id IS NULL OR ${alias}.recipient_warehouse_id = ${warehouseParam})
    )
  )`);
};

const buildFilterClauses = (filters, values, alias = "n") => {
  const clauses = [];

  if (filters.unread === "true" || filters.unread_only === "true") {
    clauses.push(`${alias}.is_read = FALSE`);
  }

  if (filters.read === "true") {
    clauses.push(`${alias}.is_read = TRUE`);
  } else if (filters.read === "false") {
    clauses.push(`${alias}.is_read = FALSE`);
  }

  if (filters.notification_type) {
    values.push(filters.notification_type);
    clauses.push(`${alias}.notification_type = $${values.length}`);
  }

  if (filters.priority) {
    values.push(normalizePriority(filters.priority));
    clauses.push(`${alias}.priority = $${values.length}`);
  }

  if (filters.related_module) {
    values.push(filters.related_module);
    clauses.push(`${alias}.related_module = $${values.length}`);
  }

  if (filters.date_from) {
    values.push(filters.date_from);
    clauses.push(`${alias}.created_at >= $${values.length}::date`);
  }

  if (filters.date_to) {
    values.push(filters.date_to);
    clauses.push(`${alias}.created_at < ($${values.length}::date + INTERVAL '1 day')`);
  }

  if (filters.search) {
    values.push(`%${filters.search}%`);
    clauses.push(`(
      ${alias}.title ILIKE $${values.length}
      OR ${alias}.message ILIKE $${values.length}
      OR COALESCE(${alias}.related_module, '') ILIKE $${values.length}
    )`);
  }

  return clauses;
};

const listNotifications = async ({ auth, filters = {}, executor = db }) => {
  const values = [];
  const clauses = [];
  addVisibleNotificationClauses(auth, clauses, values);
  clauses.push(...buildFilterClauses(filters, values));

  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const page = Math.max(Number(filters.page) || 1, 1);
  const limit = Math.min(Math.max(Number(filters.limit) || 20, 1), 100);
  const offset = (page - 1) * limit;

  const countResult = await executor.query(
    `SELECT COUNT(*)::int AS total FROM notifications n ${whereClause}`,
    values
  );

  const result = await executor.query(
    `${notificationSelect}
     ${whereClause}
     ORDER BY n.is_read ASC, n.created_at DESC, n.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    values
  );

  return {
    rows: result.rows,
    total: countResult.rows[0]?.total || 0,
    page,
    limit
  };
};

const getUnreadCount = async ({ auth, executor = db }) => {
  const values = [];
  const clauses = ["n.is_read = FALSE"];
  addVisibleNotificationClauses(auth, clauses, values);

  const result = await executor.query(
    `SELECT COUNT(*)::int AS count
     FROM notifications n
     WHERE ${clauses.join(" AND ")}`,
    values
  );

  return result.rows[0]?.count || 0;
};

const createNotification = async (payload, executor = db, options = {}) => {
  const title = cleanString(payload.title);
  const message = cleanString(payload.message);
  if (!title || !message) {
    throw new Error("Notification title and message are required.");
  }

  const result = await executor.query(
    `INSERT INTO notifications (
      recipient_user_id,
      recipient_role_id,
      recipient_warehouse_id,
      notification_type,
      title,
      message,
      related_module,
      related_entity_type,
      related_entity_id,
      priority,
      created_by,
      expires_at,
      metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
    RETURNING *`,
    [
      readPositiveId(payload.recipient_user_id),
      readPositiveId(payload.recipient_role_id),
      readPositiveId(payload.recipient_warehouse_id),
      cleanString(payload.notification_type) || NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT,
      title,
      message,
      cleanString(payload.related_module) || null,
      cleanString(payload.related_entity_type) || null,
      readPositiveId(payload.related_entity_id),
      normalizePriority(payload.priority),
      readPositiveId(payload.created_by),
      cleanString(payload.expires_at) || null,
      JSON.stringify(payload.metadata || {})
    ]
  );

  const notification = result.rows[0];
  if (options.audit !== false) {
    await writeAuditLog(
      {
        user_id: payload.created_by || options.actorId || null,
        action: "CREATE_NOTIFICATION",
        module: "Notifications",
        description: `Created notification: ${title}.`,
        metadata: {
          notification_id: notification.id,
          notification_type: notification.notification_type,
          target_user_id: notification.recipient_user_id,
          target_role_id: notification.recipient_role_id,
          target_warehouse_id: notification.recipient_warehouse_id,
          created_by: notification.created_by,
          related_entity_type: notification.related_entity_type,
          related_entity_id: notification.related_entity_id,
          timestamp: notification.created_at
        }
      },
      executor
    );
  }

  return notification;
};

const findAudienceUsers = async (
  { userIds = [], roleId = null, roleName = "", warehouseId = null, allActive = false },
  executor = db
) => {
  const values = [];
  const clauses = ["u.status = 'active'"];

  if (userIds.length > 0) {
    values.push(userIds.map(Number).filter((id) => Number.isInteger(id) && id > 0));
    clauses.push(`u.id = ANY($${values.length}::int[])`);
  }

  if (!allActive) {
    if (roleId) {
      values.push(roleId);
      clauses.push(`u.role_id = $${values.length}`);
    }
    if (roleName) {
      values.push(roleName);
      clauses.push(`r.role_name = $${values.length}`);
    }
    if (warehouseId) {
      values.push(warehouseId);
      clauses.push(`u.warehouse_id = $${values.length}`);
    }
  }

  const result = await executor.query(
    `SELECT u.id, u.role_id, u.warehouse_id
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY u.id`,
    values
  );

  return result.rows;
};

const createNotificationsForAudience = async (payload, audience = {}, executor = db, options = {}) => {
  const users = await findAudienceUsers(audience, executor);
  const notifications = [];

  for (const user of users) {
    notifications.push(await createNotification(
      {
        ...payload,
        recipient_user_id: user.id,
        recipient_role_id: payload.recipient_role_id || user.role_id,
        recipient_warehouse_id: payload.recipient_warehouse_id || user.warehouse_id || null
      },
      executor,
      options
    ));
  }

  if (notifications.length === 0 && options.fallbackBroadTarget) {
    const fallbackRoleId = audience.roleId || await getRoleIdByName(audience.roleName, executor);
    notifications.push(await createNotification(
      {
        ...payload,
        recipient_role_id: payload.recipient_role_id || fallbackRoleId,
        recipient_warehouse_id: payload.recipient_warehouse_id || audience.warehouseId || null
      },
      executor,
      options
    ));
  }

  return notifications;
};

const markNotificationRead = async ({ auth, notificationId, executor = db }) => {
  const values = [notificationId];
  const clauses = ["n.id = $1"];
  addVisibleNotificationClauses(auth, clauses, values);

  const result = await executor.query(
    `UPDATE notifications n
     SET is_read = TRUE,
         read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
     WHERE ${clauses.join(" AND ")}
     RETURNING n.*`,
    values
  );

  const notification = result.rows[0] || null;
  if (notification) {
    await writeAuditLog(
      {
        user_id: auth?.userId || null,
        action: "READ_NOTIFICATION",
        module: "Notifications",
        description: `Read notification ${notification.id}.`,
        metadata: {
          notification_id: notification.id,
          notification_type: notification.notification_type,
          target_user_id: notification.recipient_user_id,
          target_role_id: notification.recipient_role_id,
          target_warehouse_id: notification.recipient_warehouse_id,
          related_module: notification.related_module,
          related_entity_type: notification.related_entity_type,
          related_entity_id: notification.related_entity_id,
          created_by: notification.created_by,
          timestamp: notification.read_at
        }
      },
      executor
    );
  }

  return notification;
};

const markAllNotificationsRead = async ({ auth, executor = db }) => {
  const values = [];
  const clauses = ["n.is_read = FALSE"];
  addVisibleNotificationClauses(auth, clauses, values);

  const result = await executor.query(
    `UPDATE notifications n
     SET is_read = TRUE,
         read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
     WHERE ${clauses.join(" AND ")}
     RETURNING
       n.id,
       n.notification_type,
       n.recipient_user_id,
       n.recipient_role_id,
       n.recipient_warehouse_id,
       n.related_module,
       n.related_entity_type,
       n.related_entity_id,
       n.created_by`,
    values
  );

  await writeAuditLog(
    {
      user_id: auth?.userId || null,
      action: "READ_ALL_NOTIFICATIONS",
      module: "Notifications",
      description: `Marked ${result.rowCount} notification(s) as read.`,
      metadata: {
        notification_ids: result.rows.map((row) => row.id),
        notification_types: result.rows.map((row) => row.notification_type),
        notifications: result.rows.map((row) => ({
          notification_id: row.id,
          notification_type: row.notification_type,
          target_user_id: row.recipient_user_id,
          target_role_id: row.recipient_role_id,
          target_warehouse_id: row.recipient_warehouse_id,
          related_module: row.related_module,
          related_entity_type: row.related_entity_type,
          related_entity_id: row.related_entity_id,
          created_by: row.created_by
        })),
        timestamp: new Date().toISOString()
      }
    },
    executor
  );

  return result.rows;
};

const archiveNotification = async ({ auth, notificationId, executor = db }) => {
  const values = [notificationId, auth?.userId || null];
  const clauses = ["n.id = $1"];
  addVisibleNotificationClauses(auth, clauses, values);

  const result = await executor.query(
    `UPDATE notifications n
     SET archived_at = CURRENT_TIMESTAMP,
         archived_by = $2
     WHERE ${clauses.join(" AND ")}
     RETURNING n.*`,
    values
  );

  const notification = result.rows[0] || null;
  if (notification) {
    await writeAuditLog(
      {
        user_id: auth?.userId || null,
        action: "ARCHIVE_NOTIFICATION",
        module: "Notifications",
        description: `Archived notification ${notification.id}.`,
        metadata: {
          notification_id: notification.id,
          notification_type: notification.notification_type,
          target_user_id: notification.recipient_user_id,
          target_role_id: notification.recipient_role_id,
          target_warehouse_id: notification.recipient_warehouse_id,
          related_module: notification.related_module,
          related_entity_type: notification.related_entity_type,
          related_entity_id: notification.related_entity_id,
          created_by: notification.created_by,
          timestamp: notification.archived_at
        }
      },
      executor
    );
  }

  return notification;
};

const createSystemAnnouncement = async (payload, auth, executor = db) => {
  const roleId = readPositiveId(payload.target_role_id || payload.recipient_role_id);
  const warehouseId = readPositiveId(payload.target_warehouse_id || payload.recipient_warehouse_id);
  const userId = readPositiveId(payload.target_user_id || payload.recipient_user_id);
  const audience = userId
    ? { userIds: [userId], roleId, warehouseId }
    : roleId || warehouseId
      ? { roleId, warehouseId }
      : { allActive: true };

  const notifications = await createNotificationsForAudience(
    {
      notification_type: NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT,
      title: payload.title,
      message: payload.message,
      related_module: "System Announcements",
      priority: payload.priority || "normal",
      created_by: auth?.userId || null,
      expires_at: payload.expires_at || null,
      metadata: {
        target_role_id: roleId,
        target_warehouse_id: warehouseId,
        target_user_id: userId
      }
    },
    audience,
    executor,
    { actorId: auth?.userId || null, fallbackBroadTarget: !userId }
  );

  if (userId && notifications.length === 0) {
    throw buildError("Selected user is not active or does not match the selected role and warehouse filters.", 400);
  }

  await writeAuditLog(
    {
      user_id: auth?.userId || null,
      action: "CREATE_SYSTEM_ANNOUNCEMENT",
      module: "Notifications",
      description: `Created system announcement: ${cleanString(payload.title)}.`,
      metadata: {
        notification_ids: notifications.map((notification) => notification.id),
        notification_type: NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT,
        target_role_id: roleId,
        target_warehouse_id: warehouseId,
        target_user_id: userId,
        created_by: auth?.userId || null,
        timestamp: new Date().toISOString()
      }
    },
    executor
  );

  return notifications;
};

const notifyCargoRegistrationPending = async ({ cargo, approvalRequestId, actorId }, executor = db) => (
  createNotificationsForAudience(
    {
      notification_type: NOTIFICATION_TYPES.PENDING_APPROVAL,
      title: "New cargo registration pending review",
      message: `New cargo registration pending review: ${cargo.cargo_id}`,
      related_module: "Cargo Approvals",
      related_entity_type: "cargo",
      related_entity_id: cargo.id,
      priority: "normal",
      created_by: actorId || null,
      metadata: { approval_request_id: approvalRequestId || null }
    },
    { roleName: roleNames.warehouseSupervisor, warehouseId: cargo.warehouse_id || cargo.warehouse_id_at_registration },
    executor,
    { actorId: actorId || null, fallbackBroadTarget: true }
  )
);

const getPendingReviewEscalationThresholdHours = async (executor = db) => {
  const result = await executor.query(
    `SELECT setting_value
     FROM system_settings
     WHERE setting_key = 'cargo_pending_review_escalation_hours'
     LIMIT 1`
  );
  const configured = Number(result.rows[0]?.setting_value);
  return Number.isFinite(configured) && configured > 0 ? configured : 2;
};

const notifyPendingReviewEscalations = async ({ thresholdHours } = {}, executor = db) => {
  const hours = Number.isFinite(Number(thresholdHours)) && Number(thresholdHours) > 0
    ? Number(thresholdHours)
    : await getPendingReviewEscalationThresholdHours(executor);
  const result = await executor.query(
    `SELECT
       ar.id AS approval_request_id,
       ar.created_at,
       COALESCE(ar.assigned_to, ar.assigned_supervisor_id) AS assigned_supervisor_id,
       c.id AS cargo_record_id,
       c.cargo_id,
       c.warehouse_id,
       w.warehouse_name,
       w.warehouse_code,
       supervisor.full_name AS assigned_supervisor_name,
       supervisor.username AS assigned_supervisor_username,
       EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ar.created_at)) / 3600 AS waiting_hours
     FROM approval_requests ar
     JOIN cargo c ON c.id = ar.cargo_id
     LEFT JOIN warehouses w ON w.id = c.warehouse_id
     LEFT JOIN users supervisor ON supervisor.id = COALESCE(ar.assigned_to, ar.assigned_supervisor_id)
     WHERE ar.request_type = 'CARGO_REGISTRATION'
       AND ar.status = 'Pending'
       AND c.registration_status = 'Pending Review'
       AND c.is_deleted = FALSE
       AND ar.created_at <= CURRENT_TIMESTAMP - ($1::text || ' hours')::interval
       AND NOT EXISTS (
         SELECT 1
         FROM notifications n
         WHERE n.related_entity_type = 'cargo'
           AND n.related_entity_id = c.id
           AND n.metadata->>'escalation_type' = 'pending_review'
           AND n.archived_at IS NULL
       )
     ORDER BY ar.created_at ASC, ar.id ASC`,
    [hours]
  );

  const created = [];
  for (const row of result.rows) {
    const waitingHours = Number(row.waiting_hours || 0);
    const notifications = await createNotificationsForAudience(
      {
        notification_type: NOTIFICATION_TYPES.WAREHOUSE_ALERT,
        title: `Cargo approval overdue: ${row.cargo_id}`,
        message: `${row.cargo_id} has waited ${waitingHours.toFixed(1)} hours for supervisor approval.`,
        related_module: "Cargo Approvals",
        related_entity_type: "cargo",
        related_entity_id: row.cargo_record_id,
        priority: "high",
        created_by: null,
        metadata: {
          escalation_type: "pending_review",
          approval_request_id: row.approval_request_id,
          cargo_id: row.cargo_record_id,
          cargo_identifier: row.cargo_id,
          warehouse_id: row.warehouse_id,
          warehouse: row.warehouse_code || row.warehouse_name || null,
          assigned_supervisor_id: row.assigned_supervisor_id,
          assigned_supervisor: row.assigned_supervisor_name || row.assigned_supervisor_username || null,
          waiting_hours: waitingHours,
          threshold_hours: hours,
          priority: "high"
        }
      },
      { roleName: roleNames.systemAdmin },
      executor,
      { fallbackBroadTarget: true }
    );
    created.push(...notifications);
  }

  return created;
};

const notifyCorrectionRequested = async ({ cargo, approvalRequestId, correctionFields = [], notes, actorId }, executor = db) => {
  const ownerId = getStaffOwnerId(cargo);
  if (!ownerId) return [];
  return createNotificationsForAudience(
    {
      notification_type: NOTIFICATION_TYPES.CORRECTION_REQUEST,
      title: `Correction required for ${cargo.cargo_id}`,
      message: notes || "Supervisor requested registration changes.",
      related_module: "Cargo Corrections",
      related_entity_type: "cargo",
      related_entity_id: cargo.id || cargo.cargo_record_id,
      priority: "high",
      created_by: actorId || null,
      metadata: {
        approval_request_id: approvalRequestId || null,
        correction_fields: correctionFields
      }
    },
    { userIds: [ownerId] },
    executor,
    { actorId: actorId || null }
  );
};

const notifyRegistrationDecision = async ({ cargo, approvalRequestId, decision, notes, actorId }, executor = db) => {
  const ownerId = getStaffOwnerId(cargo);
  if (!ownerId) return [];
  const approved = decision === "Approved";
  return createNotificationsForAudience(
    {
      notification_type: NOTIFICATION_TYPES.APPROVAL_DECISION,
      title: approved ? `Cargo registration approved: ${cargo.cargo_id}` : `Cargo registration rejected: ${cargo.cargo_id}`,
      message: notes || (approved ? "Cargo registration was approved." : "Cargo registration was rejected."),
      related_module: "Cargo Approvals",
      related_entity_type: "cargo",
      related_entity_id: cargo.id || cargo.cargo_record_id,
      priority: approved ? "normal" : "high",
      created_by: actorId || null,
      metadata: {
        approval_request_id: approvalRequestId || null,
        decision
      }
    },
    { userIds: [ownerId] },
    executor,
    { actorId: actorId || null }
  );
};

const notifyPlacementOverridePending = async ({ cargo, bin, approvalRequestId, actorId }, executor = db) => (
  createNotificationsForAudience(
    {
      notification_type: NOTIFICATION_TYPES.PENDING_APPROVAL,
      title: "Placement override pending approval",
      message: `Placement override request pending approval${cargo?.cargo_id ? ` for ${cargo.cargo_id}` : ""}.`,
      related_module: "Cargo Placement",
      related_entity_type: "cargo",
      related_entity_id: cargo?.id || null,
      priority: "high",
      created_by: actorId || null,
      metadata: {
        approval_request_id: approvalRequestId || null,
        bin_id: bin?.id || null,
        bin_barcode: bin?.barcode || null
      }
    },
    { roleName: roleNames.warehouseSupervisor, warehouseId: cargo?.warehouse_id },
    executor,
    { actorId: actorId || null, fallbackBroadTarget: true }
  )
);

const notifyPlacementOverrideDecision = async ({ cargo, approval, decision, notes, actorId }, executor = db) => {
  const requesterId = readPositiveId(approval?.requested_by);
  if (!requesterId) return [];
  return createNotificationsForAudience(
    {
      notification_type: NOTIFICATION_TYPES.PLACEMENT_OVERRIDE,
      title: decision === "Approved" ? "Placement override approved" : "Placement override rejected",
      message: notes || `${decision} placement override request${cargo?.cargo_id ? ` for ${cargo.cargo_id}` : ""}.`,
      related_module: "Cargo Placement",
      related_entity_type: "cargo",
      related_entity_id: cargo?.id || approval?.cargo_record_id || null,
      priority: decision === "Approved" ? "normal" : "high",
      created_by: actorId || null,
      metadata: {
        approval_request_id: approval?.id || null,
        decision
      }
    },
    { userIds: [requesterId] },
    executor,
    { actorId: actorId || null }
  );
};

const notifyDispatchSubmitted = async ({ cargo, dispatchRequestId, requesterId, actorId }, executor = db) => {
  const notifications = await createNotificationsForAudience(
    {
      notification_type: NOTIFICATION_TYPES.DISPATCH_REQUEST,
      title: "Dispatch request pending action",
      message: `Dispatch request submitted for ${cargo.cargo_id}.`,
      related_module: "Dispatch Operations",
      related_entity_type: "cargo",
      related_entity_id: cargo.id,
      priority: "high",
      created_by: actorId || null,
      metadata: { dispatch_request_id: dispatchRequestId || null }
    },
    { roleName: roleNames.warehouseSupervisor, warehouseId: cargo.warehouse_id },
    executor,
    { actorId: actorId || null, fallbackBroadTarget: true }
  );

  if (requesterId) {
    notifications.push(...await createNotificationsForAudience(
      {
        notification_type: NOTIFICATION_TYPES.DISPATCH_REQUEST,
        title: "Dispatch request submitted",
        message: `Dispatch request submitted for ${cargo.cargo_id}.`,
        related_module: "Dispatch Operations",
        related_entity_type: "cargo",
        related_entity_id: cargo.id,
        priority: "normal",
        created_by: actorId || null,
        metadata: { dispatch_request_id: dispatchRequestId || null }
      },
      { userIds: [requesterId] },
      executor,
      { actorId: actorId || null }
    ));
  }

  return notifications;
};

const notifyDispatchDecision = async ({ cargo, dispatchRequest, decision, notes, actorId }, executor = db) => {
  const requesterId = readPositiveId(dispatchRequest?.requested_by);
  if (!requesterId) return [];
  return createNotificationsForAudience(
    {
      notification_type: NOTIFICATION_TYPES.DISPATCH_REQUEST,
      title: decision === "Approved" ? "Dispatch request approved" : "Dispatch request rejected",
      message: notes || `Dispatch request ${decision.toLowerCase()} for ${cargo.cargo_id}.`,
      related_module: "Dispatch Operations",
      related_entity_type: "cargo",
      related_entity_id: cargo.id || dispatchRequest?.cargo_record_id || null,
      priority: decision === "Approved" ? "normal" : "high",
      created_by: actorId || null,
      metadata: {
        dispatch_request_id: dispatchRequest?.id || null,
        decision
      }
    },
    { userIds: [requesterId] },
    executor,
    { actorId: actorId || null }
  );
};

const notifyWarehouseAlert = async ({ title, message, warehouseId, relatedEntityType, relatedEntityId, priority = "high", metadata = {}, actorId = null }, executor = db) => {
  const supervisors = await createNotificationsForAudience(
    {
      notification_type: NOTIFICATION_TYPES.WAREHOUSE_ALERT,
      title,
      message,
      related_module: "Warehouse Alerts",
      related_entity_type: relatedEntityType || null,
      related_entity_id: relatedEntityId || null,
      priority,
      recipient_warehouse_id: warehouseId || null,
      created_by: actorId,
      metadata
    },
    { roleName: roleNames.warehouseSupervisor, warehouseId },
    executor,
    { actorId, fallbackBroadTarget: true }
  );

  const admins = await createNotificationsForAudience(
    {
      notification_type: NOTIFICATION_TYPES.WAREHOUSE_ALERT,
      title,
      message,
      related_module: "Warehouse Alerts",
      related_entity_type: relatedEntityType || null,
      related_entity_id: relatedEntityId || null,
      priority,
      recipient_warehouse_id: warehouseId || null,
      created_by: actorId,
      metadata
    },
    { roleName: roleNames.systemAdmin },
    executor,
    { actorId, fallbackBroadTarget: true }
  );

  return [...supervisors, ...admins];
};

module.exports = {
  NOTIFICATION_TYPES,
  PRIORITIES,
  addVisibleNotificationClauses,
  archiveNotification,
  createNotification,
  createNotificationsForAudience,
  createSystemAnnouncement,
  getRoleIdByName,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notifyCargoRegistrationPending,
  notifyCorrectionRequested,
  notifyPendingReviewEscalations,
  notifyDispatchDecision,
  notifyDispatchSubmitted,
  notifyPlacementOverrideDecision,
  notifyPlacementOverridePending,
  notifyRegistrationDecision,
  notifyWarehouseAlert,
  normalizePriority
};

const crypto = require("node:crypto");
const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { buildError } = require("../utils/apiError");
const emitPolicyEvent = (eventKey, context, executor) => require("./notificationAuthorityService").emitNotificationEvent(eventKey, context, executor);

const NOTIFICATION_TYPES = Object.freeze({
  PENDING_APPROVAL: "pending_approval",
  CORRECTION_REQUEST: "correction_request",
  APPROVAL_DECISION: "approval_decision",
  PLACEMENT_OVERRIDE: "placement_override",
  DISPATCH_REQUEST: "dispatch_request",
  DISPATCH_UPDATE: "dispatch_update",
  CUSTOMS_INSPECTION: "customs_inspection",
  INVOICE_PENDING: "invoice_pending",
  FINANCE_CHARGE_STARTED: "finance_charge_started",
  FINANCE_PAYMENT_UPDATE: "finance_payment_update",
  GATE_RELEASE_UPDATE: "gate_release_update",
  WAREHOUSE_ALERT: "warehouse_alert",
  SYSTEM_ANNOUNCEMENT: "system_announcement"
});

const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const ACTIONABLE_WORKFLOW_TYPES = new Set([
  NOTIFICATION_TYPES.PENDING_APPROVAL,
  NOTIFICATION_TYPES.CORRECTION_REQUEST,
  NOTIFICATION_TYPES.PLACEMENT_OVERRIDE,
  NOTIFICATION_TYPES.DISPATCH_REQUEST,
  NOTIFICATION_TYPES.CUSTOMS_INSPECTION,
  NOTIFICATION_TYPES.INVOICE_PENDING,
  NOTIFICATION_TYPES.GATE_RELEASE_UPDATE
]);

const publicNotificationFields = `
  n.public_reference,
  n.notification_type,
  n.event_key,
  n.policy_revision,
  n.actionable,
  n.recipient_strategy,
  n.deep_link_builder_key,
  n.resolution_strategy_key,
  n.archive_policy_key,
  n.subject_reference,
  n.action_reference,
  n.title,
  n.message,
  n.related_module,
  n.related_entity_type,
  n.priority,
  n.status,
  n.completed_at,
  n.is_read,
  n.read_at,
  n.created_at,
  n.expires_at,
  n.archived_at,
  CASE WHEN n.actionable THEN n.event_key ELSE NULL END AS safe_action_type,
  CASE
    WHEN n.metadata->>'deep_link' ~ '^/(admin|staff|supervisor|finance|customs|gate)(/|\\?|$)'
      THEN n.metadata->>'deep_link'
    ELSE NULL
  END AS safe_destination
`;

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
    ${publicNotificationFields},
    recipient.full_name AS recipient_full_name,
    recipient.username AS recipient_username,
    target_role.role_name AS recipient_role_name,
    target_warehouse.warehouse_name AS recipient_warehouse_name,
    target_warehouse.warehouse_code AS recipient_warehouse_code,
    creator.full_name AS created_by_name,
    creator.username AS created_by_username,
    related_cargo.cargo_id AS related_record_reference,
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

const addVisibleNotificationClauses = (auth, clauses, values, alias = "n", options = {}) => {
  if (!options.includeArchived) {
    clauses.push(`${alias}.archived_at IS NULL`);
  }
  if (!options.includeExpired) {
    clauses.push(`(${alias}.expires_at IS NULL OR ${alias}.expires_at > CURRENT_TIMESTAMP)`);
  }

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

const isArchivedRequest = (filters = {}) => (
  filters.archived === "true"
  || filters.view === "archived"
  || filters.status_view === "archived"
);

const getDateFilterColumn = (filters = {}, alias = "n", defaultDateField = "created_at") => {
  const allowedDateFields = new Set(["created_at", "archived_at"]);
  const dateField = allowedDateFields.has(filters.date_field)
    ? filters.date_field
    : defaultDateField;
  return `${alias}.${dateField}`;
};

const buildFilterClauses = (filters, values, alias = "n", options = {}) => {
  const clauses = [];
  const dateColumn = getDateFilterColumn(filters, alias, options.defaultDateField || "created_at");

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

  if (filters.status) {
    const status = String(filters.status || "").trim().toLowerCase();
    if (["pending", "completed", "dismissed"].includes(status)) {
      values.push(status);
      clauses.push(`${alias}.status = $${values.length}`);
    }
  }

  if (filters.related_module) {
    values.push(filters.related_module);
    clauses.push(`${alias}.related_module = $${values.length}`);
  }

  if (filters.date_from) {
    values.push(filters.date_from);
    clauses.push(`${dateColumn} >= $${values.length}::date`);
  }

  if (filters.date_to) {
    values.push(filters.date_to);
    clauses.push(`${dateColumn} < ($${values.length}::date + INTERVAL '1 day')`);
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

const buildNotificationOrder = (filters = {}, archivedOnly = false) => {
  const allowedSortFields = new Set(["archived_at", "created_at", "status"]);
  const sortBy = allowedSortFields.has(filters.sort_by) ? filters.sort_by : "";
  const direction = String(filters.sort_order || "").toLowerCase() === "asc" ? "ASC" : "DESC";

  if (sortBy === "status") {
    return `n.status ${direction}, n.created_at DESC, n.id DESC`;
  }

  if (sortBy === "created_at") {
    return `n.created_at ${direction}, n.id DESC`;
  }

  if (sortBy === "archived_at") {
    return `n.archived_at ${direction} NULLS LAST, n.created_at DESC, n.id DESC`;
  }

  if (archivedOnly) {
    return "n.archived_at DESC NULLS LAST, n.created_at DESC, n.id DESC";
  }

  return "n.is_read ASC, n.created_at DESC, n.id DESC";
};

const listNotifications = async ({ auth, filters = {}, executor = db }) => {
  const values = [];
  const clauses = [];
  const archivedOnly = isArchivedRequest(filters);
  addVisibleNotificationClauses(auth, clauses, values, "n", {
    includeArchived: archivedOnly,
    includeExpired: archivedOnly
  });
  if (archivedOnly) {
    clauses.push("n.archived_at IS NOT NULL");
  }
  clauses.push(...buildFilterClauses(filters, values, "n", {
    defaultDateField: archivedOnly ? "archived_at" : "created_at"
  }));

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
     ORDER BY ${buildNotificationOrder(filters, archivedOnly)}
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

const getNotificationSummary = async ({ auth, executor = db }) => {
  const countNotifications = async (buildClauses) => {
    const values = [];
    const clauses = [];
    buildClauses(clauses, values);
    const result = await executor.query(
      `SELECT COUNT(*)::int AS count
       FROM notifications n
       WHERE ${clauses.join(" AND ")}`,
      values
    );
    return result.rows[0]?.count || 0;
  };

  const [active, unread, archived] = await Promise.all([
    countNotifications((clauses, values) => {
      addVisibleNotificationClauses(auth, clauses, values);
    }),
    countNotifications((clauses, values) => {
      clauses.push("n.is_read = FALSE");
      addVisibleNotificationClauses(auth, clauses, values);
    }),
    countNotifications((clauses, values) => {
      addVisibleNotificationClauses(auth, clauses, values, "n", {
        includeArchived: true,
        includeExpired: true
      });
      clauses.push("n.archived_at IS NOT NULL");
    })
  ]);

  return { active, unread, archived };
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

const generateNotificationReference = () => {
  const year = new Date().getFullYear();
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let randomPart = "";
  for (let i = 0; i < 6; i++) {
    randomPart += chars[crypto.randomInt(chars.length)];
  }
  return `NTF-${year}-${randomPart}`;
};

const createNotification = async (payload, executor = db, options = {}) => {
  const title = cleanString(payload.title);
  const message = cleanString(payload.message);
  if (!title || !message) {
    throw new Error("Notification title and message are required.");
  }

  const maxAttempts = 5;
  let notification = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const publicRef = generateNotificationReference();
    try {
      const result = await executor.query(
        `INSERT INTO notifications (
          public_reference,
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
          status,
          created_by,
          expires_at,
          metadata,
          event_key, policy_revision, actionable, recipient_strategy,
          deep_link_builder_key, resolution_strategy_key, archive_policy_key,
          subject_reference, action_reference, policy_mapping_status
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13,$14::jsonb,
          $15,$16,$17,$18,$19,$20,$21,$22,$23,'ready')
        RETURNING
          public_reference,
          notification_type,
          title,
          message,
          related_module,
          related_entity_type,
          priority,
          status,
          completed_at,
          is_read,
          read_at,
          created_at,
          expires_at,
          archived_at`,
        [
          publicRef,
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
          ,cleanString(payload.event_key) || null
          ,payload.policy_revision || null
          ,payload.actionable === true
          ,cleanString(payload.recipient_strategy) || null
          ,cleanString(payload.deep_link_builder_key) || null
          ,cleanString(payload.resolution_strategy_key) || null
          ,cleanString(payload.archive_policy_key) || null
          ,cleanString(payload.subject_reference) || null
          ,cleanString(payload.action_reference) || null
        ]
      );
      notification = result.rows[0];
      break;
    } catch (error) {
      if (
        error.code === "23505" &&
        error.constraint === "notifications_public_reference_key" &&
        attempt < maxAttempts - 1
      ) {
        continue;
      }
      if (error.code === "23505" && error.constraint === "idx_notifications_active_action_dedup" && options.deduplicate) {
        const existing = await executor.query(
          `SELECT public_reference,notification_type,title,message,related_module,related_entity_type,priority,status,
                  completed_at,is_read,read_at,created_at,expires_at,archived_at
           FROM notifications WHERE recipient_user_id=$1 AND event_key=$2 AND subject_reference=$3
             AND COALESCE(action_reference,'')=COALESCE($4,'') AND actionable=TRUE AND status='pending' AND archived_at IS NULL LIMIT 1`,
          [readPositiveId(payload.recipient_user_id),cleanString(payload.event_key),cleanString(payload.subject_reference)||null,cleanString(payload.action_reference)||null]
        );
        notification=existing.rows[0]; break;
      }
      throw error;
    }
  }

  if (!notification) {
    throw new Error("Unable to generate a unique notification reference.");
  }

  if (options.audit !== false) {
    await writeAuditLog(
      {
        user_id: payload.created_by || options.actorId || null,
        action: "CREATE_NOTIFICATION",
        module: "Notifications",
        description: `Created notification: ${title}.`,
        metadata: {
          public_reference: notification.public_reference,
          notification_type: notification.notification_type,
          related_entity_type: notification.related_entity_type,
          timestamp: notification.created_at
        }
      },
      executor
    );
  }

  return notification;
};

const findAudienceUsers = async (
  { userIds = [], roleId = null, roleKey = "", roleName = "", warehouseId = null, allActive = false },
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
    if (roleKey) {
      values.push(roleKey);
      clauses.push(`r.role_key = $${values.length}`);
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
    let fallbackRoleId=audience.roleId||null;
    if(!fallbackRoleId&&audience.roleKey) fallbackRoleId=(await executor.query("SELECT id FROM roles WHERE role_key=$1",[audience.roleKey])).rows[0]?.id||null;
    if(!fallbackRoleId) fallbackRoleId=await getRoleIdByName(audience.roleName, executor);
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

const markNotificationRead = async ({ auth, publicRef, executor = db }) => {
  const values = [publicRef];
  const clauses = ["n.public_reference = $1"];
  addVisibleNotificationClauses(auth, clauses, values);

  const result = await executor.query(
    `UPDATE notifications n
     SET is_read = TRUE,
         read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
     WHERE ${clauses.join(" AND ")}
     RETURNING
       public_reference,
       notification_type,
       status,
       completed_at,
       is_read,
       read_at`,
    values
  );

  const notification = result.rows[0] || null;
  if (notification) {
    await writeAuditLog(
      {
        user_id: auth?.userId || null,
        action: "READ_NOTIFICATION",
        module: "Notifications",
        description: `Read notification ${publicRef}.`,
        metadata: {
          public_reference: publicRef,
          notification_type: notification.notification_type,
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
       public_reference,
       notification_type,
       status,
       completed_at,
       is_read,
       read_at`,
    values
  );

  await writeAuditLog(
    {
      user_id: auth?.userId || null,
      action: "READ_ALL_NOTIFICATIONS",
      module: "Notifications",
      description: `Marked ${result.rowCount} notification(s) as read.`,
      metadata: {
        public_references: result.rows.map((row) => row.public_reference),
        timestamp: new Date().toISOString()
      }
    },
    executor
  );

  return result.rows;
};

const archiveNotification = async ({ auth, publicRef, executor = db }) => {
  const selectValues = [publicRef];
  const selectClauses = ["n.public_reference = $1"];
  addVisibleNotificationClauses(auth, selectClauses, selectValues, "n", { includeArchived: true });
  const selectRes = await executor.query(
    `SELECT public_reference, notification_type, event_key, actionable, archive_policy_key, status
     FROM notifications n
     WHERE ${selectClauses.join(" AND ")}
     LIMIT 1`,
    selectValues
  );
  const notification = selectRes.rows[0];
  if (!notification) return null;

  const { canArchive } = require("./notificationLifecycleRegistry");
  if (!canArchive(notification)) {
    throw buildError("Complete the required workflow action before archiving this notification.", 409, null, "NOTIFICATION_ACTION_REQUIRED");
  }

  const values = [auth?.userId || null, publicRef];
  const clauses = ["n.public_reference = $2"];
  addVisibleNotificationClauses(auth, clauses, values, "n", { includeArchived: true });

  const result = await executor.query(
    `UPDATE notifications n
     SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
         archived_by = COALESCE(archived_by, $1),
         status = CASE
           WHEN status = 'pending' THEN 'dismissed'
           WHEN status = 'completed' THEN 'completed'
           ELSE 'dismissed'
         END
     WHERE ${clauses.join(" AND ")}
     RETURNING
       public_reference,
       notification_type,
       status,
       completed_at,
       is_read,
       read_at,
       archived_at`,
    values
  );

  const updatedNotification = result.rows[0] || null;
  if (updatedNotification) {
    await writeAuditLog(
      {
        user_id: auth?.userId || null,
        action: "ARCHIVE_NOTIFICATION",
        module: "Notifications",
        description: `Archived notification ${publicRef}.`,
        metadata: {
          public_reference: publicRef,
          status: updatedNotification.status,
          timestamp: updatedNotification.archived_at
        }
      },
      executor
    );
  }

  return updatedNotification;
};

const restoreNotification = async ({ auth, publicRef, executor = db }) => {
  const values = [publicRef];
  const clauses = ["n.public_reference = $1", "n.archived_at IS NOT NULL"];
  addVisibleNotificationClauses(auth, clauses, values, "n", {
    includeArchived: true,
    includeExpired: true
  });

  const result = await executor.query(
    `UPDATE notifications n
     SET archived_at = NULL,
         archived_by = NULL
     WHERE ${clauses.join(" AND ")}
     RETURNING
       public_reference,
       notification_type,
       title,
       message,
       related_module,
       related_entity_type,
       priority,
       status,
       completed_at,
       is_read,
       read_at,
       created_at,
       expires_at,
       archived_at`,
    values
  );

  const restoredNotification = result.rows[0] || null;
  if (restoredNotification) {
    await writeAuditLog(
      {
        user_id: auth?.userId || null,
        action: "RESTORE_NOTIFICATION",
        module: "Notifications",
        description: `Restored notification ${publicRef}.`,
        metadata: {
          public_reference: publicRef,
          status: restoredNotification.status,
          timestamp: new Date().toISOString()
        }
      },
      executor
    );
  }

  return restoredNotification;
};

const resolveNotificationsByEntity = async ({ relatedEntityType, relatedEntityId, notificationTypes, executor = db }) => {
  if (!Array.isArray(notificationTypes) || notificationTypes.length === 0) {
    return { rowCount: 0, rows: [] };
  }

  const result = await executor.query(
    `UPDATE notifications
     SET status = 'completed',
         completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
         is_read = TRUE,
         read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
     WHERE status = 'pending'
       AND related_entity_type = $1
       AND related_entity_id = $2
       AND notification_type = ANY($3::text[])
     RETURNING
       public_reference,
       notification_type,
       status,
       completed_at,
       is_read,
       read_at`,
    [relatedEntityType, relatedEntityId, notificationTypes]
  );

  return {
    rowCount: result.rowCount,
    rows: result.rows
  };
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
          public_references: notifications.map((notification) => notification.public_reference),
          notification_type: NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT,
          timestamp: new Date().toISOString()
        }
    },
    executor
  );

  return notifications;
};

const notifyCargoRegistrationPending = async ({ cargo, approvalRequestId, actorId }, executor = db) => (
  emitPolicyEvent("cargo.review_required",{cargo,warehouse_id:cargo.warehouse_id||cargo.warehouse_id_at_registration,actor_id:actorId,action_reference:cargo.approval_public_reference,metadata:{approval_request_id:approvalRequestId||null}},executor)
);

const notifyFinanceChargeStarted = async ({ cargo, actorId }, executor = db) => (
  emitPolicyEvent("finance.charge_started",{cargo,actor_id:actorId,metadata:{charge_start_at:cargo.charge_start_at||cargo.created_at}},executor)
);

const notifyCustomsAwaitingInspection = async ({ cargo, actorId }, executor = db) => (
  emitPolicyEvent("customs.inspection_required",{cargo,actor_id:actorId},executor)
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

const notifyPendingReviewEscalations = async ({ thresholdHours, targetRoleName } = {}, executor = db) => {
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
    const notifications = await emitPolicyEvent("cargo.review_overdue",{
        cargo:{id:row.cargo_record_id,cargo_id:row.cargo_id,warehouse_id:row.warehouse_id},
        warehouse_id:row.warehouse_id,waiting_hours:waitingHours,
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
          legacy_target_role_setting: targetRoleName || null
        }
      },executor);
    created.push(...notifications);
  }

  return created;
};

const notifyCorrectionRequested = async ({ cargo, approvalRequestId, correctionFields = [], notes, actorId }, executor = db) => {
  const ownerId = getStaffOwnerId(cargo);
  if (!ownerId) return [];
  return emitPolicyEvent("cargo.correction_requested",{cargo:{...cargo,id:cargo.id||cargo.cargo_record_id},recipient_user_id:ownerId,notes,actor_id:actorId,metadata:{approval_request_id:approvalRequestId||null,correction_fields:correctionFields}},executor);
};

const notifyRegistrationDecision = async ({ cargo, approvalRequestId, decision, notes, actorId }, executor = db) => {
  const ownerId = getStaffOwnerId(cargo);
  if (!ownerId) return [];
  return emitPolicyEvent(decision === "Approved" ? "cargo.registration_approved" : "cargo.registration_rejected",{cargo:{...cargo,id:cargo.id||cargo.cargo_record_id},recipient_user_id:ownerId,decision,notes,actor_id:actorId,metadata:{approval_request_id:approvalRequestId||null}},executor);
};

const notifyPlacementOverridePending = async ({ cargo, bin, approvalRequestId, actorId }, executor = db) => (
  emitPolicyEvent("placement.override_requested",{cargo,warehouse_id:cargo?.warehouse_id,actor_id:actorId,metadata:{approval_request_id:approvalRequestId||null,bin_barcode:bin?.barcode||null}},executor)
);

const notifyPlacementOverrideDecision = async ({ cargo, approval, decision, notes, actorId }, executor = db) => {
  const requesterId = readPositiveId(approval?.requested_by);
  if (!requesterId) return [];
  return emitPolicyEvent(decision === "Approved" ? "placement.override_approved" : "placement.override_rejected",{cargo:{...cargo,id:cargo?.id||approval?.cargo_record_id},recipient_user_id:requesterId,decision,notes,actor_id:actorId,metadata:{approval_request_id:approval?.id||null}},executor);
};

const notifyDispatchSubmitted = async ({ cargo, dispatchRequestId, dispatchPublicReference, requesterId, actorId }, executor = db) => {
  const notifications = await emitPolicyEvent("dispatch.requested",{cargo,warehouse_id:cargo.warehouse_id,actor_id:actorId,action_reference:dispatchPublicReference,metadata:{dispatch_request_id:dispatchRequestId||null}},executor);

  if (requesterId) {
    notifications.push(...await emitPolicyEvent("dispatch.submitted",{cargo,recipient_user_id:requesterId,actor_id:actorId,metadata:{dispatch_request_id:dispatchRequestId||null}},executor));
  }

  return notifications;
};

const notifyDispatchDecision = async ({ cargo, dispatchRequest, decision, notes, actorId }, executor = db) => {
  const requesterId = readPositiveId(dispatchRequest?.requested_by);
  const notifications = [];
  if (requesterId) {
    notifications.push(...await emitPolicyEvent(decision === "Approved" ? "dispatch.approved" : "dispatch.rejected",{cargo:{...cargo,id:cargo.id||dispatchRequest?.cargo_record_id},recipient_user_id:requesterId,decision,notes,actor_id:actorId,metadata:{dispatch_request_id:dispatchRequest?.id||null}},executor));
  }

  if (decision === "Approved") {
    notifications.push(...await emitPolicyEvent("gate.release_ready",{cargo:{...cargo,id:cargo.id||dispatchRequest?.cargo_record_id},actor_id:actorId,action_reference:dispatchRequest?.public_reference,metadata:{dispatch_request_id:dispatchRequest?.id||null}},executor));
  }

  return notifications;
};

const notifyGateReleaseBlocked = async ({ cargo, outstandingAmount, blockedRequirements = [], actorId }, executor = db) => {
  const context={cargo,actor_id:actorId,outstanding_amount:outstandingAmount||"0.00",metadata:{outstanding_amount:outstandingAmount||"0.00",blocked_requirements:blockedRequirements}};
  const financeNotifications=await emitPolicyEvent("finance.release_blocked",context,executor);
  const gateNotifications=await emitPolicyEvent("gate.release_blocked",context,executor);

  return [...financeNotifications, ...gateNotifications];
};

const notifyEmergencyReleaseCompleted = async ({ cargo, outstandingAmount, actorId }, executor = db) => (
  emitPolicyEvent("finance.emergency_balance",{cargo,actor_id:actorId,outstanding_amount:outstandingAmount||"0.00",metadata:{outstanding_amount:outstandingAmount||"0.00"}},executor)
);

const notifyWarehouseAlert = async ({ title, message, warehouseId, relatedEntityType, relatedEntityId, priority = "high", metadata = {}, actorId = null }, executor = db) => {
  return emitPolicyEvent("warehouse.alert",{title,message,warehouse_id:warehouseId,related_entity_type:relatedEntityType,related_entity_id:relatedEntityId,actor_id:actorId,metadata},executor);
};

module.exports = {
  ACTIONABLE_WORKFLOW_TYPES,
  NOTIFICATION_TYPES,
  PRIORITIES,
  addVisibleNotificationClauses,
  archiveNotification,
  createNotification,
  createNotificationsForAudience,
  createSystemAnnouncement,
  getRoleIdByName,
  getNotificationSummary,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  resolveNotificationsByEntity,
  restoreNotification,
  generateNotificationReference,
  notifyCustomsAwaitingInspection,
  notifyCargoRegistrationPending,
  notifyCorrectionRequested,
  notifyEmergencyReleaseCompleted,
  notifyFinanceChargeStarted,
  notifyPendingReviewEscalations,
  notifyDispatchDecision,
  notifyDispatchSubmitted,
  notifyGateReleaseBlocked,
  notifyPlacementOverrideDecision,
  notifyPlacementOverridePending,
  notifyRegistrationDecision,
  notifyWarehouseAlert,
  normalizePriority
};

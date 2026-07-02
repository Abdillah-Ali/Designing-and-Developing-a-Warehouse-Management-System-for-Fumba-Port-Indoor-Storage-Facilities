const test = require("node:test");
const assert = require("node:assert/strict");

const {
  NOTIFICATION_TYPES,
  createNotification,
  createNotificationsForAudience,
  createSystemAnnouncement,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  notifyCargoRegistrationPending,
  notifyCorrectionRequested,
  notifyDispatchSubmitted,
  notifyWarehouseAlert
} = require("../services/notificationService");
const {
  PORTAL_ROLES,
  canAccessRoute
} = require("../middleware/authMiddleware");

const roles = [
  { id: 1, role_name: "System Admin" },
  { id: 2, role_name: "Warehouse Staff" },
  { id: 3, role_name: "Supervisor" }
];

const users = [
  { id: 1, role_id: 1, role_name: "System Admin", warehouse_id: null, status: "active" },
  { id: 2, role_id: 2, role_name: "Warehouse Staff", warehouse_id: 1, status: "active" },
  { id: 3, role_id: 3, role_name: "Supervisor", warehouse_id: 1, status: "active" },
  { id: 4, role_id: 3, role_name: "Supervisor", warehouse_id: 2, status: "active" },
  { id: 5, role_id: 2, role_name: "Warehouse Staff", warehouse_id: 1, status: "inactive" }
];

const createExecutor = (overrides = {}) => {
  const state = {
    roles: overrides.roles || roles,
    users: overrides.users || users,
    notifications: [],
    auditLogs: [],
    queries: [],
    nextNotificationId: 1
  };

  const filterAudienceUsers = (sql, params) => {
    let rows = state.users.filter((user) => user.status === "active");
    const userIds = params.find((value) => Array.isArray(value));
    const roleName = params.find((value) => typeof value === "string");
    const numericParams = params.filter((value) => !Array.isArray(value) && Number.isInteger(Number(value)));

    if (userIds) {
      rows = rows.filter((user) => userIds.map(Number).includes(user.id));
    }

    if (sql.includes("u.role_id =")) {
      const roleId = Number(numericParams[0]);
      rows = rows.filter((user) => user.role_id === roleId);
    }

    if (roleName) {
      rows = rows.filter((user) => user.role_name === roleName);
    }

    if (sql.includes("u.warehouse_id =")) {
      const warehouseId = Number(numericParams[numericParams.length - 1]);
      rows = rows.filter((user) => user.warehouse_id === warehouseId);
    }

    return rows.map(({ id, role_id, warehouse_id }) => ({ id, role_id, warehouse_id }));
  };

  const query = async (sql, params = []) => {
    state.queries.push({ sql, params });

    if (sql.includes("SELECT id FROM roles")) {
      const role = state.roles.find((entry) => entry.role_name === params[0]);
      return { rowCount: role ? 1 : 0, rows: role ? [{ id: role.id }] : [] };
    }

    if (sql.includes("SELECT u.id, u.role_id, u.warehouse_id")) {
      const rows = filterAudienceUsers(sql, params);
      return { rowCount: rows.length, rows };
    }

    if (sql.includes("INSERT INTO notifications")) {
      const notification = {
        id: state.nextNotificationId++,
        recipient_user_id: params[0],
        recipient_role_id: params[1],
        recipient_warehouse_id: params[2],
        notification_type: params[3],
        title: params[4],
        message: params[5],
        related_module: params[6],
        related_entity_type: params[7],
        related_entity_id: params[8],
        priority: params[9],
        created_by: params[10],
        expires_at: params[11],
        metadata: JSON.parse(params[12]),
        is_read: false,
        read_at: null,
        archived_at: null,
        created_at: "2026-06-26T10:00:00.000Z"
      };
      state.notifications.push(notification);
      return { rowCount: 1, rows: [notification] };
    }

    if (sql.includes("INSERT INTO audit_logs")) {
      const auditLog = {
        user_id: params[0],
        target_user_id: params[1],
        action: params[4],
        module: params[5],
        description: params[6],
        metadata: JSON.parse(params[7])
      };
      state.auditLogs.push(auditLog);
      return { rowCount: 1, rows: [{ id: state.auditLogs.length, ...auditLog }] };
    }

    if (sql.includes("SELECT COUNT(*)::int AS count")) {
      const count = state.notifications.filter((notification) => !notification.is_read && !notification.archived_at).length;
      return { rowCount: 1, rows: [{ count }] };
    }

    if (sql.includes("SELECT COUNT(*)::int AS total")) {
      return { rowCount: 1, rows: [{ total: state.notifications.length }] };
    }

    if (sql.includes("UPDATE notifications n") && sql.includes("SET is_read = TRUE") && sql.includes("n.id = $1")) {
      const notification = state.notifications.find((entry) => entry.id === Number(params[0]));
      if (!notification) return { rowCount: 0, rows: [] };
      notification.is_read = true;
      notification.read_at = "2026-06-26T10:05:00.000Z";
      return { rowCount: 1, rows: [notification] };
    }

    if (sql.includes("UPDATE notifications n") && sql.includes("SET is_read = TRUE")) {
      const rows = state.notifications
        .filter((notification) => !notification.is_read && !notification.archived_at)
        .map((notification) => {
          notification.is_read = true;
          notification.read_at = "2026-06-26T10:10:00.000Z";
          return {
            id: notification.id,
            notification_type: notification.notification_type
          };
        });
      return { rowCount: rows.length, rows };
    }

    throw new Error(`Unexpected query: ${sql}`);
  };

  return { ...state, query };
};

const staffAuth = {
  role: PORTAL_ROLES.WAREHOUSE_STAFF,
  userId: 2,
  roleId: 2,
  warehouseId: 1
};

test("notification RBAC allows reading notifications but restricts announcements to admins", () => {
  assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "GET", "/notifications"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "PATCH", "/notifications/12/read"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "POST", "/notifications/system-announcement"), false);
  assert.equal(canAccessRoute(PORTAL_ROLES.SYSTEM_ADMIN, "POST", "/notifications/system-announcement"), true);
});

test("createNotification persists session-derived target data and writes audit log", async () => {
  const executor = createExecutor();

  const notification = await createNotification({
    recipient_user_id: 2,
    notification_type: NOTIFICATION_TYPES.APPROVAL_DECISION,
    title: "Cargo approved",
    message: "CARGO-2026-0001 was approved.",
    related_module: "Cargo Approvals",
    related_entity_type: "cargo",
    related_entity_id: 101,
    priority: "high",
    created_by: 3,
    metadata: { decision: "Approved" }
  }, executor);

  assert.equal(notification.recipient_user_id, 2);
  assert.equal(notification.notification_type, NOTIFICATION_TYPES.APPROVAL_DECISION);
  assert.equal(notification.priority, "high");
  assert.deepEqual(notification.metadata, { decision: "Approved" });
  assert.equal(executor.auditLogs.at(-1).action, "CREATE_NOTIFICATION");
});

test("unread counts include role and warehouse visibility clauses for non-admins", async () => {
  const executor = createExecutor();
  await createNotification({
    recipient_user_id: 2,
    notification_type: NOTIFICATION_TYPES.CORRECTION_REQUEST,
    title: "Correction required",
    message: "Please update declared cargo weight."
  }, executor, { audit: false });

  const count = await getUnreadCount({ auth: staffAuth, executor });
  const countQuery = executor.queries.find((entry) => entry.sql.includes("SELECT COUNT(*)::int AS count"));

  assert.equal(count, 1);
  assert.match(countQuery.sql, /recipient_user_id/);
  assert.match(countQuery.sql, /recipient_role_id/);
  assert.match(countQuery.sql, /recipient_warehouse_id/);
});

test("mark read actions update notifications and write audit entries", async () => {
  const executor = createExecutor();
  const first = await createNotification({
    recipient_user_id: 2,
    notification_type: NOTIFICATION_TYPES.DISPATCH_REQUEST,
    title: "Dispatch submitted",
    message: "Dispatch request submitted."
  }, executor, { audit: false });
  await createNotification({
    recipient_user_id: 2,
    notification_type: NOTIFICATION_TYPES.WAREHOUSE_ALERT,
    title: "Bin full",
    message: "A bin is full."
  }, executor, { audit: false });

  const read = await markNotificationRead({
    auth: staffAuth,
    notificationId: first.id,
    executor
  });
  const remaining = await markAllNotificationsRead({ auth: staffAuth, executor });

  assert.equal(read.is_read, true);
  assert.equal(remaining.length, 1);
  assert.equal(executor.auditLogs.some((entry) => entry.action === "READ_NOTIFICATION"), true);
  assert.equal(executor.auditLogs.some((entry) => entry.action === "READ_ALL_NOTIFICATIONS"), true);
});

test("audience notifications expand to each active matching user", async () => {
  const executor = createExecutor();

  const created = await createNotificationsForAudience(
    {
      notification_type: NOTIFICATION_TYPES.PENDING_APPROVAL,
      title: "Review needed",
      message: "A request is waiting."
    },
    { roleName: "Supervisor", warehouseId: 1 },
    executor,
    { audit: false }
  );

  assert.deepEqual(created.map((notification) => notification.recipient_user_id), [3]);
  assert.equal(created[0].recipient_role_id, 3);
  assert.equal(created[0].recipient_warehouse_id, 1);
});

test("system announcements create user-scoped notifications and a system audit record", async () => {
  const executor = createExecutor();

  const created = await createSystemAnnouncement({
    title: "System maintenance",
    message: "WMS will be unavailable at midnight.",
    priority: "urgent"
  }, { userId: 1 }, executor);

  assert.equal(created.length, 4);
  assert.equal(created.every((notification) => notification.notification_type === NOTIFICATION_TYPES.SYSTEM_ANNOUNCEMENT), true);
  assert.equal(executor.auditLogs.some((entry) => entry.action === "CREATE_SYSTEM_ANNOUNCEMENT"), true);
});

test("role-targeted announcements are visible to active users in that role only", async () => {
  const executor = createExecutor();

  const created = await createSystemAnnouncement({
    title: "Staff briefing",
    message: "Warehouse staff briefing starts at 09:00.",
    target_role_id: 2
  }, { userId: 1 }, executor);

  assert.deepEqual(created.map((notification) => notification.recipient_user_id), [2]);
  assert.equal(created.some((notification) => notification.recipient_user_id === 5), false);
});

test("warehouse-targeted announcements are visible to active users assigned to that warehouse", async () => {
  const executor = createExecutor();

  const created = await createSystemAnnouncement({
    title: "Warehouse A notice",
    message: "Warehouse A is running a cycle count.",
    target_warehouse_id: 1
  }, { userId: 1 }, executor);

  assert.deepEqual(created.map((notification) => notification.recipient_user_id), [2, 3]);
});

test("role and warehouse targeted announcements require both user attributes", async () => {
  const executor = createExecutor();

  const created = await createSystemAnnouncement({
    title: "Warehouse B supervisor notice",
    message: "Supervisor handover is due.",
    target_role_id: 3,
    target_warehouse_id: 2
  }, { userId: 1 }, executor);

  assert.deepEqual(created.map((notification) => notification.recipient_user_id), [4]);
});

test("specific user announcements require an active user matching selected filters", async () => {
  const executor = createExecutor();

  const created = await createSystemAnnouncement({
    title: "Personal notice",
    message: "Please review your queue.",
    target_user_id: 2,
    target_role_id: 2,
    target_warehouse_id: 1
  }, { userId: 1 }, executor);

  assert.deepEqual(created.map((notification) => notification.recipient_user_id), [2]);

  await assert.rejects(
    () => createSystemAnnouncement({
      title: "Mismatched personal notice",
      message: "This should not be delivered broadly.",
      target_user_id: 2,
      target_role_id: 3,
      target_warehouse_id: 1
    }, { userId: 1 }, executor),
    /does not match/
  );
});

test("workflow helpers create targeted operational notifications", async () => {
  const executor = createExecutor();

  await notifyCargoRegistrationPending({
    cargo: { id: 101, cargo_id: "CARGO-2026-0001", warehouse_id: 1 },
    approvalRequestId: 501,
    actorId: 2
  }, executor);
  await notifyCorrectionRequested({
    cargo: { id: 101, cargo_id: "CARGO-2026-0001", assigned_staff_id: 2 },
    approvalRequestId: 501,
    correctionFields: ["weight"],
    notes: "Weight needs correction.",
    actorId: 3
  }, executor);
  await notifyDispatchSubmitted({
    cargo: { id: 101, cargo_id: "CARGO-2026-0001", warehouse_id: 1 },
    dispatchRequestId: 601,
    requesterId: 2,
    actorId: 2
  }, executor);
  await notifyWarehouseAlert({
    title: "Blocked bin",
    message: "A bin was blocked.",
    warehouseId: 1,
    relatedEntityType: "bin",
    relatedEntityId: 77,
    actorId: 1
  }, executor);

  assert.equal(executor.notifications.some((entry) => entry.notification_type === NOTIFICATION_TYPES.PENDING_APPROVAL), true);
  assert.equal(executor.notifications.some((entry) => entry.notification_type === NOTIFICATION_TYPES.CORRECTION_REQUEST), true);
  assert.equal(executor.notifications.some((entry) => entry.notification_type === NOTIFICATION_TYPES.DISPATCH_REQUEST), true);
  assert.equal(executor.notifications.some((entry) => entry.notification_type === NOTIFICATION_TYPES.WAREHOUSE_ALERT), true);
  assert.equal(
    executor.notifications.some((entry) => entry.title === "Blocked bin" && entry.recipient_user_id === 1),
    true
  );
});

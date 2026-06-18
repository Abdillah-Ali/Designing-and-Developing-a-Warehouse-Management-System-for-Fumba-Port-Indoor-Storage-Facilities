const { roleNames } = require("../config/systemConfig");
const {
  PLACEMENT_STATUS,
  REGISTRATION_STATUS
} = require("./cargoWorkflowService");

const TRANSFER_BLOCKED_MESSAGE =
  "Cannot transfer this user because they have pending warehouse tasks. Complete or reassign pending tasks before changing warehouse.";

const STAFF_TASK_OWNER_SQL = "COALESCE(c.assigned_staff_id, c.created_by, c.received_by_user_id)";
const APPROVAL_ASSIGNEE_SQL = "COALESCE(ar.assigned_to, ar.assigned_supervisor_id)";

const isWarehouseStaffRole = (roleName) => roleName === roleNames.warehouseStaff;
const isWarehouseSupervisorRole = (roleName) => roleName === roleNames.warehouseSupervisor;

const countRows = async (executor, sql, values) => {
  const result = await executor.query(sql, values);
  return Number(result.rows[0]?.count || 0);
};

const addTask = (tasks, code, label, count) => {
  if (count > 0) {
    tasks.push({ code, label, count });
  }
};

const getStaffPendingTasks = async (executor, userId) => {
  const correctionRequired = await countRows(
    executor,
    `SELECT COUNT(*)::int AS count
     FROM cargo c
     WHERE ${STAFF_TASK_OWNER_SQL} = $1
       AND c.registration_status = $2
       AND c.is_deleted = FALSE`,
    [userId, REGISTRATION_STATUS.CORRECTION_REQUIRED]
  );

  const activeRegistration = await countRows(
    executor,
    `SELECT COUNT(*)::int AS count
     FROM cargo c
     WHERE ${STAFF_TASK_OWNER_SQL} = $1
       AND c.registration_status = $2
       AND c.is_deleted = FALSE`,
    [userId, REGISTRATION_STATUS.PENDING_REVIEW]
  );

  const pendingPlacement = await countRows(
    executor,
    `SELECT COUNT(*)::int AS count
     FROM cargo c
     WHERE ${STAFF_TASK_OWNER_SQL} = $1
       AND c.placement_status = $2
       AND c.registration_status <> $3
       AND c.is_deleted = FALSE`,
    [userId, PLACEMENT_STATUS.UNPLACED, REGISTRATION_STATUS.REJECTED]
  );

  const placementOverrides = await countRows(
    executor,
    `SELECT COUNT(*)::int AS count
     FROM approval_requests ar
     JOIN cargo c ON c.id = ar.cargo_id
     WHERE ar.requested_by = $1
       AND ar.request_type = 'PLACEMENT_OVERRIDE'
       AND ar.status = 'Pending'
       AND c.is_deleted = FALSE`,
    [userId]
  );

  const tasks = [];
  addTask(tasks, "staff_corrections", "Correction-required cargo assigned to this staff member", correctionRequired);
  addTask(tasks, "staff_active_registrations", "Cargo registrations still in supervisor review", activeRegistration);
  addTask(tasks, "staff_pending_placement", "Unplaced cargo assigned to this staff member", pendingPlacement);
  addTask(tasks, "staff_placement_overrides", "Pending placement override requests from this staff member", placementOverrides);

  return tasks;
};

const getSupervisorPendingTasks = async (executor, userId) => {
  const pendingApprovals = await countRows(
    executor,
    `SELECT COUNT(*)::int AS count
     FROM approval_requests ar
     JOIN cargo c ON c.id = ar.cargo_id
     WHERE ${APPROVAL_ASSIGNEE_SQL} = $1
       AND ar.status = 'Pending'
       AND c.is_deleted = FALSE`,
    [userId]
  );

  const tasks = [];
  addTask(tasks, "supervisor_pending_approvals", "Pending approval requests assigned to this supervisor", pendingApprovals);

  return tasks;
};

const getPendingWarehouseTaskSummary = async (executor, userId, roleName) => {
  const tasks = [];

  if (!roleName || isWarehouseStaffRole(roleName)) {
    tasks.push(...await getStaffPendingTasks(executor, userId));
  }

  if (!roleName || isWarehouseSupervisorRole(roleName)) {
    tasks.push(...await getSupervisorPendingTasks(executor, userId));
  }

  const total = tasks.reduce((sum, task) => sum + task.count, 0);

  return {
    can_transfer: total === 0,
    total_pending_tasks: total,
    tasks,
    message: total > 0 ? TRANSFER_BLOCKED_MESSAGE : ""
  };
};

const reassignStaffPendingTasks = async (executor, sourceUserId, targetUserId) => {
  const result = await executor.query(
    `UPDATE cargo c
     SET assigned_staff_id = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE ${STAFF_TASK_OWNER_SQL} = $1
       AND c.is_deleted = FALSE
       AND (
         c.registration_status IN ($3, $4)
         OR (
           c.placement_status = $5
           AND c.registration_status <> $6
         )
       )
     RETURNING id, cargo_id`,
    [
      sourceUserId,
      targetUserId,
      REGISTRATION_STATUS.PENDING_REVIEW,
      REGISTRATION_STATUS.CORRECTION_REQUIRED,
      PLACEMENT_STATUS.UNPLACED,
      REGISTRATION_STATUS.REJECTED
    ]
  );

  return {
    reassigned_count: result.rowCount,
    cargo: result.rows
  };
};

const reassignSupervisorPendingTasks = async (executor, sourceUserId, targetUserId) => {
  const result = await executor.query(
    `UPDATE approval_requests ar
     SET assigned_to = $2,
         assigned_supervisor_id = $2
     FROM cargo c
     WHERE c.id = ar.cargo_id
       AND ${APPROVAL_ASSIGNEE_SQL} = $1
       AND ar.status = 'Pending'
       AND c.is_deleted = FALSE
     RETURNING ar.id, ar.cargo_id, ar.request_type`,
    [sourceUserId, targetUserId]
  );

  return {
    reassigned_count: result.rowCount,
    approvals: result.rows
  };
};

module.exports = {
  APPROVAL_ASSIGNEE_SQL,
  STAFF_TASK_OWNER_SQL,
  TRANSFER_BLOCKED_MESSAGE,
  getPendingWarehouseTaskSummary,
  isWarehouseStaffRole,
  isWarehouseSupervisorRole,
  reassignStaffPendingTasks,
  reassignSupervisorPendingTasks
};

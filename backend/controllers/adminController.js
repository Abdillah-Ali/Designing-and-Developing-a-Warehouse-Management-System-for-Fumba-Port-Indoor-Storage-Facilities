const db = require("../config/db");
const {
  closeUserSession,
  createUserSession,
  createUser: insertUser,
  getUserById,
  invalidateUserSessions,
  listAuditLogs: fetchAuditLogs,
  listRoles: fetchRoles,
  listShifts: fetchShifts,
  listUserSessions: fetchUserSessions,
  listUsers: fetchUsers,
  listWarehouses: fetchWarehouses,
  updateLastLogin,
  updateUser: patchUser,
  writeAuditLog
} = require("../models/adminModel");
const { buildError } = require("../utils/apiError");
const { hashPassword, verifyPassword } = require("../utils/password");
const { createToken, verifyToken } = require("../utils/token");
const { roleNames } = require("../config/systemConfig");
const {
  TRANSFER_BLOCKED_MESSAGE,
  getPendingWarehouseTaskSummary,
  isWarehouseStaffRole,
  isWarehouseSupervisorRole,
  reassignStaffPendingTasks,
  reassignSupervisorPendingTasks
} = require("../services/taskOwnershipService");

const allowedUserStatuses = ["active", "inactive", "suspended"];
const allowedPortalRoleNames = Object.values(roleNames);
const passwordPolicyMessage = "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.";
const databaseUnavailableMessage = "Unable to access system services. Please contact the administrator.";
const databaseConnectivityCodes = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "53300",
  "53400",
  "57P01",
  "57P02",
  "57P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN"
]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[0-9][0-9\s()-]{6,18}[0-9]$/;
const usernamePattern = /^[A-Za-z0-9._-]{3,50}$/;
const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

const cleanString = (value) => {
  if (value === undefined || value === null) return value;
  return String(value).trim();
};

const readId = (value, fieldName, required = false) => {
  if (value === undefined || value === null || value === "") {
    if (required) throw buildError(`${fieldName} is required.`, 400);
    return null;
  }

  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw buildError(`${fieldName} must be a valid record id.`, 400);
  }

  return id;
};

const normalizeUserPayload = (body, mode = "create") => {
  const payload = {};
  const fields = ["full_name", "username", "email", "phone_number", "password", "status"];

  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = cleanString(body[field]);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "role_id")) {
    payload.role_id = readId(body.role_id, "Role", mode === "create");
    if (payload.role_id === null) {
      throw buildError("Role is required.", 400);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "warehouse_id")) {
    payload.warehouse_id = readId(body.warehouse_id, "Warehouse");
  }

  if (Object.prototype.hasOwnProperty.call(body, "shift_id")) {
    payload.shift_id = readId(body.shift_id, "Shift");
  }

  const requiredFields = ["full_name", "username", "email", "phone_number"];
  for (const field of requiredFields) {
    if (mode === "create" && !payload[field]) {
      throw buildError(`${field.replace("_", " ")} is required.`, 400);
    }
  }

  if (mode === "create" && !payload.role_id) {
    throw buildError("Role is required.", 400);
  }

  if (mode === "create" && !payload.password) {
    throw buildError("Password is required.", 400);
  }

  if (payload.password && !passwordPattern.test(payload.password)) {
    throw buildError(passwordPolicyMessage, 400);
  }

  if (payload.status !== undefined) {
    payload.status = payload.status.toLowerCase();
    if (!allowedUserStatuses.includes(payload.status)) {
      throw buildError("User status must be active, inactive, or suspended.", 400);
    }
  }

  if (mode === "create" && !payload.status) {
    payload.status = "active";
  }

  return payload;
};

const validateUserRecord = async (client, payload, existing = null) => {
  const candidate = {
    ...existing,
    ...payload
  };

  if (!candidate.full_name || candidate.full_name.length < 2 || candidate.full_name.length > 150) {
    throw buildError("Full name must be between 2 and 150 characters.", 400);
  }

  if (!candidate.username || !usernamePattern.test(candidate.username)) {
    throw buildError("Username must be 3 to 50 characters and may contain letters, numbers, dots, underscores, or hyphens.", 400);
  }

  if (!candidate.email || !emailPattern.test(candidate.email)) {
    throw buildError("Enter a valid email address.", 400);
  }

  if (!candidate.phone_number || !phonePattern.test(candidate.phone_number)) {
    throw buildError("Enter a valid phone number using digits and an optional leading +.", 400);
  }

  if (!candidate.role_id) {
    throw buildError("Role is required.", 400);
  }

  const roleResult = await client.query(
    "SELECT id, role_name FROM roles WHERE id = $1",
    [candidate.role_id]
  );
  if (roleResult.rowCount === 0) {
    throw buildError("Selected role was not found.", 400);
  }

  const role = roleResult.rows[0];

  if (candidate.warehouse_id) {
    const warehouseResult = await client.query(
      "SELECT id FROM warehouses WHERE id = $1",
      [candidate.warehouse_id]
    );
    if (warehouseResult.rowCount === 0) {
      throw buildError("Selected warehouse was not found.", 400);
    }
  }

  if (candidate.shift_id) {
    const shiftResult = await client.query(
      "SELECT id FROM shifts WHERE id = $1",
      [candidate.shift_id]
    );
    if (shiftResult.rowCount === 0) {
      throw buildError("Selected shift was not found.", 400);
    }
  }

  if (role.role_name === roleNames.warehouseStaff && (!candidate.warehouse_id || !candidate.shift_id)) {
    throw buildError("Warehouse Staff must be assigned to both a warehouse and a shift.", 400);
  }

  if (role.role_name === roleNames.warehouseSupervisor && !candidate.warehouse_id) {
    throw buildError("Warehouse Supervisor must be assigned to a warehouse.", 400);
  }

  const duplicateResult = await client.query(
    `SELECT
       CASE
         WHEN LOWER(username) = LOWER($1) THEN 'username'
         WHEN LOWER(email) = LOWER($2) THEN 'email'
       END AS duplicate_field
     FROM users
     WHERE (LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2))
       AND ($3::integer IS NULL OR id <> $3)
     LIMIT 1`,
    [candidate.username, candidate.email, existing?.id || null]
  );

  if (duplicateResult.rowCount > 0) {
    const field = duplicateResult.rows[0].duplicate_field;
    throw buildError(`A user with that ${field} already exists.`, 409);
  }

  return {
    candidate,
    role
  };
};

const getChangedFields = (existing, payload) => (
  Object.keys(payload).filter((field) => {
    if (field === "password") return Boolean(payload.password);
    const existingValue = existing[field] ?? null;
    const nextValue = payload[field] ?? null;
    return String(existingValue) !== String(nextValue);
  })
);

const writeBlockedModification = async (client, req, target, action, description, message) => {
  await writeAuditLog(
    {
      user_id: req.auth?.userId || null,
      target_user_id: target.id,
      action,
      module: "User Management",
      description,
      metadata: {
        target_username: target.username,
        attempted_by: req.auth?.username || null
      }
    },
    client
  );
  await client.query("COMMIT");
  const error = buildError(message, 403);
  error.transactionComplete = true;
  throw error;
};

const protectAdministrativeAccount = async (client, req, existing, candidate, operation) => {
  const roleDemotion = candidate?.role_name && candidate.role_name !== roleNames.systemAdmin;
  const disabling = candidate?.status && candidate.status !== "active";
  const deactivation = operation === "deactivate";
  const selfPasswordReset = operation === "password-reset";

  if (Number(existing.id) === Number(req.auth?.userId) && (roleDemotion || disabling || deactivation || selfPasswordReset)) {
    await writeBlockedModification(
      client,
      req,
      existing,
      "BLOCKED_SELF_LOCKOUT_ATTEMPT",
      `Blocked self-lockout attempt on administrator account ${existing.username}.`,
      "You cannot disable or demote your own administrator account."
    );
  }

  if (existing.is_system_user && !existing.is_bootstrap_admin && (roleDemotion || disabling || deactivation)) {
    await writeBlockedModification(
      client,
      req,
      existing,
      "BLOCKED_SYSTEM_USER_MODIFICATION",
      `Blocked protected system administrator modification for ${existing.username}.`,
      "System administrator account cannot be disabled or removed."
    );
  }

  if (existing.is_bootstrap_admin && roleDemotion) {
    await writeBlockedModification(
      client,
      req,
      existing,
      "BLOCKED_SYSTEM_USER_MODIFICATION",
      `Blocked role change for bootstrap administrator ${existing.username}.`,
      "The bootstrap administrator role cannot be changed."
    );
  }

  const removesActiveSystemAdmin = (
    existing.role_name === roleNames.systemAdmin
    && existing.status === "active"
    && (roleDemotion || disabling || deactivation)
  );

  if (removesActiveSystemAdmin) {
    const otherAdmins = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE r.role_name = 'System Admin'
         AND u.status = 'active'
         AND u.is_bootstrap_admin = FALSE
         AND u.id <> $1`,
      [existing.id]
    );

    if (otherAdmins.rows[0].count < 1) {
      const isBootstrap = Boolean(existing.is_bootstrap_admin);
      await writeBlockedModification(
        client,
        req,
        existing,
        isBootstrap ? "BLOCKED_BOOTSTRAP_DEACTIVATION" : "BLOCKED_LAST_SYSTEM_ADMIN_CHANGE",
        isBootstrap
          ? `Blocked bootstrap administrator deactivation for ${existing.username} because no other active System Administrator exists.`
          : `Blocked removal of the last active System Administrator account ${existing.username}.`,
        isBootstrap
          ? "Create and verify another active System Administrator before deactivating the bootstrap account."
          : "The system must retain at least one active System Administrator."
      );
    }
  }
};

const auditSessionInvalidation = async (client, req, target, reason, result) => {
  await writeAuditLog(
    {
      user_id: req.auth?.userId || null,
      target_user_id: target.id,
      action: "USER_SESSIONS_INVALIDATED",
      module: "User Management",
      description: `Closed ${result.rowCount} active session(s) for ${target.username} after ${reason}.`,
      metadata: {
        reason,
        sessions_closed: result.rowCount
      }
    },
    client
  );
};

const isWarehouseTransfer = (existing, payload) => (
  Object.prototype.hasOwnProperty.call(payload, "warehouse_id")
  && String(existing.warehouse_id ?? "") !== String(payload.warehouse_id ?? "")
);

const writeWarehouseTransferAttempt = async (client, req, existing, nextWarehouseId) => {
  await writeAuditLog(
    {
      user_id: req.auth?.userId || null,
      target_user_id: existing.id,
      action: "WAREHOUSE_TRANSFER_ATTEMPT",
      module: "User Management",
      description: `Attempted warehouse transfer for ${existing.username}.`,
      metadata: {
        old_warehouse_id: existing.warehouse_id || null,
        new_warehouse_id: nextWarehouseId || null,
        role_name: existing.role_name
      }
    },
    client
  );
};

const blockWarehouseTransfer = async (client, req, existing, nextWarehouseId, pendingSummary) => {
  await writeAuditLog(
    {
      user_id: req.auth?.userId || null,
      target_user_id: existing.id,
      action: "BLOCKED_WAREHOUSE_TRANSFER",
      module: "User Management",
      description: TRANSFER_BLOCKED_MESSAGE,
      metadata: {
        old_warehouse_id: existing.warehouse_id || null,
        new_warehouse_id: nextWarehouseId || null,
        pending_tasks: pendingSummary.tasks,
        pending_task_count: pendingSummary.total_pending_tasks
      }
    },
    client
  );

  await client.query("COMMIT");
  const error = buildError(TRANSFER_BLOCKED_MESSAGE, 409);
  error.details = pendingSummary;
  error.transactionComplete = true;
  throw error;
};

const mapDatabaseError = (error) => {
  if (error.code === "23505") {
    return buildError("A user with that username or email already exists.", 409);
  }

  if (error.code === "23503") {
    return buildError("Selected role, warehouse, or shift was not found.", 400);
  }

  if (error.code === "23502") {
    return buildError("Missing required user information.", 400);
  }

  return error;
};

const isDatabaseConnectivityError = (error) => (
  error?.code && databaseConnectivityCodes.has(error.code)
);

const sendRows = (res, result) => {
  res.json({
    success: true,
    count: result.rowCount,
    data: result.rows
  });
};

const getClientIp = (req) => (
  req.ip
  || req.socket?.remoteAddress
  || null
);

const buildAuthToken = (user, sessionId, mustChangePassword = user.must_change_password) => createToken({
  userId: user.id,
  user_id: user.id,
  username: user.username,
  role: user.role_name,
  roleId: user.role_id,
  role_id: user.role_id,
  warehouseId: user.warehouse_id || null,
  warehouse_id: user.warehouse_id || null,
  shiftId: user.shift_id || null,
  shift_id: user.shift_id || null,
  sessionId,
  session_id: sessionId,
  mustChangePassword: Boolean(mustChangePassword),
  must_change_password: Boolean(mustChangePassword),
  isSystemUser: Boolean(user.is_system_user),
  is_system_user: Boolean(user.is_system_user),
  isBootstrapAdmin: Boolean(user.is_bootstrap_admin),
  is_bootstrap_admin: Boolean(user.is_bootstrap_admin),
  bootstrapCompleted: Boolean(user.bootstrap_completed),
  bootstrap_completed: Boolean(user.bootstrap_completed)
}, process.env.JWT_EXPIRES_IN || "24h");

const getUsers = async (req, res, next) => {
  try {
    const result = await fetchUsers({
      search: cleanString(req.query.search),
      role_id: req.query.role_id ? readId(req.query.role_id, "Role") : null,
      role_name: cleanString(req.query.role_name),
      warehouse_id: req.query.warehouse_id ? readId(req.query.warehouse_id, "Warehouse") : null,
      status: cleanString(req.query.status)
    });

    sendRows(res, result);
  } catch (error) {
    next(error);
  }
};

const getUser = async (req, res, next) => {
  try {
    const id = readId(req.params.id, "User", true);
    const result = await getUserById(id);

    if (result.rowCount === 0) {
      throw buildError("User account not found.", 404);
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

const getUserPendingTasks = async (req, res, next) => {
  try {
    const id = readId(req.params.id, "User", true);
    const result = await getUserById(id);

    if (result.rowCount === 0) {
      throw buildError("User account not found.", 404);
    }

    const user = result.rows[0];
    const summary = await getPendingWarehouseTaskSummary(db, id, user.role_name);

    res.json({
      success: true,
      data: {
        user_id: id,
        role_name: user.role_name,
        ...summary
      }
    });
  } catch (error) {
    next(error);
  }
};

const reassignUserPendingTasks = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const sourceUserId = readId(req.params.id, "User", true);
    const targetUserId = readId(req.body?.target_user_id ?? req.body?.targetUserId, "Target user", true);
    const reason = cleanString(req.body?.reason) || "Pending tasks reassigned before warehouse transfer.";

    await client.query("BEGIN");

    const sourceResult = await getUserById(sourceUserId, client);
    if (sourceResult.rowCount === 0) {
      throw buildError("Source user account not found.", 404);
    }

    const targetResult = await getUserById(targetUserId, client);
    if (targetResult.rowCount === 0) {
      throw buildError("Target user account not found.", 404);
    }

    const source = sourceResult.rows[0];
    const target = targetResult.rows[0];
    if (target.status !== "active") {
      throw buildError("Pending tasks can only be reassigned to an active user.", 400);
    }

    let reassignment;
    if (isWarehouseStaffRole(source.role_name)) {
      if (!isWarehouseStaffRole(target.role_name)) {
        throw buildError("Staff pending tasks can only be reassigned to another Warehouse Staff user.", 400);
      }
      reassignment = await reassignStaffPendingTasks(client, sourceUserId, targetUserId);
    } else if (isWarehouseSupervisorRole(source.role_name)) {
      if (!isWarehouseSupervisorRole(target.role_name)) {
        throw buildError("Supervisor pending tasks can only be reassigned to another Supervisor.", 400);
      }
      reassignment = await reassignSupervisorPendingTasks(client, sourceUserId, targetUserId);
    } else {
      throw buildError("This user role does not own reassigned warehouse tasks.", 400);
    }

    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        target_user_id: sourceUserId,
        action: "PENDING_TASK_REASSIGNMENT",
        module: "User Management",
        description: `Reassigned pending warehouse tasks from ${source.username} to ${target.username}.`,
        metadata: {
          source_user_id: sourceUserId,
          source_username: source.username,
          target_user_id: targetUserId,
          target_username: target.username,
          source_role: source.role_name,
          target_role: target.role_name,
          reassigned_count: reassignment.reassigned_count,
          reason
        }
      },
      client
    );

    const remaining = await getPendingWarehouseTaskSummary(client, sourceUserId, source.role_name);
    await client.query("COMMIT");

    res.json({
      success: true,
      data: {
        reassignment,
        remaining_pending_tasks: remaining
      }
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(mapDatabaseError(error));
  } finally {
    client.release();
  }
};

const createUser = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const payload = normalizeUserPayload(req.body, "create");
    await client.query("BEGIN");
    const { role } = await validateUserRecord(client, payload);

    const passwordHash = await hashPassword(payload.password, client);
    const insertResult = await insertUser(payload, passwordHash, client);
    const userId = insertResult.rows[0].id;

    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        target_user_id: userId,
        action: "CREATE_USER",
        module: "User Management",
        description: `Created user account ${payload.username} with role ${role.role_name}.`,
        metadata: {
          role_id: payload.role_id,
          role_name: role.role_name,
          warehouse_id: payload.warehouse_id || null,
          shift_id: payload.shift_id || null,
          status: payload.status
        }
      },
      client
    );

    const userResult = await getUserById(userId, client);
    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      data: userResult.rows[0]
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(mapDatabaseError(error));
  } finally {
    client.release();
  }
};

const updateUser = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const id = readId(req.params.id, "User", true);
    const payload = normalizeUserPayload(req.body, "update");

    await client.query("BEGIN");

    const existingResult = await getUserById(id, client);
    if (existingResult.rowCount === 0) {
      throw buildError("User account not found.", 404);
    }

    const existing = existingResult.rows[0];
    const { candidate, role } = await validateUserRecord(client, payload, existing);
    candidate.role_name = role.role_name;
    await protectAdministrativeAccount(client, req, existing, candidate, payload.password ? "password-reset" : "update");

    const changedFields = getChangedFields(existing, payload);
    if (changedFields.length === 0) {
      throw buildError("No user details changed.", 400);
    }

    const warehouseTransfer = isWarehouseTransfer(existing, payload);
    let transferPendingSummary = null;
    if (
      warehouseTransfer
      && (isWarehouseStaffRole(existing.role_name) || isWarehouseSupervisorRole(existing.role_name))
    ) {
      await writeWarehouseTransferAttempt(client, req, existing, payload.warehouse_id || null);
      transferPendingSummary = await getPendingWarehouseTaskSummary(client, existing.id, existing.role_name);
      if (!transferPendingSummary.can_transfer) {
        await blockWarehouseTransfer(client, req, existing, payload.warehouse_id || null, transferPendingSummary);
      }
    }

    const passwordHash = payload.password ? await hashPassword(payload.password, client) : null;
    const passwordReset = Boolean(passwordHash);
    delete payload.password;

    const updateResult = await patchUser(id, payload, passwordHash, client);
    if (!updateResult) {
      throw buildError("No editable user fields were provided.", 400);
    }

    const statusChanged = changedFields.includes("status");
    const roleChanged = changedFields.includes("role_id");
    const assignmentChanged = changedFields.includes("warehouse_id") || changedFields.includes("shift_id");
    const profileChanged = changedFields.some((field) => (
      ["full_name", "username", "email", "phone_number", "warehouse_id", "shift_id"].includes(field)
    ));

    if (profileChanged) {
      await writeAuditLog(
        {
          user_id: req.auth?.userId || null,
          target_user_id: id,
          action: "UPDATE_USER",
          module: "User Management",
          description: `Updated user account ${existing.username}.`,
          metadata: { changed_fields: changedFields }
        },
        client
      );
    }

    if (warehouseTransfer) {
      await writeAuditLog(
        {
          user_id: req.auth?.userId || null,
          target_user_id: id,
          action: "SUCCESSFUL_WAREHOUSE_TRANSFER",
          module: "User Management",
          description: `Transferred ${existing.username} from warehouse ${existing.warehouse_id || "none"} to ${payload.warehouse_id || "none"}.`,
          metadata: {
            old_warehouse_id: existing.warehouse_id || null,
            new_warehouse_id: payload.warehouse_id || null,
            pending_task_count: transferPendingSummary?.total_pending_tasks || 0
          }
        },
        client
      );
      await writeAuditLog(
        {
          user_id: req.auth?.userId || null,
          target_user_id: id,
          action: "USER_ASSIGNMENT_CHANGE",
          module: "User Management",
          description: `Changed warehouse assignment for ${existing.username}.`,
          metadata: {
            old_warehouse_id: existing.warehouse_id || null,
            new_warehouse_id: payload.warehouse_id || null,
            changed_fields: changedFields
          }
        },
        client
      );
    }

    if (statusChanged) {
      const statusAction = payload.status === "active"
        ? "REACTIVATE_USER"
        : payload.status === "suspended"
          ? "SUSPEND_USER"
          : existing.is_bootstrap_admin
            ? "DEACTIVATE_BOOTSTRAP_ADMIN"
            : "DEACTIVATE_USER";
      await writeAuditLog(
        {
          user_id: req.auth?.userId || null,
          target_user_id: id,
          action: "UPDATE_USER_STATUS",
          module: "User Management",
          description: `Changed ${existing.username} status from ${existing.status} to ${payload.status}.`,
          metadata: { previous_status: existing.status, status: payload.status }
        },
        client
      );
      await writeAuditLog(
        {
          user_id: req.auth?.userId || null,
          target_user_id: id,
          action: statusAction,
          module: "User Management",
          description: `${statusAction.replaceAll("_", " ").toLowerCase()} for ${existing.username}.`,
          metadata: { status: payload.status }
        },
        client
      );
    }

    if (roleChanged) {
      await writeAuditLog(
        {
          user_id: req.auth?.userId || null,
          target_user_id: id,
          action: "UPDATE_USER_ROLE",
          module: "User Management",
          description: `Changed ${existing.username} role from ${existing.role_name} to ${role.role_name}.`,
          metadata: {
            previous_role_id: existing.role_id,
            previous_role_name: existing.role_name,
            role_id: payload.role_id,
            role_name: role.role_name
          }
        },
        client
      );
    }

    if (passwordReset) {
      await writeAuditLog(
        {
          user_id: req.auth?.userId || null,
          target_user_id: id,
          action: "ADMIN_RESET_PASSWORD",
          module: "User Management",
          description: `Administrator reset the password for ${existing.username}.`
        },
        client
      );
    }

    if (statusChanged || roleChanged || assignmentChanged || passwordReset) {
      const invalidated = await invalidateUserSessions(id, client);
      await auditSessionInvalidation(
        client,
        req,
        existing,
        statusChanged ? "status change" : roleChanged ? "role change" : passwordReset ? "password reset" : "assignment change",
        invalidated
      );
    }

    const userResult = await getUserById(id, client);
    await client.query("COMMIT");

    res.json({
      success: true,
      data: userResult.rows[0]
    });
  } catch (error) {
    if (!error.transactionComplete) await client.query("ROLLBACK");
    next(mapDatabaseError(error));
  } finally {
    client.release();
  }
};

const updateUserStatus = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const id = readId(req.params.id, "User", true);
    const status = cleanString(req.body.status)?.toLowerCase();
    if (!allowedUserStatuses.includes(status)) {
      throw buildError("User status must be active, inactive, or suspended.", 400);
    }

    await client.query("BEGIN");

    const existingResult = await getUserById(id, client);
    if (existingResult.rowCount === 0) {
      throw buildError("User account not found.", 404);
    }

    const existing = existingResult.rows[0];
    await protectAdministrativeAccount(
      client,
      req,
      existing,
      { status, role_name: existing.role_name },
      status === "inactive" ? "deactivate" : "status"
    );

    if (existing.status === status) {
      throw buildError(`User account is already ${status}.`, 400);
    }

    await patchUser(id, { status }, null, client);
    const invalidated = await invalidateUserSessions(id, client);

    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        target_user_id: id,
        action: "UPDATE_USER_STATUS",
        module: "User Management",
        description: `Changed ${existing.username} status from ${existing.status} to ${status}.`,
        metadata: { previous_status: existing.status, status }
      },
      client
    );

    const action = status === "active"
      ? "REACTIVATE_USER"
      : status === "suspended"
        ? "SUSPEND_USER"
        : existing.is_bootstrap_admin
          ? "DEACTIVATE_BOOTSTRAP_ADMIN"
          : "DEACTIVATE_USER";
    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        target_user_id: id,
        action,
        module: "User Management",
        description: `${status === "active" ? "Reactivated" : status === "suspended" ? "Suspended" : "Deactivated"} user account ${existing.username}.`
      },
      client
    );
    await auditSessionInvalidation(client, req, existing, "account status change", invalidated);

    const userResult = await getUserById(id, client);
    await client.query("COMMIT");

    res.json({
      success: true,
      data: userResult.rows[0]
    });
  } catch (error) {
    if (!error.transactionComplete) await client.query("ROLLBACK");
    next(mapDatabaseError(error));
  } finally {
    client.release();
  }
};

const deactivateUser = async (req, res, next) => {
  req.body = { ...req.body, status: "inactive" };
  return updateUserStatus(req, res, next);
};

const deleteUser = async (req, res, next) => {
  next(buildError("Hard deletion is disabled. Deactivate the user account instead.", 405));
};

const resetUserPassword = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const id = readId(req.params.id, "User", true);
    const password = cleanString(req.body.password ?? req.body.new_password);
    if (!password || !passwordPattern.test(password)) {
      throw buildError(passwordPolicyMessage, 400);
    }

    await client.query("BEGIN");
    const existingResult = await getUserById(id, client);
    if (existingResult.rowCount === 0) {
      throw buildError("User account not found.", 404);
    }

    const existing = existingResult.rows[0];
    if (Number(id) === Number(req.auth?.userId)) {
      await writeBlockedModification(
        client,
        req,
        existing,
        "BLOCKED_SELF_LOCKOUT_ATTEMPT",
        `Blocked administrator reset of their own password through user management for ${existing.username}.`,
        "You cannot disable or demote your own administrator account."
      );
    }

    const passwordHash = await hashPassword(password, client);
    await patchUser(id, {}, passwordHash, client);
    const invalidated = await invalidateUserSessions(id, client);

    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        target_user_id: id,
        action: "ADMIN_RESET_PASSWORD",
        module: "User Management",
        description: `Administrator reset the password for ${existing.username}.`
      },
      client
    );
    await auditSessionInvalidation(client, req, existing, "administrator password reset", invalidated);

    const userResult = await getUserById(id, client);
    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Password reset successfully. The user must change it at next sign-in.",
      data: userResult.rows[0]
    });
  } catch (error) {
    if (!error.transactionComplete) await client.query("ROLLBACK");
    next(mapDatabaseError(error));
  } finally {
    client.release();
  }
};

const getRoles = async (req, res, next) => {
  try {
    sendRows(res, await fetchRoles());
  } catch (error) {
    next(error);
  }
};

const getWarehouses = async (req, res, next) => {
  try {
    sendRows(res, await fetchWarehouses());
  } catch (error) {
    next(error);
  }
};

const getShifts = async (req, res, next) => {
  try {
    sendRows(res, await fetchShifts());
  } catch (error) {
    next(error);
  }
};

const getAuditLogs = async (req, res, next) => {
  try {
    sendRows(res, await fetchAuditLogs({
      action: cleanString(req.query.action),
      module: cleanString(req.query.module),
      user: cleanString(req.query.user),
      role: cleanString(req.query.role),
      date_from: cleanString(req.query.date_from),
      date_to: cleanString(req.query.date_to),
      status: cleanString(req.query.status),
      cargo_id: cleanString(req.query.cargo_id),
      warehouse: cleanString(req.query.warehouse),
      search: cleanString(req.query.search),
      limit: req.query.limit
    }));
  } catch (error) {
    next(error);
  }
};

const getUserSessions = async (req, res, next) => {
  try {
    sendRows(res, await fetchUserSessions({
      status: cleanString(req.query.status),
      user_id: req.query.user_id ? readId(req.query.user_id, "User") : null
    }));
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  let client;
  let transactionStarted = false;

  try {
    client = await db.pool.connect();
    const username = cleanString(req.body?.username);
    const password = req.body?.password;

    if (!username || !password) {
      throw buildError("Username and password are required.", 400);
    }

    const result = await client.query(
      `SELECT
        u.id,
        u.full_name,
        u.username,
        u.email,
        u.password_hash,
        u.status,
        u.must_change_password,
        u.is_system_user,
        u.is_bootstrap_admin,
        u.bootstrap_completed,
        u.role_id,
        r.role_name,
        u.warehouse_id,
        w.warehouse_name,
        u.shift_id,
        s.shift_name
      FROM users u
      JOIN roles r ON r.id = u.role_id
      LEFT JOIN warehouses w ON w.id = u.warehouse_id
      LEFT JOIN shifts s ON s.id = u.shift_id
      WHERE u.username = $1`,
      [username]
    );

    if (result.rowCount === 0) {
      throw buildError("Invalid username or password.", 401);
    }

    const user = result.rows[0];

    const passwordMatch = await verifyPassword(password, user.password_hash, client);
    if (!passwordMatch) {
      throw buildError("Invalid username or password.", 401);
    }

    if (user.status !== "active") {
      throw buildError("User account is not active.", 403);
    }

    if (!allowedPortalRoleNames.includes(user.role_name)) {
      throw buildError("No portal is currently available for this role.", 403);
    }

    if (user.is_bootstrap_admin && user.bootstrap_completed) {
      throw buildError(
        "Bootstrap setup is complete. Sign in with the real System Administrator account.",
        403
      );
    }

    await client.query("BEGIN");
    transactionStarted = true;

    const sessionResult = await createUserSession(
      {
        user_id: user.id,
        ip_address: getClientIp(req)
      },
      client
    );
    const session = sessionResult.rows[0];

    await updateLastLogin(user.id, client);

    await writeAuditLog(
      {
        user_id: user.id,
        action: "USER_LOGIN",
        module: "Authentication",
        description: `User ${user.username} logged in successfully.`
      },
      client
    );

    if (user.is_bootstrap_admin) {
      await writeAuditLog(
        {
          user_id: user.id,
          target_user_id: user.id,
          action: "BOOTSTRAP_ADMIN_LOGIN",
          module: "Authentication",
          description: `Bootstrap administrator ${user.username} logged in.`
        },
        client
      );
    }

    await client.query("COMMIT");
    transactionStarted = false;

    const token = buildAuthToken(user, session.id);

    res.json({
      success: true,
      message: "Login successful.",
      must_change_password: user.must_change_password,
      is_bootstrap_admin: user.is_bootstrap_admin,
      bootstrap_completed: user.bootstrap_completed,
      data: {
        token,
        must_change_password: user.must_change_password,
        is_bootstrap_admin: user.is_bootstrap_admin,
        bootstrap_completed: user.bootstrap_completed,
        user: {
          id: user.id,
          full_name: user.full_name,
          username: user.username,
          email: user.email,
          role_id: user.role_id,
          role_name: user.role_name,
          warehouse_id: user.warehouse_id,
          warehouse_name: user.warehouse_name,
          shift_id: user.shift_id,
          shift_name: user.shift_name,
          must_change_password: user.must_change_password,
          is_system_user: user.is_system_user,
          is_bootstrap_admin: user.is_bootstrap_admin,
          bootstrap_completed: user.bootstrap_completed
        },
        session: {
          id: session.id,
          login_time: session.login_time,
          session_status: session.session_status
        }
      }
    });
  } catch (error) {
    if (transactionStarted && client) {
      try {
        await client.query("ROLLBACK");
      } catch {
      }
    }

    next(!client || isDatabaseConnectivityError(error)
      ? buildError(databaseUnavailableMessage, 503)
      : error);
  } finally {
    if (client) {
      client.release();
    }
  }
};

const logout = async (req, res, next) => {
  const client = await db.pool.connect();
  let transactionStarted = false;

  try {
    const userId = req.auth?.userId;
    const sessionId = req.auth?.sessionId;
    
    await client.query("BEGIN");
    transactionStarted = true;

    if (userId && sessionId) {
      await closeUserSession(
        {
          user_id: userId,
          session_id: sessionId
        },
        client
      );

      await writeAuditLog(
        {
          user_id: userId,
          action: "USER_LOGOUT",
          module: "Authentication",
          description: "User logged out."
        },
        client
      );
    }

    await client.query("COMMIT");
    transactionStarted = false;

    res.json({
      success: true,
      message: "Logout successful."
    });
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }
    next(error);
  } finally {
    client.release();
  }
};

const getProfile = async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw buildError("Unauthorized.", 401);
    }

    const userResult = await db.query(
      `SELECT
        u.id,
        u.full_name,
        u.username,
        u.email,
        u.phone_number,
        u.status,
        u.role_id,
        r.role_name,
        u.warehouse_id,
        w.warehouse_name,
        u.shift_id,
        s.shift_name,
        u.must_change_password,
        u.is_system_user,
        u.is_bootstrap_admin,
        u.bootstrap_completed,
        u.created_at
      FROM users u
      JOIN roles r ON r.id = u.role_id
      LEFT JOIN warehouses w ON w.id = u.warehouse_id
      LEFT JOIN shifts s ON s.id = u.shift_id
      WHERE u.id = $1`,
      [userId]
    );

    if (userResult.rowCount === 0) {
      throw buildError("User not found.", 404);
    }

    const sessionsResult = await db.query(
      `SELECT id, login_time, session_status, ip_address
       FROM user_sessions
       WHERE user_id = $1
       ORDER BY login_time DESC
       LIMIT 10`,
      [userId]
    );

    res.json({
      success: true,
      data: {
        user: userResult.rows[0],
        sessions: sessionsResult.rows
      }
    });
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw buildError("Unauthorized.", 401);
    }

    const email = cleanString(req.body.email);
    const phone_number = cleanString(req.body.phone_number);
    const full_name = cleanString(req.body.full_name);

    if (!email || !phone_number || !full_name) {
      throw buildError("Email, phone number, and full name are required.", 400);
    }

    await client.query("BEGIN");

    // Check if email already taken by someone else
    const emailCheck = await client.query(
      "SELECT id FROM users WHERE email = $1 AND id <> $2",
      [email, userId]
    );
    if (emailCheck.rowCount > 0) {
      throw buildError("Email is already in use by another account.", 409);
    }

    const result = await client.query(
      `UPDATE users
       SET email = $1, phone_number = $2, full_name = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id, full_name, username, email, phone_number`,
      [email, phone_number, full_name, userId]
    );

    if (result.rowCount === 0) {
      throw buildError("User not found.", 404);
    }

    await writeAuditLog(
      {
        user_id: userId,
        action: "UPDATE_PROFILE",
        module: "User Management",
        description: `Updated profile details for account.`
      },
      client
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Profile updated successfully.",
      data: result.rows[0]
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(mapDatabaseError(error));
  } finally {
    client.release();
  }
};

const changePassword = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw buildError("Unauthorized.", 401);
    }

    const currentPassword = req.body.currentPassword;
    const newPassword = req.body.newPassword;

    if (!currentPassword || !newPassword) {
      throw buildError("Current password and new password are required.", 400);
    }

    if (!passwordPattern.test(newPassword)) {
      throw buildError(passwordPolicyMessage, 400);
    }

    await client.query("BEGIN");

    // Fetch user password_hash
    const userResult = await client.query(
      `SELECT
         u.id,
         u.password_hash,
         u.username,
         u.role_id,
         r.role_name,
         u.must_change_password,
         u.is_bootstrap_admin,
         u.bootstrap_completed
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1`,
      [userId]
    );

    if (userResult.rowCount === 0) {
      throw buildError("User not found.", 404);
    }

    const user = userResult.rows[0];

    if (user.is_bootstrap_admin) {
      throw buildError(
        user.bootstrap_completed
          ? "Bootstrap setup is complete. Sign in with the real System Administrator account."
          : "The bootstrap administrator must create the first real System Administrator before changing passwords.",
        403
      );
    }

    const passwordMatch = await verifyPassword(currentPassword, user.password_hash, client);
    if (!passwordMatch) {
      throw buildError("Incorrect current password.", 400);
    }

    if (await verifyPassword(newPassword, user.password_hash, client)) {
      throw buildError("New password must be different from the current password.", 400);
    }

    const newPasswordHash = await hashPassword(newPassword, client);

    await client.query(
      `UPDATE users
       SET password_hash = $1, must_change_password = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [newPasswordHash, userId]
    );

    await writeAuditLog(
      {
        user_id: userId,
        target_user_id: userId,
        action: "CHANGE_PASSWORD",
        module: "User Management",
        description: `Password changed for user ${user.username}.`
      },
      client
    );

    const invalidated = await invalidateUserSessions(userId, client, req.auth?.sessionId);
    await writeAuditLog(
      {
        user_id: userId,
        target_user_id: userId,
        action: "USER_SESSIONS_INVALIDATED",
        module: "User Management",
        description: `Closed ${invalidated.rowCount} other active session(s) after password change.`,
        metadata: {
          reason: "self password change",
          sessions_closed: invalidated.rowCount
        }
      },
      client
    );

    await client.query("COMMIT");

    const token = buildAuthToken(user, req.auth.sessionId, false);

    res.json({
      success: true,
      message: "Password changed successfully.",
      data: {
        token,
        must_change_password: false,
        role_name: user.role_name
      }
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

// Refresh token endpoint
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      throw buildError("Refresh token is required.", 400);
    }
    const decoded = verifyToken(refreshToken);
    if (!decoded) {
      throw buildError("Invalid or expired refresh token.", 401);
    }
    // Issue new access token (short-lived)
    const newAccessToken = createToken({
      userId: decoded.userId,
      user_id: decoded.user_id || decoded.userId,
      username: decoded.username,
      role: decoded.role,
      roleId: decoded.roleId || decoded.role_id,
      role_id: decoded.role_id || decoded.roleId,
      warehouseId: decoded.warehouseId || decoded.warehouse_id || null,
      warehouse_id: decoded.warehouse_id || decoded.warehouseId || null,
      shiftId: decoded.shiftId || decoded.shift_id || null,
      shift_id: decoded.shift_id || decoded.shiftId || null,
      sessionId: decoded.sessionId,
      session_id: decoded.session_id || decoded.sessionId,
      mustChangePassword: Boolean(decoded.mustChangePassword ?? decoded.must_change_password),
      must_change_password: Boolean(decoded.must_change_password ?? decoded.mustChangePassword),
      isSystemUser: Boolean(decoded.isSystemUser ?? decoded.is_system_user),
      is_system_user: Boolean(decoded.is_system_user ?? decoded.isSystemUser),
      isBootstrapAdmin: Boolean(decoded.isBootstrapAdmin ?? decoded.is_bootstrap_admin),
      is_bootstrap_admin: Boolean(decoded.is_bootstrap_admin ?? decoded.isBootstrapAdmin),
      bootstrapCompleted: Boolean(decoded.bootstrapCompleted ?? decoded.bootstrap_completed),
      bootstrap_completed: Boolean(decoded.bootstrap_completed ?? decoded.bootstrapCompleted)
    }, process.env.JWT_EXPIRES_IN || "24h");
    res.json({
      success: true,
      token: newAccessToken,
      message: "Access token refreshed."
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createUser,
  deactivateUser,
  deleteUser,
  getAuditLogs,
  getRoles,
  getShifts,
  getUser,
  getUserPendingTasks,
  getUserSessions,
  getUsers,
  getWarehouses,
  login,
  logout,
  reassignUserPendingTasks,
  resetUserPassword,
  updateUserStatus,
  updateUser,
  getProfile,
  updateProfile,
  changePassword,
  refreshToken
};

const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { buildError } = require("../utils/apiError");
const {
  canCargoBePlaced,
  PLACEMENT_STATUS
} = require("./cargoWorkflowService");
const {
  confirmPlacementOperation,
  recordPlacementAttempt
} = require("./placementService");
const { requireScannerPolicy } = require("./scannerPolicyService");
const { getScannerWorkflow, PLACEMENT_WORKFLOW } = require("./scannerWorkflowRegistry");

const STAFF_ROLE = "warehouse-staff";
const SCANNER_ROLE = "scanner";
const PLACEMENT_OPERATION = Object.freeze({
  PLACEMENT: "placement",
  RELOCATION: "relocation"
});

const placementSteps = getScannerWorkflow(PLACEMENT_WORKFLOW).steps;

const parseJson = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
};

const normalizeBarcode = (value) => String(value || "").trim().toUpperCase();

const isStepTransitionDuplicate = (session, barcode, now, duplicateWindowMs) => {
  const cargoAcceptedAt = Date.parse(session?.context?.cargo_scan_accepted_at || "");
  return (
    normalizeBarcode(barcode) === normalizeBarcode(session?.context?.scanned_cargo_barcode)
    && Number.isFinite(cargoAcceptedAt)
    && now - cargoAcceptedAt < duplicateWindowMs
  );
};

const serializeSession = (row) => {
  if (!row) return null;
  const steps = parseJson(row.steps, []);
  const context = parseJson(row.context, {});
  const currentStepIndex = Math.min(Number(row.current_step_index || 0), steps.length);
  const currentStep = row.status === "active" ? steps[currentStepIndex] || null : null;

  return {
    id: row.id,
    staff_user_id: row.staff_user_id,
    workflow_type: row.workflow_type,
    workflow_name: row.workflow_name,
    status: row.status,
    current_step_index: currentStepIndex,
    total_steps: steps.length,
    steps,
    current_step: currentStep,
    instruction: currentStep?.instruction || (
      row.status === "completed"
        ? "Placement Completed Successfully"
        : "No active scanning task assigned."
    ),
    context,
    last_error: row.last_error || null,
    last_success: row.last_success || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at || null,
    cancelled_at: row.cancelled_at || null
    ,last_activity_at: row.last_activity_at || null
    ,expires_at: row.expires_at || null
    ,expired_at: row.expired_at || null
  };
};

const fetchSessionById = async (sessionId, executor = db) => {
  const result = await executor.query(
    "SELECT * FROM scanner_sessions WHERE id = $1 LIMIT 1",
    [sessionId]
  );
  return serializeSession(result.rows[0]);
};

const expireSessionIfDue = async (session, executor = db) => {
  if (!session || session.status !== "active") return session;
  const result = await executor.query(
    `UPDATE scanner_sessions SET status='expired', expired_at=CURRENT_TIMESTAMP,
       updated_at=CURRENT_TIMESTAMP, last_error='Scanner session expired due to inactivity.'
     WHERE id=$1 AND status='active' AND expires_at <= CURRENT_TIMESTAMP RETURNING *`,
    [session.id]
  );
  const expired = serializeSession(result.rows[0]);
  if (result.rowCount) await writeAuditLog({
    target_user_id: session.staff_user_id,
    action: "SCAN_SESSION_EXPIRED",
    module: "Barcode Scanner",
    description: `Scanner session ${session.id} expired due to inactivity.`,
    metadata: { scanner_session_id: session.id, workflow_type: session.workflow_type, expiry_source: "request" }
  }, executor);
  return expired || session;
};

const getActiveSessionForStaff = async (staffUserId, executor = db) => {
  await executor.query(
    `UPDATE scanner_sessions SET status='expired', expired_at=CURRENT_TIMESTAMP,
       updated_at=CURRENT_TIMESTAMP, last_error='Scanner session expired due to inactivity.'
     WHERE staff_user_id=$1 AND status='active' AND expires_at <= CURRENT_TIMESTAMP`,
    [staffUserId]
  );
  const result = await executor.query(
    `SELECT *
     FROM scanner_sessions
     WHERE staff_user_id = $1
       AND status = 'active'
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    [staffUserId]
  );
  return serializeSession(result.rows[0]);
};

const getStaffUserForScanner = async (scannerAuth, executor = db) => {
  const linkedStaffId = Number(scannerAuth?.scannerStaffId || scannerAuth?.scanner_staff_id);
  if (!linkedStaffId) {
    throw buildError("This scanner account is not linked to an active user account.", 403);
  }

  const result = await executor.query(
    `SELECT
       staff.id,
       staff.username,
       staff.full_name,
       staff.warehouse_id,
       staff.shift_id,
       staff.status,
       staff.role_id,
       roles.role_name,
       roles.role_key
     FROM users staff
     JOIN roles ON roles.id = staff.role_id
     WHERE staff.id = $1
     LIMIT 1`,
    [linkedStaffId]
  );
  const staff = result.rows[0];

  if (!staff || staff.status !== "active" || staff.role_key === "scanner") {
    throw buildError("The linked user account is not active.", 403);
  }

  return staff;
};

const getActiveSessionForAuth = async (auth, executor = db) => {
  if (auth?.role === SCANNER_ROLE) {
    const staff = await getStaffUserForScanner(auth, executor);
    return getActiveSessionForStaff(staff.id, executor);
  }

  if (auth?.role === STAFF_ROLE) {
    return getActiveSessionForStaff(auth.userId, executor);
  }

  throw buildError("This account is not allowed to access scan sessions.", 403);
};

const buildStaffAuth = async (staffUserId, executor = db) => {
  const result = await executor.query(
    `SELECT u.id, u.username, u.warehouse_id, u.shift_id
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1
       AND u.status = 'active'
       AND r.role_key = 'warehouse_staff'
     LIMIT 1`,
    [staffUserId]
  );
  const staff = result.rows[0];

  if (!staff) {
    throw buildError("The linked Warehouse Staff account is not active.", 403);
  }

  return {
    role: STAFF_ROLE,
    userId: staff.id,
    username: staff.username,
    warehouseId: staff.warehouse_id,
    shiftId: staff.shift_id
  };
};

const assertStaffAuth = (auth) => {
  if (auth?.role !== STAFF_ROLE) {
    throw buildError("Only Warehouse Staff can start scan sessions.", 403);
  }
};

const assertScannerAuth = async (auth, session, executor = db) => {
  if (auth?.role !== SCANNER_ROLE) {
    throw buildError("Only Scanner accounts can perform barcode scans.", 403);
  }

  const staff = await getStaffUserForScanner(auth, executor);
  if (Number(staff.id) !== Number(session.staff_user_id)) {
    throw buildError("This scanner is not assigned to that scan session.", 403);
  }

  return staff;
};

const assertStaffSessionAccess = (auth, session) => {
  if (auth?.role !== STAFF_ROLE || Number(auth.userId) !== Number(session.staff_user_id)) {
    throw buildError("This scan session does not belong to your staff account.", 403);
  }
};

const findPlacementCargo = async (identifier, executor = db) => {
  const normalized = normalizeBarcode(identifier);
  const result = await executor.query(
    `SELECT *
     FROM cargo
     WHERE (id::text = $1 OR UPPER(cargo_id) = $1 OR UPPER(barcode) = $1)
       AND is_deleted = FALSE
     LIMIT 1`,
    [normalized]
  );
  return result.rows[0] || null;
};

const getPlacementOperation = (cargo) => (
  [PLACEMENT_STATUS.PLACED, PLACEMENT_STATUS.RELOCATED].includes(cargo?.placement_status)
  && cargo?.current_bin_id
    ? PLACEMENT_OPERATION.RELOCATION
    : PLACEMENT_OPERATION.PLACEMENT
);

const getPlacementCargoValidationError = (cargo, auth, operationType) => {
  if (!cargo) {
    return "Cargo does not exist.";
  }

  if (auth?.warehouseId && Number(cargo.warehouse_id) !== Number(auth.warehouseId)) {
    return "Cargo is not in the placement queue.";
  }

  const ownerUserId = cargo.assigned_staff_id || cargo.created_by || cargo.received_by_user_id;
  if (Number(ownerUserId) !== Number(auth.userId)) {
    return "Cargo is not in the placement queue.";
  }

  const isCurrentlyPlaced = (
    [PLACEMENT_STATUS.PLACED, PLACEMENT_STATUS.RELOCATED].includes(cargo.placement_status)
    && Boolean(cargo.current_bin_id)
  );

  if (operationType === PLACEMENT_OPERATION.RELOCATION) {
    if (!isCurrentlyPlaced) {
      return "Cargo is not currently placed and cannot be relocated.";
    }
    if (!canCargoBePlaced(cargo)) {
      return "Cargo is not eligible for relocation.";
    }
    return null;
  }

  if (isCurrentlyPlaced || [PLACEMENT_STATUS.PLACED, PLACEMENT_STATUS.RELOCATED].includes(cargo.placement_status)) {
    return "Cargo has already been placed.";
  }
  if (cargo.placement_status !== PLACEMENT_STATUS.UNPLACED) {
    return "Cargo is not in the placement queue.";
  }
  if (!canCargoBePlaced(cargo)) {
    return "Cargo is not eligible for placement.";
  }

  return null;
};

const assertPlacementCargoAvailable = (cargo, auth, operationType) => {
  const message = getPlacementCargoValidationError(cargo, auth, operationType);
  if (message) {
    throw buildError(message, cargo ? 409 : 404);
  }
};

const createPlacementScanSession = async (payload, auth) => {
  assertStaffAuth(auth);
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    const policy = await requireScannerPolicy(client);

    const active = await getActiveSessionForStaff(auth.userId, client);
    if (active) {
      throw buildError("This staff account already has an active scan session. Complete or cancel it before starting another.", 409);
    }

    const cargoIdentifier = payload?.cargo_id || payload?.cargoId || payload?.id;
    const cargo = await findPlacementCargo(cargoIdentifier, client);
    const operationType = getPlacementOperation(cargo);
    assertPlacementCargoAvailable(cargo, auth, operationType);
    const workflowName = operationType === PLACEMENT_OPERATION.RELOCATION
      ? "Cargo Relocation"
      : "Cargo Placement";
    const sessionSteps = placementSteps.map((step) => ({
      ...step,
      workflow_name: workflowName
    }));

    const result = await client.query(
      `INSERT INTO scanner_sessions
       (staff_user_id, workflow_type, workflow_name, current_step_index, steps, context, last_success,
        last_activity_at, expires_at)
       VALUES ($1, $2, $3, 0, $4::jsonb, $5::jsonb, $6,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + ($7 * INTERVAL '1 minute'))
       RETURNING *`,
      [
        auth.userId,
        PLACEMENT_WORKFLOW,
        workflowName,
        JSON.stringify(sessionSteps),
        JSON.stringify({
          operation_type: operationType,
          requested_cargo_db_id: cargo.id,
          requested_cargo_id: cargo.cargo_id,
          requested_cargo_barcode: cargo.barcode,
          cargo_db_id: cargo.id,
          cargo_id: cargo.cargo_id,
          cargo_barcode: cargo.barcode,
          cargo_type: cargo.cargo_type,
          placement_status: cargo.placement_status,
          current_bin_id: cargo.current_bin_id || null,
          location: cargo.location || null
        }),
        "Placement scan session started.",
        policy.timeout_minutes
      ]
    );

    const session = serializeSession(result.rows[0]);

    await writeAuditLog(
      {
        user_id: auth.userId || null,
        action: "SCAN_SESSION_STARTED",
        module: "Barcode Scanner",
        description: `Started scanner placement session for cargo ${cargo.cargo_id}.`,
        metadata: {
          scanner_session_id: session.id,
          workflow_type: session.workflow_type,
          cargo_id: cargo.id,
          cargo_identifier: cargo.cargo_id
        }
      },
      client
    );

    await client.query("COMMIT");
    return session;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const updateSessionState = async (sessionId, fields, executor = db) => {
  const assignments = [];
  const values = [];

  for (const [field, value] of Object.entries(fields)) {
    values.push(["steps", "context"].includes(field) ? JSON.stringify(value) : value);
    const cast = ["steps", "context"].includes(field) ? "::jsonb" : "";
    assignments.push(`${field} = $${values.length}${cast}`);
  }

  values.push(sessionId);

  const result = await executor.query(
    `UPDATE scanner_sessions
     SET ${assignments.join(", ")},
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $${values.length}
     RETURNING *`,
    values
  );

  return serializeSession(result.rows[0]);
};

const refreshSessionActivity = async (sessionId, timeoutMinutes, executor = db) => {
  const result = await executor.query(
    `UPDATE scanner_sessions
     SET last_activity_at=CURRENT_TIMESTAMP,
         expires_at=CURRENT_TIMESTAMP + ($2 * INTERVAL '1 minute'),
         updated_at=CURRENT_TIMESTAMP
     WHERE id=$1 AND status IN ('active','completed') RETURNING *`,
    [sessionId, timeoutMinutes]
  );
  return serializeSession(result.rows[0]);
};

const cancelSessionByStaff = async (sessionId, auth) => {
  let session = await fetchSessionById(sessionId);
  if (!session) throw buildError("Scan session not found.", 404);
  assertStaffSessionAccess(auth, session);

  session = await expireSessionIfDue(session);

  if (session.status !== "active") return session;

  const cancelled = await updateSessionState(session.id, {
    status: "cancelled",
    last_error: "Scan session cancelled by Warehouse Staff.",
    cancelled_at: new Date()
  });

  await writeAuditLog(
    {
      user_id: auth.userId || null,
      action: "SCAN_SESSION_CANCELLED",
      module: "Barcode Scanner",
      description: `Cancelled scanner session ${session.id}.`,
      metadata: {
        scanner_session_id: session.id,
        workflow_type: session.workflow_type,
        cancelled_by: "staff"
      }
    }
  );

  return cancelled;
};

const abandonSessionByScanner = async (sessionId, auth) => {
  let session = await fetchSessionById(sessionId);
  if (!session) return { session: null, abandoned: false };
  await assertScannerAuth(auth, session);

  session = await expireSessionIfDue(session);

  if (session.status !== "active") {
    return { session, abandoned: false };
  }

  const cancelled = await updateSessionState(session.id, {
    status: "cancelled",
    last_error: "Scan session cancelled by Scanner.",
    cancelled_at: new Date()
  });

  await writeAuditLog(
    {
      user_id: auth.userId || null,
      target_user_id: session.staff_user_id,
      action: "SCAN_SESSION_CANCELLED",
      module: "Barcode Scanner",
      description: `Scanner cancelled session ${session.id}.`,
      metadata: {
        scanner_session_id: session.id,
        workflow_type: session.workflow_type,
        cancelled_by: "scanner"
      }
    }
  );

  return { session: cancelled, abandoned: true };
};

const rejectScan = async (session, message, scannerAuth, extraContext = {}, executor = db) => {
  let updated = await updateSessionState(session.id, {
    last_error: message,
    last_success: null,
    context: {
      ...session.context,
      ...extraContext,
      last_scan_attempt: {
        step_index: session.current_step_index,
        attempted_at: new Date().toISOString(),
        accepted: false
      }
    }
  }, executor);

  await writeAuditLog(
    {
      user_id: scannerAuth.userId || null,
      target_user_id: session.staff_user_id,
      action: "SCAN_VALIDATION_FAILED",
      module: "Barcode Scanner",
      description: message,
      metadata: {
        scanner_session_id: session.id,
        workflow_type: session.workflow_type,
        current_step_index: session.current_step_index
      }
    }, executor
  );

  return {
    session: updated,
    accepted: false,
    completed: false,
    error: message
  };
};

const submitPlacementCargoScan = async (session, barcode, scannerAuth, policy, executor = db) => {
  const cargo = await findPlacementCargo(barcode, executor);
  if (!cargo) {
    return rejectScan(session, "Cargo does not exist.", scannerAuth, {}, executor);
  }

  const staffAuth = await buildStaffAuth(session.staff_user_id, executor);
  const operationType = session.context.operation_type || PLACEMENT_OPERATION.PLACEMENT;
  try {
    assertPlacementCargoAvailable(cargo, staffAuth, operationType);
  } catch (error) {
    return rejectScan(session, error.message, scannerAuth, {}, executor);
  }

  const context = {
    ...session.context,
    cargo_db_id: cargo.id,
    cargo_id: cargo.cargo_id,
    cargo_barcode: cargo.barcode,
    cargo_type: cargo.cargo_type,
    placement_status: cargo.placement_status,
    current_bin_id: cargo.current_bin_id || null,
    location: cargo.location || null,
    scanned_cargo_barcode: normalizeBarcode(barcode),
    cargo_scan_accepted_at: new Date().toISOString(),
    last_scan_attempt: {
      step_index: session.current_step_index,
      attempted_at: new Date().toISOString(),
      accepted: true
    },
    validation: null
  };
  let updated = await updateSessionState(session.id, {
    current_step_index: 1,
    context,
    last_error: null,
    last_success: `Cargo ${cargo.cargo_id} scan accepted.`
  }, executor);
  updated = await refreshSessionActivity(session.id, policy.timeout_minutes, executor);

  await writeAuditLog(
    {
      user_id: scannerAuth.userId || null,
      target_user_id: session.staff_user_id,
      action: "CARGO_BARCODE_SCANNED",
      module: "Barcode Scanner",
      description: `Accepted cargo barcode for ${cargo.cargo_id}.`,
      metadata: {
        scanner_session_id: session.id,
        cargo_id: cargo.id,
        cargo_identifier: cargo.cargo_id
      }
    }, executor
  );

  return {
    session: updated,
    accepted: true,
    completed: false
  };
};

const submitPlacementBinScan = async (session, barcode, scannerAuth, policy, executor = db) => {
  const staffAuth = await buildStaffAuth(session.staff_user_id);
  const payload = {
    cargo_id: session.context.cargo_id || session.context.cargo_barcode,
    placement_mode: "scan",
    operation_type: session.context.operation_type || PLACEMENT_OPERATION.PLACEMENT,
    scanned_cargo_barcode: session.context.scanned_cargo_barcode || session.context.cargo_barcode,
    scanned_bin_barcode: normalizeBarcode(barcode)
  };

  const result = await confirmPlacementOperation(payload, staffAuth);

  if (result.rejected) {
    await recordPlacementAttempt(db, {
      normalized: result.normalized,
      validation: result.validation,
      auth: staffAuth,
      stage: "confirmation",
      previousLocation: result.validation.cargo?.location || null,
      newLocation: result.validation.bin?.display_location || null
    });

    const updated = await updateSessionState(session.id, {
      context: {
        ...session.context,
        scanned_bin_barcode: normalizeBarcode(barcode),
        last_scan_attempt: {
          step_index: session.current_step_index,
          attempted_at: new Date().toISOString(),
          accepted: false
        },
        validation: result.validation
      },
      last_error: result.validation.detail,
      last_success: null
    }, executor);

    return {
      session: updated,
      accepted: false,
      completed: false,
      validation: result.validation,
      error: result.validation.detail
    };
  }

  let updated = await updateSessionState(session.id, {
    status: "completed",
    current_step_index: session.steps.length,
    context: {
      ...session.context,
      scanned_bin_barcode: normalizeBarcode(barcode),
      last_scan_attempt: {
        step_index: session.current_step_index,
        attempted_at: new Date().toISOString(),
        accepted: true
      },
      validation: result.validation,
      result: {
        cargo: result.cargo,
        bin: result.bin,
        movement: result.movement,
        alreadyPlaced: result.alreadyPlaced,
        relocated: result.relocated
      }
    },
    last_error: null,
    last_success: "Placement completed successfully.",
    completed_at: new Date()
  }, executor);
  updated = await refreshSessionActivity(session.id, policy.timeout_minutes, executor);

  await writeAuditLog(
    {
      user_id: scannerAuth.userId || null,
      target_user_id: session.staff_user_id,
      action: "SCAN_SESSION_COMPLETED",
      module: "Barcode Scanner",
      description: `Completed scanner placement session ${session.id}.`,
      metadata: {
        scanner_session_id: session.id,
        workflow_type: session.workflow_type,
        cargo_id: result.cargo?.id || result.validation?.cargo?.id || null,
        cargo_identifier: result.validation?.cargo?.cargo_id || null,
        bin_id: result.bin?.id || result.validation?.bin?.id || null,
        bin_barcode: result.bin?.barcode || result.validation?.bin?.barcode || null
      }
    }, executor
  );

  return {
    session: updated,
    accepted: true,
    completed: true,
    result
  };
};

const submitScan = async ({ sessionId, barcode }, auth) => {
  const normalizedBarcode = normalizeBarcode(barcode);
  if (!normalizedBarcode) {
    throw buildError("Barcode value is required.", 400, undefined, "SCANNER_REFERENCE_REQUIRED");
  }
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const policy = await requireScannerPolicy(client);
    const locked = await client.query("SELECT * FROM scanner_sessions WHERE id=$1 FOR UPDATE", [sessionId]);
    let session = serializeSession(locked.rows[0]);
    if (!session) throw buildError("Scan session not found.", 404, undefined, "SCANNER_SESSION_NOT_FOUND");
    await assertScannerAuth(auth, session, client);
    session = await expireSessionIfDue(session, client);
    if (session.status === "expired") {
      await client.query("COMMIT");
      throw buildError("Scanner session expired due to inactivity.", 409, undefined, "SCANNER_SESSION_EXPIRED");
    }
    if (session.status !== "active") throw buildError("Scanner session is not active.", 409, undefined, "SCANNER_SESSION_NOT_ACTIVE");
    const workflow = getScannerWorkflow(session.workflow_type);
    if (!workflow) throw buildError("Scanner workflow is not supported.", 409, undefined, "SCANNER_WORKFLOW_NOT_SUPPORTED");

    const attemptedStepIndex = session.current_step_index;
    const duplicate = await client.query(
      `SELECT id FROM scanner_scan_attempts
       WHERE scanner_session_id=$1 AND step_index=$2 AND normalized_reference=$3
         AND created_at > CURRENT_TIMESTAMP - ($4 * INTERVAL '1 millisecond')
       ORDER BY created_at DESC LIMIT 1`,
      [session.id, attemptedStepIndex, normalizedBarcode, policy.duplicate_window_ms]
    );
    if (duplicate.rowCount) {
      await client.query(
        `INSERT INTO scanner_scan_attempts(scanner_session_id,step_index,normalized_reference,outcome)
         VALUES($1,$2,$3,'duplicate')`,
        [session.id, attemptedStepIndex, normalizedBarcode]
      );
      await client.query("COMMIT");
      return { session, accepted: false, completed: false, ignoredDuplicate: true,
        code: "SCANNER_DUPLICATE_SCAN", attempted_step_index: attemptedStepIndex };
    }

    const step = session.current_step;
    let result;
    if (step?.scan_type === "cargo") result = await submitPlacementCargoScan(session, normalizedBarcode, auth, policy, client);
    else if (step?.scan_type === "bin") result = await submitPlacementBinScan(session, normalizedBarcode, auth, policy, client);
    else throw buildError("The active scan session has no scannable step.", 409, undefined, "SCANNER_INVALID_STEP");

    await client.query(
      `INSERT INTO scanner_scan_attempts(scanner_session_id,step_index,normalized_reference,outcome)
       VALUES($1,$2,$3,$4)`,
      [session.id, attemptedStepIndex, normalizedBarcode, result.accepted ? "accepted" : "rejected"]
    );
    await client.query("COMMIT");
    return { ...result, attempted_step_index: attemptedStepIndex };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  PLACEMENT_OPERATION,
  PLACEMENT_WORKFLOW,
  abandonSessionByScanner,
  cancelSessionByStaff,
  createPlacementScanSession,
  fetchSessionById,
  expireSessionIfDue,
  getActiveSessionForAuth,
  getActiveSessionForStaff,
  getPlacementCargoValidationError,
  getPlacementOperation,
  isStepTransitionDuplicate,
  refreshSessionActivity,
  serializeSession,
  submitScan
};

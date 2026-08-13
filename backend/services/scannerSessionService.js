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

const STAFF_ROLE = "warehouse-staff";
const SCANNER_ROLE = "scanner";
const PLACEMENT_WORKFLOW = "cargo_placement";
const STEP_TRANSITION_DUPLICATE_MS = 3000;
const PLACEMENT_OPERATION = Object.freeze({
  PLACEMENT: "placement",
  RELOCATION: "relocation"
});

const placementSteps = Object.freeze([
  Object.freeze({
    key: "cargo",
    scan_type: "cargo",
    workflow_name: "Cargo Placement",
    instruction: "Scan Cargo Barcode"
  }),
  Object.freeze({
    key: "bin",
    scan_type: "bin",
    workflow_name: "Cargo Placement",
    instruction: "Scan Bin Barcode"
  })
]);

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

const isStepTransitionDuplicate = (session, barcode, now = Date.now()) => {
  const cargoAcceptedAt = Date.parse(session?.context?.cargo_scan_accepted_at || "");
  return (
    normalizeBarcode(barcode) === normalizeBarcode(session?.context?.scanned_cargo_barcode)
    && Number.isFinite(cargoAcceptedAt)
    && now - cargoAcceptedAt < STEP_TRANSITION_DUPLICATE_MS
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
  };
};

const fetchSessionById = async (sessionId, executor = db) => {
  const result = await executor.query(
    "SELECT * FROM scanner_sessions WHERE id = $1 LIMIT 1",
    [sessionId]
  );
  return serializeSession(result.rows[0]);
};

const getActiveSessionForStaff = async (staffUserId, executor = db) => {
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
       (staff_user_id, workflow_type, workflow_name, current_step_index, steps, context, last_success)
       VALUES ($1, $2, $3, 0, $4::jsonb, $5::jsonb, $6)
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
        "Placement scan session started."
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

const cancelSessionByStaff = async (sessionId, auth) => {
  const session = await fetchSessionById(sessionId);
  if (!session) throw buildError("Scan session not found.", 404);
  assertStaffSessionAccess(auth, session);

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
  const session = await fetchSessionById(sessionId);
  if (!session) return { session: null, abandoned: false };
  await assertScannerAuth(auth, session);

  if (session.status !== "active") {
    return {
      session: await getActiveSessionForAuth(auth),
      abandoned: false
    };
  }

  const context = {
    ...session.context,
    scanned_cargo_barcode: null,
    scanned_bin_barcode: null,
    validation: null,
    cargo_scan_accepted_at: null,
    last_scan_attempt: null
  };
  const reset = await updateSessionState(session.id, {
    current_step_index: 0,
    context,
    last_error: "Scan cancelled by Scanner.",
    last_success: null
  });

  await writeAuditLog(
    {
      user_id: auth.userId || null,
      target_user_id: session.staff_user_id,
      action: "SCAN_STEP_CANCELLED_BY_SCANNER",
      module: "Barcode Scanner",
      description: `Scanner cancelled the current scan step for session ${session.id}.`,
      metadata: {
        scanner_session_id: session.id,
        workflow_type: session.workflow_type,
        restarted_from_step: 1
      }
    }
  );

  return { session: reset, abandoned: true };
};

const rejectScan = async (session, message, scannerAuth, extraContext = {}) => {
  const updated = await updateSessionState(session.id, {
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
  });

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
    }
  );

  return {
    session: updated,
    accepted: false,
    completed: false,
    error: message
  };
};

const submitPlacementCargoScan = async (session, barcode, scannerAuth) => {
  const cargo = await findPlacementCargo(barcode);
  if (!cargo) {
    return rejectScan(session, "Cargo does not exist.", scannerAuth);
  }

  const staffAuth = await buildStaffAuth(session.staff_user_id);
  const operationType = session.context.operation_type || PLACEMENT_OPERATION.PLACEMENT;
  try {
    assertPlacementCargoAvailable(cargo, staffAuth, operationType);
  } catch (error) {
    return rejectScan(session, error.message, scannerAuth);
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
  const updated = await updateSessionState(session.id, {
    current_step_index: 1,
    context,
    last_error: null,
    last_success: `Cargo ${cargo.cargo_id} scan accepted.`
  });

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
    }
  );

  return {
    session: updated,
    accepted: true,
    completed: false
  };
};

const submitPlacementBinScan = async (session, barcode, scannerAuth) => {
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
    });

    return {
      session: updated,
      accepted: false,
      completed: false,
      validation: result.validation,
      error: result.validation.detail
    };
  }

  const updated = await updateSessionState(session.id, {
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
  });

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
    }
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
    throw buildError("Barcode value is required.", 400);
  }

  const session = await fetchSessionById(sessionId);
  if (!session) throw buildError("Scan session not found.", 404);
  await assertScannerAuth(auth, session);

  if (session.status !== "active") {
    return {
      session: await getActiveSessionForAuth(auth),
      accepted: false,
      completed: false,
      error: "No active scan session is assigned."
    };
  }

  const attemptedStepIndex = session.current_step_index;

  if (session.workflow_type !== PLACEMENT_WORKFLOW) {
    throw buildError("This scanner workflow is not supported yet.", 400);
  }

  const step = session.current_step;
  if (step?.scan_type === "cargo") {
    const result = await submitPlacementCargoScan(session, normalizedBarcode, auth);
    return { ...result, attempted_step_index: attemptedStepIndex };
  }

  if (step?.scan_type === "bin") {
    if (isStepTransitionDuplicate(session, normalizedBarcode)) {
      return {
        session,
        accepted: false,
        completed: false,
        ignoredDuplicate: true,
        attempted_step_index: attemptedStepIndex
      };
    }

    const result = await submitPlacementBinScan(session, normalizedBarcode, auth);
    return { ...result, attempted_step_index: attemptedStepIndex };
  }

  throw buildError("The active scan session has no scannable step.", 400);
};

module.exports = {
  PLACEMENT_OPERATION,
  PLACEMENT_WORKFLOW,
  abandonSessionByScanner,
  cancelSessionByStaff,
  createPlacementScanSession,
  fetchSessionById,
  getActiveSessionForAuth,
  getActiveSessionForStaff,
  getPlacementCargoValidationError,
  getPlacementOperation,
  isStepTransitionDuplicate,
  serializeSession,
  submitScan
};

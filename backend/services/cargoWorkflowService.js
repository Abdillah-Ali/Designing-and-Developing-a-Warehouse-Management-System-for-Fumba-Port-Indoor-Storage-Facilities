const { rejectionConditions } = require("../config/systemConfig");

const REGISTRATION_STATUS = Object.freeze({
  PENDING_REVIEW: "Pending Review",
  APPROVED: "Approved",
  CORRECTION_REQUIRED: "Correction Required",
  REJECTED: "Rejected"
});

const PLACEMENT_STATUS = Object.freeze({
  UNPLACED: "Unplaced",
  PLACED: "Placed",
  RELOCATED: "Relocated",
  DISPATCHED: "Dispatched"
});

const REJECTION_REASONS = rejectionConditions;

const REVIEW_QUEUE_STATUSES = Object.freeze([
  REGISTRATION_STATUS.PENDING_REVIEW,
  REGISTRATION_STATUS.CORRECTION_REQUIRED,
  REGISTRATION_STATUS.REJECTED
]);

const REVALIDATION_FIELDS = Object.freeze([
  "cargo_type",
  "hazard_class",
  "weight",
  "volume"
]);

const CORRECTION_FIELDS = Object.freeze({
  consignee_name: "Consignee Name",
  company_name: "Company Name",
  contact_person: "Contact Person",
  phone_number: "Phone Number",
  email: "Email",
  source_of_cargo: "Source of Cargo",
  container_number: "Container Number",
  vehicle_number: "Vehicle Number",
  delivery_note_number: "Delivery Note Number",
  cargo_type: "Cargo Type",
  packaging_type: "Packaging Type",
  quantity: "Quantity",
  weight: "Weight",
  volume: "Volume",
  cargo_description: "Cargo Description",
  cargo_condition: "Cargo Condition",
  inspection_notes: "Inspection Notes",
  hazard_class: "Hazard Class"
});

const NUMERIC_CORRECTION_FIELDS = new Set(["quantity", "weight", "volume"]);

const CARGO_NOT_OPERATIONAL_MESSAGE =
  "This cargo is unavailable for warehouse placement.";

const isOperationallyVisibleToStaff = () => true;

const getStaffTaskOwnerId = (cargo) => (
  cargo?.assigned_staff_id
  || cargo?.created_by
  || cargo?.received_by_user_id
);

const getStaffHistoricalOwnerId = (cargo) => (
  cargo?.created_by
  || cargo?.received_by_user_id
);

const canStaffViewSubmission = (cargo, userId) => (
  (
    Number(getStaffHistoricalOwnerId(cargo)) === Number(userId)
    || Number(getStaffTaskOwnerId(cargo)) === Number(userId)
  )
  && !cargo?.is_deleted
);

const canStaffEditCargo = (cargo, userId) => (
  Number(getStaffTaskOwnerId(cargo)) === Number(userId)
  && (
    cargo?.registration_status === REGISTRATION_STATUS.CORRECTION_REQUIRED
    || cargo?.registration_status === REGISTRATION_STATUS.REJECTED
  )
);

const canCargoBePlaced = (cargo) => (
  !cargo?.is_deleted
  && cargo?.registration_status !== REGISTRATION_STATUS.REJECTED
  && cargo?.placement_status !== PLACEMENT_STATUS.DISPATCHED
);

const needsStorageRevalidation = (updatedFields = []) => (
  updatedFields.some((field) => REVALIDATION_FIELDS.includes(field))
);

const getRejectionReason = (code) => REJECTION_REASONS[String(code || "").trim()] || null;

const normalizeCorrectionFields = (fields) => {
  const candidates = Array.isArray(fields) ? fields : [];
  return [...new Set(
    candidates
      .map((field) => String(field || "").trim())
      .filter((field) => Object.prototype.hasOwnProperty.call(CORRECTION_FIELDS, field))
  )];
};

const normalizeCorrectionValue = (field, value) => {
  if (value === undefined || value === null) return "";
  if (NUMERIC_CORRECTION_FIELDS.has(field)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : String(value).trim();
  }
  return String(value).trim();
};

const captureCorrectionValues = (cargo, fields) => Object.fromEntries(
  normalizeCorrectionFields(fields).map((field) => [
    field,
    normalizeCorrectionValue(field, cargo?.[field])
  ])
);

const buildCorrectionChanges = (cargo, originalValues, fields) => Object.fromEntries(
  normalizeCorrectionFields(fields).map((field) => {
    const original = normalizeCorrectionValue(field, originalValues?.[field]);
    const updated = normalizeCorrectionValue(field, cargo?.[field]);
    return [field, {
      label: CORRECTION_FIELDS[field],
      original,
      updated,
      changed: original !== updated
    }];
  })
);

const statusUpdateFields = new Set([
  "assigned_staff_id",
  "approved_by",
  "approved_at",
  "rejected_by",
  "rejected_at",
  "rejection_reason",
  "corrective_notes",
  "correction_requested_by",
  "correction_requested_at",
  "correction_notes",
  "correction_fields",
  "correction_original_values",
  "correction_last_changes"
]);

const updateCargoRegistrationStatus = async (
  executor,
  cargoId,
  registrationStatus,
  changes = {}
) => {
  if (!Object.values(REGISTRATION_STATUS).includes(registrationStatus)) {
    throw new Error("Registration status is not valid.");
  }

  const assignments = ["registration_status = $1"];
  const values = [registrationStatus];

  for (const [field, value] of Object.entries(changes)) {
    if (!statusUpdateFields.has(field)) continue;
    values.push(["correction_fields", "correction_original_values", "correction_last_changes"].includes(field)
      ? JSON.stringify(value || (field === "correction_fields" ? [] : {}))
      : value);
    const cast = ["correction_fields", "correction_original_values", "correction_last_changes"].includes(field)
      ? "::jsonb"
      : "";
    assignments.push(`${field} = $${values.length}${cast}`);
  }

  values.push(cargoId);
  return executor.query(
    `UPDATE cargo
     SET ${assignments.join(", ")},
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $${values.length}
     RETURNING *`,
    values
  );
};

const ensurePendingRegistrationApprovals = async (executor, warehouseId = null) => {
  const values = [REGISTRATION_STATUS.PENDING_REVIEW];
  const warehouseFilter = warehouseId
    ? `AND c.warehouse_id = $${values.push(warehouseId)}`
    : "";

  return executor.query(
    `INSERT INTO approval_requests
       (request_type, cargo_id, requested_by, warehouse_id_at_request, reason, status, request_data)
     SELECT
       'CARGO_REGISTRATION',
       c.id,
       COALESCE(c.created_by, c.received_by_user_id),
       c.warehouse_id,
       'Cargo registration requires independent Warehouse Supervisor review and may proceed to placement while review is pending.',
       'Pending',
       jsonb_build_object(
         'cargo_condition', c.cargo_condition,
         'cargo_type', c.cargo_type,
         'hazard_class', c.hazard_class,
         'auto_repaired', TRUE
       )
     FROM cargo c
     WHERE c.registration_status = $1
       AND c.is_deleted = FALSE
       ${warehouseFilter}
       AND NOT EXISTS (
         SELECT 1
         FROM approval_requests ar
         WHERE ar.cargo_id = c.id
           AND ar.request_type = 'CARGO_REGISTRATION'
       )
     RETURNING id, cargo_id`,
    values
  );
};

const getCorrectionContext = async (executor, cargo) => {
  let correctionFields = normalizeCorrectionFields(cargo.correction_fields);
  let originalValues = cargo.correction_original_values || {};

  if (
    cargo.registration_status === REGISTRATION_STATUS.CORRECTION_REQUIRED
    && (correctionFields.length === 0 || Object.keys(originalValues).length === 0)
  ) {
    const requestResult = await executor.query(
      `SELECT request_data
       FROM approval_requests
       WHERE cargo_id = $1
         AND request_type = 'CARGO_REGISTRATION'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [cargo.id]
    );
    const requestData = requestResult.rows[0]?.request_data || {};
    correctionFields = correctionFields.length > 0
      ? correctionFields
      : normalizeCorrectionFields(requestData.correction_fields);
    originalValues = Object.keys(originalValues).length > 0
      ? originalValues
      : requestData.correction_original_values || {};
  }

  const comparisonFields = correctionFields.length > 0
    ? correctionFields
    : Object.keys(originalValues);
  const changes = buildCorrectionChanges(cargo, originalValues, comparisonFields);

  return {
    changes,
    correctionFields,
    changedEntries: Object.values(changes).filter((change) => change.changed),
    unchangedEntries: Object.values(changes).filter((change) => !change.changed)
  };
};

const completeCargoResubmission = async (
  executor,
  { cargo, userId, remarks, buildError }
) => {
  const context = await getCorrectionContext(executor, cargo);

  if (
    cargo.registration_status === REGISTRATION_STATUS.CORRECTION_REQUIRED
    && (context.correctionFields.length === 0 || context.unchangedEntries.length > 0)
  ) {
    throw buildError(
      "The selected correction fields have not been updated. Please modify the highlighted fields before resubmitting.",
      400,
      context.unchangedEntries.map((change) => `${change.label} must be changed.`)
    );
  }

  if (
    cargo.registration_status === REGISTRATION_STATUS.REJECTED
    && context.changedEntries.length === 0
  ) {
    throw buildError(
      "The rejected registration has not been updated. Please modify the form before resubmitting.",
      400
    );
  }

  const updateResult = await updateCargoRegistrationStatus(
    executor,
    cargo.id,
    REGISTRATION_STATUS.PENDING_REVIEW,
    {
      correction_fields: [],
      correction_notes: null,
      correction_last_changes: context.changes,
      rejected_by: null,
      rejected_at: null
    }
  );

  await executor.query(
    `UPDATE approval_requests
     SET status = 'Pending',
         decision_notes = NULL,
         request_data = COALESCE(request_data, '{}'::jsonb) || jsonb_build_object(
           'latest_correction_changes', $2::jsonb
         ),
         decided_at = NULL,
         decided_by = NULL,
         assigned_to = COALESCE(assigned_to, assigned_supervisor_id),
         created_at = CURRENT_TIMESTAMP
     WHERE id = (
       SELECT id FROM approval_requests
       WHERE cargo_id = $1 AND request_type = 'CARGO_REGISTRATION'
       ORDER BY id DESC LIMIT 1
     )`,
    [cargo.id, JSON.stringify(context.changes)]
  );

  await executor.query(
    `INSERT INTO cargo_approval_history
     (cargo_id, action, remarks, metadata, performed_by, warehouse_id_at_action)
     VALUES ($1, 'CORRECTION_RESUBMITTED', $2, $3, $4, $5)`,
    [
      cargo.id,
      String(remarks || "").trim() || "Corrected cargo registration resubmitted for approval.",
      JSON.stringify({
        previous_status: cargo.registration_status,
        correction_fields: context.correctionFields,
        changes: context.changes
      }),
      userId || null,
      cargo.warehouse_id || cargo.warehouse_id_at_registration || null
    ]
  );

  return {
    cargo: updateResult.rows[0],
    ...context
  };
};

module.exports = {
  CARGO_NOT_OPERATIONAL_MESSAGE,
  CORRECTION_FIELDS,
  PLACEMENT_STATUS,
  REGISTRATION_STATUS,
  REJECTION_REASONS,
  REVIEW_QUEUE_STATUSES,
  canCargoBePlaced,
  canStaffEditCargo,
  canStaffViewSubmission,
  buildCorrectionChanges,
  captureCorrectionValues,
  completeCargoResubmission,
  ensurePendingRegistrationApprovals,
  getStaffHistoricalOwnerId,
  getStaffTaskOwnerId,
  getCorrectionContext,
  getRejectionReason,
  isOperationallyVisibleToStaff,
  needsStorageRevalidation,
  normalizeCorrectionFields,
  updateCargoRegistrationStatus
};

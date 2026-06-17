const db = require("../config/db");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { generateCargoIdentifiers } = require("../utils/barcodeGenerator");
const {
  cargoFields,
  normalizeCargoPayload,
  validateCargoPayload,
  validatePlacement
} = require("../services/validationService");
const {
  PLACEMENT_STATUS,
  REGISTRATION_STATUS,
  REVIEW_QUEUE_STATUSES,
  CORRECTION_FIELDS,
  canStaffEditCargo,
  captureCorrectionValues,
  completeCargoResubmission,
  needsStorageRevalidation,
  updateCargoRegistrationStatus
} = require("../services/cargoWorkflowService");
const {
  documentMaxBytes,
  documentTypes,
  documentUploadRoot
} = require("../config/systemConfig");
const { findPossibleDuplicateCargo } = require("../services/cargoDuplicateService");
const { writeAuditLog } = require("../models/adminModel");

const allowedDocumentTypes = new Map(Object.entries(documentTypes));

const registrationStatuses = new Set(Object.values(REGISTRATION_STATUS));
const placementStatuses = new Set(Object.values(PLACEMENT_STATUS));

const buildError = (message, statusCode = 400, errors) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errors = errors;
  return error;
};

const cargoSelect = `
  SELECT
    c.*,
    b.id AS bin_id,
    b.code AS bin_code,
    b.barcode AS bin_barcode,
    b.status AS bin_status,
    b.max_weight AS bin_max_weight,
    b.max_volume AS bin_max_volume,
    b.current_weight AS bin_current_weight,
    b.current_volume AS bin_current_volume,
    (b.max_weight - b.current_weight) AS remaining_weight,
    (b.max_volume - b.current_volume) AS remaining_volume,
    l.id AS level_id,
    l.code AS level_code,
    l.level_number,
    r.id AS rack_id,
    r.code AS rack_code,
    z.id AS zone_id,
    z.code AS zone_code,
    z.name AS zone_name
    ,c.placement_status
    ,w.warehouse_name
    ,w.warehouse_code
    ,(
      SELECT dr.status
      FROM dispatch_requests dr
      WHERE dr.cargo_id = c.id
      ORDER BY dr.created_at DESC, dr.id DESC
      LIMIT 1
    ) AS dispatch_authorization_status
    ,CASE
      WHEN jsonb_array_length(COALESCE(c.correction_fields, '[]'::jsonb)) > 0
        THEN c.correction_fields
      WHEN c.registration_status = 'Correction Required' THEN COALESCE((
        SELECT ar.request_data->'correction_fields'
        FROM approval_requests ar
        WHERE ar.cargo_id = c.id
          AND ar.request_type = 'CARGO_REGISTRATION'
        ORDER BY ar.created_at DESC, ar.id DESC
        LIMIT 1
      ), '[]'::jsonb)
      ELSE '[]'::jsonb
    END AS correction_fields
    ,CASE
      WHEN c.correction_original_values <> '{}'::jsonb
        THEN c.correction_original_values
      ELSE COALESCE((
        SELECT ar.request_data->'correction_original_values'
        FROM approval_requests ar
        WHERE ar.cargo_id = c.id
          AND ar.request_type = 'CARGO_REGISTRATION'
        ORDER BY ar.created_at DESC, ar.id DESC
        LIMIT 1
      ), '{}'::jsonb)
    END AS correction_original_values
  FROM cargo c
  LEFT JOIN bins b ON b.id = c.current_bin_id
  LEFT JOIN levels l ON l.id = b.level_id
  LEFT JOIN racks r ON r.id = l.rack_id
  LEFT JOIN zones z ON z.id = r.zone_id
  LEFT JOIN warehouses w ON w.id = c.warehouse_id
`;

const isStaff = (req) => req.auth?.role === "warehouse-staff";
const isSupervisor = (req) => req.auth?.role === "warehouse-supervisor";
const isAdmin = (req) => req.auth?.role === "system-admin";

const addCargoScopeFilters = (req, filters, values) => {
  if ((isStaff(req) || isSupervisor(req)) && req.auth?.warehouseId) {
    values.push(req.auth.warehouseId);
    filters.push(`c.warehouse_id = $${values.length}`);
  }
};

const assertCargoReadable = (req, cargo) => {
  if (cargo.is_deleted && !isAdmin(req)) {
    throw buildError("Cargo record not found.", 404);
  }
  if (
    (isStaff(req) || isSupervisor(req))
    && req.auth?.warehouseId
    && Number(cargo.warehouse_id) !== Number(req.auth.warehouseId)
  ) {
    throw buildError("Cargo record not found.", 404);
  }
};

const findCargoForAccess = async (executor, identifier, lock = false) => {
  const result = await executor.query(
    `SELECT *
     FROM cargo
     WHERE (id::text = $1 OR cargo_id = $1 OR barcode = $1)
       AND is_deleted = FALSE
     LIMIT 1
     ${lock ? "FOR UPDATE" : ""}`,
    [String(identifier)]
  );
  return result.rows[0] || null;
};

const getCargo = async (req, res, next) => {
  try {
    const includeArchived = isAdmin(req) && req.query.include_archived === "true";
    const filters = includeArchived ? [] : ["c.is_deleted = FALSE"];
    const values = [];

    addCargoScopeFilters(req, filters, values);

    if (req.query.status) {
      const legacyStatus = String(req.query.status).trim();
      values.push(legacyStatus);
      if (registrationStatuses.has(legacyStatus)) {
        filters.push(`c.registration_status = $${values.length}`);
      } else if (placementStatuses.has(legacyStatus)) {
        filters.push(`c.placement_status = $${values.length}`);
      } else {
        throw buildError("Cargo status filter is not valid.", 400);
      }
    }

    if (req.query.registration_status) {
      values.push(req.query.registration_status);
      filters.push(`c.registration_status = $${values.length}`);
    }

    if (req.query.placement_status) {
      values.push(req.query.placement_status);
      filters.push(`c.placement_status = $${values.length}`);
    }

    if (req.query.cargo_type) {
      values.push(req.query.cargo_type);
      filters.push(`c.cargo_type = $${values.length}`);
    }

    if (req.query.search) {
      values.push(`%${req.query.search}%`);
      filters.push(`(
        c.cargo_id ILIKE $${values.length}
        OR c.barcode ILIKE $${values.length}
        OR c.consignee_name ILIKE $${values.length}
        OR c.company_name ILIKE $${values.length}
        OR c.contact_person ILIKE $${values.length}
        OR c.phone_number ILIKE $${values.length}
        OR c.email ILIKE $${values.length}
        OR c.cargo_type ILIKE $${values.length}
        OR c.cargo_description ILIKE $${values.length}
        OR c.packaging_type ILIKE $${values.length}
        OR c.container_number ILIKE $${values.length}
        OR c.vehicle_number ILIKE $${values.length}
        OR c.delivery_note_number ILIKE $${values.length}
      )`);
    }

    if (req.query.consignee) {
      values.push(`%${req.query.consignee}%`);
      filters.push(`c.consignee_name ILIKE $${values.length}`);
    }

    if (req.query.barcode) {
      values.push(`%${req.query.barcode}%`);
      filters.push(`c.barcode ILIKE $${values.length}`);
    }

    if (req.query.warehouse_id) {
      values.push(req.query.warehouse_id);
      filters.push(`c.warehouse_id = $${values.length}`);
    }

    if (req.query.date) {
      values.push(req.query.date);
      filters.push(`DATE(c.created_at) = $${values.length}::date`);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const offset = (page - 1) * limit;
    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total FROM cargo c ${whereClause}`,
      values
    );
    const result = await db.query(
      `${cargoSelect}
      ${whereClause}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
      values
    );

    res.json({
      success: true,
      count: result.rowCount,
      total: countResult.rows[0].total,
      page,
      limit,
      data: result.rows
    });
  } catch (error) {
    next(error);
  }
};

const getCargoById = async (req, res, next) => {
  try {
    // Build dynamic query to prevent type casting injection
    const searchId = req.params.id;
    const conditions = [];
    const values = [];

    // Try numeric ID match
    if (/^\d+$/.test(searchId)) {
      conditions.push(`c.id = $${conditions.length + 1}`);
      values.push(Number(searchId));
    }

    // Try cargo_id match
    conditions.push(`c.cargo_id = $${conditions.length + 1}`);
    values.push(searchId);

    // Try barcode match
    conditions.push(`c.barcode = $${conditions.length + 1}`);
    values.push(searchId);

    const result = await db.query(
      `${cargoSelect}
      WHERE (${conditions.join(" OR ")})
        ${isAdmin(req) ? "" : "AND c.is_deleted = FALSE"}
      LIMIT 1`,
      values
    );

    if (result.rowCount === 0) {
      throw buildError("Cargo record not found.", 404);
    }

    const cargo = result.rows[0];
    assertCargoReadable(req, cargo);
    const movementResult = await db.query(
      `SELECT * FROM cargo_movements
      WHERE cargo_id = $1
      ORDER BY created_at DESC, id DESC`,
      [cargo.id]
    );
    const documentResult = await db.query(
      `SELECT id, file_name, file_type, file_size, file_path, uploaded_by, uploaded_at
       FROM cargo_documents
       WHERE cargo_id = $1
       ORDER BY uploaded_at DESC, id DESC`,
      [cargo.id]
    );
    const approvalRequestResult = await db.query(
      `SELECT ar.*, requester.full_name AS requested_by_name,
              supervisor.full_name AS decided_by_name
       FROM approval_requests ar
       LEFT JOIN users requester ON requester.id = ar.requested_by
       LEFT JOIN users supervisor ON supervisor.id = ar.decided_by
       WHERE ar.cargo_id = $1
       ORDER BY ar.created_at DESC, ar.id DESC`,
      [cargo.id]
    );
    const approvalHistoryResult = await db.query(
      `SELECT cah.*, performer.full_name AS performed_by_name,
              performer.username AS performed_by_username
       FROM cargo_approval_history cah
       LEFT JOIN users performer ON performer.id = cah.performed_by
       WHERE cah.cargo_id = $1
       ORDER BY cah.performed_at DESC, cah.id DESC`,
      [cargo.id]
    );

    res.json({
      success: true,
      data: {
        ...cargo,
        movement_history: movementResult.rows,
        documents: documentResult.rows,
        approval_history: approvalHistoryResult.rows,
        approval_requests: approvalRequestResult.rows
      }
    });
  } catch (error) {
    next(error);
  }
};

const createCargo = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const errors = validateCargoPayload(req.body);
    if (errors.length) {
      throw buildError("Cargo validation failed.", 400, errors);
    }

    const payload = normalizeCargoPayload(req.body);
    payload.received_by = req.auth?.username || payload.received_by || "Warehouse Staff";
    const registrationStatus = REGISTRATION_STATUS.PENDING_REVIEW;
    const placementStatus = PLACEMENT_STATUS.UNPLACED;

    await client.query("BEGIN");

    const duplicateMatches = await findPossibleDuplicateCargo(client, payload, { lock: true });
    if (duplicateMatches.length > 0) {
      const matches = duplicateMatches.map((match) => ({
        cargo_id: match.cargo_id,
        barcode: match.barcode,
        matched_fields: match.matching_fields,
        matched_field_labels: match.matching_field_labels,
        registration_status: match.registration_status,
        placement_status: match.placement_status,
        created_at: match.created_at
      }));

      await writeAuditLog(
        {
          user_id: req.auth?.userId || null,
          action: "BLOCK_DUPLICATE_CARGO_REGISTRATION",
          module: "Cargo Management",
          description: "Blocked a possible duplicate cargo registration before supervisor review.",
          metadata: {
            attempted_identifiers: {
              delivery_note_number: payload.delivery_note_number,
              container_number: payload.container_number,
              vehicle_number: payload.vehicle_number,
              consignee_name: payload.consignee_name,
              cargo_type: payload.cargo_type
            },
            matches
          }
        },
        client
      );

      await client.query("COMMIT");

      return res.status(409).json({
        success: false,
        code: "DUPLICATE_CARGO",
        message: "Possible duplicate cargo detected. Registration was blocked and was not sent for supervisor review.",
        errors: matches.map(
          (match) => `${match.cargo_id} matches on ${match.matched_field_labels.join(", ")}.`
        ),
        details: {
          duplicate_count: matches.length,
          matches
        }
      });
    }

    const sequenceResult = await client.query("SELECT nextval('cargo_number_seq') AS value");
    const identifiers = generateCargoIdentifiers(sequenceResult.rows[0].value);

    const columns = [
      "cargo_id",
      "barcode",
      "reference_number",
      ...cargoFields,
      "registration_status",
      "placement_status",
      "location",
      "warehouse_id",
      "received_by_user_id"
    ];
    const values = [
      identifiers.cargo_id,
      identifiers.barcode,
      identifiers.reference_number,
      ...cargoFields.map((field) => payload[field]),
      registrationStatus,
      placementStatus,
      null,
      req.auth?.warehouseId || null,
      req.auth?.userId || null
    ];
    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");

    const insertResult = await client.query(
      `INSERT INTO cargo (${columns.join(", ")})
      VALUES (${placeholders})
      RETURNING *`,
      values
    );

    await client.query(
      `INSERT INTO cargo_movements (cargo_id, from_location, to_location, moved_by, action)
      VALUES ($1, $2, $3, $4, $5)`,
      [
        insertResult.rows[0].id,
        null,
        "Placement Queue",
        req.auth?.username || payload.received_by || "System",
        "Registration Submitted"
      ]
    );

    await client.query(
      `INSERT INTO approval_requests
       (request_type, cargo_id, requested_by, reason, status, request_data)
       VALUES ('CARGO_REGISTRATION', $1, $2, $3, 'Pending', $4)`,
      [
        insertResult.rows[0].id,
        req.auth?.userId || null,
        "New cargo registration requires independent Warehouse Supervisor review and is immediately available for placement.",
        JSON.stringify({
          cargo_condition: payload.cargo_condition,
          cargo_type: payload.cargo_type,
          hazard_class: payload.hazard_class
        })
      ]
    );

    await client.query(
      `INSERT INTO cargo_approval_history
       (cargo_id, action, remarks, performed_by)
       VALUES ($1, 'REGISTRATION_SUBMITTED', $2, $3)`,
      [
        insertResult.rows[0].id,
        "Cargo registered, added to the placement queue, and submitted for Warehouse Supervisor review.",
        req.auth?.userId || null
      ]
    );

    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action: "REGISTER_CARGO",
        module: "Cargo Management",
        description: `Registered cargo ${identifiers.cargo_id} with barcode ${identifiers.barcode}.`,
        metadata: {
          registration_status: registrationStatus,
          placement_status: placementStatus,
          supervisor_review_required: true,
          placement_available: true
        }
      },
      client
    );

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      data: insertResult.rows[0]
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const getMyCargoSubmissions = async (req, res, next) => {
  try {
    const values = [req.auth?.userId || 0, REVIEW_QUEUE_STATUSES];
    const warehouseClause = req.auth?.warehouseId
      ? `AND c.warehouse_id = $${values.push(req.auth.warehouseId)}`
      : "";
    const result = await db.query(
      `${cargoSelect}
       WHERE c.received_by_user_id = $1
         AND c.registration_status = ANY($2::varchar[])
         AND c.is_deleted = FALSE
         ${warehouseClause}
       ORDER BY c.updated_at DESC, c.id DESC`,
      values
    );
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

const resubmitCargo = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");
    const cargo = await findCargoForAccess(client, req.params.id, true);
    if (!cargo) throw buildError("Cargo record not found.", 404);
    if (!canStaffEditCargo(cargo, req.auth?.userId)) {
      throw buildError(
        "Only the original registering staff user can revise and resubmit this registration.",
        403
      );
    }

    const resubmission = await completeCargoResubmission(client, {
      cargo,
      userId: req.auth?.userId,
      remarks: req.body.remarks,
      buildError
    });
    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action: "RESUBMIT_CARGO_REGISTRATION",
        module: "Cargo Management",
        description: `Resubmitted revised cargo ${cargo.cargo_id} for supervisor approval.`,
        metadata: {
          cargo_id: cargo.id,
          cargo_identifier: cargo.cargo_id,
          previous_status: cargo.registration_status,
          changed_fields: resubmission.changedEntries.map((change) => change.label),
          correction_fields: resubmission.correctionFields,
          changes: resubmission.changes
        }
      },
      client
    );
    await client.query("COMMIT");
    res.json({ success: true, data: resubmission.cargo });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const updateCargoStatus = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const registrationStatus = String(
      req.body.registration_status || req.body.status || ""
    ).trim() || null;
    const placementStatus = String(req.body.placement_status || "").trim() || null;

    if (!registrationStatus && !placementStatus) {
      throw buildError("A registration status or placement status is required.", 400);
    }
    if (registrationStatus && !registrationStatuses.has(registrationStatus)) {
      throw buildError("Registration status is not valid.", 400);
    }
    if (placementStatus && !placementStatuses.has(placementStatus)) {
      throw buildError("Placement status is not valid.", 400);
    }

    await client.query("BEGIN");
    const cargo = await findCargoForAccess(client, req.params.id, true);
    if (!cargo) throw buildError("Cargo record not found.", 404);

    let result = { rows: [cargo] };
    if (registrationStatus) {
      result = await updateCargoRegistrationStatus(
        client,
        cargo.id,
        registrationStatus
      );
    }
    if (placementStatus) {
      result = await client.query(
        `UPDATE cargo
         SET placement_status = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [placementStatus, cargo.id]
      );
    }

    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action: "UPDATE_CARGO_STATUS",
        module: "Cargo Management",
        description: `Updated cargo ${result.rows[0].cargo_id} workflow statuses.`,
        metadata: {
          registration_status: registrationStatus || result.rows[0].registration_status,
          placement_status: placementStatus || result.rows[0].placement_status
        }
      },
      client
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

const getCargoDocuments = async (req, res, next) => {
  try {
    const cargoResult = await db.query(
      "SELECT * FROM cargo WHERE id::text = $1 OR cargo_id = $1 OR barcode = $1 LIMIT 1",
      [req.params.id]
    );
    if (cargoResult.rowCount === 0) throw buildError("Cargo record not found.", 404);
    const cargo = cargoResult.rows[0];
    assertCargoReadable(req, cargo);

    const result = await db.query(
      `SELECT id, cargo_id, file_name, file_type, file_size, file_path, uploaded_by, uploaded_at
       FROM cargo_documents
       WHERE cargo_id = $1
       ORDER BY uploaded_at DESC, id DESC`,
      [cargo.id]
    );
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

const getCargoDocumentContent = async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT cd.id, cd.file_name, cd.file_type, cd.file_size, cd.file_path,
              c.id AS cargo_record_id, c.warehouse_id, c.is_deleted
       FROM cargo_documents cd
       JOIN cargo c ON c.id = cd.cargo_id
       WHERE (c.id::text = $1 OR c.cargo_id = $1 OR c.barcode = $1)
         AND cd.id::text = $2
       LIMIT 1`,
      [req.params.id, req.params.documentId]
    );
    if (result.rowCount === 0) throw buildError("Cargo document not found.", 404);

    const document = result.rows[0];
    assertCargoReadable(req, document);

    const uploadRoot = path.resolve(documentUploadRoot);
    const absolutePath = path.isAbsolute(document.file_path)
      ? path.resolve(document.file_path)
      : path.resolve(path.join(__dirname, ".."), document.file_path);
    if (absolutePath !== uploadRoot && !absolutePath.startsWith(`${uploadRoot}${path.sep}`)) {
      throw buildError("Cargo document path is invalid.", 400);
    }

    const content = await fs.readFile(absolutePath);
    res.json({
      success: true,
      data: {
        id: document.id,
        file_name: document.file_name,
        file_type: document.file_type,
        file_size: document.file_size,
        content_base64: content.toString("base64")
      }
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      next(buildError("Cargo document file was not found.", 404));
      return;
    }
    next(error);
  }
};

const uploadCargoDocument = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const fileName = String(req.body.file_name || "").trim();
    const fileType = String(req.body.file_type || "").trim().toLowerCase();
    const encoded = String(req.body.content_base64 || "");
    const extension = allowedDocumentTypes.get(fileType);

    if (!fileName || !extension || !encoded) {
      throw buildError("PDF, DOCX, JPG, or PNG document data is required.", 400);
    }

    const fileBuffer = Buffer.from(encoded.replace(/^data:[^;]+;base64,/, ""), "base64");
    if (!fileBuffer.length || fileBuffer.length > documentMaxBytes) {
      throw buildError(
        `Each supporting document must be between 1 byte and ${Math.ceil(documentMaxBytes / (1024 * 1024))}MB.`,
        400
      );
    }

    await client.query("BEGIN");
    const cargoResult = await client.query(
      "SELECT * FROM cargo WHERE id::text = $1 OR cargo_id = $1 OR barcode = $1 LIMIT 1",
      [req.params.id]
    );
    if (cargoResult.rowCount === 0) throw buildError("Cargo record not found.", 404);

    const cargo = cargoResult.rows[0];
    assertCargoReadable(req, cargo);
    if (
      isStaff(req)
      && Number(cargo.received_by_user_id) !== Number(req.auth?.userId)
    ) {
      throw buildError("Only the original registering staff user can upload documents for this cargo.", 403);
    }
    if (
      isStaff(req)
      && ![
        REGISTRATION_STATUS.PENDING_REVIEW,
        REGISTRATION_STATUS.CORRECTION_REQUIRED,
        REGISTRATION_STATUS.REJECTED
      ].includes(cargo.registration_status)
    ) {
      throw buildError("Supporting documents can only be changed while registration review is pending, rejected, or correction is required.", 409);
    }
    const cargoDirectory = path.join(documentUploadRoot, cargo.cargo_id);
    await fs.mkdir(cargoDirectory, { recursive: true });

    const storedName = `${Date.now()}-${crypto.randomUUID()}${extension}`;
    const absolutePath = path.join(cargoDirectory, storedName);
    await fs.writeFile(absolutePath, fileBuffer, { flag: "wx" });
    const relativePath = absolutePath.startsWith(path.resolve(path.join(__dirname, "..")))
      ? path.relative(path.join(__dirname, ".."), absolutePath).replaceAll("\\", "/")
      : absolutePath;

    const result = await client.query(
      `INSERT INTO cargo_documents
       (cargo_id, file_name, file_type, file_size, file_path, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [cargo.id, fileName, fileType, fileBuffer.length, relativePath, req.auth?.userId || null]
    );

    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action: "UPLOAD_CARGO_DOCUMENT",
        module: "Cargo Management",
        description: `Uploaded ${fileName} for cargo ${cargo.cargo_id}.`,
        metadata: { document_id: result.rows[0].id, file_size: fileBuffer.length }
      },
      client
    );

    await client.query("COMMIT");
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const printCargoBarcode = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");
    const cargoResult = await client.query(
      "SELECT * FROM cargo WHERE id::text = $1 OR cargo_id = $1 OR barcode = $1 LIMIT 1",
      [req.params.id]
    );
    if (cargoResult.rowCount === 0) throw buildError("Cargo record not found.", 404);

    const cargo = cargoResult.rows[0];
    assertCargoReadable(req, cargo);
    const existingPrints = await client.query(
      "SELECT COUNT(*)::int AS count FROM barcode_print_logs WHERE cargo_id = $1",
      [cargo.id]
    );
    const printType = existingPrints.rows[0].count > 0 ? "REPRINT" : "PRINT";

    const result = await client.query(
      `INSERT INTO barcode_print_logs (cargo_id, printed_by, print_type)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [cargo.id, req.auth?.userId || null, printType]
    );

    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action: printType === "REPRINT" ? "REPRINT_CARGO_BARCODE" : "PRINT_CARGO_BARCODE",
        module: "Cargo Management",
        description: `${printType === "REPRINT" ? "Reprinted" : "Printed"} barcode label for ${cargo.cargo_id}.`
      },
      client
    );

    await client.query("COMMIT");
    res.json({ success: true, data: { cargo, print_log: result.rows[0] } });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const updateCargo = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const updates = cargoFields.filter((field) =>
      Object.prototype.hasOwnProperty.call(req.body, field)
    );

    if (updates.length === 0) {
      throw buildError("No editable cargo fields were provided.", 400);
    }

    await client.query("BEGIN");
    const existingCargo = await findCargoForAccess(client, req.params.id, true);
    if (!existingCargo) throw buildError("Cargo record not found.", 404);

    if (isStaff(req) && !canStaffEditCargo(existingCargo, req.auth?.userId)) {
      throw buildError(
        "Cargo can only be edited by its original registering staff user when correction is required.",
        403
      );
    }

    if (
      existingCargo.registration_status === REGISTRATION_STATUS.REJECTED
      && Object.keys(existingCargo.correction_original_values || {}).length === 0
    ) {
      const rejectionSnapshot = captureCorrectionValues(
        existingCargo,
        Object.keys(CORRECTION_FIELDS)
      );
      await client.query(
        `UPDATE cargo
         SET correction_original_values = $1::jsonb
         WHERE id = $2`,
        [JSON.stringify(rejectionSnapshot), existingCargo.id]
      );
      existingCargo.correction_original_values = rejectionSnapshot;
    }

    const mergedPayload = { ...existingCargo, ...req.body };
    const errors = validateCargoPayload(mergedPayload);
    if (errors.length) {
      throw buildError("Cargo validation failed.", 400, errors);
    }

    const payload = normalizeCargoPayload(mergedPayload);
    const values = updates.map((field) => payload[field]);

    const setClause = updates
      .map((field, index) => `${field} = $${index + 1}`)
      .join(", ");

    values.push(existingCargo.id);

    const result = await client.query(
      `UPDATE cargo
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${values.length}
      RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      throw buildError("Cargo record not found.", 404);
    }

    let updatedCargo = result.rows[0];
    let locationValidation = null;

    if (updatedCargo.current_bin_id && needsStorageRevalidation(updates)) {
      const weightDelta = updates.includes("weight")
        ? Number(updatedCargo.weight || 0) - Number(existingCargo.weight || 0)
        : 0;
      const volumeDelta = updates.includes("volume")
        ? Number(updatedCargo.volume || 0) - Number(existingCargo.volume || 0)
        : 0;
      const binResult = await client.query(
        `UPDATE bins
         SET current_weight = GREATEST(0, current_weight + $1),
             current_volume = GREATEST(0, current_volume + $2),
             status = CASE
               WHEN status IN ('Blocked', 'Reserved', 'Maintenance', 'Inactive') THEN status
               WHEN GREATEST(0, current_weight + $1) >= max_weight
                 OR GREATEST(0, current_volume + $2) >= max_volume
                 THEN 'Full'
               WHEN GREATEST(0, current_weight + $1) = 0
                 AND GREATEST(0, current_volume + $2) = 0
                 THEN 'Available'
               ELSE 'Occupied'
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING barcode`,
        [weightDelta, volumeDelta, updatedCargo.current_bin_id]
      );

      if (binResult.rowCount > 0) {
        locationValidation = await validatePlacement(
          {
            cargo_barcode: updatedCargo.barcode,
            bin_barcode: binResult.rows[0].barcode
          },
          client
        );

        const relocationRequired = !locationValidation.approved;
        const relocationReason = relocationRequired ? locationValidation.detail : null;
        const revalidationResult = await client.query(
          `UPDATE cargo
           SET relocation_required = $1,
               relocation_reason = $2,
               relocation_flagged_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE NULL END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3
           RETURNING *`,
          [relocationRequired, relocationReason, updatedCargo.id]
        );
        updatedCargo = revalidationResult.rows[0];

        await client.query(
          `INSERT INTO cargo_approval_history
           (cargo_id, action, remarks, performed_by)
           VALUES ($1, $2, $3, $4)`,
          [
            updatedCargo.id,
            relocationRequired ? "LOCATION_REVALIDATION_FAILED" : "LOCATION_REVALIDATED",
            relocationRequired
              ? `Current storage location requires relocation. ${relocationReason}`
              : "Current storage location remains compatible after the registration correction.",
            req.auth?.userId || null
          ]
        );
      }
    }

    const isRevision = [
      REGISTRATION_STATUS.CORRECTION_REQUIRED,
      REGISTRATION_STATUS.REJECTED
    ].includes(existingCargo.registration_status);
    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action: isRevision ? "STAFF_CORRECT_CARGO_REGISTRATION" : "UPDATE_CARGO",
        module: "Cargo Management",
        description: `Updated cargo ${updatedCargo.cargo_id} (ID: ${updatedCargo.id}).`,
        metadata: {
          cargo_id: updatedCargo.id,
          cargo_identifier: updatedCargo.cargo_id,
          updated_fields: updates,
          registration_status: existingCargo.registration_status,
          requested_correction_fields: existingCargo.correction_fields || [],
          relocation_required: updatedCargo.relocation_required,
          location_revalidated: Boolean(locationValidation)
        }
      },
      client
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      data: updatedCargo
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const deleteCargo = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const searchId = req.params.id;
    const conditions = [];
    const values = [];

    // Try numeric ID match
    if (/^\d+$/.test(searchId)) {
      conditions.push(`id = $${conditions.length + 1}`);
      values.push(Number(searchId));
    }

    // Try cargo_id match
    conditions.push(`cargo_id = $${conditions.length + 1}`);
    values.push(searchId);

    // Try barcode match
    conditions.push(`barcode = $${conditions.length + 1}`);
    values.push(searchId);

    await client.query("BEGIN");

    const result = await client.query(
      `SELECT *
       FROM cargo
       WHERE (${conditions.join(" OR ")})
         AND is_deleted = FALSE
       FOR UPDATE`,
      values
    );

    if (result.rowCount === 0) {
      throw buildError("Cargo record not found.", 404);
    }

    const deletedCargo = result.rows[0];
    if (deletedCargo.current_bin_id) {
      throw buildError(
        "Placed cargo must be removed from its storage bin before it can be archived.",
        409
      );
    }
    const archiveReason = String(req.body?.reason || "").trim() || "Archived by System Administrator.";
    const archivedResult = await client.query(
      `UPDATE cargo
       SET is_deleted = TRUE,
           archived_at = CURRENT_TIMESTAMP,
           archived_by = $1,
           archive_reason = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [req.auth?.userId || null, archiveReason, deletedCargo.id]
    );
    await client.query(
      `UPDATE approval_requests
       SET status = 'Cancelled',
           decision_notes = COALESCE(decision_notes, $2),
           decided_at = COALESCE(decided_at, CURRENT_TIMESTAMP),
           decided_by = COALESCE(decided_by, $1)
       WHERE cargo_id = $3
         AND status IN ('Pending', 'Correction Required')`,
      [req.auth?.userId || null, archiveReason, deletedCargo.id]
    );
    await client.query(
      `INSERT INTO cargo_approval_history
       (cargo_id, action, remarks, metadata, performed_by)
       VALUES ($1, 'CARGO_ARCHIVED', $2, $3, $4)`,
      [
        deletedCargo.id,
        archiveReason,
        JSON.stringify({
          registration_status: deletedCargo.registration_status,
          placement_status: deletedCargo.placement_status
        }),
        req.auth?.userId || null
      ]
    );

    await writeAuditLog(
      {
        user_id: req.auth?.userId || null,
        action: "ARCHIVE_CARGO",
        module: "Cargo Management",
        description: `Archived cargo ${deletedCargo.cargo_id} (ID: ${deletedCargo.id}).`,
        metadata: {
          cargo_id: deletedCargo.id,
          cargo_identifier: deletedCargo.cargo_id,
          archive_reason: archiveReason,
          registration_status: deletedCargo.registration_status,
          placement_status: deletedCargo.placement_status
        }
      },
      client
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      data: archivedResult.rows[0]
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

module.exports = {
  getCargo,
  getCargoById,
  getMyCargoSubmissions,
  createCargo,
  resubmitCargo,
  updateCargo,
  updateCargoStatus,
  getCargoDocuments,
  getCargoDocumentContent,
  uploadCargoDocument,
  printCargoBarcode,
  deleteCargo
};

const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { buildError } = require("../utils/apiError");
const {
  findCargoByPublicReference,
  generatePublicReference
} = require("../services/financeService");

const CUSTOMS_STATUSES = new Set([
  "Pending Inspection",
  "Inspection In Progress",
  "Documents Required",
  "On Hold",
  "Cleared",
  "Rejected"
]);

const NOTE_REQUIRED_STATUSES = new Set(["Documents Required", "On Hold", "Rejected"]);

const cleanString = (value) => String(value ?? "").trim();

const withTransaction = async (handler) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const cargoCustomsSelect = `
  SELECT
    c.id AS cargo_record_id,
    c.cargo_id,
    c.barcode,
    c.reference_number,
    c.delivery_note_number,
    c.consignee_name,
    c.company_name,
    c.cargo_type,
    c.cargo_description,
    c.registration_status,
    c.placement_status,
    c.customs_status,
    c.financial_status,
    c.location,
    c.created_at,
    c.updated_at,
    invoice_totals.latest_invoice_status,
    invoice_totals.latest_payment_status,
    invoice_totals.outstanding_balance
  FROM cargo c
  LEFT JOIN LATERAL (
    SELECT
      (ARRAY_AGG(status ORDER BY created_at DESC, id DESC))[1] AS latest_invoice_status,
      (ARRAY_AGG(payment_status ORDER BY created_at DESC, id DESC))[1] AS latest_payment_status,
      COALESCE(SUM(outstanding_balance), 0) AS outstanding_balance
    FROM invoices i
    WHERE i.cargo_id = c.id
      AND i.status <> 'Cancelled'
  ) invoice_totals ON TRUE
`;

const toCustomsCargo = (row) => ({
  cargo_reference: row.cargo_id,
  barcode: row.barcode,
  reference_number: row.reference_number,
  delivery_note_number: row.delivery_note_number,
  consignee_name: row.consignee_name,
  owner_information: row.company_name || row.consignee_name,
  cargo_type: row.cargo_type,
  cargo_description: row.cargo_description,
  approval_status: row.registration_status,
  placement_status: row.placement_status,
  customs_status: row.customs_status,
  financial_status: row.financial_status,
  invoice_status: row.latest_invoice_status || "Not Invoiced",
  payment_status: row.latest_payment_status || "Unpaid",
  outstanding_balance: row.outstanding_balance || "0.00",
  location: row.location,
  registration_date: row.created_at,
  updated_at: row.updated_at
});

const getDashboard = async (req, res, next) => {
  try {
    const [counts, recent] = await Promise.all([
      db.query(
        `SELECT customs_status, COUNT(*)::int AS count
         FROM cargo
         WHERE is_deleted = FALSE
           AND gate_out_status <> 'Released'
         GROUP BY customs_status`
      ),
      db.query(
        `${cargoCustomsSelect}
         WHERE c.is_deleted = FALSE
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT 8`
      )
    ]);

    const countMap = Object.fromEntries(counts.rows.map((row) => [row.customs_status, row.count]));
    res.json({
      success: true,
      data: {
        metrics: {
          awaiting_inspection: countMap["Pending Inspection"] || 0,
          inspections_in_progress: countMap["Inspection In Progress"] || 0,
          cargo_on_hold: countMap["On Hold"] || 0,
          cleared_cargo: countMap.Cleared || 0,
          documents_requested: countMap["Documents Required"] || 0
        },
        recently_updated: recent.rows.map(toCustomsCargo)
      }
    });
  } catch (error) {
    next(error);
  }
};

const listCargo = async (req, res, next, fixedStatus = "") => {
  try {
    const values = [];
    const clauses = ["c.is_deleted = FALSE"];
    const status = fixedStatus || req.query.status;
    if (status) {
      values.push(status);
      clauses.push(`c.customs_status = $${values.length}`);
    }
    if (req.query.search) {
      values.push(`%${req.query.search}%`);
      clauses.push(`(
        c.cargo_id ILIKE $${values.length}
        OR c.barcode ILIKE $${values.length}
        OR c.delivery_note_number ILIKE $${values.length}
        OR c.consignee_name ILIKE $${values.length}
        OR c.company_name ILIKE $${values.length}
      )`);
    }
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const offset = (page - 1) * limit;
    const whereClause = `WHERE ${clauses.join(" AND ")}`;
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM cargo c ${whereClause}`, values);
    const result = await db.query(
      `${cargoCustomsSelect}
       ${whereClause}
       ORDER BY CASE
         WHEN c.customs_status = 'Pending Inspection' THEN 0
         WHEN c.customs_status = 'Inspection In Progress' THEN 1
         WHEN c.customs_status = 'Documents Required' THEN 2
         WHEN c.customs_status = 'On Hold' THEN 3
         ELSE 4
       END,
       c.created_at ASC,
       c.id ASC
       LIMIT ${limit} OFFSET ${offset}`,
      values
    );
    res.json({
      success: true,
      count: result.rowCount,
      total: countResult.rows[0]?.total || 0,
      page,
      limit,
      data: result.rows.map(toCustomsCargo)
    });
  } catch (error) {
    next(error);
  }
};

const getQueue = (req, res, next) => listCargo(req, res, next);
const getRecords = (req, res, next) => listCargo(req, res, next);
const getCleared = (req, res, next) => listCargo(req, res, next, "Cleared");
const getHolds = (req, res, next) => listCargo(req, res, next, "On Hold");

const getCargo = async (req, res, next) => {
  try {
    const result = await db.query(
      `${cargoCustomsSelect}
       WHERE (c.cargo_id = $1 OR c.barcode = $1 OR c.reference_number = $1)
         AND c.is_deleted = FALSE
       LIMIT 1`,
      [req.params.cargoReference]
    );
    if (result.rowCount === 0) throw buildError("Cargo record not found.", 404);
    res.json({ success: true, data: toCustomsCargo(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

const getHistory = async (req, res, next) => {
  try {
    const cargo = await findCargoByPublicReference(db, req.params.cargoReference);
    if (!cargo) throw buildError("Cargo record not found.", 404);
    const result = await db.query(
      `SELECT
         csh.public_reference,
         csh.previous_status,
         csh.new_status,
         csh.notes,
         csh.changed_at,
         officer.full_name AS changed_by_name,
         officer.username AS changed_by_reference,
         csh.metadata
       FROM customs_status_history csh
       LEFT JOIN users officer ON officer.id = csh.changed_by
       WHERE csh.cargo_id = $1
       ORDER BY csh.changed_at DESC, csh.id DESC`,
      [cargo.id]
    );
    res.json({ success: true, count: result.rowCount, data: result.rows });
  } catch (error) {
    next(error);
  }
};

const ensureCustomsRecord = async (client, cargo, status, notes, documentsRequested, auth) => {
  const existing = await client.query(
    `SELECT *
     FROM customs_records
     WHERE cargo_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 1
     FOR UPDATE`,
    [cargo.id]
  );
  if (existing.rowCount > 0) {
    const result = await client.query(
      `UPDATE customs_records
       SET status = $1,
           inspection_notes = COALESCE($2, inspection_notes),
           documents_requested = COALESCE($3, documents_requested),
           inspection_started_at = CASE WHEN $1 = 'Inspection In Progress' THEN COALESCE(inspection_started_at, CURRENT_TIMESTAMP) ELSE inspection_started_at END,
           inspection_completed_at = CASE WHEN $1 IN ('Cleared', 'Rejected') THEN CURRENT_TIMESTAMP ELSE inspection_completed_at END,
           officer_id = $4,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [status, notes || null, documentsRequested || null, auth?.userId || null, existing.rows[0].id]
    );
    return result.rows[0];
  }

  const publicReference = await generatePublicReference("CUS", client, "customs_records", "public_reference");
  const result = await client.query(
    `INSERT INTO customs_records (
       public_reference, cargo_id, status, inspection_started_at,
       inspection_completed_at, inspection_notes, documents_requested, officer_id
     )
     VALUES ($1,$2,$3,
             CASE WHEN $3 = 'Inspection In Progress' THEN CURRENT_TIMESTAMP ELSE NULL END,
             CASE WHEN $3 IN ('Cleared', 'Rejected') THEN CURRENT_TIMESTAMP ELSE NULL END,
             $4,$5,$6)
     RETURNING *`,
    [publicReference, cargo.id, status, notes || null, documentsRequested || null, auth?.userId || null]
  );
  return result.rows[0];
};

const writeCustomsHistory = async (client, { cargo, customsRecord, previousStatus, newStatus, notes, auth, metadata = {} }) => {
  const publicReference = await generatePublicReference("CSH", client, "customs_status_history", "public_reference");
  await client.query(
    `INSERT INTO customs_status_history (
       public_reference, cargo_id, customs_record_id, previous_status,
       new_status, notes, changed_by, metadata
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      publicReference,
      cargo.id,
      customsRecord?.id || null,
      previousStatus || null,
      newStatus,
      notes || null,
      auth?.userId || null,
      JSON.stringify(metadata)
    ]
  );
};

const startInspection = async (req, res, next) => {
  try {
    const data = await withTransaction(async (client) => {
      const cargo = await findCargoByPublicReference(client, req.params.cargoReference, { lock: true });
      if (!cargo) throw buildError("Cargo record not found.", 404);
      if (cargo.gate_out_status !== "Not Released") {
        throw buildError("Released cargo cannot enter customs inspection.", 409);
      }
      const previousStatus = cargo.customs_status;
      const newStatus = "Inspection In Progress";
      const notes = cleanString(req.body.notes);
      const customsRecord = await ensureCustomsRecord(client, cargo, newStatus, notes, "", req.auth);
      const updatedCargo = await client.query(
        `UPDATE cargo
         SET customs_status = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [newStatus, cargo.id]
      );
      await writeCustomsHistory(client, {
        cargo,
        customsRecord,
        previousStatus,
        newStatus,
        notes,
        auth: req.auth
      });
      await writeAuditLog(
        {
          user_id: req.auth?.userId || null,
          action: "START_CUSTOMS_INSPECTION",
          module: "Customs Management",
          description: `Started customs inspection for cargo ${cargo.cargo_id}.`,
          metadata: {
            entity_reference: cargo.cargo_id,
            before: { customs_status: previousStatus },
            after: { customs_status: newStatus }
          }
        },
        client
      );
      return toCustomsCargo({
        ...updatedCargo.rows[0],
        cargo_record_id: cargo.id,
        latest_invoice_status: null,
        latest_payment_status: null,
        outstanding_balance: "0.00"
      });
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const updateStatus = async (req, res, next) => {
  try {
    const data = await withTransaction(async (client) => {
      const status = cleanString(req.body.status);
      const notes = cleanString(req.body.notes);
      const documentsRequested = cleanString(req.body.documents_requested);
      if (!CUSTOMS_STATUSES.has(status)) {
        throw buildError("Customs status is not valid.", 400);
      }
      if (NOTE_REQUIRED_STATUSES.has(status) && !notes) {
        throw buildError(`Inspection notes are required when setting customs status to ${status}.`, 400);
      }
      if (status === "Cleared" && req.body.confirm !== true) {
        throw buildError("Confirm customs clearance before clearing cargo.", 400);
      }
      const cargo = await findCargoByPublicReference(client, req.params.cargoReference, { lock: true });
      if (!cargo) throw buildError("Cargo record not found.", 404);
      if (cargo.gate_out_status !== "Not Released") {
        throw buildError("Released cargo customs status cannot be changed.", 409);
      }

      const previousStatus = cargo.customs_status;
      const customsRecord = await ensureCustomsRecord(client, cargo, status, notes, documentsRequested, req.auth);
      const updatedCargo = await client.query(
        `UPDATE cargo
         SET customs_status = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [status, cargo.id]
      );
      await writeCustomsHistory(client, {
        cargo,
        customsRecord,
        previousStatus,
        newStatus: status,
        notes,
        auth: req.auth,
        metadata: { documents_requested: documentsRequested || null }
      });
      await writeAuditLog(
        {
          user_id: req.auth?.userId || null,
          action: "UPDATE_CUSTOMS_STATUS",
          module: "Customs Management",
          description: `Updated customs status for cargo ${cargo.cargo_id} to ${status}.`,
          metadata: {
            entity_reference: cargo.cargo_id,
            before: { customs_status: previousStatus },
            after: { customs_status: status },
            reason: notes || null
          }
        },
        client
      );
      return toCustomsCargo({
        ...updatedCargo.rows[0],
        cargo_record_id: cargo.id,
        latest_invoice_status: null,
        latest_payment_status: null,
        outstanding_balance: "0.00"
      });
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCargo,
  getCleared,
  getDashboard,
  getHistory,
  getHolds,
  getQueue,
  getRecords,
  startInspection,
  updateStatus
};

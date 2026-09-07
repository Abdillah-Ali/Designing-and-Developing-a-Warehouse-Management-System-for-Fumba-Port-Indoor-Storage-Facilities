const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { buildError } = require("../utils/apiError");
const {
  findCargoByPublicReference,
  generatePublicReference
} = require("../services/financeService");
const { STATUS_ACTIONS, transitionCustoms, getAllowedCustomsActions } = require("../services/customsWorkflowService");

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

const { logEvent } = require("../utils/logger");
const { getCargoDocumentContent } = require("./cargoController");

const runCustomsWrite = (executor, sql, params) => {
  logEvent("info", { operation: "customs_write", result: "attempted" });
  return executor.query(sql, params);
};

const handleCustomsUpdateError = (error, next) => {
  if (error.statusCode) {
    next(error);
    return;
  }

  logEvent("error", {
    operation: "customs_status_update",
    result: "failure",
    error_category: error.code || error.name || "customs_update_error"
  });
  next(buildError("Unable to update customs status. Please try again.", 500));
};

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
  customs_state_key: row.customs_status_key,
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
    if (req.query.eligible_only === "true") clauses.push("c.registration_status = 'Approved'");
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

const getQueue = (req, res, next) => {
  req.query.status = "Pending Inspection";
  req.query.eligible_only = "true";
  return listCargo(req, res, next);
};
const getRecords = async (req, res, next) => {
  try {
    const values = [];
    const clauses = ["c.is_deleted=FALSE"];
    if (req.query.search) {
      values.push(`%${req.query.search}%`);
      clauses.push(`(c.cargo_id ILIKE $${values.length} OR c.barcode ILIKE $${values.length} OR c.consignee_name ILIKE $${values.length} OR c.delivery_note_number ILIKE $${values.length})`);
    }
    const result = await db.query(
      `SELECT c.cargo_id AS cargo_reference,c.barcode,COALESCE(c.company_name,c.consignee_name) AS owner_information,
              c.cargo_type,c.customs_status,c.customs_status_key,c.location,c.created_at AS registration_date,
              cr.public_reference AS inspection_reference,cr.status AS inspection_status,cr.inspection_started_at,
              cr.inspection_completed_at,cr.inspection_type,cr.inspection_result,cr.document_verification,
              cr.inspection_notes,COALESCE(u.full_name,u.username) AS inspector_name
       FROM customs_records cr JOIN cargo c ON c.id=cr.cargo_id
       LEFT JOIN users u ON u.id=cr.officer_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY COALESCE(cr.updated_at,cr.created_at) DESC,cr.id DESC`, values
    );
    res.json({ success:true, count:result.rowCount, data:result.rows });
  } catch (error) { next(error); }
};
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
    const data=toCustomsCargo(result.rows[0]);
    const documents = await db.query(
      `SELECT id, file_name, file_type, file_size, uploaded_at
       FROM cargo_documents WHERE cargo_id=$1 ORDER BY uploaded_at DESC, id DESC`,
      [result.rows[0].cargo_record_id]
    );
    data.documents = documents.rows;
    data.customs_state_key=result.rows[0].customs_status_key;
    data.allowed_actions=await getAllowedCustomsActions({cargo:result.rows[0],actor:req.auth});
    res.json({ success: true, data });
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
    const sql = `UPDATE customs_records
     SET status = $1::text,
         inspection_notes = COALESCE($2::text, inspection_notes),
         documents_requested = COALESCE($3::text, documents_requested),
         inspection_started_at = CASE
           WHEN $4::text = 'Inspection In Progress' THEN COALESCE(inspection_started_at, CURRENT_TIMESTAMP)
           ELSE inspection_started_at
         END,
         inspection_completed_at = CASE
           WHEN $5::text IN ('Cleared', 'Rejected') THEN CURRENT_TIMESTAMP
           ELSE inspection_completed_at
         END,
         officer_id = $6::integer,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $7::integer
     RETURNING *`;
    const params = [
      status,
      notes || null,
      documentsRequested || null,
      status,
      status,
      auth?.userId || null,
      existing.rows[0].id
    ];
    const result = await runCustomsWrite(
      client,
      sql,
      params
    );
    return result.rows[0];
  }

  const publicReference = await generatePublicReference("CUS", client, "customs_records", "public_reference");
  const sql = `INSERT INTO customs_records (
     public_reference, cargo_id, status, inspection_started_at,
     inspection_completed_at, inspection_notes, documents_requested, officer_id
   )
   VALUES (
     $1::text,
     $2::integer,
     $3::text,
     CASE WHEN $4::text = 'Inspection In Progress' THEN CURRENT_TIMESTAMP ELSE NULL END,
     CASE WHEN $5::text IN ('Cleared', 'Rejected') THEN CURRENT_TIMESTAMP ELSE NULL END,
     $6::text,
     $7::text,
     $8::integer
   )
   RETURNING *`;
  const params = [
    publicReference,
    cargo.id,
    status,
    status,
    status,
    notes || null,
    documentsRequested || null,
    auth?.userId || null
  ];
  const result = await runCustomsWrite(
    client,
    sql,
    params
  );
  return result.rows[0];
};

const writeCustomsHistory = async (client, { cargo, customsRecord, previousStatus, newStatus, notes, auth, metadata = {} }) => {
  const publicReference = await generatePublicReference("CSH", client, "customs_status_history", "public_reference");
  const sql = `INSERT INTO customs_status_history (
     public_reference, cargo_id, customs_record_id, previous_status,
     new_status, notes, changed_by, metadata
   )
   VALUES (
     $1::text,
     $2::integer,
     $3::integer,
     $4::text,
     $5::text,
     $6::text,
     $7::integer,
     $8::jsonb
   )`;
  const params = [
    publicReference,
    cargo.id,
    customsRecord?.id || null,
    previousStatus || null,
    newStatus,
    notes || null,
    auth?.userId || null,
    JSON.stringify(metadata)
  ];
  await runCustomsWrite(client, sql, params);
};

const startInspection = async (req, res, next) => {
  try {
    const result=await withTransaction((client)=>transitionCustoms({cargoReference:req.params.cargoReference,transitionKey:'start_inspection',actor:req.auth,input:{notes:req.body.notes,expected_state_key:req.body.expected_state_key},executor:client}));
    res.json({success:true,data:{...toCustomsCargo({...result.cargo,latest_invoice_status:null,latest_payment_status:null,outstanding_balance:'0.00'}),customs_state_key:result.policy.to_state_key}});
  } catch (error) {
    handleCustomsUpdateError(error, next);
  }
};

const updateStatus = async (req, res, next) => {
  try {
    const transitionKey=cleanString(req.body.transition_key)||STATUS_ACTIONS[cleanString(req.body.status)];
    if(!transitionKey) throw buildError('Customs transition is not valid.',400,null,'WORKFLOW_TRANSITION_NOT_FOUND');
    const result=await withTransaction(async(client)=>{const changed=await transitionCustoms({cargoReference:req.params.cargoReference,transitionKey,actor:req.auth,input:{notes:req.body.notes,documents_requested:req.body.documents_requested,confirmed:req.body.confirmed===true||req.body.confirm===true,expected_state_key:req.body.expected_state_key},executor:client});
      const { recalculateReleaseReadiness }=require("../services/releaseReadinessService");
      if(changed.cargo.customs_status==='Rejected') { const { cancelRegistrationInvoice }=require("../services/paymentService"); await cancelRegistrationInvoice({cargoReference:changed.cargo.cargo_id,reason:"Cargo rejected by Customs.",executor:client}); }
      await client.query(
        `UPDATE customs_records SET
          inspection_type=COALESCE($1,inspection_type),
          document_verification=COALESCE($2,document_verification),
          inspection_result=COALESCE($3,inspection_result),
          hold_reason=CASE WHEN $4='place_on_hold' THEN $5 ELSE hold_reason END,
          hold_released_at=CASE WHEN $4='release_hold' THEN CURRENT_TIMESTAMP ELSE hold_released_at END,
          hold_released_by=CASE WHEN $4='release_hold' THEN $6 ELSE hold_released_by END,
          hold_release_reason=CASE WHEN $4='release_hold' THEN $5 ELSE hold_release_reason END
         WHERE cargo_id=$7`,
        [cleanString(req.body.inspection_type)||null, cleanString(req.body.document_verification)||null,
          cleanString(req.body.inspection_result)||null, transitionKey, cleanString(req.body.notes)||null,
          req.auth?.userId||null, changed.cargo.id]
      );
      await recalculateReleaseReadiness({cargoId:changed.cargo.id,executor:client,actorId:req.auth?.userId,trigger:"CUSTOMS_STATUS_CHANGED"}); return changed;});
    res.json({success:true,data:{...toCustomsCargo({...result.cargo,latest_invoice_status:null,latest_payment_status:null,outstanding_balance:'0.00'}),customs_state_key:result.policy.to_state_key}});
  } catch (error) {
    handleCustomsUpdateError(error, next);
  }
};

// Customs may read registration evidence without receiving the wider cargo module.
const getDocumentContent = (req, res, next) => getCargoDocumentContent(req, res, next);

module.exports = {
  getCargo,
  getCleared,
  getDashboard,
  getHistory,
  getHolds,
  getQueue,
  getRecords,
  getDocumentContent,
  startInspection,
  updateStatus
};

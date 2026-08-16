const db = require("../config/db");
const { buildError } = require("../utils/apiError");
const { decide } = require("../services/managementReleaseService");

const getDashboard = async (_req, res, next) => {
  try {
    const result = await db.query(
      `SELECT
        (SELECT COUNT(*)::int FROM warehouses WHERE status = 'active') AS active_warehouses,
        (SELECT COUNT(*)::int FROM users WHERE status = 'active') AS active_users,
        (SELECT COUNT(*)::int FROM cargo WHERE is_deleted = FALSE) AS total_cargo,
        (SELECT COUNT(*)::int FROM cargo WHERE is_deleted = FALSE AND registration_status = 'Pending Review') AS pending_reviews,
        (SELECT COUNT(*)::int FROM cargo WHERE is_deleted = FALSE AND placement_status IN ('Placed','Relocated')) AS stored_cargo,
        (SELECT COUNT(*)::int FROM cargo WHERE is_deleted = FALSE AND gate_out_status = 'Released') AS released_cargo,
        (SELECT COALESCE(SUM(outstanding_balance),0)::numeric FROM invoices WHERE status <> 'Cancelled') AS outstanding_balance,
        (SELECT COUNT(*)::int FROM cargo WHERE is_deleted = FALSE AND customs_status = 'On Hold') AS customs_holds`
    );
    res.json({ success: true, data: { metrics: result.rows[0] } });
  } catch (error) {
    next(error);
  }
};

const getReports = async (_req, res, next) => {
  try {
    const [cargo, finance, releases, managementRelease] = await Promise.all([
      db.query(`SELECT cargo_type, COUNT(*)::int AS cargo_count FROM cargo WHERE is_deleted = FALSE GROUP BY cargo_type ORDER BY cargo_count DESC`),
      db.query(`SELECT status, COUNT(*)::int AS invoice_count, COALESCE(SUM(total_amount),0)::numeric AS total_amount FROM invoices GROUP BY status ORDER BY status`),
      db.query(`SELECT DATE(released_at) AS release_date, COUNT(*)::int AS release_count FROM cargo WHERE released_at IS NOT NULL GROUP BY DATE(released_at) ORDER BY release_date DESC LIMIT 31`),
      db.query(`SELECT management_release_status,COUNT(*)::int AS cargo_count,COALESCE(SUM(management_release_waived_amount),0) AS waived_amount FROM cargo WHERE is_deleted=FALSE GROUP BY management_release_status ORDER BY management_release_status`)
    ]);
    res.json({
      success: true,
      data: {
        cargo_by_type: cargo.rows,
        invoices_by_status: finance.rows,
        releases_by_date: releases.rows,
        management_release_summary: managementRelease.rows
      }
    });
  } catch (error) {
    next(error);
  }
};

const listReleaseRequests = async (req,res,next)=>{try{
  const status=String(req.query.status||"PENDING").toUpperCase();
  if(!["PENDING","APPROVED","REJECTED","ALL"].includes(status)) throw buildError("Invalid Management Release status filter.",400);
  const values=[]; const filter=status==="ALL"?"":`AND mrr.status=$${values.push(status)}`;
  const result=await db.query(`SELECT mrr.public_reference AS request_reference,mrr.submission_number,mrr.status AS management_release_status,mrr.request_reason,mrr.requested_at,mrr.decision_remarks,mrr.decided_at,mrr.historical_accrued_amount,mrr.waived_amount,mrr.finance_review_required,c.cargo_id AS cargo_reference,c.cargo_description,c.cargo_type,c.consignee_name,c.company_name,c.registration_status AS cargo_status,c.placement_status,c.financial_status,c.location,c.created_at AS registration_date,w.warehouse_name,COALESCE(s.full_name,s.username) AS supervisor_name,COALESCE(d.full_name,d.username) AS decided_by_name FROM management_release_requests mrr JOIN cargo c ON c.id=mrr.cargo_id LEFT JOIN warehouses w ON w.id=c.warehouse_id LEFT JOIN users s ON s.id=mrr.requested_by LEFT JOIN users d ON d.id=mrr.decided_by WHERE c.is_deleted=FALSE ${filter} ORDER BY CASE mrr.status WHEN 'PENDING' THEN 0 ELSE 1 END,mrr.requested_at DESC LIMIT 200`,values);
  res.json({success:true,count:result.rowCount,data:result.rows});
}catch(error){next(error)}};

const getReleaseRequest=async(req,res,next)=>{try{const result=await db.query(`SELECT mrr.public_reference AS request_reference,mrr.*,c.cargo_id AS cargo_reference,c.cargo_description,c.cargo_type,c.consignee_name,c.company_name,c.registration_status AS cargo_status,c.placement_status,c.financial_status,c.customs_status,c.dispatch_status,c.gate_out_status,c.location,c.weight,c.volume,c.created_at AS registration_date,w.warehouse_name,COALESCE(s.full_name,s.username) AS supervisor_name FROM management_release_requests mrr JOIN cargo c ON c.id=mrr.cargo_id LEFT JOIN warehouses w ON w.id=c.warehouse_id LEFT JOIN users s ON s.id=mrr.requested_by WHERE mrr.public_reference=$1 LIMIT 1`,[req.params.reference]);if(!result.rowCount)throw buildError("Management Release request not found.",404);res.json({success:true,data:result.rows[0]});}catch(error){next(error)}};
const decideRequest=(decision)=>(req,res,next)=>{const clientPromise=db.pool.connect();clientPromise.then(async client=>{try{await client.query("BEGIN");const data=await decide({requestRef:req.params.reference,decision,remarks:req.body?.remarks,actor:req.auth,executor:client});await client.query("COMMIT");res.json({success:true,data});}catch(error){await client.query("ROLLBACK");next(error)}finally{client.release()}}).catch(next)};
const approveReleaseRequest=decideRequest("APPROVED");
const rejectReleaseRequest=decideRequest("REJECTED");

module.exports = { getDashboard, getReports, listReleaseRequests, getReleaseRequest, approveReleaseRequest, rejectReleaseRequest };

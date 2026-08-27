const db = require("../config/db");
const { buildError } = require("../utils/apiError");
const { decide } = require("../services/managementReleaseService");
const { getManagementReport } = require("../services/reportService");

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

const getReports = async (req, res, next) => {
  try {
    res.json({ success: true, data: await getManagementReport(req.query) });
  } catch (error) {
    next(error);
  }
};

const escapeXml = (value) => String(value ?? "").replace(/[<>&'\"]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;","'":"&apos;",'"':"&quot;"})[c]);
const exportReports = async (req, res, next) => {
  try {
    const data = await getManagementReport({ ...req.query, page: 1, pageSize: 100 });
    const format = String(req.params.format || "").toLowerCase();
    if (format === "excel") {
      const headers = ["Cargo Reference","Cargo Status","Location","Customs Status","Invoice Status","Paid Amount","Outstanding Amount","Registration Date"];
      const rows = data.cargo.map(r => [r.cargo_reference,r.cargo_status,r.current_location,r.customs_status,r.invoice_status,r.paid_amount,r.outstanding_amount,r.registration_date]);
      const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Cargo"><Table>${[headers,...rows].map((row,ri)=>`<Row>${row.map((v,ci)=>`<Cell><Data ss:Type="${ri&&ci>=5&&ci<=6?'Number':'String'}">${escapeXml(v)}</Data></Cell>`).join("")}</Row>`).join("")}</Table></Worksheet></Workbook>`;
      res.set({"Content-Type":"application/vnd.ms-excel","Content-Disposition":"attachment; filename=management-report.xls"}).send(xml); return;
    }
    if (format === "pdf") {
      const lines = ["Fumba Port WMS - Reports & Analytics",`Generated: ${new Date().toISOString()}`,`Total cargo: ${data.summary.total_cargo}`,`Storage occupied: ${data.summary.storage_occupied ?? 'N/A'}%`,`Verified revenue: TZS ${data.summary.total_revenue}`,`Outstanding: TZS ${data.summary.outstanding}`];
      const stream = `BT /F1 12 Tf 50 780 Td ${lines.map((x,i)=>`${i?'0 -22 Td ':''}(${String(x).replace(/[()\\]/g,'\\$&')}) Tj`).join(' ')} ET`;
      const objects=[`1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj`,`2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj`,`3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj`,`4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj`,`5 0 obj<</Length ${Buffer.byteLength(stream)}>>stream\n${stream}\nendstream endobj`];
      let pdf='%PDF-1.4\n', offsets=[0]; objects.forEach(o=>{offsets.push(Buffer.byteLength(pdf));pdf+=o+'\n'}); const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
      res.set({"Content-Type":"application/pdf","Content-Disposition":"attachment; filename=management-report.pdf"}).send(Buffer.from(pdf)); return;
    }
    res.status(400).json({success:false,message:"Unsupported export format."});
  } catch (error) { next(error); }
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

module.exports = { getDashboard, getReports, exportReports, listReleaseRequests, getReleaseRequest, approveReleaseRequest, rejectReleaseRequest };

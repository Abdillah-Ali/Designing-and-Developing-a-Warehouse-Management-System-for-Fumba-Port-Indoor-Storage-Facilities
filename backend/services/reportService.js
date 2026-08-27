const db = require("../config/db");
const { buildError } = require("../utils/apiError");

const PAGE_SIZES = new Set([10, 20, 50, 100]);
const SORTS = Object.freeze({ cargo_reference: "c.cargo_id", cargo_status: "c.registration_status", amount: "outstanding_amount", date: "c.created_at" });

function parseFilters(query = {}) {
  const dateFrom = query.dateFrom || null;
  const dateTo = query.dateTo || null;
  if (dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) throw buildError("Date From must use YYYY-MM-DD.", 400);
  if (dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) throw buildError("Date To must use YYYY-MM-DD.", 400);
  if (dateFrom && dateTo && dateFrom > dateTo) throw buildError("Date From must not be after Date To.", 400);
  const page = Number(query.page || 1);
  const pageSize = Number(query.pageSize || 20);
  if (!Number.isInteger(page) || page < 1) throw buildError("Page must be a positive integer.", 400);
  if (!PAGE_SIZES.has(pageSize)) throw buildError("Page size must be 10, 20, 50, or 100.", 400);
  const sortBy = query.sortBy || "date";
  const sortOrder = String(query.sortOrder || "desc").toLowerCase();
  if (!SORTS[sortBy] || !["asc", "desc"].includes(sortOrder)) throw buildError("Invalid report sorting parameters.", 400);
  return { dateFrom, dateTo, cargoStatus: query.cargoStatus || null, customsStatus: query.customsStatus || null,
    paymentStatus: query.paymentStatus || null, warehouseId: query.warehouseId || null, zoneId: query.zoneId || null,
    cargoType: query.cargoType || null, search: String(query.search || "").trim().slice(0, 120), page, pageSize, sortBy, sortOrder };
}

function cargoWhere(filters, values, alias = "c") {
  const clauses = [`${alias}.is_deleted=FALSE`];
  const add = (value, expression) => { if (value) { values.push(value); clauses.push(expression.replace("?", `$${values.length}`)); } };
  add(filters.dateFrom, `${alias}.created_at >= ?::date`);
  add(filters.dateTo, `${alias}.created_at < (?::date + INTERVAL '1 day')`);
  add(filters.cargoStatus, `${alias}.registration_status = ?`);
  add(filters.customsStatus, `${alias}.customs_status = ?`);
  add(filters.warehouseId, `${alias}.warehouse_id = ?::int`);
  add(filters.cargoType, `${alias}.cargo_type = ?`);
  if (filters.zoneId) { values.push(filters.zoneId); clauses.push(`z.id=$${values.length}::int`); }
  if (filters.paymentStatus) { values.push(filters.paymentStatus); clauses.push(`COALESCE(i.payment_status,'Uninvoiced')=$${values.length}`); }
  if (filters.search) { values.push(`%${filters.search}%`); clauses.push(`(${alias}.cargo_id ILIKE $${values.length} OR ${alias}.reference_number ILIKE $${values.length} OR i.public_invoice_number ILIKE $${values.length} OR i.payment_reference ILIKE $${values.length})`); }
  return clauses.join(" AND ");
}

const baseJoins = `LEFT JOIN bins b ON b.id=c.current_bin_id LEFT JOIN levels l ON l.id=b.level_id LEFT JOIN racks r ON r.id=l.rack_id LEFT JOIN zones z ON z.id=r.zone_id LEFT JOIN warehouses w ON w.id=c.warehouse_id LEFT JOIN LATERAL (SELECT * FROM invoices ix WHERE ix.cargo_id=c.id ORDER BY ix.created_at DESC LIMIT 1) i ON TRUE`;

async function getManagementReport(query, executor = db) {
  const filters = parseFilters(query); const values = []; const where = cargoWhere(filters, values);
  const [summary, movement, revenue, storage, payments, count, cargo, options, alerts] = await Promise.all([
    executor.query(`SELECT COUNT(*)::int total_cargo,COUNT(*) FILTER(WHERE c.customs_status IN ('Pending Inspection','Inspection In Progress','Documents Required','On Hold'))::int pending_customs,COALESCE(SUM(paid.verified),0)::numeric total_revenue,COALESCE(SUM(CASE WHEN i.status<>'Cancelled' THEN i.outstanding_balance ELSE 0 END),0)::numeric outstanding FROM cargo c ${baseJoins} LEFT JOIN LATERAL (SELECT COALESCE(SUM(amount_received),0) verified FROM payments p WHERE p.invoice_id=i.id AND p.status='Confirmed' AND p.reconciliation_status='MATCHED') paid ON TRUE WHERE ${where}`, values),
    executor.query(`SELECT d.day::date period,(SELECT COUNT(*)::int FROM cargo c WHERE c.is_deleted=FALSE AND c.created_at::date=d.day::date) inbound,(SELECT COUNT(*)::int FROM gate_out_records g WHERE g.released_at::date=d.day::date) outbound FROM generate_series(COALESCE($1::date,CURRENT_DATE-INTERVAL '6 day'),COALESCE($2::date,CURRENT_DATE),'1 day') d(day) ORDER BY d.day`, [filters.dateFrom, filters.dateTo]),
    executor.query(`SELECT c.cargo_type,COALESCE(SUM(p.amount_received),0)::numeric revenue FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN cargo c ON c.id=i.cargo_id WHERE p.status='Confirmed' AND p.reconciliation_status='MATCHED' AND ($1::date IS NULL OR p.verified_at >= $1::date) AND ($2::date IS NULL OR p.verified_at < $2::date+INTERVAL '1 day') GROUP BY c.cargo_type ORDER BY revenue DESC`, [filters.dateFrom, filters.dateTo]),
    executor.query(`SELECT z.name zone,z.id zone_id,COUNT(b.id)::int total_bins,COUNT(b.id) FILTER(WHERE b.status IN ('Occupied','Full'))::int occupied_bins,ROUND(100.0*COUNT(b.id) FILTER(WHERE b.status IN ('Occupied','Full'))/NULLIF(COUNT(b.id),0),1) utilization FROM zones z LEFT JOIN racks r ON r.zone_id=z.id LEFT JOIN levels l ON l.rack_id=r.id LEFT JOIN bins b ON b.level_id=l.id AND b.active=TRUE WHERE ($1::int IS NULL OR z.id=$1) GROUP BY z.id,z.name ORDER BY z.name`, [filters.zoneId]),
    executor.query(`SELECT i.payment_status status,COUNT(*)::int count,COALESCE(SUM(i.outstanding_balance),0)::numeric amount FROM invoices i JOIN cargo c ON c.id=i.cargo_id WHERE i.status<>'Cancelled' AND c.is_deleted=FALSE AND ($1::date IS NULL OR i.created_at >= $1::date) AND ($2::date IS NULL OR i.created_at < $2::date+INTERVAL '1 day') GROUP BY i.payment_status ORDER BY i.payment_status`, [filters.dateFrom, filters.dateTo]),
    executor.query(`SELECT COUNT(*)::int total FROM cargo c ${baseJoins} WHERE ${where}`, values),
    executor.query(`SELECT c.cargo_id cargo_reference,c.reference_number,c.registration_status cargo_status,c.placement_status,c.customs_status,c.location,COALESCE(z.name,w.warehouse_name,c.location) current_location,i.public_invoice_number invoice_reference,COALESCE(i.payment_status,'Uninvoiced') invoice_status,COALESCE(i.amount_paid,0)::numeric paid_amount,COALESCE(i.outstanding_balance,0)::numeric outstanding_amount,c.created_at registration_date FROM cargo c ${baseJoins} WHERE ${where} ORDER BY ${SORTS[filters.sortBy]} ${filters.sortOrder} LIMIT $${values.length+1} OFFSET $${values.length+2}`, [...values, filters.pageSize, (filters.page-1)*filters.pageSize]),
    executor.query(`SELECT ARRAY(SELECT DISTINCT registration_status FROM cargo WHERE is_deleted=FALSE ORDER BY 1) cargo_statuses,ARRAY(SELECT DISTINCT customs_status FROM cargo WHERE is_deleted=FALSE AND customs_status IS NOT NULL ORDER BY 1) customs_statuses,ARRAY(SELECT DISTINCT payment_status FROM invoices ORDER BY 1) payment_statuses,ARRAY(SELECT DISTINCT cargo_type FROM cargo WHERE is_deleted=FALSE ORDER BY 1) cargo_types`),
    executor.query(`SELECT (SELECT COUNT(*) FROM cargo WHERE is_deleted=FALSE AND customs_status IN ('Pending Inspection','Inspection In Progress','Documents Required','On Hold'))::int customs_backlog,(SELECT COUNT(*) FROM bins WHERE active=TRUE AND (status='Full' OR current_weight>=max_weight OR current_volume>=max_volume))::int bins_at_capacity,(SELECT COUNT(*) FROM invoices WHERE status<>'Cancelled' AND outstanding_balance>0)::int outstanding_invoices,(SELECT COUNT(*) FROM cargo WHERE is_deleted=FALSE AND release_readiness_status='BLOCKED')::int blocked_releases`)
  ]);
  const occupied = storage.rows.reduce((n, x) => n + Number(x.occupied_bins), 0), totalBins = storage.rows.reduce((n, x) => n + Number(x.total_bins), 0);
  return { filters, summary: { ...summary.rows[0], storage_occupied: totalBins ? Math.round(occupied*1000/totalBins)/10 : null }, cargo_movement: movement.rows, revenue_by_cargo_type: revenue.rows, storage_utilization: storage.rows, payment_distribution: payments.rows, cargo: cargo.rows, pagination: { page: filters.page, pageSize: filters.pageSize, total: count.rows[0].total, totalPages: Math.ceil(count.rows[0].total/filters.pageSize) }, options: options.rows[0], alerts: alerts.rows[0] };
}

module.exports = { getManagementReport, parseFilters };

const db = require("../config/db");

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
    const [cargo, finance, releases] = await Promise.all([
      db.query(`SELECT cargo_type, COUNT(*)::int AS cargo_count FROM cargo WHERE is_deleted = FALSE GROUP BY cargo_type ORDER BY cargo_count DESC`),
      db.query(`SELECT status, COUNT(*)::int AS invoice_count, COALESCE(SUM(total_amount),0)::numeric AS total_amount FROM invoices GROUP BY status ORDER BY status`),
      db.query(`SELECT DATE(released_at) AS release_date, COUNT(*)::int AS release_count FROM cargo WHERE released_at IS NOT NULL GROUP BY DATE(released_at) ORDER BY release_date DESC LIMIT 31`)
    ]);
    res.json({
      success: true,
      data: {
        cargo_by_type: cargo.rows,
        invoices_by_status: finance.rows,
        releases_by_date: releases.rows
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getDashboard, getReports };

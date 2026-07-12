const crypto = require("node:crypto");
const db = require("../config/db");
const { writeAuditLog } = require("../models/adminModel");
const { buildError } = require("../utils/apiError");

const DECIMAL_SCALE = 10000n;
const MONEY_SCALE = 100n;
const DAY_MS = 24 * 60 * 60 * 1000;

const chargingUnits = new Set([
  "per_cargo_per_day",
  "per_kilogram_per_day",
  "per_tonne_per_day",
  "per_cubic_metre_per_day",
  "fixed_daily_charge"
]);

const sortableChargeFields = new Map([
  ["registration_date", "c.created_at"],
  ["cargo_reference", "c.cargo_id"],
  ["cargo_type", "c.cargo_type"],
  ["approval_status", "c.registration_status"],
  ["placement_status", "c.placement_status"],
  ["customs_status", "c.customs_status"],
  ["charge_start_date", "c.charge_start_at"]
]);

const cleanString = (value) => String(value ?? "").trim();

const normalizeTimestamp = (value, fallback = null) => {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date;
};

const parseDecimalToScale = (value, scale = DECIMAL_SCALE) => {
  const raw = cleanString(value || 0);
  const negative = raw.startsWith("-");
  const normalized = negative ? raw.slice(1) : raw;
  const [wholePart, fractionPart = ""] = normalized.split(".");
  const scaleDigits = String(scale).length - 1;
  const whole = BigInt(wholePart || "0") * scale;
  const paddedFraction = `${fractionPart}${"0".repeat(scaleDigits)}`.slice(0, scaleDigits);
  const fraction = BigInt(paddedFraction || "0");
  const result = whole + fraction;
  return negative ? -result : result;
};

const divideRounded = (numerator, denominator) => {
  if (denominator === 0n) return 0n;
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + (denominator / 2n)) / denominator;
  return negative ? -rounded : rounded;
};

const centsFromAmount = (value) => {
  const scaled = parseDecimalToScale(value, DECIMAL_SCALE);
  return divideRounded(scaled * MONEY_SCALE, DECIMAL_SCALE);
};

const amountFromCents = (cents) => {
  const value = BigInt(cents || 0);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / MONEY_SCALE;
  const fraction = absolute % MONEY_SCALE;
  return `${negative ? "-" : ""}${whole.toString()}.${fraction.toString().padStart(2, "0")}`;
};

const decimalStringFromScaled = (value, scale = DECIMAL_SCALE) => {
  const scaled = BigInt(value || 0);
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const scaleDigits = String(scale).length - 1;
  const whole = absolute / scale;
  const fraction = absolute % scale;
  return `${negative ? "-" : ""}${whole.toString()}.${fraction.toString().padStart(scaleDigits, "0")}`;
};

const multiplyRateByUnitsAndDays = ({ dailyRate, units, billableDays }) => {
  const rateScaled = parseDecimalToScale(dailyRate, DECIMAL_SCALE);
  const unitScaled = parseDecimalToScale(units, DECIMAL_SCALE);
  const days = BigInt(Math.max(Number(billableDays) || 0, 0));
  return divideRounded(rateScaled * unitScaled * days * MONEY_SCALE, DECIMAL_SCALE * DECIMAL_SCALE);
};

const percentageOfCents = (amountCents, percentage) => {
  const percentScaled = parseDecimalToScale(percentage, DECIMAL_SCALE);
  return divideRounded(BigInt(amountCents || 0) * percentScaled, 100n * DECIMAL_SCALE);
};

const maxDate = (...dates) => dates
  .filter(Boolean)
  .reduce((latest, current) => (!latest || current > latest ? current : latest), null);

const generatePublicReference = async (prefix, executor = db, tableName, columnName) => {
  const allowed = new Set([
    "tariffs.public_reference",
    "tariff_versions.public_reference",
    "cargo_charge_ledgers.public_reference",
    "invoices.public_invoice_number",
    "invoice_line_items.public_reference",
    "payments.public_reference",
    "payment_reversals.public_reference",
    "customs_records.public_reference",
    "customs_status_history.public_reference",
    "gate_out_records.public_reference",
    "emergency_release_requests.public_reference"
  ]);
  const key = `${tableName}.${columnName}`;
  if (!allowed.has(key)) {
    throw new Error("Unsupported public reference target.");
  }

  const year = new Date().getFullYear();
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  for (let attempt = 0; attempt < 8; attempt += 1) {
    let randomPart = "";
    for (let index = 0; index < 8; index += 1) {
      randomPart += chars[crypto.randomInt(chars.length)];
    }
    const reference = `${prefix}-${year}-${randomPart}`;
    const result = await executor.query(
      `SELECT 1 FROM ${tableName} WHERE ${columnName} = $1 LIMIT 1`,
      [reference]
    );
    if (result.rowCount === 0) return reference;
  }

  throw new Error(`Unable to generate a unique ${prefix} reference.`);
};

const getServerNow = async (executor = db) => {
  const result = await executor.query("SELECT CURRENT_TIMESTAMP AS now");
  return result.rows[0]?.now || new Date();
};

const findCargoByPublicReference = async (executor, reference, { lock = false } = {}) => {
  const result = await executor.query(
    `SELECT *
     FROM cargo
     WHERE (cargo_id = $1 OR barcode = $1 OR reference_number = $1)
       AND is_deleted = FALSE
     LIMIT 1
     ${lock ? "FOR UPDATE" : ""}`,
    [cleanString(reference)]
  );
  return result.rows[0] || null;
};

const findInvoiceByNumber = async (executor, invoiceNumber, { lock = false } = {}) => {
  const result = await executor.query(
    `SELECT i.*, c.cargo_id AS cargo_reference, c.barcode AS cargo_barcode, c.consignee_name,
            c.company_name, c.cargo_type, c.cargo_description
     FROM invoices i
     JOIN cargo c ON c.id = i.cargo_id
     WHERE i.public_invoice_number = $1
     LIMIT 1
     ${lock ? "FOR UPDATE OF i" : ""}`,
    [cleanString(invoiceNumber)]
  );
  return result.rows[0] || null;
};

const getCargoQuantityForUnit = (cargo, chargingUnit) => {
  if (chargingUnit === "per_kilogram_per_day") {
    if (cargo.weight === null || cargo.weight === undefined) {
      throw buildError("Cargo weight is required for the selected tariff.", 400);
    }
    return { units: String(cargo.weight), label: "kg" };
  }

  if (chargingUnit === "per_tonne_per_day") {
    if (cargo.weight === null || cargo.weight === undefined) {
      throw buildError("Cargo weight is required for the selected tariff.", 400);
    }
    const weightScaled = parseDecimalToScale(cargo.weight, DECIMAL_SCALE);
    return { units: decimalStringFromScaled(weightScaled / 1000n, DECIMAL_SCALE), label: "tonne" };
  }

  if (chargingUnit === "per_cubic_metre_per_day") {
    if (cargo.volume === null || cargo.volume === undefined) {
      throw buildError("Cargo volume is required for the selected tariff.", 400);
    }
    return { units: String(cargo.volume), label: "m3" };
  }

  return { units: "1", label: chargingUnit === "fixed_daily_charge" ? "daily charge" : "cargo" };
};

const calculateBillableDays = ({ chargeStartAt, chargeEndAt, minimumBillableDays = 1 }) => {
  const start = normalizeTimestamp(chargeStartAt);
  const end = normalizeTimestamp(chargeEndAt);
  if (!start || !end) {
    throw buildError("Valid charge start and end timestamps are required.", 400);
  }
  if (end < start) {
    throw buildError("Charge end timestamp cannot be earlier than charge start timestamp.", 400);
  }

  const elapsedDays = Math.ceil(Math.max(end.getTime() - start.getTime(), 1) / DAY_MS);
  return Math.max(Number(minimumBillableDays) || 1, elapsedDays);
};

const tariffToPublic = (row) => ({
  tariff_reference: row.tariff_reference || row.tariff_public_reference,
  tariff_version_reference: row.tariff_version_reference || row.public_reference,
  tariff_name: row.tariff_name,
  cargo_type: row.cargo_type,
  charging_unit: row.charging_unit,
  daily_rate: row.daily_rate,
  currency: row.currency,
  minimum_billable_days: row.minimum_billable_days,
  grace_period_days: row.grace_period_days,
  penalty_type: row.penalty_type,
  penalty_rate: row.penalty_rate,
  fixed_penalty: row.fixed_penalty,
  effective_from: row.effective_from,
  effective_to: row.effective_to,
  is_active: row.is_active,
  notes: row.notes,
  created_at: row.created_at,
  updated_at: row.updated_at
});

const getApplicableTariff = async (cargo, asOf, executor = db) => {
  const tariffDate = normalizeTimestamp(asOf, new Date());
  const result = await executor.query(
    `SELECT
       t.public_reference AS tariff_reference,
       t.tariff_name,
       t.description,
       tv.*
     FROM tariff_versions tv
     JOIN tariffs t ON t.id = tv.tariff_id
     WHERE tv.is_active = TRUE
       AND (LOWER(tv.cargo_type) = LOWER($1) OR LOWER(tv.cargo_type) = 'default')
       AND tv.effective_from <= $2
       AND (tv.effective_to IS NULL OR tv.effective_to > $2)
     ORDER BY CASE WHEN LOWER(tv.cargo_type) = LOWER($1) THEN 0 ELSE 1 END,
              tv.effective_from DESC,
              tv.id DESC
     LIMIT 1`,
    [cargo.cargo_type || "Default", tariffDate]
  );

  if (result.rowCount === 0) {
    throw buildError(`No active tariff is configured for ${cargo.cargo_type || "this cargo type"}.`, 409);
  }

  return result.rows[0];
};

const getApprovedAdjustmentsCents = async ({ cargoId, periodStart, periodEnd, executor = db }) => {
  const result = await executor.query(
    `SELECT COALESCE(SUM(amount), 0) AS amount
     FROM cargo_charge_ledgers
     WHERE cargo_id = $1
       AND ledger_type = 'adjustment'
       AND status IN ('approved', 'posted')
       AND (period_start IS NULL OR period_start < $3)
       AND (period_end IS NULL OR period_end > $2)`,
    [cargoId, periodStart, periodEnd]
  );
  return centsFromAmount(result.rows[0]?.amount || 0);
};

const calculateStorageCharge = ({
  cargo,
  tariff,
  chargeEndAt,
  adjustmentsCents = 0n
}) => {
  const chargeStartAt = normalizeTimestamp(cargo.charge_start_at || cargo.created_at);
  const effectiveEnd = normalizeTimestamp(cargo.charge_end_at || cargo.released_at || chargeEndAt, new Date());
  const billableDays = calculateBillableDays({
    chargeStartAt,
    chargeEndAt: effectiveEnd,
    minimumBillableDays: tariff.minimum_billable_days
  });
  const quantity = getCargoQuantityForUnit(cargo, tariff.charging_unit);
  const baseCents = multiplyRateByUnitsAndDays({
    dailyRate: tariff.daily_rate,
    units: quantity.units,
    billableDays
  });
  const penaltyDays = Math.max(0, billableDays - (Number(tariff.grace_period_days) || 0));
  let penaltyCents = 0n;

  if (penaltyDays > 0 && tariff.penalty_type === "percentage") {
    penaltyCents = percentageOfCents(baseCents, tariff.penalty_rate);
  } else if (penaltyDays > 0 && tariff.penalty_type === "fixed") {
    penaltyCents = multiplyRateByUnitsAndDays({
      dailyRate: tariff.fixed_penalty,
      units: "1",
      billableDays: penaltyDays
    });
  }

  const totalCents = [baseCents, penaltyCents, BigInt(adjustmentsCents || 0)]
    .reduce((sum, value) => sum + value, 0n);
  const safeTotalCents = totalCents < 0n ? 0n : totalCents;

  return {
    charge_start_at: chargeStartAt,
    charge_end_at: effectiveEnd,
    billable_days: billableDays,
    quantity_used: quantity.units,
    quantity_unit_label: quantity.label,
    tariff_name: tariff.tariff_name,
    tariff_version_reference: tariff.public_reference,
    charging_unit: tariff.charging_unit,
    daily_rate: String(tariff.daily_rate),
    currency: tariff.currency,
    base_charge_cents: baseCents,
    penalties_cents: penaltyCents,
    adjustments_cents: BigInt(adjustmentsCents || 0),
    total_cents: safeTotalCents,
    base_charge: amountFromCents(baseCents),
    penalties: amountFromCents(penaltyCents),
    adjustments: amountFromCents(adjustmentsCents || 0n),
    total_amount: amountFromCents(safeTotalCents)
  };
};

const getConfirmedPaidCentsForCargo = async (cargoId, executor = db) => {
  const result = await executor.query(
    `SELECT COALESCE(SUM(p.amount), 0) AS paid
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     WHERE i.cargo_id = $1
       AND i.status <> 'Cancelled'
       AND p.status = 'Confirmed'`,
    [cargoId]
  );
  return centsFromAmount(result.rows[0]?.paid || 0);
};

const getCargoFinancialSnapshot = async ({ cargoId, at = null, executor = db }) => {
  const cargoResult = await executor.query("SELECT * FROM cargo WHERE id = $1 LIMIT 1", [cargoId]);
  const cargo = cargoResult.rows[0];
  if (!cargo) throw buildError("Cargo record not found.", 404);

  const calculationTime = at || await getServerNow(executor);
  const tariff = await getApplicableTariff(cargo, cargo.charge_start_at, executor);
  const adjustmentsCents = await getApprovedAdjustmentsCents({
    cargoId: cargo.id,
    periodStart: cargo.charge_start_at,
    periodEnd: cargo.charge_end_at || calculationTime,
    executor
  });
  const charge = calculateStorageCharge({
    cargo,
    tariff,
    chargeEndAt: cargo.charge_end_at || calculationTime,
    adjustmentsCents
  });
  const paidCents = await getConfirmedPaidCentsForCargo(cargo.id, executor);
  const outstandingCents = charge.total_cents > paidCents ? charge.total_cents - paidCents : 0n;

  return {
    cargo,
    tariff,
    calculation_time: calculationTime,
    charge,
    paid_cents: paidCents,
    outstanding_cents: outstandingCents,
    amount_paid: amountFromCents(paidCents),
    outstanding_balance: amountFromCents(outstandingCents)
  };
};

const updateCargoFinancialStatus = async ({ cargoId, at = null, executor = db }) => {
  const snapshot = await getCargoFinancialSnapshot({ cargoId, at, executor });
  const invoiceResult = await executor.query(
    `SELECT COUNT(*)::int AS invoice_count
     FROM invoices
     WHERE cargo_id = $1
       AND status <> 'Cancelled'`,
    [cargoId]
  );
  const invoiceCount = invoiceResult.rows[0]?.invoice_count || 0;
  let financialStatus = "Unbilled";

  if (snapshot.outstanding_cents === 0n) {
    financialStatus = "Fully Paid";
  } else if (snapshot.paid_cents > 0n) {
    financialStatus = "Partially Paid";
  } else if (invoiceCount > 0) {
    financialStatus = "Outstanding";
  }

  if (
    snapshot.cargo.gate_out_status === "Emergency Released"
    && snapshot.outstanding_cents > 0n
  ) {
    financialStatus = "Released With Balance";
  }

  const result = await executor.query(
    `UPDATE cargo
     SET financial_status = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING financial_status`,
    [financialStatus, cargoId]
  );

  return {
    ...snapshot,
    financial_status: result.rows[0]?.financial_status || financialStatus
  };
};

const listCargoCharges = async ({ filters = {}, executor = db }) => {
  const values = [];
  const clauses = ["c.is_deleted = FALSE"];

  if (filters.search) {
    values.push(`%${filters.search}%`);
    clauses.push(`(
      c.cargo_id ILIKE $${values.length}
      OR c.barcode ILIKE $${values.length}
      OR c.reference_number ILIKE $${values.length}
      OR c.delivery_note_number ILIKE $${values.length}
      OR c.consignee_name ILIKE $${values.length}
      OR c.company_name ILIKE $${values.length}
      OR c.cargo_type ILIKE $${values.length}
    )`);
  }

  if (filters.registration_from) {
    values.push(filters.registration_from);
    clauses.push(`c.created_at >= $${values.length}::date`);
  }

  if (filters.registration_to) {
    values.push(filters.registration_to);
    clauses.push(`c.created_at < ($${values.length}::date + INTERVAL '1 day')`);
  }

  const directFilters = [
    ["cargo_type", "c.cargo_type"],
    ["approval_status", "c.registration_status"],
    ["placement_status", "c.placement_status"],
    ["customs_status", "c.customs_status"],
    ["billing_status", "c.financial_status"]
  ];
  for (const [filterKey, column] of directFilters) {
    if (filters[filterKey]) {
      values.push(filters[filterKey]);
      clauses.push(`${column} = $${values.length}`);
    }
  }

  if (filters.invoice_status) {
    values.push(filters.invoice_status);
    clauses.push(`EXISTS (
      SELECT 1 FROM invoices invoice_filter
      WHERE invoice_filter.cargo_id = c.id
        AND invoice_filter.status = $${values.length}
    )`);
  }

  if (filters.payment_status) {
    values.push(filters.payment_status);
    clauses.push(`EXISTS (
      SELECT 1 FROM invoices payment_filter
      WHERE payment_filter.cargo_id = c.id
        AND payment_filter.payment_status = $${values.length}
    )`);
  }

  const page = Math.max(Number(filters.page) || 1, 1);
  const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 100);
  const offset = (page - 1) * limit;
  const sortColumn = sortableChargeFields.get(filters.sort_by) || "c.created_at";
  const sortDirection = String(filters.sort_order || "").toLowerCase() === "asc" ? "ASC" : "DESC";
  const whereClause = `WHERE ${clauses.join(" AND ")}`;

  const countResult = await executor.query(
    `SELECT COUNT(*)::int AS total FROM cargo c ${whereClause}`,
    values
  );

  const result = await executor.query(
    `SELECT
       c.id AS cargo_record_id,
       c.cargo_id,
       c.barcode,
       c.reference_number,
       c.delivery_note_number,
       c.consignee_name,
       c.company_name,
       c.cargo_type,
       c.cargo_description,
       c.weight,
       c.volume,
       c.registration_status,
       c.placement_status,
       c.customs_status,
       c.financial_status,
       c.dispatch_status,
       c.gate_out_status,
       c.created_at,
       c.charge_start_at,
       c.charge_end_at,
       c.released_at,
       invoice_totals.invoiced_amount,
       invoice_totals.latest_invoice_status,
       invoice_totals.latest_payment_status,
       payment_totals.paid_amount
     FROM cargo c
     LEFT JOIN LATERAL (
       SELECT
         COALESCE(SUM(total_amount), 0) AS invoiced_amount,
         (ARRAY_AGG(status ORDER BY created_at DESC, id DESC))[1] AS latest_invoice_status,
         (ARRAY_AGG(payment_status ORDER BY created_at DESC, id DESC))[1] AS latest_payment_status
       FROM invoices i
       WHERE i.cargo_id = c.id
         AND i.status <> 'Cancelled'
     ) invoice_totals ON TRUE
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(p.amount), 0) AS paid_amount
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       WHERE i.cargo_id = c.id
         AND p.status = 'Confirmed'
         AND i.status <> 'Cancelled'
     ) payment_totals ON TRUE
     ${whereClause}
     ORDER BY ${sortColumn} ${sortDirection}, c.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    values
  );

  const now = await getServerNow(executor);
  const rows = [];

  for (const row of result.rows) {
    let charge = null;
    let tariff = null;
    let billingStatus = row.financial_status || "Unbilled";
    let tariffError = "";

    try {
      tariff = await getApplicableTariff(row, row.charge_start_at, executor);
      const adjustmentsCents = await getApprovedAdjustmentsCents({
        cargoId: row.cargo_record_id,
        periodStart: row.charge_start_at,
        periodEnd: row.charge_end_at || now,
        executor
      });
      charge = calculateStorageCharge({
        cargo: row,
        tariff,
        chargeEndAt: row.charge_end_at || now,
        adjustmentsCents
      });
      const paidCents = centsFromAmount(row.paid_amount || 0);
      const outstandingCents = charge.total_cents > paidCents ? charge.total_cents - paidCents : 0n;
      billingStatus = outstandingCents === 0n ? "Fully Paid" : row.financial_status;
    } catch (error) {
      tariffError = error.message;
    }

    const paidCents = centsFromAmount(row.paid_amount || 0);
    const invoicedCents = centsFromAmount(row.invoiced_amount || 0);
    const accruedCents = charge?.total_cents || 0n;
    const outstandingCents = accruedCents > paidCents ? accruedCents - paidCents : 0n;
    const uninvoicedCents = accruedCents > invoicedCents ? accruedCents - invoicedCents : 0n;

    rows.push({
      cargo_reference: row.cargo_id,
      barcode: row.barcode,
      reference_number: row.reference_number,
      delivery_note_number: row.delivery_note_number,
      consignee_name: row.consignee_name,
      owner_information: row.company_name || row.consignee_name,
      cargo_type: row.cargo_type,
      cargo_description: row.cargo_description,
      weight: row.weight,
      volume: row.volume,
      registration_date: row.created_at,
      approval_status: row.registration_status,
      placement_status: row.placement_status,
      customs_status: row.customs_status,
      charge_start_date: row.charge_start_at,
      charge_end_at: row.charge_end_at,
      current_calculation_date: row.charge_end_at || now,
      billable_days: charge?.billable_days || 0,
      applied_tariff: charge?.tariff_name || null,
      applied_tariff_rate: charge?.daily_rate || null,
      charging_unit: charge?.charging_unit || null,
      base_storage_charge: charge?.base_charge || "0.00",
      penalties: charge?.penalties || "0.00",
      adjustments: charge?.adjustments || "0.00",
      current_accrued_charge: charge?.total_amount || "0.00",
      uninvoiced_accrued_charge: amountFromCents(uninvoicedCents),
      invoiced_amount: amountFromCents(invoicedCents),
      paid_amount: amountFromCents(paidCents),
      outstanding_amount: amountFromCents(outstandingCents),
      billing_status: billingStatus,
      invoice_status: row.latest_invoice_status || "Not Invoiced",
      payment_status: row.latest_payment_status || "Unpaid",
      tariff_error: tariffError
    });
  }

  return {
    rows,
    total: countResult.rows[0]?.total || 0,
    page,
    limit
  };
};

const getFinanceDashboard = async ({ filters = {}, executor = db }) => {
  const [invoiceCounts, totals, recentPayments, charges] = await Promise.all([
    executor.query(
      `SELECT status, COUNT(*)::int AS count
       FROM invoices
       GROUP BY status`
    ),
    executor.query(
      `SELECT
         COALESCE(SUM(total_amount) FILTER (WHERE status <> 'Cancelled'), 0) AS invoiced_amount,
         COALESCE(SUM(amount_paid) FILTER (WHERE status <> 'Cancelled'), 0) AS amount_received,
         COALESCE(SUM(outstanding_balance) FILTER (WHERE status <> 'Cancelled'), 0) AS outstanding_balance
       FROM invoices`
    ),
    executor.query(
      `SELECT
         p.public_reference,
         i.public_invoice_number,
         c.cargo_id AS cargo_reference,
         p.amount,
         p.bank_name,
         p.bank_reference,
         p.payment_date,
         p.confirmed_at
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN cargo c ON c.id = i.cargo_id
       WHERE p.status = 'Confirmed'
       ORDER BY p.confirmed_at DESC, p.id DESC
       LIMIT 8`
    ),
    listCargoCharges({ filters: { limit: 100 }, executor })
  ]);

  const invoiceMetric = Object.fromEntries(invoiceCounts.rows.map((row) => [row.status, row.count]));
  const chargeRows = charges.rows;
  const accumulating = chargeRows.filter((row) => !row.charge_end_at && row.billing_status !== "Fully Paid");
  const uninvoicedCents = chargeRows.reduce((sum, row) => sum + centsFromAmount(row.uninvoiced_accrued_charge), 0n);
  const chargesByCargoType = {};
  for (const row of chargeRows) {
    const key = row.cargo_type || "Unspecified";
    chargesByCargoType[key] = (chargesByCargoType[key] || 0n) + centsFromAmount(row.current_accrued_charge);
  }

  const revenueClauses = ["p.status = 'Confirmed'"];
  const revenueValues = [];
  if (filters.date_from) {
    revenueValues.push(filters.date_from);
    revenueClauses.push(`p.payment_date >= $${revenueValues.length}::date`);
  }
  if (filters.date_to) {
    revenueValues.push(filters.date_to);
    revenueClauses.push(`p.payment_date < ($${revenueValues.length}::date + INTERVAL '1 day')`);
  }
  const revenueResult = await executor.query(
    `SELECT DATE(p.payment_date) AS revenue_date, COALESCE(SUM(p.amount), 0) AS amount
     FROM payments p
     WHERE ${revenueClauses.join(" AND ")}
     GROUP BY DATE(p.payment_date)
     ORDER BY revenue_date DESC
     LIMIT 31`,
    revenueValues
  );

  return {
    metrics: {
      accumulating_charges: accumulating.length,
      uninvoiced_accrued_charges: amountFromCents(uninvoicedCents),
      draft_invoices: invoiceMetric.Draft || 0,
      issued_invoices: invoiceMetric.Issued || 0,
      partially_paid_invoices: invoiceMetric["Partially Paid"] || 0,
      paid_invoices: invoiceMetric.Paid || 0,
      overdue_invoices: invoiceMetric.Overdue || 0,
      total_invoiced_amount: amountFromCents(centsFromAmount(totals.rows[0]?.invoiced_amount || 0)),
      total_amount_received: amountFromCents(centsFromAmount(totals.rows[0]?.amount_received || 0)),
      outstanding_balance: amountFromCents(centsFromAmount(totals.rows[0]?.outstanding_balance || 0))
    },
    revenue_by_date: revenueResult.rows.map((row) => ({
      date: row.revenue_date,
      amount: amountFromCents(centsFromAmount(row.amount))
    })),
    charges_by_cargo_type: Object.entries(chargesByCargoType).map(([cargoType, amount]) => ({
      cargo_type: cargoType,
      amount: amountFromCents(amount)
    })),
    recent_payments: recentPayments.rows.map((row) => ({
      payment_reference: row.public_reference,
      invoice_number: row.public_invoice_number,
      cargo_reference: row.cargo_reference,
      amount: amountFromCents(centsFromAmount(row.amount)),
      bank_name: row.bank_name,
      bank_reference: row.bank_reference,
      payment_date: row.payment_date,
      confirmed_at: row.confirmed_at
    }))
  };
};

const listTariffs = async ({ filters = {}, executor = db }) => {
  const values = [];
  const clauses = [];
  if (filters.cargo_type) {
    values.push(filters.cargo_type);
    clauses.push(`tv.cargo_type = $${values.length}`);
  }
  if (filters.charging_unit) {
    values.push(filters.charging_unit);
    clauses.push(`tv.charging_unit = $${values.length}`);
  }
  if (filters.active === "true" || filters.active === true) {
    clauses.push("tv.is_active = TRUE");
  }
  const result = await executor.query(
    `SELECT
       t.public_reference AS tariff_reference,
       t.tariff_name,
       t.description,
       tv.*
     FROM tariff_versions tv
     JOIN tariffs t ON t.id = tv.tariff_id
     ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     ORDER BY tv.cargo_type, tv.charging_unit, tv.effective_from DESC, tv.id DESC`,
    values
  );
  return result.rows.map(tariffToPublic);
};

const assertTariffDoesNotOverlap = async ({
  cargoType,
  chargingUnit,
  effectiveFrom,
  effectiveTo,
  excludeVersionReference = "",
  executor = db
}) => {
  const values = [cargoType, chargingUnit, effectiveFrom, effectiveTo || null];
  let exclusion = "";
  if (excludeVersionReference) {
    values.push(excludeVersionReference);
    exclusion = `AND tv.public_reference <> $${values.length}`;
  }

  const result = await executor.query(
    `SELECT tv.public_reference
     FROM tariff_versions tv
     WHERE LOWER(tv.cargo_type) = LOWER($1)
       AND tv.charging_unit = $2
       AND tv.effective_from < COALESCE($4::timestamp, '9999-12-31'::timestamp)
       AND COALESCE(tv.effective_to, '9999-12-31'::timestamp) > $3::timestamp
       ${exclusion}
     LIMIT 1`,
    values
  );

  if (result.rowCount > 0) {
    throw buildError("Tariff versions must not overlap for the same cargo type and charging unit.", 409);
  }
};

const readTariffPayload = (payload) => {
  const tariffName = cleanString(payload.tariff_name);
  const cargoType = cleanString(payload.cargo_type);
  const chargingUnit = cleanString(payload.charging_unit);
  const currency = cleanString(payload.currency || "TZS").toUpperCase();
  const effectiveFrom = normalizeTimestamp(payload.effective_from);
  const effectiveTo = payload.effective_to ? normalizeTimestamp(payload.effective_to) : null;

  if (!tariffName || !cargoType || !chargingUnits.has(chargingUnit)) {
    throw buildError("Tariff name, cargo type, and a supported charging unit are required.", 400);
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw buildError("Currency must be a three-letter code.", 400);
  }
  if (!effectiveFrom) {
    throw buildError("Effective-from date is required.", 400);
  }
  if (effectiveTo && effectiveTo <= effectiveFrom) {
    throw buildError("Effective-to date must be later than effective-from date.", 400);
  }

  const dailyRateCents = centsFromAmount(payload.daily_rate);
  const penaltyRate = parseDecimalToScale(payload.penalty_rate || 0, DECIMAL_SCALE);
  const fixedPenaltyCents = centsFromAmount(payload.fixed_penalty || 0);
  if (dailyRateCents < 0n || penaltyRate < 0n || fixedPenaltyCents < 0n) {
    throw buildError("Tariff rates and penalties cannot be negative.", 400);
  }

  const minimumBillableDays = Math.max(Number(payload.minimum_billable_days) || 1, 1);
  const gracePeriodDays = Math.max(Number(payload.grace_period_days) || 0, 0);
  const penaltyType = ["none", "percentage", "fixed"].includes(payload.penalty_type)
    ? payload.penalty_type
    : "none";

  return {
    tariffName,
    cargoType,
    chargingUnit,
    dailyRate: amountFromCents(dailyRateCents),
    currency,
    minimumBillableDays,
    gracePeriodDays,
    penaltyType,
    penaltyRate: decimalStringFromScaled(penaltyRate, DECIMAL_SCALE),
    fixedPenalty: amountFromCents(fixedPenaltyCents),
    effectiveFrom,
    effectiveTo,
    isActive: payload.is_active === true,
    description: cleanString(payload.description || payload.notes),
    notes: cleanString(payload.notes || payload.description)
  };
};

const createTariffVersion = async ({ payload, auth, executor = db }) => {
  const data = readTariffPayload(payload);
  await assertTariffDoesNotOverlap({
    cargoType: data.cargoType,
    chargingUnit: data.chargingUnit,
    effectiveFrom: data.effectiveFrom,
    effectiveTo: data.effectiveTo,
    executor
  });

  const tariffRef = await generatePublicReference("TRF", executor, "tariffs", "public_reference");
  const versionRef = await generatePublicReference("TRV", executor, "tariff_versions", "public_reference");

  const tariffResult = await executor.query(
    `INSERT INTO tariffs (public_reference, tariff_name, cargo_type, charging_unit, description, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tariff_name, cargo_type, charging_unit) DO UPDATE
     SET description = COALESCE(EXCLUDED.description, tariffs.description),
         updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      tariffRef,
      data.tariffName,
      data.cargoType,
      data.chargingUnit,
      data.description || null,
      auth?.userId || null
    ]
  );
  const tariff = tariffResult.rows[0];
  const versionNumberResult = await executor.query(
    "SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number FROM tariff_versions WHERE tariff_id = $1",
    [tariff.id]
  );
  const versionNumber = versionNumberResult.rows[0]?.version_number || 1;
  const versionResult = await executor.query(
    `INSERT INTO tariff_versions (
       public_reference, tariff_id, version_number, cargo_type, charging_unit,
       daily_rate, currency, minimum_billable_days, grace_period_days,
       penalty_type, penalty_rate, fixed_penalty, effective_from, effective_to,
       is_active, notes, created_by, activated_by, activated_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
             CASE WHEN $15 THEN $17 ELSE NULL END,
             CASE WHEN $15 THEN CURRENT_TIMESTAMP ELSE NULL END)
     RETURNING *`,
    [
      versionRef,
      tariff.id,
      versionNumber,
      data.cargoType,
      data.chargingUnit,
      data.dailyRate,
      data.currency,
      data.minimumBillableDays,
      data.gracePeriodDays,
      data.penaltyType,
      data.penaltyRate,
      data.fixedPenalty,
      data.effectiveFrom,
      data.effectiveTo,
      data.isActive,
      data.notes || null,
      auth?.userId || null
    ]
  );

  await writeAuditLog(
    {
      user_id: auth?.userId || null,
      action: "CREATE_TARIFF_VERSION",
      module: "Billing and Payment",
      description: `Created tariff version ${versionRef}.`,
      metadata: {
        entity_reference: versionRef,
        before: null,
        after: tariffToPublic({
          ...versionResult.rows[0],
          tariff_reference: tariff.public_reference,
          tariff_name: tariff.tariff_name
        })
      }
    },
    executor
  );

  return tariffToPublic({
    ...versionResult.rows[0],
    tariff_reference: tariff.public_reference,
    tariff_name: tariff.tariff_name
  });
};

const updateTariffVersion = async ({ tariffVersionReference, payload, auth, executor = db }) => {
  const existingResult = await executor.query(
    `SELECT tv.*, t.public_reference AS tariff_reference, t.tariff_name, t.description
     FROM tariff_versions tv
     JOIN tariffs t ON t.id = tv.tariff_id
     WHERE tv.public_reference = $1
     FOR UPDATE OF tv`,
    [cleanString(tariffVersionReference)]
  );
  if (existingResult.rowCount === 0) throw buildError("Tariff version not found.", 404);
  const existing = existingResult.rows[0];
  const usedResult = await executor.query(
    `SELECT 1 FROM invoices WHERE tariff_version_id = $1 LIMIT 1`,
    [existing.id]
  );
  if (usedResult.rowCount > 0) {
    throw buildError("Used tariff versions cannot be overwritten. Create a new tariff version instead.", 409);
  }

  const data = readTariffPayload({
    tariff_name: payload.tariff_name ?? existing.tariff_name,
    cargo_type: payload.cargo_type ?? existing.cargo_type,
    charging_unit: payload.charging_unit ?? existing.charging_unit,
    daily_rate: payload.daily_rate ?? existing.daily_rate,
    currency: payload.currency ?? existing.currency,
    minimum_billable_days: payload.minimum_billable_days ?? existing.minimum_billable_days,
    grace_period_days: payload.grace_period_days ?? existing.grace_period_days,
    penalty_type: payload.penalty_type ?? existing.penalty_type,
    penalty_rate: payload.penalty_rate ?? existing.penalty_rate,
    fixed_penalty: payload.fixed_penalty ?? existing.fixed_penalty,
    effective_from: payload.effective_from ?? existing.effective_from,
    effective_to: Object.prototype.hasOwnProperty.call(payload, "effective_to") ? payload.effective_to : existing.effective_to,
    is_active: existing.is_active,
    notes: payload.notes ?? existing.notes,
    description: payload.description ?? existing.description
  });

  await assertTariffDoesNotOverlap({
    cargoType: data.cargoType,
    chargingUnit: data.chargingUnit,
    effectiveFrom: data.effectiveFrom,
    effectiveTo: data.effectiveTo,
    excludeVersionReference: existing.public_reference,
    executor
  });

  await executor.query(
    `UPDATE tariffs
     SET tariff_name = $1,
         cargo_type = $2,
         charging_unit = $3,
         description = $4,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $5`,
    [data.tariffName, data.cargoType, data.chargingUnit, data.description || null, existing.tariff_id]
  );

  const updatedResult = await executor.query(
    `UPDATE tariff_versions
     SET cargo_type = $1,
         charging_unit = $2,
         daily_rate = $3,
         currency = $4,
         minimum_billable_days = $5,
         grace_period_days = $6,
         penalty_type = $7,
         penalty_rate = $8,
         fixed_penalty = $9,
         effective_from = $10,
         effective_to = $11,
         notes = $12,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $13
     RETURNING *`,
    [
      data.cargoType,
      data.chargingUnit,
      data.dailyRate,
      data.currency,
      data.minimumBillableDays,
      data.gracePeriodDays,
      data.penaltyType,
      data.penaltyRate,
      data.fixedPenalty,
      data.effectiveFrom,
      data.effectiveTo,
      data.notes || null,
      existing.id
    ]
  );

  const after = tariffToPublic({
    ...updatedResult.rows[0],
    tariff_reference: existing.tariff_reference,
    tariff_name: data.tariffName
  });
  await writeAuditLog(
    {
      user_id: auth?.userId || null,
      action: "UPDATE_TARIFF_VERSION",
      module: "Billing and Payment",
      description: `Updated tariff version ${existing.public_reference}.`,
      metadata: {
        entity_reference: existing.public_reference,
        before: tariffToPublic(existing),
        after
      }
    },
    executor
  );
  return after;
};

const setTariffVersionActiveState = async ({ tariffVersionReference, active, confirm, auth, executor = db }) => {
  if (active && confirm !== true) {
    throw buildError("Confirm activation before making this tariff active.", 400);
  }
  const result = await executor.query(
    `SELECT tv.*, t.public_reference AS tariff_reference, t.tariff_name
     FROM tariff_versions tv
     JOIN tariffs t ON t.id = tv.tariff_id
     WHERE tv.public_reference = $1
     FOR UPDATE OF tv`,
    [cleanString(tariffVersionReference)]
  );
  if (result.rowCount === 0) throw buildError("Tariff version not found.", 404);
  const existing = result.rows[0];
  if (active) {
    await assertTariffDoesNotOverlap({
      cargoType: existing.cargo_type,
      chargingUnit: existing.charging_unit,
      effectiveFrom: existing.effective_from,
      effectiveTo: existing.effective_to,
      excludeVersionReference: existing.public_reference,
      executor
    });
  }
  const updatedResult = await executor.query(
    `UPDATE tariff_versions
     SET is_active = $1,
         activated_by = CASE WHEN $1 THEN $2 ELSE activated_by END,
         activated_at = CASE WHEN $1 THEN CURRENT_TIMESTAMP ELSE activated_at END,
         deactivated_by = CASE WHEN $1 THEN NULL ELSE $2 END,
         deactivated_at = CASE WHEN $1 THEN NULL ELSE CURRENT_TIMESTAMP END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $3
     RETURNING *`,
    [active, auth?.userId || null, existing.id]
  );
  const after = tariffToPublic({
    ...updatedResult.rows[0],
    tariff_reference: existing.tariff_reference,
    tariff_name: existing.tariff_name
  });
  await writeAuditLog(
    {
      user_id: auth?.userId || null,
      action: active ? "ACTIVATE_TARIFF_VERSION" : "DEACTIVATE_TARIFF_VERSION",
      module: "Billing and Payment",
      description: `${active ? "Activated" : "Deactivated"} tariff version ${existing.public_reference}.`,
      metadata: {
        entity_reference: existing.public_reference,
        before: tariffToPublic(existing),
        after
      }
    },
    executor
  );
  return after;
};

const buildInvoicePublicPayload = async (invoice, executor = db) => {
  const lineItems = await executor.query(
    `SELECT line_type, description, quantity, unit_rate, amount, metadata
     FROM invoice_line_items
     WHERE invoice_id = $1
     ORDER BY id`,
    [invoice.id]
  );
  return {
    invoice_number: invoice.public_invoice_number,
    status: invoice.status,
    payment_status: invoice.payment_status,
    cargo_reference: invoice.cargo_reference,
    cargo_barcode: invoice.cargo_barcode,
    cargo_description: invoice.cargo_description,
    cargo_type: invoice.cargo_type,
    consignee_name: invoice.consignee_name,
    owner_information: invoice.company_name || invoice.consignee_name,
    registration_date: invoice.calculation_snapshot?.registration_date,
    billing_period_start: invoice.billing_period_start,
    billing_period_end: invoice.billing_period_end,
    charge_start_at: invoice.charge_start_at,
    charge_end_at: invoice.charge_end_at,
    billable_days: invoice.billable_days,
    tariff: invoice.tariff_snapshot,
    base_charge: amountFromCents(centsFromAmount(invoice.base_charge)),
    penalties: amountFromCents(centsFromAmount(invoice.penalties)),
    adjustments: amountFromCents(centsFromAmount(invoice.adjustments)),
    total_amount: amountFromCents(centsFromAmount(invoice.total_amount)),
    amount_paid: amountFromCents(centsFromAmount(invoice.amount_paid)),
    outstanding_balance: amountFromCents(centsFromAmount(invoice.outstanding_balance)),
    currency: invoice.currency,
    issue_date: invoice.issued_at,
    generated_by_name: invoice.calculation_snapshot?.generated_by_name || null,
    created_at: invoice.created_at,
    line_items: lineItems.rows.map((line) => ({
      line_type: line.line_type,
      description: line.description,
      quantity: line.quantity,
      unit_rate: line.unit_rate,
      amount: amountFromCents(centsFromAmount(line.amount)),
      metadata: line.metadata || {}
    }))
  };
};

const createOrRegenerateDraftInvoice = async ({ payload, auth, executor = db }) => {
  const cargoReference = cleanString(payload.cargo_reference);
  if (!cargoReference) throw buildError("Cargo reference is required.", 400);
  const cargo = await findCargoByPublicReference(executor, cargoReference, { lock: true });
  if (!cargo) throw buildError("Cargo record not found.", 404);

  const now = await getServerNow(executor);
  const requestedEnd = normalizeTimestamp(payload.billing_period_end);
  const releaseEnd = cargo.charge_end_at || cargo.released_at;
  const billingEnd = requestedEnd || releaseEnd || now;
  const chargeStart = normalizeTimestamp(cargo.charge_start_at || cargo.created_at);
  const previousResult = await executor.query(
    `SELECT MAX(billing_period_end) AS last_billed_at
     FROM invoices
     WHERE cargo_id = $1
       AND status <> 'Cancelled'
       AND status <> 'Draft'`,
    [cargo.id]
  );
  const previousEnd = normalizeTimestamp(previousResult.rows[0]?.last_billed_at);
  const billingStart = maxDate(chargeStart, previousEnd) || chargeStart;

  if (billingEnd <= billingStart) {
    throw buildError("There are no unbilled storage days for this cargo and period.", 409);
  }

  const tariff = await getApplicableTariff(cargo, billingStart, executor);
  const adjustmentsCents = await getApprovedAdjustmentsCents({
    cargoId: cargo.id,
    periodStart: billingStart,
    periodEnd: billingEnd,
    executor
  });
  const periodCargo = {
    ...cargo,
    charge_start_at: billingStart,
    charge_end_at: billingEnd
  };
  const calculation = calculateStorageCharge({
    cargo: periodCargo,
    tariff,
    chargeEndAt: billingEnd,
    adjustmentsCents
  });

  const existingDraftResult = await executor.query(
    `SELECT *
     FROM invoices
     WHERE cargo_id = $1
       AND status = 'Draft'
     ORDER BY created_at DESC, id DESC
     LIMIT 1
     FOR UPDATE`,
    [cargo.id]
  );
  const invoiceNumber = existingDraftResult.rows[0]?.public_invoice_number
    || await generatePublicReference("INV", executor, "invoices", "public_invoice_number");
  const tariffSnapshot = {
    tariff_name: tariff.tariff_name,
    tariff_version_reference: tariff.public_reference,
    charging_unit: tariff.charging_unit,
    daily_rate: String(tariff.daily_rate),
    currency: tariff.currency,
    minimum_billable_days: tariff.minimum_billable_days,
    grace_period_days: tariff.grace_period_days,
    penalty_type: tariff.penalty_type,
    penalty_rate: tariff.penalty_rate,
    fixed_penalty: tariff.fixed_penalty
  };
  const calculationSnapshot = {
    cargo_reference: cargo.cargo_id,
    registration_date: cargo.created_at,
    charge_start_at: calculation.charge_start_at,
    charge_end_at: calculation.charge_end_at,
    billable_days: calculation.billable_days,
    quantity_used: calculation.quantity_used,
    quantity_unit_label: calculation.quantity_unit_label,
    generated_by_name: auth?.username || null,
    calculated_at: now
  };
  const invoiceValues = [
    invoiceNumber,
    cargo.id,
    tariff.id,
    billingStart,
    billingEnd,
    chargeStart,
    releaseEnd || null,
    calculation.billable_days,
    calculation.currency,
    calculation.base_charge,
    calculation.penalties,
    calculation.adjustments,
    calculation.total_amount,
    calculation.total_amount,
    JSON.stringify(tariffSnapshot),
    JSON.stringify(calculationSnapshot),
    auth?.userId || null
  ];

  let invoiceResult;
  if (existingDraftResult.rowCount > 0) {
    invoiceValues.push(existingDraftResult.rows[0].id);
    invoiceResult = await executor.query(
      `UPDATE invoices
       SET tariff_version_id = $3,
           billing_period_start = $4,
           billing_period_end = $5,
           charge_start_at = $6,
           charge_end_at = $7,
           billable_days = $8,
           currency = $9,
           base_charge = $10,
           penalties = $11,
           adjustments = $12,
           total_amount = $13,
           amount_paid = 0,
           outstanding_balance = $14,
           payment_status = 'Unpaid',
           tariff_snapshot = $15::jsonb,
           calculation_snapshot = $16::jsonb,
           generated_by = $17,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $18
       RETURNING *`,
      invoiceValues
    );
    await executor.query("DELETE FROM invoice_line_items WHERE invoice_id = $1", [existingDraftResult.rows[0].id]);
  } else {
    invoiceResult = await executor.query(
      `INSERT INTO invoices (
         public_invoice_number, cargo_id, tariff_version_id, billing_period_start,
         billing_period_end, charge_start_at, charge_end_at, billable_days,
         currency, base_charge, penalties, adjustments, total_amount,
         outstanding_balance, tariff_snapshot, calculation_snapshot, generated_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17)
       RETURNING *`,
      invoiceValues
    );
  }

  const invoice = invoiceResult.rows[0];
  await executor.query(
    `INSERT INTO invoice_line_items (invoice_id, line_type, description, quantity, unit_rate, amount, metadata)
     VALUES
       ($1, 'storage', $2, $3, $4, $5, $6::jsonb),
       ($1, 'penalty', $7, 1, $8, $9, $10::jsonb),
       ($1, 'adjustment', $11, 1, $12, $13, $14::jsonb)`,
    [
      invoice.id,
      `Storage charge for ${cargo.cargo_id}`,
      calculation.billable_days,
      tariff.daily_rate,
      calculation.base_charge,
      JSON.stringify({ charging_unit: tariff.charging_unit, quantity_used: calculation.quantity_used }),
      "Applicable storage penalties",
      calculation.penalties,
      calculation.penalties,
      JSON.stringify({ penalty_type: tariff.penalty_type }),
      "Approved charge adjustments",
      calculation.adjustments,
      calculation.adjustments,
      JSON.stringify({})
    ]
  );

  await writeAuditLog(
    {
      user_id: auth?.userId || null,
      action: existingDraftResult.rowCount > 0 ? "REGENERATE_DRAFT_INVOICE" : "GENERATE_DRAFT_INVOICE",
      module: "Billing and Payment",
      description: `Generated draft invoice ${invoice.public_invoice_number} for cargo ${cargo.cargo_id}.`,
      metadata: {
        entity_reference: invoice.public_invoice_number,
        cargo_reference: cargo.cargo_id,
        calculation_snapshot: calculationSnapshot
      }
    },
    executor
  );

  const hydrated = await findInvoiceByNumber(executor, invoice.public_invoice_number);
  return buildInvoicePublicPayload(hydrated, executor);
};

const issueInvoice = async ({ invoiceNumber, auth, executor = db }) => {
  const invoice = await findInvoiceByNumber(executor, invoiceNumber, { lock: true });
  if (!invoice) throw buildError("Invoice not found.", 404);
  if (invoice.status !== "Draft") {
    throw buildError("Only draft invoices can be issued.", 409);
  }
  const result = await executor.query(
    `UPDATE invoices
     SET status = 'Issued',
         issued_by = $1,
         issued_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING *`,
    [auth?.userId || null, invoice.id]
  );
  await updateCargoFinancialStatus({ cargoId: invoice.cargo_id, executor });
  await writeAuditLog(
    {
      user_id: auth?.userId || null,
      action: "ISSUE_INVOICE",
      module: "Billing and Payment",
      description: `Issued invoice ${invoice.public_invoice_number}.`,
      metadata: {
        entity_reference: invoice.public_invoice_number,
        before: { status: invoice.status },
        after: { status: "Issued" }
      }
    },
    executor
  );
  const hydrated = await findInvoiceByNumber(executor, result.rows[0].public_invoice_number);
  return buildInvoicePublicPayload(hydrated, executor);
};

const cancelInvoice = async ({ invoiceNumber, reason, auth, executor = db }) => {
  const invoice = await findInvoiceByNumber(executor, invoiceNumber, { lock: true });
  if (!invoice) throw buildError("Invoice not found.", 404);
  const cancellationReason = cleanString(reason);
  if (!cancellationReason) throw buildError("Cancellation justification is required.", 400);
  if (invoice.status === "Paid" || centsFromAmount(invoice.amount_paid) > 0n) {
    throw buildError("Paid or partially paid invoices cannot be cancelled by this workflow.", 409);
  }
  if (invoice.status === "Cancelled") {
    throw buildError("Invoice is already cancelled.", 409);
  }
  const result = await executor.query(
    `UPDATE invoices
     SET status = 'Cancelled',
         cancelled_by = $1,
         cancelled_at = CURRENT_TIMESTAMP,
         cancellation_reason = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $3
     RETURNING *`,
    [auth?.userId || null, cancellationReason, invoice.id]
  );
  await updateCargoFinancialStatus({ cargoId: invoice.cargo_id, executor });
  await writeAuditLog(
    {
      user_id: auth?.userId || null,
      action: "CANCEL_INVOICE",
      module: "Billing and Payment",
      description: `Cancelled invoice ${invoice.public_invoice_number}.`,
      metadata: {
        entity_reference: invoice.public_invoice_number,
        reason: cancellationReason,
        before: { status: invoice.status },
        after: { status: "Cancelled" }
      }
    },
    executor
  );
  const hydrated = await findInvoiceByNumber(executor, result.rows[0].public_invoice_number);
  return buildInvoicePublicPayload(hydrated, executor);
};

const refreshInvoicePaymentStatus = async ({ invoiceId, executor = db }) => {
  const invoiceResult = await executor.query(
    "SELECT * FROM invoices WHERE id = $1 FOR UPDATE",
    [invoiceId]
  );
  const invoice = invoiceResult.rows[0];
  if (!invoice || invoice.status === "Cancelled") return invoice || null;
  const paidResult = await executor.query(
    `SELECT COALESCE(SUM(amount), 0) AS paid
     FROM payments
     WHERE invoice_id = $1
       AND status = 'Confirmed'`,
    [invoiceId]
  );
  const paidCents = centsFromAmount(paidResult.rows[0]?.paid || 0);
  const totalCents = centsFromAmount(invoice.total_amount);
  const outstandingCents = totalCents > paidCents ? totalCents - paidCents : 0n;
  let status = invoice.status;
  let paymentStatus = "Unpaid";
  if (invoice.status !== "Draft") {
    if (outstandingCents === 0n) {
      status = "Paid";
      paymentStatus = "Paid";
    } else if (paidCents > 0n) {
      status = "Partially Paid";
      paymentStatus = "Partially Paid";
    } else {
      status = invoice.status === "Overdue" ? "Overdue" : "Issued";
    }
  }
  const result = await executor.query(
    `UPDATE invoices
     SET status = $1,
         payment_status = $2,
         amount_paid = $3,
         outstanding_balance = $4,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $5
     RETURNING *`,
    [
      status,
      paymentStatus,
      amountFromCents(paidCents),
      amountFromCents(outstandingCents),
      invoiceId
    ]
  );
  return result.rows[0];
};

const recordPayment = async ({ payload, auth, executor = db }) => {
  const invoiceNumber = cleanString(payload.invoice_number);
  const invoice = await findInvoiceByNumber(executor, invoiceNumber, { lock: true });
  if (!invoice) throw buildError("Invoice not found.", 404);
  if (invoice.status === "Draft" || invoice.status === "Cancelled") {
    throw buildError("Payments can only be recorded against issued invoices.", 409);
  }
  const amountCents = centsFromAmount(payload.amount);
  if (amountCents <= 0n) throw buildError("Payment amount must be greater than zero.", 400);
  const outstandingCents = centsFromAmount(invoice.outstanding_balance);
  if (amountCents > outstandingCents) {
    throw buildError("Payment amount cannot exceed the invoice outstanding balance.", 400);
  }
  const bankName = cleanString(payload.bank_name);
  const bankReference = cleanString(payload.bank_reference);
  const paymentDate = normalizeTimestamp(payload.payment_date);
  if (!bankName || !bankReference || !paymentDate) {
    throw buildError("Bank name, bank reference, and payment date are required.", 400);
  }
  const publicReference = await generatePublicReference("PAY", executor, "payments", "public_reference");
  const paymentResult = await executor.query(
    `INSERT INTO payments (
       public_reference, invoice_id, amount, bank_name, bank_reference,
       payment_date, proof_of_payment, notes, recorded_by, confirmed_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
     RETURNING *`,
    [
      publicReference,
      invoice.id,
      amountFromCents(amountCents),
      bankName,
      bankReference,
      paymentDate,
      cleanString(payload.proof_of_payment) || null,
      cleanString(payload.notes) || null,
      auth?.userId || null
    ]
  );
  const updatedInvoice = await refreshInvoicePaymentStatus({ invoiceId: invoice.id, executor });
  const cargoSnapshot = await updateCargoFinancialStatus({ cargoId: invoice.cargo_id, executor });
  await writeAuditLog(
    {
      user_id: auth?.userId || null,
      action: "CONFIRM_PAYMENT",
      module: "Billing and Payment",
      description: `Confirmed payment ${publicReference} for invoice ${invoice.public_invoice_number}.`,
      metadata: {
        entity_reference: publicReference,
        invoice_number: invoice.public_invoice_number,
        cargo_reference: invoice.cargo_reference,
        amount: amountFromCents(amountCents),
        before: {
          invoice_status: invoice.status,
          outstanding_balance: invoice.outstanding_balance
        },
        after: {
          invoice_status: updatedInvoice.status,
          outstanding_balance: updatedInvoice.outstanding_balance,
          cargo_financial_status: cargoSnapshot.financial_status
        }
      }
    },
    executor
  );

  return {
    payment_reference: paymentResult.rows[0].public_reference,
    invoice_number: invoice.public_invoice_number,
    cargo_reference: invoice.cargo_reference,
    amount: amountFromCents(amountCents),
    bank_name: paymentResult.rows[0].bank_name,
    bank_reference: paymentResult.rows[0].bank_reference,
    payment_date: paymentResult.rows[0].payment_date,
    confirmed_at: paymentResult.rows[0].confirmed_at,
    invoice_status: updatedInvoice.status,
    payment_status: updatedInvoice.payment_status,
    cargo_financial_status: cargoSnapshot.financial_status
  };
};

const listInvoices = async ({ filters = {}, executor = db }) => {
  const values = [];
  const clauses = [];
  if (filters.status) {
    values.push(filters.status);
    clauses.push(`i.status = $${values.length}`);
  }
  if (filters.search) {
    values.push(`%${filters.search}%`);
    clauses.push(`(
      i.public_invoice_number ILIKE $${values.length}
      OR c.cargo_id ILIKE $${values.length}
      OR c.consignee_name ILIKE $${values.length}
      OR c.company_name ILIKE $${values.length}
    )`);
  }
  const page = Math.max(Number(filters.page) || 1, 1);
  const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 100);
  const offset = (page - 1) * limit;
  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const countResult = await executor.query(
    `SELECT COUNT(*)::int AS total
     FROM invoices i
     JOIN cargo c ON c.id = i.cargo_id
     ${whereClause}`,
    values
  );
  const result = await executor.query(
    `SELECT i.*, c.cargo_id AS cargo_reference, c.cargo_type, c.consignee_name, c.company_name
     FROM invoices i
     JOIN cargo c ON c.id = i.cargo_id
     ${whereClause}
     ORDER BY i.created_at DESC, i.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    values
  );
  return {
    rows: result.rows.map((row) => ({
      invoice_number: row.public_invoice_number,
      cargo_reference: row.cargo_reference,
      cargo_type: row.cargo_type,
      consignee_name: row.consignee_name,
      owner_information: row.company_name || row.consignee_name,
      status: row.status,
      payment_status: row.payment_status,
      billing_period_start: row.billing_period_start,
      billing_period_end: row.billing_period_end,
      billable_days: row.billable_days,
      currency: row.currency,
      total_amount: amountFromCents(centsFromAmount(row.total_amount)),
      amount_paid: amountFromCents(centsFromAmount(row.amount_paid)),
      outstanding_balance: amountFromCents(centsFromAmount(row.outstanding_balance)),
      issued_at: row.issued_at,
      created_at: row.created_at
    })),
    total: countResult.rows[0]?.total || 0,
    page,
    limit
  };
};

const getInvoiceDetails = async ({ invoiceNumber, executor = db }) => {
  const invoice = await findInvoiceByNumber(executor, invoiceNumber);
  if (!invoice) throw buildError("Invoice not found.", 404);
  return buildInvoicePublicPayload(invoice, executor);
};

const listPayments = async ({ filters = {}, executor = db }) => {
  const values = [];
  const clauses = ["p.status = 'Confirmed'"];
  if (filters.search) {
    values.push(`%${filters.search}%`);
    clauses.push(`(
      p.public_reference ILIKE $${values.length}
      OR p.bank_reference ILIKE $${values.length}
      OR p.bank_name ILIKE $${values.length}
      OR i.public_invoice_number ILIKE $${values.length}
      OR c.cargo_id ILIKE $${values.length}
    )`);
  }
  const result = await executor.query(
    `SELECT
       p.public_reference,
       i.public_invoice_number,
       c.cargo_id AS cargo_reference,
       p.amount,
       p.bank_name,
       p.bank_reference,
       p.payment_date,
       p.notes,
       p.confirmed_at
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     JOIN cargo c ON c.id = i.cargo_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY p.confirmed_at DESC, p.id DESC
     LIMIT 100`,
    values
  );
  return result.rows.map((row) => ({
    payment_reference: row.public_reference,
    invoice_number: row.public_invoice_number,
    cargo_reference: row.cargo_reference,
    amount: amountFromCents(centsFromAmount(row.amount)),
    bank_name: row.bank_name,
    bank_reference: row.bank_reference,
    payment_date: row.payment_date,
    notes: row.notes,
    confirmed_at: row.confirmed_at
  }));
};

module.exports = {
  amountFromCents,
  calculateBillableDays,
  calculateStorageCharge,
  centsFromAmount,
  chargingUnits,
  cleanString,
  createOrRegenerateDraftInvoice,
  createTariffVersion,
  findCargoByPublicReference,
  generatePublicReference,
  getApplicableTariff,
  getCargoFinancialSnapshot,
  getFinanceDashboard,
  getInvoiceDetails,
  getServerNow,
  issueInvoice,
  cancelInvoice,
  listCargoCharges,
  listInvoices,
  listPayments,
  listTariffs,
  recordPayment,
  setTariffVersionActiveState,
  updateCargoFinancialStatus,
  updateTariffVersion
};

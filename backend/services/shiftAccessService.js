const db = require("../config/db");

const OPERATIONAL_TIME_ZONE = "Africa/Dar_es_Salaam";
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SHIFT_ROLES = new Set(["warehouse-staff", "scanner"]);
const denialAuditWindow = new Map();

const minutesFromTime = (value) => {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return (Number(match[1]) * 60) + Number(match[2]);
};

const localOperationalTime = (instant = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: (Number(parts.hour) * 60) + Number(parts.minute)
  };
};

const evaluateShiftAccess = (shift, localTime = localOperationalTime()) => {
  if (!shift) {
    return { allowed: false, code: "OPERATIONAL_SHIFT_REQUIRED", message: "An active operational shift must be assigned before this action can be performed." };
  }
  if (String(shift.status || "").toLowerCase() !== "active") {
    return { allowed: false, code: "OPERATIONAL_SHIFT_INACTIVE", message: "The assigned operational shift is inactive." };
  }
  if (shift.effective_date && String(shift.effective_date).slice(0, 10) > localTime.date) {
    return { allowed: false, code: "OPERATIONAL_SHIFT_NOT_EFFECTIVE", message: "The assigned operational shift is not effective yet." };
  }

  const start = minutesFromTime(shift.start_time);
  const end = minutesFromTime(shift.end_time);
  if (start === null || end === null) {
    return { allowed: false, code: "OPERATIONAL_SHIFT_INVALID", message: "The assigned operational shift has invalid hours. Contact a System Administrator." };
  }

  const grace = Math.max(0, Number(shift.grace_period_minutes) || 0);
  const now = localTime.minutes;
  let allowed;
  if (start === end) {
    allowed = true;
  } else if (start < end) {
    allowed = now >= start && now <= Math.min(1439, end + grace);
  } else {
    const extendedEnd = end + grace;
    allowed = now >= start || now <= Math.min(1439, extendedEnd);
  }

  return allowed
    ? { allowed: true, code: "OPERATIONAL_SHIFT_ACTIVE" }
    : { allowed: false, code: "OPERATIONAL_SHIFT_OUTSIDE_HOURS", message: "This operational action is only available during the assigned shift hours." };
};

const isShiftControlledRequest = (req) => {
  if (!SHIFT_ROLES.has(req.auth?.role) || !WRITE_METHODS.has(req.method)) return false;
  const path = String(req.originalUrl || req.url || req.path || "").replace(/^\/api/, "").split("?")[0];
  if (req.auth.role === "scanner") return /^\/scanner\/sessions\/placement\/?$/.test(path);
  return /^(?:\/cargo(?:\/[^/]+(?:\/documents|\/print-barcode|\/resubmit)?)?|\/placement\/(?:validate|confirm|request-override)|\/dispatch\/request-authorization)\/?$/.test(path);
};

const auditShiftDenial = async (req, decision, shift, executor = db) => {
  const key = `${req.auth?.userId}:${decision.code}:${req.method}:${req.originalUrl}`;
  const now = Date.now();
  if ((denialAuditWindow.get(key) || 0) > now - 300000) return;
  denialAuditWindow.set(key, now);
  await executor.query(
    `INSERT INTO audit_logs
       (user_id, role_id_at_action, warehouse_id_at_action, action, module, description, metadata)
     VALUES ($1,$2,$3,'OPERATIONAL_SHIFT_ACCESS_DENIED','Authentication & Access',$4,$5)`,
    [req.auth?.userId || null, req.auth?.roleId || null, req.auth?.warehouseId || null,
      `${req.method} ${req.originalUrl} was denied by operational shift policy.`,
      JSON.stringify({ code: decision.code, shift_reference: shift?.public_reference || null, time_zone: OPERATIONAL_TIME_ZONE })]
  );
};

const requireOperationalShift = async (req, res, next) => {
  if (!isShiftControlledRequest(req)) return next();
  try {
    const result = req.auth?.shiftId
      ? await db.query(`SELECT public_reference,start_time,end_time,grace_period_minutes,status,effective_date FROM shifts WHERE id=$1 LIMIT 1`, [req.auth.shiftId])
      : { rows: [] };
    const shift = result.rows[0] || null;
    const decision = evaluateShiftAccess(shift);
    if (decision.allowed) return next();
    await auditShiftDenial(req, decision, shift);
    return res.status(403).json({ success: false, code: decision.code, message: decision.message, data: { time_zone: OPERATIONAL_TIME_ZONE } });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  OPERATIONAL_TIME_ZONE,
  evaluateShiftAccess,
  isShiftControlledRequest,
  localOperationalTime,
  requireOperationalShift
};

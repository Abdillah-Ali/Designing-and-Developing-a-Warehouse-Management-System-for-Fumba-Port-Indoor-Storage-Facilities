const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateShiftAccess, isShiftControlledRequest } = require("../services/shiftAccessService");

const active = (overrides = {}) => ({
  status: "active", start_time: "08:00:00", end_time: "16:00:00",
  grace_period_minutes: 0, effective_date: "2026-01-01", ...overrides
});
const at = (minutes, date = "2026-08-20") => ({ minutes, date });

test("allows a user inside an active daytime shift", () => assert.equal(evaluateShiftAccess(active(), at(12 * 60)).allowed, true));
test("denies a user before the assigned shift", () => assert.equal(evaluateShiftAccess(active(), at(7 * 60 + 59)).code, "OPERATIONAL_SHIFT_OUTSIDE_HOURS"));
test("denies a user after the assigned shift", () => assert.equal(evaluateShiftAccess(active(), at(16 * 60 + 1)).code, "OPERATIONAL_SHIFT_OUTSIDE_HOURS"));
test("supports overnight shifts on both sides of midnight", () => {
  const shift = active({ start_time: "22:00", end_time: "06:00" });
  assert.equal(evaluateShiftAccess(shift, at(23 * 60)).allowed, true);
  assert.equal(evaluateShiftAccess(shift, at(5 * 60)).allowed, true);
  assert.equal(evaluateShiftAccess(shift, at(12 * 60)).allowed, false);
});
test("denies missing and inactive shift assignments", () => {
  assert.equal(evaluateShiftAccess(null, at(12 * 60)).code, "OPERATIONAL_SHIFT_REQUIRED");
  assert.equal(evaluateShiftAccess(active({ status: "inactive" }), at(12 * 60)).code, "OPERATIONAL_SHIFT_INACTIVE");
});
test("denies a future-effective shift", () => assert.deepEqual(
  evaluateShiftAccess(active({ effective_date: "2026-08-21" }), at(12 * 60)),
  { allowed: false, code: "OPERATIONAL_SHIFT_NOT_EFFECTIVE", message: "The assigned operational shift is not effective yet." }
));
test("honors the configured end-of-shift grace period", () => assert.equal(evaluateShiftAccess(active({ grace_period_minutes: 15 }), at(16 * 60 + 10)).allowed, true));
test("staff and linked scanner operational writes are controlled", () => {
  assert.equal(isShiftControlledRequest({ method: "POST", originalUrl: "/api/cargo", auth: { role: "warehouse-staff" } }), true);
  assert.equal(isShiftControlledRequest({ method: "POST", originalUrl: "/api/scanner/sessions/placement", auth: { role: "scanner" } }), true);
});
test("read-only, administrative, auditor, and emergency workflows are not shift controlled", () => {
  assert.equal(isShiftControlledRequest({ method: "GET", originalUrl: "/api/cargo", auth: { role: "warehouse-staff" } }), false);
  assert.equal(isShiftControlledRequest({ method: "POST", originalUrl: "/api/gate/emergency-requests", auth: { role: "gate-officer" } }), false);
  assert.equal(isShiftControlledRequest({ method: "POST", originalUrl: "/api/cargo", auth: { role: "system-admin" } }), false);
  assert.equal(isShiftControlledRequest({ method: "GET", originalUrl: "/api/audit-logs", auth: { role: "auditor" } }), false);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PORTAL_ROLES,
  canAccessRoute,
  hasPermission,
  normalizeRole
} = require("../middleware/authMiddleware");
const {
  calculateBillableDays,
  calculateStorageCharge
} = require("../services/financeService");

const cargo = {
  cargo_id: "CARGO-2026-00001",
  cargo_type: "General Goods",
  weight: "250.00",
  volume: "4.50",
  created_at: new Date("2026-07-01T08:00:00Z"),
  charge_start_at: new Date("2026-07-01T08:00:00Z")
};

const tariff = {
  tariff_name: "Standard General Cargo Daily Storage",
  public_reference: "TRV-2026-TEST",
  charging_unit: "per_cargo_per_day",
  daily_rate: "10000.00",
  currency: "TZS",
  minimum_billable_days: 1,
  grace_period_days: 0,
  penalty_type: "none",
  penalty_rate: "0",
  fixed_penalty: "0"
};

test("storage charging uses cargo registration timestamp as the charge start", () => {
  const result = calculateStorageCharge({
    cargo,
    tariff,
    chargeEndAt: new Date("2026-07-03T07:59:00Z")
  });

  assert.equal(result.charge_start_at, cargo.charge_start_at);
  assert.equal(result.billable_days, 2);
  assert.equal(result.base_charge, "20000.00");
  assert.equal(result.total_amount, "20000.00");
});

test("billable day calculation applies ceiling and minimum billable days", () => {
  assert.equal(calculateBillableDays({
    chargeStartAt: "2026-07-01T08:00:00Z",
    chargeEndAt: "2026-07-01T08:00:01Z",
    minimumBillableDays: 3
  }), 3);

  assert.equal(calculateBillableDays({
    chargeStartAt: "2026-07-01T08:00:00Z",
    chargeEndAt: "2026-07-02T08:00:01Z",
    minimumBillableDays: 1
  }), 2);
});

test("currency calculations support quantity-based tariffs without floating point drift", () => {
  const result = calculateStorageCharge({
    cargo,
    tariff: {
      ...tariff,
      charging_unit: "per_kilogram_per_day",
      daily_rate: "12.50"
    },
    chargeEndAt: new Date("2026-07-02T08:00:00Z")
  });

  assert.equal(result.billable_days, 1);
  assert.equal(result.base_charge, "3125.00");
  assert.equal(result.total_amount, "3125.00");
});

test("new portal roles normalize from configured role labels", () => {
  assert.equal(normalizeRole("Finance Officer"), PORTAL_ROLES.FINANCE_OFFICER);
  assert.equal(normalizeRole("Customs Officer"), PORTAL_ROLES.CUSTOMS_OFFICER);
  assert.equal(normalizeRole("Gate Officer"), PORTAL_ROLES.GATE_OFFICER);
});

test("finance, customs, and gate APIs are isolated by route and explicit permissions", () => {
  assert.equal(canAccessRoute(PORTAL_ROLES.FINANCE_OFFICER, "GET", "/finance/dashboard"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.FINANCE_OFFICER, "POST", "/finance/tariffs"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.FINANCE_OFFICER, "GET", "/customs/queue"), false);
  assert.equal(canAccessRoute(PORTAL_ROLES.FINANCE_OFFICER, "POST", "/gate/cargo/CARGO-2026-00001/gate-out"), false);

  assert.equal(canAccessRoute(PORTAL_ROLES.CUSTOMS_OFFICER, "GET", "/customs/queue"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.CUSTOMS_OFFICER, "POST", "/customs/cargo/CARGO-2026-00001/status"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.CUSTOMS_OFFICER, "POST", "/finance/invoices/draft"), false);

  assert.equal(canAccessRoute(PORTAL_ROLES.GATE_OFFICER, "GET", "/gate/release-queue"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.GATE_OFFICER, "POST", "/gate/emergency-requests"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.GATE_OFFICER, "POST", "/gate/emergency-requests/EMR-1/approve"), false);
  assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "POST", "/gate/emergency-requests/EMR-1/approve"), true);

  assert.equal(hasPermission({ role: PORTAL_ROLES.FINANCE_OFFICER }, "finance.tariffs.activate"), true);
  assert.equal(hasPermission({ role: PORTAL_ROLES.CUSTOMS_OFFICER }, "finance.tariffs.activate"), false);
  assert.equal(hasPermission({ role: PORTAL_ROLES.GATE_OFFICER }, "gate.gate_out.confirm"), true);
});

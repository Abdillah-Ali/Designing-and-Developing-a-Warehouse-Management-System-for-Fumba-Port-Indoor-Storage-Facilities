const { buildError } = require("../utils/apiError");

const SCALE = 10000n;
const MONEY_SCALE = 100n;
const DAY_MS = 24 * 60 * 60 * 1000;

const parseScaled = (value, scale = SCALE) => {
  const raw = String(value ?? 0).trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw buildError("Financial value is invalid.", 400);
  const negative = raw.startsWith("-");
  const [whole, fraction = ""] = (negative ? raw.slice(1) : raw).split(".");
  const digits = String(scale).length - 1;
  const result = BigInt(whole) * scale + BigInt(`${fraction}${"0".repeat(digits)}`.slice(0, digits) || 0);
  return negative ? -result : result;
};
const roundedDivide = (numerator, denominator) => (numerator + denominator / 2n) / denominator;
const amountFromCents = (value) => `${BigInt(value) / MONEY_SCALE}.${(BigInt(value) % MONEY_SCALE).toString().padStart(2, "0")}`;

const storageStartedDay = Object.freeze({
  calculator_key: "storage_started_day",
  display_name: "Storage by started 24-hour period",
  parameter_schema: Object.freeze({ charging_unit: "trusted_enum", minimum_billable_days: "positive_integer" }),
  calculate({ cargo, tariff, periodStart, periodEnd }) {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw buildError("A valid billable tariff period is required.", 409);
    }
    const billableDays = Math.max(Number(tariff.minimum_billable_days) || 1, Math.ceil((end - start) / DAY_MS));
    let units = "1";
    let unitLabel = "cargo";
    if (tariff.charging_unit === "per_kilogram_per_day") { units = String(cargo.weight); unitLabel = "kg"; }
    if (tariff.charging_unit === "per_tonne_per_day") { units = String(Number(cargo.weight) / 1000); unitLabel = "tonne"; }
    if (tariff.charging_unit === "per_cubic_metre_per_day") { units = String(cargo.volume); unitLabel = "m3"; }
    if (["per_kilogram_per_day", "per_tonne_per_day"].includes(tariff.charging_unit) && cargo.weight == null) throw buildError("Cargo weight is required for the selected tariff.", 409);
    if (tariff.charging_unit === "per_cubic_metre_per_day" && cargo.volume == null) throw buildError("Cargo volume is required for the selected tariff.", 409);
    const cents = roundedDivide(parseScaled(tariff.daily_rate) * parseScaled(units) * BigInt(billableDays) * MONEY_SCALE, SCALE * SCALE);
    return { billable_days: billableDays, quantity_used: units, quantity_unit_label: unitLabel, base_charge_cents: cents, base_charge: amountFromCents(cents) };
  }
});

const registry = new Map([[storageStartedDay.calculator_key, storageStartedDay]]);
const getFinanceCalculator = (key) => {
  const calculator = registry.get(String(key || ""));
  if (!calculator) throw buildError(`Unsupported trusted finance calculator: ${key || "missing"}.`, 409);
  return calculator;
};
const listFinanceCalculators = () => [...registry.values()].map(({ calculate, ...metadata }) => metadata);

module.exports = { getFinanceCalculator, listFinanceCalculators };

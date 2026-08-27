const test = require("node:test");
const assert = require("node:assert/strict");
const { parseFilters } = require("../services/reportService");
const { canAccessRoute } = require("../middleware/authMiddleware");

test("report filters validate date order and page sizes", () => {
  assert.throws(() => parseFilters({ dateFrom: "2026-08-27", dateTo: "2026-08-26" }), /must not be after/);
  assert.throws(() => parseFilters({ pageSize: "500" }), /10, 20, 50, or 100/);
  assert.deepEqual(parseFilters({ page: "2", pageSize: "50" }).page, 2);
});

test("report sorting is allow-listed and search input is bounded", () => {
  assert.throws(() => parseFilters({ sortBy: "created_at; DROP TABLE cargo" }), /Invalid report sorting/);
  assert.equal(parseFilters({ search: "x".repeat(300) }).search.length, 120);
});

test("Management exports are authorized only for report-capable roles", () => {
  assert.equal(canAccessRoute("management", "GET", "/management/reports/export/pdf"), true);
  assert.equal(canAccessRoute("auditor", "GET", "/management/reports/export/excel"), true);
  assert.equal(canAccessRoute("scanner", "GET", "/management/reports"), false);
  assert.equal(canAccessRoute("finance-officer", "GET", "/management/reports"), false);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("tariff decision status parameter has an explicit PostgreSQL text type", () => {
  const source = fs.readFileSync(path.join(__dirname, "../services/tariffApprovalService.js"), "utf8");
  assert.match(source, /approval_status=\$1::text/);
  assert.match(source, /CASE WHEN \$1::text='APPROVED'/);
  assert.match(source, /CASE WHEN \$1::text='REJECTED'/);
  assert.match(source, /THEN \$2::integer/);
  assert.match(source, /THEN \$3::text/);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("migration 037 aligns new cargo with the authoritative pending Customs state", () => {
  const migration = fs.readFileSync(path.join(__dirname, "../database/migrations/20260821_align_cargo_customs_defaults.sql"), "utf8");
  const init = fs.readFileSync(path.join(__dirname, "../database/initDb.js"), "utf8");
  const update = fs.readFileSync(path.join(__dirname, "../database/updateSchema.js"), "utf8");
  assert.match(migration, /customs_status\s*=\s*'Pending Inspection'/);
  assert.match(migration, /customs_status_key\s*=\s*COALESCE\(customs_status_key,\s*'pending_inspection'\)/);
  assert.match(migration, /ALTER COLUMN customs_status SET DEFAULT 'Pending Inspection'/);
  assert.match(init, /037_align_cargo_customs_defaults\.sql/);
  assert.match(update, /037_align_cargo_customs_defaults\.sql/);
});

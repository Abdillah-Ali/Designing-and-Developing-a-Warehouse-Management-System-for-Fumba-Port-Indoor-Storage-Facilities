const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { STATUS_ACTIONS } = require("../services/customsWorkflowService");

test("Customs hold release is an audited, reason-required return to inspection", () => {
  const migration = fs.readFileSync(path.join(__dirname, "..", "database", "migrations", "20260907_customs_hold_release.sql"), "utf8");
  assert.match(migration, /'release_hold'/);
  assert.match(migration, /'on_hold'/);
  assert.match(migration, /'inspection_in_progress'/);
  assert.match(migration, /'required'/);
  assert.equal(STATUS_ACTIONS["Release Hold"], "release_hold");
});

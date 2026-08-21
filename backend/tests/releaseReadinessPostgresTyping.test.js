const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("release-readiness update uses explicit PostgreSQL parameter types", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "services", "releaseReadinessService.js"),
    "utf8"
  );

  assert.match(source, /release_readiness_status=\$1::varchar/);
  assert.match(source, /CASE WHEN \$1::varchar='READY_FOR_RELEASE'::varchar/);
  assert.match(source, /WHERE id=\$3::integer/);
});

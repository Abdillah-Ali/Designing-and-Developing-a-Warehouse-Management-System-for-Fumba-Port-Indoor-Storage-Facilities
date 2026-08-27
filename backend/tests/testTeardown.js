const test = require("node:test");
const db = require("../config/db");

// Each Node test worker owns its module cache and therefore its own pg pool.
// Close that worker's pool once its tests finish so integration helpers that
// import services indirectly do not keep the runner alive.
test.after(async () => {
  await db.pool.end().catch(() => {});
});

const test = require("node:test");
const assert = require("node:assert/strict");
const router = require("../routes/financeRoutes");

const routeMethods = new Map(
  router.stack
    .filter((layer) => layer.route)
    .map((layer) => [layer.route.path, Object.keys(layer.route.methods).filter((method) => layer.route.methods[method]).sort()])
);

test("Finance invoice lifecycle routes match the frontend and authorization contract", () => {
  assert.deepEqual(routeMethods.get("/invoices/draft"), ["post"]);
  assert.deepEqual(routeMethods.get("/invoices/:invoiceNumber/issue"), ["post"]);
  assert.deepEqual(routeMethods.get("/invoices/:invoiceNumber/cancel"), ["post"]);
});

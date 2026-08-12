const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ensureCapacityFitsParent,
  readConfigurationStatus,
  readIdentifier,
  readLetter,
  readPositiveNumber,
  MAX_CAPACITY,
  readThresholds,
  resolveLifecycleState,
  resolveBinLifecycleState
} = require("../services/warehouseConfigurationService");
const { PORTAL_ROLES, canAccessRoute } = require("../middleware/authMiddleware");

test("warehouse hierarchy input is normalized to uppercase generated identifiers", () => {
  assert.equal(readLetter("a", "Warehouse letter"), "A");
  assert.equal(readLetter(" z ", "Zone letter"), "Z");
  assert.equal(readIdentifier("a12"), "A12");
  assert.equal(readConfigurationStatus("inactive"), "Inactive");
});

test("warehouse hierarchy rejects invalid letters and non-positive capacity", () => {
  assert.throws(() => readLetter("AA", "Rack letter"), /one alphabet letter/i);
  assert.throws(() => readIdentifier("A-1"), /letters or numbers/i);
  assert.throws(() => readPositiveNumber(0, "Capacity"), /greater than zero/i);
  assert.equal(readPositiveNumber(1000000000000, "Capacity"), 1000000000000);
  assert.throws(() => readPositiveNumber(MAX_CAPACITY + 1, "Capacity"), /cannot exceed/i);
});

test("capacity thresholds and parent limits are backend-enforced", () => {
  assert.deepEqual(readThresholds({ occupancy_warning_threshold: 75, full_threshold: 95 }), {
    warning: 75,
    full: 95
  });
  assert.throws(
    () => ensureCapacityFitsParent({
      childWeight: 101,
      childVolume: 5,
      parentWeight: 100,
      parentVolume: 10,
      childLabel: "Level"
    }),
    /cannot exceed its parent/i
  );
});

test("only administrators can mutate warehouse configuration routes", () => {
  assert.equal(canAccessRoute(PORTAL_ROLES.SYSTEM_ADMIN, "POST", "/warehouses"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.SYSTEM_ADMIN, "PUT", "/capacity-configurations/Bin/1"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "POST", "/warehouses"), false);
  assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "PUT", "/bin-rules/1"), false);
});

test("lifecycle updates preserve the intended active state for hierarchy edits", () => {
  assert.deepEqual(resolveLifecycleState({ status: "Inactive", existingStatus: "Active" }), {
    status: "Inactive",
    active: false
  });
  assert.deepEqual(resolveLifecycleState({ status: "Active", existingStatus: "Inactive" }), {
    status: "Active",
    active: true
  });
});

test("bin edits keep an operational status when reactivating and clear it when deactivating", () => {
  assert.deepEqual(resolveBinLifecycleState({ creationStatus: "Active", existingStatus: "Blocked" }), {
    creationStatus: "Active",
    status: "Blocked",
    active: true
  });
  assert.deepEqual(resolveBinLifecycleState({ creationStatus: "Inactive", existingStatus: "Reserved" }), {
    creationStatus: "Inactive",
    status: "Inactive",
    active: false
  });
});

test("staff and administrators can request automatic bin recommendations", () => {
  assert.equal(canAccessRoute(PORTAL_ROLES.SYSTEM_ADMIN, "GET", "/bins/recommend/CARGO-1"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "GET", "/bins/recommend/CARGO-1"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "GET", "/bins/recommend/CARGO-1"), true);
});

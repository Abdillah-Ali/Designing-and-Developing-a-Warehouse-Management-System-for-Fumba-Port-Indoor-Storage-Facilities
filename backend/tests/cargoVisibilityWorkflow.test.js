const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CARGO_NOT_OPERATIONAL_MESSAGE,
  PLACEMENT_STATUS,
  REGISTRATION_STATUS,
  buildCorrectionChanges,
  canCargoBePlaced,
  canStaffEditCargo,
  canStaffViewSubmission,
  captureCorrectionValues,
  completeCargoResubmission,
  ensurePendingRegistrationApprovals,
  getRejectionReason,
  isOperationallyVisibleToStaff,
  needsStorageRevalidation,
  normalizeCorrectionFields,
  updateCargoRegistrationStatus
} = require("../services/cargoWorkflowService");
const {
  PORTAL_ROLES,
  canAccessRoute
} = require("../middleware/authMiddleware");

test("staff visibility and placement do not wait for supervisor approval", () => {
  assert.equal(isOperationallyVisibleToStaff(REGISTRATION_STATUS.PENDING_REVIEW), true);
  assert.equal(isOperationallyVisibleToStaff(REGISTRATION_STATUS.CORRECTION_REQUIRED), true);
  assert.equal(canCargoBePlaced({
    registration_status: REGISTRATION_STATUS.PENDING_REVIEW,
    placement_status: PLACEMENT_STATUS.UNPLACED
  }), true);
  assert.equal(canCargoBePlaced({
    registration_status: REGISTRATION_STATUS.CORRECTION_REQUIRED,
    placement_status: PLACEMENT_STATUS.UNPLACED
  }), true);
  assert.equal(canCargoBePlaced({
    registration_status: REGISTRATION_STATUS.REJECTED,
    placement_status: PLACEMENT_STATUS.UNPLACED
  }), false);
  assert.equal(canCargoBePlaced({
    registration_status: REGISTRATION_STATUS.APPROVED,
    placement_status: PLACEMENT_STATUS.UNPLACED,
    is_deleted: true
  }), false);
});

test("only the registering staff user can view and edit correction submissions", () => {
  const cargo = {
    received_by_user_id: 42,
    registration_status: REGISTRATION_STATUS.CORRECTION_REQUIRED
  };

  assert.equal(canStaffViewSubmission(cargo, 42), true);
  assert.equal(canStaffViewSubmission(cargo, 7), false);
  assert.equal(canStaffEditCargo(cargo, 42), true);
  assert.equal(canStaffEditCargo(cargo, 7), false);
  assert.equal(canStaffEditCargo({
    received_by_user_id: 42,
    registration_status: REGISTRATION_STATUS.REJECTED
  }, 42), true);
  assert.equal(CARGO_NOT_OPERATIONAL_MESSAGE, "This cargo is unavailable for warehouse placement.");
});

test("storage revalidation is limited to placement-sensitive corrections", () => {
  assert.equal(needsStorageRevalidation(["consignee_name", "phone_number"]), false);
  assert.equal(needsStorageRevalidation(["cargo_type"]), true);
  assert.equal(needsStorageRevalidation(["weight", "inspection_notes"]), true);
});

test("correction fields are validated and de-duplicated", () => {
  assert.deepEqual(
    normalizeCorrectionFields(["weight", "invalid", "weight", "inspection_notes"]),
    ["weight", "inspection_notes"]
  );
});

test("correction snapshots and changes normalize numeric values", () => {
  const original = captureCorrectionValues(
    { weight: "500.00", inspection_notes: "Dry cargo" },
    ["weight", "inspection_notes"]
  );
  assert.deepEqual(original, { weight: 500, inspection_notes: "Dry cargo" });

  const changes = buildCorrectionChanges(
    { weight: 500, inspection_notes: "Packaging replaced" },
    original,
    ["weight", "inspection_notes"]
  );
  assert.equal(changes.weight.changed, false);
  assert.equal(changes.inspection_notes.changed, true);
});

test("registration rejection requires an allowed operational condition", () => {
  assert.equal(
    getRejectionReason("DUPLICATE_REGISTRATION"),
    "Duplicate cargo registration exists."
  );
  assert.equal(getRejectionReason("ARBITRARY_REASON"), null);
});

test("registration status updates use the authoritative field only", async () => {
  const calls = [];
  const executor = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ id: 8, registration_status: values[0] }] };
    }
  };

  await updateCargoRegistrationStatus(
    executor,
    8,
    REGISTRATION_STATUS.APPROVED,
    { approved_by: 3 }
  );

  assert.match(calls[0].sql, /registration_status = \$1/);
  assert.doesNotMatch(calls[0].sql, /workflow_status/);
  assert.doesNotMatch(calls[0].sql, /\bstatus = \$1/);
});

test("pending registrations can be reconciled into the supervisor approval queue", async () => {
  const calls = [];
  const executor = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ id: 4, cargo_id: 12 }] };
    }
  };

  await ensurePendingRegistrationApprovals(executor, 3);

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO approval_requests/);
  assert.match(calls[0].sql, /c\.registration_status = \$1/);
  assert.match(calls[0].sql, /c\.warehouse_id = \$2/);
  assert.match(calls[0].sql, /NOT EXISTS/);
  assert.deepEqual(calls[0].values, [REGISTRATION_STATUS.PENDING_REVIEW, 3]);
});

test("resubmission clears active correction markers and records submitted changes", async () => {
  const calls = [];
  const executor = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes("UPDATE cargo")) {
        return {
          rows: [{
            id: 12,
            registration_status: REGISTRATION_STATUS.PENDING_REVIEW,
            correction_fields: [],
            correction_notes: null
          }]
        };
      }
      return { rows: [] };
    }
  };

  const result = await completeCargoResubmission(executor, {
    cargo: {
      id: 12,
      cargo_id: "CG-12",
      registration_status: REGISTRATION_STATUS.CORRECTION_REQUIRED,
      correction_fields: ["weight", "inspection_notes"],
      correction_original_values: {
        weight: 500,
        inspection_notes: "Original"
      },
      weight: 525,
      inspection_notes: "Updated"
    },
    userId: 7,
    remarks: "Corrected",
    buildError: (message, statusCode, errors) => Object.assign(
      new Error(message),
      { statusCode, errors }
    )
  });

  assert.equal(result.changes.weight.changed, true);
  assert.equal(result.changes.inspection_notes.changed, true);
  assert.equal(result.cargo.registration_status, REGISTRATION_STATUS.PENDING_REVIEW);
  assert.ok(calls.some((call) => (
    call.sql.includes("UPDATE cargo")
    && call.values.includes("[]")
    && call.values.includes(null)
  )));
});

test("staff can access only their review inbox and resubmission endpoint", () => {
  assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "GET", "/cargo/my/submissions"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "POST", "/cargo/123/resubmit"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "GET", "/cargo/123/documents/7/content"), true);
  assert.equal(
    canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "POST", "/supervisor/approvals/1/approve"),
    false
  );
});

test("supervisors and administrators can decide registration approvals", () => {
  for (const role of [PORTAL_ROLES.WAREHOUSE_SUPERVISOR, PORTAL_ROLES.SYSTEM_ADMIN]) {
    assert.equal(canAccessRoute(role, "POST", "/supervisor/approvals/1/approve"), true);
    assert.equal(canAccessRoute(role, "POST", "/supervisor/approvals/1/reject"), true);
  }

  assert.equal(
    canAccessRoute(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "POST", "/supervisor/approvals/1/request-correction"),
    true
  );
  assert.equal(
    canAccessRoute(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "GET", "/cargo/123/documents/7/content"),
    true
  );
  assert.equal(
    canAccessRoute(PORTAL_ROLES.WAREHOUSE_SUPERVISOR, "GET", "/supervisor/review-configuration"),
    true
  );
  assert.equal(canAccessRoute(PORTAL_ROLES.SYSTEM_ADMIN, "DELETE", "/cargo/123"), true);
  assert.equal(canAccessRoute(PORTAL_ROLES.WAREHOUSE_STAFF, "DELETE", "/cargo/123"), false);
});

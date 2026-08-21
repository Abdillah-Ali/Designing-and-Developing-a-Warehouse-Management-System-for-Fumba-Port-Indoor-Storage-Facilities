const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

test("placement override submission persists, audits, then uses the shared notification policy", () => {
  const source = read("controllers/placementController.js");
  assert.match(source, /INSERT INTO approval_requests[\s\S]*REQUEST_PLACEMENT_OVERRIDE[\s\S]*notifyPlacementOverridePending/);
  assert.match(source, /request_type = 'PLACEMENT_OVERRIDE'[\s\S]*status = 'Pending'[\s\S]*request_data->>'bin_id'/);
});

test("placement override decisions notify the requesting staff user and resolve supervisor action", () => {
  const controller = read("controllers/supervisorController.js");
  const notifications = read("services/notificationService.js");
  assert.match(controller, /PLACEMENT_OVERRIDE[\s\S]*notifyPlacementOverrideDecision/);
  assert.match(controller, /placement_override_decided/);
  assert.match(notifications, /placement\.override_approved[\s\S]*placement\.override_rejected/);
  assert.match(notifications, /recipient_user_id:requesterId/);
});

test("placement override notification policy is persistent, warehouse scoped, and real-time enabled", () => {
  const registry = read("services/notificationEventRegistry.js");
  const authority = read("services/notificationAuthorityService.js");
  const notifications = read("services/notificationService.js");
  assert.match(registry, /"placement\.override_requested"[\s\S]*users_with_permission[\s\S]*cargo\.approve[\s\S]*true/);
  assert.match(authority, /createNotification[\s\S]*deduplicate:policy\.actionable/);
  assert.match(notifications, /INSERT INTO notifications/);
});

test("registration_status is the documented and database-enforced registration authority", () => {
  const schema = read("database/schema.sql");
  const readme = fs.readFileSync(path.join(__dirname, "..", "..", "README.md"), "utf8");
  assert.match(schema, /registration_status is authoritative/);
  assert.match(schema, /NEW\.status := NEW\.registration_status;[\s\S]*NEW\.workflow_status := NEW\.registration_status/);
  assert.match(readme, /older `status` and `workflow_status` columns remain synchronized database aliases/);
});

test("workflow business logic writes registration_status rather than legacy aliases", () => {
  const workflow = read("services/cargoWorkflowService.js");
  const effect = read("services/workflowEffectRegistry.js");
  assert.match(workflow, /registration_status = \$1/);
  assert.match(effect, /UPDATE cargo SET registration_status=\$1/);
  assert.doesNotMatch(workflow, /UPDATE\s+cargo[\s\S]{0,120}SET\s+(?:c\.)?(?:status|workflow_status)\s*=/i);
  assert.doesNotMatch(effect, /UPDATE\s+cargo[\s\S]{0,120}SET\s+(?:c\.)?(?:status|workflow_status)\s*=/i);
});

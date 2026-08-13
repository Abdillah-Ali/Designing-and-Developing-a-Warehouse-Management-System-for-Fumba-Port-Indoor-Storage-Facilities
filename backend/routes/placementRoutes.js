const express = require("express");
const {
  confirmPlacement,
  getPlacementActivitySummary,
  getPlacementActivityTimeline,
  getPlacementSettings,
  getPlacementFailures,
  getPlacementLogs,
  requestPlacementOverride,
  updatePlacementSettings,
  validatePlacement
} = require("../controllers/placementController");
const { requirePermission } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/logs", requirePermission("placement.logs.view"), getPlacementLogs);
router.get("/failures", requirePermission("placement.failures.view"), getPlacementFailures);
router.get("/activity", getPlacementActivityTimeline);
router.get("/activity/summary", getPlacementActivitySummary);
router.get("/settings", getPlacementSettings);
router.put(
  "/settings",
  requirePermission("placement.settings.manage"),
  updatePlacementSettings
);
router.post("/confirm", confirmPlacement);
router.post("/validate", validatePlacement);
router.post("/request-override", requestPlacementOverride);

module.exports = router;

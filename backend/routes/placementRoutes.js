const express = require("express");
const {
  confirmPlacement,
  getPlacementSettings,
  getPlacementFailures,
  getPlacementLogs,
  requestPlacementOverride,
  updatePlacementSettings,
  validatePlacement
} = require("../controllers/placementController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/logs", requireRole("System Admin"), getPlacementLogs);
router.get("/failures", requireRole("System Admin"), getPlacementFailures);
router.get("/settings", getPlacementSettings);
router.put(
  "/settings",
  requireRole("System Admin", "Supervisor"),
  updatePlacementSettings
);
router.post("/confirm", confirmPlacement);
router.post("/validate", validatePlacement);
router.post("/request-override", requestPlacementOverride);

module.exports = router;

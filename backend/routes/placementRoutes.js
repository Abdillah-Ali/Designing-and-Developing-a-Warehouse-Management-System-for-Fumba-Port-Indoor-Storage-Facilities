const express = require("express");
const {
  confirmPlacement,
  getPlacementFailures,
  getPlacementLogs,
  requestPlacementOverride,
  validatePlacement
} = require("../controllers/placementController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/logs", requireRole("System Admin"), getPlacementLogs);
router.get("/failures", requireRole("System Admin"), getPlacementFailures);
router.post("/confirm", confirmPlacement);
router.post("/validate", validatePlacement);
router.post("/request-override", requestPlacementOverride);

module.exports = router;

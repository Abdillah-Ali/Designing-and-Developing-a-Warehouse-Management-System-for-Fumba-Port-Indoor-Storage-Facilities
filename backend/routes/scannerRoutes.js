const express = require("express");
const {
  cancelScanSession,
  getActiveScanSession,
  refreshScanSession,
  startPlacementScanSession
} = require("../controllers/scannerController");
const { requireAuthenticated, requirePermission } = require("../middleware/authMiddleware");
const { requireOperationalShift } = require("../services/shiftAccessService");

const router = express.Router();

router.use(requireAuthenticated);

router.get("/sessions/active", getActiveScanSession);
router.post("/sessions/refresh", refreshScanSession);
router.post(
  "/sessions/placement",
  requirePermission("placement.validate"),
  requireOperationalShift,
  startPlacementScanSession
);
router.post(
  "/sessions/:id/cancel",
  requirePermission("placement.validate"),
  cancelScanSession
);

module.exports = router;

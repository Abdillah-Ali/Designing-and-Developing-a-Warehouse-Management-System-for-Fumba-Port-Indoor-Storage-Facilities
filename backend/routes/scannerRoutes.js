const express = require("express");
const {
  cancelScanSession,
  getActiveScanSession,
  refreshScanSession,
  startPlacementScanSession
} = require("../controllers/scannerController");
const { requireAuthenticated, requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(requireAuthenticated);

router.get("/sessions/active", getActiveScanSession);
router.post("/sessions/refresh", refreshScanSession);
router.post(
  "/sessions/placement",
  requireRole("Warehouse Staff"),
  startPlacementScanSession
);
router.post(
  "/sessions/:id/cancel",
  requireRole("Warehouse Staff"),
  cancelScanSession
);

module.exports = router;

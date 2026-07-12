const express = require("express");
const {
  approveEmergencyRequest,
  confirmGateOut,
  getDashboard,
  getEligibility,
  getRecords,
  getReleaseQueue,
  listEmergencyRequests,
  rejectEmergencyRequest,
  requestEmergencyRelease
} = require("../controllers/gateController");
const { requirePermission } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/dashboard", requirePermission("gate.dashboard.view"), getDashboard);
router.get("/release-queue", requirePermission("gate.release_queue.view"), getReleaseQueue);
router.get("/records", requirePermission("gate.history.view"), getRecords);
router.get("/cargo/:cargoReference/eligibility", requirePermission("gate.release.validate"), getEligibility);
router.post("/cargo/:cargoReference/gate-out", requirePermission("gate.gate_out.confirm"), confirmGateOut);
router.get("/emergency-requests", requirePermission("gate.history.view"), listEmergencyRequests);
router.post("/emergency-requests", requirePermission("gate.emergency_release.request"), requestEmergencyRelease);
router.post("/emergency-requests/:reference/approve", requirePermission("gate.emergency_release.approve"), approveEmergencyRequest);
router.post("/emergency-requests/:reference/reject", requirePermission("gate.emergency_release.approve"), rejectEmergencyRequest);

module.exports = router;

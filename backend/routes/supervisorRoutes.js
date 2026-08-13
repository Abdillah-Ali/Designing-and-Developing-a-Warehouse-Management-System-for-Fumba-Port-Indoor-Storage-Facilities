const express = require("express");
const {
  approveApproval,
  emergencyApproveApproval,
  getApproval,
  getApprovals,
  getMyReviewHistory,
  getPlacementMonitoring,
  getPlacementSummary,
  getReviewConfiguration,
  getStaffActivity,
  getSupervisorDashboard,
  requestCorrection,
  rejectApproval
} = require("../controllers/supervisorController");
const { requirePermission } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/dashboard", getSupervisorDashboard);
router.get("/my/review-history", getMyReviewHistory);
router.get("/review-configuration", getReviewConfiguration);
router.get("/approvals", getApprovals);
router.get("/approvals/:id", getApproval);
router.post("/approvals/:id/approve", approveApproval);
router.post("/approvals/:id/emergency-approve", emergencyApproveApproval);
router.post("/approvals/:id/reject", rejectApproval);
router.post("/approvals/:id/request-correction", requestCorrection);
router.get("/staff-activity", requirePermission("supervisor.monitoring.view"), getStaffActivity);
router.get("/placement-monitoring", requirePermission("supervisor.monitoring.view"), getPlacementMonitoring);
router.get("/placement-summary", getPlacementSummary);

module.exports = router;

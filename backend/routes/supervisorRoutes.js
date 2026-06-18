const express = require("express");
const {
  approveApproval,
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
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/dashboard", getSupervisorDashboard);
router.get("/my/review-history", getMyReviewHistory);
router.get("/review-configuration", getReviewConfiguration);
router.get("/approvals", getApprovals);
router.get("/approvals/:id", getApproval);
router.post("/approvals/:id/approve", approveApproval);
router.post("/approvals/:id/reject", rejectApproval);
router.post("/approvals/:id/request-correction", requestCorrection);
router.get("/staff-activity", requireRole("System Admin"), getStaffActivity);
router.get("/placement-monitoring", requireRole("System Admin"), getPlacementMonitoring);
router.get("/placement-summary", getPlacementSummary);

module.exports = router;

const express = require("express");
const { getDashboard, getReports, listReleaseRequests, getReleaseRequest, approveReleaseRequest, rejectReleaseRequest } = require("../controllers/managementController");
const { requirePermission } = require("../middleware/authMiddleware");

const router = express.Router();
router.get("/dashboard", requirePermission("management.dashboard.view"), getDashboard);
router.get("/reports", requirePermission("management.reports.view"), getReports);
router.get("/release-requests", requirePermission("management_release.view"), listReleaseRequests);
router.get("/release-requests/:reference", requirePermission("management_release.view"), getReleaseRequest);
router.post("/release-requests/:reference/approve", requirePermission("management_release.decide"), approveReleaseRequest);
router.post("/release-requests/:reference/reject", requirePermission("management_release.decide"), rejectReleaseRequest);
module.exports = router;

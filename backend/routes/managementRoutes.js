const express = require("express");
const { getDashboard, getReports } = require("../controllers/managementController");
const { requirePermission } = require("../middleware/authMiddleware");

const router = express.Router();
router.get("/dashboard", requirePermission("management.dashboard.view"), getDashboard);
router.get("/reports", requirePermission("management.reports.view"), getReports);
module.exports = router;

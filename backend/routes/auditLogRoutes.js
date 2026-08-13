const express = require("express");
const { getAuditLogs } = require("../controllers/adminController");
const { requirePermission } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requirePermission("system.audit.view"), getAuditLogs);

module.exports = router;

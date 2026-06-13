const express = require("express");
const { getAuditLogs } = require("../controllers/adminController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole("System Admin"), getAuditLogs);

module.exports = router;

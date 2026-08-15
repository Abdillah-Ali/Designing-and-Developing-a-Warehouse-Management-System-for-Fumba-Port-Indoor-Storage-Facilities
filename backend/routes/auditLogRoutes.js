const express = require("express");
const { exportAuditLogs, getAuditLogs } = require("../controllers/adminController");
const { requirePermission } = require("../middleware/authMiddleware");
const { archiveEligibleAuditLogs } = require("../services/auditArchiveService");

const router = express.Router();

router.get("/", requirePermission("system.audit.view"), getAuditLogs);
router.get("/export", requirePermission("system.audit.view"), exportAuditLogs);
router.post("/archive", requirePermission("system.configuration.manage"), async (req, res, next) => {
  try { res.json({ success: true, data: await archiveEligibleAuditLogs({ actorId: req.auth?.userId }) }); } catch (error) { next(error); }
});

module.exports = router;

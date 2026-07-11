const express = require("express");
const { getRules, updateRule } = require("../controllers/binRuleController");
const { requireRole } = require("../middleware/authMiddleware");
const { auditConfigurationAttempt } = require("../services/warehouseConfigurationService");

const router = express.Router();

router.get("/", getRules);
router.put("/:id", requireRole("System Admin"), auditConfigurationAttempt, updateRule);

module.exports = router;

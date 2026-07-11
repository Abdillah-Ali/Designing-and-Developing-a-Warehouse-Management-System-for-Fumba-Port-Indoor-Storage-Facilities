const express = require("express");
const {
  getLevels,
  getLevelById,
  getLevelsByRack,
  createLevel,
  updateLevel,
  updateLevelStatus,
  deleteLevel
} = require("../controllers/levelController");
const { requireRole } = require("../middleware/authMiddleware");
const { auditConfigurationAttempt } = require("../services/warehouseConfigurationService");

const router = express.Router();

router.get("/", getLevels);
router.post("/", requireRole("System Admin"), auditConfigurationAttempt, createLevel);
router.get("/by-rack/:rackId", getLevelsByRack);
router.patch("/:id/status", requireRole("System Admin"), auditConfigurationAttempt, updateLevelStatus);
router.get("/:id", getLevelById);
router.put("/:id", requireRole("System Admin"), auditConfigurationAttempt, updateLevel);
router.delete("/:id", requireRole("System Admin"), auditConfigurationAttempt, deleteLevel);

module.exports = router;

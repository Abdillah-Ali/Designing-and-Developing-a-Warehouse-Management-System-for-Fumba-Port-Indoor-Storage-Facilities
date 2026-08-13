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
const { requirePermission } = require("../middleware/authMiddleware");
const { auditConfigurationAttempt } = require("../services/warehouseConfigurationService");

const router = express.Router();

router.get("/", getLevels);
router.post("/", requirePermission("warehouse.hierarchy.manage"), auditConfigurationAttempt, createLevel);
router.get("/by-rack/:rackId", getLevelsByRack);
router.patch("/:id/status", requirePermission("warehouse.hierarchy.manage"), auditConfigurationAttempt, updateLevelStatus);
router.get("/:id", getLevelById);
router.put("/:id", requirePermission("warehouse.hierarchy.manage"), auditConfigurationAttempt, updateLevel);
router.delete("/:id", requirePermission("warehouse.hierarchy.manage"), auditConfigurationAttempt, deleteLevel);

module.exports = router;

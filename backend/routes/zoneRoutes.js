const express = require("express");
const {
  getZones,
  getZoneById,
  createZone,
  updateZone,
  updateZoneStatus,
  deleteZone
} = require("../controllers/zoneController");
const { requirePermission } = require("../middleware/authMiddleware");
const { auditConfigurationAttempt } = require("../services/warehouseConfigurationService");

const router = express.Router();

router.get("/", getZones);
router.post("/", requirePermission("warehouse.hierarchy.manage"), auditConfigurationAttempt, createZone);
router.patch("/:id/status", requirePermission("warehouse.hierarchy.manage"), auditConfigurationAttempt, updateZoneStatus);
router.get("/:id", getZoneById);
router.put("/:id", requirePermission("warehouse.hierarchy.manage"), auditConfigurationAttempt, updateZone);
router.delete("/:id", requirePermission("warehouse.hierarchy.manage"), auditConfigurationAttempt, deleteZone);

module.exports = router;

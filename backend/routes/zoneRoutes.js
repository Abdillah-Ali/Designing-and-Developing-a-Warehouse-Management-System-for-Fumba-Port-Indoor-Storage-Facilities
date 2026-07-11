const express = require("express");
const {
  getZones,
  getZoneById,
  createZone,
  updateZone,
  updateZoneStatus,
  deleteZone
} = require("../controllers/zoneController");
const { requireRole } = require("../middleware/authMiddleware");
const { auditConfigurationAttempt } = require("../services/warehouseConfigurationService");

const router = express.Router();

router.get("/", getZones);
router.post("/", requireRole("System Admin"), auditConfigurationAttempt, createZone);
router.patch("/:id/status", requireRole("System Admin"), auditConfigurationAttempt, updateZoneStatus);
router.get("/:id", getZoneById);
router.put("/:id", requireRole("System Admin"), auditConfigurationAttempt, updateZone);
router.delete("/:id", requireRole("System Admin"), auditConfigurationAttempt, deleteZone);

module.exports = router;

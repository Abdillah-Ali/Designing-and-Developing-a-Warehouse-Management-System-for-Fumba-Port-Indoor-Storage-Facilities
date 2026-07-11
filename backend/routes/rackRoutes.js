const express = require("express");
const {
  getRacks,
  getRackById,
  getRacksByZone,
  createRack,
  updateRack,
  updateRackStatus,
  deleteRack
} = require("../controllers/rackController");
const { requireRole } = require("../middleware/authMiddleware");
const { auditConfigurationAttempt } = require("../services/warehouseConfigurationService");

const router = express.Router();

router.get("/", getRacks);
router.post("/", requireRole("System Admin"), auditConfigurationAttempt, createRack);
router.get("/by-zone/:zoneId", getRacksByZone);
router.patch("/:id/status", requireRole("System Admin"), auditConfigurationAttempt, updateRackStatus);
router.get("/:id", getRackById);
router.put("/:id", requireRole("System Admin"), auditConfigurationAttempt, updateRack);
router.delete("/:id", requireRole("System Admin"), auditConfigurationAttempt, deleteRack);

module.exports = router;

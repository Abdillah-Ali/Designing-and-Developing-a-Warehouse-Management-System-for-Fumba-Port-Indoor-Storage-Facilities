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
const { requirePermission } = require("../middleware/authMiddleware");
const { auditConfigurationAttempt } = require("../services/warehouseConfigurationService");

const router = express.Router();

router.get("/", getRacks);
router.post("/", requirePermission("warehouse.hierarchy.manage"), auditConfigurationAttempt, createRack);
router.get("/by-zone/:zoneId", getRacksByZone);
router.patch("/:id/status", requirePermission("warehouse.hierarchy.manage"), auditConfigurationAttempt, updateRackStatus);
router.get("/:id", getRackById);
router.put("/:id", requirePermission("warehouse.hierarchy.manage"), auditConfigurationAttempt, updateRack);
router.delete("/:id", requirePermission("warehouse.hierarchy.manage"), auditConfigurationAttempt, deleteRack);

module.exports = router;

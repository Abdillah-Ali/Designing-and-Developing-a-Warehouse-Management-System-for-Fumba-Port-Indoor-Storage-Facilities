const express = require("express");
const {
  getCapacityConfigurations,
  updateCapacityConfiguration
} = require("../controllers/capacityConfigurationController");
const { requirePermission } = require("../middleware/authMiddleware");
const { auditConfigurationAttempt } = require("../services/warehouseConfigurationService");

const router = express.Router();

router.get("/", getCapacityConfigurations);
router.put(
  "/:entityType/:entityId",
  requirePermission("warehouse.configuration.manage"),
  auditConfigurationAttempt,
  updateCapacityConfiguration
);

module.exports = router;

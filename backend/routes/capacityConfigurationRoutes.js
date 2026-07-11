const express = require("express");
const {
  getCapacityConfigurations,
  updateCapacityConfiguration
} = require("../controllers/capacityConfigurationController");
const { requireRole } = require("../middleware/authMiddleware");
const { auditConfigurationAttempt } = require("../services/warehouseConfigurationService");

const router = express.Router();

router.get("/", getCapacityConfigurations);
router.put(
  "/:entityType/:entityId",
  requireRole("System Admin"),
  auditConfigurationAttempt,
  updateCapacityConfiguration
);

module.exports = router;

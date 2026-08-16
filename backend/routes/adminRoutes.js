const express = require("express");
const {
  getAdminPermissions,
  getAdminRolePermissions,
  getAdminRoles,
  getNotificationEscalationSettings,
  updateAdminRolePermissions,
  updateNotificationEscalationSettings
} = require("../controllers/permissionController");
const { requirePermission } = require("../middleware/authMiddleware");
const { createRateLimiter } = require("../services/rateLimitService");
const configurationOperationLimit = createRateLimiter({ scope: "configuration.operation", limit: 20, windowMs: 60_000 });
const {
  getReadiness,
  validateConfiguration,
  exportConfiguration,
  restoreConfiguration,
  validateConfigurationBackup
} = require("../controllers/systemConfigurationController");

const router = express.Router();

router.get("/roles", requirePermission("system.roles.view"), getAdminRoles);
router.get("/permissions", requirePermission("system.permissions.view"), getAdminPermissions);
router.get("/roles/:publicReference/permissions", requirePermission("system.permissions.view"), getAdminRolePermissions);
router.put("/roles/:publicReference/permissions", requirePermission("system.permissions.manage"), updateAdminRolePermissions);
router.get("/notification-escalation", requirePermission("system.notifications.configure"), getNotificationEscalationSettings);
router.put("/notification-escalation", requirePermission("system.notifications.configure"), updateNotificationEscalationSettings);
router.get("/readiness", requirePermission("system.configuration.view"), getReadiness);
router.post("/configuration/validate", requirePermission("system.configuration.manage"), validateConfiguration);
router.get("/configuration/backup", configurationOperationLimit, requirePermission("system.configuration.view"), exportConfiguration);
router.post("/configuration/backup/validate", configurationOperationLimit, requirePermission("system.configuration.manage"), validateConfigurationBackup);
router.post("/configuration/restore", configurationOperationLimit, requirePermission("system.configuration.manage"), restoreConfiguration);

module.exports = router;

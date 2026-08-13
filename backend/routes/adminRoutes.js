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
const {
  getReadiness,
  validateConfiguration
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

module.exports = router;

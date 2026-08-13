const express = require("express");
const {
  archiveNotificationForUser,
  createSystemAnnouncementNotification,
  getNotifications,
  getNotificationSummaryForUser,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  restoreNotificationForUser,
  resolveNotificationRoute
} = require("../controllers/notificationController");
const { requirePermission } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", getNotifications);
router.get("/unread-count", getUnreadNotificationCount);
router.get("/summary", getNotificationSummaryForUser);
router.patch("/read-all", markAllNotificationsAsRead);
router.post("/system-announcement", requirePermission("system.notifications.announce"), createSystemAnnouncementNotification);
router.patch("/:publicRef/read", markNotificationAsRead);
router.patch("/:publicRef/archive", archiveNotificationForUser);
router.patch("/:publicRef/restore", restoreNotificationForUser);
router.patch("/:publicRef/resolve", resolveNotificationRoute);
router.delete("/:publicRef", archiveNotificationForUser);

module.exports = router;

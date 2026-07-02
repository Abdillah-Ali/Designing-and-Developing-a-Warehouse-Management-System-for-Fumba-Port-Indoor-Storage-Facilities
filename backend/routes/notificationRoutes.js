const express = require("express");
const {
  archiveNotificationForUser,
  createSystemAnnouncementNotification,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead
} = require("../controllers/notificationController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", getNotifications);
router.get("/unread-count", getUnreadNotificationCount);
router.patch("/read-all", markAllNotificationsAsRead);
router.post("/system-announcement", requireRole("System Admin"), createSystemAnnouncementNotification);
router.patch("/:id/read", markNotificationAsRead);
router.patch("/:id/archive", archiveNotificationForUser);
router.delete("/:id", archiveNotificationForUser);

module.exports = router;

const db = require("../config/db");
const { buildError } = require("../utils/apiError");
const {
  archiveNotification,
  createSystemAnnouncement,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead
} = require("../services/notificationService");

const sendNotFound = () => {
  throw buildError("Notification not found.", 404);
};

const getNotifications = async (req, res, next) => {
  try {
    const result = await listNotifications({
      auth: req.auth,
      filters: req.query
    });

    res.json({
      success: true,
      count: result.rows.length,
      total: result.total,
      page: result.page,
      limit: result.limit,
      data: result.rows
    });
  } catch (error) {
    next(error);
  }
};

const getUnreadNotificationCount = async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: {
        count: await getUnreadCount({ auth: req.auth })
      }
    });
  } catch (error) {
    next(error);
  }
};

const markNotificationAsRead = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const notification = await markNotificationRead({
      auth: req.auth,
      notificationId: req.params.id,
      executor: client
    });
    if (!notification) sendNotFound();
    await client.query("COMMIT");
    res.json({ success: true, data: notification });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const markAllNotificationsAsRead = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const rows = await markAllNotificationsRead({
      auth: req.auth,
      executor: client
    });
    await client.query("COMMIT");
    res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const createSystemAnnouncementNotification = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const title = String(req.body?.title || "").trim();
    const message = String(req.body?.message || "").trim();
    if (!title || !message) {
      throw buildError("Announcement title and message are required.", 400);
    }

    await client.query("BEGIN");
    const rows = await createSystemAnnouncement(req.body, req.auth, client);
    await client.query("COMMIT");
    res.status(201).json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const archiveNotificationForUser = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const notification = await archiveNotification({
      auth: req.auth,
      notificationId: req.params.id,
      executor: client
    });
    if (!notification) sendNotFound();
    await client.query("COMMIT");
    res.json({ success: true, data: notification });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

module.exports = {
  archiveNotificationForUser,
  createSystemAnnouncementNotification,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead
};

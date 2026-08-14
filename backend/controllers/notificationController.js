const db = require("../config/db");
const { buildError } = require("../utils/apiError");
const {
  addVisibleNotificationClauses,
  archiveNotification,
  createSystemAnnouncement,
  getNotificationSummary,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  restoreNotification
} = require("../services/notificationService");
const {listNotificationPolicies,updateNotificationPolicy}=require("../services/notificationAuthorityService");

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

const getNotificationSummaryForUser = async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await getNotificationSummary({ auth: req.auth })
    });
  } catch (error) {
    next(error);
  }
};

const markNotificationAsRead = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const { publicRef } = req.params;
    await client.query("BEGIN");
    const notification = await markNotificationRead({
      auth: req.auth,
      publicRef,
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
    const { publicRef } = req.params;
    await client.query("BEGIN");
    const notification = await archiveNotification({
      auth: req.auth,
      publicRef,
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

const restoreNotificationForUser = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const { publicRef } = req.params;
    await client.query("BEGIN");
    const notification = await restoreNotification({
      auth: req.auth,
      publicRef,
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

const resolveNotificationRoute = async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const { publicRef } = req.params;
    await client.query("BEGIN");

    const findValues = [publicRef];
    const findClauses = ["n.public_reference = $1"];
    addVisibleNotificationClauses(req.auth, findClauses, findValues);
    const findResult = await client.query(
      `SELECT public_reference, notification_type, actionable, status
       FROM notifications n
       WHERE ${findClauses.join(" AND ")}
       LIMIT 1`,
      findValues
    );
    const notification = findResult.rows[0];
    if (!notification) {
      throw buildError("Notification not found.", 404);
    }

    if (notification.actionable) {
      throw buildError("Complete the required workflow action to resolve this notification.", 409);
    }

    const values = [publicRef];
    const clauses = ["n.public_reference = $1"];
    addVisibleNotificationClauses(req.auth, clauses, values);

    const result = await client.query(
      `UPDATE notifications n
       SET status = 'completed',
           completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
       WHERE ${clauses.join(" AND ")}
       RETURNING
         public_reference,
         notification_type,
         status,
         completed_at,
         is_read,
         read_at`,
      values
    );

    const updated = result.rows[0];
    if (!updated) {
      throw buildError("Notification not found.", 404);
    }

    await client.query("COMMIT");
    res.json({ success: true, data: updated });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
};

const getNotificationPolicies=async(req,res,next)=>{try{const rows=await listNotificationPolicies();res.json({success:true,count:rows.length,data:rows});}catch(error){next(error);}};
const updateNotificationPolicyRoute=async(req,res,next)=>{const client=await db.pool.connect();try{await client.query("BEGIN");const row=await updateNotificationPolicy(req.params.eventKey,req.body||{},req.auth?.userId,client);await client.query("COMMIT");res.json({success:true,data:row});}catch(error){await client.query("ROLLBACK");next(error);}finally{client.release();}};

module.exports = {
  archiveNotificationForUser,
  createSystemAnnouncementNotification,
  getNotifications,
  getNotificationPolicies,
  getNotificationSummaryForUser,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  restoreNotificationForUser,
  resolveNotificationRoute,
  updateNotificationPolicyRoute
};

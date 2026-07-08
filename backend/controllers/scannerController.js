const {
  cancelSessionByStaff,
  createPlacementScanSession,
  getActiveSessionForAuth
} = require("../services/scannerSessionService");
const {
  emitSessionCancelled,
  emitSessionStarted,
  emitSessionUpdated
} = require("../realtime/socketServer");

const getActiveScanSession = async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await getActiveSessionForAuth(req.auth)
    });
  } catch (error) {
    next(error);
  }
};

const startPlacementScanSession = async (req, res, next) => {
  try {
    const session = await createPlacementScanSession(req.body, req.auth);
    emitSessionStarted(session);

    res.status(201).json({
      success: true,
      data: session
    });
  } catch (error) {
    next(error);
  }
};

const cancelScanSession = async (req, res, next) => {
  try {
    const session = await cancelSessionByStaff(req.params.id, req.auth);
    emitSessionCancelled(session);

    res.json({
      success: true,
      data: session
    });
  } catch (error) {
    next(error);
  }
};

const refreshScanSession = async (req, res, next) => {
  try {
    const session = await getActiveSessionForAuth(req.auth);
    if (session) emitSessionUpdated(session, "scanner:session-refreshed");

    res.json({
      success: true,
      data: session
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  cancelScanSession,
  getActiveScanSession,
  refreshScanSession,
  startPlacementScanSession
};

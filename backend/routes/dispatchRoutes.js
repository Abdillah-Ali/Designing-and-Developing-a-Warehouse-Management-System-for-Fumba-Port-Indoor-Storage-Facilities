const express = require("express");
const {
  approveDispatchRequest,
  completeDispatch,
  getDispatchRequests,
  rejectDispatchRequest,
  requestDispatchAuthorization
} = require("../controllers/dispatchController");

const router = express.Router();

router.post("/request-authorization", requestDispatchAuthorization);
router.get("/authorization-requests", getDispatchRequests);
router.post("/authorization-requests/:id/approve", approveDispatchRequest);
router.post("/authorization-requests/:id/reject", rejectDispatchRequest);
router.post("/authorization-requests/:id/complete", completeDispatch);

module.exports = router;

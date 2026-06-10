const express = require("express");
const {
  confirmPlacement,
  getPlacementLogs,
  validatePlacement
} = require("../controllers/placementController");

const router = express.Router();

router.get("/logs", getPlacementLogs);
router.post("/confirm", confirmPlacement);
router.post("/validate", validatePlacement);

module.exports = router;

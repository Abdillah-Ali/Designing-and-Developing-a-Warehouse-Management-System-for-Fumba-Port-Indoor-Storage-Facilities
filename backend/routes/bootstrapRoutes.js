const express = require("express");
const {
  createFirstAdmin,
  getBootstrapOptions,
  getSetupStatus
} = require("../controllers/bootstrapController");

const router = express.Router();

router.get("/status", getSetupStatus);
router.get("/options", getBootstrapOptions);
router.post("/create-admin", createFirstAdmin);

module.exports = router;

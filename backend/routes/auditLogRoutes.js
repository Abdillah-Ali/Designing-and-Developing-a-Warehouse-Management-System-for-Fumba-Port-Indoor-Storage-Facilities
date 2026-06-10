const express = require("express");
const { getAuditLogs } = require("../controllers/adminController");

const router = express.Router();

router.get("/", getAuditLogs);

module.exports = router;

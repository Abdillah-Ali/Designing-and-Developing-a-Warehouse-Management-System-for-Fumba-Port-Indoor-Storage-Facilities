const express = require("express");
const { getUserSessions } = require("../controllers/adminController");
const { requirePermission } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requirePermission("system.sessions.view"), getUserSessions);

module.exports = router;

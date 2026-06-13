const express = require("express");
const { getUserSessions } = require("../controllers/adminController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole("System Admin"), getUserSessions);

module.exports = router;

const express = require("express");
const { getUserSessions } = require("../controllers/adminController");

const router = express.Router();

router.get("/", getUserSessions);

module.exports = router;

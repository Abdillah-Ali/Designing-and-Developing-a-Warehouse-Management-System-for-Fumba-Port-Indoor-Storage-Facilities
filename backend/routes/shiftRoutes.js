const express = require("express");
const { getShifts } = require("../controllers/adminController");

const router = express.Router();

router.get("/", getShifts);

module.exports = router;

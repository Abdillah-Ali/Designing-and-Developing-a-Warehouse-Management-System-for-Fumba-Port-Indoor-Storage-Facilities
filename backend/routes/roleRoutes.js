const express = require("express");
const { getRoles } = require("../controllers/adminController");

const router = express.Router();

router.get("/", getRoles);

module.exports = router;

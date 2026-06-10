const express = require("express");
const { getWarehouses } = require("../controllers/adminController");

const router = express.Router();

router.get("/", getWarehouses);

module.exports = router;

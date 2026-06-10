const express = require("express");
const { getRules, updateRule } = require("../controllers/binRuleController");

const router = express.Router();

router.get("/", getRules);
router.put("/:id", updateRule);

module.exports = router;

const express = require("express");
const { getLevelsByRack, createLevel, updateLevel, deleteLevel } = require("../controllers/levelController");

const router = express.Router();

router.get("/:rackId", getLevelsByRack);
router.post("/", createLevel);
router.put("/:id", updateLevel);
router.delete("/:id", deleteLevel);

module.exports = router;

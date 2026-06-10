const express = require("express");
const { getBinsByLevel, createBin, updateBin, deleteBin } = require("../controllers/binController");

const router = express.Router();

router.get("/:levelId", getBinsByLevel);
router.post("/", createBin);
router.put("/:id", updateBin);
router.delete("/:id", deleteBin);

module.exports = router;

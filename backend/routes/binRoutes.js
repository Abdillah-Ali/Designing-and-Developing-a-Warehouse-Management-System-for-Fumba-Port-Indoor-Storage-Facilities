const express = require("express");
const {
  getBins,
  getBinById,
  getBinsByLevel,
  createBin,
  updateBin,
  updateBinStatus,
  deleteBin
} = require("../controllers/binController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", getBins);
router.post("/", requireRole("System Admin"), createBin);
router.get("/by-level/:levelId", getBinsByLevel);
router.patch("/:id/status", requireRole("System Admin"), updateBinStatus);
router.get("/:id", getBinById);
router.put("/:id", requireRole("System Admin"), updateBin);
router.delete("/:id", requireRole("System Admin"), deleteBin);

module.exports = router;

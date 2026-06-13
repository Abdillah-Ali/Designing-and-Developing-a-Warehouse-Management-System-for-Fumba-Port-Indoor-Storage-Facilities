const express = require("express");
const {
  getLevels,
  getLevelById,
  getLevelsByRack,
  createLevel,
  updateLevel,
  updateLevelStatus,
  deleteLevel
} = require("../controllers/levelController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", getLevels);
router.post("/", requireRole("System Admin"), createLevel);
router.get("/by-rack/:rackId", getLevelsByRack);
router.patch("/:id/status", requireRole("System Admin"), updateLevelStatus);
router.get("/:id", getLevelById);
router.put("/:id", requireRole("System Admin"), updateLevel);
router.delete("/:id", requireRole("System Admin"), deleteLevel);

module.exports = router;

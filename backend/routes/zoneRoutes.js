const express = require("express");
const {
  getZones,
  getZoneById,
  createZone,
  updateZone,
  updateZoneStatus,
  deleteZone
} = require("../controllers/zoneController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", getZones);
router.post("/", requireRole("System Admin"), createZone);
router.patch("/:id/status", requireRole("System Admin"), updateZoneStatus);
router.get("/:id", getZoneById);
router.put("/:id", requireRole("System Admin"), updateZone);
router.delete("/:id", requireRole("System Admin"), deleteZone);

module.exports = router;

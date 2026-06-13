const express = require("express");
const {
  getRacks,
  getRackById,
  getRacksByZone,
  createRack,
  updateRack,
  updateRackStatus,
  deleteRack
} = require("../controllers/rackController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", getRacks);
router.post("/", requireRole("System Admin"), createRack);
router.get("/by-zone/:zoneId", getRacksByZone);
router.patch("/:id/status", requireRole("System Admin"), updateRackStatus);
router.get("/:id", getRackById);
router.put("/:id", requireRole("System Admin"), updateRack);
router.delete("/:id", requireRole("System Admin"), deleteRack);

module.exports = router;

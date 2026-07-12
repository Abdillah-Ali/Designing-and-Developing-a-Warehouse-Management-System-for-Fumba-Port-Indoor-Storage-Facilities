const express = require("express");
const {
  getCargo,
  getCleared,
  getDashboard,
  getHistory,
  getHolds,
  getQueue,
  getRecords,
  startInspection,
  updateStatus
} = require("../controllers/customsController");
const { requirePermission } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/dashboard", requirePermission("customs.dashboard.view"), getDashboard);
router.get("/queue", requirePermission("customs.cargo.view"), getQueue);
router.get("/records", requirePermission("customs.cargo.view"), getRecords);
router.get("/cleared", requirePermission("customs.cargo.view"), getCleared);
router.get("/holds", requirePermission("customs.cargo.view"), getHolds);
router.get("/cargo/:cargoReference", requirePermission("customs.cargo.view"), getCargo);
router.get("/cargo/:cargoReference/history", requirePermission("customs.history.view"), getHistory);
router.post("/cargo/:cargoReference/start", requirePermission("customs.inspections.create"), startInspection);
router.post("/cargo/:cargoReference/status", requirePermission("customs.clearance.update"), updateStatus);

module.exports = router;

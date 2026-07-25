const express = require("express");
const {
  assignUserToShift,
  createShift,
  getShift,
  getShiftAssignmentHistory,
  getShiftUsers,
  getShifts,
  removeUserFromShift,
  updateShift,
  updateShiftStatus
} = require("../controllers/shiftController");
const { requirePermission } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requirePermission("warehouse.shifts.view"), getShifts);
router.post("/", requirePermission("warehouse.shifts.manage"), createShift);
router.get("/assignment-history", requirePermission("warehouse.shifts.view"), getShiftAssignmentHistory);
router.get("/:reference", requirePermission("warehouse.shifts.view"), getShift);
router.put("/:reference", requirePermission("warehouse.shifts.manage"), updateShift);
router.patch("/:reference/status", requirePermission("warehouse.shifts.manage"), updateShiftStatus);
router.get("/:reference/users", requirePermission("warehouse.shifts.view"), getShiftUsers);
router.post("/:reference/assignments", requirePermission("warehouse.shifts.manage"), assignUserToShift);
router.delete("/:reference/assignments/:username", requirePermission("warehouse.shifts.manage"), removeUserFromShift);

module.exports = router;

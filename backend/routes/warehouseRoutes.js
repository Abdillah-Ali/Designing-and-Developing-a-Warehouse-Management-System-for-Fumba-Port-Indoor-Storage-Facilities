const express = require("express");
const {
  getWarehouses,
  createWarehouse,
  updateWarehouse,
  updateWarehouseStatus,
  deleteWarehouse,
  listWarehouseAssignments,
  assignUserToWarehouse,
  removeUserFromWarehouse,
  listWarehouseAssignmentHistory
} = require("../controllers/warehouseController");
const { requirePermission, requireRole } = require("../middleware/authMiddleware");
const { auditConfigurationAttempt } = require("../services/warehouseConfigurationService");

const router = express.Router();

router.get("/", getWarehouses);
router.get("/assignments", requirePermission("warehouse.configuration.view"), listWarehouseAssignments);
router.get("/assignment-history", requirePermission("warehouse.configuration.view"), listWarehouseAssignmentHistory);
router.post("/", requireRole("System Admin"), auditConfigurationAttempt, createWarehouse);
router.post("/:reference/assignments", requirePermission("warehouse.configuration.manage"), assignUserToWarehouse);
router.delete("/:reference/assignments/:username", requirePermission("warehouse.configuration.manage"), removeUserFromWarehouse);
router.put("/:id", requireRole("System Admin"), auditConfigurationAttempt, updateWarehouse);
router.patch("/:id/status", requireRole("System Admin"), auditConfigurationAttempt, updateWarehouseStatus);
router.delete("/:id", requireRole("System Admin"), auditConfigurationAttempt, deleteWarehouse);

module.exports = router;

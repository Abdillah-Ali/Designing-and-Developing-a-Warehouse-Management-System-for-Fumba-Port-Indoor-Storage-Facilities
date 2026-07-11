const express = require("express");
const {
  getWarehouses,
  createWarehouse,
  updateWarehouse,
  updateWarehouseStatus,
  deleteWarehouse
} = require("../controllers/warehouseController");
const { requireRole } = require("../middleware/authMiddleware");
const { auditConfigurationAttempt } = require("../services/warehouseConfigurationService");

const router = express.Router();

router.get("/", getWarehouses);
router.post("/", requireRole("System Admin"), auditConfigurationAttempt, createWarehouse);
router.put("/:id", requireRole("System Admin"), auditConfigurationAttempt, updateWarehouse);
router.patch("/:id/status", requireRole("System Admin"), auditConfigurationAttempt, updateWarehouseStatus);
router.delete("/:id", requireRole("System Admin"), auditConfigurationAttempt, deleteWarehouse);

module.exports = router;

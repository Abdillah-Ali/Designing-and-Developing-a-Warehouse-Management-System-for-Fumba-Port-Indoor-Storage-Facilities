const express = require("express");
const {
  createRule, deleteCategory, deleteRule, getCategories, getEvaluatorCatalog,
  getReadiness, getRule, getRuleHistory, getRules, saveCategory, updateRule
} = require("../controllers/binRuleController");
const { requireRole } = require("../middleware/authMiddleware");
const { auditConfigurationAttempt } = require("../services/warehouseConfigurationService");

const router = express.Router();

router.get("/", getRules);
router.get("/evaluators", getEvaluatorCatalog);
router.get("/readiness", getReadiness);
router.get("/categories", getCategories);
router.post("/categories", requireRole("System Admin"), auditConfigurationAttempt, saveCategory);
router.put("/categories/:reference", requireRole("System Admin"), auditConfigurationAttempt, saveCategory);
router.delete("/categories/:reference", requireRole("System Admin"), auditConfigurationAttempt, deleteCategory);
router.post("/", requireRole("System Admin"), auditConfigurationAttempt, createRule);
router.get("/:reference/history", getRuleHistory);
router.get("/:reference", getRule);
router.put("/:reference", requireRole("System Admin"), auditConfigurationAttempt, updateRule);
router.delete("/:reference", requireRole("System Admin"), auditConfigurationAttempt, deleteRule);

module.exports = router;

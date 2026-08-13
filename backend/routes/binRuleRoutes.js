const express = require("express");
const {
  createRule, deleteCategory, deleteRule, getCategories, getEvaluatorCatalog,
  getReadiness, getRule, getRuleHistory, getRules, saveCategory, updateRule
} = require("../controllers/binRuleController");
const { requirePermission } = require("../middleware/authMiddleware");
const { auditConfigurationAttempt } = require("../services/warehouseConfigurationService");

const router = express.Router();

router.get("/", getRules);
router.get("/evaluators", getEvaluatorCatalog);
router.get("/readiness", getReadiness);
router.get("/categories", getCategories);
router.post("/categories", requirePermission("bin_rules.manage"), auditConfigurationAttempt, saveCategory);
router.put("/categories/:reference", requirePermission("bin_rules.manage"), auditConfigurationAttempt, saveCategory);
router.delete("/categories/:reference", requirePermission("bin_rules.manage"), auditConfigurationAttempt, deleteCategory);
router.post("/", requirePermission("bin_rules.manage"), auditConfigurationAttempt, createRule);
router.get("/:reference/history", getRuleHistory);
router.get("/:reference", getRule);
router.put("/:reference", requirePermission("bin_rules.manage"), auditConfigurationAttempt, updateRule);
router.delete("/:reference", requirePermission("bin_rules.manage"), auditConfigurationAttempt, deleteRule);

module.exports = router;

const express = require("express");
const {
  activateTariff,
  createTariff,
  deactivateTariff,
  getCargoCharges,
  getDashboard,
  getInvoice,
  getInvoices,
  getPayments,
  getReports,
  getTariffs,
  recordInvoicePayment,
  confirmInvoicePayment,
  updateTariff
} = require("../controllers/financeController");
const tariffApproval=require("../controllers/tariffApprovalController");
const { requirePermission } = require("../middleware/authMiddleware");
const { createRateLimiter } = require("../services/rateLimitService");
const reportLimit = createRateLimiter({ scope: "finance.reports", limit: 60, windowMs: 60_000 });

const router = express.Router();

router.get("/dashboard", requirePermission("finance.dashboard.view"), getDashboard);
router.get("/cargo-charges", requirePermission("finance.charges.view"), getCargoCharges);

router.get("/tariffs", requirePermission("finance.tariffs.view"), getTariffs);
router.post("/tariffs", requirePermission("finance.tariffs.create"), createTariff);
router.put("/tariffs/:reference", requirePermission("finance.tariffs.update"), updateTariff);
router.post("/tariffs/:reference/submit",requirePermission("finance.tariffs.submit"),tariffApproval.submit);
router.post("/tariffs/:reference/activate", requirePermission("finance.tariffs.activate"), activateTariff);
router.post("/tariffs/:reference/deactivate", requirePermission("finance.tariffs.activate"), deactivateTariff);

router.get("/invoices", requirePermission("finance.invoices.view"), getInvoices);
router.get("/invoices/:invoiceNumber", requirePermission("finance.invoices.view"), getInvoice);

router.get("/payments", requirePermission("finance.payments.record"), getPayments);
router.post("/payments", requirePermission("finance.payments.record"), recordInvoicePayment);
router.post("/payments/:reference/confirm", requirePermission("finance.payments.confirm"), confirmInvoicePayment);

router.get("/reports", reportLimit, requirePermission("finance.reports.view"), getReports);

module.exports = router;

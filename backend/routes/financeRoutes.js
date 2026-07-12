const express = require("express");
const {
  activateTariff,
  cancelInvoiceByNumber,
  createTariff,
  deactivateTariff,
  generateDraftInvoice,
  getCargoCharges,
  getDashboard,
  getInvoice,
  getInvoices,
  getPayments,
  getReports,
  getTariffs,
  issueInvoiceByNumber,
  recordInvoicePayment,
  updateTariff
} = require("../controllers/financeController");
const { requirePermission } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/dashboard", requirePermission("finance.dashboard.view"), getDashboard);
router.get("/cargo-charges", requirePermission("finance.charges.view"), getCargoCharges);

router.get("/tariffs", requirePermission("finance.tariffs.view"), getTariffs);
router.post("/tariffs", requirePermission("finance.tariffs.create"), createTariff);
router.put("/tariffs/:reference", requirePermission("finance.tariffs.update"), updateTariff);
router.post("/tariffs/:reference/activate", requirePermission("finance.tariffs.activate"), activateTariff);
router.post("/tariffs/:reference/deactivate", requirePermission("finance.tariffs.activate"), deactivateTariff);

router.get("/invoices", requirePermission("finance.invoices.view"), getInvoices);
router.post("/invoices/draft", requirePermission("finance.invoices.create"), generateDraftInvoice);
router.get("/invoices/:invoiceNumber", requirePermission("finance.invoices.view"), getInvoice);
router.post("/invoices/:invoiceNumber/issue", requirePermission("finance.invoices.issue"), issueInvoiceByNumber);
router.post("/invoices/:invoiceNumber/cancel", requirePermission("finance.invoices.cancel"), cancelInvoiceByNumber);

router.get("/payments", requirePermission("finance.payments.record"), getPayments);
router.post("/payments", requirePermission("finance.payments.record"), recordInvoicePayment);

router.get("/reports", requirePermission("finance.reports.view"), getReports);

module.exports = router;

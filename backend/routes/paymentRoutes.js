const router=require("express").Router();
const { initiate,autoBill,history,resendEmail }=require("../controllers/paymentController");
const { requirePermission }=require("../middleware/authMiddleware");
router.post("/invoices/:invoiceNumber/initiate",requirePermission("finance.payments.initiate"),initiate);
router.post("/cargo/:cargoReference/automatic-billing",requirePermission("finance.payments.initiate"),autoBill);
router.get("/:paymentReference/history",requirePermission("finance.payments.record"),history);
router.post("/invoices/:invoiceNumber/payment-email/resend",requirePermission("finance.payments.initiate"),resendEmail);
module.exports=router;

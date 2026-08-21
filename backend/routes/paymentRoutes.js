const router=require("express").Router();
const { initiate,autoBill }=require("../controllers/paymentController");
const { requirePermission }=require("../middleware/authMiddleware");
router.post("/invoices/:invoiceNumber/initiate",requirePermission("finance.payments.initiate"),initiate);
router.post("/cargo/:cargoReference/automatic-billing",requirePermission("finance.payments.initiate"),autoBill);
module.exports=router;

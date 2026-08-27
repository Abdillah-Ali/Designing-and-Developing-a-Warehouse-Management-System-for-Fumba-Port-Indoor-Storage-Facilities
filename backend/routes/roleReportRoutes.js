const express=require("express");
const {requireAuthenticated}=require("../middleware/authMiddleware");
const controller=require("../controllers/roleReportController");
const router=express.Router();
router.use(requireAuthenticated);
router.get("/:scope",controller.get);
router.get("/:scope/export/:format",controller.exportReport);
module.exports=router;

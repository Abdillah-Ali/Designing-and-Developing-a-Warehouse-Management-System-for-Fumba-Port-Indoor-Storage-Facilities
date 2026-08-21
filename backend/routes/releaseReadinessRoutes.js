const router=require("express").Router();const { requirePermission }=require("../middleware/authMiddleware");const { listReadyCargo }=require("../services/releaseReadinessService");
router.get("/cargo-to-release",requirePermission("staff.release_queue.view"),async(req,res,next)=>{try{const data=await listReadyCargo({warehouseId:req.auth?.warehouseId});res.json({success:true,count:data.length,data})}catch(e){next(e)}});
module.exports=router;

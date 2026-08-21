const db=require("../config/db");const svc=require("../services/tariffApprovalService");
const tx=async(fn)=>{const c=await db.pool.connect();try{await c.query("BEGIN");const v=await fn(c);await c.query("COMMIT");return v}catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}};
exports.list=async(req,res,next)=>{try{res.json({success:true,data:await svc.list({status:req.query.status,executor:db})})}catch(e){next(e)}};
exports.submit=async(req,res,next)=>{try{res.json({success:true,data:await tx(c=>svc.submit({reference:req.params.reference,auth:req.auth,executor:c}))})}catch(e){next(e)}};
const decide=d=>async(req,res,next)=>{try{res.json({success:true,data:await tx(c=>svc.decide({reference:req.params.reference,decision:d,reason:req.body.reason,auth:req.auth,executor:c}))})}catch(e){next(e)}};
exports.approve=decide("APPROVED");exports.reject=decide("REJECTED");

const db=require("../config/db");
const { initiatePayment,processWebhook,ensureAutomaticInvoice,recordWebhookFailure }=require("../services/paymentService");
const tx=async(fn)=>{const c=await db.pool.connect();try{await c.query("BEGIN");const v=await fn(c);await c.query("COMMIT");return v}catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}};
const initiate=async(req,res,next)=>{try{const data=await tx(c=>initiatePayment({invoiceNumber:req.params.invoiceNumber,customer:req.body||{},auth:req.auth,executor:c}));res.status(201).json({success:true,data})}catch(e){next(e)}};
const webhook=async(req,res,next)=>{try{const data=await tx(c=>processWebhook({headers:req.headers,rawBody:req.body,executor:c}));res.json({success:true,data})}catch(e){try{await recordWebhookFailure({headers:req.headers,rawBody:req.body,executor:db})}catch{}next(e)}};
const autoBill=async(req,res,next)=>{try{const data=await tx(c=>ensureAutomaticInvoice({cargoReference:req.params.cargoReference,executor:c}));res.status(201).json({success:true,data})}catch(e){next(e)}};
module.exports={initiate,webhook,autoBill};

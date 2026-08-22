const router=require("express").Router();
const { publicSummary,publicInitiate,publicAttemptStatus }=require("../controllers/paymentController");
const { createRateLimiter }=require("../services/rateLimitService");

const readLimit=createRateLimiter({scope:"public_payment_read",limit:120,windowMs:15*60*1000});
const initiateLimit=createRateLimiter({scope:"public_payment_initiate",limit:10,windowMs:15*60*1000,accountField:"email"});

// Token-only, deliberately narrow customer surface. No administrative mutation is exposed.
router.get("/:token",readLimit,publicSummary);
router.post("/:token/attempts",initiateLimit,publicInitiate);
router.get("/:token/attempts/:attemptReference",readLimit,publicAttemptStatus);

module.exports=router;

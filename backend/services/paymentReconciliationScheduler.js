const {reconcilePendingPayments}=require('./paymentService');
let running=false;
let timer;

async function refreshPendingPayments(){
  if(running)return {skipped:true};
  running=true;
  try{return await reconcilePendingPayments();}
  finally{running=false;}
}

function startPaymentReconciliationScheduler(){
  if(timer)return timer;
  const run=()=>refreshPendingPayments().catch(error=>console.error(JSON.stringify({operation:'payment_reconciliation_scheduler',result:'failure',error_category:error.errorCode||error.code||error.name,timestamp:new Date().toISOString()})));
  timer=setInterval(run,5000);
  timer.unref();
  run();
  return timer;
}

module.exports={refreshPendingPayments,startPaymentReconciliationScheduler};

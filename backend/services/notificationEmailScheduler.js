const {deliverOne}=require('./notificationEmailService');
let timer;let running=false;
async function flushNotificationEmails(){if(running)return;running=true;try{for(let i=0;i<50;i+=1){if(!await deliverOne())break;}}finally{running=false;}}
function startNotificationEmailScheduler(){if(timer)return timer;const run=()=>flushNotificationEmails().catch(error=>console.error(JSON.stringify({operation:'notification_email_scheduler',result:'failure',error_category:error.code||error.name,timestamp:new Date().toISOString()})));timer=setInterval(run,1000);timer.unref();run();return timer;}
module.exports={flushNotificationEmails,startNotificationEmailScheduler};

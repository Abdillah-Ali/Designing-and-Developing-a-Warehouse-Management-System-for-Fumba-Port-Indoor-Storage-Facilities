const db = require('../config/db');
let running = false;
let timer;

async function refreshBillingQueue() {
  if (running) return;
  running = true;
  try {
    const rows = await db.query("SELECT id FROM cargo WHERE is_deleted=FALSE AND gate_out_status='Not Released' ORDER BY id");
    for (const {id} of rows.rows) {
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await require('./financeService').getCargoFinancialSnapshot({cargoId:id,executor:client});
        await require('./releaseReadinessService').recalculateReleaseReadiness({cargoId:id,executor:client,trigger:'DAILY_BILLING'});
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('Cargo billing refresh failed', {cargoId:id,code:error.code,message:error.message});
      } finally { client.release(); }
    }
  } finally { running = false; }
}

function startBillingScheduler() {
  if (timer) return timer;
  const run = () => refreshBillingQueue().catch(error => console.error('Billing scheduler failed', error.message));
  timer = setInterval(run, 60000);
  timer.unref();
  run();
  return timer;
}
module.exports = {refreshBillingQueue,startBillingScheduler};

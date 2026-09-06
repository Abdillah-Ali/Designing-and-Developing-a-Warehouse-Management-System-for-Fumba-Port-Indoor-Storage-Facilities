const DAY_MS = 86400000;

// UTC elapsed durations, never calendar dates. The first penalty is due at
// exactly 24 hours; another is due at each following 24-hour boundary.
const penaltyDays = (paidAt, at) => Math.max(0, Math.floor((new Date(at) - new Date(paidAt)) / DAY_MS));
const penaltyRate = (dailyCents, percent) => {
  const text=String(percent??"").trim();
  if(!/^\d+(?:\.\d{1,4})?$/.test(text)||Number(text)<0||Number(text)>100) throw new Error("Tariff late-collection penalty percentage must be between 0 and 100.");
  const [whole,fraction=""]=text.split("."); const scaled=BigInt(whole)*10000n+BigInt(fraction.padEnd(4,"0"));
  return (dailyCents*(1000000n+scaled)+500000n)/1000000n;
};

// Replay only backend-verified payments. This also reconstructs historical
// collection windows without depending on how often the scheduler has run.
async function calculateCollectionBilling({ payments, at, releasedAt, storageAt }) {
  const end = new Date(releasedAt && new Date(releasedAt) < new Date(at) ? releasedAt : at);
  let paid = 0n, frozen = null, firstPaidAt = null, fullyPaidAt = null;
  let previousPenalties = 0n, dailyPenalty = 0n;
  const events = [...payments].filter(p => p.paid_at && new Date(p.paid_at) <= new Date(at))
    .sort((a, b) => new Date(a.paid_at) - new Date(b.paid_at) || a.id - b.id);
  for (const payment of events) {
    const time = new Date(payment.paid_at);
    const chargeTime = time > end ? end : time;
    const storage = frozen || await storageAt(chargeTime);
    const penalties = previousPenalties + (fullyPaidAt ? BigInt(penaltyDays(fullyPaidAt, chargeTime)) * dailyPenalty : 0n);
    const before = storage.total_cents + penalties - paid;
    paid += payment.cents;
    if (before > 0n && paid >= storage.total_cents + penalties) {
      if (!frozen) {
        frozen = storage;
        firstPaidAt = time;
        dailyPenalty = penaltyRate(storage.daily_cents,storage.late_collection_penalty_percent);
      }
      previousPenalties = penalties;
      fullyPaidAt = time;
    }
  }
  const storage = frozen || await storageAt(end);
  const penalties = previousPenalties + (fullyPaidAt ? BigInt(penaltyDays(fullyPaidAt, end)) * dailyPenalty : 0n);
  const total = storage.total_cents + penalties;
  return { storage, penalties, total, paid, outstanding: total > paid ? total - paid : 0n, firstPaidAt, fullyPaidAt, end };
}

module.exports = { calculateCollectionBilling, penaltyDays, penaltyRate };

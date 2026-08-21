const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const payment = require("../services/paymentService");

const secret = "focused-webhook-test-secret";
const envelope = ({ id = "evt_1", reference = "PAY-1", chargeId = "chg_1" } = {}) => {
  const rawBody = Buffer.from(JSON.stringify({ id, type: "charge.completed", data: { id: chargeId, reference } }));
  return { rawBody, headers: { "flutterwave-signature": payment.createWebhookSignature(rawBody, secret) } };
};

const eventStore = () => {
  const events = new Map(); let sequence = 0; let queries = 0;
  return {
    events,
    get queryCount() { return queries; },
    async query(sql, params = []) {
      queries += 1;
      if (sql.includes("INSERT INTO payment_webhook_events") && sql.includes("VALUES('flutterwave',$1,$2,'RECEIVED')")) {
        if (events.has(params[0])) return { rows: [], rowCount: 0 };
        const row = { id: ++sequence, event_id: params[0], payload_hash: params[1], processing_status: "RECEIVED", payment_id: null };
        events.set(params[0], row); return { rows: [{ id: row.id, processing_status: row.processing_status }], rowCount: 1 };
      }
      if (sql.startsWith("SELECT id,processing_status")) {
        const row = events.get(params[0]); return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes("SET payload_hash=$1,processing_status='RECEIVED'")) {
        const row = [...events.values()].find(item => item.id === params[1]);
        if (!row || !["RECEIVED", "FAILED"].includes(row.processing_status)) return { rows: [], rowCount: 0 };
        row.payload_hash = params[0]; row.processing_status = "RECEIVED";
        return { rows: [{ id: row.id, processing_status: row.processing_status }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO payment_webhook_events") && sql.includes("'FAILED'")) {
        let row = events.get(params[0]);
        if (!row) { row = { id: ++sequence, event_id: params[0], payload_hash: params[1], processing_status: "FAILED", payment_id: null }; events.set(params[0], row); }
        else if (["RECEIVED", "FAILED"].includes(row.processing_status)) { row.payload_hash = params[1]; row.processing_status = "FAILED"; }
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("processing_status='PROCESSED'")) {
        const row = [...events.values()].find(item => item.id === params[1]);
        if (!row || row.processing_status !== "RECEIVED") return { rows: [], rowCount: 0 };
        row.payment_id = params[0]; row.processing_status = "PROCESSED";
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
};

test.beforeEach(() => { process.env.FLUTTERWAVE_WEBHOOK_SECRET = secret; });

test("successful event is finalized as PROCESSED", async () => {
  const store = eventStore();
  const claim = await payment.claimWebhookEvent({ eventId: "evt_success", payloadHash: "hash-1", executor: store });
  await payment.markWebhookProcessed({ eventRecordId: claim.event.id, paymentId: 41, executor: store });
  assert.equal(store.events.get("evt_success").processing_status, "PROCESSED");
});

test("replay of a processed event is a duplicate with no settlement side effect", async () => {
  const store = eventStore(); let settlements = 0;
  const first = await payment.claimWebhookEvent({ eventId: "evt_replay", payloadHash: "hash-1", executor: store });
  settlements += 1; await payment.markWebhookProcessed({ eventRecordId: first.event.id, paymentId: 42, executor: store });
  const replay = await payment.claimWebhookEvent({ eventId: "evt_replay", payloadHash: "hash-1", executor: store });
  if (replay.claimed) settlements += 1;
  assert.equal(replay.duplicate, true); assert.equal(settlements, 1);
});

test("temporary verification failure after receipt is recorded as FAILED after transaction rollback", async () => {
  const store = eventStore(); const signed = envelope({ id: "evt_temp" });
  assert.equal(await payment.recordWebhookFailure({ ...signed, executor: store }), true);
  assert.equal(store.events.get("evt_temp").processing_status, "FAILED");
});

test("a failed event can be retried later and processed successfully", async () => {
  const store = eventStore(); const signed = envelope({ id: "evt_retry" });
  await payment.recordWebhookFailure({ ...signed, executor: store });
  const retry = await payment.claimWebhookEvent({ eventId: "evt_retry", payloadHash: "later-hash", executor: store });
  assert.equal(retry.claimed, true); assert.equal(retry.retry, true);
  await payment.markWebhookProcessed({ eventRecordId: retry.event.id, paymentId: 43, executor: store });
  assert.equal(store.events.get("evt_retry").processing_status, "PROCESSED");
});

test("two concurrent identical deliveries settle exactly once", async () => {
  const store = eventStore(); let settlements = 0; let transactionTail = Promise.resolve();
  const deliver = () => {
    const run = transactionTail.then(async () => {
      const claim = await payment.claimWebhookEvent({ eventId: "evt_concurrent", payloadHash: "same-hash", executor: store });
      if (!claim.claimed) return;
      settlements += 1;
      await payment.markWebhookProcessed({ eventRecordId: claim.event.id, paymentId: 44, executor: store });
    });
    transactionTail = run.catch(() => {}); return run;
  };
  await Promise.all([deliver(), deliver()]);
  assert.equal(settlements, 1); assert.equal(store.events.get("evt_concurrent").processing_status, "PROCESSED");
});

test("invalid HMAC creates no webhook event row", async () => {
  const store = eventStore(); const signed = envelope({ id: "evt_invalid" });
  signed.headers["flutterwave-signature"] = "invalid";
  assert.equal(await payment.recordWebhookFailure({ ...signed, executor: store }), false);
  assert.equal(store.events.size, 0); assert.equal(store.queryCount, 0);
});

test("unknown reference failure does not poison a corrected retry of the same event ID", async () => {
  const store = eventStore();
  await payment.recordWebhookFailure({ ...envelope({ id: "evt_corrected", reference: "PAY-UNKNOWN" }), executor: store });
  const corrected = envelope({ id: "evt_corrected", reference: "PAY-CORRECT" });
  const verified = payment.readVerifiedWebhookEnvelope(corrected);
  const retry = await payment.claimWebhookEvent({ eventId: verified.eventId, payloadHash: verified.payloadHash, executor: store });
  assert.equal(retry.retry, true);
  await payment.markWebhookProcessed({ eventRecordId: retry.event.id, paymentId: 45, executor: store });
  assert.equal(store.events.get("evt_corrected").payload_hash, verified.payloadHash);
  assert.equal(store.events.get("evt_corrected").processing_status, "PROCESSED");
});

test("controller transaction rolls back failures and PostgreSQL claim takes a row lock", () => {
  const controller = fs.readFileSync(path.join(__dirname, "../controllers/paymentController.js"), "utf8");
  const service = fs.readFileSync(path.join(__dirname, "../services/paymentService.js"), "utf8");
  assert.match(controller, /BEGIN/); assert.match(controller, /ROLLBACK/); assert.match(controller, /recordWebhookFailure/);
  assert.match(service, /FOR UPDATE/); assert.match(service, /processing_status === "PROCESSED"/);
});

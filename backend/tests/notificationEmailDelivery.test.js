const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {deliverOne,renderNotificationEmail}=require('../services/notificationEmailService');

const row={id:4,notification_id:9,recipient_user_id:7,recipient:'officer@example.test',attempt_count:1,public_reference:'NTF-2026-ABC123',title:'Cargo approved',message:'Cargo CARGO-1 is ready for the next action.',related_module:'Cargo',priority:'high',notification_created_at:'2026-09-06T10:00:00Z',full_name:'Asha Ali'};
const harness=({sendError=null}={})=>{
  const queries=[];
  const client={query:async(sql)=>{queries.push(sql);if(sql.includes('RETURNING d.*'))return{rows:[{id:4}],rowCount:1};return{rows:[],rowCount:0}},release(){}};
  const executor={query:async(sql)=>{queries.push(sql);if(sql.includes('FROM notification_email_deliveries d JOIN notifications'))return{rows:[row],rowCount:1};return{rows:[],rowCount:1}}};
  const sent=[];
  const transportFactory=()=>({sendMail:async(message)=>{sent.push(message);if(sendError)throw sendError;}});
  return{queries,executor,pool:{connect:async()=>client},sent,transportFactory};
};

test('notification email includes the in-app title, message and recipient context',()=>{
  const email=renderNotificationEmail(row);
  assert.match(email.subject,/Cargo approved/);
  assert.match(email.text,/Asha Ali/);
  assert.match(email.text,/Cargo CARGO-1 is ready/);
  assert.match(email.text,/NTF-2026-ABC123/);
});

test('successful notification email delivery is marked sent',async(t)=>{
  process.env.EMAIL_PROVIDER='smtp';process.env.SMTP_HOST='smtp.test';process.env.SMTP_USER='user';process.env.SMTP_PASSWORD='pass';process.env.EMAIL_FROM='wms@example.test';
  t.mock.method(require('../models/adminModel'),'writeAuditLog',async()=>{});
  const h=harness();const result=await deliverOne(h);
  assert.equal(result.status,'SENT');assert.equal(h.sent[0].to,'officer@example.test');
  assert.ok(h.queries.some(sql=>sql.includes("delivery_status='SENT'")));
});

test('SMTP failure keeps the delivery retryable and records failure',async(t)=>{
  process.env.EMAIL_PROVIDER='smtp';process.env.SMTP_HOST='smtp.test';process.env.SMTP_USER='user';process.env.SMTP_PASSWORD='pass';process.env.EMAIL_FROM='wms@example.test';
  t.mock.method(require('../models/adminModel'),'writeAuditLog',async()=>{});
  const h=harness({sendError:new Error('temporary smtp failure')});const result=await deliverOne(h);
  assert.equal(result.status,'FAILED');
  assert.ok(h.queries.some(sql=>sql.includes("delivery_status='FAILED'")));
});

test('migration transactionally queues one email per user notification',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../database/migrations/20260906_notification_email_outbox.sql'),'utf8');
  assert.match(sql,/AFTER INSERT ON notifications/);
  assert.match(sql,/UNIQUE REFERENCES notifications/);
  assert.match(sql,/recipient_user_id IS NULL/);
});

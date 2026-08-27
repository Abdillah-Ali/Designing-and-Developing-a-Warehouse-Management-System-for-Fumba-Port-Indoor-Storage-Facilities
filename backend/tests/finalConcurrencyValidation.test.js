const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const API = process.env.FPWMS_VALIDATION_API || "http://127.0.0.1:5000/api";
// The API defaults to the Docker-published service.  Its fixture connection
// must target that same database, not an unrelated local PostgreSQL instance.
const db = { pool: new Pool({
  host: process.env.FPWMS_VALIDATION_DB_HOST || "127.0.0.1",
  port: Number(process.env.FPWMS_VALIDATION_DB_PORT || 5433),
  database: process.env.FPWMS_VALIDATION_DB_NAME || process.env.POSTGRES_DB || process.env.DB_NAME || "fumbaport_wms",
  user: process.env.FPWMS_VALIDATION_DB_USER || process.env.POSTGRES_USER || process.env.DB_USER || "postgres",
  password: process.env.FPWMS_VALIDATION_DB_PASSWORD || process.env.POSTGRES_PASSWORD || process.env.DB_PASSWORD
}) };
const PREFIX = `FPWMS-VAL-CONC-${Date.now()}-${process.pid}`;
const SHORT_TAG = String(Date.now()).slice(-5);
const FIXTURE_PASSWORD = `Validation!${crypto.randomBytes(18).toString("hex")}`;
const ids = { cargo: [], bins: [], users: [], warehouse: null, tariff: null, tariffVersion: null, cargoOption:null, shift: null };
const evidence = [];

// This live validation file owns its PostgreSQL pool. Close it even when an
// assertion fails so the full node:test suite can report the failure and exit.
test.after(async () => { await db.pool.end().catch(() => {}); });

const request = async (method, path, token, body) => {
  const startedAt = new Date();
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  return { status: response.status, payload, startedAt, finishedAt: new Date() };
};

const race = async (...operations) => {
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const pending = operations.map((operation) => (async () => { await barrier; return operation(); })());
  release();
  return Promise.all(pending);
};

const q = (sql, values = []) => db.pool.query(sql, values);
const scalar = async (sql, values = []) => (await q(sql, values)).rows[0];

const createCargo = async (suffix, userId, overrides = {}) => {
  const ref = `${PREFIX}-${suffix}`;
  const values = {
    registration_status: "Approved", placement_status: "Unplaced", customs_status: "Pending Inspection",
    customs_status_key: "pending_inspection", financial_status: "Unbilled", dispatch_status: "Not Requested",
    gate_out_status: "Not Released", current_bin_id: null, location: null, charge_start_at: new Date(Date.now() - 48 * 3600_000),
    weight: 10, volume: 1, ...overrides
  };
  const row = (await q(`INSERT INTO cargo
    (cargo_id,barcode,reference_number,consignee_name,cargo_type,cargo_type_key,weight,volume,status,workflow_status,
     registration_status,placement_status,customs_status,customs_status_key,financial_status,dispatch_status,gate_out_status,
     warehouse_id,warehouse_id_at_registration,created_by,assigned_staff_id,received_by_user_id,current_bin_id,location,charge_start_at)
    VALUES ($1,$1,$1,$2,'Validation Goods','validation_goods',$3,$4,'Approved','Approved',$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$13,$13,$14,$15,$16)
    RETURNING *`, [ref, `${PREFIX} Consignee`, values.weight, values.volume, values.registration_status,
      values.placement_status, values.customs_status, values.customs_status_key, values.financial_status,
      values.dispatch_status, values.gate_out_status, ids.warehouse, userId, values.current_bin_id,
      values.location, values.charge_start_at])).rows[0];
  ids.cargo.push(row.id);
  if (values.current_bin_id) {
    await q("INSERT INTO cargo_locations(cargo_id,bin_id,location,is_current,assigned_by) VALUES($1,$2,$3,TRUE,$4)", [row.id, values.current_bin_id, values.location, userId]);
  }
  return row;
};

const login = async (username) => {
  const response = await request("POST", "/auth/login", null, { username, password: FIXTURE_PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.payload));
  return response.payload.data.access_token;
};

const createBin = async (levelId, suffix, maxWeight = 15) => {
  const barcode = `FPWMS-VAL-${SHORT_TAG}-${suffix.slice(0, 3)}`;
  const row = (await q(`INSERT INTO bins(level_id,code,barcode,status,max_weight,max_volume,current_weight,current_volume,active,bin_identifier,name,bin_type,weight_capacity,volume_capacity,operational_status)
    VALUES($1,$2,$3,'Available',$4,10,0,0,TRUE,$3,$2,'Standard',$4,10,'Available') RETURNING *`,
  [levelId, `B-${suffix}`, barcode, maxWeight])).rows[0];
  ids.bins.push(row.id);
  return row;
};

const addPlacedFixture = async (suffix, staffId, bin) => {
  const location = `${PREFIX} / ${bin.code}`;
  const cargo = await createCargo(suffix, staffId, {
    placement_status: "Placed", customs_status: "Cleared", customs_status_key: "cleared",
    financial_status: "Unbilled", dispatch_status: "Approved", current_bin_id: bin.id, location,
    charge_start_at: new Date(Date.now() - 48 * 3600_000)
  });
  await q("UPDATE bins SET current_weight=current_weight+$1,current_volume=current_volume+$2,status='Occupied' WHERE id=$3", [cargo.weight, cargo.volume, bin.id]);
  const dispatch = (await q("INSERT INTO dispatch_requests(cargo_id,requested_by,status,decided_at,decided_by) VALUES($1,$2,'Approved',CURRENT_TIMESTAMP,$2) RETURNING *", [cargo.id, staffId])).rows[0];
  return { cargo, dispatch };
};

const financiallyClear = async (cargo, suffix, token) => {
  const drafted = await request("POST", "/finance/invoices/draft", token, { cargo_reference:cargo.cargo_id, billing_period_end:new Date().toISOString() });
  assert.equal(drafted.status, 201, JSON.stringify(drafted));
  const invoiceNumber = drafted.payload.data.invoice_number;
  const issued = await request("POST", `/finance/invoices/${invoiceNumber}/issue`, token, {});
  assert.equal(issued.status, 200, JSON.stringify(issued));
  const invoice = await scalar("SELECT total_amount::text FROM invoices WHERE public_invoice_number=$1", [invoiceNumber]);
  const recorded = await request("POST", "/finance/payments", token, { invoice_number:invoiceNumber, amount:invoice.total_amount, bank_name:"Validation Bank", bank_reference:`FPWMS-VAL-${SHORT_TAG}-BANK-${suffix}`, payment_date:new Date().toISOString() });
  assert.equal(recorded.status, 201, JSON.stringify(recorded));
  const confirmed = await request("POST", `/finance/payments/${recorded.payload.data.payment_reference}/confirm`, token, {});
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed));
};

test("final validation closure executes real authenticated HTTP races and Gate rollback", { timeout: 120_000 }, async (t) => {
  try {
    const health = await request("GET", "/health");
    if (health.status !== 200) return t.skip("Live backend/PostgreSQL validation environment is unavailable.");

    const passwordHash = await bcrypt.hash(FIXTURE_PASSWORD, 10);
    const warehouseLetter=(await scalar(`SELECT chr(code) AS letter FROM generate_series(65,90) code WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE warehouse_letter=chr(code)) ORDER BY code LIMIT 1`)).letter;
    const warehouse = (await q(`INSERT INTO warehouses(warehouse_name,warehouse_code,status,warehouse_letter,total_capacity,max_volume)
      VALUES($1,$2,'active',$3,1000,100) RETURNING *`, [`${PREFIX} Warehouse`, `VC${String(Date.now()).slice(-6)}`, warehouseLetter])).rows[0];
    ids.warehouse = warehouse.id;
    const shortCode = String(Date.now()).slice(-6);
    const zone = (await q(`INSERT INTO zones(code,name,zone_type,allowed_cargo_type,max_weight,max_volume,warehouse_id,zone_letter)
      VALUES($1,$2,'Standard','Validation Goods',1000,100,$3,'V') RETURNING *`, [`ZV${shortCode}`, `${PREFIX} Zone`, warehouse.id])).rows[0];
    const rack = (await q("INSERT INTO racks(zone_id,code,name,max_weight,max_volume,rack_letter) VALUES($1,$2,$3,1000,100,'V') RETURNING *", [zone.id, `RV${shortCode}`, `${PREFIX} Rack`])).rows[0];
    const level = (await q("INSERT INTO levels(rack_id,code,level_number,max_weight,max_volume,name) VALUES($1,$2,1,1000,100,$3) RETURNING *", [rack.id, `LV${shortCode}`, `${PREFIX} Level`])).rows[0];
    const binCapacity = await createBin(level.id, "CAP", 15);
    const binA = await createBin(level.id, "A", 100);
    const binB = await createBin(level.id, "B", 100);
    const binGate = await createBin(level.id, "GATE", 100);
    const binRollback = await createBin(level.id, "ROLLBACK", 100);
    const binRelocateFrom = await createBin(level.id, "RF", 100);
    const binRelocateTo = await createBin(level.id, "RT", 100);
    const binGateSingle = await createBin(level.id, "GS", 100);

    const roles = (await q("SELECT id,role_key FROM roles WHERE role_key=ANY($1)", [["system_administrator","warehouse_staff","warehouse_supervisor","finance_officer","customs_officer","gate_officer"]])).rows;
    const roleId = Object.fromEntries(roles.map((row) => [row.role_key, row.id]));
    const users = {};
    for (const roleKey of Object.keys(roleId)) {
      const username = `${PREFIX}-${roleKey}`.toLowerCase();
      const user = (await q(`INSERT INTO users(full_name,username,email,phone_number,password_hash,role_id,warehouse_id,status,must_change_password)
        VALUES($1,$2,$3,$4,$5,$6,$7,'active',FALSE) RETURNING *`,
      [`${PREFIX} ${roleKey}`, username, `${username}@validation.invalid`, `+2559${String(Date.now()).slice(-8)}`, passwordHash, roleId[roleKey], warehouse.id])).rows[0];
      ids.users.push(user.id); users[roleKey] = { ...user, token: await login(username) };
    }
    const cargoOption=(await q(`INSERT INTO cargo_option_values(catalog_key,option_key,storage_value,display_label,sort_order,is_active,is_system_protected,updated_by)
      VALUES('cargo_type','validation_goods','Validation Goods','Validation Goods',999,TRUE,FALSE,$1) RETURNING id`,[users.system_administrator.id])).rows[0];
    ids.cargoOption=cargoOption.id;

    const shift = (await q(`INSERT INTO shifts(shift_name,shift_code,public_reference,start_time,end_time,status)
      VALUES($1,$2,$3,'00:00','23:59','active') RETURNING *`,
      [`${PREFIX} Shift`, `S${shortCode}`, `SHIFT-${PREFIX}`])).rows[0];
    ids.shift = shift.id;
    await q("UPDATE users SET shift_id=$1 WHERE id=$2", [shift.id, users.warehouse_staff.id]);

    const tariff = (await q("INSERT INTO tariffs(public_reference,tariff_name,cargo_type,charging_unit,created_by) VALUES($1,$2,'Validation Goods','per_cargo_per_day',$3) RETURNING *", [`${PREFIX}-TRF`, `${PREFIX} Tariff`, users.finance_officer.id])).rows[0];
    ids.tariff = tariff.id;
    const tariffVersion = (await q(`INSERT INTO tariff_versions(public_reference,tariff_id,version_number,cargo_type,charging_unit,daily_rate,currency,minimum_billable_days,effective_from,is_active,created_by,activated_by,activated_at,cargo_type_key,tariff_scope,configuration_status,approval_status,approved_by,approved_at)
      VALUES($1,$2,1,'Validation Goods','per_cargo_per_day',100,'TZS',1,CURRENT_TIMESTAMP-INTERVAL '30 days',TRUE,$3,$3,CURRENT_TIMESTAMP,'validation_goods','cargo_type','ready','APPROVED',$3,CURRENT_TIMESTAMP) RETURNING *`,
    [`${PREFIX}-TRV`, tariff.id, users.finance_officer.id])).rows[0];
    ids.tariffVersion = tariffVersion.id;

    const placementRules = [
      ["capacity_limits", "block", "critical", 10, { enforce_weight: true, enforce_volume: true }],
      ["cargo_storage_compatibility", "block", "critical", 20, {}],
      ["hazard_zone_compatibility", "block", "critical", 30, { hazardous_cargo_type_key: "hazardous_cargo" }],
      ["storage_status", "block", "critical", 40, { allowed_statuses: ["Available", "Occupied"] }],
      ["reserved_storage", "block", "high", 50, {}],
      ["restricted_zone_approval", "supervisor_approval", "high", 60, { restricted_zone_type: "Restricted" }],
      ["customs_hold_storage", "block", "high", 70, { hold_marker: "hold", storage_marker: "customs hold" }],
      ["fragile_handling", "block", "high", 80, { cargo_type_key: "fragile_goods", handling_marker: "fragile" }]
    ];
    for (const [evaluator_type, violation_action, severity, priority, parameters] of placementRules) {
      await q(`INSERT INTO bin_rules (public_reference, rule_key, rule_name, rule_type, evaluator_type, execution_targets, violation_action, severity, priority, is_active, parameters, created_by)
        VALUES ($1, $2, $3, 'validation', $4, ARRAY['placement_recommendation','placement_confirmation','relocation']::text[], $5, $6, $7, TRUE, $8::jsonb, $9)
        ON CONFLICT DO NOTHING`,
        [`${PREFIX}-BR-${evaluator_type}`, `${PREFIX}_${evaluator_type}`, `${PREFIX} ${evaluator_type}`, evaluator_type, violation_action, severity, priority, JSON.stringify(parameters), users.warehouse_staff.id]);
    }


    await t.test("C01 competing capacity", async () => {
      const a = await createCargo("C01-A", users.warehouse_staff.id);
      const b = await createCargo("C01-B", users.warehouse_staff.id);
      const payload = (cargo) => ({ cargo_id: cargo.cargo_id, placement_mode: "scan", scanned_cargo_barcode: cargo.barcode, scanned_bin_barcode: binCapacity.barcode });
      const results = await race(
        () => request("POST", "/placement/confirm", users.warehouse_staff.token, payload(a)),
        () => request("POST", "/placement/confirm", users.warehouse_staff.token, payload(b))
      );
      assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results));
      assert.equal(results.filter((r) => r.status >= 400).length, 1, JSON.stringify(results));
      const state = await scalar("SELECT current_weight,current_volume,max_weight,max_volume FROM bins WHERE id=$1", [binCapacity.id]);
      const placed = await scalar("SELECT count(*)::int n FROM cargo WHERE id=ANY($1) AND current_bin_id=$2", [[a.id,b.id],binCapacity.id]);
      assert.ok(Number(state.current_weight) <= Number(state.max_weight)); assert.equal(placed.n, 1);
      evidence.push({ id: "C01", results, state });
    });

    await t.test("C02 same cargo double placement", async () => {
      const cargo = await createCargo("C02", users.warehouse_staff.id);
      const body = (bin) => ({ cargo_id:cargo.cargo_id,placement_mode:"scan",scanned_cargo_barcode:cargo.barcode,scanned_bin_barcode:bin.barcode });
      const results = await race(() => request("POST","/placement/confirm",users.warehouse_staff.token,body(binA)), () => request("POST","/placement/confirm",users.warehouse_staff.token,body(binB)));
      assert.equal(results.filter((r)=>r.status===200).length,1,JSON.stringify(results));
      const state = await scalar("SELECT count(*)::int current_locations FROM cargo_locations WHERE cargo_id=$1 AND is_current",[cargo.id]);
      const moves = await scalar("SELECT count(*)::int n FROM cargo_movements WHERE cargo_id=$1 AND action IN ('Placed','Relocated')",[cargo.id]);
      assert.equal(state.current_locations,1); assert.equal(moves.n,1);
      evidence.push({id:"C02",results,state,moves});
    });

    await t.test("explicit relocation remains valid", async () => {
      const location = `${PREFIX} / ${binRelocateFrom.code}`;
      const cargo = await createCargo("R", users.warehouse_staff.id, { placement_status:"Placed", current_bin_id:binRelocateFrom.id, location });
      await q("UPDATE bins SET current_weight=$1,current_volume=$2,status='Occupied' WHERE id=$3", [cargo.weight,cargo.volume,binRelocateFrom.id]);
      const result = await request("POST", "/placement/confirm", users.warehouse_staff.token, {
        cargo_id:cargo.cargo_id, placement_mode:"scan", operation_type:"relocation",
        scanned_cargo_barcode:cargo.barcode, scanned_bin_barcode:binRelocateTo.barcode
      });
      assert.equal(result.status,200,JSON.stringify(result));
      const state=await scalar("SELECT placement_status,current_bin_id FROM cargo WHERE id=$1",[cargo.id]);
      const moves=await scalar("SELECT count(*)::int n FROM cargo_movements WHERE cargo_id=$1 AND action='Relocated'",[cargo.id]);
      assert.equal(state.current_bin_id,binRelocateTo.id); assert.equal(state.placement_status,"Relocated"); assert.equal(moves.n,1);
    });

    let invoiceFixture;
    await t.test("C03 duplicate invoice period", async () => {
      const cargo = await createCargo("C03", users.warehouse_staff.id, { charge_start_at:new Date(Date.now()-48*3600_000) });
      const end = new Date().toISOString();
      const results = await race(() => request("POST","/finance/invoices/draft",users.system_administrator.token,{cargo_reference:cargo.cargo_id,billing_period_end:end}), () => request("POST","/finance/invoices/draft",users.system_administrator.token,{cargo_reference:cargo.cargo_id,billing_period_end:end}));
      const state = await scalar("SELECT count(*)::int invoice_count,coalesce(sum(total_amount),0)::text obligation FROM invoices WHERE cargo_id=$1 AND status<>'Cancelled'",[cargo.id]);
      const audits = await scalar("SELECT count(*)::int n FROM audit_logs WHERE metadata->>'cargo_reference'=$1 AND action IN ('GENERATE_DRAFT_INVOICE','REGENERATE_DRAFT_INVOICE')",[cargo.cargo_id]);
      invoiceFixture = { cargo, invoiceNumber:results.find((r)=>r.status===201)?.payload?.data?.invoice_number };
      assert.equal(state.invoice_count,1); assert.equal(results.filter((r)=>r.status===201).length,1,`Concurrent duplicate invoice returned two successes: ${JSON.stringify(results)}`); assert.equal(results.filter((r)=>r.status===409).length,1,`Duplicate invoice loser did not return conflict: ${JSON.stringify(results)}`); assert.equal(audits.n,1);
      evidence.push({id:"C03",results,state,audits});
    });

    await t.test("C04 double payment confirmation", async () => {
      assert.ok(invoiceFixture?.invoiceNumber);
      await request("POST",`/finance/invoices/${invoiceFixture.invoiceNumber}/issue`,users.system_administrator.token,{});
      const invoice = await scalar("SELECT * FROM invoices WHERE public_invoice_number=$1",[invoiceFixture.invoiceNumber]);
      const recorded = await request("POST","/finance/payments",users.system_administrator.token,{invoice_number:invoiceFixture.invoiceNumber,amount:invoice.total_amount,bank_name:"Validation Bank",bank_reference:`${PREFIX}-BANK-C04`,payment_date:new Date().toISOString()});
      assert.equal(recorded.status,201,JSON.stringify(recorded));
      const ref=recorded.payload.data.payment_reference;
      const results=await race(()=>request("POST",`/finance/payments/${ref}/confirm`,users.system_administrator.token,{}),()=>request("POST",`/finance/payments/${ref}/confirm`,users.system_administrator.token,{}));
      const state=await scalar("SELECT p.status,p.confirmed_at,i.amount_paid::text,i.outstanding_balance::text FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.public_reference=$1",[ref]);
      const audits=await scalar("SELECT count(*)::int n FROM audit_logs WHERE action='CONFIRM_PAYMENT' AND metadata->>'entity_reference'=$1",[ref]);
      assert.equal(state.status,"Confirmed"); assert.equal(Number(state.amount_paid),Number(invoice.total_amount)); assert.equal(Number(state.outstanding_balance),0); assert.equal(audits.n,1);
      evidence.push({id:"C04",results,state,audits});
    });

    await t.test("C05 Customs conflicting decisions", async () => {
      const cargo=await createCargo("C05",users.warehouse_staff.id);
      const results=await race(()=>request("POST",`/customs/cargo/${cargo.cargo_id}/status`,users.customs_officer.token,{status:"Cleared",transition_key:"clear_customs",confirmed:true,expected_state_key:"pending_inspection"}),()=>request("POST",`/customs/cargo/${cargo.cargo_id}/status`,users.customs_officer.token,{status:"On Hold",transition_key:"place_on_hold",notes:"validation hold",expected_state_key:"pending_inspection"}));
      const state=await scalar("SELECT customs_status,customs_status_key FROM cargo WHERE id=$1",[cargo.id]);
      const history=await scalar("SELECT count(*)::int n FROM customs_status_history WHERE cargo_id=$1",[cargo.id]);
      assert.equal(results.filter((r)=>r.status===200).length,1,JSON.stringify(results)); assert.equal(history.n,1,JSON.stringify(results)); assert.ok(["Cleared","On Hold"].includes(state.customs_status),JSON.stringify(state));
      evidence.push({id:"C05",results,state,history});
    });

    await t.test("normal Customs actions remain executable", async () => {
      const actions=[
        {status:"Inspection In Progress",transition_key:"start_inspection"},
        {status:"Documents Required",transition_key:"request_documents",notes:"validation documents",documents_requested:"Validation manifest"},
        {status:"On Hold",transition_key:"place_on_hold",notes:"validation hold"},
        {status:"Cleared",transition_key:"clear_customs",confirmed:true},
        {status:"Rejected",transition_key:"reject_customs",notes:"validation rejection"}
      ];
      for(const [index,body] of actions.entries()) {
        const cargo=await createCargo(`U${index}`,users.warehouse_staff.id);
        const result=await request("POST",`/customs/cargo/${cargo.cargo_id}/status`,users.customs_officer.token,{...body,expected_state_key:"pending_inspection"});
        assert.equal(result.status,200,`${body.transition_key}: ${JSON.stringify(result)}`);
      }
    });

    await t.test("C06 Dispatch approve versus reject", async () => {
      const cargo=await createCargo("C06",users.warehouse_staff.id,{placement_status:"Placed"});
      const dispatch=(await q("INSERT INTO dispatch_requests(cargo_id,requested_by,status) VALUES($1,$2,'Pending') RETURNING *",[cargo.id,users.warehouse_staff.id])).rows[0];
      const results=await race(()=>request("POST",`/dispatch/authorization-requests/${dispatch.id}/approve`,users.warehouse_supervisor.token,{decision_notes:"validation approve"}),()=>request("POST",`/dispatch/authorization-requests/${dispatch.id}/reject`,users.warehouse_supervisor.token,{decision_notes:"validation reject"}));
      const state=await scalar("SELECT status,decided_by,decided_at FROM dispatch_requests WHERE id=$1",[dispatch.id]);
      const audits=await scalar("SELECT count(*)::int n FROM audit_logs WHERE metadata->>'dispatch_request_id'=$1 AND action IN ('APPROVE_DISPATCH_AUTHORIZATION','REJECT_DISPATCH_AUTHORIZATION')",[String(dispatch.id)]);
      assert.equal(results.filter((r)=>r.status===200).length,1,JSON.stringify(results)); assert.equal(audits.n,1); assert.ok(["Approved","Rejected"].includes(state.status));
      evidence.push({id:"C06",results,state,audits});
    });

    await t.test("C07 double Gate release", async () => {
      const fixture=await addPlacedFixture("C07",users.warehouse_staff.id,binGate);
      await financiallyClear(fixture.cargo,"C07",users.system_administrator.token);
      const body={vehicle_number:"VAL-001",driver_name:"Validation Driver",gate_notes:"concurrency validation"};
      const results=await race(()=>request("POST",`/gate/cargo/${fixture.cargo.cargo_id}/gate-out`,users.gate_officer.token,body),()=>request("POST",`/gate/cargo/${fixture.cargo.cargo_id}/gate-out`,users.gate_officer.token,body));
      const state=await scalar(`SELECT c.gate_out_status,c.released_at,c.charge_end_at,c.current_bin_id,b.current_weight::text,b.current_volume::text,
        (SELECT count(*)::int FROM gate_out_records WHERE cargo_id=c.id) gate_count,
        (SELECT count(*)::int FROM cargo_movements WHERE cargo_id=c.id AND action='Released') release_moves,
        (SELECT count(*)::int FROM audit_logs WHERE action='CONFIRM_GATE_OUT' AND metadata->>'cargo_reference'=c.cargo_id) success_audits
        FROM cargo c JOIN bins b ON b.id=$2 WHERE c.id=$1`,[fixture.cargo.id,binGate.id]);
      assert.equal(results.filter((r)=>r.status===201).length,1,JSON.stringify(results)); assert.equal(state.gate_count,1); assert.equal(state.release_moves,1); assert.equal(state.success_audits,1); assert.equal(Number(state.current_weight),0); assert.equal(state.current_bin_id,null);
      evidence.push({id:"C07",results,state});
    });

    await t.test("single normal Gate release succeeds", async () => {
      const fixture=await addPlacedFixture("GS",users.warehouse_staff.id,binGateSingle);
      await financiallyClear(fixture.cargo,"GS",users.system_administrator.token);
      const result=await request("POST",`/gate/cargo/${fixture.cargo.cargo_id}/gate-out`,users.gate_officer.token,{vehicle_number:"VAL-SINGLE",driver_name:"Single Gate Driver"});
      assert.equal(result.status,201,JSON.stringify(result));
      const state=await scalar("SELECT gate_out_status,placement_status,released_at,charge_end_at,current_bin_id FROM cargo WHERE id=$1",[fixture.cargo.id]);
      assert.equal(state.gate_out_status,"Released"); assert.equal(state.placement_status,"Dispatched"); assert.ok(state.released_at); assert.ok(state.charge_end_at); assert.equal(state.current_bin_id,null);
    });

    await t.test("T01 Gate injected rollback", async () => {
      const fixture=await addPlacedFixture("T01",users.warehouse_staff.id,binRollback);
      await financiallyClear(fixture.cargo,"T01",users.system_administrator.token);
      const fn=`fpwms_val_fail_${Date.now()}_${process.pid}`.replace(/[^a-zA-Z0-9_]/g,"_");
      try {
        await q(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.cargo_id=${Number(fixture.cargo.id)} THEN RAISE EXCEPTION 'FPWMS validation injected Gate failure'; END IF; RETURN NEW; END $$`);
        await q(`CREATE TRIGGER ${fn}_trg BEFORE INSERT ON gate_out_records FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
        const result=await request("POST",`/gate/cargo/${fixture.cargo.cargo_id}/gate-out`,users.gate_officer.token,{vehicle_number:"VAL-ROLLBACK",driver_name:"Rollback Driver"});
        assert.ok(result.status>=500,JSON.stringify(result));
        const state=await scalar(`SELECT c.gate_out_status,c.released_at,c.charge_end_at,c.current_bin_id,c.placement_status,b.current_weight::text,b.current_volume::text,dr.gate_released_at,
          (SELECT count(*)::int FROM gate_out_records WHERE cargo_id=c.id) gate_count,
          (SELECT count(*)::int FROM cargo_movements WHERE cargo_id=c.id AND action='Released') release_moves,
          (SELECT count(*)::int FROM audit_logs WHERE action='CONFIRM_GATE_OUT' AND metadata->>'cargo_reference'=c.cargo_id) success_audits
          FROM cargo c JOIN bins b ON b.id=$2 JOIN dispatch_requests dr ON dr.cargo_id=c.id WHERE c.id=$1`,[fixture.cargo.id,binRollback.id]);
        assert.equal(state.gate_out_status,"Not Released"); assert.equal(state.released_at,null); assert.equal(state.charge_end_at,null); assert.equal(state.current_bin_id,binRollback.id); assert.equal(state.placement_status,"Placed"); assert.equal(state.gate_released_at,null); assert.equal(state.gate_count,0); assert.equal(state.release_moves,0); assert.equal(state.success_audits,0); assert.equal(Number(state.current_weight),10);
        evidence.push({id:"T01",results:[result],state});
      } finally {
        await q(`DROP TRIGGER IF EXISTS ${fn}_trg ON gate_out_records`);
        await q(`DROP FUNCTION IF EXISTS ${fn}()`);
      }
    });

  } finally {
    if (ids.cargo.length) {
      await q("DELETE FROM notifications WHERE subject_reference IN (SELECT cargo_id FROM cargo WHERE id=ANY($1))",[ids.cargo]);
      await q("DELETE FROM audit_logs WHERE metadata::text LIKE $1 OR description LIKE $1",[`%${PREFIX}%`]);
      await q("DELETE FROM placement_validation_logs WHERE cargo_id=ANY($1) OR cargo_barcode LIKE $2 OR bin_barcode LIKE $2",[ids.cargo,`${PREFIX}%`]);
      await q("DELETE FROM workflow_transition_history WHERE entity_reference IN (SELECT cargo_id FROM cargo WHERE id=ANY($1))",[ids.cargo]);
      await q("DELETE FROM customs_status_history WHERE cargo_id=ANY($1)",[ids.cargo]);
      await q("DELETE FROM customs_records WHERE cargo_id=ANY($1)",[ids.cargo]);
      await q("DELETE FROM gate_out_records WHERE cargo_id=ANY($1)",[ids.cargo]);
      await q("DELETE FROM cargo_movements WHERE cargo_id=ANY($1)",[ids.cargo]);
      await q("DELETE FROM cargo_locations WHERE cargo_id=ANY($1)",[ids.cargo]);
      await q("DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE cargo_id=ANY($1))",[ids.cargo]);
      await q("DELETE FROM payment_email_deliveries WHERE invoice_id IN (SELECT id FROM invoices WHERE cargo_id=ANY($1))",[ids.cargo]);
      await q("DELETE FROM invoice_line_items WHERE invoice_id IN (SELECT id FROM invoices WHERE cargo_id=ANY($1))",[ids.cargo]);
      await q("DELETE FROM invoices WHERE cargo_id=ANY($1)",[ids.cargo]);
      await q("DELETE FROM dispatch_requests WHERE cargo_id=ANY($1)",[ids.cargo]);
      await q("DELETE FROM cargo WHERE id=ANY($1)",[ids.cargo]);
    }
    if (ids.tariffVersion) await q("DELETE FROM tariff_versions WHERE id=$1",[ids.tariffVersion]);
    if (ids.tariff) await q("DELETE FROM tariffs WHERE id=$1",[ids.tariff]);
    if (ids.cargoOption) await q("DELETE FROM cargo_option_values WHERE id=$1",[ids.cargoOption]);
    if (ids.users.length) {
      await q("DELETE FROM session_refresh_tokens WHERE session_id IN (SELECT id FROM user_sessions WHERE user_id=ANY($1))",[ids.users]);
      await q("DELETE FROM user_sessions WHERE user_id=ANY($1)",[ids.users]);
      await q("DELETE FROM audit_logs WHERE user_id=ANY($1) OR target_user_id=ANY($1)",[ids.users]);
      await q("DELETE FROM users WHERE id=ANY($1)",[ids.users]);
    }
    if (ids.shift) await q("DELETE FROM shifts WHERE id=$1",[ids.shift]);
    if (ids.warehouse) {
      await q("DELETE FROM bins WHERE level_id IN (SELECT l.id FROM levels l JOIN racks r ON r.id=l.rack_id JOIN zones z ON z.id=r.zone_id WHERE z.warehouse_id=$1)",[ids.warehouse]);
      await q("DELETE FROM levels WHERE rack_id IN (SELECT r.id FROM racks r JOIN zones z ON z.id=r.zone_id WHERE z.warehouse_id=$1)",[ids.warehouse]);
      await q("DELETE FROM racks WHERE zone_id IN (SELECT id FROM zones WHERE warehouse_id=$1)",[ids.warehouse]);
      await q("DELETE FROM zones WHERE warehouse_id=$1",[ids.warehouse]);
      await q("DELETE FROM warehouses WHERE id=$1",[ids.warehouse]);
    }
  }
});

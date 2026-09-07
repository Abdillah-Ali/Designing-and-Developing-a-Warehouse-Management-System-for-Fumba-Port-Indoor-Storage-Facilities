const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const { isRolePermissionAllowed: allowed } = require('../config/rolePermissionPolicy');
const { loadRolePermissions, getRolePermissions } = require('../services/permissionService');
const { updateAdminRolePermissions } = require('../controllers/permissionController');

test('built-in role duties separate registration, release requests, decisions, and finance', () => {
  for (const role of ['gate_officer', 'customs_officer', 'finance_officer', 'management', 'auditor', 'scanner', 'warehouse_supervisor', 'system_administrator']) {
    assert.equal(allowed(role, 'cargo.register'), false, role);
  }
  assert.equal(allowed('warehouse_staff', 'cargo.register'), true);
  assert.equal(allowed('gate_officer', 'gate.gate_out.confirm'), true);
  assert.equal(allowed('gate_officer', 'gate.emergency_release.request'), true);
  assert.equal(allowed('gate_officer', 'gate.emergency_release.approve'), false);
  assert.equal(allowed('warehouse_supervisor', 'gate.emergency_release.approve'), true);
  assert.equal(allowed('management', 'management.tariffs.decide'), true);
  assert.equal(allowed('finance_officer', 'management.tariffs.decide'), false);
  assert.equal(allowed('finance_officer', 'finance.payments.confirm'), false);
  assert.equal(allowed('auditor', 'cargo.approve'), false);
});

test('previously saved incompatible grants do not authorize an active Gate Officer session', async () => {
  const executor = { query: async () => ({ rows: ['cargo.register', 'gate.gate_out.confirm'].map(permission_key => ({ role_key: 'gate_officer', permission_key })) }) };
  assert.deepEqual(await loadRolePermissions(3, executor), ['gate.gate_out.confirm']);
});

test('role settings expose the same assignment limits used by authorization', async () => {
  const executor = { query: async sql => sql.includes('FROM roles r')
    ? { rowCount: 1, rows: [{ role_key: 'gate_officer', permission_keys: ['cargo.register'] }] }
    : { rows: [{ permission_key: 'cargo.register' }, { permission_key: 'gate.gate_out.confirm' }] } };
  const result = await getRolePermissions('ROLE-GATE', executor);
  assert.deepEqual(result.rows[0].assignable_permission_keys, ['gate.gate_out.confirm']);
  assert.deepEqual(result.rows[0].permission_keys, ['cargo.register']);
});

async function saveRole(t, roleKey, requested, existing = []) {
  const queries = [];
  const catalog = [...new Set([...requested, ...existing])].map(permission_key => ({ permission_key, system_protected: false }));
  const role = { id: 3, role_key: roleKey, role_name: roleKey, public_reference: 'ROLE-3', permission_keys: requested };
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('FROM roles')) return { rowCount: 1, rows: [role] };
    if (sql.includes('FROM permissions')) return { rowCount: catalog.length, rows: catalog };
    if (sql.includes('SELECT permission_key FROM role_permissions')) return { rows: existing.map(permission_key => ({ permission_key })) };
    return { rowCount: 1, rows: [] };
  };
  t.mock.method(db.pool, 'connect', async () => ({ query, release() {} }));
  t.mock.method(db, 'query', query);
  let error, result;
  await updateAdminRolePermissions(
    { params: { publicReference: 'ROLE-3' }, body: { permission_keys: requested }, auth: { roleId: 1, userId: 1 } },
    { json: payload => { result = payload; } },
    failure => { error = failure; },
  );
  return { error, result, queries };
}

test('direct permission saves reject Gate Officer registration before writing assignments', async t => {
  const { error, queries } = await saveRole(t, 'gate_officer', ['cargo.register']);
  assert.match(error.message, /outside gate_officer's duties/);
  assert.ok(queries.some(q => q.sql === 'ROLLBACK'));
  assert.ok(!queries.some(q => q.sql.startsWith('DELETE FROM role_permissions')));
});

test('saving supported permissions removes old incompatible assignments and commits', async t => {
  const { error, result, queries } = await saveRole(t, 'gate_officer', ['gate.gate_out.confirm'], ['cargo.register']);
  assert.equal(error, undefined);
  assert.equal(result.success, true);
  assert.ok(queries.some(q => q.sql === 'COMMIT'));
  assert.deepEqual(queries.filter(q => q.sql.startsWith('INSERT INTO role_permissions')).map(q => q.params[1]), ['gate.gate_out.confirm']);
});

test('Management can save its supported tariff decision permission', async t => {
  const { error, result } = await saveRole(t, 'management', ['management.tariffs.decide']);
  assert.equal(error, undefined);
  assert.equal(result.success, true);
});

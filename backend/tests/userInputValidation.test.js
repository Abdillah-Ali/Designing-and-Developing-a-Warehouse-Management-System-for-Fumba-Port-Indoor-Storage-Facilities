const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../config/db");
const { createUser } = require("../controllers/adminController");

test("user creation rejects invalid input before inserting a user", async () => {
  const original = db.pool.connect;
  const statements = [];
  db.pool.connect = async () => ({
    query: async (sql) => { statements.push(sql); return {rows:[], rowCount:0}; },
    release() {}
  });
  const valid = {full_name:"Port Admin", username:"port.admin", email:"admin@example.com", phone_number:"0751234567", password:"Secure@123", role_id:1};
  try {
    for (const patch of [{email:"a@b..com"}, {phone_number:"1------1"}, {full_name:{name:"Admin"}}, {username:["admin"]}, {role_id:true}, {warehouse_id:[1]}, {shift_id:"1e0"}, {password:"Secure@123" + "a".repeat(72)}]) {
      let failure;
      await createUser({body:{...valid, ...patch}}, {}, (error) => { failure = error; });
      assert.equal(failure?.statusCode, 400);
    }
    assert.ok(!statements.some((sql) => sql.includes("INSERT INTO users")));
  } finally { db.pool.connect = original; }
});

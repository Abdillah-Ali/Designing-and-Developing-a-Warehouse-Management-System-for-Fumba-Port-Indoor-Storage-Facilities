const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../config/db");
const { createZone } = require("../controllers/zoneController");

const mockResponse = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
};

const withMockClient = async (handler, run) => {
  const originalConnect = db.pool.connect;
  const queries = [];
  let released = false;
  const client = {
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      return handler(sql, params);
    },
    release: () => {
      released = true;
    }
  };

  db.pool.connect = async () => client;
  try {
    await run({ queries, wasReleased: () => released });
  } finally {
    db.pool.connect = originalConnect;
  }
};

const callCreateZone = async (body) => {
  const req = {
    body,
    auth: { userId: 99, role: "system-admin" }
  };
  const res = mockResponse();
  let nextError = null;
  await createZone(req, res, (error) => {
    nextError = error;
  });
  return { res, nextError };
};

const successfulZoneHandler = (sql, params) => {
  if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
    return { rowCount: 0, rows: [] };
  }
  if (sql.includes("FROM warehouses WHERE id")) {
    return {
      rowCount: 1,
      rows: [{
        id: params[0],
        warehouse_code: "WH-A",
        status: "active",
        total_capacity: 10000,
        max_volume: 100
      }]
    };
  }
  if (sql.includes("SELECT id FROM zones")) {
    return { rowCount: 0, rows: [] };
  }
  if (sql.includes("INSERT INTO zones")) {
    return {
      rowCount: 1,
      rows: [{
        id: 7,
        zone_id: 7,
        code: params[0],
        zone_code: params[0],
        name: params[1],
        zone_name: params[1],
        zone_letter: params[2],
        is_hazard_zone: params[7],
        max_weight: params[8],
        max_volume: params[9],
        status: params[10],
        active: params[11],
        warehouse_id: params[12]
      }]
    };
  }
  if (sql.includes("INSERT INTO audit_logs")) {
    return { rowCount: 1, rows: [{ id: 1 }] };
  }
  throw new Error(`Unexpected query: ${sql}`);
};

test("createZone generates its code and hierarchy name from one zone letter", async () => {
  await withMockClient(successfulZoneHandler, async ({ queries, wasReleased }) => {
    const { res, nextError } = await callCreateZone({
      zone_letter: "a",
      allowed_cargo_type: "General Goods",
      warehouse_id: 3
    });

    assert.equal(nextError, null);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);

    const insert = queries.find((query) => query.sql.includes("INSERT INTO zones"));
    assert.ok(insert);
    assert.equal(insert.params[0], "Z-A");
    assert.equal(insert.params[1], "WH-A-Z-A");
    assert.equal(insert.params[2], "A");
    assert.equal(insert.params[7], false);
    assert.equal(insert.params[8], 10000);
    assert.equal(insert.params[9], 100);
    assert.equal(insert.params[11], true);
    assert.equal(insert.params[12], 3);
    assert.equal(wasReleased(), true);
  });
});

test("createZone accepts explicit hazard and capacity values", async () => {
  await withMockClient(successfulZoneHandler, async ({ queries }) => {
    const { res, nextError } = await callCreateZone({
      zone_letter: "g",
      zone_type: "Hazardous",
      allowed_cargo_type: "Hazardous Cargo",
      is_hazard_zone: "yes",
      max_weight: "1250.5",
      max_volume: "45.25",
      warehouse_id: 3
    });

    assert.equal(nextError, null);
    assert.equal(res.statusCode, 201);

    const insert = queries.find((query) => query.sql.includes("INSERT INTO zones"));
    assert.equal(insert.params[7], true);
    assert.equal(insert.params[8], 1250.5);
    assert.equal(insert.params[9], 45.25);
  });
});

test("createZone rejects invalid numeric capacity values", async () => {
  await withMockClient(successfulZoneHandler, async ({ queries }) => {
    const { nextError } = await callCreateZone({
      zone_letter: "B",
      allowed_cargo_type: "Electronics",
      max_weight: -1,
      warehouse_id: 3
    });

    assert.equal(nextError.statusCode, 400);
    assert.match(nextError.message, /greater than zero/i);
    assert.equal(queries.some((query) => query.sql.includes("INSERT INTO zones")), false);
    assert.equal(queries.some((query) => query.sql === "ROLLBACK"), true);
  });
});

test("createZone rejects invalid hazard flag values", async () => {
  await withMockClient(successfulZoneHandler, async ({ queries }) => {
    const { nextError } = await callCreateZone({
      zone_letter: "C",
      allowed_cargo_type: "Machinery",
      is_hazard_zone: "maybe",
      warehouse_id: 3
    });

    assert.equal(nextError.statusCode, 400);
    assert.match(nextError.message, /true or false/i);
    assert.equal(queries.some((query) => query.sql.includes("INSERT INTO zones")), false);
  });
});

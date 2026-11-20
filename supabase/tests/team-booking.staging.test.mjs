import assert from "node:assert/strict";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { test } from "node:test";

const api = new URL(process.env.API_URL ?? "http://127.0.0.1:54321");
const { ANON_KEY, SERVICE_ROLE_KEY } = process.env;
assert.ok(["127.0.0.1", "localhost"].includes(api.hostname), "Run destructive test fixtures against a disposable local Supabase stack");
assert.ok(ANON_KEY && SERVICE_ROLE_KEY, "Export local keys from supabase status -o env");

async function request(path, { key, token = key, method = "POST", body, prefer }) {
  const response = await fetch(new URL(path, api), {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

async function rest(path, { method = "GET", body } = {}) {
  const result = await request(`/rest/v1/${path}`, {
    key: SERVICE_ROLE_KEY, method, body, prefer: "return=representation",
  });
  assert.ok(result.status < 300, `Fixture ${method} ${path}: ${result.status} ${JSON.stringify(result.json)}`);
  return result.json;
}

async function insert(table, fields) {
  const [row] = await rest(table, { method: "POST", body: fields });
  return row;
}

function call(account, action, fields = {}) {
  return request("/functions/v1/mpr-api", { key: ANON_KEY, token: account.token, body: { action, ...fields } });
}

function adminUpdate(account, fields) {
  return request("/functions/v1/admin-update-user", { key: ANON_KEY, token: account.token, body: fields });
}

function expectStatus(result, status) {
  assert.equal(result.status, status, JSON.stringify(result.json));
  return result.json;
}

const prefix = `test_${randomUUID().slice(0, 8)}`;
async function account(suffix, role, permissions = [], mustChange = false) {
  const user = await insert("mpr_users", {
    username: `${prefix}_${suffix}`, full_name: suffix, role,
    password_hash: "unused fixture", must_change_password: mustChange,
  });
  const token = randomBytes(32).toString("base64url");
  await insert("mpr_sessions", {
    user_id: user.id, token_hash: createHash("sha256").update(token).digest("hex"),
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
  });
  if (permissions.length) {
    await rest("user_permissions", {
      method: "POST",
      body: permissions.map(([module, action]) => ({ user_id: user.id, module, action })),
    });
  }
  return { id: user.id, token };
}

test("team booking release checks against PostgreSQL and the Edge Functions", async t => {
  const admin = await account("admin", "admin");
  const team = await account("team", "staff", ["view", "create", "edit", "delete"].map(action => ["bookings", action]));
  const viewer = await account("viewer", "viewer", [["bookings", "view"], ["bookings", "create"], ["calendar", "view"]]);
  const calendarOnly = await account("calendar", "staff", [["calendar", "view"]]);
  const temporaryAdmin = await account("temporary", "admin", [], true);
  const venue = await insert("venues", { venue_name: prefix, timezone: "Asia/Kolkata" });
  const customerName = `${prefix} customer`;
  const customerId = expectStatus(await call(admin, "save-customer", {
    customer_name: customerName, customer_category_code: "individual", mobile: "0123456789",
  }), 200).data.id;

  function bookingFields(date, fields = {}) {
    return {
      venue_id: venue.id, customer_id: customerId, event_name: `${prefix} event`,
      start_date: date, end_date: date, booking_mode: "full_day", booking_status: "confirmed",
      notes: "Private booking notes", ...fields,
    };
  }
  const save = (actor, date, fields) => call(actor, "save-booking", bookingFields(date, fields));
  let raceWinner;

  await t.test("customer category validates the selected code, and booking search protects contact details", async () => {
    const [customer] = await rest(`customers?id=eq.${customerId}&select=customer_category_code`);
    assert.equal(customer.customer_category_code, "individual");
    expectStatus(await call(admin, "save-customer", {
      id: customerId, customer_name: customerName, customer_category_code: "company", mobile: "0123456789",
    }), 200);
    expectStatus(await call(admin, "save-customer", {
      id: customerId, customer_name: customerName, customer_category_code: "missing_category",
    }), 400);
    const [after] = await rest(`customers?id=eq.${customerId}&select=customer_category_code`);
    assert.equal(after.customer_category_code, "company");
    const { data } = expectStatus(await call(team, "list-booking-customers", { query: prefix }), 200);
    assert.equal(data[0].id, customerId);
    assert.equal(data[0].mobile, null);
    const contacts = expectStatus(await call(admin, "list-booking-customers", { query: "0123456789" }), 200);
    assert.ok(contacts.data.some(row => row.id === customerId && row.mobile === "0123456789"));
    expectStatus(await call(viewer, "list-booking-customers", { query: prefix }), 403);
  });

  await t.test("overlapping concurrent saves leave exactly one allocation", async () => {
    const date = "2099-01-11";
    const results = await Promise.all([save(admin, date), save(team, date)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409], JSON.stringify(results));
    raceWinner = results.find(result => result.status === 200).json.data.id;
    const entries = await rest(`calendar_entries?venue_id=eq.${venue.id}&start_date=eq.${date}`);
    const allocations = await rest(`booking_allocations?venue_id=eq.${venue.id}`);
    assert.equal(entries.length, 1);
    assert.deepEqual(allocations.map(row => row.calendar_entry_id), [raceWinner]);
  });

  await t.test("adjacent half-days and following midnight coexist", async () => {
    const date = "2099-01-12";
    const first = expectStatus(await save(admin, date, { booking_mode: "time_slot", booking_mode_code: "first_half" }), 200);
    const second = expectStatus(await save(admin, date, { booking_mode: "time_slot", booking_mode_code: "second_half" }), 200);
    const next = expectStatus(await save(admin, "2099-01-13"), 200);
    const entries = await rest(`calendar_entries?venue_id=eq.${venue.id}&start_date=gte.${date}&order=starts_at.asc`);
    assert.deepEqual(entries.map(entry => entry.id), [first.data.id, second.data.id, next.data.id]);
    assert.equal(entries[0].ends_at, entries[1].starts_at);
    assert.equal(entries[1].ends_at, entries[2].starts_at);
    expectStatus(await save(admin, date), 409);
  });

  await t.test("simultaneous edits and stale cancellation cannot overwrite a newer revision", async () => {
    const date = "2099-01-11";
    const edited = await Promise.all([
      save(admin, date, { id: raceWinner, revision: 1, event_name: "Edit A" }),
      save(team, date, { id: raceWinner, revision: 1, event_name: "Edit B" }),
    ]);
    assert.deepEqual(edited.map(result => result.status).sort(), [200, 409], JSON.stringify(edited));
    expectStatus(await call(admin, "cancel-booking", { id: raceWinner, revision: 1 }), 409);
    const [entry] = await rest(`calendar_entries?id=eq.${raceWinner}`);
    assert.equal(entry.revision, 2);
    assert.equal(entry.status, "active");
  });

  await t.test("restricted accounts cannot write or obtain private booking data", async () => {
    const blockFields = { booking_status: "blocked", block_reason_code: "maintenance", customer_id: null };
    const date = "2099-01-14";
    const block = expectStatus(await save(admin, date, blockFields), 200).data.id;
    expectStatus(await save(team, "2099-01-15", blockFields), 403);
    expectStatus(await save(team, date, { id: block, revision: 1 }), 403);
    expectStatus(await call(team, "cancel-booking", { id: block, revision: 1 }), 403);
    expectStatus(await save(viewer, "2099-01-15"), 403);
    expectStatus(await call(calendarOnly, "list-bookings"), 403);
    expectStatus(await call(temporaryAdmin, "list-change-history"), 403);
    expectStatus(await adminUpdate(temporaryAdmin, { user_id: team.id, is_active: false }), 403);
    const { data } = expectStatus(await call(team, "list-bookings", { query: block }), 200);
    assert.deepEqual(data, []);
    const { entries } = expectStatus(await call(calendarOnly, "get-availability", { venue_id: venue.id, month: "2099-01" }), 200);
    assert.ok(entries.some(entry => entry.id === block));
    assert.ok(entries.every(entry => !["event_name", "notes", "customer_id", "created_actor"].some(field => field in entry)));
  });

  await t.test("holds disappear when expired and the same interval can be booked", async () => {
    const date = "2099-01-15";
    const hold = expectStatus(await save(admin, date, { booking_status: "pending", hold_minutes: 30 }), 200).data.id;
    expectStatus(await save(admin, date), 409);
    await rest(`calendar_entries?id=eq.${hold}`, {
      method: "PATCH", body: { hold_expires_at: "2000-01-01T00:00:00Z" },
    });
    const { entries } = expectStatus(await call(admin, "get-availability", { venue_id: venue.id, month: "2099-01" }), 200);
    assert.ok(!entries.some(entry => entry.id === hold));
    expectStatus(await save(admin, date, { id: hold, revision: 2 }), 409);
    expectStatus(await save(admin, date), 200);
    const [expired] = await rest(`calendar_entries?id=eq.${hold}`);
    assert.equal(expired.status, "cancelled");
    const { data: counts } = expectStatus(await call(admin, "get-dashboard-counts"), 200);
    assert.equal(counts.holds, 0);
    assert.ok(counts.reserved >= 5);
  });

  await t.test("search reaches matching entries beyond the first page", async () => {
    const results = [];
    for (let day = 1; day <= 26; day++) {
      const date = `2099-02-${String(day).padStart(2, "0")}`;
      const response = await save(admin, date, { event_name: `${prefix} pagination` });
      results.push(expectStatus(response, 200).data.id);
    }
    const first = expectStatus(await call(admin, "list-bookings", { query: `${prefix} pagination`, page: 0 }), 200);
    const second = expectStatus(await call(admin, "list-bookings", { query: `${prefix} pagination`, page: 1 }), 200);
    assert.equal(first.data.length, 25);
    assert.equal(first.has_more, true);
    assert.deepEqual(second.data.map(row => row.id), [results[0]]);
    assert.equal(second.has_more, false);
  });

  await t.test("business workflow is optional and has separate access checks", async () => {
    const records = [
      { kind: "inquiry", status: "new" },
      { kind: "quote", status: "draft", amount: 1000 },
      { kind: "deposit", status: "received", booking_id: raceWinner, amount: 500 },
      { kind: "reminder", status: "scheduled", due_at: "2099-01-10T03:00:00.000Z" },
      { kind: "instructions", status: "ready", booking_id: raceWinner, notes: "Open the loading gate at 10 AM." },
    ];
    for (const item of records) {
      expectStatus(await call(admin, "save-booking-workflow", { ...item, title: `${prefix} ${item.kind}` }), 201);
    }
    const { data } = expectStatus(await call(admin, "list-booking-workflow", { query: prefix, booking_id: raceWinner }), 200);
    assert.deepEqual(data.map(item => item.kind).sort(), ["deposit", "instructions"]);
    expectStatus(await call(team, "list-booking-workflow"), 403);
    expectStatus(await call(admin, "save-booking-workflow", { ...data[0], status: data[0].status }), 200);
    expectStatus(await call(admin, "save-booking-workflow", { ...data[0], title: "Stale workflow edit" }), 409);
    expectStatus(await save(team, "2099-03-01"), 200);
  });

  await t.test("updates roll back account, grants and sessions together", async () => {
    expectStatus(await adminUpdate(admin, {
      user_id: team.id, role: "viewer", is_active: false, permissions: [{ module: "invalid", action: "view" }],
    }), 400);
    const [after] = await rest(`mpr_users?id=eq.${team.id}&select=role,is_active`);
    assert.deepEqual(after, { role: "staff", is_active: true });
    expectStatus(await call(team, "list-bookings"), 200);
    expectStatus(await adminUpdate(admin, { user_id: team.id, is_active: false }), 200);
    const grants = await rest(`user_permissions?user_id=eq.${team.id}&select=action`);
    assert.equal(grants.length, 4);
    assert.deepEqual(await rest(`mpr_sessions?user_id=eq.${team.id}`), []);
    expectStatus(await call(team, "list-bookings"), 401);
  });
});

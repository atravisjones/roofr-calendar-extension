const assert = require("node:assert/strict");
require("../roofr-api.js");
require("../reports-batch.js");

const api = globalThis.RoofrApiInternals;
const batch = globalThis.RoofrReportsBatch;

const detail = {
  calendar_event_type: { id: 3107430 },
  title: "Test",
  start_date_time: "2026-06-11 10:00:00",
  end_date_time: "2026-06-11 11:00:00",
  timezone: "America/Phoenix",
  all_day_event: false,
  description: "Description",
  location: "Phoenix",
  attendees: [{ id: 1, type: "user", name: "Existing" }]
};

const payload = api.buildEventAttendeePayload(detail, [...detail.attendees, { id: 2 }]);
assert.deepEqual(payload.attendees, [{ id: 1, type: "user" }, { id: 2, type: "user" }]);
assert.equal(payload.calendar_event_type_id, 3107430);
assert.equal(payload.location, "Phoenix");

assert.equal(api.assertZeroRemovals([{ id: 1 }], [{ id: 1 }, { id: 2 }]), true);
assert.throws(() => api.assertZeroRemovals([{ id: 1 }, { id: 2 }], [{ id: 2 }]), /remove: 1/);

const salesEvent = {
  id: 10,
  job_id: 20,
  calendar_event_type_id: 3107430,
  status: "confirmed",
  all_day_event: false,
  parent_id: null,
  recurring_rule: null
};
assert.deepEqual(batch.eligibility(salesEvent, 443464), { eligible: true, reason: null });
assert.equal(batch.eligibility({ ...salesEvent, status: "cancelled" }, 443464).reason, "cancelled");
assert.equal(batch.eligibility({ ...salesEvent, parent_id: 99 }, 443464).reason, "recurring");
assert.equal(batch.eligibility({ ...salesEvent, all_day_event: true }, 443464).reason, "all_day");
assert.equal(batch.eligibility({ ...salesEvent, job_id: null }, 443464).reason, "null_job_id");
assert.equal(batch.eligibility(salesEvent, null).reason, "missing_rep_selection");
assert.equal(batch.eligibility({ ...salesEvent, calendar_event_type_id: 3107441 }, 443464).reason, "not_sales_category");

console.log("reports-batch foundation tests passed");

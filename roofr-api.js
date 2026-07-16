// Same-origin Roofr API client. Loaded before content.js.
(function initRoofrApi(global) {
  "use strict";

  const TEAM_ID = "239329";
  const DEFAULT_TIMEOUT_MS = 15000;
  const PHOENIX_TIMEZONE = "America/Phoenix";

  function structuredError(kind, message, status, cause) {
    const error = new Error(message);
    error.kind = kind;
    if (status !== undefined) error.status = status;
    if (cause) error.cause = cause;
    error.toJSON = () => ({
      kind: error.kind,
      message: error.message,
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.ambiguous ? { ambiguous: true } : {})
    });
    return error;
  }

  function serializeError(error) {
    if (!error) return { kind: "network", message: "Unknown error" };
    if (typeof error.toJSON === "function") return error.toJSON();
    return {
      kind: error.kind || "network",
      message: error.message || String(error),
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.ambiguous ? { ambiguous: true } : {})
    };
  }

  function getXsrfToken(cookieString) {
    const match = String(cookieString || "").match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function assertApiPath(path) {
    if (typeof path !== "string" || !path.startsWith("/api/") || path.startsWith("/api//")) {
      throw structuredError("network", `Refusing non-/api/ path: ${path}`);
    }
  }

  function attendeeId(attendee) {
    return String((attendee && (attendee.id ?? attendee.user_id)) ?? "");
  }

  function normalizeAttendees(attendees) {
    const byId = new Map();
    for (const attendee of Array.isArray(attendees) ? attendees : []) {
      const id = attendeeId(attendee);
      if (!id) continue;
      byId.set(id, { id: attendee.id ?? attendee.user_id, type: attendee.type || "user" });
    }
    return [...byId.values()];
  }

  function attendeeIdSet(attendees) {
    return new Set(normalizeAttendees(attendees).map((attendee) => String(attendee.id)));
  }

  function sameSet(left, right) {
    if (left.size !== right.size) return false;
    for (const value of left) if (!right.has(value)) return false;
    return true;
  }

  function assertZeroRemovals(beforeAttendees, afterAttendees) {
    const beforeIds = attendeeIdSet(beforeAttendees);
    const afterIds = attendeeIdSet(afterAttendees);
    const removed = [...beforeIds].filter((id) => !afterIds.has(id));
    if (removed.length) {
      const error = structuredError("network", `Attendee update would remove: ${removed.join(", ")}`);
      error.ambiguous = true;
      throw error;
    }
    return true;
  }

  function buildEventAttendeePayload(detail, attendees, jobId) {
    if (!detail || !detail.calendar_event_type) {
      throw structuredError("network", "Event detail is missing calendar_event_type");
    }
    const payload = {
      calendar_event_type_id: detail.calendar_event_type.id,
      title: detail.title,
      start_date_time: detail.start_date_time,
      end_date_time: detail.end_date_time,
      timezone: detail.timezone,
      all_day_event: detail.all_day_event,
      description: detail.description,
      attendees: normalizeAttendees(attendees)
    };
    if (Object.prototype.hasOwnProperty.call(detail, "location")) payload.location = detail.location;
    // CRITICAL: preserve the event<->job link. A full PUT replaces the whole event,
    // and Roofr keys the job association on context_type/context_id. The single-event
    // GET omits these, so the caller passes jobId (from the day-event list). Without
    // them the write silently detaches the appointment from its job card.
    const contextId = (jobId !== undefined && jobId !== null && jobId !== "")
      ? jobId
      : (detail.context_id ?? detail.job_id);
    if (contextId !== undefined && contextId !== null && contextId !== "") {
      payload.context_type = "job";
      payload.context_id = contextId;
    }
    return payload;
  }

  function unwrapData(response) {
    return response && Object.prototype.hasOwnProperty.call(response, "data") ? response.data : response;
  }

  function isRetryable(error) {
    return error && (
      error.kind === "timeout" ||
      error.kind === "network" ||
      (error.kind === "http" && (error.status === 429 || error.status >= 500))
    );
  }

  function getDetailAttendees(detail) {
    return Array.isArray(detail && detail.attendees) ? detail.attendees : [];
  }

  async function request(path, options = {}) {
    assertApiPath(path);
    const method = String(options.method || "GET").toUpperCase();
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const headers = new Headers(options.headers || {});
    headers.set("accept", "application/json");
    headers.set("team-id", TEAM_ID);
    headers.set("x-xsrf-token", getXsrfToken(global.document && global.document.cookie));
    if (options.body !== undefined) headers.set("content-type", "application/json");

    try {
      const response = await global.fetch(path, {
        method,
        headers,
        credentials: "same-origin",
        signal: controller.signal,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
      });
      const text = await response.text();
      let body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch (cause) {
          throw structuredError("network", `Malformed JSON from ${method} ${path}`, response.status, cause);
        }
      }
      if (!response.ok) {
        throw structuredError("http", `${method} ${path} failed with ${response.status}`, response.status);
      }
      return body;
    } catch (error) {
      if (error && error.kind) throw error;
      if (error && error.name === "AbortError") {
        throw structuredError("timeout", `${method} ${path} timed out`, undefined, error);
      }
      throw structuredError("network", `${method} ${path} failed: ${error.message || error}`, undefined, error);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getWithRetry(path, options = {}) {
    try {
      return await request(path, { ...options, method: "GET" });
    } catch (error) {
      if (!isRetryable(error)) throw error;
      return request(path, { ...options, method: "GET" });
    }
  }

  async function reconcileThenRetryOnce({ before, expected, write, read, matchesBefore, matchesExpected }) {
    let writeError;
    try {
      await write();
    } catch (error) {
      writeError = error;
    }

    let after = await read();
    if (matchesExpected(after, expected)) return { after, verified: true, retried: false };
    if (!writeError) return { after, verified: false, retried: false };
    if (!matchesBefore(after, before) || !isRetryable(writeError)) {
      writeError.ambiguous = !matchesBefore(after, before);
      throw writeError;
    }

    let retryError;
    try {
      await write();
    } catch (error) {
      retryError = error;
    }
    after = await read();
    if (matchesExpected(after, expected)) return { after, verified: true, retried: true };
    if (retryError) {
      retryError.ambiguous = !matchesBefore(after, before);
      throw retryError;
    }
    return { after, verified: false, retried: true };
  }

  async function getDayEvents(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) {
      throw structuredError("network", `Invalid date: ${dateStr}`);
    }
    const params = new URLSearchParams({
      start_date_time: `${dateStr} 00:00:00`,
      end_date_time: `${dateStr} 23:59:59`,
      timezone: PHOENIX_TIMEZONE
    });
    const data = unwrapData(await getWithRetry(`/api/calendar/event?${params}`));
    const list = Array.isArray(data) ? data : [];
    const carriesStatus = list.some((event) => Object.prototype.hasOwnProperty.call(event || {}, "status"));
    return carriesStatus ? list.filter((event) => event.status !== "cancelled") : list;
  }

  async function getEvent(id) {
    return unwrapData(await getWithRetry(`/api/calendar/event/${encodeURIComponent(id)}`));
  }

  async function getJob(id) {
    return unwrapData(await getWithRetry(`/api/job/${encodeURIComponent(id)}`));
  }

  // One recent-jobs page is the only reliable full-team user source: /api/team
  // returns team-level objects with no users, and a single job's permitted_users
  // only lists users permitted on THAT job (sales reps are missing until assigned).
  // The union of permitted_users/assignees/job_owner across 100 recent jobs covers
  // every active rep — same technique as roofr-sync's scrape-calendar user map.
  async function listRecentJobs() {
    return unwrapData(await getWithRetry("/api/jobs?per_page=100&page=1"));
  }

  async function setJobOwner(jobId, userId) {
    const before = await getJob(jobId);
    const customerId = before?.customer_id ?? before?.customer?.id;
    if (customerId === null || customerId === undefined || customerId === "") {
      throw structuredError("network", `Job ${jobId} is missing customer_id`);
    }
    await request(`/api/job/${encodeURIComponent(jobId)}/assignee`, {
      method: "PUT",
      body: { assignee_id: userId, customer_id: customerId }
    });
    const after = await getJob(jobId);
    return {
      ok: String(after?.job_owner?.id ?? "") === String(userId),
      before,
      after
    };
  }

  async function performAttendeeWrite(id, before, payload) {
    const expectedIds = attendeeIdSet(payload.attendees);
    const beforeIds = attendeeIdSet(getDetailAttendees(before));
    assertZeroRemovals(getDetailAttendees(before), payload.attendees);
    const matchesExpected = (detail) => sameSet(attendeeIdSet(getDetailAttendees(detail)), expectedIds);
    const matchesBefore = (detail) => sameSet(attendeeIdSet(getDetailAttendees(detail)), beforeIds);

    try {
      const result = await reconcileThenRetryOnce({
        before,
        expected: payload,
        write: () => request(`/api/calendar/event/${encodeURIComponent(id)}`, { method: "PUT", body: payload }),
        read: () => getEvent(id),
        matchesBefore,
        matchesExpected
      });
      return { ok: result.verified, before, after: result.after, verified: result.verified };
    } catch (error) {
      let after = null;
      try { after = await getEvent(id); } catch (_) { /* Preserve the original write error. */ }
      return { ok: false, before, after, verified: false, error: serializeError(error) };
    }
  }

  async function setEventAttendees(id, fullEventPayloadWithAttendees) {
    const before = await getEvent(id);
    const { attendee_user_ids: ignoredReadOnlyField, ...writePayload } = fullEventPayloadWithAttendees;
    return performAttendeeWrite(id, before, {
      ...writePayload,
      attendees: normalizeAttendees(fullEventPayloadWithAttendees.attendees)
    });
  }

  async function addAttendee(eventId, userId, jobId) {
    const before = await getEvent(eventId);
    const attendees = normalizeAttendees(getDetailAttendees(before));
    if (attendeeIdSet(attendees).has(String(userId))) {
      return { ok: true, before, after: before, verified: true, alreadyCorrect: true };
    }
    attendees.push({ id: userId, type: "user" });
    const payload = buildEventAttendeePayload(before, attendees, jobId);
    return performAttendeeWrite(eventId, before, payload);
  }

  async function deleteEvent(id) {
    const before = await getEvent(id);
    try {
      const result = await reconcileThenRetryOnce({
        before,
        expected: "cancelled",
        write: () => request(`/api/calendar/event/${encodeURIComponent(id)}`, { method: "DELETE" }),
        read: () => getEvent(id),
        matchesBefore: (after) => after && after.status === before.status,
        matchesExpected: (after) => after && after.status === "cancelled"
      });
      return { ok: result.verified, before, after: result.after, verified: result.verified };
    } catch (error) {
      let after = null;
      try { after = await getEvent(id); } catch (_) { /* Preserve the original write error. */ }
      return { ok: false, before, after, verified: false, error: serializeError(error) };
    }
  }

  const api = {
    getDayEvents,
    getEvent,
    getJob,
    listRecentJobs,
    setJobOwner,
    setEventAttendees,
    addAttendee,
    deleteEvent,
    reconcileThenRetryOnce,
    serializeError
  };
  global.RoofrApi = api;
  global.RoofrApiInternals = {
    assertZeroRemovals,
    buildEventAttendeePayload,
    normalizeAttendees,
    attendeeIdSet,
    sameSet
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { ...api, ...global.RoofrApiInternals };
  }
})(typeof window !== "undefined" ? window : globalThis);

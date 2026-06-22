// Checkpointed Reports attendee batch foundation. Loaded before content.js.
(function initReportsBatch(global) {
  "use strict";

  const STATE_KEY = "roofr_reports_batch_v2_state";
  const JOURNAL_KEY = "roofr_reports_batch_v2_journal";
  const SALES_EVENT_TYPE_IDS = new Set(["3107430", "3107431", "6093186", "6109795"]);
  const TERMINAL_OUTCOMES = new Set([
    "verified_success",
    "already_correct",
    "dry_run",
    "skipped",
    "failed",
    "needs_review"
  ]);

  function eventTypeId(event) {
    return event && (event.calendar_event_type_id ?? event.calendar_event_type?.id);
  }

  function eligibility(event, repUserId) {
    if (!SALES_EVENT_TYPE_IDS.has(String(eventTypeId(event) ?? ""))) return { eligible: false, reason: "not_sales_category" };
    if (event.status === "cancelled") return { eligible: false, reason: "cancelled" };
    if (event.parent_id || event.recurring_rule) return { eligible: false, reason: "recurring" };
    if (event.all_day_event) return { eligible: false, reason: "all_day" };
    if (event.job_id === null || event.job_id === undefined || event.job_id === "") return { eligible: false, reason: "null_job_id" };
    if (repUserId === null || repUserId === undefined || repUserId === "") return { eligible: false, reason: "missing_rep_selection" };
    return { eligible: true, reason: null };
  }

  function createWorkUnit(event, repUserId) {
    const check = eligibility(event, repUserId);
    return {
      eventId: event.id,
      jobId: event.job_id ?? null,
      repUserId: repUserId ?? null,
      state: check.eligible ? "pending" : "terminal",
      outcome: check.eligible ? null : "skipped",
      beforeState: null,
      ownerOk: null,
      ownerError: null,
      error: check.eligible ? null : { reason: check.reason }
    };
  }

  function tally(units) {
    const result = {
      verified_success: 0,
      already_correct: 0,
      dry_run: 0,
      skipped: 0,
      failed: 0,
      needs_review: 0,
      pending: 0
    };
    for (const unit of units || []) {
      const key = TERMINAL_OUTCOMES.has(unit.outcome) ? unit.outcome : "pending";
      result[key] += 1;
    }
    return result;
  }

  function storage() {
    if (!global.chrome || !global.chrome.storage || !global.chrome.storage.local) {
      throw new Error("chrome.storage.local is unavailable");
    }
    return global.chrome.storage.local;
  }

  async function saveState(state) {
    await storage().set({ [STATE_KEY]: state });
    return state;
  }

  async function loadState() {
    const data = await storage().get(STATE_KEY);
    return data[STATE_KEY] || null;
  }

  async function appendJournal(entry) {
    const data = await storage().get(JOURNAL_KEY);
    const journal = Array.isArray(data[JOURNAL_KEY]) ? data[JOURNAL_KEY] : [];
    journal.push(entry);
    await storage().set({ [JOURNAL_KEY]: journal });
    return entry;
  }

  async function exportJournalJson() {
    const data = await storage().get(JOURNAL_KEY);
    return JSON.stringify(Array.isArray(data[JOURNAL_KEY]) ? data[JOURNAL_KEY] : [], null, 2);
  }

  function detailAttendeeIds(detail) {
    return new Set((detail?.attendees || []).map((attendee) => String(attendee.id)).filter(Boolean));
  }

  function makeState(units, config = {}) {
    const maxWrites = config.maxWrites === null || config.maxWrites === "unlimited" || config.maxWrites === Infinity
      ? null
      : (Number.isFinite(config.maxWrites) ? Math.max(0, config.maxWrites) : 1);
    return {
      version: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config: {
        dryRun: config.dryRun !== false,
        maxWrites
      },
      writesThisRun: 0,
      stoppedReason: null,
      units
    };
  }

  async function checkpoint(state) {
    state.updatedAt = new Date().toISOString();
    await saveState(state);
  }

  async function finishUnit(state, unit, outcome, before, after, error) {
    unit.state = "terminal";
    unit.outcome = outcome;
    unit.beforeState = before ?? unit.beforeState;
    unit.error = error || null;
    await appendJournal({
      ts: new Date().toISOString(),
      eventId: unit.eventId,
      before: before ?? null,
      after: after ?? null,
      ownerOk: unit.ownerOk,
      ownerError: unit.ownerError,
      outcome
    });
    await checkpoint(state);
  }

  async function setOwnerForUnit(api, unit) {
    if (typeof api.setJobOwner !== "function") {
      throw new Error("RoofrApi.setJobOwner is unavailable");
    }
    try {
      const result = await api.setJobOwner(unit.jobId, unit.repUserId);
      unit.ownerOk = Boolean(result?.ok);
      unit.ownerError = unit.ownerOk ? null : { reason: "owner_verify_failed" };
      return result;
    } catch (error) {
      unit.ownerOk = false;
      unit.ownerError = api.serializeError ? api.serializeError(error) : { message: error.message || String(error) };
      throw error;
    }
  }

  async function execute(config = {}) {
    const api = config.api || global.RoofrApi;
    if (!api) throw new Error("RoofrApi is unavailable");

    let state = config.resume ? await loadState() : null;
    if (!state) state = makeState(config.units || [], config);
    state.writesThisRun = 0;
    state.stoppedReason = null;
    await checkpoint(state);

    for (const unit of state.units) {
      if (unit.state === "terminal" || TERMINAL_OUTCOMES.has(unit.outcome)) continue;

      unit.state = "reconciling";
      await checkpoint(state);
      let before;
      try {
        before = await api.getEvent(unit.eventId);
        // The single-event GET omits job_id; restore it from the work unit
        // (bound from the loaded day-event) so eligibility doesn't skip as null_job_id.
        if (before && (before.job_id === null || before.job_id === undefined || before.job_id === "")) {
          before.job_id = unit.jobId;
        }
        unit.beforeState = before;
        await checkpoint(state);

        const freshCheck = eligibility(before, unit.repUserId);
        if (!freshCheck.eligible) {
          await finishUnit(state, unit, "skipped", before, before, { reason: freshCheck.reason });
          continue;
        }

        if (state.config.dryRun) {
          await finishUnit(state, unit, "dry_run", before, before, null);
          continue;
        }

        if (state.config.maxWrites !== null && state.writesThisRun >= state.config.maxWrites) {
          state.stoppedReason = "max_writes_reached";
          unit.state = "pending";
          await checkpoint(state);
          break;
        }

        if (detailAttendeeIds(before).has(String(unit.repUserId))) {
          unit.state = "writing_owner";
          await checkpoint(state);
          state.writesThisRun += 1;
          const ownerResult = await setOwnerForUnit(api, unit);
          if (ownerResult.ok) {
            await finishUnit(state, unit, "already_correct", before, before, null);
          } else {
            await finishUnit(state, unit, "failed", before, before, unit.ownerError);
          }
          continue;
        }

        unit.state = "writing";
        await checkpoint(state);
        const result = await api.addAttendee(unit.eventId, unit.repUserId);
        state.writesThisRun += 1;
        if (result.verified) {
          unit.state = "writing_owner";
          await checkpoint(state);
          const ownerResult = await setOwnerForUnit(api, unit);
          if (ownerResult.ok) {
            await finishUnit(state, unit, "verified_success", result.before, result.after, null);
          } else {
            await finishUnit(state, unit, "failed", result.before, result.after, unit.ownerError);
          }
        } else {
          const ambiguous = Boolean(result.error?.ambiguous);
          await finishUnit(state, unit, ambiguous ? "needs_review" : "failed", result.before || before, result.after, result.error);
          if (ambiguous) {
            state.stoppedReason = "ambiguous_write";
            await checkpoint(state);
            break;
          }
        }
      } catch (error) {
        const serialized = api.serializeError ? api.serializeError(error) : { message: error.message || String(error) };
        await finishUnit(state, unit, error.ambiguous ? "needs_review" : "failed", before, null, serialized);
        if (error.ambiguous) {
          state.stoppedReason = "ambiguous_write";
          await checkpoint(state);
          break;
        }
      }
    }

    return { state, tally: tally(state.units) };
  }

  const batch = {
    STATE_KEY,
    JOURNAL_KEY,
    SALES_EVENT_TYPE_IDS,
    eligibility,
    createWorkUnit,
    tally,
    makeState,
    loadState,
    saveState,
    appendJournal,
    exportJournalJson,
    execute
  };
  global.RoofrReportsBatch = batch;
  if (typeof module !== "undefined" && module.exports) module.exports = batch;
})(typeof window !== "undefined" ? window : globalThis);

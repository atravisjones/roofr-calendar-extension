/**
 * Auto-Dialer UI logic.
 *
 * State machine:
 *   idle ──Start──▶ fetching ──claim──▶ dialing ──ctm:start──▶ connected ──ctm:end──▶ wrapup
 *      ▲                                      └─ctm:failed/timeout──▶ wrapup (No Answer/Failed)
 *      └──── Stop / wrapup-save+Stop ─────────────────────────────────────────────────┘
 *
 * Lock claim/release via /api/sheet-dispositions (action=claim/release).
 * Disposition write via /api/sheet-dispositions (default action).
 */
(function () {
  "use strict";

  const API_BASE = "https://speed-to-leads.vercel.app";
  const DISPOSITIONS_URL = `${API_BASE}/api/sheet-dispositions`;
  // Missed Calls tab: server-side CTM missed/uncalled queue + disposition write-back.
  const MISSED_CALLS_URL = `${API_BASE}/api/missed-calls-queue`;
  const MISSED_DISPOSITIONS_URL = `${API_BASE}/api/lead-dispositions`;
  // Needs Rescheduled tab: jobs sitting in Roofr stage "Needs Rescheduled",
  // grouped by the CSR who created the lead. Review-then-call, log-only (no
  // sheet write-back — outcomes are recorded in this session's Event log).
  const RESCHEDULED_URL = `${API_BASE}/api/roofr-needs-rescheduled`;
  const RSCHED_DEFAULT_REVIEW_SEC = 60;  // 1:00 default review countdown
  // Welcome Calls tab: Madi's post-proposal-signed welcome-call queue. Unlike
  // Rescheduled (log-only), this WRITES back to the sheet (begin-call lock +
  // disposition) via /api/welcome-calls — keyed by jobId, capped at 4 attempts.
  const WELCOME_URL = `${API_BASE}/api/welcome-calls`;
  const WC_MAX_ATTEMPTS = 4;
  const WC_RENEW_MS = 90000;             // lock heartbeat during a long welcome call
  const DEBUG_LOG_URL = `${API_BASE}/api/dialer-debug-log`;
  const RING_TIMEOUT_MS = 35000;          // give up if no ctm:start within 35s
  const WRAPUP_AUTOFIRE_MS = 60000;       // auto Save → Next after 60s of inactivity in wrap-up
  const WRAPUP_INTERACTION_RESET_MS = 60000; // restart full 60s if rep types/selects
  const QUIET_START_HOUR = 8;             // 8am AZ
  const QUIET_END_HOUR = 21;              // 9pm AZ
  const MAX_ATTEMPTS = 7;                 // 7 attempts then auto-Lost (matches server AUTO_LOST_THRESHOLD)
  const POLL_BRIDGE_MS = 5000;
  const MIN_GAP_MS = 3 * 60 * 60 * 1000;  // 3 hours between consecutive calls to the same lead
  const BUSY_STUCK_MS = 20 * 60 * 1000;   // failsafe: treat the softphone-busy flag as stale after 20 min
  const AUTO_RETRY_THRESHOLD_MS = 5000;   // connected then dropped <5s → retry on main line
  const NEVER_CONNECT_RETRY_MS = 12000;   // never connected but ended <12s → one-ring reject, retry on main line
  const AUTO_RETRY_NUMBER = "+14805884668"; // Arizona Roofers Main Line for retries
  const SHORT_CALL_THRESHOLD_MS = 15000;  // calls ≤15s auto-set "Attempted" + short timer
  const SHORT_WRAPUP_MS = 15000;          // 15s wrap-up timer for short/VM calls
  const INTER_CALL_PAUSE_MS = 4000;       // 4s pause between wrap-up save and next dial

  // Statuses that REMOVE a lead from the dialer queue entirely.
  // Case-insensitive match against sheet column D — matches the disposition dropdown options.
  const EXCLUDE_SOURCES = new Set([
    "azroofco angis leads", "azroofco angis ads",
  ]);

  // Allowlist: only these statuses are dialable. Anything else (including new
  // dispositions added to the sheet later) is skipped by default. Safer than a
  // blocklist — prevents regressions when new statuses are introduced.
  const ALLOWED_STATUSES = new Set([
    "", "new", "attempted", "follow - up", "follow-up", "follow up",
  ].map(s => s.toLowerCase()));

  // Statuses that mean an attempt was made (lead stays in queue for retry)
  const ATTEMPT_STATUSES = new Set([
    "attempted", "follow - up", "follow-up",
  ].map(s => s.toLowerCase()));

  // ── Wrap-up disposition option sets (per tab) ──
  // Leads tab: the Google-Sheet form-lead dispositions.
  const LEADS_DISPOSITIONS = [
    "Follow - Up", "Attempted", "Lost", "Booked", "Bad Leads",
    "Do Not Service", "SOLD", "looking for work", "repeat",
  ];
  // Missed Calls tab: CTM dispositions. Active ones keep the lead in the
  // cadence (logged as an attempt, auto-Lost at 7); resolved ones drop it.
  const MISSED_DISPOSITIONS = [
    "No Answer",        // ONLY this keeps the lead in the queue to call back
    "Left VM", "Alex Callback", "Booked", "Spam", "Not Valid #", "Not Qualified", // all close the number out
  ];
  // Only "No Answer" recycles the lead for another attempt; everything else
  // closes the number out. (Drives the double-tap + cadence.)
  const MISSED_ACTIVE_DISPOSITIONS = ["No Answer"];

  // ── State ──
  let mode = "idle";      // 'idle' | 'running' | 'paused' | 'stopping'
  let _autoPausedByTabSwitch = false; // true when 'paused' came from leaving the Dialer tab (auto-resume on return)
  let phase = "idle";     // 'idle' | 'fetching' | 'dialing' | 'ringing' | 'connected' | 'wrapup'
  let currentLead = null;
  let queue = [];
  let currentTab = "leads";   // 'leads' (form leads / Google Sheet) | 'missed' (CTM missed calls) | 'rescheduled' (Roofr Needs-Rescheduled jobs)

  // ── Needs Rescheduled state (fully ISOLATED from the leads/missed dialer) ──
  // This flow never sets `currentLead`, never calls advanceToNext/onCallEnded/
  // showWrapup, and never touches `mode`/`phase` — so the normal dialer's
  // wrap-up, double-tap, cadence, and sheet-lock logic can't fire on it.
  let _rschedAll = [];        // raw jobs from /api/needs-rescheduled (newest reschedule first)
  let _rschedRepFilter = "all";  // "all" | a created_by CSR name
  let _rschedRangeDays = 0;      // 0 = all time | 30 | 60 | 90 (rescheduled within last N days)
  let _rschedQueue = [];      // the filtered, ordered job list Start walks / renders
  let _rschedIdx = -1;        // index into _rschedQueue of the open card
  let _rschedJob = null;      // the job currently being reviewed
  let _rschedPhase = "idle";  // 'idle' | 'reviewing' | 'stage1' | 'calling' | 'stage2'
  let _rschedStage1 = "";     // stage-1 choice carried into the logged outcome
  let _rschedTimerId = null;  // review countdown interval
  let _rschedRemainSec = RSCHED_DEFAULT_REVIEW_SEC;
  let _rschedCallTimerId = null;
  let _rschedCallStartMs = 0;
  let _rschedRingTimeoutId = null;
  let _rschedDialActive = false;  // gate for the separate CTM event router
  let _rschedRoofrTabId = null;   // the single reused Roofr job-card tab

  // ── Welcome Calls tab state (jobId-keyed; mirrors rsched but writes back) ──
  let _wcAll = [];                // raw rows from /api/welcome-calls
  let _wcDueFilter = "due";       // "due" (uncontacted or nextCall<=today) | "all"
  let _wcQueue = [];              // filtered/ordered list Start walks
  let _wcIdx = -1;                // index into _wcQueue of the open card
  let _wcJob = null;              // the welcome call being worked
  let _wcPhase = "idle";          // 'idle'|'reviewing'|'calling'|'stage2'
  let _wcCallTimerId = null;
  let _wcCallStartMs = 0;
  let _wcRingTimeoutId = null;
  let _wcRenewTimerId = null;     // 90s lock heartbeat while we hold the row
  let _wcDialActive = false;      // gate for the separate Welcome CTM router
  let _wcRoofrTabId = null;       // the single reused Roofr job-card tab
  let _wcLocked = false;          // we currently hold the begin-call lock on _wcJob
  let _wcClaiming = false;        // reentrancy guard around begin-call (double-click)
  // Phone(10-digit) → Roofr job { url, jobId, stage, name }. Used to flag missed
  // callers who are already customers (light blue + name links to their job card).
  let _roofrJobMap = {};
  let _roofrJobMapAt = 0;
  // Missed Calls tab filter: "all" | "new" | "customer" | "uncalled" | "followup".
  let missedFilter = "all";
  let _missedAll = [];   // full built missed queue (pre-filter), so chips don't refetch
  let ringTimeoutId = null;
  // ── Softphone-busy tracking ──
  // The CTM softphone can carry a call the dialer did NOT place (an inbound
  // the rep answered mid-wrap-up). The dialer must never auto-dial over it,
  // and must never blind-hangup while it's live.
  let softphoneBusy = false;   // a call is LIVE on the softphone — ours or not
  let _busyChangedAt = 0;      // when softphoneBusy last flipped (stuck-flag failsafe)
  let _busyAtDial = false;     // softphone already had a live call when we sent the dial
  let _busyDeferTimer = null;  // pending busy-hold recheck
  let _busyHoldLastLog = 0;    // throttle busy-hold log lines
  let bridgeReady = false;
  let ctmTabOpen = false;
  let currentWindowId = null;
  let repName = "unknown";
  let connectedThisCall = false;
  let retriedOnMainLine = false;  // true after auto-retry so we don't loop
  let callTimerId = null;         // interval for live call timer display
  let testMode = false;          // when ON: queue only test rows, skip 3-hr gap, skip auto-Lost
  let sessionLimit = 25;          // max calls per Start session (5-100)
  let sessionCount = 0;           // calls placed since current Start
  const removedThisSession = new Set();  // rowIndex values the rep X'd from the queue
  // ── Queue filters ──
  let filterSources = new Set();         // empty = all sources pass
  let filterAttemptPreset = "all";       // "new" | "followup" | "persistent" | "all"
  let allKnownSources = [];              // rebuilt from fetched data
  const completedThisSession = [];       // {phone, name, status, attempts} — the rolling DAILY "Done" list (persisted, resets at AZ midnight)
  const DAILY_DONE_KEY = "dialer_daily_done"; // chrome.storage.local: { date:"M/D/YYYY", done:[...] }
  let _dailyDoneDate = "";               // AZ day the current completedThisSession belongs to
  // CTM event dedup state — two rotating buckets, swapped every 1.5s by a
  // single setInterval. Per-event setTimeouts caused timer-queue thrashing.
  let _recentCtmEvents = new Set();
  let _prevCtmEvents = new Set();
  let _statusCount = 0;          // count of suppressed ctm:status heartbeats
  let _suppressedCount = 0;      // count of de-duped events
  let _staleEndCount = 0;        // count of stale end-activity events ignored
  // Timestamp of the most recent dial command we sent. CTM emits the prior
  // call's ctm:end-activity 1-2s LATE — sometimes arriving during the next
  // dial. We compare event.ts against this to drop events from the prior call
  // so a late end-activity doesn't pop a wrap-up modal mid-2nd-ring.
  let _currentDialAt = 0;
  let _currentFromNumber = null;  // outbound caller ID used for the current dial (for retry decisions)
  // Double-tap state. The 2-dial sequence is treated as ONE wrap-up:
  //   call#1 → ends → wrap-up → rep saves "Attempted" → DO NOT WRITE TO SHEET
  //     → set isInDoubleTap=true, stash first disposition+notes
  //     → immediately redial → big red DOUBLE TAP banner
  //   call#2 → ends → wrap-up opens with FIRST disposition pre-filled (rep can override)
  //     → rep saves → WRITE TO SHEET with attemptIncrement=2 and the FINAL disposition
  //     → clear double-tap state, advance to next lead
  let isInDoubleTap = false;            // true between 1st save and 2nd save
  let doubleTapPriorStatus = null;      // "Attempted" or whatever rep picked on 1st save
  let doubleTapPriorNotes = "";
  let doubleTapLead = null;             // the lead being double-tapped

  // ── DOM ──
  const $ = (id) => document.getElementById(id);
  const els = {
    repName: $("rep-name"),
    ctmPill: $("ctm-pill"),
    bridgePill: $("bridge-pill"),
    startBtn: $("start-btn"),
    stopBtn: $("stop-btn"),
    doneToday: $("done-today"),
    settingsBtn: $("settings-btn"),
    queueCount: $("queue-count"),
    t1Count: $("t1-count"),
    t2Count: $("t2-count"),
    testModeToggle: $("test-mode-toggle"),
    sessionLimitInput: $("session-limit"),
    sessionLimitDisplay: $("session-limit-display"),
    sessionCount: $("session-count"),
    logCopyBtn: $("log-copy-btn"),
    logClearBtn: $("log-clear-btn"),
    current: $("current"),
    queue: $("queue"),
    queueHeader: $("queue-header"),
    refreshBtn: $("refresh-btn"),
    completed: $("completed"),
    log: $("log"),
    filterPanel: $("filter-panel"),
    filterToggle: $("filter-toggle"),
    filterBody: $("filter-body"),
    filterSummary: $("filter-summary"),
    sourceChecks: $("source-checks"),
    attemptPresets: $("attempt-presets"),
    filterStats: $("filter-stats"),
    scrim: $("wrapup-scrim"),
    wrapupTitle: $("wrapup-title"),
    wrapupStatus: $("wrapup-status"),
    wrapupNotes: $("wrapup-notes"),
    wrapupSaveNext: $("wrapup-save-next"),
    wrapupSaveStop: $("wrapup-save-stop"),
    wrapupHelp: $("wrapup-help"),
  };

  // Full log history for the Copy button (DOM only keeps last 500; this keeps 2000).
  const _logHistory = [];

  // Strip non-ASCII so the Google Sheet (and copy buffer) don't mangle em-dashes,
  // arrows, checkmarks, etc. into mojibake. UI keeps the pretty chars; sheet/copy
  // get ASCII equivalents. The mojibake comes from a Latin-1/UTF-8 mismatch
  // somewhere between fetch → Vercel → Sheets API.
  function asciiSafe(s) {
    return String(s)
      .replace(/[—–]/g, "-")
      .replace(/→/g, "->")
      .replace(/←/g, "<-")
      .replace(/✓/g, "[ok]")
      .replace(/✗/g, "[x]")
      .replace(/⏸/g, "[pause]")
      .replace(/⏹/g, "[stop]")
      .replace(/▶/g, ">")
      .replace(/☎/g, "[call]")
      .replace(/⏭/g, ">>")
      .replace(/📋/g, "[copy]")
      .replace(/🧪/g, "[test]")
      .replace(/★/g, "*")
      .replace(/×/g, "x")
      .replace(/·/g, "-")
      .replace(/…/g, "...")
      .replace(/⚙/g, "[gear]")
      // Remove any remaining non-ASCII for safety
      .replace(/[^\x00-\x7F]/g, "?");
  }

  // log(msg, kind, tag)
  //   kind: "info" (default) | "ok" | "warn" | "err" | "ev" | "act"
  //   tag:  short category label (e.g. "dial", "ctm", "wrap", "lock") — optional
  // UI gets the pretty original; sheet + copy buffer get ASCII-safe versions.
  function log(msg, kind = "info", tag = "") {
    const ts = new Date();
    const line = document.createElement("div");
    line.className = kind;
    const tsEl = document.createElement("span");
    tsEl.className = "ts";
    tsEl.textContent = ts.toLocaleTimeString();
    line.appendChild(tsEl);
    if (tag) {
      const t = document.createElement("span");
      t.className = "tag";
      t.textContent = tag;
      line.appendChild(t);
    }
    const body = document.createElement("span");
    body.textContent = " " + msg;
    line.appendChild(body);
    els.log.appendChild(line);
    els.log.scrollTop = els.log.scrollHeight;
    while (els.log.children.length > 500) els.log.removeChild(els.log.firstChild);

    // ASCII-safe versions for clipboard + sheet
    const safeMsg = asciiSafe(msg);
    const safeTag = asciiSafe(tag);
    _logHistory.push(`${ts.toLocaleTimeString()} [${kind}] ${safeTag ? safeTag + " " : ""}${safeMsg}`);
    if (_logHistory.length > 2000) _logHistory.splice(0, _logHistory.length - 2000);
    // Queue for sheet mirror
    queueLogEntry({ ts: ts.toISOString(), kind, tag: safeTag, msg: safeMsg });
  }
  function leadTag(l) {
    if (!l) return "";
    return `${l.name || "(no name)"} ${l.phone}`;
  }

  // ── Pill helpers ──
  function setPill(el, state, label) {
    el.className = `pill ${state}`;
    el.querySelector(".label").textContent = label;
  }

  // ── Window ID helper ──
  async function getCurrentBrowserWindowId() {
    try {
      const win = await chrome.windows.getCurrent();
      if (win.type === 'normal') return win.id;
      const allWindows = await chrome.windows.getAll({ windowTypes: ['normal'] });
      const focused = allWindows.find(w => w.focused);
      return (focused || allWindows[0])?.id || null;
    } catch (e) {
      return null;
    }
  }

  // ── E.164 helper ──
  function toE164(phone) {
    const digits = String(phone).replace(/\D/g, "");
    const ten = digits.length > 10 ? digits.slice(-10) : digits;
    return ten.length === 10 ? `+1${ten}` : "";
  }

  // ── Phase setter (also enables/disables buttons) ──
  function setPhase(p) {
    phase = p;
    els.startBtn.disabled = mode === "running" || !ctmTabOpen || !bridgeReady;
    els.stopBtn.disabled = mode === "idle";
    renderCurrent();
  }

  // ── Render queue + current lead ──
  function renderCurrent() {
    if (!currentLead) {
      els.current.classList.add("empty");
      els.current.innerHTML = mode === "running"
        ? "<em>Fetching next lead…</em>"
        : "Press <strong>Start</strong> to begin dialing.";
      return;
    }
    els.current.classList.remove("empty");
    const phaseLabel = {
      dialing: "dialing", ringing: "ringing",
      connected: "connected", wrapup: "wrap-up", failed: "failed",
    }[phase] || phase;
    // Big red "DOUBLE TAP!" banner during the 2nd ring of a double-tap so the
    // rep knows immediately this is the second of two and what disposition is held.
    const doubleTapBanner = isInDoubleTap
      ? `<div class="double-tap-banner">★ DOUBLE TAP! ★<span class="sub">2nd ring · held: ${escapeHtml(doubleTapPriorStatus || "Attempted")}</span></div>`
      : "";
    els.current.innerHTML = `
      ${doubleTapBanner}
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="phase ${phase}">${phaseLabel}</div>
        <span id="call-timer" style="font-size:13px;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums;"></span>
      </div>
      <div class="lead-name">${escapeHtml(currentLead.name || "(no name)")}</div>
      <div class="lead-phone">${escapeHtml(currentLead.phone)}</div>
      <div class="lead-meta">
        <span>Source: ${escapeHtml(currentLead.source || "—")}</span>
        <span>Attempts: ${currentLead.attemptCount || 0}</span>
        <span>Last: ${escapeHtml(currentLead.lastContactDate || "never")}</span>
      </div>
      <div class="call-actions">
        <button id="hangup-btn" class="danger hangup-big" title="Hang up (Esc)">☎ Hangup <span style="opacity:.7;font-weight:600;">· Esc</span></button>
      </div>
    `;
    $("hangup-btn").onclick = onHangupClick;
    updateCallTimer();
  }

  function startCallTimer() {
    stopCallTimer();
    callTimerId = setInterval(updateCallTimer, 1000);
  }
  function stopCallTimer() {
    if (callTimerId) { clearInterval(callTimerId); callTimerId = null; }
  }
  function updateCallTimer() {
    const el = document.getElementById("call-timer");
    if (!el) return;
    if (!_currentDialAt) { el.textContent = ""; return; }
    const sec = Math.floor((Date.now() - _currentDialAt) / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    el.textContent = `${m}:${String(s).padStart(2, "0")}`;
    if (connectedThisCall) el.style.color = "var(--success)";
    else el.style.color = "var(--muted)";
  }

  const SOURCE_PILL_MAP = {
    "Modernize":                           { label: "MOD",  cls: "src-mod" },
    "NCT":                                 { label: "NCT",  cls: "src-nct" },
    "Arizona Roofers WEBSITE FORMS":       { label: "SEO",  cls: "src-seo" },
    "Arizona Roofers GOOGLE SEARCH ADS":   { label: "ADS",  cls: "src-ads" },
    "AZROOFCO WEBSITE":                    { label: "SEO",  cls: "src-seo" },
    "AZROOFCO GOOGLE SEARCH ADS":          { label: "ADS",  cls: "src-ads" },
    "GAF":                                 { label: "GAF",  cls: "src-gaf" },
  };
  function sourcePillHtml(source) {
    const src = (source || "").trim();
    const mapped = SOURCE_PILL_MAP[src];
    if (mapped) return `<span class="src-pill ${mapped.cls}">${mapped.label}</span>`;
    if (!src) return `<span class="src-pill src-unk">?</span>`;
    const short = src.length > 8 ? src.substring(0, 7) + "." : src;
    return `<span class="src-pill src-unk">${escapeHtml(short)}</span>`;
  }

  // Status pill — color-coded by disposition. Shared by renderQueue +
  // renderCompleted so the same palette appears everywhere.
  const STATUS_PILL_COLORS = {
    "attempted":       "#92400e",
    "follow - up":     "#1e40af",
    "follow-up":       "#1e40af",
    "follow up":       "#1e40af",
    "booked":          "#065f46",
    "sold":            "#065f46",
    "new":             "var(--accent-hi)",
    "lost":            "#991b1b",
    "bad leads":       "#991b1b",
    "do not service":  "#991b1b",
    "repeat":          "#6b7280",
    "looking for work":"#6b7280",
  };
  function statusPillHtml(status) {
    const raw = (status || "").trim();
    if (!raw) return "";
    const color = STATUS_PILL_COLORS[raw.toLowerCase()] || "var(--muted)";
    return `<span class="tier" style="background:transparent;color:${color};border:1px solid currentColor;">${escapeHtml(raw)}</span>`;
  }

  function renderQueue() {
    if (currentTab === "welcome") { renderWelcomeQueue(); return; }
    if (currentTab === "rescheduled") { renderRescheduledQueue(); return; }
    els.queue.innerHTML = "";
    // Show ALL queued leads (was capped at 8 — Travis: "why is there always 8?").
    // The list is inside the scrollable <main>, so long queues scroll naturally.
    if (els.queueHeader) {
      els.queueHeader.textContent = `Queue (${queue.length} remaining)`;
    }
    for (const lead of queue) {
      const li = document.createElement("li");
      if (lead.lockedBy && lead.lockedBy !== repName) li.classList.add("locked");
      // Missed-call leads who are already Roofr customers → light-blue row.
      if (lead.backend === "missed-calls" && lead.isCustomer) li.classList.add("customer-row");
      const tier = lead._tier;
      const tierLabel = { 1: "NEW", 2: "TODAY", 3: "WIP" }[tier] || "—";
      const leftEl = document.createElement("span");
      leftEl.className = "left";
      const attemptsNow = parseInt(lead.attemptCount) || 0;
      const doubleTapBadge = (attemptsNow === 0)
        ? `<span class="tier" style="background:var(--accent-light);color:var(--accent-hi);margin-left:2px;white-space:nowrap;" title="Double-tap: this lead gets called twice in a row on the first attempt">×2</span>`
        : "";
      const noteText = (lead.notes || "").trim();
      // Truncate long notes so a chatty lead doesn't bloat the row height.
      const noteShort = noteText.length > 90 ? noteText.slice(0, 87) + "…" : noteText;
      const noteHtml = noteText
        ? `<div class="row3" style="font-size:11px;color:var(--muted);margin-top:2px;line-height:1.3;" title="${escapeHtml(noteText)}">📝 ${escapeHtml(noteShort)}</div>`
        : "";
      const calledHtml = (lead.backend === "missed-calls" && lead.time)
        ? `<div class="row3" style="font-size:11px;color:var(--muted);margin-top:2px;">📞 Called ${escapeHtml(formatCalledTime(lead.time))}</div>`
        : "";
      const nameInner = escapeHtml(lead.name || "(no name)");
      const nameHtml = lead.jobUrl
        ? `<a class="name copyable job-link" data-copy="${escapeHtml(lead.name || "")}" href="${escapeHtml(lead.jobUrl)}" target="_blank" rel="noopener" title="Open Roofr job card${lead.jobStage ? " — " + escapeHtml(lead.jobStage) : ""}">${nameInner} 🔗</a>`
        : `<strong class="name copyable" data-copy="${escapeHtml(lead.name || "")}">${nameInner}</strong>`;
      leftEl.innerHTML = `
        <div class="row1"><span class="tier t${tier}">${tierLabel}</span>${nameHtml}</div>
        <div class="row2"><a class="phone-link copyable" data-copy="${escapeHtml(lead.phone)}" data-ctm-digits="${escapeHtml(lead.phone10 || (lead.phone || '').replace(/\D/g,'').slice(-10))}" href="https://app.calltrackingmetrics.com/calls/desk#filter=${escapeHtml(lead.phone10 || (lead.phone || '').replace(/\D/g,'').slice(-10))}" title="Click to open CTM filtered to this number">${escapeHtml(lead.phone)}</a> ${sourcePillHtml(lead.source)}${statusPillHtml(lead.status)}${doubleTapBadge}</div>
        ${calledHtml}${noteHtml}
      `;
      const metaEl = document.createElement("span");
      metaEl.className = "meta";
      metaEl.innerHTML = `${lead.attemptCount || 0}&nbsp;att${lead.lockedBy && lead.lockedBy !== repName ? " · 🔒 " + escapeHtml(lead.lockedBy) : ""}`;
      const xBtn = document.createElement("button");
      xBtn.className = "x-btn";
      xBtn.textContent = "×";
      xBtn.title = "Remove from this session (rejoins on next session)";
      xBtn.onclick = (e) => {
        e.stopPropagation();
        if (lead.rowIndex) removedThisSession.add(lead.rowIndex);
        else if (lead.backend === "missed-calls") removedThisSession.add("m:" + (lead.phoneBare || (lead.phone || "").replace(/\D/g, "")));
        queue = queue.filter(q => q !== lead);
        renderQueue();
        log(`removed from session: ${lead.name || "(no name)"} ${lead.phone}`, "act", "queue");
      };
      li.appendChild(leftEl);
      li.appendChild(metaEl);
      li.appendChild(xBtn);
      els.queue.appendChild(li);
    }
    els.queueCount.textContent = queue.length;
    els.t1Count.textContent = queue.filter(l => l._tier === 1).length;
    els.t2Count.textContent = queue.filter(l => l._tier === 2).length;
    if (els.sessionCount) els.sessionCount.textContent = sessionCount;
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  // ── Missed Calls queue builder ──
  // The /api/missed-calls-queue endpoint already applies the app's exact
  // missed/uncalled filter, dedups, drops resolved/dismissed leads, and shapes
  // each row for the dialer. We only need to add the dialer's local fields
  // (_tier, phone10) and honor in-session X-outs.
  function buildMissedQueue(leads) {
    return (leads || [])
      .filter(l => {
        const key = "m:" + (l.phoneBare || (l.phone || "").replace(/\D/g, ""));
        if (removedThisSession.has(key)) return false;
        // Cadence gate: the API keeps "resting" leads in the list (sorted to
        // the bottom) so it mirrors the app — but the auto-dialer must NOT
        // dial them. dueNow === false → attempted too recently (3h gap under
        // 3 attempts, 24h after). Missing field (older API) → treat as due.
        if (l.dueNow === false) return false;
        return true;
      })
      .map(l => {
        const att = parseInt(l.attemptCount) || 0;
        const bare = (l.phoneBare || (l.phone || "").replace(/\D/g, "")).slice(-10);
        const job = _roofrJobMap[bare] || null;
        // "Customer" = phone matches an actual Roofr job card (so blue always
        // means there's a card to open). The CTM "existing customer" tag is NOT
        // used — it's noisy (gets stuck on spam / toll-free / vendor numbers)
        // and points to no job, which left blue rows whose names only copied.
        const isCustomer = !!job;
        return {
          ...l,
          backend: "missed-calls",
          rowIndex: null,
          phone10: bare,
          attemptCount: att,
          status: l.status || "",
          // Already a Roofr customer? flag it (light-blue row) + link to their job.
          isCustomer,
          jobUrl: job ? job.url : null,
          jobStage: job ? job.stage : null,
          // NEW (never attempted) → Tier 1; otherwise work-in-progress → Tier 3.
          // Endpoint already returns them newest-first / new-callers-first.
          _tier: att === 0 ? 1 : 3,
        };
      });
  }

  // Load the phone→Roofr-job map once (cached 5 min). Open endpoint, no auth.
  async function ensureRoofrJobMap() {
    if (Date.now() - _roofrJobMapAt < 5 * 60 * 1000 && Object.keys(_roofrJobMap).length) return;
    try {
      const r = await fetch(`${API_BASE}/api/roofr-lookup`, { headers: { "X-Dialer-Client": "roofr-extension" } });
      const data = await r.json();
      if (data && data.phones) {
        _roofrJobMap = data.phones;
        _roofrJobMapAt = Date.now();
        log(`roofr job map loaded: ${Object.keys(_roofrJobMap).length} phones`, "info", "queue");
      }
    } catch (e) {
      log(`roofr job map load failed: ${e.message}`, "warn", "queue");
    }
  }

  // Apply the active Missed Calls filter chip to the full built list.
  // "Uncalled" = never called back yet (no-callback-yet, 0 attempts).
  // "Following up" = already called but not reached (no-contact stage) or has
  // dialer attempts — i.e. the cadence is in progress.
  const _isUncalled = l => l.stage !== "no-contact" && (parseInt(l.attemptCount) || 0) === 0;
  const _isFollowup = l => l.stage === "no-contact" || (parseInt(l.attemptCount) || 0) > 0;
  function filterMissed(list) {
    switch (missedFilter) {
      case "new":      return list.filter(l => l.stage === "new-lead" || l.isNew);
      case "customer": return list.filter(l => l.isCustomer);
      case "uncalled": return list.filter(_isUncalled);
      case "followup": return list.filter(_isFollowup);
      default:         return list.slice();
    }
  }

  // Count for each filter chip, computed from the full list.
  function countMissed(mf) {
    const l = _missedAll;
    if (mf === "new")      return l.filter(x => x.stage === "new-lead" || x.isNew).length;
    if (mf === "customer") return l.filter(x => x.isCustomer).length;
    if (mf === "uncalled") return l.filter(_isUncalled).length;
    if (mf === "followup") return l.filter(_isFollowup).length;
    return l.length;
  }

  function updateMissedFilterCounts() {
    document.querySelectorAll(".mfilter").forEach(btn => {
      const mf = btn.dataset.mf;
      const base = btn.dataset.label || (btn.dataset.label = btn.textContent.trim());
      btn.textContent = `${base} (${countMissed(mf)})`;
    });
  }

  function setMissedFilter(mf) {
    missedFilter = mf;
    document.querySelectorAll(".mfilter").forEach(b => b.classList.toggle("active", b.dataset.mf === mf));
    const sum = document.getElementById("missed-filter-summary");
    const chip = document.querySelector(`.mfilter[data-mf="${mf}"]`);
    if (sum && chip) sum.textContent = chip.dataset.label || chip.textContent.trim();
    queue = filterMissed(_missedAll);
    log(`missed filter → ${mf} (${queue.length} shown)`, "info", "ui");
    renderQueue();
  }

  // Format the CTM call time ("2026-05-28 02:15 PM -07:00") → "Thu 5/28 · 2:15 PM".
  function formatCalledTime(t) {
    if (!t) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}:\d{2}\s*[AP]M)/i.exec(String(t));
    if (!m) return String(t);
    const [, y, mo, d, time] = m;
    let dow = "";
    try {
      dow = new Date(`${y}-${mo}-${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Phoenix" });
    } catch (_) {}
    return `${dow ? dow + " " : ""}${parseInt(mo)}/${parseInt(d)} · ${time.replace(/\s+/g, " ").trim()}`;
  }

  // Update the count badge on the Missed Calls tab.
  function updateMissedBadge(n) {
    const badge = document.getElementById("missed-badge");
    if (!badge) return;
    if (n > 0) { badge.textContent = n; badge.style.display = ""; }
    else { badge.textContent = ""; badge.style.display = "none"; }
  }

  // ── Sort + filter the queue ──
  // Tier 1: uncontacted (attempts=0, not Resolved/DNC)
  // Tier 2: nextContactDate is today (follow-up due)
  // Tier 3: in-progress (Follow-Up/Attempted/Left VM, attempts < MAX)
  // Skip: Resolved/DNC, attempts >= MAX, locked by someone else
  // Accepts the API response — uses `rows` array (no phone dedup) if available,
  // falls back to the legacy `leads` map for old API responses.
  function classifyAndSort(apiData) {
    const todayAz = new Date().toLocaleDateString("en-US", { timeZone: "America/Phoenix" });
    const todayOrd = azDateOrdinal(todayAz);
    const nowMs = Date.now();
    const rows = Array.isArray(apiData.rows) ? apiData.rows : Object.values(apiData.leads || {});
    const out = [];
    const autoLostLeads = [];
    let skipped3hr = 0;
    let skippedScheduled = 0;
    let skippedNonTest = 0;
    let skippedSource = 0;
    let skippedAttempts = 0;

    // Collect all unique sources for the filter UI (excluding blocklisted ones)
    const sourcesInData = new Set();
    for (const l of rows) {
      const src = (l.source || "").trim();
      if (src && !EXCLUDE_SOURCES.has(src.toLowerCase())) sourcesInData.add(src);
    }
    allKnownSources = Array.from(sourcesInData).sort();
    rebuildSourceCheckboxes();

    // Attempt preset ranges
    const attemptRange = {
      "new": [0, 0],
      "followup": [1, 3],
      "persistent": [4, 7],
      "all": [0, 999],
    }[filterAttemptPreset] || [0, 999];

    for (const l of rows) {
      const isTestRow = /dialer test/i.test(l.name || "");

      // Rep X'd this row out of the current session — skip entirely
      if (l.rowIndex && removedThisSession.has(l.rowIndex)) continue;

      // TEST MODE: only test rows pass; bypass gaps, exclusions, auto-Lost
      if (testMode) {
        if (!isTestRow) { skippedNonTest++; continue; }
        if (l.lockedBy && l.lockedBy !== repName) {
          out.push({ ...l, _tier: 1, _skip: true, _testRow: true });
          continue;
        }
        out.push({ ...l, _tier: 1, _testRow: true });
        continue;
      }

      const attempts = parseInt(l.attemptCount) || 0;
      const status = (l.status || "").trim();
      const statusLower = status.toLowerCase();

      // Excluded sources — never dial
      if (EXCLUDE_SOURCES.has((l.source || "").trim().toLowerCase())) continue;

      // Allowlist: only New / Attempted / Follow-Up / blank are dialable.
      if (!ALLOWED_STATUSES.has(statusLower)) continue;

      // Source filter — skip if source doesn't match active filters
      if (filterSources.size > 0) {
        const src = (l.source || "").trim();
        if (!filterSources.has(src)) { skippedSource++; continue; }
      }

      // Attempt range filter
      if (attempts < attemptRange[0] || attempts > attemptRange[1]) {
        skippedAttempts++;
        continue;
      }

      // 7+ attempts → cadence exhausted. Never-connected leads auto-Lost.
      // Follow-Up means we actually reached the customer, so it's never
      // auto-Lost (matches the server's no-connect rule) — just dropped
      // from the auto-dial queue for manual handling.
      if (attempts >= MAX_ATTEMPTS) {
        if (!statusLower.includes("follow")) autoLostLeads.push(l);
        continue;
      }

      // Next-contact date is LAW: if col H holds a FUTURE date — a rep
      // promised the customer a specific callback day (manual sheet edit),
      // or the cadence stamped tomorrow — the lead rests until that day.
      // Date-part comparison only; blank/unparseable H fails OPEN so a typo
      // can't hide a lead from the queue forever.
      if (l.nextContactDate) {
        const dueOrd = azDateOrdinal(l.nextContactDate);
        if (dueOrd && todayOrd && dueOrd > todayOrd) {
          skippedScheduled++;
          continue;
        }
      }

      // Same-day cadence cap: day 1 allows up to 3 attempts (double-tap =
      // 1+2, then the 3-hour callback = 3). Once a lead has 3+ attempts and
      // was already called today, it's done for the day — pick it up
      // tomorrow. Col G is a full datetime ("7/2/2026, 12:15 PM"), so this
      // relies on sameAzDate comparing the DATE PART only.
      const lastIsToday = l.lastContactDate && sameAzDate(l.lastContactDate, todayAz);
      if (lastIsToday && attempts >= 3) {
        skipped3hr++;
        continue;
      }

      // 3-hour gap: if last call was within MIN_GAP_MS, skip from queue for now.
      // This is what produces the "first-time callback after ~3 hours" flow.
      if (l.lastContactDate) {
        const lastMs = Date.parse(l.lastContactDate);
        if (lastMs && (nowMs - lastMs) < MIN_GAP_MS) {
          skipped3hr++;
          continue;
        }
      }

      if (l.lockedBy && l.lockedBy !== repName) {
        out.push({ ...l, _tier: 3, _skip: true });
        continue;
      }

      let tier = 3;
      if (attempts === 0) tier = 1;
      else if (l.nextContactDate && sameAzDate(l.nextContactDate, todayAz)) tier = 2;
      out.push({ ...l, _tier: tier });
    }
    if (testMode) log(`${out.length} test rows queued, ${skippedNonTest} non-test rows skipped`, "info", "queue");
    else {
      const parts = [];
      if (skipped3hr > 0) parts.push(`${skipped3hr} resting (3-hr gap / daily cap)`);
      if (skippedScheduled > 0) parts.push(`${skippedScheduled} scheduled for a later day`);
      if (skippedSource > 0) parts.push(`${skippedSource} filtered by source`);
      if (skippedAttempts > 0) parts.push(`${skippedAttempts} filtered by attempts`);
      if (parts.length > 0) log(parts.join(", "), "info", "queue");
    }
    updateFilterStats(skippedSource, skippedAttempts, skipped3hr);

    // Fire off auto-Lost saves in background (don't block queue load)
    if (autoLostLeads.length > 0) {
      log(`auto-disposing ${autoLostLeads.length} leads as Lost (7+ attempts, never contacted)`, "warn", "auto");
      autoLostLeads.forEach(lead => {
        saveDisposition(lead.phone10 || lead.phone, "Lost", "never contacted — auto-disposed after 7 attempts", lead).catch(() => {});
      });
    }
    out.sort((a, b) => {
      // Dialer-specific test rows go absolute first (so 6026688360 dials before "Test Test")
      const aDialer = /dialer test/i.test(a.name || "");
      const bDialer = /dialer test/i.test(b.name || "");
      if (aDialer !== bDialer) return aDialer ? -1 : 1;
      // Generic test rows next
      const aTest = /\btest\b/i.test(a.name || "");
      const bTest = /\btest\b/i.test(b.name || "");
      if (aTest !== bTest) return aTest ? -1 : 1;
      // Descending by rowIndex — start from bottom of sheet, work up
      const aRow = parseInt(a.rowIndex) || 0;
      const bRow = parseInt(b.rowIndex) || 0;
      return bRow - aRow;
    });
    return out.filter(l => !l._skip).concat(out.filter(l => l._skip));
  }

  // Extract the leading date part of a sheet date string, normalized to
  // "M/D/YYYY". Handles date-only ("6/30/2026"), datetime ("7/2/2026, 12:15
  // PM" — what begin-call/disposition writes stamp into col G), 2-digit years
  // ("1/23/26"), and ISO ("2026-07-02…"). Returns null if unrecognized.
  function azDatePart(s) {
    const str = String(s).trim();
    let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(str);
    if (m) {
      let y = +m[3];
      if (y < 100) y += 2000;
      return `${+m[1]}/${+m[2]}/${y}`;
    }
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
    if (m) return `${+m[2]}/${+m[3]}/${+m[1]}`;
    return null;
  }

  // Numeric ordinal (YYYYMMDD) for an AZ date string, for before/after
  // comparisons. null if unparseable.
  function azDateOrdinal(s) {
    const p = azDatePart(s);
    if (!p) return null;
    const [m, d, y] = p.split("/").map(Number);
    return y * 10000 + m * 100 + d;
  }

  // Same AZ calendar date? Compares DATE PARTS only. Col G/H carry a time
  // component since the lead-locking change — an exact string compare here
  // was always false, which silently killed the same-day cap (leads got
  // re-dialed every 3 hours all day, e.g. attempts 4 AND 5 on the same day).
  function sameAzDate(dateStr, todayStr) {
    const a = azDatePart(dateStr), b = azDatePart(todayStr);
    return !!a && !!b && a === b;
  }

  // Cadence:
  //   Day 1: attempts 1+2 (double-tap morning) + 3 (three hours later)
  //   Day 2+: one attempt per day
  //   7th no-connect attempt: auto-Lost (server flips it on save too)
  // Through attempt 2 the next contact is "today + 3 hours" WITH time, so the
  // rep can see exactly when the callback is due ("5/28/2026 1:32 PM"). The
  // double-tap saves once with +2 attempts, so attemptsAfter === 2 IS the
  // first touch — it must still schedule the same-day 3-hour callback.
  // Attempts 3 through MAX_ATTEMPTS-1: tomorrow, date only.
  function computeNextContactDate(attemptsAfterCall) {
    if (attemptsAfterCall >= MAX_ATTEMPTS) return null;
    if (attemptsAfterCall <= 2) return azDateTimePlusHours(3);
    return azDatePlus(1);
  }

  function azDatePlus(days) {
    const azParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Phoenix", year: "numeric", month: "numeric", day: "numeric",
    }).formatToParts(new Date());
    const y = +azParts.find(p => p.type === "year").value;
    const m = +azParts.find(p => p.type === "month").value - 1;
    const d = +azParts.find(p => p.type === "day").value;
    const t = new Date(y, m, d + days);
    return `${t.getMonth() + 1}/${t.getDate()}/${t.getFullYear()}`;
  }

  // Returns an AZ-local timestamp `hoursAhead` hours from now, formatted as
  // "M/D/YYYY h:mm AM/PM" — the canonical Google Sheets datetime format.
  function azDateTimePlusHours(hoursAhead) {
    const target = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Phoenix",
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    }).formatToParts(target);
    const m = parts.find(p => p.type === "month").value;
    const d = parts.find(p => p.type === "day").value;
    const y = parts.find(p => p.type === "year").value;
    const h = parts.find(p => p.type === "hour").value;
    const min = parts.find(p => p.type === "minute").value;
    const ampm = parts.find(p => p.type === "dayPeriod").value.toUpperCase();
    return `${m}/${d}/${y} ${h}:${min} ${ampm}`;
  }

  // ── Quiet hours ──
  function inQuietHours() {
    const hourAz = parseInt(new Date().toLocaleString("en-US", {
      timeZone: "America/Phoenix", hour: "2-digit", hour12: false,
    }));
    return hourAz < QUIET_START_HOUR || hourAz >= QUIET_END_HOUR;
  }

  // ── Sheet log mirror ──
  // Every log() call queues into _logBuffer. A 5s interval POSTs the batch to
  // /api/dialer-debug-log which appends to a DialerLog tab in the Form Leads
  // sheet. When the extension version changes (i.e. Travis reloads after a
  // code change) we POST action=clear first so the sheet only reflects the
  // current build's session — easier to share with Opus for debugging.
  const LOG_FLUSH_MS = 5000;
  const LOG_BATCH_MAX = 100;
  let _logBuffer = [];
  let _logFlushing = false;
  let _logSheetEnabled = true;       // disable if endpoint repeatedly errors
  let _logConsecutiveErrors = 0;
  let _extensionVersion = "unknown";

  function queueLogEntry(entry) {
    if (!_logSheetEnabled) return;
    _logBuffer.push(entry);
    if (_logBuffer.length > LOG_BATCH_MAX * 5) {
      // Hard cap — drop oldest if we're falling way behind
      _logBuffer = _logBuffer.slice(-LOG_BATCH_MAX * 3);
    }
  }

  async function flushLogBuffer() {
    if (_logFlushing || !_logSheetEnabled || _logBuffer.length === 0) return;
    _logFlushing = true;
    const batch = _logBuffer.splice(0, LOG_BATCH_MAX);
    try {
      const r = await fetch(DEBUG_LOG_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "log",
          version: _extensionVersion,
          rep: repName,
          entries: batch,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      _logConsecutiveErrors = 0;
    } catch (e) {
      // Put the batch back at the front so we retry next tick
      _logBuffer = batch.concat(_logBuffer);
      _logConsecutiveErrors++;
      if (_logConsecutiveErrors >= 5) {
        _logSheetEnabled = false;
        // Log to UI only — bypass queue to avoid recursive flood
        const div = document.createElement("div");
        div.className = "err";
        div.textContent = `${new Date().toLocaleTimeString()} sheet log mirror disabled after 5 errors: ${e.message}`;
        els.log.appendChild(div);
      }
    } finally {
      _logFlushing = false;
    }
  }

  // Detect version change between runs. NOTE: we no longer clear the shared
  // sheet log on version change — the v2.1.43 rollout wiped every rep's
  // entries minutes after a mid-call hangup incident, destroying the
  // forensics. The DialerLog tab is rotated server-side instead (trim-on-
  // append in api/dialer-debug-log.js); the dialer just marks transitions.
  async function initSheetLogMirror() {
    try {
      _extensionVersion = chrome.runtime.getManifest().version;
    } catch (_) { _extensionVersion = "unknown"; }
    try {
      const stored = await chrome.storage.local.get(["dialer_log_last_version"]);
      const prev = stored.dialer_log_last_version;
      if (prev !== _extensionVersion) {
        await chrome.storage.local.set({ dialer_log_last_version: _extensionVersion });
        log(`━━ updated to v${_extensionVersion} (was ${prev || "first run"}) — log preserved ━━`, "info", "init");
      } else {
        log(`sheet log mirror active · version ${_extensionVersion} (unchanged)`, "info", "init");
      }
    } catch (e) {
      log(`sheet log init failed: ${e.message}`, "warn", "init");
    }
    setInterval(flushLogBuffer, LOG_FLUSH_MS);
  }

  // ── Sheet API ──
  // Debounce so two refresh triggers (pause-time + advanceToNext, or a
  // background tick that happens to fire near a dial completion) don't both
  // hit the API. force=true bypasses the debounce — used by manual Refresh
  // button + advanceToNext where freshness is required.
  const FETCH_DEBOUNCE_MS = 3000;
  let _lastFetchAt = 0;
  let _inflightFetch = null;
  async function fetchLeads({ force = false } = {}) {
    const now = Date.now();
    if (!force && (now - _lastFetchAt) < FETCH_DEBOUNCE_MS) return;
    // Coalesce concurrent callers onto a single in-flight request.
    if (_inflightFetch) return _inflightFetch;
    _lastFetchAt = now;
    _inflightFetch = (async () => {
      // ── Needs Rescheduled tab: pull Roofr jobs in "Needs Rescheduled" ──
      if (currentTab === "rescheduled") {
        log("fetching rescheduled jobs…", "info", "queue");
        try {
          const r = await fetch(RESCHEDULED_URL, { headers: { "Content-Type": "application/json", "X-Dialer-Client": "roofr-extension" } });
          const data = await r.json();
          if (!data.success) {
            log(`rescheduled API error: ${data.error || "unknown"}`, "err", "queue");
            return;
          }
          _rschedAll = data.jobs || [];
          log(`rescheduled loaded: ${_rschedAll.length} jobs`, "ok", "queue");
          renderRescheduledQueue();
        } catch (e) {
          log(`fetch rescheduled failed: ${e.message}`, "err", "queue");
        }
        return;
      }
      // ── Welcome Calls tab: Madi's post-sign welcome-call queue ──
      if (currentTab === "welcome") {
        log("fetching welcome calls…", "info", "queue");
        try {
          const r = await fetch(WELCOME_URL, { headers: { "Content-Type": "application/json", "X-Dialer-Client": "roofr-extension" } });
          const data = await r.json();
          if (data.configured === false || data.error) {
            log(`welcome-calls API error: ${data.error || "not configured"}`, "err", "queue");
            return;
          }
          _wcAll = data.rows || [];
          log(`welcome calls loaded: ${_wcAll.length}`, "ok", "queue");
          // Don't tear down an open card mid-call — only re-render when idle.
          if (_wcPhase === "idle") renderWelcomeQueue();
          else updateWelcomeBadge(wcDueCount(_wcAll));
        } catch (e) {
          log(`fetch welcome calls failed: ${e.message}`, "err", "queue");
        }
        return;
      }
      // ── Missed Calls tab: pull the server-side CTM missed/uncalled queue ──
      if (currentTab === "missed") {
        log("fetching missed calls from CTM…", "info", "queue");
        try {
          const [r] = await Promise.all([
            fetch(MISSED_CALLS_URL, { headers: { "Content-Type": "application/json", "X-Dialer-Client": "roofr-extension" } }),
            ensureRoofrJobMap(),
          ]);
          const data = await r.json();
          if (data.configured === false || data.error) {
            log(`missed-calls API error: ${data.error || "not configured"}`, "err", "queue");
            return;
          }
          _missedAll = buildMissedQueue(data.leads || []);
          queue = filterMissed(_missedAll);
          log(`missed calls loaded: ${_missedAll.length} (showing ${queue.length} · filter=${missedFilter})`, "ok", "queue");
          updateMissedBadge(_missedAll.length);
          updateMissedFilterCounts();
          renderQueue();
        } catch (e) {
          log(`fetch missed calls failed: ${e.message}`, "err", "queue");
        }
        return;
      }
      log("fetching leads from sheet…", "info", "queue");
      try {
        const r = await fetch(DISPOSITIONS_URL);
        const data = await r.json();
        if (!data.configured) {
          log(`leads API not configured: ${data.error || ""}`, "err", "queue");
          return;
        }
        queue = classifyAndSort(data);
        const t1 = queue.filter(l => l._tier === 1).length;
        const t2 = queue.filter(l => l._tier === 2).length;
        const t3 = queue.filter(l => l._tier === 3).length;
        log(`queue loaded: ${queue.length} leads (NEW=${t1} TODAY=${t2} WIP=${t3})`, "ok", "queue");
        renderQueue();
      } catch (e) {
        log(`fetch leads failed: ${e.message}`, "err", "queue");
      }
    })();
    try { await _inflightFetch; } finally { _inflightFetch = null; }
  }

  async function claimLead(phone, rowIndex, lead) {
    // Missed calls have no Google-Sheet row lock — single shared CTM source.
    // Claiming is a no-op; just take the lead.
    if (lead && lead.backend === "missed-calls") return true;
    try {
      // begin-call = claim + instant Attempted/LastContact/LastCSR sheet write,
      // so every other surface (dashboard, other dialers) sees this lead as
      // taken on their next poll — not 15 minutes later at wrap-up save.
      const r = await fetch(DISPOSITIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, rowIndex, action: "begin-call", rep: repName }),
      });
      const data = await r.json();
      if (data.claimed) {
        log(`claimed ${phone} for ${repName} (begin-call)`, "ok", "lock");
        startLockHeartbeat(phone, rowIndex);
        return true;
      }
      log(`claim refused for ${phone}: ${data.reason || "?"} (held by ${data.lockedBy || data.status || "?"})`, "warn", "lock");
      return false;
    } catch (e) {
      log(`claim error for ${phone}: ${e.message}`, "err", "lock");
      return false;
    }
  }

  // Lock renewal heartbeat — the 5-min lock TTL silently expired during long
  // calls/retries/wrap-up, letting a second rep claim the same lead mid-call
  // (the Madi/Diva double-call). Renew every 90s from claim until disposition
  // save or release. Renew is ownership-checked server-side: once the lock is
  // gone (disposition cleared it) it returns renewed:false and we stop.
  let _lockHeartbeat = null;
  function startLockHeartbeat(phone, rowIndex) {
    stopLockHeartbeat();
    _lockHeartbeat = setInterval(async () => {
      try {
        const r = await fetch(DISPOSITIONS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, rowIndex, action: "renew", rep: repName }),
        });
        const data = await r.json();
        if (!data.renewed) {
          log(`lock renew declined for ${phone} (${data.reason || data.error || "?"}) — stopping heartbeat`, "info", "lock");
          stopLockHeartbeat();
        }
      } catch (e) {
        log(`lock renew error for ${phone}: ${e.message}`, "warn", "lock");
      }
    }, 90 * 1000);
  }
  function stopLockHeartbeat() {
    if (_lockHeartbeat) { clearInterval(_lockHeartbeat); _lockHeartbeat = null; }
  }

  async function releaseLead(phone, rowIndex) {
    stopLockHeartbeat();
    try {
      await fetch(DISPOSITIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, rowIndex, action: "release", rep: repName }),
      });
      log(`released ${phone} (row ${rowIndex || "?"})`, "info", "lock");
    } catch (e) {
      log(`release error for ${phone}: ${e.message}`, "err", "lock");
    }
  }

  // Map a dialer wrap-up disposition → a lead-dispositions action for CTM
  // missed calls. attempt = stays active (retry later); responded/dismiss =
  // resolved, drops off the Missed Calls queue (and the Speed to Lead app).
  function mapMissedDisposition(status) {
    // "No Answer" → log an attempt; lead stays in queue, cadence advances,
    // auto-Losts at 7 attempts.
    if (status === "No Answer") return { action: "attempt", disposition: status };
    // Booked / Spam / Not Valid # / Not Qualified are in lead-dispositions'
    // resolved list → 'disposition' auto-dismisses them (closes the number out).
    if (["Booked", "Spam", "Not Valid #", "Not Qualified"].includes(status)) {
      return { action: "disposition", disposition: status };
    }
    // Left VM / Alex Callback aren't in the resolved list, so close them out
    // explicitly with 'dismiss'. (Label preserved in the attempt/dismiss note.)
    return { action: "dismiss", disposition: status };
  }

  async function saveMissedDisposition(lead, status, notes, opts) {
    const phone10 = lead.phone10 || (lead.phoneBare || lead.phone || "").replace(/\D/g, "").slice(-10);
    const { action, disposition } = mapMissedDisposition(status);
    // For attempt-type saves, record the disposition label in the attempt note
    // (the 'attempt' action doesn't store a disposition field server-side).
    let note = (action === "attempt" || action === "dismiss") ? (status + (notes ? " — " + notes : "")) : (notes || "");
    note += ((opts && opts.attemptIncrement === 2) ? ((note ? " " : "") + "on 2tap") : "");
    log(`saving missed disposition: ${phone10} → "${status}" (${action})${note ? " note: " + note : ""}`, "act", "wrap");
    try {
      const r = await fetch(MISSED_DISPOSITIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dialer-Client": "roofr-extension" },
        body: JSON.stringify({ emailId: phone10, prefix: "ctm", action, disposition, rep: repName, note: note || null }),
      });
      const data = await r.json();
      if (data && data.configured) log(`missed disposition saved ✓ ${phone10} → ${status}`, "ok", "wrap");
      else log(`missed disposition save failed: ${(data && data.error) || "?"}`, "err", "wrap");
    } catch (e) {
      log(`missed disposition error: ${e.message}`, "err", "wrap");
    }
  }

  async function saveDisposition(phone, status, notes, leadAtSaveTime, opts) {
    const _ld = leadAtSaveTime || currentLead;
    if (_ld && _ld.backend === "missed-calls") {
      return saveMissedDisposition(_ld, status, notes, opts);
    }
    try {
      const ld = leadAtSaveTime || currentLead;
      const attemptIncrement = (opts && opts.attemptIncrement) || 1;
      // Compute next contact date based on cadence (only for cadence-tracked statuses).
      const isAttempt = ATTEMPT_STATUSES.has((status || "").toLowerCase());
      let nextContactDate;
      if (isAttempt && ld) {
        const prior = parseInt(ld.attemptCount) || 0;
        const attemptsAfter = prior + attemptIncrement;
        nextContactDate = computeNextContactDate(attemptsAfter);
      }

      const body = { phone, rowIndex: ld?.rowIndex, status, rep: repName, notes, attemptIncrement };
      if (nextContactDate) body.nextContactDate = nextContactDate;

      log(`saving disposition: ${phone} (row ${ld?.rowIndex || "?"}) → "${status}" +${attemptIncrement}att${notes ? " note: " + notes : ""}${nextContactDate ? " · next: " + nextContactDate : ""}`, "act", "wrap");

      const r = await fetch(DISPOSITIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.updated) {
        log(`disposition saved ✓ ${phone} → ${status}`, "ok", "wrap");
        stopLockHeartbeat(); // server cleared the lock with the disposition
      } else {
        log(`disposition save failed: ${data.error || "?"}`, "err", "wrap");
      }
    } catch (e) {
      log(`disposition error: ${e.message}`, "err", "wrap");
    }
  }

  // ── CTM bridge messaging ──
  function sendToCtm(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "AD_TO_CTM", payload, windowId: currentWindowId }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(resp || { ok: false, error: "no response" });
        }
      });
    });
  }

  async function checkCtmTab() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "AD_PING_CTM", windowId: currentWindowId }, (resp) => {
        if (chrome.runtime.lastError || !resp) { resolve(false); return; }
        resolve(!!resp.ctmTabOpen);
      });
    });
  }

  function updateBridgeStatus() {
    if (!ctmTabOpen) {
      setPill(els.ctmPill, "bad", "CTM: tab missing");
      setPill(els.bridgePill, "bad", "Bridge: n/a");
      return;
    }
    setPill(els.ctmPill, "ok", "CTM: connected");
    setPill(els.bridgePill, bridgeReady ? "ok" : "warn", bridgeReady ? "Bridge: ready" : "Bridge: waiting");
  }

  // ── State transitions ──
  async function advanceToNext() {
    if (mode !== "running") {
      log(`advanceToNext skipped — mode=${mode}`, "info", "state");
      return;
    }
    // DEFENSIVE: never start a new dial while the wrap-up modal is showing.
    // hideWrapup() should always run before advanceToNext (it's called at the
    // top of finishWrapup) but this guard catches any future path that misses
    // it. Auto-dialing while the rep is still dispositioning is a hard "no".
    if (els.scrim?.classList.contains("show")) {
      log(`advanceToNext aborted — wrap-up modal is still open`, "warn", "state");
      return;
    }

    if (sessionCount >= sessionLimit) {
      log(`session limit reached (${sessionCount}/${sessionLimit}) — stopping`, "warn", "state");
      mode = "idle";
      currentLead = null;
      setPhase("idle");
      return;
    }

    if (inQuietHours()) {
      log("quiet hours active (8am-9pm AZ) — stopping", "warn", "state");
      mode = "idle";
      setPhase("idle");
      currentLead = null;
      renderCurrent();
      return;
    }

    // SOFTPHONE-BUSY HOLD: never auto-dial while a call is live on the
    // softphone — e.g. the rep answered an INBOUND call during wrap-up and
    // the 60s auto-advance fired mid-conversation. Recheck every 5s until it
    // frees up. Failsafe: CTM's late-event flush can wedge a stale ctm:start
    // in the flag — after 20 min assume stale and resume (the busy-at-dial
    // hangup guard still protects the live call even if this guess is wrong).
    if (softphoneBusy) {
      if (Date.now() - _busyChangedAt < BUSY_STUCK_MS) {
        if (Date.now() - _busyHoldLastLog > 55000) {
          _busyHoldLastLog = Date.now();
          log(`softphone has a live call — holding auto-dial until it ends`, "warn", "state");
        }
        clearTimeout(_busyDeferTimer);
        _busyDeferTimer = setTimeout(() => {
          if (mode === "running") advanceToNext();
        }, 5000);
        return;
      }
      log(`softphone busy flag stuck >20 min — assuming stale CTM event, resuming`, "warn", "state");
      softphoneBusy = false;
    }

    setPhase("fetching");
    // Re-fetch queue so locks from other reps + new leads are visible. Force
    // bypasses the debounce — pre-dial freshness is non-negotiable, even if
    // the pause-time fetch (a few seconds ago) was already recent.
    await fetchLeads({ force: true });

    // Find next claimable lead
    let lead = null;
    let skippedLocked = 0;
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (candidate.lockedBy && candidate.lockedBy !== repName) { skippedLocked++; continue; }
      const claimed = await claimLead(candidate.phone, candidate.rowIndex, candidate);
      if (claimed) { lead = candidate; break; }
    }
    if (skippedLocked > 0) log(`skipped ${skippedLocked} locked-by-other leads`, "info", "queue");

    if (!lead) {
      log("queue empty — no claimable leads, stopping", "warn", "state");
      mode = "idle";
      currentLead = null;
      setPhase("idle");
      return;
    }

    currentLead = lead;
    connectedThisCall = false;
    renderCurrent();
    renderQueue();

    const e164 = toE164(lead.phone);
    if (!e164) {
      log(`bad phone format: ${lead.phone}`, "err", "dial");
      await onCallEnded({ source: "format-error" });
      return;
    }

    // Look up outbound caller ID by source. dialer-sources.js defines the map.
    let outbound = null;
    try { outbound = (window.DialerSources || {}).lookupOutbound?.(lead.source); } catch (_) {}
    if (outbound) {
      log(`source "${lead.source || '(blank)'}" → outbound ${outbound.name} ${outbound.number}`, "info", "src");
    } else {
      log(`no outbound mapping for source "${lead.source}" — using CTM default`, "warn", "src");
    }
    // Missed-call leads carry a server-resolved outbound number (matched to the
    // tracking number they originally dialed, Main Line fallback). Prefer it.
    if (lead.fromNumber) {
      outbound = { number: lead.fromNumber, name: lead.source || "Missed Call" };
      log(`missed-call outbound → ${outbound.number} (${lead.source || "Main Line"})`, "info", "src");
    }

    setPhase("dialing");
    retriedOnMainLine = false;
    sessionCount++;
    if (els.sessionCount) els.sessionCount.textContent = sessionCount;
    _currentDialAt = Date.now();
    _currentFromNumber = outbound?.number || null;
    _busyAtDial = softphoneBusy;
    startCallTimer();
    log(`▶ DIALING ${leadTag(lead)} → ${e164} [${sessionCount}/${sessionLimit}] attempts=${lead.attemptCount || 0}`, "act", "dial");
    const resp = await sendToCtm({
      type: "dial",
      number: e164,
      fromNumber: outbound?.number || null,
      fromName: outbound?.name || null,
    });
    if (!resp.ok) {
      log(`dial command failed: ${resp.error || "?"}`, "err", "dial");
      await onCallEnded({ source: "dial-failed", reason: resp.error });
      return;
    }
    log(`dial command sent to CTM bridge`, "info", "dial");

    // Safety timer: if we never get a ctm:start, treat as no-answer
    clearTimeout(ringTimeoutId);
    ringTimeoutId = setTimeout(() => {
      if (phase === "dialing" || phase === "ringing") {
        log(`ring timeout (${RING_TIMEOUT_MS/1000}s) — no ctm:start received, treating as no-answer`, "warn", "dial");
        // NEVER blind-hangup if the softphone already had a live call when we
        // dialed — CTM's hangup ends WHATEVER call is active (it once killed a
        // rep's in-progress inbound call).
        if (_busyAtDial) log(`skipping hangup — softphone had a live call at dial time`, "warn", "dial");
        else sendToCtm({ type: "hangup" }).catch(() => {});
        onCallEnded({ source: "ring-timeout" });
      }
    }, RING_TIMEOUT_MS);
  }

  async function onCallEnded({ source }) {
    clearTimeout(ringTimeoutId);
    stopCallTimer();
    if (!currentLead) {
      log(`call-ended (${source}) but no currentLead — ignoring`, "info", "call");
      return;
    }
    if (phase === "wrapup") {
      log(`call-ended (${source}) but already in wrap-up — ignoring`, "info", "call");
      return;
    }
    if (phase === "retrying") {
      log(`call-ended (${source}) during retry pause — ignoring stale event`, "info", "retry");
      return;
    }

    const callDurationMs = callStartMs ? (Date.now() - callStartMs) : 0;
    log(`call ended via ${source} · connected=${connectedThisCall} duration=${Math.round(callDurationMs/1000)}s attempts-going-in=${currentLead.attemptCount || 0}`, "info", "call");

    // AUTO-RETRY on the Main Line. Two failure modes both mean "this outbound
    // caller ID didn't work — try the number CTM definitely allows outbound":
    //   (a) call CONNECTED then dropped in <5s (ctm:start fired, instant drop).
    //   (b) call NEVER connected and ended fast (<12s) and NOT via the 35s
    //       no-answer timeout — i.e. the "rings once and hangs up" signature of
    //       CTM rejecting a tracking number that isn't outbound-enabled, or an
    //       explicit ctm:failed. A real no-answer rings to the 35s ring-timeout
    //       (or hits voicemail, which fires ctm:start) so it won't match here.
    // (b) only helps if we WEREN'T already on the Main Line — a different caller
    // ID is the whole point. (a) keeps its original behavior (retry regardless).
    const dialElapsedMs = _currentDialAt ? (Date.now() - _currentDialAt) : 0;
    const fromWasMainLine = !_currentFromNumber || _currentFromNumber === AUTO_RETRY_NUMBER;
    const connectedFastDrop = connectedThisCall && callDurationMs > 0 && callDurationMs < AUTO_RETRY_THRESHOLD_MS;
    const isHardFail = source === "failed" || source === "dial-failed";
    const instantReject = !connectedThisCall && !fromWasMainLine && (
      isHardFail ||
      (source !== "ring-timeout" && source !== "retry-timeout" && dialElapsedMs > 0 && dialElapsedMs < NEVER_CONNECT_RETRY_MS)
    );
    if ((connectedFastDrop || instantReject) && !retriedOnMainLine) {
      retriedOnMainLine = true;
      const why = connectedFastDrop
        ? `ultra-short call (${Math.round(callDurationMs/1000)}s)`
        : `one-ring/no-connect (${Math.round(dialElapsedMs/1000)}s via ${source}) from ${_currentFromNumber || "default"}`;
      log(`${why} — retrying on Main Line in 2s`, "warn", "retry");
      phase = "retrying";
      connectedThisCall = false;
      callStartMs = 0;
      els.current.classList.remove("empty");
      els.current.innerHTML = `<div style="text-align:center;padding:14px;"><div class="phase" style="background:var(--warn-bg);color:#92400e;">retrying on main line</div><div style="margin-top:8px;color:var(--muted);font-size:12px;">${escapeHtml(currentLead.name || "")} ${escapeHtml(currentLead.phone)}</div></div>`;
      setTimeout(async () => {
        if (phase !== "retrying" || !currentLead) return;
        const e164 = toE164(currentLead.phone);
        if (!e164) { onCallEnded({ source: "retry-bad-phone" }); return; }
        _currentDialAt = Date.now();
        _currentFromNumber = AUTO_RETRY_NUMBER;
        _busyAtDial = softphoneBusy;
        startCallTimer();
        setPhase("dialing");
        const resp = await sendToCtm({
          type: "dial",
          number: e164,
          fromNumber: AUTO_RETRY_NUMBER,
          fromName: "Main Line (auto-retry)",
        });
        if (resp.ok) {
          log(`retry dial sent on Main Line`, "info", "retry");
          clearTimeout(ringTimeoutId);
          ringTimeoutId = setTimeout(() => {
            if (phase === "dialing" || phase === "ringing") {
              log(`retry ring timeout — treating as no-answer`, "warn", "retry");
              if (_busyAtDial) log(`skipping hangup — softphone had a live call at dial time`, "warn", "retry");
              else sendToCtm({ type: "hangup" }).catch(() => {});
              onCallEnded({ source: "retry-timeout" });
            }
          }, RING_TIMEOUT_MS);
        } else {
          log(`retry dial failed: ${resp.error || "?"} — falling through to wrap-up`, "err", "retry");
          onCallEnded({ source: "retry-dial-failed" });
        }
      }, 2000);
      return;
    }

    setPhase("wrapup");

    // SHORT-CALL AUTO-DISPOSITION: if ≤15s and connected, almost certainly VM.
    // Pre-set to "Attempted" with a shorter wrap-up timer so the rep moves faster.
    const isShortCall = connectedThisCall && callDurationMs > 0 && callDurationMs <= SHORT_CALL_THRESHOLD_MS;

    const defaultStatus = isInDoubleTap && doubleTapPriorStatus
      ? doubleTapPriorStatus
      : "Attempted";
    showWrapup(defaultStatus, isShortCall);
  }

  // ── Wrap-up modal ──
  // Disposition cannot be dismissed by clicking the scrim or pressing Escape.
  // A 60s auto-fire timer runs and triggers Save → Next; the timer RESETS to
  // full 60s every time the rep types in notes or changes the dropdown, so
  // active engagement never cuts off the rep mid-disposition. If they walk
  // away with the modal idle, it auto-fires with whatever's currently set.
  let wrapupActiveLead = null;
  let wrapupTimerId = null;
  let wrapupDeadlineMs = 0;
  // Swap the disposition dropdown to match the active lead's source.
  function setWrapupDispositions(backend) {
    const opts = backend === "missed-calls" ? MISSED_DISPOSITIONS : LEADS_DISPOSITIONS;
    const desired = JSON.stringify(opts);
    if (els.wrapupStatus.dataset.optset === desired) return; // already correct
    els.wrapupStatus.innerHTML = opts.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");
    els.wrapupStatus.dataset.optset = desired;
  }

  function showWrapup(defaultStatus, isShortCall) {
    wrapupActiveLead = currentLead;
    setWrapupDispositions(wrapupActiveLead && wrapupActiveLead.backend);
    const dtPrefix = isInDoubleTap ? "DOUBLE TAP — " : "";
    const shortTag = isShortCall ? " (short call)" : "";
    els.wrapupTitle.textContent = `${dtPrefix}Wrap up — ${wrapupActiveLead.name || wrapupActiveLead.phone}${shortTag}`;
    if (isInDoubleTap) {
      els.wrapupTitle.style.color = "var(--danger)";
    } else if (isShortCall) {
      els.wrapupTitle.style.color = "var(--warn)";
    } else {
      els.wrapupTitle.style.color = "";
    }
    const options = Array.from(els.wrapupStatus.options).map(o => o.value);
    const finalDefault = options.includes(defaultStatus) ? defaultStatus : options[0];
    els.wrapupStatus.value = finalDefault;
    els.wrapupNotes.value = isInDoubleTap ? (doubleTapPriorNotes || "") : "";
    els.scrim.classList.add("show");
    const modalEl = els.scrim.querySelector(".modal");
    if (modalEl) {
      modalEl.classList.remove("fresh");
      void modalEl.offsetWidth;
      modalEl.classList.add("fresh");
    }
    log(`wrap-up opened for ${leadTag(wrapupActiveLead)} (default: ${finalDefault}${isInDoubleTap ? ", DOUBLE TAP 2of2" : ""}${isShortCall ? ", SHORT CALL — 15s timer" : ""})`, "act", "wrap");
    startWrapupAutoFire(isShortCall);
    // Focus the disposition dropdown (not notes) so the rep can pick hands-free:
    // type-ahead (press "b" → Booked) or ↑/↓ arrows, then Enter to Save → Next.
    setTimeout(() => { try { els.wrapupStatus.focus(); } catch (_) {} }, 50);
  }

  function hideWrapup() {
    els.scrim.classList.remove("show");
    wrapupActiveLead = null;
    stopWrapupAutoFire();
  }

  function startWrapupAutoFire(isShortCall) {
    stopWrapupAutoFire();
    wrapupDeadlineMs = Date.now() + (isShortCall ? SHORT_WRAPUP_MS : WRAPUP_AUTOFIRE_MS);
    renderWrapupCountdown();
    wrapupTimerId = setInterval(() => {
      const remaining = wrapupDeadlineMs - Date.now();
      if (remaining <= 0) {
        log(`auto-advance fired — saving with current values`, "warn", "wrap");
        stopWrapupAutoFire();
        finishWrapup(true);
        return;
      }
      renderWrapupCountdown();
    }, 500);
  }

  function stopWrapupAutoFire() {
    if (wrapupTimerId) clearInterval(wrapupTimerId);
    wrapupTimerId = null;
  }

  function resetWrapupAutoFire(reason) {
    if (!wrapupTimerId) return; // modal not open
    wrapupDeadlineMs = Date.now() + WRAPUP_INTERACTION_RESET_MS;
    renderWrapupCountdown();
    // Don't log every keystroke — would flood the log
    if (reason === "dropdown") log(`disposition changed → ${els.wrapupStatus.value} (timer reset)`, "info", "wrap");
  }

  function renderWrapupCountdown() {
    if (!els.wrapupHelp) return;
    const remaining = Math.max(0, Math.ceil((wrapupDeadlineMs - Date.now()) / 1000));
    els.wrapupHelp.innerHTML =
      `Auto-saving in <strong>${remaining}s</strong> · <strong>Enter</strong> → Note → <strong>Enter</strong> Save·Next · <strong>Esc</strong> Save·Stop`;
  }

  async function finishWrapup(advance) {
    if (!wrapupActiveLead) return;
    const savedLead = wrapupActiveLead;
    const phone = savedLead.phone;
    const status = els.wrapupStatus.value;
    const notes = els.wrapupNotes.value.trim();
    const rowIndex = savedLead.rowIndex;
    const priorAttempts = parseInt(savedLead.attemptCount) || 0;
    log(`save → ${advance ? "Next" : "Stop"} clicked for ${leadTag(savedLead)} → ${status}`, "act", "wrap");
    hideWrapup();

    // CASE A: We're CURRENTLY in a double-tap (this is the 2nd save). Write
    // the final disposition with attemptIncrement=2 (we dialed twice).
    if (isInDoubleTap) {
      log(`double-tap complete — final disposition: ${status} (writing once with attempts +2)`, "act", "dial");
      const dtNotes = notes ? `${notes} on 2tap` : "on 2tap";
      await saveDisposition(phone, status, dtNotes, savedLead, { attemptIncrement: 2 });
      pushCompleted({ phone, name: savedLead.name, status, attempts: priorAttempts + 2 });
      // Block from re-queue this session
      if (rowIndex) removedThisSession.add(rowIndex);
    else if (savedLead.backend === "missed-calls") removedThisSession.add("m:" + (savedLead.phoneBare || (savedLead.phone || "").replace(/\D/g, "")));
      isInDoubleTap = false;
      doubleTapPriorStatus = null;
      doubleTapPriorNotes = "";
      doubleTapLead = null;
      currentLead = null;
      if (advance && mode === "running") advanceAfterPause();
      else { mode = "idle"; setPhase("idle"); }
      return;
    }

    // CASE B: First call on a fresh lead saved as "Attempted" → trigger
    // double-tap. DO NOT write to sheet yet — hold disposition in memory,
    // immediately redial. The 2nd save will be the one that writes.
    // Double-tap on the FIRST attempt: form leads use "Attempted"; missed
    // calls use any active disposition (No Answer / Left VM / Alex Callback).
    const isMissedActive = savedLead.backend === "missed-calls" && MISSED_ACTIVE_DISPOSITIONS.includes(status);
    const shouldDoubleTap =
      advance && mode === "running" &&
      priorAttempts === 0 &&
      (status === "Attempted" || isMissedActive);

    if (shouldDoubleTap) {
      log(`★★ DOUBLE-TAP triggered — holding "${status}" disposition, re-dialing ${phone} now`, "act", "dial");
      isInDoubleTap = true;
      doubleTapPriorStatus = status;
      doubleTapPriorNotes = notes;
      doubleTapLead = savedLead;
      currentLead = null;
      await redialDoubleTap(savedLead);
      return;
    }

    // CASE C: Normal single-call save.
    if (rowIndex) removedThisSession.add(rowIndex);
    else if (savedLead.backend === "missed-calls") removedThisSession.add("m:" + (savedLead.phoneBare || (savedLead.phone || "").replace(/\D/g, "")));
    await saveDisposition(phone, status, notes, savedLead);
    pushCompleted({ phone, name: savedLead.name, status, attempts: priorAttempts + 1 });
    currentLead = null;
    if (advance && mode === "running") advanceAfterPause();
    else { mode = "idle"; setPhase("idle"); }
  }

  function advanceAfterPause() {
    if (INTER_CALL_PAUSE_MS <= 0) { advanceToNext(); return; }
    els.current.classList.remove("empty");
    let remaining = Math.ceil(INTER_CALL_PAUSE_MS / 1000);
    els.current.innerHTML = `<div style="text-align:center;color:var(--muted);padding:10px;"><div style="font-size:20px;font-weight:600;font-variant-numeric:tabular-nums;">${remaining}s</div><div style="font-size:11px;margin-top:4px;">Next call in...</div></div>`;
    // Fresh-pull the queue during the inter-call pause so the visible list
    // reflects what other reps have done since the previous fetch. This is
    // additive — advanceToNext also re-fetches before claiming, this just
    // makes the queue UI accurate during the pause so reps see leads
    // disappear in real time as other reps complete them.
    fetchLeads().catch(() => {});
    const countdown = setInterval(() => {
      remaining--;
      if (remaining <= 0 || mode !== "running") {
        clearInterval(countdown);
        if (mode === "running") advanceToNext();
        return;
      }
      const el = els.current.querySelector("div > div");
      if (el) el.textContent = `${remaining}s`;
    }, 1000);
  }

  // Re-dial the same lead immediately for the double-tap second call. Bypasses
  // claim/queue logic since we already had this lead claimed. Renders the big
  // red DOUBLE TAP banner on the current-call card. After this call ends, the
  // wrap-up opens with the prior disposition pre-filled (rep can override) and
  // the 2nd save is what writes to the sheet (with attemptIncrement=2).
  async function redialDoubleTap(lead) {
    currentLead = lead;
    connectedThisCall = false;
    renderCurrent(); // shows the red banner because isInDoubleTap=true
    const e164 = toE164(lead.phone);
    if (!e164) {
      log(`double-tap aborted - bad phone format: ${lead.phone}`, "err", "dial");
      isInDoubleTap = false;
      doubleTapPriorStatus = null;
      doubleTapPriorNotes = "";
      doubleTapLead = null;
      advanceToNext();
      return;
    }
    let outbound = null;
    try { outbound = (window.DialerSources || {}).lookupOutbound?.(lead.source); } catch (_) {}
    // Missed-call leads carry a server-resolved outbound (the tracking number
    // they dialed). Honor it on the 2nd double-tap too, like the primary path.
    if (lead.fromNumber) outbound = { number: lead.fromNumber, name: lead.source || "Missed Call" };
    setPhase("dialing");
    retriedOnMainLine = false;
    sessionCount++;
    if (els.sessionCount) els.sessionCount.textContent = sessionCount;
    _currentDialAt = Date.now();
    _currentFromNumber = outbound?.number || null;
    _busyAtDial = softphoneBusy;
    log(`▶ DIALING (double-tap #2) ${leadTag(lead)} → ${e164} [${sessionCount}/${sessionLimit}]`, "act", "dial");
    const resp = await sendToCtm({
      type: "dial",
      number: e164,
      fromNumber: outbound?.number || null,
      fromName: outbound?.name || null,
    });
    if (!resp.ok) {
      log(`double-tap dial failed: ${resp.error || "?"}`, "err", "dial");
      isInDoubleTap = false;
      doubleTapPriorStatus = null;
      doubleTapPriorNotes = "";
      doubleTapLead = null;
      advanceToNext();
      return;
    }
    clearTimeout(ringTimeoutId);
    ringTimeoutId = setTimeout(() => {
      if (phase === "dialing" || phase === "ringing") {
        log(`double-tap ring timeout — treating as no-answer`, "warn", "dial");
        if (_busyAtDial) log(`skipping hangup — softphone had a live call at dial time`, "warn", "dial");
        else sendToCtm({ type: "hangup" }).catch(() => {});
        onCallEnded({ source: "double-tap-timeout" });
      }
    }, RING_TIMEOUT_MS);
  }

  // ── In-session "Completed" list ──
  // The "Done" list is a rolling DAILY tally: it persists across Stop→Start
  // (so a rep's count + history survive breaks) and only resets at AZ midnight.
  // Backed by chrome.storage.local so it also survives a panel reload.
  function rollDailyIfNeeded() {
    const today = azDatePlus(0);
    if (_dailyDoneDate && _dailyDoneDate !== today) {
      completedThisSession.length = 0; // new day → fresh tally
    }
    _dailyDoneDate = today;
  }
  function persistDailyDone() {
    try {
      chrome.storage.local.set({ [DAILY_DONE_KEY]: { date: _dailyDoneDate, done: completedThisSession } });
    } catch (_) {}
  }
  async function loadDailyDone() {
    try {
      const s = await chrome.storage.local.get([DAILY_DONE_KEY]);
      const saved = s && s[DAILY_DONE_KEY];
      const today = azDatePlus(0);
      _dailyDoneDate = today;
      if (saved && saved.date === today && Array.isArray(saved.done)) {
        completedThisSession.length = 0;
        completedThisSession.push(...saved.done);
      }
    } catch (_) {}
    renderCompleted();
  }

  // After each disposition save, push a row into the daily Done list, persist it,
  // and render. Gives a clear visual that the queue is moving + a running total.
  function pushCompleted(item) {
    rollDailyIfNeeded();
    completedThisSession.push(item);
    persistDailyDone();
    renderCompleted();
  }
  function renderCompleted() {
    const el = els.completed;
    if (els.doneToday) els.doneToday.textContent = completedThisSession.length;
    if (!el) return;
    if (completedThisSession.length === 0) {
      el.innerHTML = "<em style='color:var(--muted);'>None yet today.</em>";
      return;
    }
    el.innerHTML = completedThisSession.slice().reverse().map(c => {
      return `<li>
        <span style="color:var(--success);font-weight:600;">✓</span>
        <span class="name">${escapeHtml(c.name || "(no name)")}</span>
        <span class="meta">${escapeHtml(c.phone)}</span>
        ${statusPillHtml(c.status)}
      </li>`;
    }).join("");
  }

  // ── Button handlers ──
  let _ensuringCtm = false;
  async function ensureCtmTabOnLoad() {
    if (_ensuringCtm) return;
    _ensuringCtm = true;
    try {
      log("no CTM /calls/desk tab in this window — opening to the left…", "info", "init");
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "AD_ENSURE_CTM_DESK", windowId: currentWindowId }, () => resolve());
      });
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 1500));
        const open = await checkCtmTab();
        if (open) {
          ctmTabOpen = true;
          updateBridgeStatus();
          setPhase(phase);
          log("CTM tab opened", "ok", "init");
          return;
        }
      }
    } finally {
      _ensuringCtm = false;
    }
  }

  async function ensureCtmTab() {
    if (ctmTabOpen && bridgeReady) return true;
    if (!ctmTabOpen) {
      log("CTM tab not found in this window — opening to the left…", "info", "ui");
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "AD_ENSURE_CTM_DESK", windowId: currentWindowId }, () => resolve());
      });
    }
    // Wait up to 15s for CTM tab + bridge to be ready
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1000));
      const open = await checkCtmTab();
      if (open !== ctmTabOpen) {
        ctmTabOpen = open;
        updateBridgeStatus();
      }
      if (ctmTabOpen && bridgeReady) {
        log("CTM tab ready", "ok", "ui");
        return true;
      }
      if (ctmTabOpen && !bridgeReady) {
        const resp = await sendToCtm({ type: "ping" });
        if (resp.ok) continue;
      }
    }
    log("timed out waiting for CTM bridge — try reloading the CTM tab", "err", "ui");
    return false;
  }

  els.startBtn.onclick = async () => {
    if (currentTab === "welcome") { wcStartQueue(); return; }
    if (currentTab === "rescheduled") { rschedStartQueue(); return; }
    if (mode === "running") return;
    if (inQuietHours()) { log("can't start — outside quiet hours (8am-9pm AZ only)", "err", "ui"); return; }
    const ready = await ensureCtmTab();
    if (!ready) return;
    sessionCount = 0; // per-run pacing cap counter; the Done list is daily (kept)
    rollDailyIfNeeded(); // clears the Done list only if the AZ day rolled over
    renderCompleted();
    // NOTE: do NOT clear removedThisSession here — user-removed leads should stay
    // removed across Start/Stop cycles within the same dialer window.
    mode = "running";
    log(`▶ START clicked — session limit: ${sessionLimit} calls · test=${testMode ? "ON" : "off"}`, "act", "ui");
    setPhase("fetching");
    advanceToNext();
  };

  // (Pause button removed — Start always begins a fresh, current queue; the
  // only "paused" state left is the automatic tab-switch safety below, which
  // auto-resumes when the rep returns to the Dialer tab.)

  els.stopBtn.onclick = async () => {
    log("⏹ STOP clicked", "act", "ui");
    mode = "stopping";
    if (currentLead) {
      await sendToCtm({ type: "hangup" }).catch(() => {});
      await releaseLead(currentLead.phone, currentLead.rowIndex);
      currentLead = null;
    }
    mode = "idle";
    setPhase("idle");
  };

  function onHangupClick() {
    log(`☎ HANGUP clicked for ${leadTag(currentLead)}`, "act", "ui");
    // Fire-and-forget the hangup command — CTM takes a moment to actually end
    // the call and emit ctm:end-activity. Don't wait; surface the wrap-up
    // modal immediately so the rep can disposition without dead air.
    sendToCtm({ type: "hangup" }).catch(() => {});
    if (currentLead && phase !== "wrapup") {
      onCallEnded({ source: "user-hangup" });
    }
  }

  els.wrapupSaveNext.onclick = () => finishWrapup(true);
  els.wrapupSaveStop.onclick = () => { mode = "idle"; finishWrapup(false); };
  els.settingsBtn.onclick = () => chrome.runtime.openOptionsPage();

  // ── Tab switching: Leads (Google Sheet) ↔ Missed Calls (CTM) ──
  function switchTab(tab) {
    if (tab === currentTab) return;
    // Never swap the queue out from under an active call (leads/missed OR a
    // rescheduled call in progress).
    if (mode === "running" || ["dialing", "ringing", "connected", "wrapup"].includes(phase) || _rschedPhase === "calling" || _wcPhase === "calling") {
      log("can't switch tabs mid-call — stop the dialer first", "warn", "state");
      return;
    }
    // Leaving the rescheduled tab: tear down any open review card/timer.
    if (currentTab === "rescheduled" && tab !== "rescheduled") rschedReset();
    // Leaving the welcome tab: release any held lock + tear down the card.
    if (currentTab === "welcome" && tab !== "welcome") wcReset();
    currentTab = tab;
    queue = [];
    const isResched = tab === "rescheduled";
    const isWelcome = tab === "welcome";
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    if (els.queueHeader) els.queueHeader.textContent = tab === "missed" ? "Missed Calls" : "Queue";
    if (els.refreshBtn) els.refreshBtn.title = tab === "missed" ? "Resync missed calls from CTM" : "Resync queue from Google Sheet";
    // Standard queue view vs the rescheduled panel.
    const stdView = document.getElementById("standard-queue-view");
    const rschedMain = document.getElementById("rescheduled-main");
    const welcomeMain = document.getElementById("welcome-main");
    if (stdView) stdView.style.display = (isResched || isWelcome) ? "none" : "";
    if (rschedMain) rschedMain.style.display = isResched ? "" : "none";
    if (welcomeMain) welcomeMain.style.display = isWelcome ? "" : "none";
    // Filter panels: leads / missed / rescheduled / welcome each show only their own.
    const mfPanel = document.getElementById("missed-filter-panel");
    const rschedPanel = document.getElementById("rescheduled-filter-panel");
    const welcomePanel = document.getElementById("welcome-filter-panel");
    if (mfPanel) mfPanel.style.display = tab === "missed" ? "" : "none";
    if (rschedPanel) rschedPanel.style.display = isResched ? "" : "none";
    if (welcomePanel) welcomePanel.style.display = isWelcome ? "" : "none";
    if (els.filterPanel) els.filterPanel.style.display = tab === "leads" ? "" : "none";
    log(`switched to ${{ leads: "Leads", missed: "Missed Calls", rescheduled: "Rescheduled", welcome: "Welcome Calls" }[tab] || tab} tab`, "info", "ui");
    renderQueue();
    fetchLeads({ force: true });
  }
  document.getElementById("tab-leads")?.addEventListener("click", () => switchTab("leads"));
  document.getElementById("tab-missed")?.addEventListener("click", () => switchTab("missed"));
  document.getElementById("tab-rescheduled")?.addEventListener("click", () => switchTab("rescheduled"));
  document.getElementById("tab-welcome")?.addEventListener("click", () => switchTab("welcome"));
  document.querySelectorAll(".mfilter").forEach(btn =>
    btn.addEventListener("click", () => setMissedFilter(btn.dataset.mf)));
  rschedBindButtons();
  wcBindButtons();
  // Prime the Missed Calls badge once on load (independent of the active tab).
  (async () => {
    try {
      const r = await fetch(MISSED_CALLS_URL, { headers: { "Content-Type": "application/json", "X-Dialer-Client": "roofr-extension" } });
      const data = await r.json();
      if (Array.isArray(data.leads)) updateMissedBadge(data.leads.length);
    } catch (_) {}
  })();
  // Prime the Rescheduled badge once on load.
  (async () => {
    try {
      const r = await fetch(RESCHEDULED_URL, { headers: { "Content-Type": "application/json", "X-Dialer-Client": "roofr-extension" } });
      const data = await r.json();
      if (data.success && Array.isArray(data.jobs)) updateRescheduledBadge(data.jobs.length);
    } catch (_) {}
  })();
  // Prime the Welcome Calls badge once on load (counts only due/overdue rows).
  (async () => {
    try {
      const r = await fetch(WELCOME_URL, { headers: { "Content-Type": "application/json", "X-Dialer-Client": "roofr-extension" } });
      const data = await r.json();
      if (Array.isArray(data.rows)) updateWelcomeBadge(wcDueCount(data.rows));
    } catch (_) {}
  })();

  // Engagement → reset the 60s auto-fire so the rep is never cut off mid-typing
  els.wrapupNotes.addEventListener("input", () => resetWrapupAutoFire("notes"));
  els.wrapupNotes.addEventListener("focus", () => resetWrapupAutoFire("focus"));
  els.wrapupStatus.addEventListener("change", () => resetWrapupAutoFire("dropdown"));

  // Block accidental dismissal of the wrap-up modal.
  // Clicking the scrim background or pressing Escape used to close the modal
  // before disposition was saved. Now they're explicit no-ops with a hint.
  els.scrim.addEventListener("click", (e) => {
    if (e.target === els.scrim) {
      log("click outside modal ignored — disposition is required", "warn", "ui");
      if (els.wrapupHelp) {
        els.wrapupHelp.textContent = "Disposition required — press Enter (or click Save → Next) to dismiss.";
        els.wrapupHelp.style.color = "var(--danger)";
        setTimeout(() => { if (els.wrapupHelp) els.wrapupHelp.style.color = ""; }, 1200);
      }
    }
  });
  // ── Keyboard-only call handling (no mouse needed) ──
  //   • During a live call:  Esc  → hang up + open wrap-up
  //   • In the wrap-up modal, two taps of Enter:
  //       1st (on the disposition dropdown) → jump to the Note field, like Tab
  //       2nd (in the Note field)           → Save → Next (advance)
  //     ↑/↓ or type-ahead pick the disposition (native); Shift+Enter in the
  //     Note field = newline.
  //   • Esc in the Note field → Save → Stop (record this call, end the session).
  //     Esc on the dropdown is ignored so a reflex double-tap of the hang-up
  //     Esc doesn't accidentally stop the dialer the instant wrap-up opens.
  document.addEventListener("keydown", (e) => {
    const wrapOpen = els.scrim.classList.contains("show");

    if (wrapOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (document.activeElement === els.wrapupNotes) {
          log("⎋ Esc → Save → Stop (keyboard)", "act", "ui");
          mode = "idle";
          finishWrapup(false);
        } else {
          log("Escape ignored — press Enter to reach the Note field, then Esc to stop", "warn", "ui");
        }
        return;
      }
      if (e.key === "Enter") {
        // First Enter on the dropdown acts like Tab → move to the Note field.
        if (document.activeElement === els.wrapupStatus) {
          e.preventDefault();
          e.stopPropagation();
          try { els.wrapupNotes.focus(); } catch (_) {}
          log("⏎ Enter → Note field (keyboard)", "act", "ui");
          return;
        }
        // Shift+Enter in the Note field inserts a newline instead of saving.
        if (document.activeElement === els.wrapupNotes && e.shiftKey) return;
        // Second Enter (from the Note field, or anywhere else) saves & advances.
        e.preventDefault();
        e.stopPropagation();
        log("⏎ Enter → Save → Next (keyboard)", "act", "ui");
        finishWrapup(true);
      }
      return;
    }

    // Live call → Esc hangs up and pops the wrap-up modal, no mouse required.
    if (e.key === "Escape" && ["dialing", "ringing", "connected"].includes(phase)) {
      e.preventDefault();
      e.stopPropagation();
      log("⎋ Esc → hang up (keyboard)", "act", "ui");
      onHangupClick();
    }
  }, true);

  els.testModeToggle.addEventListener("change", async () => {
    testMode = els.testModeToggle.checked;
    try { chrome.storage.sync.set({ dialer_test_mode: testMode }); } catch (_) {}
    log(`TEST MODE ${testMode ? "ON — queue limited to Dialer Test rows" : "OFF — full queue restored"}`, "act", "ui");
    await fetchLeads();
  });

  els.queue.addEventListener("click", (e) => {
    // Phone-number clicks open CTM filtered to that number, reusing the
    // existing CTM tab if one is open. Cmd/Ctrl/shift/middle-click still
    // honors the <a href> default (new tab).
    const phoneLink = e.target.closest(".phone-link");
    if (phoneLink && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
      e.preventDefault();
      const url = phoneLink.getAttribute("href");
      try {
        chrome.tabs.query({ url: "https://app.calltrackingmetrics.com/*" }, (tabs) => {
          if (chrome.runtime.lastError) { window.open(url, "_blank"); return; }
          if (tabs && tabs.length > 0) {
            chrome.tabs.update(tabs[0].id, { active: true, url });
            chrome.windows.update(tabs[0].windowId, { focused: true });
          } else {
            chrome.tabs.create({ url });
          }
        });
      } catch (_) {
        window.open(url, "_blank");
      }
      return;
    }
    // Customer-name clicks open that lead's Roofr job card. Routed through
    // chrome.tabs because a bare <a target="_blank"> doesn't reliably navigate
    // from inside the side panel. Must come BEFORE the .copyable branch — the
    // name link is also .copyable, and we want "open job card", not "copy name".
    const jobLink = e.target.closest(".job-link");
    if (jobLink && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
      e.preventDefault();
      const url = jobLink.getAttribute("href");
      if (url) {
        try { chrome.tabs.create({ url }); }
        catch (_) { window.open(url, "_blank"); }
      }
      return;
    }
    const el = e.target.closest(".copyable");
    if (!el || !el.dataset.copy) return;
    navigator.clipboard.writeText(el.dataset.copy).then(() => {
      const orig = el.textContent;
      el.textContent = "copied!";
      setTimeout(() => { el.textContent = orig; }, 800);
    }).catch(() => {});
  });

  els.refreshBtn?.addEventListener("click", async () => {
    log("↻ refresh clicked — re-syncing queue from sheet", "act", "ui");
    els.refreshBtn.disabled = true;
    els.refreshBtn.textContent = "↻ Refreshing…";
    try {
      await fetchLeads({ force: true });
    } finally {
      els.refreshBtn.textContent = "↻ Refresh";
      els.refreshBtn.disabled = false;
    }
  });

  els.logCopyBtn.addEventListener("click", async () => {
    // Use the full _logHistory buffer (up to 2000 entries, ASCII-safe) instead
    // of innerText — the UI only renders the most recent 500 entries, and
    // innerText would also include emoji/unicode that mangles when pasted.
    const txt = _logHistory.join("\n");
    try {
      await navigator.clipboard.writeText(txt);
      els.logCopyBtn.textContent = `✓ Copied ${_logHistory.length} lines`;
      setTimeout(() => { els.logCopyBtn.textContent = "📋 Copy"; }, 1800);
    } catch (e) {
      els.logCopyBtn.textContent = "✗ Failed";
      setTimeout(() => { els.logCopyBtn.textContent = "📋 Copy"; }, 1500);
    }
  });

  els.logClearBtn?.addEventListener("click", () => {
    els.log.innerHTML = "";
    _logHistory.length = 0;
    log("log cleared", "info", "ui");
  });

  els.sessionLimitInput.addEventListener("change", () => {
    const n = parseInt(els.sessionLimitInput.value) || 25;
    sessionLimit = Math.min(100, Math.max(5, n));
    els.sessionLimitInput.value = sessionLimit;
    els.sessionLimitDisplay.textContent = sessionLimit;
    try { chrome.storage.sync.set({ dialer_session_limit: sessionLimit }); } catch (_) {}
    log(`session limit: ${sessionLimit} calls`);
  });

  // ── Queue filter UI ──
  els.filterToggle?.addEventListener("click", () => {
    els.filterPanel?.classList.toggle("open");
    try { chrome.storage.sync.set({ dialer_filters_open: els.filterPanel?.classList.contains("open") }); } catch (_) {}
  });
  // Missed Calls filter dropdown — same collapse behavior as the Leads filters.
  document.getElementById("missed-filter-toggle")?.addEventListener("click", () => {
    document.getElementById("missed-filter-panel")?.classList.toggle("open");
  });

  function rebuildSourceCheckboxes() {
    if (!els.sourceChecks) return;
    const container = els.sourceChecks;
    const existing = new Set(Array.from(container.querySelectorAll("input")).map(i => i.value));
    const needed = new Set(allKnownSources);
    if (existing.size === needed.size && [...needed].every(s => existing.has(s))) return;

    container.innerHTML = "";
    for (const src of allKnownSources) {
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = src;
      cb.checked = filterSources.has(src);
      if (cb.checked) label.classList.add("checked");
      cb.addEventListener("change", () => {
        if (cb.checked) {
          filterSources.add(src);
        } else {
          filterSources.delete(src);
        }
        label.classList.toggle("checked", cb.checked);
        saveFilterPrefs();
        updateFilterSummary();
        fetchLeads();
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(src));
      container.appendChild(label);
    }
  }

  function clearAllFilters() {
    filterSources = new Set();
    filterAttemptPreset = "all";
    for (const cb of els.sourceChecks?.querySelectorAll("input") || []) {
      cb.checked = false;
      cb.parentElement.classList.remove("checked");
    }
    for (const b of els.attemptPresets?.querySelectorAll("button") || []) {
      b.classList.toggle("active", b.dataset.preset === "all");
    }
    saveFilterPrefs();
    updateFilterSummary();
    fetchLeads();
    log("filters cleared", "info", "ui");
  }

  document.getElementById("clear-filters-btn")?.addEventListener("click", clearAllFilters);

  els.attemptPresets?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-preset]");
    if (!btn) return;
    filterAttemptPreset = btn.dataset.preset;
    for (const b of els.attemptPresets.querySelectorAll("button")) b.classList.remove("active");
    btn.classList.add("active");
    saveFilterPrefs();
    updateFilterSummary();
    fetchLeads();
  });

  function updateFilterSummary() {
    if (!els.filterSummary) return;
    const parts = [];
    if (filterSources.size > 0) parts.push(`${filterSources.size} source${filterSources.size > 1 ? "s" : ""}`);
    if (filterAttemptPreset !== "all") {
      const labels = { "new": "New (0)", "followup": "1-3 att", "persistent": "4-7 att" };
      parts.push(labels[filterAttemptPreset] || filterAttemptPreset);
    }
    els.filterSummary.textContent = parts.length > 0 ? parts.join(" + ") : "";
  }

  function updateFilterStats(skippedSource, skippedAttempts, skipped3hr) {
    if (!els.filterStats) return;
    const parts = [];
    if (skippedSource > 0) parts.push(`${skippedSource} hidden by source`);
    if (skippedAttempts > 0) parts.push(`${skippedAttempts} hidden by attempts`);
    if (skipped3hr > 0) parts.push(`${skipped3hr} waiting on 3-hr gap`);
    els.filterStats.textContent = parts.length > 0 ? parts.join(" · ") : "";
  }

  function saveFilterPrefs() {
    try {
      chrome.storage.sync.set({
        dialer_filter_sources: Array.from(filterSources),
        dialer_filter_attempts: filterAttemptPreset,
      });
    } catch (_) {}
  }

  async function loadFilterPrefs() {
    try {
      const s = await chrome.storage.sync.get([
        "dialer_filter_sources", "dialer_filter_attempts", "dialer_filters_open",
      ]);
      if (Array.isArray(s.dialer_filter_sources) && s.dialer_filter_sources.length > 0) {
        filterSources = new Set(s.dialer_filter_sources);
      }
      if (s.dialer_filter_attempts && s.dialer_filter_attempts !== "all") {
        filterAttemptPreset = s.dialer_filter_attempts;
        const btn = els.attemptPresets?.querySelector(`button[data-preset="${filterAttemptPreset}"]`);
        if (btn) {
          for (const b of els.attemptPresets.querySelectorAll("button")) b.classList.remove("active");
          btn.classList.add("active");
        }
      }
      if (s.dialer_filters_open) els.filterPanel?.classList.add("open");
      updateFilterSummary();
    } catch (_) {}
  }

  // ── Listen for CTM bridge events from service worker ──
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "AD_FROM_CTM") return;
    const p = msg.payload;
    if (!p) return;
    if (p.type === "bridge-ready" || (p.type === "pong" && p.hasEmbed)) {
      if (!bridgeReady) {
        bridgeReady = true;
        updateBridgeStatus();
        setPhase(phase); // re-enable buttons
        log("CTM bridge ready — extension can place calls", "ok", "bridge");
      }
      return;
    }
    if (p.type === "ctm-event") {
      // FAST-PATH DROPS — bypass everything (log, dedup, handler) for events
      // we never act on. Old bridge instances (pre-2.0.26) still forward
      // ctm:live-activity and ctm:status; this dialer-side guard makes us
      // resilient to a stale bridge that hasn't been hard-refreshed.
      if (p.event === "ctm:status" || p.event === "ctm:live-activity") {
        _statusCount++;
        return;
      }
      // SOFTPHONE-BUSY TRACKER — runs BEFORE the wrap-up lockout below so the
      // dialer always knows when a call is live on the softphone, including an
      // INBOUND call the rep answered mid-wrap-up (which the lockout hides
      // from the phase machine). advanceToNext() holds while busy, and the
      // ring-timeout hangup is suppressed when the softphone was already busy
      // at dial time. (7/2: wrap-up auto-advance dialed over Bronté's live
      // inbound call; 35s later the blind ring-timeout hangup ended it.)
      if (p.event === "ctm:start") {
        softphoneBusy = true;
        _busyChangedAt = Date.now();
      } else if (p.event === "ctm:end-activity" || p.event === "ctm:wrapup_start" || p.event === "ctm:failed") {
        // Respect the stale-end rule below: an end event from BEFORE the
        // current dial must not mark the softphone free.
        if (!(_currentDialAt && p.ts && p.ts < _currentDialAt)) {
          softphoneBusy = false;
          _busyChangedAt = Date.now();
        }
      }
      // WRAP-UP LOCKOUT — while the rep is dispositioning, ignore ALL state-
      // changing CTM events. CTM flushes a queue of late events after a hangup
      // (sometimes 6-12s worth). Without this gate, those events tied up the
      // main thread and reset the disposition dropdown back to "Attempted".
      if (phase === "wrapup" || phase === "retrying") {
        _staleEndCount++;
        return;
      }
      // STALE-EVENT GUARD: CTM emits the prior call's ctm:end-activity 1-2s
      // late — sometimes AFTER we've started dialing the next number. Drop any
      // call-end event whose source timestamp predates the current dial so we
      // don't pop a wrap-up modal on top of an active 2nd ring.
      const isCallEndEvent = p.event === "ctm:end-activity" ||
                             p.event === "ctm:wrapup_start" ||
                             p.event === "ctm:failed";
      if (isCallEndEvent && _currentDialAt && p.ts && p.ts < _currentDialAt) {
        _staleEndCount++;
        return;
      }
      // Dedupe identical events within ~500ms via two rotating buckets.
      const bucket = Math.floor((p.ts || Date.now()) / 500);
      const key = `${p.event}|${currentLead?.phone || ""}|${bucket}`;
      if (_recentCtmEvents.has(key) || _prevCtmEvents.has(key)) {
        _suppressedCount++;
        return;
      }
      _recentCtmEvents.add(key);
      const leadCtx = currentLead ? ` [${currentLead.phone}]` : "";
      log(`${p.event}${leadCtx}`, "ev", "ctm");
      handleCtmEvent(p.event, p.detail || {});
      // Separate, additive router for the Needs Rescheduled flow. handleCtmEvent
      // bails on !currentLead (which rescheduled never sets), so this is the only
      // consumer of CTM events during a rescheduled call.
      rschedHandleCtmEvent(p.event);
      wcHandleCtmEvent(p.event);
      return;
    }
    if (p.type === "command-error") {
      log(`bridge error (${p.originalType}): ${p.error}`, "err", "bridge");
      return;
    }
    if (p.type === "command-ack" && p.originalType === "dial" && p.outboundSet) {
      const o = p.outboundSet;
      if (o.error) {
        log(`outbound# NOT set: ${o.error}${o.sampleTexts ? " (sample: " + o.sampleTexts.join(", ") + ")" : ""}`, "err", "src");
      } else {
        log(`outbound# set in CTM: ${o.matchedText}`, "ok", "src");
      }
      return;
    }
    if (p.type === "command-ack" && p.originalType === "dial") {
      log(`dial command ack from bridge`, "info", "bridge");
      return;
    }
    if (p.type === "command-ack") {
      log(`bridge ack: ${p.originalType}`, "info", "bridge");
      return;
    }
  });

  // Track call duration so we can hint at voicemail-vs-human after the fact.
  // CTM's web embed does not natively distinguish voicemail from human pickup
  // — both fire ctm:start. We use duration as a weak heuristic: a "connected"
  // call <30s after start is more likely a VM hangup than a real conversation.
  let callStartMs = 0;
  function handleCtmEvent(name, detail) {
    if (!currentLead) return;
    // CRITICAL: once we're in wrap-up, REFUSE to act on late CTM events that
    // would flip phase back to dialing/connected. CTM flushes its event queue
    // after a hangup over 5-12s; without this guard, late `ctm:connecting`
    // moves phase off wrap-up, then the next late `ctm:end-activity` re-opens
    // the modal which resets the disposition dropdown to "Attempted" — making
    // it feel like the dropdown is locked.
    if (phase === "wrapup" || phase === "retrying") {
      _staleEndCount++;
      return;
    }
    if (name === "ctm:connecting") {
      setPhase("dialing");
      log(`call → connecting (channel opening)`, "info", "call");
    } else if (name === "ctm:start") {
      setPhase("connected");
      connectedThisCall = true;
      callStartMs = Date.now();
      clearTimeout(ringTimeoutId);
      log(`call → CONNECTED (audio channel up — could be human OR voicemail)`, "ok", "call");
    } else if (name === "ctm:failed") {
      log(`call FAILED: ${JSON.stringify(detail).slice(0, 200)}`, "err", "call");
      onCallEnded({ source: "failed" });
    } else if (name === "ctm:end-activity" || name === "ctm:wrapup_start") {
      const dur = callStartMs ? Math.round((Date.now() - callStartMs) / 1000) : 0;
      callStartMs = 0;
      if (connectedThisCall) {
        const hint = dur < 30 ? "  (short — likely VM hangup)" : dur < 120 ? "  (brief conversation)" : "";
        log(`call ended via ${name} · duration=${dur}s${hint}`, "info", "call");
      } else {
        log(`call ended via ${name} · never connected (no-answer)`, "info", "call");
      }
      onCallEnded({ source: name });
    }
  }

  // ── Theme sync from parent popup ──
  // When the dialer is loaded as an iframe inside popup.html, mirror the
  // parent's body.dark-theme class so the dialer matches the extension theme.
  function syncThemeFromParent() {
    try {
      const parentBody = window.parent?.document?.body;
      if (!parentBody) return;
      const isDark = parentBody.classList.contains("dark-theme");
      document.body.classList.toggle("dark-theme", isDark);
    } catch (_) { /* cross-origin or standalone — ignore */ }
  }

  // ── Tab-switch pause ──
  // The host popup posts {type:'AD_TAB_ACTIVE', active:bool} when the user
  // switches tabs. When the Dialer tab is no longer visible, force pause so
  // the rep doesn't keep auto-calling while reviewing another panel.
  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "AD_TAB_ACTIVE") {
      const active = !!msg.active;
      if (!active && mode === "running") {
        // Auto-pause so we don't keep dialing while the rep reviews another
        // panel. Flagged so we know to auto-resume when they come back (there's
        // no manual Pause/Resume button anymore).
        mode = "paused";
        _autoPausedByTabSwitch = true;
        log(`⏸ auto-paused — switched to "${msg.sectionId || "other"}" tab`, "warn", "ui");
        setPhase(phase);
      } else if (active) {
        log(`dialer tab active`, "info", "ui");
        if (!ctmTabOpen) ensureCtmTabOnLoad();
        // Resume right where we left off if WE auto-paused on the way out.
        if (_autoPausedByTabSwitch && mode === "paused") {
          _autoPausedByTabSwitch = false;
          mode = "running";
          log(`▶ auto-resumed — back on the Dialer tab`, "act", "ui");
          if (!currentLead && !els.scrim?.classList.contains("show")) advanceToNext();
          else setPhase(phase);
        }
      }
    }
  });

  // ── Init ──
  async function init() {
    log(`dialer loaded`, "info", "init");
    loadDailyDone(); // restore today's running Done list + count (survives reloads)
    syncThemeFromParent();
    // Re-sync periodically in case parent toggles theme
    setInterval(syncThemeFromParent, 2000);
    // Resolve repName from the Call Handler Selection > CSR setting
    // (chrome.storage.sync.ctm_csr) with two fallbacks. Subscribed to
    // storage changes below so updates in options propagate live — no need
    // to close/reopen the dialer for the next disposition to log the
    // correct rep.
    const MADI_USER_ID = "USR3C843ED7AB9B4711F9903DED76AC22FF";
    function resolveRepName(values, { silent = false } = {}) {
      let fullName = values.ctm_csr || values.ctm_display_name || values.ctm_user || "unknown";
      // Madison -> Madi identity normalization. /api/sheet-dispositions
      // only recognizes "Madi" — without this, legacy stored values or
      // raw CTM user IDs would log as unknown/Maddison.
      if (
        fullName === MADI_USER_ID ||
        /\bMad(d)?ison\b/i.test(fullName)
      ) {
        fullName = "Madi Meyers";
      }
      let next = fullName.split(" ")[0] || fullName;
      // Safeguard: never let the first-name extraction emit "Madison".
      if (/^Mad(d)?ison$/i.test(next)) next = "Madi";
      const changed = next !== repName;
      repName = next;
      if (els.repName) els.repName.textContent = `Rep: ${repName}`;
      if (silent) return changed;
      if (repName === "unknown") {
        log("rep name not set — open ⚙ to set ctm_csr in options", "err", "init");
      } else {
        log(`rep identified as: ${repName}`, "info", "init");
      }
      return changed;
    }

    // Load rep name + preferences from extension settings
    try {
      const s = await chrome.storage.sync.get([
        "ctm_csr", "ctm_user", "ctm_display_name",
        "dialer_test_mode", "dialer_session_limit",
      ]);
      resolveRepName(s);
      testMode = !!s.dialer_test_mode;
      els.testModeToggle.checked = testMode;
      if (testMode) log("TEST MODE active on startup", "warn", "init");
      const storedLimit = parseInt(s.dialer_session_limit) || 25;
      sessionLimit = Math.min(100, Math.max(5, storedLimit));
      els.sessionLimitInput.value = sessionLimit;
      els.sessionLimitDisplay.textContent = sessionLimit;
    } catch (_) {}

    // Live-update repName when the Call Handler Selection (or fallback keys)
    // changes in options. Without this, a rep who changes their CSR while the
    // dialer tab is open would still log dispositions under the old/empty
    // value until they reload the tab.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      const watch = ["ctm_csr", "ctm_display_name", "ctm_user"];
      if (!watch.some(k => k in changes)) return;
      chrome.storage.sync.get(watch, (s) => {
        const prev = repName;
        const changed = resolveRepName(s, { silent: true });
        if (changed) log(`rep updated: ${prev} -> ${repName}`, "info", "init");
      });
    });

    // Load filter preferences before first fetch
    await loadFilterPrefs();

    // Start sheet-log mirror (clears DialerLog tab if version changed)
    await initSheetLogMirror();

    // Rotate dedup buckets every 1.5s so old keys naturally fall out without
    // scheduling a setTimeout per event.
    setInterval(() => {
      _prevCtmEvents = _recentCtmEvents;
      _recentCtmEvents = new Set();
    }, 1500);

    // Periodically surface event-suppression counts so we know if bridges leak
    setInterval(() => {
      if (_suppressedCount > 0 || _statusCount > 0 || _staleEndCount > 0) {
        log(`(noise filter) ${_suppressedCount} duplicate events + ${_statusCount} ctm:status hidden + ${_staleEndCount} stale end-events from prior call dropped`, "info", "filter");
        _suppressedCount = 0;
        _statusCount = 0;
        _staleEndCount = 0;
      }
    }, 15000);

    renderCompleted();

    currentWindowId = await getCurrentBrowserWindowId();
    log(`window ID: ${currentWindowId}`, "info", "init");

    ctmTabOpen = await checkCtmTab();
    log(`CTM tab ${ctmTabOpen ? "found in this window" : "not in this window (will open when Dialer tab is clicked)"}`, ctmTabOpen ? "ok" : "info", "init");
    updateBridgeStatus();
    setPhase("idle");

    // Initial queue fetch
    await fetchLeads();

    // Background queue refresh: pull every 60s so the visible queue stays
    // in sync with other reps' progress. Skipped during:
    // - dialing/ringing/connected — no need to thrash the API mid-call
    // - document hidden (tab not focused) — rep isn't watching, save the request
    // Combined with fetchLeads()' 3-second debounce, redundant fetches near
    // a dial-completion cycle are coalesced into a single request.
    setInterval(() => {
      if (phase === "dialing" || phase === "ringing" || phase === "connected") return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      fetchLeads().catch(() => {});
    }, 60000);

    // When the rep tabs back into the dialer after being away, refresh
    // immediately so they don't stare at a stale queue waiting for the next
    // 60s tick. The fetchLeads debounce still gates back-to-back fires.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      if (phase === "dialing" || phase === "ringing" || phase === "connected") return;
      fetchLeads().catch(() => {});
    });

    // Poll CTM tab status (in case user opens/closes the tab)
    setInterval(async () => {
      const open = await checkCtmTab();
      if (open !== ctmTabOpen) {
        ctmTabOpen = open;
        if (!open) {
          bridgeReady = false;
        }
        log(`CTM tab ${open ? "appeared" : "disappeared"}`, open ? "ok" : "warn", "bridge");
        updateBridgeStatus();
        setPhase(phase);
      }
      // Re-ping bridge so we know if it's alive. Log failures so chain
      // breaks surface (instead of silent waiting forever).
      if (open && !bridgeReady) {
        const resp = await sendToCtm({ type: "ping" });
        if (!resp.ok) {
          log(`ping failed: ${resp.error || "unknown"} — relay or content script may not be loaded`, "err", "bridge");
        }
      }
    }, 2000);   // Poll every 2s — cheap, keeps bridge state fresh

    // First bridge ping
    if (ctmTabOpen) {
      const resp = await sendToCtm({ type: "ping" });
      if (!resp.ok) {
        log(`initial bridge ping failed: ${resp.error || "unknown"}`, "err", "bridge");
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // NEEDS RESCHEDULED — isolated two-stage flow (review → call → outcome)
  // Never sets currentLead / mode / phase, so it can't trigger the normal
  // dialer's wrap-up, double-tap, cadence, or sheet-lock logic.
  // ═══════════════════════════════════════════════════════════════════════

  function updateRescheduledBadge(n) {
    const b = document.getElementById("rescheduled-badge");
    if (!b) return;
    if (n > 0) { b.textContent = n; b.style.display = ""; }
    else { b.textContent = ""; b.style.display = "none"; }
  }

  // Jobs already arrive newest-reschedule-first from the API. Two filters stack:
  // a days-back range (when it entered Needs Rescheduled) then a rep (created_by).
  function rschedRangeFiltered() {
    if (!_rschedRangeDays) return _rschedAll.slice();
    const cutoff = Date.now() - _rschedRangeDays * 86400000;
    return _rschedAll.filter(j => {
      const t = Date.parse(j.rescheduled_at || "");
      return isNaN(t) ? false : t >= cutoff;
    });
  }
  function rschedFilteredJobs() {
    const inRange = rschedRangeFiltered();
    if (_rschedRepFilter === "all") return inRange;
    return inRange.filter(j => ((j.created_by || "").trim() || "Unknown CSR") === _rschedRepFilter);
  }

  function rschedFmtDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Phoenix", month: "numeric", day: "numeric" });
    } catch (_) { return "—"; }
  }

  // "3d ago" / "5h ago" style age from the rescheduled-at timestamp.
  function rschedAge(iso) {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (isNaN(t)) return "";
    const mins = Math.floor((Date.now() - t) / 60000);
    if (mins < 60) return `${Math.max(0, mins)}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  // Populate the rep <select> with counts scoped to the active range. Resets
  // the rep filter to "all" if the chosen rep has no jobs in the new range.
  function populateRschedRepSelect() {
    const sel = document.getElementById("rsched-rep-select");
    if (!sel) return;
    const inRange = rschedRangeFiltered();
    const counts = Object.create(null);
    for (const j of inRange) {
      const csr = (j.created_by || "").trim() || "Unknown CSR";
      counts[csr] = (counts[csr] || 0) + 1;
    }
    const reps = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
    if (_rschedRepFilter !== "all" && !counts[_rschedRepFilter]) _rschedRepFilter = "all";
    sel.innerHTML = "";
    const opt = (val, label) => { const o = document.createElement("option"); o.value = val; o.textContent = label; if (val === _rschedRepFilter) o.selected = true; sel.appendChild(o); };
    opt("all", `All reps (${inRange.length})`);
    for (const rep of reps) opt(rep, `${rep} (${counts[rep]})`);
  }

  function syncRschedRangeSelect() {
    const sel = document.getElementById("rsched-range-select");
    if (sel) sel.value = String(_rschedRangeDays);
  }

  function setRschedRepFilter(rep) {
    if (_rschedRepFilter === rep) return;
    if (_rschedPhase !== "idle") { log("rsched: finish the current card before changing the filter", "warn", "rsched"); syncRschedRepSelect(); return; }
    _rschedRepFilter = rep;
    renderRescheduledQueue();
  }
  function syncRschedRepSelect() {
    const sel = document.getElementById("rsched-rep-select");
    if (sel) sel.value = _rschedRepFilter;
  }

  function setRschedRange(days) {
    const d = parseInt(days) || 0;
    if (_rschedRangeDays === d) return;
    if (_rschedPhase !== "idle") { log("rsched: finish the current card before changing the filter", "warn", "rsched"); syncRschedRangeSelect(); return; }
    _rschedRangeDays = d;
    renderRescheduledQueue();
  }

  function renderRescheduledQueue() {
    const container = document.getElementById("rsched-queue");
    const header = document.getElementById("rsched-queue-header");
    if (!container) return;
    populateRschedRepSelect();
    syncRschedRangeSelect();
    updateRescheduledBadge(_rschedAll.length);
    if (!_rschedAll.length) {
      container.innerHTML = `<li style="color:var(--muted);font-style:italic;font-size:12px;padding:8px 2px;">No jobs in "Needs Rescheduled".</li>`;
      if (header) header.textContent = "Rescheduled Queue";
      _rschedQueue = [];
      return;
    }
    const list = rschedFilteredJobs();
    _rschedQueue = list;
    const bits = [];
    if (_rschedRepFilter !== "all") bits.push(_rschedRepFilter);
    if (_rschedRangeDays) bits.push(`≤${_rschedRangeDays}d`);
    const scope = bits.length ? ` · ${bits.join(" · ")}` : "";
    if (header) header.textContent = `Rescheduled Queue (${list.length}${scope})`;
    container.innerHTML = "";
    if (!list.length) {
      container.innerHTML = `<li style="color:var(--muted);font-style:italic;font-size:12px;padding:8px 2px;">No rescheduled jobs match this filter.</li>`;
      return;
    }
    for (const job of list) {
      const li = document.createElement("li");
      li.className = "rsched-row";
      li.dataset.jobId = String(job.job_id);
      const age = rschedAge(job.rescheduled_at);
      li.innerHTML = `
        <div style="flex:1;min-width:0;">
          <div class="rsched-name">${escapeHtml(job.customer || "(no name)")}</div>
          <div class="rsched-phone">${escapeHtml(job.phone || "—")}</div>
          <div class="rsched-meta">Resched ${escapeHtml(rschedFmtDate(job.rescheduled_at))}${age ? " · " + escapeHtml(age) : ""} · CSR: ${escapeHtml(job.created_by || "—")}</div>
        </div>`;
      li.addEventListener("click", () => {
        const idx = _rschedQueue.findIndex(j => String(j.job_id) === String(job.job_id));
        if (idx >= 0) { _rschedIdx = idx; rschedOpenCard(_rschedQueue[idx]); }
      });
      container.appendChild(li);
    }
  }

  // Open the job card in a FRESH (cold-loaded) tab. Navigating an already-warm
  // Roofr SPA tab makes Roofr treat the URL change as an in-app "Jumping to
  // track" that respects the tab's current list filter — so a job filtered out
  // of that view never opens. A cold tab load opens the card every time. We
  // reuse ONE dedicated tab: open the new one, then close the previous.
  function rschedOpenJobCard(url) {
    if (!url) return;
    try {
      const prev = _rschedRoofrTabId;
      chrome.tabs.create({ url, active: true }, (t) => {
        if (chrome.runtime.lastError || !t) { window.open(url, "_blank"); return; }
        _rschedRoofrTabId = t.id;
        if (t.windowId != null) chrome.windows.update(t.windowId, { focused: true });
        if (prev != null && prev !== t.id) {
          chrome.tabs.remove(prev, () => { void chrome.runtime.lastError; });
        }
      });
    } catch (_) { window.open(url, "_blank"); }
  }

  function rschedParseTimer(v) {
    const s = String(v || "").trim();
    const c = s.indexOf(":");
    if (c >= 0) return (parseInt(s.slice(0, c)) || 0) * 60 + (parseInt(s.slice(c + 1)) || 0);
    return parseInt(s) || 0;
  }
  function rschedFmt(sec) {
    sec = Math.max(0, sec | 0);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  }

  function rschedStartQueue() {
    if (!_rschedQueue.length) _rschedQueue = rschedFilteredJobs();
    if (!_rschedQueue.length) { log("rescheduled: queue is empty — nothing to start", "warn", "rsched"); return; }
    _rschedIdx = 0;
    rschedOpenCard(_rschedQueue[0]);
  }

  function rschedOpenCard(job) {
    if (mode === "running" || ["dialing", "ringing", "connected", "wrapup"].includes(phase)) {
      log("rescheduled: stop the main dialer before opening a card", "warn", "rsched");
      return;
    }
    _rschedJob = job;
    _rschedStage1 = "";
    _rschedPhase = "reviewing";
    rschedOpenJobCard(job.link);
    log(`rsched: ▸ ${job.customer || job.job_id} (${job.phone || "no phone"}) — CSR ${job.created_by || "?"}`, "act", "rsched");
    _rschedRemainSec = rschedParseTimer(document.getElementById("rsched-timer-input")?.value) || RSCHED_DEFAULT_REVIEW_SEC;
    rschedRenderCard();
    rschedShowPhase("reviewing");
    rschedStartTimer();
    document.querySelectorAll(".rsched-row").forEach(r => r.classList.toggle("active", r.dataset.jobId === String(job.job_id)));
  }

  function rschedRenderCard() {
    const j = _rschedJob; if (!j) return;
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set("rsched-job-name", j.customer || "(no name)");
    set("rsched-job-phone", j.phone || "—");
    const meta = document.getElementById("rsched-job-meta");
    const age = rschedAge(j.rescheduled_at);
    if (meta) meta.innerHTML =
      `Created by <strong>${escapeHtml(j.created_by || "—")}</strong> · Rescheduled ${escapeHtml(rschedFmtDate(j.rescheduled_at))}${age ? " (" + escapeHtml(age) + ")" : ""}<br>${escapeHtml(j.address || "")}`;
  }

  function rschedShowPhase(ph) {
    const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? "" : "none"; };
    show("rsched-review-card", ph !== "idle");
    show("rsched-stage1", ph === "reviewing");
    show("rsched-dialing", ph === "calling");
    show("rsched-stage2", ph === "stage2");
    const badge = document.getElementById("rsched-phase-badge");
    if (badge) badge.textContent = { reviewing: "Reviewing", calling: "Calling", stage2: "Outcome" }[ph] || ph;
  }

  function rschedStartTimer() {
    rschedStopTimer();
    const disp = document.getElementById("rsched-timer-display");
    const nudge = document.getElementById("rsched-nudge");
    if (nudge) nudge.style.display = "none";
    if (disp) { disp.classList.remove("times-up"); disp.textContent = rschedFmt(_rschedRemainSec); }
    _rschedTimerId = setInterval(() => {
      if (_rschedPhase !== "reviewing") { rschedStopTimer(); return; }
      _rschedRemainSec = Math.max(0, _rschedRemainSec - 1);
      if (disp) disp.textContent = rschedFmt(_rschedRemainSec);
      if (_rschedRemainSec === 0) {
        rschedStopTimer();
        // SOFT NUDGE: flash, but never force-advance or cut off the review.
        if (disp) disp.classList.add("times-up");
        if (nudge) nudge.style.display = "";
        log(`rsched: review time up for ${_rschedJob?.customer} (soft nudge)`, "info", "rsched");
      }
    }, 1000);
  }
  function rschedStopTimer() { if (_rschedTimerId) { clearInterval(_rschedTimerId); _rschedTimerId = null; } }

  function rschedStartCallTimer() {
    rschedStopCallTimer();
    _rschedCallStartMs = Date.now();
    const el = document.getElementById("rsched-call-timer");
    _rschedCallTimerId = setInterval(() => {
      if (el) el.textContent = rschedFmt(Math.floor((Date.now() - _rschedCallStartMs) / 1000));
    }, 1000);
  }
  function rschedStopCallTimer() {
    if (_rschedCallTimerId) { clearInterval(_rschedCallTimerId); _rschedCallTimerId = null; }
    const el = document.getElementById("rsched-call-timer"); if (el) el.textContent = "";
  }

  // Panel-only logging — records the outcome in the Event log (no sheet write).
  function rschedLogOutcome(stage1, stage2, note) {
    const j = _rschedJob; if (!j) return;
    const parts = [stage1]; if (stage2) parts.push("→ " + stage2); if (note) parts.push(`(${note})`);
    log(`rsched ✓ ${j.customer || j.job_id} [${j.created_by || "?"}]: ${parts.join(" ")}`, "ok", "rsched");
  }

  function rschedAdvance() {
    _rschedIdx++;
    if (_rschedIdx >= 0 && _rschedIdx < _rschedQueue.length) {
      rschedOpenCard(_rschedQueue[_rschedIdx]);
    } else {
      log("rsched: queue complete — every card reviewed this session", "ok", "rsched");
      rschedReset();
      fetchLeads({ force: true });
    }
  }

  function rschedReset() {
    rschedStopTimer();
    rschedStopCallTimer();
    clearTimeout(_rschedRingTimeoutId);
    _rschedDialActive = false;
    _rschedPhase = "idle";
    _rschedJob = null;
    rschedShowPhase("idle");
    document.querySelectorAll(".rsched-row").forEach(r => r.classList.remove("active"));
  }

  // ── Stage 1 ──
  async function rschedHandleCall() {
    if (mode === "running" || ["dialing", "ringing", "connected", "wrapup"].includes(phase)) {
      log("rsched: can't dial — the main dialer is active", "warn", "rsched"); return;
    }
    const j = _rschedJob; if (!j) return;
    const e164 = toE164(j.phone || "");
    if (!e164) { log(`rsched: bad/empty phone: ${j.phone || "(none)"}`, "err", "rsched"); return; }
    const ready = await ensureCtmTab();
    if (!ready) { log("rsched: CTM tab not ready — can't dial", "err", "rsched"); return; }
    _rschedStage1 = "Call";
    _rschedPhase = "calling";
    _rschedDialActive = true;
    _currentDialAt = Date.now();   // lets the listener's stale-event guard protect this call
    rschedStopTimer();
    rschedShowPhase("calling");
    rschedStartCallTimer();
    log(`rsched: ▶ DIALING ${j.customer} ${e164}`, "act", "rsched");
    clearTimeout(_rschedRingTimeoutId);
    _busyAtDial = softphoneBusy;
    _rschedRingTimeoutId = setTimeout(() => {
      if (_rschedPhase === "calling") {
        log("rsched: ring timeout — ending, go to outcome", "warn", "rsched");
        if (_busyAtDial) log("rsched: skipping hangup — softphone had a live call at dial time", "warn", "rsched");
        else sendToCtm({ type: "hangup" }).catch(() => {});
        rschedOnCallEnded();
      }
    }, RING_TIMEOUT_MS);
    const resp = await sendToCtm({ type: "dial", number: e164 });
    if (!resp || !resp.ok) {
      log(`rsched: dial failed: ${resp?.error || "?"} — go to outcome`, "err", "rsched");
      clearTimeout(_rschedRingTimeoutId);
      rschedStopCallTimer();
      _rschedDialActive = false;
      _rschedPhase = "stage2";
      rschedShowPhase("stage2");
    }
  }
  function rschedHandleChangedS1() {
    rschedStopTimer();
    rschedLogOutcome("Changed status (after review)", "", "");
    rschedAdvance();
  }
  function rschedHandleSkip() {
    rschedStopTimer();
    rschedLogOutcome("Skip", "", "");
    rschedAdvance();
  }

  // ── Stage 2 ──
  function rschedHandleStage2(label) {
    const note = (document.getElementById("rsched-note")?.value || "").trim();
    rschedLogOutcome(_rschedStage1 || "Call", label, note);
    const n = document.getElementById("rsched-note"); if (n) n.value = "";
    rschedAdvance();
  }

  function rschedOnCallEnded() {
    clearTimeout(_rschedRingTimeoutId);
    rschedStopCallTimer();
    _rschedDialActive = false;
    if (_rschedPhase !== "calling") return;
    _rschedPhase = "stage2";
    rschedShowPhase("stage2");
    log(`rsched: call ended → outcome for ${_rschedJob?.customer}`, "info", "rsched");
  }

  // Separate CTM router — only acts when a rescheduled call is active.
  function rschedHandleCtmEvent(eventName) {
    if (!_rschedDialActive) return;
    if (eventName === "ctm:start") {
      log("rsched: call connected", "ok", "rsched");
      const el = document.getElementById("rsched-call-timer"); if (el) el.style.color = "var(--success)";
    } else if (eventName === "ctm:end-activity" || eventName === "ctm:wrapup_start" || eventName === "ctm:failed") {
      rschedOnCallEnded();
    }
  }

  function rschedBindButtons() {
    const on = (id, fn) => document.getElementById(id)?.addEventListener("click", fn);
    document.getElementById("rsched-rep-select")?.addEventListener("change", (e) => setRschedRepFilter(e.target.value));
    document.getElementById("rsched-range-select")?.addEventListener("change", (e) => setRschedRange(e.target.value));
    on("rsched-start-btn", rschedStartQueue);
    on("rsched-refresh-btn", async () => {
      const b = document.getElementById("rsched-refresh-btn");
      if (b) { b.disabled = true; b.textContent = "↻ …"; }
      try { await fetchLeads({ force: true }); }
      finally { if (b) { b.disabled = false; b.textContent = "↻ Refresh"; } }
    });
    on("rsched-reopen-btn", () => { if (_rschedJob?.link) rschedOpenJobCard(_rschedJob.link); });
    on("rsched-btn-call", rschedHandleCall);
    on("rsched-btn-changed-s1", rschedHandleChangedS1);
    on("rsched-btn-skip", rschedHandleSkip);
    on("rsched-btn-contacted", () => rschedHandleStage2("Contacted"));
    on("rsched-btn-leftvm", () => rschedHandleStage2("Left VM"));
    on("rsched-btn-changed-s2", () => rschedHandleStage2("Changed status"));
    on("rsched-btn-unqualified", () => rschedHandleStage2("Unqualified"));
    on("rsched-btn-other", () => rschedHandleStage2("Other"));
    on("rsched-hangup-btn", () => {
      log("rsched: hangup clicked", "act", "rsched");
      sendToCtm({ type: "hangup" }).catch(() => {});
      rschedOnCallEnded();
    });
  }

  // ════════════════════════════════════════════════════════════════════
  //  WELCOME CALLS TAB — Madi's post-proposal-signed welcome-call queue.
  //  Mirrors the Rescheduled flow's UI, but WRITES to the sheet via
  //  /api/welcome-calls (begin-call lock + disposition), keyed by jobId.
  // ════════════════════════════════════════════════════════════════════

  // Arizona "today" (no DST) as a date-only Date for due comparisons.
  function wcTodayAZ() {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date());
    const g = t => +p.find(x => x.type === t).value;
    return new Date(g("year"), g("month") - 1, g("day"));
  }
  function wcParseMDY(s) {
    const m = String(s || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? new Date(+m[3], +m[1] - 1, +m[2]) : null;
  }
  // A row is "due" if it's still callable, under the attempt cap, and its next
  // call date has arrived (or it was never contacted).
  function wcIsDue(row) {
    const st = (row.status || "").trim().toLowerCase();
    if (["complete", "production call"].includes(st)) return false;  // terminal — don't call
    if ((parseInt(row.attemptCount) || 0) >= WC_MAX_ATTEMPTS) return false;
    const nc = wcParseMDY(row.nextCall);
    if (!nc) return true;                 // never contacted → due now
    return nc <= wcTodayAZ();
  }
  function wcDueCount(rows) { return (rows || []).filter(wcIsDue).length; }

  function updateWelcomeBadge(n) {
    const b = document.getElementById("welcome-badge");
    if (!b) return;
    if (n > 0) { b.textContent = String(n); b.style.display = ""; } else { b.style.display = "none"; }
  }

  function wcFilteredJobs() {
    const list = _wcDueFilter === "all" ? _wcAll.slice() : _wcAll.filter(wcIsDue);
    // Most-overdue first; uncontacted (no nextCall) sort to the top.
    list.sort((a, b) => {
      const ta = wcParseMDY(a.nextCall)?.getTime() ?? 0;
      const tb = wcParseMDY(b.nextCall)?.getTime() ?? 0;
      return ta - tb;
    });
    return list;
  }

  function wcSetDueFilter(v) {
    if (_wcDueFilter === v) return;
    if (_wcPhase !== "idle") { log("welcome: finish the current card before changing the filter", "warn", "welcome"); syncWcDueSelect(); return; }
    _wcDueFilter = v;
    renderWelcomeQueue();
  }
  function syncWcDueSelect() {
    const sel = document.getElementById("wc-due-select");
    if (sel) sel.value = _wcDueFilter;
  }

  function renderWelcomeQueue() {
    const container = document.getElementById("wc-queue");
    const header = document.getElementById("wc-queue-header");
    if (!container) return;
    updateWelcomeBadge(wcDueCount(_wcAll));
    syncWcDueSelect();
    if (!_wcAll.length) {
      container.innerHTML = `<li style="color:var(--muted);font-style:italic;font-size:12px;padding:8px 2px;">No welcome calls yet.</li>`;
      if (header) header.textContent = "Welcome Calls";
      _wcQueue = [];
      return;
    }
    const list = wcFilteredJobs();
    _wcQueue = list;
    if (header) header.textContent = `Welcome Calls (${list.length}${_wcDueFilter === "due" ? " due" : ""})`;
    container.innerHTML = "";
    if (!list.length) {
      container.innerHTML = `<li style="color:var(--muted);font-style:italic;font-size:12px;padding:8px 2px;">Nothing due — switch to "All signed" to see everyone.</li>`;
      return;
    }
    for (const job of list) {
      const li = document.createElement("li");
      li.className = "rsched-row wc-row";
      li.dataset.jobId = String(job.jobId);
      const lockedOther = job.lockedBy && job.lockedBy !== repName;
      if (lockedOther) li.classList.add("locked");
      const att = parseInt(job.attemptCount) || 0;
      const stTxt = job.status ? ` · ${escapeHtml(job.status)}` : "";
      li.innerHTML = `
        <div style="flex:1;min-width:0;">
          <div class="rsched-name">${escapeHtml(job.customer || "(no name)")}</div>
          <div class="rsched-phone">${escapeHtml(job.phone || "—")}</div>
          <div class="rsched-meta">Signed ${escapeHtml(job.proposalSigned || "—")} · ${att}/${WC_MAX_ATTEMPTS}${job.nextCall ? " · due " + escapeHtml(job.nextCall) : ""}${stTxt}${lockedOther ? " · 🔒 " + escapeHtml(job.lockedBy) : ""}</div>
        </div>`;
      li.addEventListener("click", () => {
        const idx = _wcQueue.findIndex(j => String(j.jobId) === String(job.jobId));
        if (idx >= 0) { _wcIdx = idx; wcOpenCard(_wcQueue[idx]); }
      });
      container.appendChild(li);
    }
  }

  // Open the Roofr job card in a fresh tab (reuse ONE dedicated tab), same
  // cold-load trick as rsched so the card always opens regardless of filters.
  function wcOpenJobCard(url) {
    if (!url) return;
    try {
      const prev = _wcRoofrTabId;
      chrome.tabs.create({ url, active: true }, (t) => {
        if (chrome.runtime.lastError || !t) { window.open(url, "_blank"); return; }
        _wcRoofrTabId = t.id;
        if (t.windowId != null) chrome.windows.update(t.windowId, { focused: true });
        if (prev != null && prev !== t.id) chrome.tabs.remove(prev, () => { void chrome.runtime.lastError; });
      });
    } catch (_) { window.open(url, "_blank"); }
  }
  function wcCardUrl(job) { return job.link || `https://app.roofr.com/dashboard/team/239329/jobs/list-view?selectedJobId=${job.jobId}`; }

  // POST helper for all server writes (begin-call/renew/release/disposition).
  async function wcWrite(body) {
    try {
      const r = await fetch(WELCOME_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dialer-Client": "roofr-extension" },
        body: JSON.stringify(body),
      });
      return await r.json();
    } catch (e) {
      log(`welcome write error: ${e.message}`, "err", "welcome");
      return { updated: false, claimed: false, error: e.message };
    }
  }

  function wcStartCallTimer() {
    wcStopCallTimer();
    _wcCallStartMs = Date.now();
    const el = document.getElementById("wc-call-timer");
    _wcCallTimerId = setInterval(() => {
      if (el) el.textContent = rschedFmt(Math.floor((Date.now() - _wcCallStartMs) / 1000));
    }, 1000);
  }
  function wcStopCallTimer() {
    if (_wcCallTimerId) { clearInterval(_wcCallTimerId); _wcCallTimerId = null; }
    const el = document.getElementById("wc-call-timer"); if (el) { el.textContent = ""; el.style.color = ""; }
  }
  // 90s lock heartbeat so a long call doesn't let the 5-min TTL expire under us.
  function wcStartRenew() {
    wcStopRenew();
    _wcRenewTimerId = setInterval(() => {
      if (_wcLocked && _wcJob) wcWrite({ jobId: _wcJob.jobId, rep: repName, action: "renew" }).catch(() => {});
    }, WC_RENEW_MS);
  }
  function wcStopRenew() { if (_wcRenewTimerId) { clearInterval(_wcRenewTimerId); _wcRenewTimerId = null; } }

  function wcShowPhase(ph) {
    const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? "" : "none"; };
    show("wc-review-card", ph !== "idle");
    show("wc-stage1", ph === "reviewing");
    show("wc-dialing", ph === "calling");
    // Disposition row is available straight from review (open account → disposition
    // → continue, no call required) AND after a call ends.
    show("wc-stage2", ph === "reviewing" || ph === "stage2");
    const badge = document.getElementById("wc-phase-badge");
    if (badge) badge.textContent = { reviewing: "Review", calling: "Calling", stage2: "Outcome" }[ph] || ph;
  }

  function wcRenderCard() {
    const j = _wcJob; if (!j) return;
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set("wc-job-name", j.customer || "(no name)");
    set("wc-job-phone", j.phone || "—");
    const meta = document.getElementById("wc-job-meta");
    const att = parseInt(j.attemptCount) || 0;
    if (meta) meta.innerHTML =
      `Signed <strong>${escapeHtml(j.proposalSigned || "—")}</strong> · ${att}/${WC_MAX_ATTEMPTS} attempts${j.nextCall ? " · Next " + escapeHtml(j.nextCall) : ""}${j.lastCSR ? " · last: " + escapeHtml(j.lastCSR) : ""}${j.source ? " · 📞 " + escapeHtml(j.source) : ""}<br>${escapeHtml(j.address || "")}`;
  }

  function wcStartQueue() {
    _wcQueue = wcFilteredJobs();
    if (!_wcQueue.length) { log("welcome: queue empty — nothing due", "warn", "welcome"); return; }
    _wcIdx = 0;
    while (_wcIdx < _wcQueue.length && _wcQueue[_wcIdx].lockedBy && _wcQueue[_wcIdx].lockedBy !== repName) _wcIdx++;
    if (_wcIdx >= _wcQueue.length) { log("welcome: every due row is locked by another rep", "warn", "welcome"); return; }
    wcOpenCard(_wcQueue[_wcIdx]);
  }

  function wcOpenCard(job) {
    if (mode === "running" || ["dialing", "ringing", "connected", "wrapup"].includes(phase)) {
      log("welcome: stop the main dialer before opening a card", "warn", "welcome"); return;
    }
    // Block reopening a card mid-call/outcome — that would drop a held lock
    // without releasing it (advances reset _wcPhase first, so they're allowed).
    if (_wcPhase === "calling" || _wcPhase === "stage2") {
      log("welcome: finish the current call's outcome before opening another card", "warn", "welcome"); return;
    }
    // Release a still-held lock from the previous card before moving on.
    if (_wcLocked && _wcJob && _wcJob.jobId !== job.jobId) {
      wcWrite({ jobId: _wcJob.jobId, rep: repName, action: "release" }).catch(() => {});
      _wcLocked = false; wcStopRenew();
    }
    if (job.lockedBy && job.lockedBy !== repName) {
      log(`welcome: ${job.customer || job.jobId} is locked by ${job.lockedBy} — skipping`, "warn", "welcome");
      return;
    }
    _wcJob = job;
    _wcPhase = "reviewing";
    _wcLocked = false;
    wcOpenJobCard(wcCardUrl(job));
    log(`welcome: ▸ ${job.customer || job.jobId} (${job.phone || "no phone"})`, "act", "welcome");
    wcRenderCard();
    wcShowPhase("reviewing");
    document.querySelectorAll(".wc-row").forEach(r => r.classList.toggle("active", r.dataset.jobId === String(job.jobId)));
  }

  // ── Stage 1: Call (claims the row) or Skip ──
  async function wcHandleCall() {
    if (_wcClaiming || _wcPhase !== "reviewing") return;   // double-click / reentrancy guard
    if (mode === "running" || ["dialing", "ringing", "connected", "wrapup"].includes(phase)) {
      log("welcome: can't dial — the main dialer is active", "warn", "welcome"); return;
    }
    const j = _wcJob; if (!j) return;
    const e164 = toE164(j.phone || "");
    if (!e164) { log(`welcome: bad/empty phone: ${j.phone || "(none)"}`, "err", "welcome"); return; }

    // Claim + stamp on the server BEFORE dialing (closes the double-call hole).
    _wcClaiming = true;
    const callBtn = document.getElementById("wc-btn-call"); if (callBtn) callBtn.disabled = true;
    const claim = await wcWrite({ jobId: j.jobId, rep: repName, action: "begin-call" });
    if (callBtn) callBtn.disabled = false;
    if (!claim.claimed) {
      _wcClaiming = false;
      log(`welcome: ${j.customer} not claimable (${claim.reason || ("locked by " + claim.lockedBy) || "?"}) — refreshing`, "warn", "welcome");
      await fetchLeads({ force: true });
      wcAdvance();
      return;
    }
    _wcLocked = true;
    _wcClaiming = false;
    wcStartRenew();

    const ready = await ensureCtmTab();
    if (!ready) {
      // Keep the lock and let the rep record an outcome manually.
      log("welcome: CTM tab not ready — go straight to outcome", "err", "welcome");
      _wcPhase = "stage2"; wcShowPhase("stage2"); return;
    }
    _wcPhase = "calling";
    _wcDialActive = true;
    _currentDialAt = Date.now();   // lets the CTM listener's stale-event guard protect this call
    wcShowPhase("calling");
    wcStartCallTimer();
    // Outbound caller ID by lead source — same source→tracking-number map the
    // Form Leads dialer uses (dialer-sources.js). Without this the welcome call
    // went out from the CTM default instead of the number tied to how the lead
    // came in. Unmapped/unknown sources fall through to the CTM default.
    let wcOutbound = null;
    try { wcOutbound = (window.DialerSources || {}).lookupOutbound?.(j.source); } catch (_) {}
    if (wcOutbound) {
      log(`welcome: source "${j.source || '(blank)'}" → outbound ${wcOutbound.name} ${wcOutbound.number}`, "info", "welcome");
    } else {
      log(`welcome: no outbound mapping for source "${j.source || '(blank)'}" — using CTM default`, "warn", "welcome");
    }
    log(`welcome: ▶ DIALING ${j.customer} ${e164}`, "act", "welcome");
    clearTimeout(_wcRingTimeoutId);
    _busyAtDial = softphoneBusy;
    _wcRingTimeoutId = setTimeout(() => {
      if (_wcPhase === "calling") {
        log("welcome: ring timeout — ending, go to outcome", "warn", "welcome");
        if (_busyAtDial) log("welcome: skipping hangup — softphone had a live call at dial time", "warn", "welcome");
        else sendToCtm({ type: "hangup" }).catch(() => {});
        wcOnCallEnded();
      }
    }, RING_TIMEOUT_MS);
    const resp = await sendToCtm({
      type: "dial",
      number: e164,
      fromNumber: wcOutbound?.number || null,
      fromName: wcOutbound?.name || null,
    });
    if (!resp || !resp.ok) {
      log(`welcome: dial failed: ${resp?.error || "?"} — go to outcome`, "err", "welcome");
      clearTimeout(_wcRingTimeoutId);
      wcStopCallTimer();
      _wcDialActive = false;
      _wcPhase = "stage2";
      wcShowPhase("stage2");
    }
  }

  async function wcHandleSkip() {
    if (_wcLocked && _wcJob) {
      await wcWrite({ jobId: _wcJob.jobId, rep: repName, action: "release" });
      _wcLocked = false;
    }
    wcStopRenew();
    log(`welcome: skipped ${_wcJob?.customer || ""}`, "info", "welcome");
    wcAdvance();
  }

  // ── Stage 2: record the outcome (writes disposition + releases the lock) ──
  async function wcHandleStage2(status) {
    const j = _wcJob; if (!j) return;
    const note = (document.getElementById("wc-note")?.value || "").trim();
    const res = await wcWrite({ jobId: j.jobId, rep: repName, status, notes: note });
    if (!res.updated) {
      // Don't advance or drop the lock — keep the heartbeat alive and let the
      // rep retry the outcome rather than leaving a stale server lock.
      log(`welcome: save failed for ${j.customer}: ${res.reason || res.error || "?"} — staying on this card to retry`, "err", "welcome");
      return;
    }
    log(`welcome ✓ ${j.customer}: ${status}${note ? " (" + note + ")" : ""} [att ${res.attemptCount ?? "?"}]`, "ok", "welcome");
    wcStopRenew();          // server disposition already cleared the lock (O/P)
    _wcLocked = false;
    // Reflect the new status locally so the queue/badge update immediately.
    const local = _wcAll.find(r => String(r.jobId) === String(j.jobId));
    if (local) { local.status = status; local.attemptCount = String(res.attemptCount ?? ((parseInt(local.attemptCount) || 0) + 1)); }
    const n = document.getElementById("wc-note"); if (n) n.value = "";
    wcAdvance();
  }

  function wcOnCallEnded() {
    clearTimeout(_wcRingTimeoutId);
    wcStopCallTimer();
    _wcDialActive = false;
    if (_wcPhase !== "calling") return;
    _wcPhase = "stage2";
    wcShowPhase("stage2");
    log(`welcome: call ended → outcome for ${_wcJob?.customer}`, "info", "welcome");
  }

  // Separate CTM router — only acts while a welcome call is dialing.
  function wcHandleCtmEvent(eventName) {
    if (!_wcDialActive) return;
    if (eventName === "ctm:start") {
      // CONNECTED — cancel the 35s no-answer guillotine. Without this, the ring
      // timeout fires mid-conversation (phase stays "calling" the whole call)
      // and hangs up a live welcome call at 35s. (The main dialer is safe
      // because its timeout is guarded on the dialing/ringing phase.)
      clearTimeout(_wcRingTimeoutId);
      log("welcome: call connected", "ok", "welcome");
      const el = document.getElementById("wc-call-timer"); if (el) el.style.color = "var(--success)";
    } else if (eventName === "ctm:end-activity" || eventName === "ctm:wrapup_start" || eventName === "ctm:failed") {
      wcOnCallEnded();
    }
  }

  // Pick the next due, unlocked row from the FRESHEST _wcAll (excluding the
  // just-handled job), so the walk never desyncs against the 60s poll or a row
  // another rep grabbed mid-session.
  function wcNextCandidate(excludeJobId) {
    return wcFilteredJobs().find(j =>
      String(j.jobId) !== String(excludeJobId) &&
      !(j.lockedBy && j.lockedBy !== repName)) || null;
  }
  function wcAdvance() {
    const curId = _wcJob?.jobId;
    _wcPhase = "idle";   // current card is finished — lets wcOpenCard proceed
    const next = wcNextCandidate(curId);
    // Rebuild the visible list + badge from the just-updated _wcAll so a
    // Complete / Production Call row drops out of the queue immediately,
    // instead of lingering until the next poll/refresh. (wcOpenCard below
    // re-applies the .active highlight on the rebuilt rows.)
    renderWelcomeQueue();
    if (next) {
      _wcQueue = wcFilteredJobs();
      _wcIdx = _wcQueue.findIndex(j => String(j.jobId) === String(next.jobId));
      wcOpenCard(next);
    } else {
      log("welcome: queue complete — every due card handled this session", "ok", "welcome");
      wcReset();
      fetchLeads({ force: true });
    }
  }

  function wcReset() {
    // Fire-and-forget release of any lock we still hold (called sync on tab switch).
    if (_wcLocked && _wcJob) { wcWrite({ jobId: _wcJob.jobId, rep: repName, action: "release" }).catch(() => {}); _wcLocked = false; }
    wcStopCallTimer();
    wcStopRenew();
    clearTimeout(_wcRingTimeoutId);
    _wcDialActive = false;
    _wcClaiming = false;
    _wcPhase = "idle";
    _wcJob = null;
    wcShowPhase("idle");
    document.querySelectorAll(".wc-row").forEach(r => r.classList.remove("active"));
  }

  function wcBindButtons() {
    const on = (id, fn) => document.getElementById(id)?.addEventListener("click", fn);
    document.getElementById("wc-due-select")?.addEventListener("change", (e) => wcSetDueFilter(e.target.value));
    on("wc-start-btn", wcStartQueue);
    on("wc-refresh-btn", async () => {
      const b = document.getElementById("wc-refresh-btn");
      if (b) { b.disabled = true; b.textContent = "↻ …"; }
      try { await fetchLeads({ force: true }); }
      finally { if (b) { b.disabled = false; b.textContent = "↻ Refresh"; } }
    });
    on("wc-reopen-btn", () => { if (_wcJob) wcOpenJobCard(wcCardUrl(_wcJob)); });
    on("wc-btn-call", wcHandleCall);
    on("wc-btn-skip", wcHandleSkip);
    on("wc-btn-attempted", () => wcHandleStage2("Attempted"));
    on("wc-btn-complete", () => wcHandleStage2("Complete"));
    on("wc-btn-production", () => wcHandleStage2("Production Call"));
    on("wc-hangup-btn", () => {
      log("welcome: hangup clicked", "act", "welcome");
      sendToCtm({ type: "hangup" }).catch(() => {});
      wcOnCallEnded();
    });
  }

  init();
})();

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
  const DEBUG_LOG_URL = `${API_BASE}/api/dialer-debug-log`;
  const RING_TIMEOUT_MS = 35000;          // give up if no ctm:start within 35s
  const WRAPUP_AUTOFIRE_MS = 60000;       // auto Save → Next after 60s of inactivity in wrap-up
  const WRAPUP_INTERACTION_RESET_MS = 60000; // restart full 60s if rep types/selects
  const QUIET_START_HOUR = 8;             // 8am AZ
  const QUIET_END_HOUR = 21;              // 9pm AZ
  const MAX_ATTEMPTS = 8;                 // 8 attempts then auto-Lost
  const POLL_BRIDGE_MS = 5000;
  const MIN_GAP_MS = 3 * 60 * 60 * 1000;  // 3 hours between consecutive calls to the same lead
  const AUTO_RETRY_THRESHOLD_MS = 5000;   // if call ends <5s, retry on main line
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

  // ── State ──
  let mode = "idle";      // 'idle' | 'running' | 'paused' | 'stopping'
  let phase = "idle";     // 'idle' | 'fetching' | 'dialing' | 'ringing' | 'connected' | 'wrapup'
  let currentLead = null;
  let queue = [];
  let ringTimeoutId = null;
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
  const completedThisSession = [];       // {phone, name, status, attempts} for the in-session "Done" list
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
    pauseBtn: $("pause-btn"),
    stopBtn: $("stop-btn"),
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
    els.pauseBtn.disabled = mode !== "running";
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
        <button id="hangup-btn" class="danger hangup-big">☎ Hangup</button>
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
    els.queue.innerHTML = "";
    // Show ALL queued leads (was capped at 8 — Travis: "why is there always 8?").
    // The list is inside the scrollable <main>, so long queues scroll naturally.
    if (els.queueHeader) {
      els.queueHeader.textContent = `Queue (${queue.length} remaining)`;
    }
    for (const lead of queue) {
      const li = document.createElement("li");
      if (lead.lockedBy && lead.lockedBy !== repName) li.classList.add("locked");
      const tier = lead._tier;
      const tierLabel = { 1: "NEW", 2: "TODAY", 3: "WIP" }[tier] || "—";
      const leftEl = document.createElement("span");
      leftEl.className = "left";
      const attemptsNow = parseInt(lead.attemptCount) || 0;
      const doubleTapBadge = (attemptsNow === 0)
        ? `<span class="tier" style="background:var(--accent-light);color:var(--accent-hi);margin-left:2px;">×2 double-tap</span>`
        : "";
      const noteText = (lead.notes || "").trim();
      // Truncate long notes so a chatty lead doesn't bloat the row height.
      const noteShort = noteText.length > 90 ? noteText.slice(0, 87) + "…" : noteText;
      const noteHtml = noteText
        ? `<div class="row3" style="font-size:11px;color:var(--muted);margin-top:2px;line-height:1.3;" title="${escapeHtml(noteText)}">📝 ${escapeHtml(noteShort)}</div>`
        : "";
      leftEl.innerHTML = `
        <div class="row1"><span class="tier t${tier}">${tierLabel}</span><strong class="name copyable" data-copy="${escapeHtml(lead.name || "")}">${escapeHtml(lead.name || "(no name)")}</strong></div>
        <div class="row2"><a class="phone-link copyable" data-copy="${escapeHtml(lead.phone)}" data-ctm-digits="${escapeHtml(lead.phone10 || (lead.phone || '').replace(/\D/g,'').slice(-10))}" href="https://app.calltrackingmetrics.com/calls/desk#filter=${escapeHtml(lead.phone10 || (lead.phone || '').replace(/\D/g,'').slice(-10))}" title="Click to open CTM filtered to this number">${escapeHtml(lead.phone)}</a> ${sourcePillHtml(lead.source)}${statusPillHtml(lead.status)}${doubleTapBadge}</div>
        ${noteHtml}
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

  // ── Sort + filter the queue ──
  // Tier 1: uncontacted (attempts=0, not Resolved/DNC)
  // Tier 2: nextContactDate is today (follow-up due)
  // Tier 3: in-progress (Follow-Up/Attempted/Left VM, attempts < MAX)
  // Skip: Resolved/DNC, attempts >= MAX, locked by someone else
  // Accepts the API response — uses `rows` array (no phone dedup) if available,
  // falls back to the legacy `leads` map for old API responses.
  function classifyAndSort(apiData) {
    const todayAz = new Date().toLocaleDateString("en-US", { timeZone: "America/Phoenix" });
    const nowMs = Date.now();
    const rows = Array.isArray(apiData.rows) ? apiData.rows : Object.values(apiData.leads || {});
    const out = [];
    const autoLostLeads = [];
    let skipped3hr = 0;
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

      // 8+ attempts with no positive outcome → auto-Lost candidate
      if (attempts >= MAX_ATTEMPTS) {
        autoLostLeads.push(l);
        continue;
      }

      // Same-day repeat skip: once a lead has been attempted TWICE today (or
      // more), drop them out of today's queue entirely — pick them up
      // tomorrow per the new cadence. First-time→second-callback same-day
      // flow still works because attempts will be 1 (not >=2) at that point.
      const lastIsToday = l.lastContactDate && sameAzDate(l.lastContactDate, todayAz);
      if (lastIsToday && attempts >= 2) {
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
      if (skipped3hr > 0) parts.push(`${skipped3hr} waiting on 3-hr gap`);
      if (skippedSource > 0) parts.push(`${skippedSource} filtered by source`);
      if (skippedAttempts > 0) parts.push(`${skippedAttempts} filtered by attempts`);
      if (parts.length > 0) log(parts.join(", "), "info", "queue");
    }
    updateFilterStats(skippedSource, skippedAttempts, skipped3hr);

    // Fire off auto-Lost saves in background (don't block queue load)
    if (autoLostLeads.length > 0) {
      log(`auto-disposing ${autoLostLeads.length} leads as Lost (8+ attempts, never contacted)`, "warn", "auto");
      autoLostLeads.forEach(lead => {
        saveDisposition(lead.phone10 || lead.phone, "Lost", "never contacted — auto-disposed after 8 attempts", lead).catch(() => {});
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

  function sameAzDate(dateStr, todayStr) {
    if (!dateStr) return false;
    return dateStr.trim() === todayStr.trim();
  }

  // Cadence:
  //   Day 1: attempts 1+2 (double-tap morning) + 3 (afternoon)
  //   Day 2: attempt 4
  // First-time caller (attempts === 1): "today + 3 hours" WITH time, so the
  // rep can see exactly when the callback is due ("5/28/2026 1:32 PM").
  // Subsequent attempts (2 through MAX_ATTEMPTS-1): tomorrow, date only.
  // 8+ attempts: null → auto-Lost.
  function computeNextContactDate(attemptsAfterCall) {
    if (attemptsAfterCall >= MAX_ATTEMPTS) return null;
    if (attemptsAfterCall <= 1) return azDateTimePlusHours(3);
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

  async function clearSheetLogForVersion() {
    try {
      await fetch(DEBUG_LOG_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear", version: _extensionVersion, rep: repName }),
      });
    } catch (_) { /* best-effort */ }
  }

  // Detect version change between runs and clear the sheet log before adding new entries
  async function initSheetLogMirror() {
    try {
      _extensionVersion = chrome.runtime.getManifest().version;
    } catch (_) { _extensionVersion = "unknown"; }
    try {
      const stored = await chrome.storage.local.get(["dialer_log_last_version"]);
      const prev = stored.dialer_log_last_version;
      if (prev !== _extensionVersion) {
        await clearSheetLogForVersion();
        await chrome.storage.local.set({ dialer_log_last_version: _extensionVersion });
        log(`sheet log cleared for new version ${_extensionVersion} (was ${prev || "first run"})`, "info", "init");
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

  async function claimLead(phone, rowIndex) {
    try {
      const r = await fetch(DISPOSITIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, rowIndex, action: "claim", rep: repName }),
      });
      const data = await r.json();
      if (data.claimed) {
        log(`claimed ${phone} for ${repName}`, "ok", "lock");
        return true;
      }
      log(`claim refused for ${phone}: ${data.reason || "?"} (held by ${data.lockedBy || "?"})`, "warn", "lock");
      return false;
    } catch (e) {
      log(`claim error for ${phone}: ${e.message}`, "err", "lock");
      return false;
    }
  }

  async function releaseLead(phone, rowIndex) {
    try {
      await fetch(DISPOSITIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, rowIndex, action: "release" }),
      });
      log(`released ${phone} (row ${rowIndex || "?"})`, "info", "lock");
    } catch (e) {
      log(`release error for ${phone}: ${e.message}`, "err", "lock");
    }
  }

  async function saveDisposition(phone, status, notes, leadAtSaveTime, opts) {
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
      log("quiet hours active (8am-9pm AZ) — pausing", "warn", "state");
      mode = "paused";
      setPhase("idle");
      currentLead = null;
      renderCurrent();
      return;
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
      const claimed = await claimLead(candidate.phone, candidate.rowIndex);
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

    setPhase("dialing");
    retriedOnMainLine = false;
    sessionCount++;
    if (els.sessionCount) els.sessionCount.textContent = sessionCount;
    _currentDialAt = Date.now();
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
        sendToCtm({ type: "hangup" }).catch(() => {});
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

    // AUTO-RETRY: if the call connected but dropped in <5s and we haven't
    // retried yet, redial on Main Line after a 2s pause to let CTM's stale
    // events flush. Some numbers get a one-ring hangup on certain outbound
    // tracking numbers but go through on the main line.
    if (connectedThisCall && callDurationMs > 0 && callDurationMs < AUTO_RETRY_THRESHOLD_MS && !retriedOnMainLine) {
      retriedOnMainLine = true;
      log(`ultra-short call (${Math.round(callDurationMs/1000)}s) — retrying on Main Line in 2s`, "warn", "retry");
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
              sendToCtm({ type: "hangup" }).catch(() => {});
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
  function showWrapup(defaultStatus, isShortCall) {
    wrapupActiveLead = currentLead;
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
    setTimeout(() => { try { els.wrapupNotes.focus(); } catch (_) {} }, 50);
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
      `Auto-saving in <strong>${remaining}s</strong> · type a note or change the dropdown to reset the timer.`;
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
    const shouldDoubleTap =
      advance && mode === "running" &&
      status === "Attempted" &&
      priorAttempts === 0;

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
    setPhase("dialing");
    retriedOnMainLine = false;
    sessionCount++;
    if (els.sessionCount) els.sessionCount.textContent = sessionCount;
    _currentDialAt = Date.now();
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
        sendToCtm({ type: "hangup" }).catch(() => {});
        onCallEnded({ source: "double-tap-timeout" });
      }
    }, RING_TIMEOUT_MS);
  }

  // ── In-session "Completed" list ──
  // After each disposition save, push a row into the completedThisSession array
  // and render the list. Gives Travis a clear visual that the queue is moving.
  function pushCompleted(item) {
    completedThisSession.push(item);
    renderCompleted();
  }
  function renderCompleted() {
    const el = els.completed;
    if (!el) return;
    if (completedThisSession.length === 0) {
      el.innerHTML = "<em style='color:var(--muted);'>None yet this session.</em>";
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
    if (mode === "running") return;
    if (inQuietHours()) { log("can't start — outside quiet hours (8am-9pm AZ only)", "err", "ui"); return; }
    const ready = await ensureCtmTab();
    if (!ready) return;
    sessionCount = 0;
    completedThisSession.length = 0;
    renderCompleted();
    // NOTE: do NOT clear removedThisSession here — user-removed leads should stay
    // removed across Start/Stop cycles within the same dialer window.
    mode = "running";
    log(`▶ START clicked — session limit: ${sessionLimit} calls · test=${testMode ? "ON" : "off"}`, "act", "ui");
    setPhase("fetching");
    advanceToNext();
  };

  els.pauseBtn.onclick = () => {
    if (mode === "running") {
      mode = "paused";
      log("⏸ PAUSE clicked — dialer halted between calls", "act", "ui");
      setPhase(phase); // re-enable/disable buttons
    } else if (mode === "paused") {
      mode = "running";
      log("▶ RESUME clicked", "act", "ui");
      if (!currentLead) advanceToNext();
      else setPhase(phase);
    }
  };

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
        els.wrapupHelp.textContent = "Disposition required — click Save → Next or Save → Stop to dismiss.";
        els.wrapupHelp.style.color = "var(--danger)";
        setTimeout(() => { if (els.wrapupHelp) els.wrapupHelp.style.color = ""; }, 1200);
      }
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && els.scrim.classList.contains("show")) {
      e.preventDefault();
      e.stopPropagation();
      log("Escape ignored — disposition is required", "warn", "ui");
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
        mode = "paused";
        log(`⏸ paused — switched to "${msg.sectionId || "other"}" tab`, "warn", "ui");
        setPhase(phase);
      } else if (!active && mode === "paused") {
        // already paused, nothing to do
      } else if (active) {
        log(`dialer tab active`, "info", "ui");
        // Re-check CTM tab whenever dialer becomes visible
        if (!ctmTabOpen) {
          ensureCtmTabOnLoad();
        }
      }
    }
  });

  // ── Init ──
  async function init() {
    log(`dialer loaded`, "info", "init");
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

  init();
})();

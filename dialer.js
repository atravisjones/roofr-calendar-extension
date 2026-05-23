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
  const WRAPUP_AUTOADVANCE_MS = 8000;
  const RING_TIMEOUT_MS = 35000;      // give up if no ctm:start within 35s
  const QUIET_START_HOUR = 8;          // 8am AZ
  const QUIET_END_HOUR = 21;           // 9pm AZ
  const MAX_ATTEMPTS = 3;
  const POLL_BRIDGE_MS = 5000;

  // ── State ──
  let mode = "idle";      // 'idle' | 'running' | 'paused' | 'stopping'
  let phase = "idle";     // 'idle' | 'fetching' | 'dialing' | 'ringing' | 'connected' | 'wrapup'
  let currentLead = null;
  let queue = [];
  let ringTimeoutId = null;
  let wrapupTimerId = null;
  let bridgeReady = false;
  let ctmTabOpen = false;
  let repName = "unknown";
  let connectedThisCall = false;

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
    current: $("current"),
    queue: $("queue"),
    log: $("log"),
    scrim: $("wrapup-scrim"),
    wrapupTitle: $("wrapup-title"),
    wrapupStatus: $("wrapup-status"),
    wrapupNotes: $("wrapup-notes"),
    wrapupSaveNext: $("wrapup-save-next"),
    wrapupSaveStop: $("wrapup-save-stop"),
    autoAdvance: $("auto-advance"),
  };

  function log(msg, kind = "") {
    const line = document.createElement("div");
    if (kind) line.className = kind;
    const ts = new Date().toLocaleTimeString();
    line.textContent = `${ts} ${msg}`;
    els.log.appendChild(line);
    els.log.scrollTop = els.log.scrollHeight;
    // Cap log size
    while (els.log.children.length > 200) els.log.removeChild(els.log.firstChild);
  }

  // ── Pill helpers ──
  function setPill(el, state, label) {
    el.className = `pill ${state}`;
    el.querySelector(".label").textContent = label;
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
    els.current.innerHTML = `
      <div class="phase ${phase}">${phaseLabel}</div>
      <div class="lead-name">${escapeHtml(currentLead.name || "(no name)")}</div>
      <div class="lead-phone">${escapeHtml(currentLead.phone)}</div>
      <div class="lead-meta">
        <span>Source: ${escapeHtml(currentLead.source || "—")}</span>
        <span>Attempts: ${currentLead.attemptCount || 0}</span>
        <span>Last: ${escapeHtml(currentLead.lastContactDate || "never")}</span>
      </div>
      <div class="call-actions">
        <button id="hangup-btn">☎ Hangup</button>
        <button id="skip-btn">⏭ Skip</button>
      </div>
    `;
    $("hangup-btn").onclick = onHangupClick;
    $("skip-btn").onclick = onSkipClick;
  }

  function renderQueue() {
    els.queue.innerHTML = "";
    const next = queue.slice(0, 8);
    for (const lead of next) {
      const li = document.createElement("li");
      if (lead.lockedBy && lead.lockedBy !== repName) li.classList.add("locked");
      const tier = lead._tier;
      const tierLabel = { 1: "NEW", 2: "TODAY", 3: "WIP" }[tier] || "—";
      li.innerHTML = `
        <span>
          <span class="tier t${tier}">${tierLabel}</span>
          <strong>${escapeHtml(lead.name || "(no name)")}</strong>
          <span class="meta"> · ${escapeHtml(lead.phone)}</span>
        </span>
        <span class="meta">
          ${lead.attemptCount || 0} att${lead.lockedBy && lead.lockedBy !== repName ? ` · 🔒 ${escapeHtml(lead.lockedBy)}` : ""}
        </span>
      `;
      els.queue.appendChild(li);
    }
    els.queueCount.textContent = queue.length;
    els.t1Count.textContent = queue.filter(l => l._tier === 1).length;
    els.t2Count.textContent = queue.filter(l => l._tier === 2).length;
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
  function classifyAndSort(leadsMap) {
    const todayAz = new Date().toLocaleDateString("en-US", { timeZone: "America/Phoenix" });
    const out = [];
    for (const phone of Object.keys(leadsMap)) {
      const l = leadsMap[phone];
      const attempts = parseInt(l.attemptCount) || 0;
      const status = (l.status || "").trim();
      if (status === "Resolved" || status === "DNC" || status === "Wrong Number") continue;
      if (attempts >= MAX_ATTEMPTS && !status.startsWith("Follow-Up")) continue;
      if (l.lockedBy && l.lockedBy !== repName) {
        // Show as locked but don't queue for our dialer
        out.push({ ...l, _tier: 3, _skip: true });
        continue;
      }
      let tier = 3;
      if (attempts === 0) tier = 1;
      else if (l.nextContactDate && sameAzDate(l.nextContactDate, todayAz)) tier = 2;
      out.push({ ...l, _tier: tier });
    }
    out.sort((a, b) => {
      // Test rows always first within the queue
      const aTest = /\btest\b/i.test(a.name || "");
      const bTest = /\btest\b/i.test(b.name || "");
      if (aTest !== bTest) return aTest ? -1 : 1;
      if (a._tier !== b._tier) return a._tier - b._tier;
      const aAtt = parseInt(a.attemptCount) || 0;
      const bAtt = parseInt(b.attemptCount) || 0;
      if (aAtt !== bAtt) return aAtt - bAtt;
      // Stable tiebreak by name so the queue doesn't depend on Object key order
      return (a.name || "").localeCompare(b.name || "");
    });
    return out.filter(l => !l._skip).concat(out.filter(l => l._skip));
  }

  function sameAzDate(dateStr, todayStr) {
    if (!dateStr) return false;
    // dateStr typically "M/D/YYYY" from the sheet; todayStr "M/D/YYYY" from en-US
    return dateStr.trim() === todayStr.trim();
  }

  // ── Quiet hours ──
  function inQuietHours() {
    const hourAz = parseInt(new Date().toLocaleString("en-US", {
      timeZone: "America/Phoenix", hour: "2-digit", hour12: false,
    }));
    return hourAz < QUIET_START_HOUR || hourAz >= QUIET_END_HOUR;
  }

  // ── Sheet API ──
  async function fetchLeads() {
    log("fetching leads…");
    try {
      const r = await fetch(DISPOSITIONS_URL);
      const data = await r.json();
      if (!data.configured) {
        log(`leads API not configured: ${data.error || ""}`, "err");
        return;
      }
      queue = classifyAndSort(data.leads || {});
      log(`queue loaded: ${queue.length} leads (t1=${queue.filter(l=>l._tier===1).length})`);
      renderQueue();
    } catch (e) {
      log(`fetch leads failed: ${e.message}`, "err");
    }
  }

  async function claimLead(phone) {
    try {
      const r = await fetch(DISPOSITIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, action: "claim", rep: repName }),
      });
      const data = await r.json();
      if (data.claimed) {
        log(`claimed ${phone}`);
        return true;
      }
      log(`claim refused for ${phone}: ${data.reason || "?"} (held by ${data.lockedBy || "?"})`, "err");
      return false;
    } catch (e) {
      log(`claim error: ${e.message}`, "err");
      return false;
    }
  }

  async function releaseLead(phone) {
    try {
      await fetch(DISPOSITIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, action: "release" }),
      });
      log(`released ${phone}`);
    } catch (e) {
      log(`release error: ${e.message}`, "err");
    }
  }

  async function saveDisposition(phone, status, notes) {
    try {
      const r = await fetch(DISPOSITIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, status, rep: repName, notes }),
      });
      const data = await r.json();
      if (data.updated) log(`disposition saved: ${phone} → ${status}`);
      else log(`disposition save failed: ${data.error || "?"}`, "err");
    } catch (e) {
      log(`disposition error: ${e.message}`, "err");
    }
  }

  // ── CTM bridge messaging ──
  function sendToCtm(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "AD_TO_CTM", payload }, (resp) => {
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
      chrome.runtime.sendMessage({ type: "AD_PING_CTM" }, (resp) => {
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
    if (mode !== "running") return;

    if (inQuietHours()) {
      log("quiet hours active — pausing", "err");
      mode = "paused";
      setPhase("idle");
      currentLead = null;
      renderCurrent();
      return;
    }

    setPhase("fetching");
    // Re-fetch queue occasionally so locks from other reps + new leads are visible
    await fetchLeads();

    // Find next claimable lead
    let lead = null;
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (candidate.lockedBy && candidate.lockedBy !== repName) continue;
      const claimed = await claimLead(candidate.phone);
      if (claimed) { lead = candidate; break; }
    }

    if (!lead) {
      log("queue empty — stopping");
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
      log(`bad phone format: ${lead.phone}`, "err");
      await onCallEnded({ source: "format-error" });
      return;
    }

    // Look up outbound caller ID by source. dialer-sources.js defines the map.
    let outbound = null;
    try { outbound = (window.DialerSources || {}).lookupOutbound?.(lead.source); } catch (_) {}
    if (outbound) {
      log(`source "${lead.source || '(blank)'}" → outbound ${outbound.name} ${outbound.number}`);
    } else {
      log(`no outbound mapping for source "${lead.source}" — using whatever CTM has selected`, "err");
    }

    setPhase("dialing");
    log(`dialing ${lead.name} ${e164}`);
    const resp = await sendToCtm({
      type: "dial",
      number: e164,
      fromNumber: outbound?.number || null,
      fromName: outbound?.name || null,
    });
    if (!resp.ok) {
      log(`dial command failed: ${resp.error || "?"}`, "err");
      await onCallEnded({ source: "dial-failed", reason: resp.error });
      return;
    }

    // Safety timer: if we never get a ctm:start, treat as no-answer
    clearTimeout(ringTimeoutId);
    ringTimeoutId = setTimeout(() => {
      if (phase === "dialing" || phase === "ringing") {
        log(`ring timeout (${RING_TIMEOUT_MS/1000}s) — treating as no-answer`);
        sendToCtm({ type: "hangup" }).catch(() => {});
        onCallEnded({ source: "ring-timeout" });
      }
    }, RING_TIMEOUT_MS);
  }

  async function onCallEnded({ source }) {
    clearTimeout(ringTimeoutId);
    if (!currentLead) return;
    if (phase === "wrapup") return;
    setPhase("wrapup");
    showWrapup(connectedThisCall ? "Connected" : "No Answer");
  }

  // ── Wrap-up modal ──
  let wrapupActiveLead = null;
  function showWrapup(defaultStatus) {
    wrapupActiveLead = currentLead;
    els.wrapupTitle.textContent = `Wrap up — ${wrapupActiveLead.name || wrapupActiveLead.phone}`;
    els.wrapupStatus.value = defaultStatus;
    els.wrapupNotes.value = "";
    els.scrim.classList.add("show");
    startWrapupAutoAdvance();
  }

  function hideWrapup() {
    els.scrim.classList.remove("show");
    cancelWrapupAutoAdvance();
    wrapupActiveLead = null;
  }

  function startWrapupAutoAdvance() {
    let remaining = WRAPUP_AUTOADVANCE_MS / 1000;
    els.autoAdvance.innerHTML = `Auto-advancing in ${remaining}s · <a id="autoadv-cancel">Cancel</a>`;
    $("autoadv-cancel").onclick = cancelWrapupAutoAdvance;
    wrapupTimerId = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(wrapupTimerId);
        wrapupTimerId = null;
        finishWrapup(true);
        return;
      }
      els.autoAdvance.innerHTML = `Auto-advancing in ${remaining}s · <a id="autoadv-cancel">Cancel</a>`;
      $("autoadv-cancel").onclick = cancelWrapupAutoAdvance;
    }, 1000);
  }

  function cancelWrapupAutoAdvance() {
    if (wrapupTimerId) clearInterval(wrapupTimerId);
    wrapupTimerId = null;
    els.autoAdvance.textContent = "Auto-advance cancelled.";
  }

  async function finishWrapup(advance) {
    if (!wrapupActiveLead) return;
    const phone = wrapupActiveLead.phone;
    const status = els.wrapupStatus.value;
    const notes = els.wrapupNotes.value.trim();
    hideWrapup();
    currentLead = null;
    await saveDisposition(phone, status, notes);
    if (advance && mode === "running") {
      advanceToNext();
    } else {
      mode = "idle";
      setPhase("idle");
    }
  }

  // ── Button handlers ──
  els.startBtn.onclick = async () => {
    if (mode === "running") return;
    if (!ctmTabOpen) { log("open app.calltrackingmetrics.com first", "err"); return; }
    if (!bridgeReady) { log("bridge not ready — make sure the CTM tab has loaded", "err"); return; }
    if (inQuietHours()) { log("quiet hours (8am-9pm AZ only)", "err"); return; }
    mode = "running";
    log("started");
    setPhase("fetching");
    advanceToNext();
  };

  els.pauseBtn.onclick = () => {
    if (mode === "running") {
      mode = "paused";
      log("paused");
      setPhase(phase); // re-enable/disable buttons
    } else if (mode === "paused") {
      mode = "running";
      log("resumed");
      if (!currentLead) advanceToNext();
      else setPhase(phase);
    }
  };

  els.stopBtn.onclick = async () => {
    log("stopping");
    mode = "stopping";
    if (currentLead) {
      await sendToCtm({ type: "hangup" }).catch(() => {});
      await releaseLead(currentLead.phone);
      currentLead = null;
    }
    mode = "idle";
    setPhase("idle");
  };

  function onHangupClick() {
    sendToCtm({ type: "hangup" });
  }

  async function onSkipClick() {
    if (!currentLead) return;
    log(`skipping ${currentLead.phone}`);
    await sendToCtm({ type: "hangup" }).catch(() => {});
    await releaseLead(currentLead.phone);
    currentLead = null;
    if (mode === "running") advanceToNext();
    else setPhase("idle");
  }

  els.wrapupSaveNext.onclick = () => finishWrapup(true);
  els.wrapupSaveStop.onclick = () => { mode = "idle"; finishWrapup(false); };
  els.settingsBtn.onclick = () => chrome.runtime.openOptionsPage();

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
        log("bridge ready");
      }
      return;
    }
    if (p.type === "ctm-event") {
      log(`<span class="ev">${p.event}</span>`, "");
      // Use innerHTML so the span renders
      const last = els.log.lastChild;
      if (last) last.innerHTML = `${new Date().toLocaleTimeString()} <span class="ev">${p.event}</span>`;
      handleCtmEvent(p.event, p.detail || {});
      return;
    }
    if (p.type === "command-error") {
      log(`bridge error (${p.originalType}): ${p.error}`, "err");
      return;
    }
  });

  function handleCtmEvent(name, detail) {
    if (!currentLead) return;
    if (name === "ctm:connecting") {
      setPhase("dialing");
    } else if (name === "ctm:start") {
      setPhase("connected");
      connectedThisCall = true;
      clearTimeout(ringTimeoutId);
    } else if (name === "ctm:failed") {
      log(`call failed: ${JSON.stringify(detail)}`, "err");
      onCallEnded({ source: "failed" });
    } else if (name === "ctm:end-activity" || name === "ctm:wrapup_start") {
      onCallEnded({ source: name });
    }
  }

  // ── Init ──
  async function init() {
    // Load rep name from extension settings (set in options.html)
    try {
      const s = await chrome.storage.sync.get(["ctm_csr", "ctm_user", "ctm_display_name"]);
      repName = s.ctm_csr || s.ctm_display_name || s.ctm_user || "unknown";
      els.repName.textContent = `Rep: ${repName}`;
      if (repName === "unknown") {
        log("rep name not set — open ⚙ to set ctm_csr in options", "err");
      }
    } catch (_) {}

    // Initial CTM tab check
    ctmTabOpen = await checkCtmTab();
    updateBridgeStatus();
    setPhase("idle");

    // Initial queue fetch
    await fetchLeads();

    // Poll CTM tab status (in case user opens/closes the tab)
    setInterval(async () => {
      const open = await checkCtmTab();
      if (open !== ctmTabOpen) {
        ctmTabOpen = open;
        if (!open) bridgeReady = false;
        updateBridgeStatus();
        setPhase(phase);
      }
      // Re-ping bridge so we know if it's alive. Log failures so chain
      // breaks surface (instead of silent waiting forever).
      if (open && !bridgeReady) {
        const resp = await sendToCtm({ type: "ping" });
        if (!resp.ok) {
          log(`ping failed: ${resp.error || "unknown"} — relay or content script may not be loaded`, "err");
        }
      }
    }, 2000);   // Poll every 2s — cheap, keeps bridge state fresh

    // First bridge ping
    if (ctmTabOpen) {
      const resp = await sendToCtm({ type: "ping" });
      if (!resp.ok) {
        log(`initial ping failed: ${resp.error || "unknown"}`, "err");
      }
    }
  }

  init();
})();

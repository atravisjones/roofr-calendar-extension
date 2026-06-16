// roofr-timeline.js - Job stage-history timeline bar at the bottom of app.roofr.com.
// Shows when a job card modal is open: one chip per stage the job has been in, with
// entry date + time-in-stage; hover = exact timestamps, who moved it, and the notes
// written during that stage. Collapses to a bottom-right pill (state persisted).
// While open, html.rjt-timeline-open shrinks the job modal so nothing hides behind
// the bar; if Roofr renames its modal classes the bar falls back to a harmless
// overlay rather than breaking the page.
(function () {
  "use strict";

  if (window.__roofrTimelineLoaded) return;
  if (location.hostname !== "app.roofr.com") return;
  window.__roofrTimelineLoaded = true;

  const TEAM_ID = "239329";
  const COLLAPSE_KEY = "roofr_timeline_collapsed";   // chrome.storage.local — per machine
  const ENABLE_KEY = "roofr_timeline_enabled";       // chrome.storage.sync — Settings toggle, default OFF
  const OPEN_CLASS = "rjt-timeline-open";
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const MAX_PAGES = 10;          // 10 pages x 100 entries hard ceiling
  const STALE_WARN_DAYS = 7;     // "No activity in Nd" header badge
  const STUCK_AMBER_DAYS = 14;   // current stage amber past this
  const STUCK_RED_DAYS = 30;     // current stage red past this
  // No MutationObserver: watching Roofr's React DOM mutates constantly and
  // thrashes layout. URL hooks catch most opens instantly; this light poll
  // (string check first, one querySelector at most) catches the rest.
  const POLL_MS = 800;

  // Production-verified body format (see tools/roofr-sync/scrape-activity.py):
  // "Stage updated from <X> to <Y> by <Z>"
  const RE_STAGE_BODY = /Stage updated from (.+?) to (.+?) by (.+)/i;
  // Email activity entries carry no `direction` field (verified live 2026-06-13),
  // so outbound is inferred from a company sender domain. SMS entries DO carry it.
  const COMPANY_EMAIL_RE = /@(?:arizonaroofers|azroofco)\.com$/i;

  const state = {
    enabled: false,
    jobId: null,
    root: null,
    bar: null,
    pill: null,
    tooltip: null,
    controller: null,
    generation: 0,
    collapsed: false,
    tooltipAnchor: null,
    hideTimer: null
  };

  const cache = new Map(); // jobId -> { at: epochMs, value: builtTimeline }

  /* ================= data layer ================= */

  function xsrfToken() {
    const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  async function apiGet(pathOrUrl, signal) {
    const url = new URL(pathOrUrl, location.origin);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) {
      throw new Error("Refusing non-/api/ or cross-origin URL: " + pathOrUrl);
    }
    const res = await fetch(url.href, {
      credentials: "same-origin",
      signal,
      headers: {
        accept: "application/json",
        "team-id": TEAM_ID,
        "x-xsrf-token": xsrfToken()
      }
    });
    if (!res.ok) throw new Error(url.pathname + ": HTTP " + res.status);
    return res.json();
  }

  async function fetchAllActivities(jobId, signal) {
    const out = [];
    const visited = new Set();
    let next = "/api/job/" + encodeURIComponent(jobId) + "/activities?per_page=100";
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const abs = new URL(next, location.origin).href;
      if (visited.has(abs)) break; // pagination loop guard
      visited.add(abs);
      const res = await apiGet(next, signal);
      const items = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      out.push(...items);
      next = res?.links?.next || null;
    }
    return out;
  }

  function getPath(obj, path) {
    return path.split(".").reduce((cur, key) => cur?.[key], obj);
  }

  function firstString(obj, paths) {
    for (const p of paths) {
      const v = getPath(obj, p);
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  }

  // Strip HTML to readable text. Email bodies are full HTML docs, so drop
  // <style>/<script>/<head> blocks before stripping tags, and decode the
  // common entities, otherwise the preview is a wall of CSS.
  function plainText(value) {
    if (value === null || value === undefined) return null;
    const text = String(value)
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, " ")
      .trim();
    return text || null;
  }

  function activityAt(a) {
    return firstString(a, ["created_at", "occurred_at", "timestamp", "updated_at"]);
  }

  function activityAuthor(a) {
    return firstString(a, ["user.name", "author.name", "created_by.name", "user_name"]);
  }

  function parseStageChange(a) {
    if (a?.log_key !== "job_stage_updated") return null;
    const at = activityAt(a);
    if (!at) return null;

    let from = null, to = null, by = null;
    const body = plainText(firstString(a, ["body", "description", "message", "text"]));
    const m = body && body.match(RE_STAGE_BODY);
    if (m) { from = m[1].trim(); to = m[2].trim(); by = m[3].trim(); }

    // Defensive fallbacks in case Roofr ever moves to structured fields
    from = from || firstString(a, ["properties.old.job_stage.name", "properties.from.name", "old_value"]);
    to = to || firstString(a, ["properties.new.job_stage.name", "properties.to.name", "new_value"]);
    if (!to) return null;

    return { id: a.id ?? null, from, to, at, movedBy: by || activityAuthor(a) };
  }

  function parseNote(a) {
    if (a?.type !== "note" || a?.log_key != null) return null;
    const at = activityAt(a);
    if (!at) return null;
    return {
      kind: "note",
      at,
      who: activityAuthor(a),
      text: plainText(firstString(a, ["body", "note", "content", "description", "message", "text"]))
    };
  }

  // Email + SMS notifications. Channel = how it was sent; direction = who sent
  // it (outbound = team → contact, inbound = contact → team). Both feed the
  // color-coded message list and the per-stage counts.
  function parseComm(a) {
    const isEmail = a?.type === "email_notification";
    const isSms = a?.type === "sms_notification";
    if (!isEmail && !isSms) return null;
    const at = firstString(a, ["sent_at", "created_at"]);
    if (!at) return null;

    let dir = String(a.direction || "").toLowerCase();
    if (dir !== "inbound" && dir !== "outbound") {
      if (isEmail) {
        const from = (firstString(a, ["sender_email"]) || "").toLowerCase();
        dir = !from || COMPANY_EMAIL_RE.test(from) ? "outbound" : "inbound";
      } else {
        dir = "outbound"; // SMS without a direction is almost always a sent notification
      }
    }

    const teamMember = firstString(a, ["user.name"]);
    const sender = isEmail
      ? firstString(a, ["sender_email", "sender_name"])
      : firstString(a, ["sender_phone_number", "sender_name"]);
    const to = isEmail
      ? firstString(a, ["emails.to.0"]) || (Array.isArray(a.emails?.to) ? a.emails.to[0] : null)
      : firstString(a, ["phones.to.0"]) || (Array.isArray(a.phones?.to) ? a.phones.to[0] : null);

    return {
      kind: isEmail ? "email" : "sms",
      direction: dir,
      at,
      who: dir === "outbound" ? (teamMember || sender || "Team") : (sender || "Contact"),
      to: to || null,
      subject: isEmail ? plainText(a.subject) : null,
      text: plainText(firstString(a, ["body", "content", "message", "text"]))
    };
  }

  function buildTimeline(job, activities) {
    const changes = activities
      .map(parseStageChange)
      .filter(Boolean)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

    // Dedupe (id when present, else composite key)
    const seen = new Set();
    const uniqueChanges = changes.filter((c) => {
      const key = c.id !== null ? "id:" + c.id : c.at + " " + c.from + " " + c.to;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Notes + emails + texts, merged and time-ordered, assigned per stage window.
    const events = activities
      .map(parseNote)
      .filter(Boolean)
      .concat(activities.map(parseComm).filter(Boolean))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

    const currentName = firstString(job, [
      "job_workflow_stage.job_stage.name", "job_stage.name", "stage.name"
    ]);
    const createdAt = firstString(job, ["created_at"]) || uniqueChanges[0]?.at || null;
    const transitionedAt = firstString(job, ["job_workflow_stage.transitioned_at", "transitioned_at"]);

    const stages = [];
    if (uniqueChanges.length) {
      stages.push({
        name: uniqueChanges[0].from || "Created",
        enteredAt: createdAt || uniqueChanges[0].at,
        exitedAt: uniqueChanges[0].at,
        movedBy: null
      });
      uniqueChanges.forEach((c, i) => {
        stages.push({
          name: c.to,
          enteredAt: c.at,
          exitedAt: uniqueChanges[i + 1]?.at || null,
          movedBy: c.movedBy
        });
      });
    } else {
      stages.push({
        name: currentName || "Current stage",
        enteredAt: transitionedAt || createdAt || new Date().toISOString(),
        exitedAt: null,
        movedBy: null
      });
    }

    // Reconcile tail with the job's actual current stage (covers missed pages)
    const last = stages[stages.length - 1];
    if (currentName && last.name !== currentName) {
      if (transitionedAt && Date.parse(transitionedAt) >= Date.parse(last.enteredAt)) {
        last.exitedAt = transitionedAt;
        stages.push({ name: currentName, enteredAt: transitionedAt, exitedAt: null, movedBy: null });
      } else {
        last.name = currentName;
      }
    }

    const withEvents = stages.map((s, i) => ({
      ...s,
      isCurrent: i === stages.length - 1,
      events: events.filter((e) => {
        const t = Date.parse(e.at);
        return t >= Date.parse(s.enteredAt) && (!s.exitedAt || t < Date.parse(s.exitedAt));
      })
    }));

    // Newest activity of ANY type drives the "no activity" badge
    let lastActivityAt = null;
    for (const a of activities) {
      const at = activityAt(a);
      if (at && (!lastActivityAt || Date.parse(at) > Date.parse(lastActivityAt))) lastActivityAt = at;
    }

    const resolutionStatus = firstString(job, ["resolution.status", "resolution.name"]);
    return {
      stages: withEvents,
      lastActivityAt,
      resolution: resolutionStatus
        ? { status: resolutionStatus, closeDate: firstString(job, ["close_date"]) }
        : null
    };
  }

  async function loadTimeline(jobId, signal) {
    const hit = cache.get(jobId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const [job, activities] = await Promise.all([
      apiGet("/api/job/" + encodeURIComponent(jobId), signal),
      fetchAllActivities(jobId, signal)
    ]);
    const value = buildTimeline(job?.data || job, activities);
    cache.set(jobId, { at: Date.now(), value });
    if (cache.size > 20) cache.delete(cache.keys().next().value); // bound memory
    return value;
  }

  /* ================= formatting ================= */

  function fmtDate(iso) {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(iso));
  }

  function fmtExact(iso) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  }

  function fmtDuration(startIso, endIso) {
    let s = Math.max(0, Math.floor((Date.parse(endIso) - Date.parse(startIso)) / 1000));
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60);
    if (d) return d + "d " + h + "h";
    if (h) return h + "h " + m + "m";
    return Math.max(1, m) + "m";
  }

  function daysSince(iso) {
    return Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  }

  /* ================= UI ================= */

  function ensureRoot() {
    if (state.root && state.root.isConnected) return;

    state.root = document.createElement("div");
    state.root.id = "rjt-root";
    state.root.hidden = true;

    state.bar = document.createElement("section");
    state.bar.id = "rjt-bar";
    state.bar.setAttribute("aria-label", "Job stage timeline");

    state.pill = document.createElement("button");
    state.pill.id = "rjt-pill";
    state.pill.type = "button";
    state.pill.textContent = "Stage timeline";
    state.pill.addEventListener("click", () => setCollapsed(false));

    state.tooltip = document.createElement("aside");
    state.tooltip.id = "rjt-tooltip";
    state.tooltip.setAttribute("role", "tooltip");
    state.tooltip.hidden = true;
    // Let the user mouse into the tooltip to scroll long note lists
    state.tooltip.addEventListener("pointerenter", cancelHide);
    state.tooltip.addEventListener("pointerleave", scheduleHide);

    state.root.append(state.bar, state.pill, state.tooltip);
    // Root lives directly under <html>: safe with the dark-mode root filter,
    // and survives React re-rendering <body> children.
    document.documentElement.appendChild(state.root);
  }

  function setCollapsed(collapsed) {
    state.collapsed = collapsed;
    try { chrome.storage.local.set({ [COLLAPSE_KEY]: collapsed }); } catch (e) { /* context gone */ }
    applyVisibility();
  }

  function applyVisibility() {
    if (!state.root || state.root.hidden) {
      document.documentElement.classList.remove(OPEN_CLASS);
      return;
    }
    state.bar.hidden = state.collapsed;
    state.pill.hidden = !state.collapsed;
    document.documentElement.classList.toggle(OPEN_CLASS, !state.collapsed);
    if (state.collapsed) hideTooltip();
  }

  function setVisible(visible) {
    ensureRoot();
    state.root.hidden = !visible;
    if (!visible) {
      hideTooltip();
      document.documentElement.classList.remove(OPEN_CLASS);
    } else {
      applyVisibility();
    }
  }

  function buildHeader(statusText, badge) {
    const header = document.createElement("header");
    header.className = "rjt-header";

    const group = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = "Stage timeline";
    const status = document.createElement("span");
    status.className = "rjt-status";
    status.textContent = statusText;
    group.append(title, status);

    header.appendChild(group);

    if (badge) {
      const b = document.createElement("span");
      b.className = "rjt-badge " + (badge.level === "red" ? "rjt-badge-red" : "rjt-badge-amber");
      b.textContent = badge.text;
      header.appendChild(b);
    }

    const close = document.createElement("button");
    close.className = "rjt-collapse";
    close.type = "button";
    close.setAttribute("aria-label", "Collapse stage timeline");
    close.textContent = "×";
    close.addEventListener("click", () => setCollapsed(true));
    header.appendChild(close);
    return header;
  }

  function renderLoading() {
    state.bar.replaceChildren();
    const skeleton = document.createElement("div");
    skeleton.className = "rjt-skeleton";
    for (let i = 0; i < 5; i++) {
      const chip = document.createElement("span");
      chip.className = "rjt-skeleton-chip";
      skeleton.appendChild(chip);
    }
    state.bar.append(buildHeader("Loading history…"), skeleton);
  }

  function renderError(retry) {
    state.bar.replaceChildren();
    const box = document.createElement("div");
    box.className = "rjt-error";
    const msg = document.createElement("span");
    msg.textContent = "Couldn’t load stage history.";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Retry";
    btn.addEventListener("click", retry);
    box.append(msg, btn);
    state.bar.append(buildHeader("Error"), box);
  }

  function renderTimeline(data) {
    state.bar.replaceChildren();

    let badge = null;
    if (!data.resolution && data.lastActivityAt) {
      const stale = daysSince(data.lastActivityAt);
      if (stale >= STALE_WARN_DAYS) {
        badge = { text: "No activity " + stale + "d", level: stale >= STUCK_RED_DAYS ? "red" : "amber" };
      }
    }

    const header = buildHeader(
      data.stages.length + " stage" + (data.stages.length === 1 ? "" : "s"),
      badge
    );

    const scroll = document.createElement("div");
    scroll.className = "rjt-scroll";
    scroll.tabIndex = 0;
    const list = document.createElement("ol");
    list.className = "rjt-list";

    // A stage name appearing more than once = the job bounced back. Color all
    // its visits violet so the round-trip pairs up visually.
    const nameCounts = new Map();
    for (const s of data.stages) nameCounts.set(s.name, (nameCounts.get(s.name) || 0) + 1);
    const visitsSoFar = new Map();

    data.stages.forEach((stage, i) => {
      const visit = (visitsSoFar.get(stage.name) || 0) + 1;
      visitsSoFar.set(stage.name, visit);
      stage.visit = visit;
      stage.visitTotal = nameCounts.get(stage.name) || 1;

      const li = document.createElement("li");
      li.className = "rjt-stage";
      if (stage.visitTotal > 1) li.classList.add("rjt-stage-repeat");
      if (stage.isCurrent) {
        li.classList.add("rjt-stage-current");
        if (!data.resolution) {
          const days = daysSince(stage.enteredAt);
          if (days >= STUCK_RED_DAYS) li.classList.add("rjt-stuck-red");
          else if (days >= STUCK_AMBER_DAYS) li.classList.add("rjt-stuck-amber");
        }
      }

      const chip = document.createElement("button");
      chip.className = "rjt-chip";
      chip.type = "button";

      const name = document.createElement("span");
      name.className = "rjt-stage-name";
      name.textContent = stage.name;

      const counts = { note: 0, email: 0, sms: 0 };
      for (const e of stage.events) counts[e.kind] = (counts[e.kind] || 0) + 1;
      const meta = document.createElement("span");
      meta.className = "rjt-stage-meta";
      meta.textContent = fmtDate(stage.enteredAt) + " · " +
        fmtDuration(stage.enteredAt, stage.exitedAt || new Date().toISOString()) +
        (stage.visit > 1 ? " · ↩ #" + stage.visit : "") +
        (counts.note ? " · 📝" + counts.note : "") +
        (counts.email ? " · ✉" + counts.email : "") +
        (counts.sms ? " · 💬" + counts.sms : "");

      chip.append(name, meta);
      chip.addEventListener("pointerenter", () => showTooltip(chip, stage));
      chip.addEventListener("pointerleave", scheduleHide);
      chip.addEventListener("focus", () => showTooltip(chip, stage));
      chip.addEventListener("blur", scheduleHide);
      li.appendChild(chip);

      const isLastChip = i === data.stages.length - 1 && !data.resolution;
      if (!isLastChip) {
        const conn = document.createElement("span");
        conn.className = "rjt-connector";
        conn.setAttribute("aria-hidden", "true");
        li.appendChild(conn);
      }
      list.appendChild(li);
    });

    // Won/Lost end-cap for resolved jobs
    if (data.resolution) {
      const li = document.createElement("li");
      li.className = "rjt-stage";
      const cap = document.createElement("span");
      const won = /won/i.test(data.resolution.status);
      cap.className = "rjt-cap " + (won ? "rjt-cap-won" : "rjt-cap-lost");
      cap.textContent = data.resolution.status +
        (data.resolution.closeDate ? " · " + fmtDate(data.resolution.closeDate) : "");
      li.appendChild(cap);
      list.appendChild(li);
    }

    scroll.appendChild(list);

    // Viewport wraps the scroller between left/right arrows. The arrows only
    // appear when the stages overflow, and disable at each end.
    const viewport = document.createElement("div");
    viewport.className = "rjt-viewport";
    const leftArrow = makeArrow("left", scroll);
    const rightArrow = makeArrow("right", scroll);
    viewport.append(leftArrow, scroll, rightArrow);

    const updateArrows = () => {
      const max = scroll.scrollWidth - scroll.clientWidth;
      viewport.classList.toggle("rjt-has-overflow", max > 4);
      leftArrow.disabled = scroll.scrollLeft <= 2;
      rightArrow.disabled = scroll.scrollLeft >= max - 2;
    };
    scroll.addEventListener("scroll", updateArrows, { passive: true });

    state.bar.append(header, viewport);

    requestAnimationFrame(() => {
      list.querySelector(".rjt-stage-current")?.scrollIntoView({ block: "nearest", inline: "end" });
      updateArrows();
    });
  }

  function makeArrow(dir, scrollEl) {
    const btn = document.createElement("button");
    btn.className = "rjt-arrow rjt-arrow-" + dir;
    btn.type = "button";
    btn.setAttribute("aria-label", dir === "left" ? "Scroll timeline left" : "Scroll timeline right");
    btn.textContent = dir === "left" ? "‹" : "›";
    btn.addEventListener("click", () => {
      scrollEl.scrollBy({ left: dir === "left" ? -280 : 280, behavior: "smooth" });
    });
    return btn;
  }

  /* ================= tooltip ================= */

  function cancelHide() {
    if (state.hideTimer) { clearTimeout(state.hideTimer); state.hideTimer = null; }
  }

  function scheduleHide() {
    cancelHide();
    state.hideTimer = setTimeout(hideTooltip, 180);
  }

  function hideTooltip() {
    cancelHide();
    state.tooltipAnchor = null;
    if (state.tooltip) state.tooltip.hidden = true;
    // Reposition listeners live only while a tooltip is showing
    window.removeEventListener("resize", positionTooltip);
    document.removeEventListener("scroll", positionTooltip, true);
  }

  function showTooltip(anchor, stage) {
    cancelHide();
    state.tooltipAnchor = anchor;
    const tip = state.tooltip;
    tip.replaceChildren();

    const title = document.createElement("strong");
    title.className = "rjt-tooltip-title";
    title.textContent = stage.name;

    const dl = document.createElement("dl");
    dl.className = "rjt-tooltip-times";
    const row = (term, val) => {
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = val;
      dl.append(dt, dd);
    };
    row("Entered", fmtExact(stage.enteredAt));
    row("Exited", stage.exitedAt ? fmtExact(stage.exitedAt) : "Current stage");
    row("Moved by", stage.movedBy || "—");
    if (stage.visitTotal > 1) row("Visit", stage.visit + " of " + stage.visitTotal + " times in this stage");

    const evTitle = document.createElement("strong");
    evTitle.className = "rjt-tooltip-notes-title";
    evTitle.textContent = "Activity (" + stage.events.length + ")";

    const wrap = document.createElement("div");
    wrap.className = "rjt-tooltip-notes";
    if (!stage.events.length) {
      const empty = document.createElement("p");
      empty.className = "rjt-tooltip-empty";
      empty.textContent = "No notes, emails, or texts during this stage.";
      wrap.appendChild(empty);
    } else {
      for (const ev of stage.events) wrap.appendChild(renderEvent(ev));
    }

    tip.append(title, dl, evTitle, wrap);
    tip.hidden = false;
    positionTooltip();
    window.addEventListener("resize", positionTooltip);
    document.addEventListener("scroll", positionTooltip, true);
  }

  // One message/note row, colored by channel (note/email/text) and marked
  // by direction (→ sent by the team, ← received from the contact).
  function renderEvent(ev) {
    const art = document.createElement("article");
    art.className = "rjt-tooltip-note rjt-ev-" + ev.kind +
      (ev.kind !== "note" ? " rjt-ev-" + ev.direction : "");

    const tag = document.createElement("span");
    tag.className = "rjt-ev-tag";
    const arrow = ev.direction === "inbound" ? " ←" : " →";
    tag.textContent = ev.kind === "note" ? "NOTE"
      : ev.kind === "email" ? "EMAIL" + arrow
      : "TEXT" + arrow;

    const meta = document.createElement("div");
    meta.className = "rjt-tooltip-note-meta";
    const whoLine = (ev.who || "Unknown") +
      (ev.kind !== "note" && ev.to ? (ev.direction === "inbound" ? "" : " → " + ev.to) : "") +
      " · " + fmtExact(ev.at);
    meta.append(tag, document.createTextNode(" " + whoLine));

    art.appendChild(meta);

    if (ev.subject) {
      const subj = document.createElement("p");
      subj.className = "rjt-ev-subject";
      subj.textContent = ev.subject;
      art.appendChild(subj);
    }
    const body = document.createElement("p");
    body.textContent = ev.text || (ev.kind === "note" ? "Note added" : "(no preview)");
    art.appendChild(body);
    return art;
  }

  function positionTooltip() {
    const tip = state.tooltip;
    if (!state.tooltipAnchor || !tip || tip.hidden || !state.tooltipAnchor.isConnected) return;
    const a = state.tooltipAnchor.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const gutter = 10;
    tip.style.left = Math.min(window.innerWidth - t.width - gutter, Math.max(gutter, a.left)) + "px";
    tip.style.top = Math.max(gutter, a.top - t.height - gutter) + "px";
  }

  /* ================= lifecycle ================= */

  // Attribute/presence checks only — never call layout-forcing APIs
  // (getClientRects/offsetHeight) here; this runs on a timer.
  function modalDetailOpen() {
    const detail = document.querySelector(".jobs-detail-modal .job-detail");
    if (!detail) return false;
    const modal = detail.closest(".jobs-detail-modal");
    return !(modal && (modal.hidden || modal.getAttribute("aria-hidden") === "true"));
  }

  function currentJobId() {
    const m = location.search.match(/[?&]selectedJobId=(\d+)/);
    return (m && m[1]) || document.documentElement.dataset.roofrJobId || null;
  }

  async function mount(jobId) {
    state.controller?.abort();
    const generation = ++state.generation;
    const controller = new AbortController();
    state.controller = controller;
    state.jobId = jobId;

    setVisible(true);
    renderLoading();

    try {
      const data = await loadTimeline(jobId, controller.signal);
      if (generation !== state.generation || state.jobId !== jobId) return;
      renderTimeline(data);
    } catch (err) {
      if (err.name === "AbortError" || generation !== state.generation) return;
      console.warn("[RoofrTimeline] load failed:", err.message);
      renderError(() => { cache.delete(jobId); mount(jobId); });
    }
  }

  function teardown() {
    state.jobId = null;
    state.generation++;
    state.controller?.abort();
    if (state.root && !state.root.hidden) setVisible(false);
  }

  function reconcile() {
    const mounted = state.jobId !== null || (state.root && !state.root.hidden);

    if (!state.enabled) {
      if (mounted) teardown();
      return;
    }

    // Cheap bail-out first: a URL string match + a dataset read. The single
    // querySelector below only runs when there's a job-id signal at all.
    const jobId = currentJobId();

    if (!jobId || !modalDetailOpen()) {
      if (mounted) teardown();
      return;
    }

    if (jobId === state.jobId && state.root && !state.root.hidden) return;
    mount(jobId);
  }

  // After a navigation event the modal may take a few frames to render, so
  // check a few times on a decaying schedule instead of observing mutations.
  let burstTimers = [];
  function scheduleBurst() {
    for (const t of burstTimers) clearTimeout(t);
    burstTimers = [120, 350, 800, 1600].map((ms) => setTimeout(reconcile, ms));
    reconcile();
  }

  function start() {
    try {
      chrome.storage.sync.get(ENABLE_KEY, (r) => {
        state.enabled = r?.[ENABLE_KEY] === true; // unset = OFF
        reconcile();
      });
      chrome.storage.local.get(COLLAPSE_KEY, (r) => {
        state.collapsed = !!r?.[COLLAPSE_KEY];
        reconcile();
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "sync" && changes[ENABLE_KEY]) {
          state.enabled = changes[ENABLE_KEY].newValue === true;
          reconcile();
        }
      });
    } catch (e) {
      reconcile();
    }

    window.addEventListener("popstate", scheduleBurst);
    // Own history hook (content.js owns __roofrHistPatched; do not share flags)
    if (!window.__roofrTimelineHistPatched) {
      window.__roofrTimelineHistPatched = true;
      for (const m of ["pushState", "replaceState"]) {
        const orig = history[m].bind(history);
        history[m] = (...args) => { const r = orig(...args); scheduleBurst(); return r; };
      }
    }

    // Catches opens that never touch the URL (fiber-fallback path) and closes.
    setInterval(reconcile, POLL_MS);
  }

  start();
})();

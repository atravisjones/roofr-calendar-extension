/**
 * Auto-Dialer Bridge — MAIN world script
 *
 * Runs in the page's JS context on app.calltrackingmetrics.com so it can:
 *   - Find the <ctm-phone-embed> web component (may be in nested same-origin iframes)
 *   - Subscribe to CTM's official ctm:* events (no DOM polling needed)
 *   - Invoke phone.call(number) / phone.hangup() / phone.mute() on dial commands
 *
 * Communicates with the isolated-world relay (dialer-bridge.js) via
 * window.postMessage with a namespaced marker, since MAIN world can't use
 * chrome.runtime.
 */
(function () {
  "use strict";

  if (window.self !== window.top) return;       // top-level frame only
  if (window.__autoDialerBridgeMainLoaded) return;
  window.__autoDialerBridgeMainLoaded = true;

  const MSG_TAG = "__autoDialerBridge";
  const PREFIX = "[AutoDialer-Main]";

  // CTM events we forward to the dialer. List from the ctm-phone-embed
  // web component docs (github.com/calltracking/web-components).
  const CTM_EVENTS = [
    "ctm:ready",
    "ctm:status",
    "ctm:live-activity",
    "ctm:incomingCall",
    "ctm:connecting",
    "ctm:start",
    "ctm:failed",
    "ctm:end-activity",
    "ctm:wrapup_start",
    "ctm:wrapup_end",
    "ctm:recording_start",
    "ctm:recording_stop",
    "ctm:access_denied",
    "ctm:device_registered",
  ];

  let phoneEmbed = null;
  const hookedEvents = new WeakSet();

  function log(...args) { console.log(PREFIX, ...args); }
  function warn(...args) { console.warn(PREFIX, ...args); }

  // ── Find ctm-phone-embed across nested same-origin iframes ──
  function findPhoneEmbed() {
    const direct = document.querySelector("ctm-phone-embed");
    if (direct) return direct;
    // CTM nests the embed inside an iframe at /calls/desk and /calls/phone
    const iframes = document.querySelectorAll("iframe");
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument;
        if (!doc) continue;
        const el = doc.querySelector("ctm-phone-embed");
        if (el) return el;
        // One more level (defensive)
        for (const inner of doc.querySelectorAll("iframe")) {
          try {
            const innerDoc = inner.contentDocument;
            if (!innerDoc) continue;
            const innerEl = innerDoc.querySelector("ctm-phone-embed");
            if (innerEl) return innerEl;
          } catch (_) { /* cross-origin */ }
        }
      } catch (_) { /* cross-origin */ }
    }
    return null;
  }

  function postToRelay(payload) {
    window.postMessage({ [MSG_TAG]: true, dir: "to-relay", ...payload }, "*");
  }

  // ── Outbound number selection + dial ──
  // We try three strategies in order. The first one to "work" (no throw) wins.
  // Since we can't programmatically verify CTM actually accepted the outbound
  // change without watching the next call's tracking_number, we log which
  // strategy we used so Travis can verify in CTM call logs and refine.
  function setOutboundAndDial(toNumber, fromNumber) {
    if (!fromNumber) {
      // No mapping known — just dial with current dropdown selection
      phoneEmbed.call(toNumber);
      return { strategy: "no-from" };
    }

    // Strategy 1: two-arg call(to, from) — undocumented but worth trying
    try {
      const before = readOutboundSelection();
      phoneEmbed.call(toNumber, fromNumber);
      const after = readOutboundSelection();
      // If the visible dropdown changed to match fromNumber, strategy worked
      if (matchesPhone(after, fromNumber) && !matchesPhone(before, fromNumber)) {
        return { strategy: "2arg-call" };
      }
      // call() was invoked either way; don't double-dial below
      return { strategy: "2arg-call-untested" };
    } catch (e1) {
      log("strategy 1 (2-arg call) threw:", e1.message);
    }

    // Strategy 2: dispatch 'dial' event with from in detail
    try {
      const ok = phoneEmbed.dispatchEvent(new CustomEvent("dial", {
        detail: { phoneNumber: toNumber, from: fromNumber, fromNumber: fromNumber },
      }));
      // We can't reliably detect if the event handler honored `from`. Treat
      // as the chosen path only if we can verify after.
      const after = readOutboundSelection();
      if (matchesPhone(after, fromNumber)) {
        return { strategy: "dial-event-from" };
      }
    } catch (e2) {
      log("strategy 2 (dial event) threw:", e2.message);
    }

    // Strategy 3: set the dropdown manually, then call
    const dropdown = findOutboundDropdown();
    if (dropdown) {
      const set = setDropdownValue(dropdown, fromNumber);
      if (set) {
        phoneEmbed.call(toNumber);
        return { strategy: "dropdown-set", dropdownTag: dropdown.tagName.toLowerCase() };
      }
    }

    // Fallback: dial with whatever the dropdown currently has
    phoneEmbed.call(toNumber);
    return { strategy: "fallback-no-from-set" };
  }

  // Normalize "+16025079882", "(602) 507-9882", "16025079882" all to "6025079882"
  function bareDigits(s) {
    if (!s) return "";
    const d = String(s).replace(/\D/g, "");
    return d.length > 10 ? d.slice(-10) : d;
  }
  function matchesPhone(a, b) {
    return bareDigits(a) && bareDigits(a) === bareDigits(b);
  }

  // Try to read what outbound number the CTM softphone is currently set to.
  // CTM's softphone shows it in a <select> or visible label inside the embed.
  function readOutboundSelection() {
    if (!phoneEmbed) return null;
    const candidateSelectors = [
      "select.outbound-number",
      "select[name='outbound_number']",
      "select[name='from']",
      "select[data-role='outbound']",
      "select",
      "[data-outbound-number]",
      ".outbound-number-display",
      ".calling-from",
    ];
    // Try the embed's own DOM + nested same-origin iframes
    const docs = [phoneEmbed.ownerDocument];
    for (const inner of phoneEmbed.querySelectorAll?.("iframe") || []) {
      try { if (inner.contentDocument) docs.push(inner.contentDocument); } catch (_) {}
    }
    for (const doc of docs) {
      for (const sel of candidateSelectors) {
        const el = doc.querySelector(sel);
        if (!el) continue;
        if (el.tagName === "SELECT") return el.value || el.options[el.selectedIndex]?.text || "";
        return el.getAttribute("data-outbound-number") || el.textContent || "";
      }
    }
    return null;
  }

  function findOutboundDropdown() {
    if (!phoneEmbed) return null;
    const docs = [phoneEmbed.ownerDocument];
    for (const inner of phoneEmbed.querySelectorAll?.("iframe") || []) {
      try { if (inner.contentDocument) docs.push(inner.contentDocument); } catch (_) {}
    }
    for (const doc of docs) {
      // Any select inside the embed; prefer ones whose options look like phone numbers
      for (const sel of doc.querySelectorAll("select")) {
        const options = Array.from(sel.options || []);
        const phoneLooking = options.filter(o =>
          /\+?1?\s*[\(]?\d{3}[\)]?[\s\-\.]?\d{3}[\s\-\.]?\d{4}/.test(o.value || o.textContent)
        );
        if (phoneLooking.length >= 2) return sel;
      }
    }
    return null;
  }

  function setDropdownValue(select, fromNumber) {
    const target = bareDigits(fromNumber);
    for (const opt of Array.from(select.options)) {
      if (bareDigits(opt.value) === target || bareDigits(opt.textContent) === target) {
        select.value = opt.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        select.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  function hookEmbed(el) {
    if (hookedEvents.has(el)) {
      phoneEmbed = el;
      return;
    }
    phoneEmbed = el;
    hookedEvents.add(el);

    for (const name of CTM_EVENTS) {
      el.addEventListener(name, (e) => {
        // Strip non-cloneable bits from detail before forwarding
        let detail = {};
        try {
          detail = e.detail ? JSON.parse(JSON.stringify(e.detail)) : {};
        } catch (_) {
          detail = { _unserializable: true };
        }
        postToRelay({ type: "ctm-event", event: name, detail, ts: Date.now() });
      });
    }

    postToRelay({ type: "bridge-ready", hasEmbed: true, ts: Date.now() });
    log("hooked ctm-phone-embed, subscribed to", CTM_EVENTS.length, "events");

    // Re-broadcast bridge-ready every 2s while we have an embed. Idempotent;
    // dialer ignores after first. Handles the race where the dialer opens
    // AFTER the one-shot ready event already fired.
    if (!window.__autoDialerBridgeReadyTimer) {
      window.__autoDialerBridgeReadyTimer = setInterval(() => {
        if (phoneEmbed) {
          postToRelay({ type: "bridge-ready", hasEmbed: true, ts: Date.now() });
        }
      }, 2000);
    }
  }

  function pollForEmbed() {
    const el = findPhoneEmbed();
    if (el && el !== phoneEmbed) hookEmbed(el);
  }

  // Poll regularly (CTM rebuilds the iframe on navigations)
  setInterval(pollForEmbed, 1000);

  // React faster to DOM changes
  const observer = new MutationObserver(pollForEmbed);
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Try immediately + a few times after load
  pollForEmbed();
  setTimeout(pollForEmbed, 500);
  setTimeout(pollForEmbed, 2000);

  // ── Listen for commands from the isolated-world relay ──
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg[MSG_TAG] !== true) return;
    if (msg.dir !== "from-relay") return;

    if (msg.type === "ping") {
      // Re-broadcast bridge-ready so a dialer that opened AFTER initial load
      // can pick up our state instead of waiting forever.
      postToRelay({ type: "bridge-ready", hasEmbed: !!phoneEmbed, ts: Date.now() });
      postToRelay({ type: "pong", hasEmbed: !!phoneEmbed, ts: Date.now() });
      return;
    }

    if (!phoneEmbed) {
      postToRelay({
        type: "command-error",
        originalType: msg.type,
        error: "no phone embed found",
        ts: Date.now(),
      });
      warn("ignored", msg.type, "— no phone embed");
      return;
    }

    try {
      if (msg.type === "dial") {
        const num = String(msg.number || "").trim();
        const fromNum = String(msg.fromNumber || "").trim() || null;
        if (!num) throw new Error("missing number");
        const result = setOutboundAndDial(num, fromNum);
        log(`dial ${num} from=${fromNum || '(default)'} strategy=${result.strategy}`);
        postToRelay({
          type: "command-ack",
          originalType: "dial",
          number: num,
          fromNumber: fromNum,
          strategy: result.strategy,
        });
      } else if (msg.type === "hangup") {
        phoneEmbed.hangup?.();
        log("hangup");
        postToRelay({ type: "command-ack", originalType: "hangup" });
      } else if (msg.type === "mute") {
        phoneEmbed.mute?.();
        log("mute toggle");
        postToRelay({ type: "command-ack", originalType: "mute" });
      } else if (msg.type === "hold") {
        phoneEmbed.hold?.();
        log("hold toggle");
        postToRelay({ type: "command-ack", originalType: "hold" });
      }
    } catch (e) {
      warn("command error:", e.message);
      postToRelay({
        type: "command-error",
        originalType: msg.type,
        error: e.message,
      });
    }
  });

  log("bridge loaded");
})();

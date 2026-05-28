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

  // Skip if already loaded and embed is hooked — re-injection from SW polls
  // would destroy the working phoneEmbed reference.
  if (window.__autoDialerBridgeMainLoaded && document.querySelector("ctm-phone-embed")?.__autoDialerHookedAt) {
    return;
  }

  // Tear down prior bridge instance (extension reload leaves stale closures).
  if (window.__autoDialerBridgeCleanup) {
    try { window.__autoDialerBridgeCleanup(); } catch (_) {}
  }
  window.__autoDialerBridgeMainLoaded = true;

  const MSG_TAG = "__autoDialerBridge";
  const PREFIX = "[AutoDialer-Main]";

  // CTM events we forward to the dialer. Removed the noisy ones:
  //   - ctm:live-activity (fires 100s/sec during active call — audio meter)
  //   - ctm:status (heartbeat, no useful state delta)
  // The dialer only needs lifecycle + audit events. Keeping the list minimal
  // here means the IPC/relay never sees the 1000s of events that bog the SW
  // and dialer-side dedup. Significant perf win for long calls.
  const CTM_EVENTS = [
    "ctm:ready",
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
  const _intervals = [];
  let _messageListener = null;
  // AbortController so cleanup actually removes the 14 CTM event listeners we
  // attached to <ctm-phone-embed>. Without this each re-injection stacks
  // another full set of handlers, producing the observed 16×duplicate event
  // storm. addEventListener({signal}) is the cleanest one-shot teardown.
  let _eventAbort = new AbortController();
  let _mutationObserver = null;

  // Cleanup function that prior instance left for us — and that WE'll leave
  // for the NEXT injection. Tears down listeners + intervals so closures
  // don't leak across extension reloads.
  window.__autoDialerBridgeCleanup = function () {
    try { _eventAbort.abort(); } catch (_) {}
    try { _mutationObserver?.disconnect(); } catch (_) {}
    for (const id of _intervals) clearInterval(id);
    if (_messageListener) window.removeEventListener("message", _messageListener);
    if (window.__autoDialerBridgeReadyTimer) {
      clearInterval(window.__autoDialerBridgeReadyTimer);
      window.__autoDialerBridgeReadyTimer = null;
    }
  };

  function log(...args) { console.log(PREFIX, ...args); }
  function warn(...args) { console.warn(PREFIX, ...args); }

  // Search only this frame's document — with all_frames injection, each
  // frame runs its own bridge instance so no iframe traversal needed.
  function findPhoneEmbed() {
    return document.querySelector("ctm-phone-embed");
  }

  function postToRelay(payload) {
    window.postMessage({ [MSG_TAG]: true, dir: "to-relay", ...payload }, "*");
  }

  // ── Outbound number selection + dial ──
  // CTM's softphone uses a jQuery Select2 widget on an <input.from_number>
  // inside the <ctm-phone-embed> iframe. We find it, match the desired
  // outbound number by comparing last-10-digits against the option text,
  // and set it via the Select2 jQuery API before calling phoneEmbed.call().

  function bareDigits(s) {
    if (!s) return "";
    const d = String(s).replace(/\D/g, "");
    return d.length > 10 ? d.slice(-10) : d;
  }

  function getEmbedIframeContext() {
    if (!phoneEmbed) return null;
    for (const inner of phoneEmbed.querySelectorAll?.("iframe") || []) {
      try {
        if (inner.contentDocument && inner.contentWindow?.jQuery) {
          return { doc: inner.contentDocument, win: inner.contentWindow };
        }
      } catch (_) {}
    }
    return null;
  }

  function setOutboundViaSelect2(fromNumber) {
    const ctx = getEmbedIframeContext();
    if (!ctx) return { error: "no iframe with jQuery found in embed" };
    const $ = ctx.win.jQuery;
    const $input = $(ctx.doc).find("input.from_number");
    if (!$input.length) return { error: "no input.from_number in CTM iframe" };

    const s2obj = $input.data("select2");
    if (!s2obj || !s2obj.opts) return { error: "Select2 not initialized on from_number input" };

    const rawData = s2obj.opts.data;
    const options = Array.isArray(rawData) ? rawData : (rawData?.results || []);
    if (options.length === 0) return { error: "Select2 has no options loaded" };

    const target = bareDigits(fromNumber);
    const match = options.find(d => bareDigits(d.text) === target);
    if (!match) {
      const samples = options.slice(0, 5).map(d => d.text);
      return { error: "no option matching " + fromNumber, sampleTexts: samples };
    }

    $input.select2("data", { id: match.id, text: match.text });
    $input.trigger("change");
    return { matched: true, matchedText: match.text };
  }

  function setOutboundAndDial(toNumber, fromNumber) {
    let strategy = "1arg-call";
    let outboundSet = null;

    if (fromNumber) {
      outboundSet = setOutboundViaSelect2(fromNumber);
      if (outboundSet.matched) {
        strategy = "select2-set";
        log("outbound set via Select2: " + outboundSet.matchedText);
      } else {
        warn("outbound selection failed: " + outboundSet.error);
      }
    }

    phoneEmbed.call(toNumber);
    return { strategy, outboundSet };
  }

  function hookEmbed(el) {
    if (hookedEvents.has(el)) {
      phoneEmbed = el;
      return;
    }
    // Global mark on the element itself — survives across bridge instances.
    // If a prior instance's cleanup didn't run (pre-2.0.24 bridge), this
    // prevents us from stacking another full set of 14 listeners on top.
    if (el.__autoDialerHookedAt) {
      warn("embed already hooked by prior instance at", el.__autoDialerHookedAt, "— skipping rehook");
      phoneEmbed = el;
      hookedEvents.add(el);
      // Still broadcast bridge-ready so a fresh dialer iframe picks us up,
      // but don't add duplicate event listeners.
      postToRelay({ type: "bridge-ready", hasEmbed: true, ts: Date.now() });
      return;
    }
    el.__autoDialerHookedAt = new Date().toISOString();
    phoneEmbed = el;
    hookedEvents.add(el);

    // All listeners attached with { signal } so cleanup() can rip them out
    // in one shot when the bridge is re-injected. Without this, every
    // reload stacked another 14 handlers on the embed.
    const signal = _eventAbort.signal;
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
      }, { signal });
    }
    // When our AbortController fires (next cleanup), clear the mark so the
    // NEXT bridge instance knows it can safely re-hook.
    signal.addEventListener("abort", () => {
      try { delete el.__autoDialerHookedAt; } catch (_) {}
    });

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
  _intervals.push(setInterval(pollForEmbed, 1000));

  // React faster to DOM changes
  _mutationObserver = new MutationObserver(pollForEmbed);
  _mutationObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Try immediately + a few times after load
  pollForEmbed();
  setTimeout(pollForEmbed, 500);
  setTimeout(pollForEmbed, 2000);

  // ── Listen for commands from the isolated-world relay ──
  _messageListener = (event) => {
    const msg = event.data;
    if (!msg || msg[MSG_TAG] !== true) return;
    if (msg.dir !== "from-relay") return;

    log("received command:", msg.type, "hasEmbed:", !!phoneEmbed, "frame:", window === window.top ? "TOP" : "child");

    if (msg.type === "ping") {
      // Re-broadcast bridge-ready so a dialer that opened AFTER initial load
      // can pick up our state instead of waiting forever.
      postToRelay({ type: "bridge-ready", hasEmbed: !!phoneEmbed, ts: Date.now() });
      postToRelay({ type: "pong", hasEmbed: !!phoneEmbed, ts: Date.now() });
      return;
    }

    // Just-in-time embed discovery — handles cases where polling hasn't
    // found it yet, or this instance was orphaned and its cached ref is stale.
    if (!phoneEmbed || !phoneEmbed.isConnected) {
      const found = findPhoneEmbed();
      if (found) {
        phoneEmbed = found;
        log("just-in-time discovered embed for", msg.type);
      }
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
          outboundSet: result.outboundSet || null,
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
  };
  window.addEventListener("message", _messageListener);

  log("bridge loaded (re-injectable)");
})();

/**
 * Auto-Dialer Bridge — Isolated-world relay
 *
 * Lives on app.calltrackingmetrics.com in the extension's isolated world.
 * Acts as a relay between:
 *   - MAIN-world script (dialer-bridge-main.js) via window.postMessage
 *   - Extension service worker via chrome.runtime
 *
 * Why this layer exists: MAIN-world scripts have access to the page's
 * <ctm-phone-embed> but can't use chrome.* APIs. Isolated-world scripts
 * can use chrome.* but can't see page JS objects. So we bridge.
 */
(function () {
  "use strict";

  if (window.__autoDialerBridgeRelayLoaded) return;
  window.__autoDialerBridgeRelayLoaded = true;

  const MSG_TAG = "__autoDialerBridge";
  const PREFIX = "[AutoDialer-Relay]";

  function log(...args) { console.log(PREFIX, ...args); }

  // ── MAIN → SW: forward page-side events to the service worker ──
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg[MSG_TAG] !== true) return;
    if (msg.dir !== "to-relay") return;

    // Strip the tag/direction before sending to SW
    const { [MSG_TAG]: _tag, dir: _dir, ...payload } = msg;
    try {
      chrome.runtime.sendMessage({ type: "AUTODIALER_FROM_BRIDGE", payload });
    } catch (e) {
      // Service worker may be inactive — fine, dialer page polls anyway
    }
  });

  // ── SW → MAIN: forward dialer commands to the page-side bridge ──
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "AUTODIALER_TO_BRIDGE") {
      log("received command from SW:", msg.payload?.type, "frame:", window === window.top ? "TOP" : "child");
      window.postMessage(
        { [MSG_TAG]: true, dir: "from-relay", ...msg.payload },
        "*"
      );
      sendResponse({ ok: true });
      return false;
    }
  });

  log("relay loaded, frame:", window === window.top ? "TOP" : "child");
})();

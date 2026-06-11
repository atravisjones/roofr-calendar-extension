// content.js (MERGED SCRIPT, GUARDED)

// ==================================================
// START: Roofr API Gateway
// ==================================================
(function registerRoofrApiGateway() {
  if (!window.location.hostname.endsWith(".roofr.com") || window.__roofrApiGatewayRegistered) return;
  window.__roofrApiGatewayRegistered = true;

  const handlers = {
    ROOFR_API_GET_DAY_EVENTS: (msg) => window.RoofrApi.getDayEvents(msg.dateStr),
    ROOFR_API_GET_EVENT: (msg) => window.RoofrApi.getEvent(msg.id ?? msg.eventId),
    ROOFR_API_GET_JOB: (msg) => window.RoofrApi.getJob(msg.id ?? msg.jobId),
    ROOFR_API_ADD_ATTENDEE: async (msg) => {
      if (msg.dryRun) {
        const before = await window.RoofrApi.getEvent(msg.eventId);
        return { ok: true, before, after: before, verified: false, dryRun: true };
      }
      return window.RoofrApi.addAttendee(msg.eventId, msg.userId);
    }
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const handler = msg && handlers[msg.type];
    if (!handler) return false;
    Promise.resolve()
      .then(() => {
        if (!window.RoofrApi) throw new Error("RoofrApi is unavailable");
        return handler(msg);
      })
      .then((data) => sendResponse(data && Object.prototype.hasOwnProperty.call(data, "ok") ? data : { ok: true, data }))
      .catch((error) => {
        const serialized = window.RoofrApi?.serializeError
          ? window.RoofrApi.serializeError(error)
          : { kind: error.kind || "network", message: error.message || String(error), status: error.status };
        sendResponse({ ok: false, error: serialized });
      });
    return true;
  });
})();
// ==================================================
// END: Roofr API Gateway
// ==================================================

// ==================================================
// START: SideFind functionality (guarded by window.__sidefind)
// ==================================================
if (typeof window.__sidefind === 'undefined') {
  window.__sidefind = {};

  ((context) => {
    const HL_CLASS = "sidefind-mark";
    const HL_CURRENT_CLASS = "sidefind-current";
    const LIMIT = 5000; // Hard cap to avoid performance issues on huge pages.

    // Inject styles for highlights into the page.
    const style = document.createElement("style");
    style.textContent = `
      .${HL_CLASS} {
        background: rgba(255, 235, 59, .75);
        color: black;
        padding: 1px 0;
        border-radius: 3px;
        box-shadow: 0 0 3px rgba(0,0,0,0.2);
      }
      .${HL_CURRENT_CLASS} {
        outline: 2px solid #0b5cff;
        outline-offset: 1px;
        background: #ff9800;
      }
    `;
    document.documentElement.appendChild(style);

    let marks = []; // References to all <mark> elements, in document order.
    let currentIndex = -1; // 0-based index for the current highlighted mark.

    // Escapes a string for use in a regular expression.
    function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    // Wraps a string with word boundary characters for whole-word search.
    function wordWrapRe(s) { return `\\b${s}\\b`; }

    // Builds the regular expression for the search.
    function buildRegExp(term, flags) {
      if (!term) return null;
      let source;
      if (flags && flags.useRegex) {
        // Assume the term passed is already a valid regex string (e.g. "(Ashkan|Brandon)")
        // If wholeWord is requested, wrap the entire group
        source = flags.wholeWord ? wordWrapRe(`(?:${term})`) : term;
      } else {
        const escaped = escapeRegExp(term);
        source = flags && flags.wholeWord ? wordWrapRe(escaped) : escaped;
      }
      return new RegExp(source, flags && flags.caseSensitive ? "g" : "gi");
    }

    // Determines if a text node should be skipped (e.g., inside <script> or <style> tags).
    function isSkippableNode(node) {
      const parent = node.parentElement;
      return !parent || parent.closest("script,style,textarea,input,[contenteditable='true']");
    }

    // Removes all existing highlights from the page.
    function clearAllHighlightsSideFind() {
      if (!marks.length) return;
      for (const mark of marks) {
        const parent = mark.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
          parent.normalize(); // Merges adjacent text nodes for a clean DOM.
        }
      }
      marks = [];
      currentIndex = -1;
    }

    // The main highlighting function.
    function highlight(term, flags) {
      clearAllHighlightsSideFind();
      if (!term) return getStats();

      const regex = buildRegExp(term, flags);
      if (!regex) return getStats();

      const textNodes = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (isSkippableNode(node) || !node.nodeValue?.trim()) {
          continue;
        }
        regex.lastIndex = 0; // Reset regex state
        if (regex.test(node.nodeValue)) {
          textNodes.push(node);
        }
      }

      for (const node of textNodes) {
        if (!node.parentNode) continue;

        const text = node.nodeValue;
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        let match;
        regex.lastIndex = 0;

        while ((match = regex.exec(text))) {
          if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
          }
          const mark = document.createElement("mark");
          mark.className = HL_CLASS;
          mark.textContent = match[0];
          fragment.appendChild(mark);
          marks.push(mark);
          lastIndex = regex.lastIndex;

          if (marks.length >= LIMIT) break;
        }

        if (lastIndex < text.length) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
        }

        node.parentNode.replaceChild(fragment, node);
        if (marks.length >= LIMIT) break;
      }

      if (marks.length > 0) {
        currentIndex = 0;
        focusCurrent();
      }

      return getStats();
    }

    function focusCurrent() {
      marks.forEach((m, i) => m.classList.toggle(HL_CURRENT_CLASS, i === currentIndex));
      const currentMark = marks[currentIndex];
      if (currentMark) {
        currentMark.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      }
    }

    function navigate(direction) {
      if (!marks.length) return getStats();
      currentIndex = (currentIndex + direction + marks.length) % marks.length;
      focusCurrent();
      return getStats();
    }

    function next() { return navigate(1); }
    function prev() { return navigate(-1); }

    function getStats() {
      return { count: marks.length, index: currentIndex === -1 ? 0 : currentIndex + 1 };
    }

    function handleClear() {
      clearAllHighlightsSideFind();
      return getStats();
    }

    function selectFirst() {
      if (marks.length > 0) {
        currentIndex = 0;
        focusCurrent();
      }
      return getStats();
    }

    // Expose message handler to the context
    context.handleMessage = (msg, sendResponse) => {
      switch (msg.type) {
        case "SIDEFIND_UPDATE":
          sendResponse({ ok: true, stats: highlight(msg.term, msg.flags) });
          break;
        case "SIDEFIND_NEXT":
          sendResponse({ ok: true, stats: next() });
          break;
        case "SIDEFIND_PREV":
          sendResponse({ ok: true, stats: prev() });
          break;
        case "SIDEFIND_CLEAR_HIGHLIGHTS":
          sendResponse({ ok: true, stats: handleClear() });
          break;
        case "SIDEFIND_STATS":
          sendResponse({ ok: true, stats: getStats() });
          break;
        case "SIDEFIND_SELECT_FIRST":
          sendResponse({ ok: true, stats: selectFirst() });
          break;
        default:
          // Not a SideFind message, do nothing.
          break;
      }
      return false; // Indicate we are not sending an async response here.
    };
  })(window.__sidefind);
}

// GLOBAL LISTENER for SideFind (Runs on ALL pages)
if (!window.__globalListenerAttached) {
  window.__globalListenerAttached = true;
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type && msg.type.startsWith("SIDEFIND_")) {
      if (window.__sidefind && window.__sidefind.handleMessage) {
        return window.__sidefind.handleMessage(msg, sendResponse);
      }
    }
    return false;
  });
}

// ==================================================
// END: SideFind functionality
// ==================================================


// ==================================================
// START: CTM (CallTrackingMetrics) Call Detection
// ==================================================
if (window.location.hostname.includes('calltrackingmetrics.com') && !window.__ctmBridgeLoaded) {
  window.__ctmBridgeLoaded = true;

  console.log('[CTM Extension] Checking if call detection is enabled...');

  // State tracking
  let isCtmCallActive = false;
  let activeCtmCallPhoneNumber = null;
  let lastCtmSearchedNumber = null;
  let isCtmFeatureEnabled = true;

  // Robust deduplication: Track recently sent popup requests with timestamps
  // Prevents duplicate popups during transfers/agent changes
  const recentCtmPopupPhones = new Map();  // phoneNumber -> timestamp
  const CTM_POPUP_DEDUP_WINDOW_MS = 60000;  // 60 seconds - no duplicate popups within this window
  let configuredCtmCsr = '';
  let configuredCtmCsrUser = '';
  let configuredCtmCsrDisplay = '';
  // New CTM settings
  let ctmAutoSearch = true;
  let ctmShowNotifications = true;
  let ctmShowActiveCalls = true;
  let lastCtmLoggedCallKey = null;
  let ctmContextInvalidated = false;

  // Check if extension context is still valid
  function isCtmExtensionContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  // Handle context invalidation
  function handleCtmContextInvalidation() {
    if (ctmContextInvalidated) return;
    ctmContextInvalidated = true;

    const isCallsPage = window.location.href.includes('/calls');

    if (!isCallsPage) {
      console.warn('[CTM Extension] Extension context invalidated - please refresh the page manually');
      return;
    }

    console.warn('[CTM Extension] Extension context invalidated - please refresh the page');
  }

  // Show a notification popup on the CTM page
  function showCtmNotification(message, options = {}) {
    const {
      background = '#22c55e',  // Green for success/celebration
      duration = 8000,
      emoji = ''
    } = options;

    // Remove any existing notification
    const existing = document.getElementById('ctm-extension-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.id = 'ctm-extension-notification';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${background};
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      font-family: system-ui, sans-serif;
      font-size: 16px;
      font-weight: 600;
      z-index: 999999;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
      animation: ctm-notification-slide-in 0.3s ease-out;
      display: flex;
      align-items: center;
      gap: 10px;
    `;

    // Add animation styles if not already present
    if (!document.getElementById('ctm-notification-styles')) {
      const style = document.createElement('style');
      style.id = 'ctm-notification-styles';
      style.textContent = `
        @keyframes ctm-notification-slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes ctm-notification-slide-out {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(100%); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    if (emoji) {
      const emojiSpan = document.createElement('span');
      emojiSpan.style.fontSize = '24px';
      emojiSpan.textContent = emoji;
      notification.appendChild(emojiSpan);
    }
    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    notification.appendChild(messageSpan);
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'ctm-notification-slide-out 0.3s ease-in forwards';
      setTimeout(() => notification.remove(), 300);
    }, duration);
  }

  // Safe message sender
  function ctmSafeSendMessage(message) {
    if (!isCtmExtensionContextValid()) {
      handleCtmContextInvalidation();
      return Promise.reject(new Error('Extension context invalidated'));
    }

    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, response => {
          if (chrome.runtime.lastError) {
            const error = chrome.runtime.lastError.message || '';
            if (error.includes('Extension context invalidated') ||
                error.includes('message port closed')) {
              handleCtmContextInvalidation();
              reject(new Error('Extension context invalidated'));
            } else {
              reject(new Error(error));
            }
          } else {
            resolve(response);
          }
        });
      } catch (e) {
        if (e.message?.includes('Extension context invalidated')) {
          handleCtmContextInvalidation();
        }
        reject(e);
      }
    });
  }

  // Normalize phone number to digits only
  function normalizeCtmPhoneNumber(phone) {
    if (!phone) return null;
    return phone.replace(/[^\d]/g, '');
  }

  // Format phone for display (XXX-XXX-XXXX)
  function formatCtmPhoneForDisplay(phone) {
    const cleaned = normalizeCtmPhoneNumber(phone);
    if (!cleaned) return phone;
    if (cleaned.length === 10) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    if (cleaned.length === 11 && cleaned[0] === '1') {
      return `${cleaned.slice(1, 4)}-${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    return phone;
  }

  // Nickname mappings for CSR name matching
  const CTM_NICKNAME_MAP = {
    'madi': ['madison', 'maddie', 'maddy'],
    'bronte': ['bronté'],
    'robert': ['rob', 'bob', 'bobby'],
    'timothy': ['tim', 'timmy'],
    'jessica': ['jess', 'jessie'],
    'travis': ['trav'],
    'jennifer': ['jen', 'jenny'],
    'michael': ['mike', 'mikey'],
    'william': ['will', 'bill', 'billy'],
    'richard': ['rick', 'ricky', 'dick'],
    'christopher': ['chris'],
    'matthew': ['matt'],
    'anthony': ['tony'],
    'nicholas': ['nick', 'nicky'],
    'jonathan': ['jon', 'jonny'],
    'stephanie': ['steph'],
    'elizabeth': ['liz', 'lizzy', 'beth'],
    'katherine': ['kate', 'kathy', 'katie'],
    'alexandria': ['alex', 'lexi'],
    'alexander': ['alex'],
    'benjamin': ['ben', 'benny'],
    'daniel': ['dan', 'danny'],
    'joseph': ['joe', 'joey'],
    'david': ['dave', 'davey'],
    'andrew': ['andy', 'drew'],
    'samantha': ['sam', 'sammy'],
    'samuel': ['sam', 'sammy'],
    'victoria': ['vicky', 'tori'],
    'patricia': ['pat', 'patty'],
    'diva': ['diva'],
    'nica': ['nica']
  };

  function removeCtmAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function getCtmFirstName(name) {
    if (!name) return '';
    return removeCtmAccents(name.trim().split(/\s+/)[0].toLowerCase());
  }

  function ctmFirstNamesMatch(name1, name2) {
    const first1 = getCtmFirstName(name1);
    const first2 = getCtmFirstName(name2);
    if (!first1 || !first2) return false;
    if (first1 === first2) return true;

    // Check nickname mappings
    for (const [fullName, nicknames] of Object.entries(CTM_NICKNAME_MAP)) {
      const allNames = [fullName, ...nicknames];
      if (allNames.includes(first1) && allNames.includes(first2)) {
        return true;
      }
    }
    return false;
  }

  function ctmNamesMatch(name1, name2) {
    if (!name1 || !name2) return false;
    const normalized1 = removeCtmAccents(name1.toLowerCase().trim());
    const normalized2 = removeCtmAccents(name2.toLowerCase().trim());
    if (normalized1 === normalized2) return true;
    if (ctmFirstNamesMatch(name1, name2)) return true;
    return false;
  }

  // CTM-specific timer pattern: looks for "in progress" status with timer
  const CTM_IN_PROGRESS_PATTERN = /in\s*progress/i;
  const CTM_TIMER_PATTERN = /\b(\d{1,2}:\d{2})\b/;

  // Extract phone from CTM call row
  // CTM has data-number attribute on <tr>: data-number="+16026688360"
  // Also format: (480) 690-4010 in text
  function extractCtmPhoneFromRow(row) {
    if (!row) return null;

    // Primary method: Check data-number attribute on the row
    const dataNumber = row.getAttribute('data-number');
    if (dataNumber) {
      const normalized = normalizeCtmPhoneNumber(dataNumber);
      if (normalized && normalized.length >= 10) {
        console.log('[CTM Extension] Found phone via data-number attr:', normalized);
        return normalized;
      }
    }

    // Secondary: Check tel: links
    const telLink = row.querySelector('a[href^="tel:"]');
    if (telLink) {
      const href = telLink.getAttribute('href');
      const normalized = normalizeCtmPhoneNumber(href.replace('tel:', ''));
      if (normalized) {
        console.log('[CTM Extension] Found phone via tel: link:', normalized);
        return normalized;
      }
    }

    // Fallback: Regex patterns in text
    const phonePatterns = [
      /\((\d{3})\)\s*(\d{3})[-.]?(\d{4})/,  // (480) 690-4010
      /(\d{3})[-.](\d{3})[-.](\d{4})/        // 480-690-4010
    ];

    const text = row.textContent || '';
    for (const pattern of phonePatterns) {
      const match = text.match(pattern);
      if (match) {
        const normalized = match.slice(1).join('');
        console.log('[CTM Extension] Found phone via text regex:', normalized);
        return normalized;
      }
    }

    console.log('[CTM Extension] Could not find phone in row');
    return null;
  }

  // Extract caller name from CTM call row
  // CTM structure: <a data-field="name" class="search callerid">andrew jones</a>
  // Inside: <div class="caller-info-section">
  function extractCtmCallerName(row) {
    if (!row) return null;

    // Primary method: Look for the specific caller ID link with data-field="name"
    const callerLink = row.querySelector('a[data-field="name"], a.search.callerid, a.callerid');
    if (callerLink) {
      const name = callerLink.textContent.trim();
      if (name && name.length > 1) {
        // Capitalize first letter of each word (CTM stores as lowercase)
        const formatted = name.split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
        console.log('[CTM Extension] Found caller name via a[data-field="name"]:', formatted);
        return formatted;
      }
    }

    // Secondary: Look for caller-info-section
    const callerSection = row.querySelector('[class*="caller-info"], .caller-info-section');
    if (callerSection) {
      const nameLink = callerSection.querySelector('a');
      if (nameLink) {
        const name = nameLink.textContent.trim();
        if (name && name.length > 1) {
          const formatted = name.split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
          console.log('[CTM Extension] Found caller name via caller-info-section:', formatted);
          return formatted;
        }
      }
    }

    // Fallback: look for col-caller cell
    const callerCell = row.querySelector('[class*="col-caller"]');
    if (callerCell) {
      const nameMatch = callerCell.textContent.match(/([A-Za-z]+\s+[A-Za-z]+)/);
      if (nameMatch) {
        const formatted = nameMatch[1].split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
        console.log('[CTM Extension] Found caller name via col-caller fallback:', formatted);
        return formatted;
      }
    }

    console.log('[CTM Extension] Could not find caller name in row');
    return null;
  }

  // Check if call is answered (has agent assigned) vs ringing (set agent button)
  // Returns: { isAnswered: boolean, agentName: string|null }
  function extractCtmAgentInfo(row) {
    if (!row) return { isAnswered: false, agentName: null };

    // Check for "set agent" button - indicates unanswered/ringing call
    const setAgentBtn = row.querySelector('[class*="set-agent"], button[class*="agent"], .set-agent');
    const rowText = row.textContent || '';
    const hasSetAgent = setAgentBtn || /set\s*agent/i.test(rowText);

    // Primary method: Look for the specific agent-name link element
    const agentLink = row.querySelector('a.agent-name, a.change-agent, [class*="agent-name"]');
    if (agentLink) {
      const name = agentLink.textContent.trim();
      if (name && name.length > 1) {
        console.log('[CTM Extension] Found agent name via a.agent-name:', name, '- Answered:', !hasSetAgent);
        return { isAnswered: true, agentName: name };
      }
    }

    // Secondary: Look for div.agent container
    const agentDiv = row.querySelector('div.agent, [class="agent"]');
    if (agentDiv) {
      const nameLink = agentDiv.querySelector('a');
      if (nameLink) {
        const name = nameLink.textContent.trim();
        if (name && name.length > 1) {
          console.log('[CTM Extension] Found agent name via div.agent a:', name);
          return { isAnswered: true, agentName: name };
        }
      }
    }

    // Fallback: look for any name in Routing-like column
    const routingCell = row.querySelector('[class*="routing"], [class*="receiving"]');
    if (routingCell) {
      const nameMatch = routingCell.textContent.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)/);
      if (nameMatch) {
        console.log('[CTM Extension] Found agent name via routing cell regex:', nameMatch[1]);
        return { isAnswered: true, agentName: nameMatch[1] };
      }
    }

    // No agent found - call is ringing/unanswered
    console.log('[CTM Extension] No agent assigned yet - call is ringing');
    return { isAnswered: false, agentName: null };
  }

  // Legacy wrapper for extractCtmAgentName (returns just the name)
  function extractCtmAgentName(row) {
    const info = extractCtmAgentInfo(row);
    return info.agentName;
  }

  // Extract transfer information from CTM row
  // Returns { transferFrom: string, transferTo: string, transferTime: string } or null
  function extractCtmTransferInfo(row) {
    if (!row) return null;

    const text = row.textContent || '';

    // Look for transfer patterns like "Transfer From X to Y @ TIME"
    const transferMatch = text.match(/Transfer\s+(?:From|from)\s+([A-Za-z\s]+)\s+to\s+([A-Za-z\s]+)\s+@\s+([\d:]+)/i);
    if (transferMatch) {
      return {
        transferFrom: transferMatch[1].trim(),
        transferTo: transferMatch[2].trim(),
        transferTime: transferMatch[3].trim()
      };
    }

    // Look for simpler transfer pattern "Transferred to X"
    const simpleTransferMatch = text.match(/Transferred?\s+to\s+([A-Za-z\s]+)/i);
    if (simpleTransferMatch) {
      return {
        transferFrom: null,
        transferTo: simpleTransferMatch[1].trim(),
        transferTime: null
      };
    }

    return null;
  }

  // Check if a row represents an active call
  // CTM structure: <p>in progress</p> and <span class="duration">
  function isCtmActiveCallRow(row) {
    if (!row) return false;

    const text = row.textContent || '';

    // PRIORITY 1: Check for POSITIVE indicators of active calls FIRST
    // These override any status words like "answered"

    // Method 1 (PRIMARY): Look for literal <p>in progress</p> element
    // This is the most reliable indicator of an active call
    const inProgressP = row.querySelector('p');
    if (inProgressP && /^\s*in\s*progress\s*$/i.test(inProgressP.textContent)) {
      console.log('[CTM Extension] Found in-progress via <p> element');
      return true;  // ✅ DEFINITIVE: This is an active call, even if "answered" appears
    }

    // Method 2: Look for span.duration with active timer AND "in progress" text
    const durationSpan = row.querySelector('span.duration, [class*="duration"]');
    if (durationSpan) {
      const durationText = durationSpan.textContent.trim();
      // Active calls show MM:SS format (duration timers)
      if (CTM_TIMER_PATTERN.test(durationText)) {
        // Verify "in progress" is present in the row
        if (CTM_IN_PROGRESS_PATTERN.test(text)) {
          console.log('[CTM Extension] Found in-progress via duration span + text');
          return true;  // ✅ DEFINITIVE: Active call with live timer
        }
      }
    }

    // PRIORITY 2: Check for NEGATIVE indicators of historical calls
    // These filters exclude completed calls from history

    // Check for date indicators - historical calls have date stamps, active calls don't
    // Matches: "Jan 22", "Thu Jan", "22nd", "21st", etc.
    const hasDateIndicator = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}/i.test(text) ||
                             /\b\d{1,2}(st|nd|rd|th)\b/i.test(text);
    if (hasDateIndicator) {
      return false;  // Historical call with date stamp
    }

    // Check for AM/PM anywhere - timestamps have AM/PM, live duration timers don't
    if (/\b(am|pm)\b/i.test(text)) {
      return false;  // Has timestamp, not a live timer
    }

    // PRIORITY 3: Check for completed status words
    // BUT only if "in progress" is NOT present (safeguard for edge cases)
    // This prevents false negatives if the <p> element check fails for some reason
    if (!CTM_IN_PROGRESS_PATTERN.test(text)) {
      const completedStatuses = /\b(answered|busy|missed|completed|voicemail|no\s*answer|hung\s*up)\b/i;
      if (completedStatuses.test(text)) {
        return false;  // Completed call with no "in progress" indicator
      }
    }

    // Method 3 (REMOVED): Text-based fallback was causing false positives
    // Historical calls were being matched because timestamps like "08:44" matched timer pattern
    // and "in progress" text from other page elements was bleeding through

    return false;
  }

  // Find all active calls in CTM interface
  function findAllCtmActiveCalls() {
    const activeCalls = [];
    console.log('[CTM Extension] findAllCtmActiveCalls() called');

    // CTM shows calls in a table/list format
    // DOM structure: <tr class="call call-row wide-call inbound..." data-number="+1...">
    const rowSelectors = [
      'tr.call-row',              // CTM specific: class="call call-row..."
      'tr.call',                  // CTM specific: class="call..."
      'tr[data-number]',          // Rows with data-number attribute
      'tr[data-id]',              // Rows with data-id attribute
      'tbody.main-list tr',       // Inside main-list tbody
      'table tbody tr'            // Standard table rows
    ];

    let rows = [];
    for (const selector of rowSelectors) {
      const found = document.querySelectorAll(selector);
      console.log(`[CTM Extension] Selector "${selector}" found ${found.length} elements`);
      if (found.length > 0 && rows.length === 0) {
        rows = found;
        console.log(`[CTM Extension] Using selector: ${selector}`);
      }
    }

    if (rows.length === 0) {
      console.log('[CTM Extension] No call rows found with any selector');
      // Debug: log what elements exist on the page
      console.log('[CTM Extension] Page has', document.querySelectorAll('tr').length, 'tr elements');
      console.log('[CTM Extension] Page has', document.querySelectorAll('table').length, 'table elements');
      console.log('[CTM Extension] Page URL:', window.location.href);
      return activeCalls;
    }

    // Log first few rows for debugging
    console.log('[CTM Extension] Sample row HTML (first 500 chars):', rows[0]?.outerHTML?.substring(0, 500));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowText = row.textContent?.substring(0, 200) || '';
      const hasInProgress = /in\s*progress/i.test(rowText);

      // Log details for first 3 rows
      if (i < 3) {
        console.log(`[CTM Extension] Row ${i}: hasInProgress=${hasInProgress}, text="${rowText.replace(/\s+/g, ' ').trim()}"`);
      }

      if (isCtmActiveCallRow(row)) {
        // Include both inbound and outbound calls
        const isOutbound = row.classList.contains('outbound') ||
                          row.querySelector('.direction.outbound, [class*="outbound"], .font-phone-outgoing, [title*="Outbound"]') !== null;

        const phone = extractCtmPhoneFromRow(row);
        const callerName = extractCtmCallerName(row);
        const agentInfo = extractCtmAgentInfo(row);
        const transferInfo = extractCtmTransferInfo(row);

        console.log(`[CTM Extension] Active ${isOutbound ? 'OUTBOUND' : 'INBOUND'} call found:`, {
          phone: phone,
          caller: callerName,
          agent: agentInfo.agentName,
          isAnswered: agentInfo.isAnswered,
          transfer: transferInfo
        });

        if (phone) {
          activeCalls.push({
            phoneNumber: phone,
            formattedPhone: formatCtmPhoneForDisplay(phone),
            callerName: callerName,
            agentName: agentInfo.agentName,
            isAnswered: agentInfo.isAnswered,
            transferInfo: transferInfo,
            element: row
          });
        } else {
          console.log('[CTM Extension] Active call row found but no phone number extracted');
        }
      }
    }

    if (activeCalls.length === 0) {
      console.log('[CTM Extension] No active calls detected in', rows.length, 'rows');
    }

    return activeCalls;
  }

  // Find the first active incoming call
  function findCtmActiveIncomingCall() {
    const activeCalls = findAllCtmActiveCalls();
    return activeCalls.length > 0 ? activeCalls[0] : null;
  }

  // Handle detected incoming call
  async function handleCtmDetectedCall(callData, isNewCall = true) {
    if (!isCtmFeatureEnabled) {
      console.log('[CTM Extension] Feature disabled, skipping');
      return;
    }

    const { phoneNumber, formattedPhone, callerName, agentName, isAnswered } = callData;

    // For ANSWERED calls: only process if agent matches configured CSR
    // For UNANSWERED calls: always process (let all CSRs see incoming calls)
    if (isAnswered && configuredCtmCsr && agentName) {
      if (!ctmNamesMatch(agentName, configuredCtmCsr)) {
        console.log(`[CTM Extension] Skipping answered call - agent "${agentName}" does not match CSR "${configuredCtmCsr}"`);
        return;
      }
      console.log(`[CTM Extension] Call answered by ${agentName} (matches configured CSR)`);
    } else if (!isAnswered) {
      console.log('[CTM Extension] Unanswered/ringing call - showing to all CSRs');
    }

    // ROBUST DEDUPLICATION: Prevent duplicate popups during transfers/agent changes
    // This check applies regardless of isNewCall flag
    const now = Date.now();
    const lastPopupTime = recentCtmPopupPhones.get(phoneNumber);
    if (lastPopupTime && (now - lastPopupTime) < CTM_POPUP_DEDUP_WINDOW_MS) {
      console.log(`[CTM Extension] Skipping duplicate popup for ${phoneNumber} - last popup was ${Math.round((now - lastPopupTime) / 1000)}s ago (within ${CTM_POPUP_DEDUP_WINDOW_MS / 1000}s window)`);
      return;
    }

    // Clean up old entries from the map (entries older than 2x the window)
    const cleanupThreshold = now - (CTM_POPUP_DEDUP_WINDOW_MS * 2);
    for (const [phone, timestamp] of recentCtmPopupPhones.entries()) {
      if (timestamp < cleanupThreshold) {
        recentCtmPopupPhones.delete(phone);
      }
    }

    console.log('[CTM Extension] Processing call:', {
      phone: phoneNumber,
      caller: callerName,
      agent: agentName || '(unanswered)',
      isAnswered: isAnswered,
      isNewCall: isNewCall
    });

    // Track this popup to prevent duplicates
    recentCtmPopupPhones.set(phoneNumber, now);
    lastCtmSearchedNumber = phoneNumber;

    // Check if auto-search is enabled before sending message
    if (!ctmAutoSearch) {
      console.log('[CTM Extension] Auto-search disabled, skipping search for:', phoneNumber);
      return;
    }

    try {
      await ctmSafeSendMessage({
        type: 'CTM_INCOMING_CALL',
        phoneNumber: phoneNumber,
        formattedPhone: formattedPhone,
        callerName: callerName || 'Unknown',
        agentName: agentName || null,
        isAnswered: isAnswered
      });
    } catch (e) {
      console.error('[CTM Extension] Failed to send incoming call message:', e);
    }
  }

  // Handle call ended
  function handleCtmCallEnded(phoneNumber) {
    if (!phoneNumber) return;

    console.log('[CTM Extension] Call ended:', phoneNumber);

    // Clear deduplication tracking so future calls from this number will popup
    recentCtmPopupPhones.delete(phoneNumber);

    if (phoneNumber === lastCtmSearchedNumber) {
      lastCtmSearchedNumber = null;
    }

    try {
      ctmSafeSendMessage({
        type: 'CTM_CALL_ENDED',
        phoneNumber: phoneNumber
      });
    } catch (e) {
      console.error('[CTM Extension] Failed to send call ended message:', e);
    }
  }

  // Main check function — tracks ALL active calls by phone number
  let previousActiveCalls = new Map(); // phone -> { ...callData, lastSeen: timestamp }
  let lastCheckTimestamp = 0; // when the last successful DOM check ran
  let ctmCheckCount = 0;
  const CACHE_EXPIRY_MS = 30000; // expire cached calls after 30s without verification

  function checkForCtmCallStateChange() {
    // Skip DOM checks when tab is hidden — CTM's JS is throttled by Chrome,
    // so the DOM is stale (ended calls still show "in progress"). Let cached
    // entries expire naturally; visibilitychange handler will do a fresh check
    // when the tab becomes active again.
    if (document.hidden) return;

    ctmCheckCount++;
    if (ctmCheckCount % 20 === 1) {
      console.log('[CTM Extension] Running call state check #' + ctmCheckCount);
    }

    const now = Date.now();
    lastCheckTimestamp = now;

    const currentCalls = findAllCtmActiveCalls();
    const currentMap = new Map();
    for (const call of currentCalls) {
      if (call.phoneNumber) {
        call.lastSeen = now;
        currentMap.set(call.phoneNumber, call);
      }
    }

    // Detect NEW calls (in current but not in previous)
    for (const [phone, callData] of currentMap) {
      const prev = previousActiveCalls.get(phone);
      if (!prev) {
        // Brand new call
        console.log('[CTM Extension] New active call detected:', phone);
        isCtmCallActive = true;
        activeCtmCallPhoneNumber = phone;
        handleCtmDetectedCall(callData, true);
      } else {
        // Same call — check for state changes (answered, agent change)
        if (!prev.isAnswered && callData.isAnswered) {
          console.log('[CTM Extension] Call answered:', phone, 'by', callData.agentName);
          handleCtmDetectedCall(callData, false);
        } else if (prev.agentName !== callData.agentName && callData.agentName) {
          console.log('[CTM Extension] Agent changed on', phone, ':', prev.agentName, '->', callData.agentName);
          handleCtmDetectedCall(callData, false);
        }
      }
    }

    // Detect ENDED calls (in previous but not in current)
    for (const [phone] of previousActiveCalls) {
      if (!currentMap.has(phone)) {
        console.log('[CTM Extension] Call ended:', phone);
        handleCtmCallEnded(phone);
      }
    }

    // Update global active state
    isCtmCallActive = currentMap.size > 0;
    if (!isCtmCallActive) activeCtmCallPhoneNumber = null;

    previousActiveCalls = currentMap;
  }

  // Debounced check
  let ctmCheckTimeout = null;
  function debouncedCtmCheck() {
    if (ctmCheckTimeout) clearTimeout(ctmCheckTimeout);
    ctmCheckTimeout = setTimeout(checkForCtmCallStateChange, 300);
  }

  // Set up observer
  function initCtmObserver() {
    console.log('[CTM Extension] Setting up call detection observer');

    const observer = new MutationObserver((mutations) => {
      debouncedCtmCheck();
    });

    // Observe the entire body for changes
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Initial check
    debouncedCtmCheck();

    // Also check periodically in case mutations are missed
    setInterval(debouncedCtmCheck, 5000);

    // Force immediate recheck when tab becomes visible again (clears stale cache)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        console.log('[CTM Extension] Tab visible again — forcing immediate call state check');
        checkForCtmCallStateChange();
      }
    });
  }

  // Load settings and initialize
  async function loadCtmSettings() {
    try {
      const response = await ctmSafeSendMessage({ type: 'GET_CTM_SETTINGS' });
      if (response && response.success) {
        isCtmFeatureEnabled = response.settings.ctm_enabled;
        configuredCtmCsr = response.settings.ctm_csr || '';
        configuredCtmCsrUser = response.settings.ctm_user || '';
        configuredCtmCsrDisplay = response.settings.ctm_display_name || '';
        // Load new CTM settings
        ctmAutoSearch = response.settings.ctm_auto_search !== false;
        ctmShowNotifications = response.settings.ctm_show_notifications !== false;
        ctmShowActiveCalls = response.settings.ctm_show_active_calls !== false;
        console.log('[CTM Extension] Settings loaded:', {
          enabled: isCtmFeatureEnabled,
          csr: configuredCtmCsr,
          autoSearch: ctmAutoSearch,
          showNotifications: ctmShowNotifications,
          showActiveCalls: ctmShowActiveCalls
        });
      }
    } catch (e) {
      console.error('[CTM Extension] Failed to load settings:', e);
      isCtmFeatureEnabled = false;
    }
  }

  // Listen for settings changes
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
      if (changes.ctm_enabled) {
        isCtmFeatureEnabled = changes.ctm_enabled.newValue;
        console.log('[CTM Extension] Feature enabled changed:', isCtmFeatureEnabled);
      }
      if (changes.ctm_csr) {
        configuredCtmCsr = changes.ctm_csr.newValue || '';
        console.log('[CTM Extension] CSR changed:', configuredCtmCsr);
      }
      // Listen for new CTM settings changes
      if (changes.ctm_auto_search) {
        ctmAutoSearch = changes.ctm_auto_search.newValue !== false;
        console.log('[CTM Extension] Auto-search changed:', ctmAutoSearch);
      }
      if (changes.ctm_show_notifications) {
        ctmShowNotifications = changes.ctm_show_notifications.newValue !== false;
        console.log('[CTM Extension] Show notifications changed:', ctmShowNotifications);
      }
      if (changes.ctm_show_active_calls) {
        ctmShowActiveCalls = changes.ctm_show_active_calls.newValue !== false;
        console.log('[CTM Extension] Show active calls changed:', ctmShowActiveCalls);
      }
    }
  });

  // Handle messages from popup (for active calls dropdown) and notifications
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_CTM_ACTIVE_CALLS') {
      console.log('[CTM Extension] Received GET_CTM_ACTIVE_CALLS request');
      // Check if show active calls is enabled
      if (!ctmShowActiveCalls) {
        console.log('[CTM Extension] Show active calls disabled, returning empty array');
        sendResponse({ ok: true, calls: [] });
        return true;
      }
      // The popup polls this every ~2s. Previously, when the CTM tab was hidden
      // (the normal case while a rep works the dialer side panel) we returned
      // CACHE ONLY — and the background scan that fills the cache also bails when
      // hidden + is throttled by Chrome to ~1/min. Net effect: a new call took
      // minutes to appear. Now we always do a FRESH on-demand scrape so a new
      // active-call row surfaces within one poll (~2s) regardless of tab focus.
      // CTM keeps its softphone websocket live in the background, so the new-call
      // row lands in the DOM promptly even when hidden. We union with non-expired
      // cache to smooth over a transient empty scrape, and refresh lastSeen on
      // anything still present so an ongoing call doesn't get dropped at 30s.
      const now = Date.now();
      const fresh = findAllCtmActiveCalls();
      lastCheckTimestamp = now;
      const freshPhones = new Set();
      for (const call of fresh) {
        if (!call.phoneNumber) continue;
        freshPhones.add(call.phoneNumber);
        previousActiveCalls.set(call.phoneNumber, { ...call, lastSeen: now });
      }
      // Add still-recent cached calls the fresh scrape didn't catch this tick.
      const cachedExtra = Array.from(previousActiveCalls.values())
        .filter(c => !freshPhones.has(c.phoneNumber) && (now - c.lastSeen) < CACHE_EXPIRY_MS)
        .map(c => ({
          phoneNumber: c.phoneNumber,
          formattedPhone: c.formattedPhone,
          callerName: c.callerName,
          agentName: c.agentName,
          isAnswered: c.isAnswered,
          transferInfo: c.transferInfo
        }));
      const activeCalls = [...fresh, ...cachedExtra];
      console.log('[CTM Extension] Returning', activeCalls.length, 'active calls (fresh:', fresh.length, '+ cached:', cachedExtra.length, '· hidden:', document.hidden + ')');
      sendResponse({ ok: true, calls: activeCalls });
      return true;
    }

    // Handle notification messages from service worker
    if (msg.type === 'SHOW_CTM_NOTIFICATION') {
      console.log('[CTM Extension] Showing notification:', msg.message);
      showCtmNotification(msg.message, {
        background: msg.background || '#22c55e',
        duration: msg.duration || 8000,
        emoji: msg.emoji || ''
      });
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });

  // Initialize
  async function initCtmWithDelay() {
    // Wait a bit for page to stabilize
    await new Promise(r => setTimeout(r, 2000));

    // Notify service worker that page loaded
    try {
      await ctmSafeSendMessage({ type: 'CTM_PAGE_LOADED' });
    } catch (e) {
      console.warn('[CTM Extension] Could not notify page load:', e);
    }

    // Load settings
    await loadCtmSettings();

    // Always initialize observer (check is gated by isCtmFeatureEnabled)
    console.log('[CTM Extension] Initializing observer, feature enabled:', isCtmFeatureEnabled);
    initCtmObserver();
  }

  if (document.readyState === 'complete') {
    initCtmWithDelay();
  } else {
    window.addEventListener('load', initCtmWithDelay);
  }
}
// ==================================================
// END: CTM Call Detection
// ==================================================


// ==================================================
// START: Roofr page bridge (Only runs on roofr domains)
// ==================================================
if (window.location.hostname.includes('roofr.com') && !window.__roofrBridgeLoaded) {
  window.__roofrBridgeLoaded = true;

  function pad(n) { return String(n).padStart(2, "0"); }
  function toLocalISO(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Inject phone number into contacts search input (for CTM integration)
  async function injectContactSearch(phoneNumber) {
    console.log('[Roofr Extension] Injecting contact search for:', phoneNumber);
    console.log('[Roofr Extension] Current URL:', window.location.href);

    // Wait for page to be ready - give React time to render
    // Increased wait time to handle slower page loads
    await new Promise(r => setTimeout(r, 1500));

    // Find the search input - try multiple selectors in priority order
    // NOTE: Prioritize stable selectors first. '#input-1' is auto-generated and fragile.
    const selectors = [
      '[data-testid="contacts-search-input"]',
      '[data-testid*="search"]',
      'input[placeholder*="Search"]',
      'input[placeholder*="search"]',
      'input[placeholder*="Filter"]',
      'input[placeholder*="filter"]',
      'input[placeholder*="name"]',
      'input[placeholder*="phone"]',
      '.ag-floating-filter input',
      '.ag-header input',
      'input.ag-input-field-input',
      '.ag-filter-wrapper input',
      'input[type="search"]',
      'input[type="text"][class*="search"]',
      'input[type="text"][class*="filter"]',
      '#input-1',
      '#input-2',
      '#input-0'
    ];

    let searchInput = null;
    for (const selector of selectors) {
      searchInput = document.querySelector(selector);
      if (searchInput) {
        console.log('[Roofr Extension] Found search input with selector:', selector);
        break;
      }
    }

    // Last resort: find any visible text input on the page (prioritize inputs in table headers/filters)
    if (!searchInput) {
      // First try AG Grid specific inputs
      const agGridInputs = document.querySelectorAll('.ag-header-cell input, .ag-floating-filter-input, [class*="filter"] input');
      for (const input of agGridInputs) {
        if (input.offsetParent !== null && input.offsetWidth > 0) {
          searchInput = input;
          console.log('[Roofr Extension] Using AG Grid filter input as fallback');
          break;
        }
      }

      // Then try any visible text input
      if (!searchInput) {
        const allInputs = document.querySelectorAll('input[type="text"], input:not([type])');
        for (const input of allInputs) {
          if (input.offsetParent !== null && input.offsetWidth > 0) {
            searchInput = input;
            console.log('[Roofr Extension] Using first visible text input as fallback');
            break;
          }
        }
      }
    }

    if (!searchInput) {
      console.log('[Roofr Extension] Search input not found after trying all selectors');
      console.log('[Roofr Extension] Available inputs:', document.querySelectorAll('input').length);
      return { ok: false, error: 'Search input not found' };
    }

    // Focus the input first
    searchInput.focus();
    await new Promise(r => setTimeout(r, 100));

    // Clear existing value
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));

    // Set the phone number value using native setter (for React compatibility)
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    nativeInputValueSetter.call(searchInput, phoneNumber);

    // Trigger all necessary events for React to pick up the change
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput.dispatchEvent(new Event('change', { bubbles: true }));

    // Also simulate typing by triggering keydown/keyup for each character
    for (const char of phoneNumber) {
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    }

    console.log('[Roofr Extension] Search value injected:', phoneNumber);
    console.log('[Roofr Extension] Actual input value after injection:', searchInput.value);

    // Wait for search results to load (give ag-grid or React time to filter)
    await new Promise(r => setTimeout(r, 2000));

    // Verify the value is still there
    console.log('[Roofr Extension] Input value after wait:', searchInput.value);

    // Try to auto-click if there's exactly one result
    const clickResult = await autoClickSingleResult();

    return { ok: true, injectedValue: phoneNumber, inputValue: searchInput.value, autoClicked: clickResult };
  }

  // Inject job search into the Roofr jobs list page search input
  async function injectJobSearch(addressString) {
    console.log('[Roofr Extension] Injecting job search for:', addressString);
    console.log('[Roofr Extension] Current URL:', window.location.href);

    // Wait for page to be ready - give React time to render
    await new Promise(r => setTimeout(r, 1500));

    // Find the search input - try multiple selectors in priority order
    // NOTE: Prioritize data-testid and placeholder attributes (stable). Avoid auto-generated IDs.
    const selectors = [
      '[data-testid="jobs-search-input"]',
      '[data-testid*="jobs-search"]',
      '[data-testid*="jobs"]  input[type="text"]',
      '[data-testid*="search"]',
      'input[placeholder*="Search"]',
      'input[placeholder*="search"]',
      'input[placeholder*="Filter"]',
      'input[placeholder*="filter"]',
      'input[placeholder*="Address"]',
      'input[placeholder*="address"]',
      'input[type="search"]',
      'input[type="text"][class*="search"]',
      'input[type="text"][class*="filter"]'
    ];

    let searchInput = null;
    for (const selector of selectors) {
      searchInput = document.querySelector(selector);
      if (searchInput) {
        console.log('[Roofr Extension] Found job search input with selector:', selector);
        break;
      }
    }

    // Last resort: find any visible text input on the page (prioritize inputs in the jobs list area)
    if (!searchInput) {
      // First try to find inputs in common container classes
      const jobsAreaInputs = document.querySelectorAll('[class*="jobs"] input, [class*="list"] input, [class*="search"] input');
      for (const input of jobsAreaInputs) {
        if (input.type === 'text' || input.type === 'search' || !input.type) {
          if (input.offsetParent !== null && input.offsetWidth > 0) {
            searchInput = input;
            console.log('[Roofr Extension] Using jobs area input as fallback');
            break;
          }
        }
      }

      // Then try any visible SEARCH-LIKE input. Never type into a random text field:
      // it silently "succeeds" (ok:true) without filtering the board, which makes the
      // results checker open whatever job is on top (wrong job).
      if (!searchInput) {
        const allInputs = document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])');
        for (const input of allInputs) {
          if (input.offsetParent === null || input.offsetWidth === 0) continue;
          const hint = ((input.placeholder || '') + ' ' + (input.className || '') + ' ' + (input.getAttribute('aria-label') || '') + ' ' + (input.getAttribute('data-testid') || '')).toLowerCase();
          if (/search|filter|address/.test(hint)) {
            searchInput = input;
            console.log('[Roofr Extension] Using visible search-like input as fallback');
            break;
          }
        }
      }
    }

    if (!searchInput) {
      console.log('[Roofr Extension] Job search input not found after trying all selectors');
      console.log('[Roofr Extension] Available inputs:', document.querySelectorAll('input').length);
      const allInputs = Array.from(document.querySelectorAll('input'));
      console.log('[Roofr Extension] Input types found:', allInputs.map(i => i.type || 'none'));
      return { ok: false, error: 'Job search input not found' };
    }

    // Focus the input first
    searchInput.focus();
    await new Promise(r => setTimeout(r, 100));

    // Clear existing value
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));

    // Set the address value using native setter (for React compatibility)
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    nativeInputValueSetter.call(searchInput, addressString);

    // Trigger all necessary events for React to pick up the change
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput.dispatchEvent(new Event('change', { bubbles: true }));

    // Also simulate typing by triggering keydown/keyup for each character
    for (const char of addressString) {
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    }

    console.log('[Roofr Extension] Job search value injected:', addressString);
    console.log('[Roofr Extension] Actual input value after injection:', searchInput.value);

    // Wait for search results to load (give React time to filter)
    await new Promise(r => setTimeout(r, 2500));

    // Verify the value is still there
    console.log('[Roofr Extension] Input value after wait:', searchInput.value);

    return { ok: true, injectedValue: addressString, inputValue: searchInput.value };
  }

  // Auto-click the first contact if there's exactly one search result
  async function autoClickSingleResult() {
    try {
      // Find all contact rows in the results table
      // Look for rows with role="row" that contain contact data
      const contactRows = document.querySelectorAll('[role="row"][aria-rowindex]');

      // Filter to only visible data rows (not header row, not hidden/virtualized rows)
      const dataRows = Array.from(contactRows).filter(row => {
        const rowIndex = row.getAttribute('aria-rowindex');
        if (!rowIndex || parseInt(rowIndex) <= 1) return false;

        // Check if row is actually visible (has height and is in viewport)
        const rect = row.getBoundingClientRect();
        if (rect.height === 0) return false;

        // Check if row has actual content (not an empty placeholder)
        const hasContent = row.querySelector('.ag-cell-value, [role="gridcell"]');
        if (!hasContent) return false;

        // Check if row text content is not empty
        const textContent = row.textContent?.trim();
        if (!textContent || textContent.length < 2) return false;

        return true;
      });

      console.log('[Roofr Extension] Found', dataRows.length, 'visible contact result(s)');

      if (dataRows.length === 1) {
        // Exactly one result - click on the name cell to open contact
        const nameCell = dataRows[0].querySelector('[data-testid*="contacts-table-column-name"]') ||
          dataRows[0].querySelector('[col-id="name"]') ||
          dataRows[0].querySelector('.ag-cell-value') ||
          dataRows[0].querySelector('[role="gridcell"]');

        if (nameCell) {
          console.log('[Roofr Extension] Auto-clicking single contact result');
          nameCell.click();

          // Wait for contact page to load, then check for job cards
          await new Promise(r => setTimeout(r, 2000));
          const jobResult = await autoClickSingleJobCard();

          return { clicked: true, count: 1, jobCard: jobResult };
        } else {
          // Try clicking the row itself
          dataRows[0].click();

          // Wait for contact page to load, then check for job cards
          await new Promise(r => setTimeout(r, 2000));
          const jobResult = await autoClickSingleJobCard();

          return { clicked: true, count: 1, clickedRow: true, jobCard: jobResult };
        }
      } else if (dataRows.length > 1) {
        console.log('[Roofr Extension] Multiple results found, not auto-clicking');
        return { clicked: false, count: dataRows.length, reason: 'multiple_results' };
      } else {
        console.log('[Roofr Extension] No results found');
        return { clicked: false, count: 0, reason: 'no_results' };
      }
    } catch (e) {
      console.error('[Roofr Extension] Error in autoClickSingleResult:', e);
      return { clicked: false, error: e.message };
    }
  }

  // Auto-click job card if there's exactly one on the contact page
  async function autoClickSingleJobCard() {
    try {
      // Wait a bit more for job cards to render
      await new Promise(r => setTimeout(r, 500));

      // Find all job cards - based on the screenshot, they have class "job-card--container"
      const jobCards = document.querySelectorAll('.job-card--container');

      // Also try finding job card links directly if container not found
      const jobCardLinks = document.querySelectorAll('a.job-card--modal-link, a[href*="/contacts/"][href*="/details/"]');

      // Use whichever selector found results
      let cards = Array.from(jobCards);
      if (cards.length === 0) {
        cards = Array.from(jobCardLinks);
      }

      console.log('[Roofr Extension] Found', cards.length, 'job card(s)');

      if (cards.length === 1) {
        // Exactly one job card - click it
        const cardLink = cards[0].querySelector('a.job-card--modal-link') ||
          cards[0].querySelector('a[href*="/details/"]') ||
          (cards[0].tagName === 'A' ? cards[0] : null);

        if (cardLink) {
          console.log('[Roofr Extension] Auto-clicking single job card');
          cardLink.click();
          return { clicked: true, count: 1 };
        } else {
          // Try clicking the card container itself
          console.log('[Roofr Extension] Auto-clicking job card container');
          cards[0].click();
          return { clicked: true, count: 1, clickedContainer: true };
        }
      } else if (cards.length > 1) {
        console.log('[Roofr Extension] Multiple job cards found, not auto-clicking');
        return { clicked: false, count: cards.length, reason: 'multiple_jobs' };
      } else {
        console.log('[Roofr Extension] No job cards found');
        return { clicked: false, count: 0, reason: 'no_jobs' };
      }
    } catch (e) {
      console.error('[Roofr Extension] Error in autoClickSingleJobCard:', e);
      return { clicked: false, error: e.message };
    }
  }

  function parseTime12h(s) {
    const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*([AP]M)/i);
    if (!m) return null;
    let h = +m[1], min = m[2] ? +m[2] : 0;
    if (h === 12) h = 0;
    if (m[3].toUpperCase() === "PM") h += 12;
    return { h, min };
  }

  // Event type detection by background color
  const EVENT_TYPE_COLORS = {
    'rgb(254, 243, 234)': 'Dropoffs and pickups',  // Peach/Orange
    'rgb(233, 246, 236)': 'Production',             // Light Green
    'rgb(255, 250, 237)': 'Post-production',        // Light Yellow
    'rgb(219, 234, 254)': 'Sales',                  // Light Blue
    'rgb(243, 244, 246)': 'General',                // Gray
    'rgb(254, 226, 226)': 'Unavailable'             // Light Pink
  };

  function parseDateFromClass(cls) {
    const m = cls.match(/-(\d{2})-(\d{2})-(\d{4})--/);
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1]);
  }

  // Extract full date and time from class name
  // Format: rbcalendar-event-{id}-{id}-DD-MM-YYYY--HH-MM-SS
  function extractDateTimeFromClass(className) {
    const match = className.match(/(\d{2})-(\d{2})-(\d{4})--(\d{2})-(\d{2})-(\d{2})/);
    if (!match) return null;

    const [_, day, month, year, hour, min, sec] = match;
    return new Date(+year, +month - 1, +day, +hour, +min, +sec);
  }

  function parseTimeRange(str) {
    const m = str.match(/(\d{1,2}(?::\d{2})?\s*[AP]M)\s*[–-]\s*(\d{1,2}(?::\d{2})?\s*[AP]M)/i);
    if (!m) return null;
    return [m[1], m[2]];
  }

  function normalizeTimeToMinutes(timeText) {
    if (!timeText) return null;
    const parsed = parseTime12h(String(timeText).replace(/\s+/g, ' ').trim());
    return parsed ? parsed.h * 60 + parsed.min : null;
  }

  function formatWindowLabel(startText, endText) {
    if (!startText || !endText) return '';
    return `${String(startText).trim()}-${String(endText).trim()}`;
  }

  function extractArrivalWindowFromText(text) {
    if (!text) return null;
    const match = text.match(/\bArrival\s*Window\s*:?\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\s*[–—-]\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/i);
    if (!match) return null;
    return {
      startText: match[1],
      endText: match[2],
      startMinutes: normalizeTimeToMinutes(match[1]),
      endMinutes: normalizeTimeToMinutes(match[2]),
      label: formatWindowLabel(match[1], match[2])
    };
  }

  // Comprehensive event extraction using color, class names, and content
  function extractEventFromElement(el) {
    // 3. Get text content (used by all-day detection below too)
    const text = el.textContent?.trim() || '';

    // 1. Detect all-day event. Weekly/Monthly: rbc-event-allday class. Agenda: the
    // EventTime span literally says "All day" — no class for it.
    const isAgendaItem = (el.className || '').toString().includes('AgendaItemWrapper');
    const isAllDay = el.classList.contains('rbc-event-allday')
      || (isAgendaItem && /\ball\s*day\b/i.test(
          el.querySelector('[class*="EventTime"]')?.textContent || ''
         ));

    // 2. Get event type from background color. Weekly/Monthly: bg is on the
    // event element itself. Agenda: bg is on the inner EventColorBar.
    let bgColor = window.getComputedStyle(el).backgroundColor;
    if (isAgendaItem) {
      const colorBar = el.querySelector('[class*="EventColorBar"]');
      if (colorBar) bgColor = window.getComputedStyle(colorBar).backgroundColor;
    }
    const eventType = EVENT_TYPE_COLORS[bgColor] || 'Unknown';

    // 4. Extract date/time from class name (most reliable method)
    const startDateTime = extractDateTimeFromClass(el.className);

    // 5. Parse time range from text content (for display)
    const timeMatch = text.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))\s*[–-]\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/i);

    // 6. Extract title (address/description)
    let title = text;
    if (timeMatch) {
      // Remove time range from title
      title = text.replace(timeMatch[0], '').trim();
    }

    // 7. Calculate end time if we have start time and duration from text
    let endDateTime = null;
    if (startDateTime && timeMatch) {
      // Parse end time from text
      const endTime = parseTime12h(timeMatch[2]);
      if (endTime) {
        endDateTime = new Date(
          startDateTime.getFullYear(),
          startDateTime.getMonth(),
          startDateTime.getDate(),
          endTime.h,
          endTime.min
        );
      }
    } else if (startDateTime && isAllDay) {
      // All-day events span to end of day
      endDateTime = new Date(
        startDateTime.getFullYear(),
        startDateTime.getMonth(),
        startDateTime.getDate(),
        23,
        59
      );
    }

    // Fallback: try old method if class-based extraction fails
    if (!startDateTime) {
      const date = parseDateFromClass(el.className);
      if (date) {
        if (isAllDay) {
          return {
            start: toLocalISO(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0)),
            end: toLocalISO(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59)),
            title: title,
            eventType: eventType,
            isAllDay: true
          };
        } else if (timeMatch) {
          const s = parseTime12h(timeMatch[1]);
          const e = parseTime12h(timeMatch[2]);
          if (s && e) {
            return {
              start: toLocalISO(new Date(date.getFullYear(), date.getMonth(), date.getDate(), s.h, s.min)),
              end: toLocalISO(new Date(date.getFullYear(), date.getMonth(), date.getDate(), e.h, e.min)),
              title: title,
              eventType: eventType,
              isAllDay: false
            };
          }
        }
      }
      return { start: null, end: null, title: title, eventType: eventType, isAllDay: isAllDay };
    }

    return {
      start: toLocalISO(startDateTime),
      end: endDateTime ? toLocalISO(endDateTime) : toLocalISO(startDateTime),
      title: title,
      eventType: eventType,
      isAllDay: isAllDay
    };
  }

  // Legacy function for backward compatibility
  function extractTimes(el) {
    const result = extractEventFromElement(el);
    return { start: result.start, end: result.end, isAllDay: result.isAllDay };
  }

  function getTitle(el) {
    const t = el.querySelector(".rbc-event-content");
    return t ? t.textContent.trim() : "";
  }

  function getToolbarMonthYear() {
    const node = document.querySelector(".rbc-toolbar-label") || document.querySelector("h2");
    const txt = (node && node.textContent) ? node.textContent.trim() : "";
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    // Handle year-crossing headers like "December - January, 2026"
    // In this case, December is in the previous year (2025), January is in 2026
    const crossYearMatch = txt.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s*-\s*(January|February|March|April|May|June|July|August|September|October|November|December),?\s*(\d{4})/i);
    if (crossYearMatch) {
      const firstMonth = months.findIndex(n => new RegExp(n, "i").test(crossYearMatch[1]));
      const secondMonth = months.findIndex(n => new RegExp(n, "i").test(crossYearMatch[2]));
      const year = +crossYearMatch[3];

      // If first month > second month, we're crossing a year boundary
      // e.g., "December - January, 2025" means December 2025, January 2026
      // The year in the header refers to the FIRST month (December), not the second (January)
      if (firstMonth > secondMonth) {
        return { monthIndex: firstMonth, year: year };
      }
      // Same year transition (e.g., "March - April, 2025")
      return { monthIndex: firstMonth, year: year };
    }

    // Standard single month header (e.g., "December 2025")
    const m = txt.match(/(January|February|March|April|May|June|July|August|September|October|November|December)[^0-9]*(\d{4})/i);
    if (!m) return null;
    const mi = months.findIndex(n => new RegExp(n, "i").test(m[1]));
    if (mi < 0) return null;
    return { monthIndex: mi, year: +m[2] };
  }

  // This is the primary, robust function for finding all visible dates on the calendar.
  function getVisibleDatesISO() {
    const dates = new Set();

    // Strategy 0 (Agenda view): synthesize the FULL visible month, even days
    // with zero events.
    //
    // Why synthesize:
    // 1. Agenda hides days with zero events, but reps need to see those days
    //    too — that's where unbooked capacity lives.
    // 2. Past days aren't useful for booking, so we drop anything before today.
    //
    // For today's month we use today→EOM. For any OTHER month with events in
    // the visible agenda (e.g. user clicked next-month to view June while
    // it's still May), we synthesize day 1 → EOM of that month so reps can
    // see the whole month, not just the days Roofr happened to render rows for.
    if (document.querySelector('[class*="AgendaContainer"]')) {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const todayDay = now.getDate();
      const todayISO = `${year}-${pad(month + 1)}-${pad(todayDay)}`;
      const todayMonthKey = `${year}-${pad(month + 1)}`;

      // Discover which months are present in the agenda DOM.
      const monthsPresent = new Set([todayMonthKey]);
      document.querySelectorAll('[class*="rbcalendar-event-"]').forEach(el => {
        const m = (el.className || '').match(/-(\d{2})-(\d{2})-(\d{4})--/);
        if (m) monthsPresent.add(`${m[3]}-${m[2]}`);
      });

      // Synthesize all days of each month present (today→EOM for today's month;
      // 1→EOM for any other month).
      for (const mk of monthsPresent) {
        const [yy, mm] = mk.split('-').map(Number);
        const lastDay = new Date(yy, mm, 0).getDate();
        const startDay = (mk === todayMonthKey) ? todayDay : 1;
        for (let d = startDay; d <= lastDay; d++) {
          const dt = new Date(yy, mm - 1, d);
          dates.add(`${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`);
        }
      }

      const filtered = Array.from(dates).filter(d => d >= todayISO).sort();
      if (filtered.length > 0) return filtered;
    }

    // Strategy 1: Try multiple selectors for Weekly view data-date attributes
    const selectors = [
      ".rbc-time-content .rbc-day-bg[data-date]",
      ".rbc-time-view .rbc-day-bg[data-date]",
      ".rbc-day-bg[data-date]"
    ];

    for (const selector of selectors) {
      const bgs = document.querySelectorAll(selector);
      if (bgs.length > 0) {
        bgs.forEach(bg => {
          const dataDate = bg.getAttribute("data-date");
          if (dataDate && /^\d{4}-\d{2}-\d{2}/.test(dataDate)) {
            dates.add(dataDate.slice(0, 10));
          }
        });
        if (dates.size > 0) break; // Found dates, stop trying selectors
      }
    }

    // Strategy 2: Fallback to reading headers if `data-date` is not present (Weekly view fallback).
    // Promoted this to run BEFORE the text search to prioritize Weekly view structure.
    if (dates.size === 0) {
      const my = getToolbarMonthYear();
      if (my) {
        const dateCells = document.querySelectorAll('.rbc-time-header-content .rbc-header');
        let currentMonth = my.monthIndex;
        let currentYear = my.year;
        let lastDay = 0;

        dateCells.forEach(cell => {
          const dayMatch = cell.textContent.match(/(\d+)$/);
          if (dayMatch) {
            let day = parseInt(dayMatch[1], 10);
            // Handle month wrapping (e.g., a view showing Oct 30, Oct 31, Nov 1)
            if (day < lastDay && day < 15) {
              currentMonth++;
              if (currentMonth > 11) {
                currentMonth = 0;
                currentYear++;
              }
            }
            const d = new Date(Date.UTC(currentYear, currentMonth, day));
            const iso = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
            dates.add(iso);
            lastDay = day;
          }
        });
      }
    }

    // Strategy 3: Daily view - Extract from page title/header (e.g., "December 22, 2025")
    // Demoted to last resort and scoped to toolbar to avoid false positives in Weekly view.
    if (dates.size === 0) {
      // Look for the main date display strictly in the toolbar/header
      const headerNode = document.querySelector(".rbc-toolbar-label") || document.querySelector("h2");
      const pageText = headerNode ? headerNode.textContent : "";

      if (pageText) {
        const fullDateMatch = pageText.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i);
        if (fullDateMatch) {
          const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
          const mi = months.findIndex(n => new RegExp(n, "i").test(fullDateMatch[1]));
          const day = parseInt(fullDateMatch[2], 10);
          const year = parseInt(fullDateMatch[3], 10);
          if (mi >= 0) {
            const d = new Date(Date.UTC(year, mi, day));
            const iso = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
            dates.add(iso);
          }
        }
      }
    }

    // Return a sorted array of unique date strings.
    return Array.from(dates).sort();
  }


  window.__roofrHL = window.__roofrHL || { injected: false };
  function ensureHighlightStyles() {
    if (window.__roofrHL.injected) return;
    const style = document.createElement("style");
    style.textContent = `
      .roofr-hover-highlight { outline: 2px solid #f6d36b !important; outline-offset: 2px !important; }
      .roofr-selection-highlight { outline: 3px solid #ef4444 !important; outline-offset: 1px !important; box-shadow: 0 0 12px rgba(239, 68, 68, 0.5); }
    `;
    document.documentElement.appendChild(style);
    window.__roofrHL.injected = true;
  }

  function getAllEventNodes() {
    // Weekly/Monthly/Daily: .rbc-event. Agenda: AgendaItemWrapper.
    // Both have a `rbcalendar-event-{id}-{id}-DD-MM-YYYY--HH-MM-SS` class, so a
    // single CSS attribute match catches both, then dedupe by element identity.
    const set = new Set([
      ...document.querySelectorAll('.rbc-event'),
      ...document.querySelectorAll('[class*="AgendaItemWrapper"]'),
      ...document.querySelectorAll('[class*="rbcalendar-event-"]'),
    ]);
    return Array.from(set);
  }

  function clearAllHighlights() {
    getAllEventNodes().forEach((el) => {
      el.classList.remove("roofr-hover-highlight");
      el.classList.remove("roofr-selection-highlight");
    })
  };

  function highlightCity(city) {
    ensureHighlightStyles();
    const C = String(city || "").toUpperCase();
    if (!C) return;
    clearAllHighlights();
    getAllEventNodes().forEach((el) => {
      const t = (getTitle(el) || "").toUpperCase();
      if (new RegExp(`\\b${C}\\b`, "i").test(t)) el.classList.add("roofr-hover-highlight");
    });
  }

  function highlightEvent(targetTitle, targetStart) {
    ensureHighlightStyles();
    clearAllHighlights();
    const nodes = getAllEventNodes();
    for (const node of nodes) {
      const nodeTitle = getTitle(node);
      const { start } = extractTimes(node);
      if (nodeTitle === targetTitle && start === targetStart) {
        node.classList.add("roofr-selection-highlight");
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      }
    }
  }

  // Highlight the week navigation arrow (prev/next)
  function highlightWeekNavArrow(direction) {
    // Clear any existing arrow highlights
    document.querySelectorAll('.roofr-nav-highlight').forEach(el => {
      el.classList.remove('roofr-nav-highlight');
    });

    // Add styles for nav highlight if not present
    if (!document.getElementById('roofr-nav-highlight-styles')) {
      const style = document.createElement('style');
      style.id = 'roofr-nav-highlight-styles';
      style.textContent = `
              .roofr-nav-highlight {
                  animation: roofr-nav-pulse 1s ease-in-out infinite;
                  box-shadow: 0 0 0 3px #f59e0b, 0 0 20px rgba(245, 158, 11, 0.5) !important;
                  border-radius: 8px !important;
                  position: relative;
                  z-index: 100;
              }
              @keyframes roofr-nav-pulse {
                  0%, 100% { box-shadow: 0 0 0 3px #f59e0b, 0 0 20px rgba(245, 158, 11, 0.5); }
                  50% { box-shadow: 0 0 0 5px #f59e0b, 0 0 30px rgba(245, 158, 11, 0.8); }
              }
          `;
      document.head.appendChild(style);
    }

    let targetBtn = null;

    // Try to find by data-testid first (Roofr calendar specific)
    if (direction === 'next') {
      targetBtn = document.querySelector('button[data-testid="calendar-next-month-button"]');
    } else {
      targetBtn = document.querySelector('button[data-testid="calendar-prev-month-button"]');
    }

    // Fallback: find buttons with SVG chevron icons (polyline with points "9 18 15 12 9 6" for next, "15 18 9 12 15 6" for prev)
    if (!targetBtn) {
      const allButtons = document.querySelectorAll('button');
      for (const btn of allButtons) {
        const svg = btn.querySelector('svg');
        if (!svg) continue;

        const polyline = svg.querySelector('polyline');
        if (polyline) {
          const points = polyline.getAttribute('points') || '';
          // Next arrow: "9 18 15 12 9 6" (chevron right >)
          // Prev arrow: "15 18 9 12 15 6" (chevron left <)
          if (direction === 'next' && points.includes('9 18 15 12 9 6')) {
            targetBtn = btn;
            break;
          } else if (direction === 'prev' && points.includes('15 18 9 12 15 6')) {
            targetBtn = btn;
            break;
          }
        }
      }
    }

    // Another fallback: look for roofr-button-icon classes
    if (!targetBtn) {
      const iconButtons = document.querySelectorAll('.roofr-button-icon, .roofr-button-icon-left');
      for (const btn of iconButtons) {
        const svg = btn.querySelector('svg');
        if (svg) {
          const polyline = svg.querySelector('polyline');
          if (polyline) {
            const points = polyline.getAttribute('points') || '';
            if (direction === 'next' && points.includes('9 18 15 12 9 6')) {
              targetBtn = btn.closest('button') || btn;
              break;
            } else if (direction === 'prev' && points.includes('15 18 9 12 15 6')) {
              targetBtn = btn.closest('button') || btn;
              break;
            }
          }
        }
      }
    }

    if (targetBtn) {
      targetBtn.classList.add('roofr-nav-highlight');
      targetBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Auto-remove highlight after 5 seconds
      setTimeout(() => {
        targetBtn.classList.remove('roofr-nav-highlight');
      }, 5000);
    }
  }

  // Click the week navigation arrow (prev/next) to automatically navigate
  function clickWeekNavArrow(direction) {
    let targetBtn = null;

    // Try to find by data-testid first (Roofr calendar specific)
    if (direction === 'next') {
      targetBtn = document.querySelector('button[data-testid="calendar-next-month-button"]');
    } else {
      targetBtn = document.querySelector('button[data-testid="calendar-prev-month-button"]');
    }

    // Fallback: find buttons with SVG chevron icons
    if (!targetBtn) {
      const allButtons = document.querySelectorAll('button');
      for (const btn of allButtons) {
        const svg = btn.querySelector('svg');
        if (!svg) continue;

        const polyline = svg.querySelector('polyline');
        if (polyline) {
          const points = polyline.getAttribute('points') || '';
          if (direction === 'next' && points.includes('9 18 15 12 9 6')) {
            targetBtn = btn;
            break;
          } else if (direction === 'prev' && points.includes('15 18 9 12 15 6')) {
            targetBtn = btn;
            break;
          }
        }
      }
    }

    // Another fallback: look for roofr-button-icon classes
    if (!targetBtn) {
      const iconButtons = document.querySelectorAll('.roofr-button-icon, .roofr-button-icon-left');
      for (const btn of iconButtons) {
        const svg = btn.querySelector('svg');
        if (svg) {
          const polyline = svg.querySelector('polyline');
          if (polyline) {
            const points = polyline.getAttribute('points') || '';
            if (direction === 'next' && points.includes('9 18 15 12 9 6')) {
              targetBtn = btn.closest('button') || btn;
              break;
            } else if (direction === 'prev' && points.includes('15 18 9 12 15 6')) {
              targetBtn = btn.closest('button') || btn;
              break;
            }
          }
        }
      }
    }

    if (targetBtn) {
      targetBtn.click();
    }
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  let lastKnownDatesJSON = "[]";

  // Actively watch for calendar changes and notify the extension.
  function checkForDatesChange() {
    const currentDatesISO = getVisibleDatesISO();
    const currentJSON = JSON.stringify(currentDatesISO);
    if (currentJSON !== lastKnownDatesJSON && currentDatesISO.length > 0) {
      lastKnownDatesJSON = currentJSON;
      if (chrome.runtime && chrome.runtime.id) { // Guard against invalidated context
        chrome.runtime.sendMessage({ type: "ROOFR_DATES_CHANGED", datesISO: currentDatesISO });
      }
    }
  }

  const debouncedCheckForDatesChange = debounce(checkForDatesChange, 500);

  const observer = new MutationObserver(debouncedCheckForDatesChange);

  setTimeout(() => {
    const calendarContainer = document.querySelector('.rbc-calendar') || document.body;
    observer.observe(calendarContainer, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    checkForDatesChange();
  }, 2000);

  // Auto-initialize: Check "Sales" checkbox and trigger scan when calendar loads
  function autoInitializeCalendar() {
    // Look for the "Sales" checkbox in Event types section
    const labels = document.querySelectorAll('label, span, div');
    let salesCheckbox = null;

    for (const label of labels) {
      const text = label.textContent?.trim();
      if (text === 'Sales') {
        // Found Sales label, look for checkbox
        const parent = label.closest('label, div, li');
        if (parent) {
          salesCheckbox = parent.querySelector('input[type="checkbox"]');
          if (!salesCheckbox) {
            // Try custom checkbox
            const clickable = parent.querySelector('[role="checkbox"]') || parent;
            if (clickable) {
              const isChecked = clickable.getAttribute('aria-checked') === 'true' ||
                clickable.classList.contains('checked') ||
                parent.querySelector('input[type="checkbox"]:checked');
              if (!isChecked) {
                clickable.click();
                console.log('[Roofr Extension] Auto-checked Sales');
              }
              break;
            }
          }
          if (salesCheckbox && !salesCheckbox.checked) {
            salesCheckbox.click();
            console.log('[Roofr Extension] Auto-checked Sales checkbox');
          }
          break;
        }
      }
    }

    // After checking Sales, store flag for popup to check and try to notify
    setTimeout(() => {
      if (chrome.runtime && chrome.runtime.id) {
        // Store flag in session storage via service worker (content scripts can't access storage directly in MV3)
        chrome.runtime.sendMessage({ type: "SET_AUTO_SCAN_PENDING" }).catch(() => { });
        // Also try to send message in case popup is open
        chrome.runtime.sendMessage({ type: "AUTO_SCAN_READY" }).catch(() => { });
        console.log('[Roofr Extension] Set autoScanPending flag and sent AUTO_SCAN_READY');
      }
    }, 1500); // Wait for calendar to update after checking Sales
  }

  // Run auto-init after page has fully loaded
  if (window.location.pathname.includes('/calendar')) {
    setTimeout(autoInitializeCalendar, 3000);
  }

  // Add right-click handler to Today button to open Daily view for today
  function setupTodayButtonRightClick() {
    // Find the Today button in the toolbar
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent?.trim();
      if (text === 'Today') {
        // Check if we already added the handler
        if (btn.dataset.roofRightClickAdded) continue;
        btn.dataset.roofRightClickAdded = 'true';

        btn.addEventListener('contextmenu', async (e) => {
          e.preventDefault();
          e.stopPropagation();

          console.log('[Roofr Extension] Right-click on Today - switching to Daily view');

          // Switch to Daily view
          const result = await switchToDailyView();
          console.log('[Roofr Extension] Switch to Daily result:', result);

          // Wait for view to update
          await new Promise(r => setTimeout(r, 500));

          // Click today's date in the mini calendar
          const today = new Date();
          const day = today.getDate();
          const month = today.getMonth() + 1;
          const year = today.getFullYear();

          const dateResult = await clickDateInPicker(day, month, year);
          console.log('[Roofr Extension] Click today date result:', dateResult);
        });

        console.log('[Roofr Extension] Added right-click handler to Today button');
      }
    }
  }

  // Run setup after page loads and also watch for DOM changes
  if (window.location.pathname.includes('/calendar')) {
    setTimeout(setupTodayButtonRightClick, 3500);

    // Re-run periodically in case the button gets re-rendered
    const todayButtonObserver = new MutationObserver(() => {
      setupTodayButtonRightClick();
    });

    setTimeout(() => {
      const toolbar = document.querySelector('.rbc-toolbar') || document.body;
      todayButtonObserver.observe(toolbar, { childList: true, subtree: true });
    }, 4000);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "PING_ROOFR") {
      sendResponse({ ok: true });
      return true;
    }

    // Handle contact search injection from CTM integration
    if (msg.type === "INJECT_CONTACT_SEARCH") {
      injectContactSearch(msg.phoneNumber).then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true; // Async response
    }

    // Auto-click the job card on the current contact page (used by fast path)
    if (msg.type === "AUTO_CLICK_JOB_CARD") {
      autoClickSingleJobCard().then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true; // Async response
    }

    // Handle job search injection for address search
    if (msg.type === "INJECT_JOB_SEARCH") {
      injectJobSearch(msg.address).then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true; // Async response
    }

    if (msg.type === "GET_VISIBLE_DATES") {
      const datesISO = getVisibleDatesISO();
      sendResponse({ ok: datesISO.length > 0, datesISO: datesISO });
      return true;
    }

    if (msg.type === "EXTRACT_ROOFR_EVENTS") {
      const nodes = getAllEventNodes();
      // Multi-rep events render as one DOM row per assigned rep (same
      // address, same time, different rep initials). Roofr's class name
      // encodes both — `rbcalendar-event-{eventId}-{personId}-...` — so
      // we can dedupe by eventId. The first occurrence wins; subsequent
      // occurrences are merged in as additional attendees on the same
      // event record so reps can still see who's on it.
      const byEventId = new Map();
      const orphans = []; // events with no parseable eventId — kept as-is
      for (const el of nodes) {
        const event = extractEventFromElement(el);
        if (!event.start || !event.end) continue;
        const m = (el.className || '').match(/rbcalendar-event-(\d+)-(\d+)/);
        const eventId = m ? m[1] : null;
        const repInitials = (el.querySelector('[class*="Avatar"]')?.textContent || '').trim();
        if (!eventId) { orphans.push(event); continue; }
        if (byEventId.has(eventId)) {
          const existing = byEventId.get(eventId);
          if (repInitials && !existing.attendees.includes(repInitials)) {
            existing.attendees.push(repInitials);
          }
          continue;
        }
        event.eventId = eventId;
        event.attendees = repInitials ? [repInitials] : [];
        byEventId.set(eventId, event);
      }
      const events = [...byEventId.values(), ...orphans];
      sendResponse({ ok: true, events });
      return true;
    }

    if (msg.type === "HIGHLIGHT_CITY") {
      highlightCity(msg.city);
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === "HIGHLIGHT_EVENT") {
      highlightEvent(msg.title, msg.start);
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === "CLEAR_HIGHLIGHT") {
      clearAllHighlights();
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === "HIGHLIGHT_WEEK_NAV") {
      highlightWeekNavArrow(msg.direction);
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === "CLICK_WEEK_NAV") {
      clickWeekNavArrow(msg.direction);
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === "TOGGLE_TEAM_CHECKBOX") {
      const result = toggleTeamCheckbox(msg.name);
      sendResponse(result);
      return true;
    }

    if (msg.type === "GET_CALENDAR_VIEW") {
      const view = getCurrentCalendarView();
      sendResponse({ ok: true, view });
      return true;
    }

    if (msg.type === "SWITCH_TO_WEEKLY_VIEW") {
      const result = switchToWeeklyView();
      sendResponse(result);
      return true;
    }

    if (msg.type === "SWITCH_TO_DAILY_VIEW") {
      switchToDailyView().then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    if (msg.type === "SWITCH_TO_AGENDA_VIEW") {
      switchToAgendaView().then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    if (msg.type === "CLICK_DATE_IN_PICKER") {
      clickDateInPicker(msg.day, msg.month, msg.year).then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    if (msg.type === "UNCHECK_ALL_TEAM_MEMBERS") {
      uncheckAllTeamMembers().then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    if (msg.type === "CHECK_TEAM_MEMBERS") {
      checkTeamMembers(msg.names).then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    if (msg.type === "SELECT_SALES_EVENT_TYPE") {
      const result = selectSalesEventType();
      sendResponse(result);
      return true;
    }

    if (msg.type === "UNCHECK_D2D_SALES") {
      uncheckD2DSalesEventType().then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    if (msg.type === "SELECT_PRODUCTION_EVENT_TYPES") {
      const result = selectProductionEventTypes();
      sendResponse(result);
      return true;
    }

    if (msg.type === "APPLY_SCAN_PROFILE") {
      applyScanProfile(msg.profile).then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    if (msg.type === "SWITCH_CALENDAR_VIEW") {
      switchCalendarView(msg.view).then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    if (msg.type === "SELECT_ONLY_TEAM_MEMBERS") {
      selectOnlyTeamMembers(msg.names).then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    if (msg.type === "SELECT_ALL_TEAM_MEMBERS") {
      const result = selectAllTeamMembers();
      sendResponse(result);
      return true;
    }

    if (msg.type === "SELECT_SPECIFIC_TEAM_MEMBERS") {
      selectSpecificTeamMembers(msg.names).then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    // Batch processing handlers
    if (msg.type === "BATCH_FIND_EVENT") {
      batchFindAndClickEvent(msg.address, msg.time).then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    if (msg.type === "BATCH_OPEN_JOB") {
      batchOpenJobInNewTab(msg.address, msg).then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    if (msg.type === "OPEN_JOB_VIA_EVENT_CLICK") {
      openJobViaEventMiddleClick(msg.address, msg.time).then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    if (msg.type === "BATCH_EDIT_EVENT") {
      batchEditEventAddRep(msg.address, msg.time, msg.repName).then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    if (msg.type === "BATCH_CLOSE_POPUP") {
      batchClosePopup().then(result => {
        sendResponse(result);
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    // Scan job card for paint job, lot/unit keywords, and report status
    if (msg.type === "SCAN_JOB_CARD") {
      (async () => {
        try {
          // Avoid reading an older injected banner as job-note text during a rescan.
          const staleWarningBanner = document.getElementById('roofr-batch-warning-banner');
          if (staleWarningBanner) staleWarningBanner.remove();

          // Wait for the job card page to fully render (React app needs time)
          let pageReady = false;
          for (let waitAttempt = 0; waitAttempt < 15; waitAttempt++) {
            await batchSleep(1000);
            // Check for key elements that indicate the page has loaded
            const hasHeading = document.querySelector('h1, h2, [class*="heading"], dialog heading');
            const hasActivity = document.querySelector('[class*="activity"], [class*="Activity"], main');
            const hasMeasurements = document.body.innerText?.includes('Measurements');
            if (hasHeading && hasActivity && hasMeasurements) {
              pageReady = true;
              console.log('[Batch] Job card page ready after', (waitAttempt + 1), 'seconds');
              break;
            }
          }
          if (!pageReady) {
            console.log('[Batch] Page may not be fully loaded, scanning anyway...');
          }
          await batchSleep(500); // Extra settle time

          const result = {
            isPaintJob: false,
            reportStatus: 'none', // 'none', 'processing', 'complete'
            hasLotUnit: false,
            lotUnitContext: '',
            hasAppointmentTimeMismatch: false,
            scheduledWindow: '',
            notesArrivalWindow: '',
            timeMismatchContext: '',
            jobTitle: ''
          };

          // 1. Get job title from page heading
          const headings = document.querySelectorAll('h1, h2, [class*="heading"], dialog heading');
          for (const h of headings) {
            const text = h.textContent?.trim() || '';
            if (text.length > 10 && (text.match(/\d+/) || text.toLowerCase().includes('paint') || text.toLowerCase().includes('job'))) {
              result.jobTitle = text;
              break;
            }
          }

          // 2. Check for paint job — heading, calendar event text, or page content
          const pageLower = document.body.innerText?.toLowerCase() || '';
          if (result.jobTitle.toLowerCase().includes('paint')) {
            result.isPaintJob = true;
          }
          // Also check calendar event entries on the job card
          const allElements = document.querySelectorAll('*');
          for (const el of allElements) {
            if (el.children.length === 0) {
              const text = el.textContent?.trim().toLowerCase() || '';
              if (text.includes('paint job') || text.match(/^paint\s*[-–]/i)) {
                result.isPaintJob = true;
                break;
              }
            }
          }

          // 3. Check report status
          const statusElements = document.querySelectorAll('[class*="badge"], [class*="status"], [class*="Badge"], [class*="Status"], span, div');
          for (const el of statusElements) {
            const text = el.textContent?.trim().toLowerCase() || '';
            if (text === 'processing' || text === 'in progress') {
              result.reportStatus = 'processing';
              break;
            }
          }
          if (result.reportStatus === 'none') {
            // Check for "No reports" text
            if (pageLower.includes('no reports')) {
              result.reportStatus = 'none';
            } else if (pageLower.includes('roofr report') && (pageLower.includes('complete') || pageLower.includes('delivered'))) {
              result.reportStatus = 'complete';
            }
          }

          // 4. Scan activity log for lot/unit keywords
          // Use specific patterns to reduce false positives:
          //   - "lot" requires number/# after (not "a lot of issues")
          //   - "unit" requires a unit number, #, or single-letter unit after (not "AC unit" or "Unit Address")
          //   - "building" only as abbreviation "bldg" (not "commercial building")
          //   - "space"/"spc"/"pad"/"site" require number/# after
          //   - "apt"/"suite"/"manufactured"/"trailer" are specific enough alone
          //   - "mobile home"/"mobile park" as phrases
          const lotUnitPatterns = [
            /\blot\s*[#\d]/i,
            /(?<!ac\s)(?<!air\s)(?<!hvac\s)(?<!rooftop\s)\bunit\s*(?:#\s*)?(?:\d+[A-Za-z]?|[A-Za-z]\b)/i,
            /\b(?:space|spc)\s*[#\d]/i,
            /\b(?:apt|apartment)\b/i,
            /\bsuite\s*(?:#\s*)?(?:\d+[A-Za-z]?|[A-Za-z]\b)/i,
            /\bbldg\b/i,
            /\b(?:pad|site)\s*[#\d]/i,
            /\bmanufactured\b/i,
            /\btrailer\b/i,
            /\bmobile\s*(?:home|park)/i
          ];

          // Collect customer note/activity text. Avoid scanning the whole page for lot/unit:
          // Roofr page chrome can contain unrelated fields/labels that look like address units.
          const noteElements = document.querySelectorAll('[class*="note"], [class*="Note"], [class*="activity-log"], [class*="ActivityLog"], [class*="timeline"], [class*="Timeline"], [class*="comment"], [class*="Comment"]');
          let activityText = '';
          for (const el of noteElements) {
            if (el.id === 'roofr-batch-warning-banner' || el.closest('#roofr-batch-warning-banner')) continue;
            activityText += ' ' + (el.textContent?.trim() || '');
          }
          const pageTextForAppointmentInfo = document.body.innerText || '';

          // 5. Compare appointment notes arrival window to the scheduled calendar event time.
          const scheduledStartMinutes = normalizeTimeToMinutes(msg.scheduledStartTime);
          const scheduledEndMinutes = normalizeTimeToMinutes(msg.scheduledEndTime);
          const notesWindow = extractArrivalWindowFromText(activityText) || extractArrivalWindowFromText(pageTextForAppointmentInfo);
          if (notesWindow && scheduledStartMinutes !== null && scheduledEndMinutes !== null) {
            result.scheduledWindow = formatWindowLabel(msg.scheduledStartTime, msg.scheduledEndTime);
            result.notesArrivalWindow = notesWindow.label;
            if (notesWindow.startMinutes !== scheduledStartMinutes || notesWindow.endMinutes !== scheduledEndMinutes) {
              result.hasAppointmentTimeMismatch = true;
              const idx = activityText.toLowerCase().indexOf('arrival window');
              if (idx >= 0) {
                const start = Math.max(0, idx - 40);
                const end = Math.min(activityText.length, idx + 90);
                result.timeMismatchContext = activityText.substring(start, end).trim();
              }
            }
          }

          // Test each pattern against the activity text
          for (const pattern of lotUnitPatterns) {
            const match = activityText.match(pattern);
            if (match) {
              const idx = activityText.toLowerCase().indexOf(match[0].toLowerCase());
              if (idx >= 0) {
                result.hasLotUnit = true;
                const start = Math.max(0, idx - 40);
                const end = Math.min(activityText.length, idx + match[0].length + 40);
                result.lotUnitContext = activityText.substring(start, end).trim();
                break;
              }
            }
          }

          console.log('[Batch] SCAN_JOB_CARD result:', result);
          sendResponse(result);
        } catch (err) {
          console.error('[Batch] SCAN_JOB_CARD error:', err);
          sendResponse({ error: err.message });
        }
      })();
      return true;
    }

    // Inject a visual warning banner on the page
    if (msg.type === "INJECT_WARNING_BANNER") {
      try {
        // Remove any existing banner first
        const existing = document.getElementById('roofr-batch-warning-banner');
        if (existing) existing.remove();

        const banner = document.createElement('div');
        banner.id = 'roofr-batch-warning-banner';
        banner.style.cssText = `
          position: fixed; top: 0; left: 0; right: 0; z-index: 999999;
          background: ${msg.color || '#ef4444'}; color: white;
          padding: 12px 20px; font-size: 15px; font-weight: 700;
          text-align: center; font-family: system-ui, sans-serif;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          display: flex; align-items: center; justify-content: center; gap: 10px;
          animation: bannerPulse 2s ease-in-out infinite;
        `;
        const emojiSpan = document.createElement('span');
        emojiSpan.style.fontSize = '20px';
        emojiSpan.textContent = msg.emoji || '⚠️';
        banner.appendChild(emojiSpan);

        const messageSpan = document.createElement('span');
        messageSpan.textContent = msg.message || 'Warning';
        banner.appendChild(messageSpan);

        const dismissBtn = document.createElement('button');
        dismissBtn.style.cssText = 'margin-left: 20px; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.4); color: white; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;';
        dismissBtn.textContent = 'Dismiss';
        dismissBtn.addEventListener('click', () => banner.remove());
        banner.appendChild(dismissBtn);

        // Add pulse animation
        const style = document.createElement('style');
        style.textContent = `
          @keyframes bannerPulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.85; }
          }
        `;
        document.head.appendChild(style);
        document.body.prepend(banner);

        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
      return true;
    }

    // Click the "Roofr report" button on the job card measurements section
    if (msg.type === "CLICK_ROOFR_REPORT_BUTTON") {
      (async () => {
        try {
          // Find the "Roofr report" button
          const buttons = document.querySelectorAll('button');
          let roofrBtn = null;
          for (const btn of buttons) {
            const text = btn.textContent?.trim().toLowerCase() || '';
            if (text.includes('roofr report') && !text.includes('diy')) {
              const rect = btn.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                roofrBtn = btn;
                break;
              }
            }
          }

          if (!roofrBtn) {
            sendResponse({ ok: false, error: 'Roofr report button not found' });
            return;
          }

          console.log('[Batch] Clicking Roofr report button');
          roofrBtn.click();
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;
    }

    return false;
  });

  // ========================================
  // BATCH PROCESSING FUNCTIONS
  // ========================================

  // Helper to wait
  function batchSleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Wait for a DOM element to appear — returns the element or null on timeout
  // selector: CSS selector string, OR a function that returns an element/null
  // options: { timeout, interval, message }
  function waitForEl(selector, options = {}) {
    const timeout = options.timeout || 15000;
    const interval = options.interval || 250;
    const msg = options.message || selector;
    return new Promise((resolve) => {
      const start = Date.now();

      const check = () => {
        let el = null;
        if (typeof selector === 'function') {
          el = selector();
        } else {
          el = document.querySelector(selector);
        }
        if (el) {
          const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
          // Optionally check visibility
          if (!options.visible || (rect && rect.width > 0 && rect.height > 0)) {
            console.log(`[Batch] waitForEl: "${msg}" found in ${Date.now() - start}ms`);
            resolve(el);
            return;
          }
        }
        if (Date.now() - start >= timeout) {
          console.log(`[Batch] waitForEl: "${msg}" timed out after ${timeout}ms`);
          resolve(null);
          return;
        }
        setTimeout(check, interval);
      };
      check();
    });
  }

  // Close any open popup/modal on the calendar (optionally keep if matches address)
  async function batchClosePopup(keepIfMatchesAddress = null) {
    console.log('[Batch] Closing any open popup...');

    // First check if the EventCard popup is actually open
    const addressButton = document.querySelector('[data-testid="job-map-options-dropdown-trigger"]');
    if (!addressButton) {
      console.log('[Batch] No event popup detected, skipping close');
      return { ok: true, wasOpen: false, matchesAddress: false };
    }

    // If we have an address to match, check if the open popup matches it
    if (keepIfMatchesAddress) {
      const popupAddress = (addressButton.title || addressButton.textContent || '').toLowerCase();
      const addressNumber = keepIfMatchesAddress.match(/^\d+/)?.[0] || '';
      if (addressNumber && popupAddress.includes(addressNumber)) {
        console.log('[Batch] Popup already open for correct address, keeping it open');
        return { ok: true, wasOpen: true, matchesAddress: true };
      }
      console.log('[Batch] Popup open but for different address, closing...');
    }

    // Try pressing Escape first (safest method)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    await batchSleep(400);

    // Check if popup closed
    const stillOpen = document.querySelector('[data-testid="job-map-options-dropdown-trigger"]');
    if (!stillOpen) {
      console.log('[Batch] Popup closed via Escape');
      return { ok: true, wasOpen: true, matchesAddress: false };
    }

    // Try clicking outside on the calendar background
    const calendarBg = document.querySelector('.rbc-calendar, .rbc-time-view, [class*="calendar-container"]');
    if (calendarBg) {
      const rect = calendarBg.getBoundingClientRect();
      // Click on an empty area (top-left of calendar)
      calendarBg.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, view: window,
        clientX: rect.left + 50, clientY: rect.top + 50
      }));
      await batchSleep(300);
    }

    return { ok: true, wasOpen: true, matchesAddress: false };
  }

  // Find and click a calendar event by address
  async function batchFindAndClickEvent(address, time) {
    console.log('[Batch] Finding event:', address, time);

    // Check if popup for this address is already open - if so, skip clicking
    const closeResult = await batchClosePopup(address);
    if (closeResult.matchesAddress) {
      console.log('[Batch] Popup already open for this address, skipping event click');
      return { ok: true, popupAlreadyOpen: true };
    }
    await batchSleep(500);

    const teamResult = selectAllTeamMembers();
    if (teamResult?.clicked) {
      console.log('[Batch] Selected all team members before event search');
      await batchSleep(2500);
    } else if (teamResult?.ok) {
      console.log('[Batch] Team members already selected before event search');
    } else {
      console.log('[Batch] Could not confirm Select all before event search:', teamResult?.reason || 'unknown');
    }

    // Extract address number for initial search (e.g., "10545" from "10545 E Fanfol Ln")
    const addressNumber = address.match(/^\d+/)?.[0] || '';
    const streetPart = address.split(',')[0].trim().toLowerCase(); // e.g., "10545 e fanfol ln"
    const cityPart = address.split(',')[1]?.trim().toLowerCase() || ''; // e.g., "scottsdale"

    console.log('[Batch] Searching for address number:', addressNumber, 'street:', streetPart, 'city:', cityPart);

    const getCalendarEvents = () => {
      let foundEvents = Array.from(document.querySelectorAll('.rbc-event-content'));

      // If no rbc-event-content found, fall back to rbc-event buttons
      if (foundEvents.length === 0) {
        foundEvents = Array.from(document.querySelectorAll('.rbc-event button, button.rbc-event'));
      }

      // Final fallback to rbc-event but filter out things that look like popups
      if (foundEvents.length === 0) {
        foundEvents = Array.from(document.querySelectorAll('.rbc-event')).filter(e => {
          const isInPopup = e.closest('[class*="EventCard"]') || e.closest('[role="dialog"]') || e.closest('.modal');
          return !isInPopup;
        });
      }

      // Agenda view fallback: AgendaItemWrapper. Match by class attr so the
      // styled-component hash suffix doesn't matter across deployments.
      if (foundEvents.length === 0) {
        foundEvents = Array.from(document.querySelectorAll('[class*="AgendaItemWrapper"]'));
      }

      return foundEvents;
    };

    // Expected start time (minutes since midnight) for disambiguation. Roofr's
    // event class encodes the LOCAL start time as DD-MM-YYYY--HH-MM-SS.
    const wantMinutes = normalizeTimeToMinutes(time);
    const eventStartMinutes = (event) => {
      const host = event.closest('[class*="rbcalendar-event"]') || event.closest('.rbc-event') || event;
      const dt = extractDateTimeFromClass((host.className || '').toString());
      if (dt) return dt.getHours() * 60 + dt.getMinutes();
      const title = event.closest('.rbc-event')?.getAttribute('title') || event.textContent || '';
      const tm = title.match(/(\d{1,2}(?::\d{2})?\s*[AP]M)/i);
      return tm ? normalizeTimeToMinutes(tm[1]) : null;
    };

    const findMatches = (candidateEvents) => {
      const addrMatches = [];
      for (const event of candidateEvents) {
        const eventText = event.textContent?.toLowerCase() || '';
        if (addressNumber && eventText.includes(addressNumber)) {
          addrMatches.push({ event, text: eventText });
        }
      }
      // SAFETY: when an expected time is known and the same address appears more
      // than once (duplicate/recurring events), require the event start time to
      // match before touching it. Address-only matching previously let the
      // automation open/save the WRONG event. If none match the time, refuse to
      // guess (return empty → caller aborts) rather than edit a random duplicate.
      if (wantMinutes != null && addrMatches.length > 1) {
        const timed = addrMatches.filter(m => {
          const em = eventStartMinutes(m.event);
          return em != null && Math.abs(em - wantMinutes) <= 5;
        });
        if (timed.length >= 1) return timed;
        console.warn('[Batch] Address matched but no event start time matches', time, '— refusing to guess which duplicate to edit.');
        return [];
      }
      return addrMatches;
    };

    let events = [];
    let matchingEvents = [];
    let lastEventCount = -1;
    for (let waitAttempt = 0; waitAttempt < 40; waitAttempt++) {
      events = getCalendarEvents();
      matchingEvents = findMatches(events);
      if (matchingEvents.length > 0) break;

      if (events.length !== lastEventCount || waitAttempt % 5 === 0) {
        console.log('[Batch] Waiting for target event to load:', addressNumber, 'events visible:', events.length, 'attempt:', waitAttempt + 1);
        lastEventCount = events.length;
      }
      await batchSleep(500);
    }

    console.log('[Batch] Found', events.length, 'calendar events');
    console.log('[Batch] Found', matchingEvents.length, 'events with address number', addressNumber);

    // If multiple matches, narrow down using more of the address
    if (matchingEvents.length > 1) {
      // Try to match street name
      const streetWords = streetPart.split(' ').filter(w => w.length > 1 && !/^\d+$/.test(w));
      console.log('[Batch] Multiple matches, checking street words:', streetWords);

      for (const word of streetWords) {
        const narrowed = matchingEvents.filter(m => m.text.includes(word));
        if (narrowed.length === 1) {
          matchingEvents = narrowed;
          console.log('[Batch] Narrowed to 1 match using street word:', word);
          break;
        } else if (narrowed.length > 0 && narrowed.length < matchingEvents.length) {
          matchingEvents = narrowed;
          console.log('[Batch] Narrowed to', matchingEvents.length, 'matches using street word:', word);
        }
      }

      // If still multiple, try city
      if (matchingEvents.length > 1 && cityPart) {
        const cityNarrowed = matchingEvents.filter(m => m.text.includes(cityPart));
        if (cityNarrowed.length >= 1) {
          matchingEvents = cityNarrowed;
          console.log('[Batch] Narrowed to', matchingEvents.length, 'matches using city:', cityPart);
        }
      }
    }

    // If we found exactly one match (or still have matches), find the best one
    if (matchingEvents.length > 0) {
      // If multiple matches remain, try to find exact match by full address or be more specific
      let match = matchingEvents[0];

      if (matchingEvents.length > 1) {
        // Log which events we're choosing from
        console.log('[Batch] Multiple matches remain, selecting best:');
        matchingEvents.forEach((m, i) => {
          console.log(`  ${i}: ${m.text.substring(0, 80)}`);
        });

        // Best match: contains the full street address (e.g., "10545 e fanfol ln")
        const fullAddressMatch = matchingEvents.find(m => m.text.includes(streetPart));
        if (fullAddressMatch) {
          match = fullAddressMatch;
          console.log('[Batch] Selected match containing full street address');
        } else {
          // Fallback: prefer the one that also contains city
          const withCity = matchingEvents.find(m =>
            m.text.includes(addressNumber) && m.text.includes(cityPart)
          );
          if (withCity) {
            match = withCity;
            console.log('[Batch] Selected match containing city');
          }
        }

        // Prefer .rbc-event-content over wrappers (more specific element)
        for (const m of matchingEvents) {
          if (m.event.classList?.contains('rbc-event-content')) {
            const mText = m.text;
            if (mText.includes(streetPart) || (mText.includes(addressNumber) && mText.includes(cityPart))) {
              match = m;
              console.log('[Batch] Selected rbc-event-content element');
              break;
            }
          }
        }
      }

      console.log('[Batch] Clicking event:', match.text.substring(0, 100));
      console.log('[Batch] Event element:', match.event.tagName, match.event.className);

      // Scroll the event into view first
      match.event.scrollIntoView({ behavior: 'instant', block: 'center' });
      await batchSleep(200);

      // Find the best click target - we need to click on the actual event button
      // If we found rbc-event-content, we need to go up to the parent rbc-event button
      let clickTarget = match.event;

      // If this is rbc-event-content, find the parent button
      if (match.event.classList?.contains('rbc-event-content')) {
        const parentButton = match.event.closest('button.rbc-event') || match.event.closest('.rbc-event')?.querySelector('button') || match.event.closest('.rbc-event');
        if (parentButton) {
          clickTarget = parentButton;
          console.log('[Batch] Using parent rbc-event button as click target');
        }
      }
      // If the event IS a button, use it directly
      else if (match.event.tagName === 'BUTTON') {
        clickTarget = match.event;
        console.log('[Batch] Event is a button element');
      }
      // If there's a button inside, use that
      else {
        const buttonInside = match.event.querySelector('button');
        if (buttonInside) {
          clickTarget = buttonInside;
          console.log('[Batch] Found button element inside to click');
        }
      }

      console.log('[Batch] Click target:', clickTarget.tagName, clickTarget.className);

      // Focus the element first
      if (clickTarget.focus) {
        clickTarget.focus();
        await batchSleep(100);
      }

      // Get element position for mouse events
      const rect = clickTarget.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // Full mouse event sequence to simulate real user click
      console.log('[Batch] Dispatching mouse events at:', centerX, centerY);

      // Try PointerEvents first (used by many modern React apps)
      try {
        clickTarget.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, view: window,
          clientX: centerX, clientY: centerY, button: 0, pointerType: 'mouse', isPrimary: true
        }));
        await batchSleep(50);

        clickTarget.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, cancelable: true, view: window,
          clientX: centerX, clientY: centerY, button: 0, pointerType: 'mouse', isPrimary: true
        }));
        await batchSleep(50);
      } catch (e) {
        console.log('[Batch] PointerEvents not supported, using MouseEvents');
      }

      // Mouse enter
      clickTarget.dispatchEvent(new MouseEvent('mouseenter', {
        bubbles: true, cancelable: true, view: window,
        clientX: centerX, clientY: centerY
      }));
      await batchSleep(50);

      // Mouse over
      clickTarget.dispatchEvent(new MouseEvent('mouseover', {
        bubbles: true, cancelable: true, view: window,
        clientX: centerX, clientY: centerY
      }));
      await batchSleep(50);

      // Mouse down
      clickTarget.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, view: window,
        clientX: centerX, clientY: centerY, button: 0
      }));
      await batchSleep(50);

      // Mouse up
      clickTarget.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, view: window,
        clientX: centerX, clientY: centerY, button: 0
      }));
      await batchSleep(50);

      // Click event
      clickTarget.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, view: window,
        clientX: centerX, clientY: centerY, button: 0
      }));

      // Also try native click as an additional attempt
      await batchSleep(100);
      clickTarget.click();

      // Wait for popup to appear — poll for the element instead of fixed sleep
      let popupAppeared = null;
      let isNewEventDialog = false;

      popupAppeared = await waitForEl(() => {
        // Check if "New event" dialog opened (wrong click)
        const newEventDialog = document.querySelector('button[aria-label="Close this dialog"]')?.closest('[class*="EventCard"]');
        if (newEventDialog) {
          const dialogText = newEventDialog.textContent || '';
          if (dialogText.includes('New event') || dialogText.includes('Type...') || dialogText.includes('Add title')) {
            return '__NEW_EVENT__'; // Signal to handle separately
          }
        }
        // Check for correct event popup
        const trigger = document.querySelector('[data-testid="job-map-options-dropdown-trigger"]');
        if (trigger) return trigger;
        // Fallback: EventCard with matching address
        const eventCard = document.querySelector('[class*="EventCard"]');
        if (eventCard) {
          const cardText = eventCard.textContent || '';
          if (!cardText.includes('New event') && !cardText.includes('Add title') && cardText.includes(addressNumber)) {
            return eventCard;
          }
        }
        return null;
      }, { timeout: 8000, message: 'event popup' });

      if (popupAppeared === '__NEW_EVENT__') {
        isNewEventDialog = true;
        popupAppeared = null;
        console.log('[Batch] ERROR: "New event" dialog opened instead of event popup');
        const closeBtn = document.querySelector('button[aria-label="Close this dialog"]');
        if (closeBtn) { closeBtn.click(); await batchSleep(300); }
      } else if (popupAppeared) {
        console.log('[Batch] Event popup appeared');
      }

      // If we got the wrong dialog, we need to find and click the correct element
      if (isNewEventDialog) {
        console.log('[Batch] Will retry with a more specific click target...');

        // Find the actual button element within the rbc-event
        const rbcEvent = match.event.closest('.rbc-event') || match.event;
        const eventButton = rbcEvent.querySelector('button') || rbcEvent;

        if (eventButton && eventButton !== clickTarget) {
          console.log('[Batch] Retrying click on button inside rbc-event...');
          eventButton.scrollIntoView({ behavior: 'instant', block: 'center' });
          await batchSleep(200);
          eventButton.click();
          await batchSleep(1000);

          // Check if correct popup appeared now
          popupAppeared = document.querySelector('[data-testid="job-map-options-dropdown-trigger"]');
          if (popupAppeared) {
            console.log('[Batch] Correct popup appeared after retry');
          }
        }
      }

      // Final wait for popup to fully render
      await batchSleep(500);

      // Verify popup is open
      const finalCheck = document.querySelector('[data-testid="job-map-options-dropdown-trigger"]');
      if (finalCheck) {
        console.log('[Batch] Event popup confirmed open');
        return { ok: true };
      } else {
        console.log('[Batch] Warning: Popup may not have opened correctly');
        return { ok: true, popupUncertain: true };
      }
    }

    // Fallback: Try matching the full street part
    for (const event of events) {
      const eventText = event.textContent?.toLowerCase() || '';
      if (eventText.includes(streetPart)) {
        console.log('[Batch] Found matching event by full street:', eventText.substring(0, 100));

        // Use same robust click logic as above
        event.scrollIntoView({ behavior: 'instant', block: 'center' });
        await batchSleep(200);

        let clickTarget = event;
        if (event.tagName === 'BUTTON' || event.querySelector('button')) {
          clickTarget = event.tagName === 'BUTTON' ? event : event.querySelector('button');
        }

        if (clickTarget.focus) clickTarget.focus();
        await batchSleep(100);

        const rect = clickTarget.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        clickTarget.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window, clientX: centerX, clientY: centerY }));
        await batchSleep(50);
        clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: centerX, clientY: centerY, button: 0 }));
        await batchSleep(50);
        clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: centerX, clientY: centerY, button: 0 }));
        await batchSleep(50);
        clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: centerX, clientY: centerY, button: 0 }));

        // Wait for popup
        for (let attempt = 0; attempt < 10; attempt++) {
          await batchSleep(300);
          if (document.querySelector('[data-testid="job-map-options-dropdown-trigger"]')) {
            console.log('[Batch] Popup appeared on attempt', attempt + 1);
            break;
          }
        }

        await batchSleep(500);
        return { ok: true };
      }
    }

    // Debug: Log all events found
    console.log('[Batch] Debug - All events:');
    events.forEach((e, i) => {
      if (i < 10) console.log(`  ${i}: ${e.textContent?.substring(0, 80)}`);
    });

    console.log('[Batch] Event not found in currently visible calendar events');

    throw new Error(`Could not find event with address: ${address}`);
  }

  // Open job in new tab by clicking the address link in the event popup
  // Per Roofr DOM structure:
  // 1. Calendar event click opens a popup/card
  // 2. Inside popup, there's a button containing the address
  // 3. Clicking address button reveals a context menu with "Open job" link
  async function batchOpenJobInNewTab(address, msg = {}) {
    console.log('[Batch] Opening job in new tab:', address);

    // Helper to safely get className as string (defined early for use in popup detection)
    const getClassName = (el) => {
      if (!el.className) return '';
      if (typeof el.className === 'string') return el.className;
      if (el.className.baseVal) return el.className.baseVal;
      return String(el.className);
    };

    // Helper to find the event popup
    const findEventPopup = () => {
      // First try dialog
      let popup = document.querySelector('dialog, [role="dialog"]:not([class*="osano"])');
      if (popup) return popup;

      // BEST: Try to find by the specific address button with data-testid
      const addressButton = document.querySelector('[data-testid="job-map-options-dropdown-trigger"]');
      if (addressButton) {
        console.log('[Batch] Found address button via data-testid');
        // Found the address button - find its parent popup container
        const parentPopup = addressButton.closest('[class*="EventCard"], [class*="styled__"], [class*="Card"], [class*="Popup"], [class*="popup"]');
        if (parentPopup) return parentPopup;
        // Return a reasonable parent as fallback
        return addressButton.parentElement?.parentElement?.parentElement || addressButton.parentElement;
      }

      // Also check for the job-map-options-button class
      const jobMapBtn = document.querySelector('.job-map-options-button, [class*="job-map-options"]');
      if (jobMapBtn) {
        console.log('[Batch] Found job-map-options button');
        const parentPopup = jobMapBtn.closest('[class*="EventCard"], [class*="styled__"], [class*="Card"]');
        if (parentPopup) return parentPopup;
        return jobMapBtn.parentElement?.parentElement || jobMapBtn.parentElement;
      }

      // Try EventCard class (seen in successful run: styled__EventCard-iljDsI)
      const popupCandidates = document.querySelectorAll('[class*="EventCard"], [class*="event-card"], [class*="styled__EventCard"], [class*="popup"], [class*="Popup"], [class*="popover"], [class*="Popover"], [class*="Card"], [class*="modal"], [class*="Modal"], [data-radix-popper-content-wrapper], [data-state="open"]');

      for (const candidate of popupCandidates) {
        const rect = candidate.getBoundingClientRect();
        const className = getClassName(candidate);
        // Must be visible, reasonably sized, not navigation/osano
        if (rect.width > 150 && rect.height > 100 &&
          !className.includes('osano') && !className.includes('navigation') &&
          !className.includes('sidebar')) {
          return candidate;
        }
      }

      return null;
    };

    // Wait for popup to appear — poll instead of fixed retries
    let popup = await waitForEl(() => findEventPopup(), { timeout: 8000, message: 'event popup (open job)' });

    if (!popup) {
      console.log('[Batch] Popup not found, continuing with fallback...');
    } else {
      console.log('[Batch] Popup found:', getClassName(popup).substring(0, 50));
    }

    // Extract address parts for matching
    const addressNumber = address.match(/^\d+/)?.[0] || '';
    const streetName = address.split(',')[0].toLowerCase().replace(/^\d+\s*/, '').trim();
    console.log('[Batch] Looking for address:', addressNumber, streetName);

    // Log popup contents if found
    if (popup) {
      console.log('[Batch] Popup contents - buttons:');
      const popupButtons = popup.querySelectorAll('button');
      popupButtons.forEach((btn, i) => {
        const text = btn.textContent?.trim() || '';
        console.log(`  Button ${i}: "${text.substring(0, 80)}"`);
      });

      console.log('[Batch] Popup contents - links:');
      const popupLinks = popup.querySelectorAll('a');
      popupLinks.forEach((link, i) => {
        console.log(`  Link ${i}: href=${link.href?.substring(0, 80)}, text="${link.textContent?.trim().substring(0, 40)}"`);
      });
    }

    // STEP 2: Look for address button inside popup and click it
    let addressButton = null;

    // Strategy 0: BEST - Find by specific data-testid (most reliable!)
    addressButton = document.querySelector('[data-testid="job-map-options-dropdown-trigger"]');
    if (addressButton) {
      const rect = addressButton.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        console.log('[Batch] Found address button by data-testid:', addressButton.title?.substring(0, 60) || addressButton.textContent?.substring(0, 60));
      } else {
        addressButton = null; // Not visible, keep looking
      }
    }

    // Strategy 1: Find by job-map-options-button class
    if (!addressButton) {
      addressButton = document.querySelector('.job-map-options-button, button[class*="job-map-options"]');
      if (addressButton) {
        const rect = addressButton.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          console.log('[Batch] Found address button by class:', addressButton.title?.substring(0, 60));
        } else {
          addressButton = null;
        }
      }
    }

    // Strategy 2: Find button in popup containing the address number
    if (!addressButton && popup) {
      const buttons = popup.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent?.toLowerCase() || '';
        // Match on address number or street name parts
        if (addressNumber && text.includes(addressNumber)) {
          addressButton = btn;
          console.log('[Batch] Found address button by number:', text.substring(0, 60));
          break;
        }
        // Also check for street name keywords
        const streetWords = streetName.split(/\s+/).filter(w => w.length > 2);
        const hasStreetMatch = streetWords.some(word => text.includes(word));
        if (hasStreetMatch && text.length < 200) {
          addressButton = btn;
          console.log('[Batch] Found address button by street:', text.substring(0, 60));
          break;
        }
      }
    }

    // Strategy 3: Find any button on page with address (fallback)
    if (!addressButton) {
      const allButtons = document.querySelectorAll('button');
      for (const btn of allButtons) {
        const text = btn.textContent?.toLowerCase() || '';
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && addressNumber && text.includes(addressNumber)) {
          // Make sure it's not a nav button and not a calendar event
          const className = getClassName(btn);
          if (!className.includes('navigation') && !className.includes('rbc-event') && text.length < 200) {
            addressButton = btn;
            console.log('[Batch] Found address button on page:', text.substring(0, 60));
            break;
          }
        }
      }
    }

    // Strategy 4: Look for clickable element with address text
    if (!addressButton) {
      const allElements = document.querySelectorAll('button, a, [role="button"], div[onclick], span[onclick]');
      for (const el of allElements) {
        const text = el.textContent?.toLowerCase() || '';
        const rect = el.getBoundingClientRect();
        const className = getClassName(el);
        if (rect.width > 0 && rect.height > 0 && addressNumber && text.includes(addressNumber) && text.length < 200) {
          // Skip calendar events
          if (!className.includes('rbc-event')) {
            addressButton = el;
            console.log('[Batch] Found clickable address element:', text.substring(0, 60));
            break;
          }
        }
      }
    }

    if (!addressButton) {
      console.log('[Batch] ERROR: Could not find address button');
      // Debug: show all visible buttons
      console.log('[Batch] All visible buttons on page:');
      document.querySelectorAll('button').forEach((btn, i) => {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && i < 20) {
          console.log(`  ${i}: "${btn.textContent?.trim().substring(0, 60)}"`);
        }
      });
      throw new Error('Could not find address button in event popup');
    }

    // Click the address button to reveal dropdown menu
    console.log('[Batch] Clicking address button to reveal dropdown menu...');
    addressButton.click();

    // STEP 3: Wait for dropdown menu to appear and find "Open job" link
    console.log('[Batch] Waiting for dropdown menu...');

    let openJobLink = null;

    // Wait for "Open job" link to appear in dropdown
    openJobLink = await waitForEl(() => {
      // BEST: Find by specific data-testid
      const byTestId = document.querySelector('[data-testid="job-map-options-dropdown-open-job"]');
      if (byTestId) return byTestId;
      // Check dropdown container
      const dropdown = document.querySelector('[data-testid="job-map-options-dropdown"]');
      if (dropdown) {
        const linkInDropdown = dropdown.querySelector('a[href*="/jobs/"]');
        if (linkInDropdown) return linkInDropdown;
      }
      // Fallback: visible link with "open" text and /jobs/details/ href
      const jobLinks = document.querySelectorAll('a[href*="/jobs/details/"]');
      for (const link of jobLinks) {
        const rect = link.getBoundingClientRect();
        const text = link.textContent?.toLowerCase() || '';
        if (rect.width > 0 && rect.height > 0 && text.includes('open')) return link;
      }
      return null;
    }, { timeout: 8000, visible: true, message: 'Open job link' });

    // If still not found, try additional strategies
    if (!openJobLink) {
      console.log('[Batch] Trying additional strategies to find Open job link...');

      // Strategy: Find any visible link with "open job" text
      const allLinks = document.querySelectorAll('a');
      for (const link of allLinks) {
        const text = link.textContent?.trim().toLowerCase() || '';
        const rect = link.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && text === 'open job') {
          openJobLink = link;
          console.log('[Batch] Found "Open job" link by text content');
          break;
        }
      }
    }

    // Strategy: Look for any element with "Open job" text
    if (!openJobLink) {
      const allElements = [...document.querySelectorAll('*')].filter(el => {
        const text = el.textContent?.trim().toLowerCase() || '';
        const rect = el.getBoundingClientRect();
        return text === 'open job' && rect.width > 0 && rect.height > 0;
      });
      if (allElements.length > 0) {
        // Find the most specific element (smallest)
        openJobLink = allElements.reduce((smallest, el) => {
          const rect = el.getBoundingClientRect();
          const smallestRect = smallest.getBoundingClientRect();
          return rect.width * rect.height < smallestRect.width * smallestRect.height ? el : smallest;
        });
        console.log('[Batch] Found "Open job" element:', openJobLink.tagName);
      }
    }

    if (!openJobLink) {
      // Debug: Show what's in the context menu area
      console.log('[Batch] Context menu debug - all visible links:');
      document.querySelectorAll('a').forEach((link, i) => {
        const rect = link.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && i < 15) {
          console.log(`  ${i}: href=${link.href?.substring(0, 60)}, text="${link.textContent?.trim().substring(0, 30)}"`);
        }
      });

      console.log('[Batch] Context menu debug - elements with "job" text:');
      document.querySelectorAll('*').forEach(el => {
        const text = el.textContent?.trim().toLowerCase() || '';
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && text.includes('job') && text.length < 50 && el.children.length === 0) {
          console.log(`  ${el.tagName}: "${text}"`);
        }
      });

      throw new Error('Could not find "Open job" link in context menu');
    }

    // Extract job URL and open in new tab (or return URL only if backgroundMode)
    const jobUrl = openJobLink.href;
    if (jobUrl && jobUrl.includes('/jobs/')) {
      console.log('[Batch] Job URL:', jobUrl);
      if (msg.backgroundMode) {
        // Don't open — let popup.js handle tab creation with active: false
        return { ok: true, url: jobUrl, urlOnly: true };
      }
      window.open(jobUrl, '_blank');
      await batchSleep(500);
      return { ok: true, needsTabLookup: true, url: jobUrl };
    }

    // If no href, try clicking the element
    console.log('[Batch] Clicking Open job element...');
    openJobLink.click();
    await batchSleep(1000);

    // Check if a new job link appeared
    const newJobLinks = document.querySelectorAll('a[href*="/jobs/"]');
    for (const link of newJobLinks) {
      const rect = link.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && link.href.includes('/jobs/details/')) {
        console.log('[Batch] Found job link after click:', link.href);
        if (msg.backgroundMode) {
          return { ok: true, url: link.href, urlOnly: true };
        }
        window.open(link.href, '_blank');
        return { ok: true, needsTabLookup: true, url: link.href };
      }
    }

    return { ok: true, needsTabLookup: true };
  }

  // Edit event and add rep as invitee
  // Open a job card straight from its calendar event by simulating a middle-click
  // on the event. The MAIN-world script (roofr-material-order-newtab.js) reads the
  // event's job_id from React fiber and opens the job in a background tab — no need
  // to open the event popup and hunt for an "Open job" link.
  async function openJobViaEventMiddleClick(address, time) {
    const addressNumber = (String(address).match(/^\d+/) || [])[0] || '';
    const wantMin = (typeof normalizeTimeToMinutes === 'function') ? normalizeTimeToMinutes(time) : null;
    const getEvents = () => {
      let evs = Array.from(document.querySelectorAll('.rbc-event-content'));
      if (!evs.length) evs = Array.from(document.querySelectorAll('.rbc-event button, button.rbc-event, .rbc-event'));
      return evs;
    };

    let target = null;
    for (let i = 0; i < 20 && !target; i++) {
      const matches = getEvents().filter(e => addressNumber && (e.textContent || '').includes(addressNumber));
      if (matches.length) {
        if (wantMin != null && matches.length > 1) {
          target = matches.find(e => {
            const host = e.closest('[class*="rbcalendar-event"]') || e.closest('.rbc-event') || e;
            const dt = extractDateTimeFromClass((host.className || '').toString());
            return dt && Math.abs((dt.getHours() * 60 + dt.getMinutes()) - wantMin) <= 5;
          }) || null;
        } else {
          target = matches[0];
        }
      }
      if (!target) await batchSleep(500);
    }
    if (!target) return { ok: false, error: `Event not found on the visible calendar for: ${address}` };

    const clickTarget = target.closest('.rbc-event') || target;
    const opts = { bubbles: true, cancelable: true, view: window, button: 1, buttons: 4 };
    clickTarget.dispatchEvent(new MouseEvent('mousedown', opts));
    clickTarget.dispatchEvent(new MouseEvent('mouseup', opts));
    clickTarget.dispatchEvent(new MouseEvent('auxclick', opts));
    return { ok: true };
  }

  async function batchEditEventAddRep(address, time, repName) {
    console.log('[Batch] Editing event to add rep:', repName);

    // Track CSR removal for reporting back
    window.__batchCsrsRemoved = 0;
    window.__batchDetails = '';

    // Get CSR list from storage for checking if existing invitee is a CSR
    let csrList = [];
    try {
      const settings = await chrome.storage.sync.get({ PEOPLE_CSRS: '' });
      if (settings.PEOPLE_CSRS) {
        csrList = settings.PEOPLE_CSRS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      }
      console.log('[Batch] CSR list loaded:', csrList);
    } catch (e) {
      console.log('[Batch] Could not load CSR list from storage:', e.message);
      // Fallback CSR list (CSRs only, not reps)
      csrList = ["bronté pisz", "diva shahpur", "madi meyers", "nica javier"];
    }

    // First, find and click the event again
    const findResult = await batchFindAndClickEvent(address, time);
    if (!findResult || !findResult.ok) {
      throw new Error(`Could not find event with address: ${address}`);
    }
    await batchSleep(1000);

    // CHECK IF REP IS ALREADY ON THE CALENDAR (before clicking Edit)
    // Look for invitees in the popup view - they show as text in the Invitees section
    const inviteesSection = document.querySelector('[class*="Invitees"], [data-testid*="invitees"]');
    const popupText = document.body.innerText || '';

    // Check if rep name appears in the popup (near "Invitees" label)
    const repNameLower = repName.toLowerCase();
    const repFirstName = repName.split(' ')[0].toLowerCase();
    const repLastName = repName.split(' ').slice(-1)[0].toLowerCase();

    // Look for any element containing the rep name
    const allTextElements = document.querySelectorAll('p, span, div');
    let repAlreadyOnCalendar = false;

    for (const el of allTextElements) {
      const text = el.textContent?.toLowerCase() || '';
      // Check if this element contains the rep name (not in a button or input)
      if ((text.includes(repFirstName) && text.includes(repLastName)) || text === repNameLower) {
        // Make sure it's not just in the Team selector area
        const isInTeamSelector = el.closest('[class*="Team"]') || el.closest('[role="listbox"]');
        const isInInviteesArea = el.closest('[class*="Invitee"]') || el.closest('[class*="invitee"]');

        if (isInInviteesArea && !isInTeamSelector) {
          console.log('[Batch] Rep already on calendar:', el.textContent);
          repAlreadyOnCalendar = true;
          break;
        }
      }
    }

    // Also check data-testid for invitee rows containing rep name
    const existingInviteeRowsPreEdit = document.querySelectorAll('[data-testid*="calendar-card-invitees-row"]');
    for (const row of existingInviteeRowsPreEdit) {
      const rowText = row.textContent?.toLowerCase() || '';
      const rowTestId = row.getAttribute('data-testid')?.toLowerCase() || '';
      if (rowText.includes(repFirstName) || rowTestId.includes(repFirstName.replace(' ', '_'))) {
        console.log('[Batch] Rep found in invitee row (pre-edit):', row.textContent);
        repAlreadyOnCalendar = true;
        break;
      }
    }

    if (repAlreadyOnCalendar) {
      console.log('[Batch] Rep is already on calendar, skipping edit');
      window.__batchDetails = 'Rep already on calendar - skipped edit';

      // Close the popup
      const closeButton = document.querySelector('[data-testid="calendar-event-modal-close-button"]');
      if (closeButton) {
        closeButton.click();
        await batchSleep(500);
      } else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        await batchSleep(500);
      }

      console.log('[Batch] Skip complete — popup controller will reload calendar before the next edit');

      return { ok: true, skipped: true, reason: 'Rep already on calendar' };
    }

    // Wait for Edit button to appear
    let editButton = await waitForEl(() => {
      return Array.from(document.querySelectorAll('button'))
        .find(btn => btn.textContent?.trim().toLowerCase() === 'edit');
    }, { timeout: 8000, visible: true, message: 'Edit button' });

    if (!editButton) {
      throw new Error('Could not find Edit button');
    }

    console.log('[Batch] Clicking Edit button');
    editButton.click();

    // Wait for edit form to load — poll for the invitees input or Save button
    await waitForEl(() => {
      return document.querySelector('[data-testid="calendar-card-invitees-selection"]') ||
             document.querySelector('input[placeholder="Add guests"]') ||
             Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim().toLowerCase() === 'save');
    }, { timeout: 10000, message: 'edit form' });

    // Check for existing invitees
    let existingInviteeRows = document.querySelectorAll('[data-testid*="calendar-card-invitees-row"], [class*="InviteeRow"], .styled__InviteeRow-fpUyUm');

    // If no rows found, short wait and retry (they may still be rendering)
    if (existingInviteeRows.length === 0) {
      console.log('[Batch] No invitee rows found, waiting briefly...');
      await batchSleep(500);
      existingInviteeRows = document.querySelectorAll('[data-testid*="calendar-card-invitees-row"], [class*="InviteeRow"], .styled__InviteeRow-fpUyUm');
    }

    console.log('[Batch] Found', existingInviteeRows.length, 'existing invitee row(s)');

    if (existingInviteeRows.length > 0) {
      for (const row of existingInviteeRows) {
        // Get the invitee name from the row
        const inviteeName = row.textContent?.trim() || '';
        console.log('[Batch] Existing invitee:', inviteeName);

        // Check if this invitee is the same rep we want to add
        if (inviteeName.toLowerCase() === repName.toLowerCase() ||
            inviteeName.toLowerCase().includes(repName.toLowerCase())) {
          console.log('[Batch] Rep is already assigned! Clicking X to cancel changes...');

          // Click the modal close button (X in top right)
          const closeButton = document.querySelector('[data-testid="calendar-event-modal-close-button"]');
          if (closeButton) {
            closeButton.click();
            await batchSleep(500);
          } else {
            // Fallback: try Escape key
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
            await batchSleep(500);
          }

          console.log('[Batch] Rep already assigned — closing edit dialog');
          await batchSleep(300);

          return { ok: true, skipped: true, reason: 'Rep already assigned' };
        }

        // Check if this invitee is a CSR
        // Normalize: remove underscores, extra spaces, convert to lowercase
        const inviteeNameNormalized = inviteeName.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
        console.log('[Batch] Checking if CSR - normalized name:', inviteeNameNormalized, 'CSR list:', csrList);

        const isCsr = csrList.some(csr => {
          const csrNormalized = csr.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
          return inviteeNameNormalized.includes(csrNormalized) || csrNormalized.includes(inviteeNameNormalized);
        });

        // If invitee is NOT a CSR and NOT the target rep — FLAG it, leave dialog open
        if (!isCsr) {
          console.log('[Batch] ⚠ FLAG: Invitee "' + inviteeName + '" is NOT a CSR — leaving edit dialog open for review');

          // Highlight the invitee row in red so it's obvious
          try {
            row.style.cssText += 'background: #fecaca !important; border: 2px solid #ef4444 !important; border-radius: 4px; padding: 4px;';
          } catch (e) {}

          // Inject a warning banner on the page (above the dialog)
          try {
            const banner = document.createElement('div');
            banner.id = 'roofr-batch-invitee-warning';
            banner.style.cssText = `
              position: fixed; top: 0; left: 0; right: 0; z-index: 999999;
              background: #dc2626; color: white;
              padding: 14px 20px; font-size: 15px; font-weight: 700;
              text-align: center; font-family: system-ui, sans-serif;
              box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            `;
            banner.appendChild(document.createTextNode('⚠️ Non-CSR invitee "'));
            const nameStrong = document.createElement('strong');
            nameStrong.textContent = inviteeName;
            banner.appendChild(nameStrong);
            banner.appendChild(document.createTextNode('" found — fix manually, then close this dialog'));
            document.body.prepend(banner);
          } catch (e) {}

          // DON'T close the dialog — leave it open so Travis can see and fix it
          return {
            ok: false,
            stopAll: true,
            reason: `Non-CSR invitee "${inviteeName}" found on calendar — edit dialog left open for review`,
            inviteeName: inviteeName
          };
        }

        if (isCsr) {
          console.log('[Batch] Existing invitee is a CSR:', inviteeName, '- removing them first...');

          // Hover over the row to ensure button is visible
          row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          await batchSleep(300);

          // Find the remove button - it's INSIDE the row with class flex-shrink-0
          // DOM structure: InviteeRow contains both the name div and the remove button
          let removeButton = null;

          // Strategy 1: Button with flex-shrink-0 class inside the row (correct structure)
          removeButton = row.querySelector('button.flex-shrink-0');
          if (removeButton) {
            console.log('[Batch] Found remove button via flex-shrink-0 class');
          }

          // Strategy 2: Any button inside the row
          if (!removeButton) {
            removeButton = row.querySelector('button');
            if (removeButton) console.log('[Batch] Found remove button as any button in row');
          }

          // Strategy 3: Button with SVG X icon (has line elements forming X)
          if (!removeButton) {
            const buttons = row.querySelectorAll('button');
            for (const btn of buttons) {
              const svg = btn.querySelector('svg');
              if (svg && svg.querySelector('line')) {
                removeButton = btn;
                console.log('[Batch] Found remove button via SVG X icon');
                break;
              }
            }
          }

          // Strategy 4: Search by InviteeRow class pattern
          if (!removeButton) {
            const inviteeRows = document.querySelectorAll('[class*="InviteeRow"]');
            for (const invRow of inviteeRows) {
              if (invRow.textContent?.includes(inviteeName)) {
                removeButton = invRow.querySelector('button.flex-shrink-0') || invRow.querySelector('button');
                if (removeButton) {
                  console.log('[Batch] Found remove button via InviteeRow class search');
                  break;
                }
              }
            }
          }

          // Strategy 5: Use the user-provided method
          if (!removeButton) {
            const rows = document.querySelectorAll('.styled__InviteeRow-fpUyUm, [class*="InviteeRow"]');
            for (const r of rows) {
              if (r.textContent?.includes(inviteeName)) {
                removeButton = r.querySelector('button.flex-shrink-0') || r.querySelector('button');
                if (removeButton) {
                  console.log('[Batch] Found remove button via styled InviteeRow search');
                  break;
                }
              }
            }
          }

          // Log what we found for debugging
          console.log('[Batch] Remove button found:', !!removeButton);
          if (!removeButton) {
            console.log('[Batch] Row classes:', row.className);
            console.log('[Batch] Row HTML:', row.outerHTML?.substring(0, 500));
          }

          if (removeButton) {
            console.log('[Batch] Clicking remove button for CSR:', inviteeName);
            window.__batchDetails += `Removing CSR: ${inviteeName}. `;

            // Use multiple click methods to ensure it registers
            removeButton.focus();
            removeButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            removeButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            removeButton.click();

            await batchSleep(1000);
            console.log('[Batch] CSR remove clicked, waiting for UI update...');

            // Check if removal was successful
            const rowsAfter = document.querySelectorAll('[data-testid*="calendar-card-invitees-row"]');
            const stillPresent = Array.from(rowsAfter).some(r =>
              r.textContent?.toLowerCase().includes(inviteeName.toLowerCase().split(' ')[0])
            );

            if (!stillPresent) {
              window.__batchCsrsRemoved++;
              window.__batchDetails += `Removed successfully. `;
              console.log('[Batch] CSR removed successfully');
            } else {
              window.__batchDetails += `Removal may have failed. `;
              console.log('[Batch] CSR may still be present after removal attempt');
            }

            await batchSleep(500);

            // Verify the CSR was actually removed
            const remainingRows = document.querySelectorAll('[data-testid*="calendar-card-invitees-row"]');
            console.log('[Batch] Remaining invitee rows after removal:', remainingRows.length);
          } else {
            console.log('[Batch] Could not find remove button for CSR');
            console.log('[Batch] Row outerHTML:', row.outerHTML?.substring(0, 300));
            console.log('[Batch] Parent outerHTML:', parent?.outerHTML?.substring(0, 300));

            // Log all buttons in the area for debugging
            const allButtons = document.querySelectorAll('button');
            console.log('[Batch] Total buttons on page:', allButtons.length);
            const removeButtons = document.querySelectorAll('[data-testid*="remove"]');
            console.log('[Batch] Buttons with "remove" in testid:', removeButtons.length);
          }
        } else {
          console.log('[Batch] Invitee is NOT a CSR:', inviteeName);
        }
      }
    }

    // Now we should be in the edit form
    // Look for the Invitees/Add guests input - use the specific data-testid first
    let inviteesInput = document.querySelector('[data-testid="calendar-card-invitees-selection"]');

    // If not found by testid, try by placeholder "Add guests" (plural, not "Add title")
    if (!inviteesInput) {
      inviteesInput = document.querySelector('input[placeholder="Add guests"]');
    }

    // Try finding by the Invitees label
    if (!inviteesInput) {
      const labels = document.querySelectorAll('label');
      for (const label of labels) {
        const labelText = label.textContent?.toLowerCase() || '';
        if (labelText.includes('invitee') || labelText === 'invitees') {
          // Get the input associated with this label
          const labelFor = label.getAttribute('for');
          if (labelFor) {
            inviteesInput = document.getElementById(labelFor);
            if (inviteesInput) {
              console.log('[Batch] Found invitees input via label for:', labelFor);
              break;
            }
          }
          // Try finding input in same container
          const container = label.closest('div[class*="input-container"], div[class*="wrapper"]');
          if (container) {
            inviteesInput = container.querySelector('input');
            if (inviteesInput) {
              console.log('[Batch] Found invitees input in label container');
              break;
            }
          }
        }
      }
    }

    // Debug: log what inputs we can see
    if (!inviteesInput) {
      console.log('[Batch] DEBUG - Available inputs:');
      const allInputs = document.querySelectorAll('input[type="text"], input:not([type])');
      allInputs.forEach((inp, i) => {
        console.log(`  Input ${i}: placeholder="${inp.placeholder}", id="${inp.id}", testid="${inp.dataset?.testid}"`);
      });
      throw new Error('Could not find Invitees input');
    }

    console.log('[Batch] Found invitees input:', inviteesInput.placeholder, inviteesInput.id);

    await addInviteeAndSave(inviteesInput, repName);
    return { ok: true, csrsRemoved: window.__batchCsrsRemoved || 0, details: window.__batchDetails || '' };
  }

  // Helper to add invitee and save
  async function addInviteeAndSave(input, repName) {
    console.log('[Batch] Adding invitee:', repName);
    console.log('[Batch] Input element:', input.tagName, input.placeholder, input.id);

    // Step 1: Click the input to open the dropdown with team members list
    // Try native click first
    input.focus();
    await batchSleep(300);

    // Use native click
    input.click();
    await batchSleep(500);

    // Also dispatch mouse events for good measure
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    await batchSleep(100);
    input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    await batchSleep(100);
    input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    await batchSleep(1000); // Wait for dropdown to appear

    console.log('[Batch] Clicked input, waiting for dropdown...');

    // Check if dropdown appeared
    const dropdownCheck = document.querySelectorAll('[class*="dropdown"]:not([style*="display: none"]), [class*="menu"]:not([style*="display: none"]), [class*="popover"], [data-floating-ui-portal]');
    console.log('[Batch] Dropdowns/menus visible after click:', dropdownCheck.length);

    // Step 2: Type to filter the dropdown.
    // IMPORTANT: Roofr's invitee search is a substring match against each person's
    // ACTUAL name, and the schedule/CSR list often uses nicknames (e.g. "Madi" for
    // "Madison Meyers"). Typing the full "First Last" string returns "No guests
    // found", which is what made the old code fall back to the dangerous keyboard
    // selection. So type ONLY the first-name token to filter, then match the
    // resulting row by last name below. This makes the first attempt succeed.
    const repTokens = repName.trim().split(/\s+/);
    const wantFirst = (repTokens[0] || '').toLowerCase();
    const wantLast = (repTokens[repTokens.length - 1] || '').toLowerCase();
    const typeQuery = repTokens[0] || repName;

    // True when an option's text plausibly refers to this rep (handles nicknames
    // like Madi/Madison). Never matches the "Add filtered team" button / headers.
    const nameMatches = (rawText) => {
      const t = (rawText || '').trim().toLowerCase();
      if (!t || t === 'add filtered team' || t === 'team members') return false;
      if (t === repName.toLowerCase()) return true;
      const words = t.split(/\s+/);
      const first = words[0] || '';
      const last = words[words.length - 1] || '';
      const firstOk = !!wantFirst && (first.startsWith(wantFirst) || wantFirst.startsWith(first));
      const lastOk = !!wantLast && (last === wantLast || last.startsWith(wantLast) || wantLast.startsWith(last));
      return firstOk && lastOk;
    };

    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await batchSleep(200);

    // Paste the first-name query in one shot using execCommand for React compatibility
    console.log('[Batch] Filtering invitees by first name:', typeQuery, '(rep:', repName + ')');
    input.focus();
    document.execCommand('insertText', false, typeQuery);
    // Fallback: if execCommand didn't work, set value + fire events
    if (!input.value.includes(typeQuery)) {
      console.log('[Batch] execCommand fallback — setting value directly');
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(input, typeQuery);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // Wait for dropdown to filter — poll for an option matching the rep (by last name)
    await waitForEl(() => {
      const options = document.querySelectorAll('[data-floating-ui-portal] div, [role="option"], [class*="dropdown"] > div');
      for (const opt of options) {
        if (opt.getAttribute && opt.getAttribute('data-testid') === 'calendar-card-add-filtered-team') continue;
        if (nameMatches(opt.textContent)) {
          const rect = opt.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) return opt;
        }
      }
      return null;
    }, { timeout: 8000, message: `dropdown option for "${repName}"` });

    console.log('[Batch] Looking for dropdown option...');

    // Step 3: Find and click the rep name in the dropdown
    let foundAndClicked = false;

    // Debug: Log what dropdowns/overlays exist
    const visibleOverlays = document.querySelectorAll('[class*="dropdown"], [class*="menu"], [class*="popover"], [class*="overlay"], [class*="list"]');
    console.log('[Batch] Found overlay elements:', visibleOverlays.length);

    // Try multiple selector strategies for the dropdown options
    const dropdownSelectors = [
      // Roofr specific - look in floating elements
      '[data-floating-ui-portal] div',
      '[class*="floating"] div',
      // Generic dropdown selectors
      'div[class*="dropdown"] > div',
      'ul[role="listbox"] li',
      '[role="option"]',
      '[class*="autocomplete"] li',
      '[class*="suggestion"]',
      '[class*="menu-item"]',
      '[class*="menu"] > div',
      '[class*="list-item"]',
      '[class*="list"] > div',
      '[class*="popover"] div',
      '[class*="overlay"] div'
    ];

    for (const selector of dropdownSelectors) {
      if (foundAndClicked) break;

      const options = document.querySelectorAll(selector);
      for (const option of options) {
        // SAFETY: never match the "Add filtered team" button (adds everyone).
        if (option.getAttribute && option.getAttribute('data-testid') === 'calendar-card-add-filtered-team') continue;
        const text = option.textContent?.trim() || '';
        if (text.toLowerCase() === 'add filtered team') continue;
        const rect = option.getBoundingClientRect();

        // Check if this option matches the rep (nickname-aware, by last name) and is visible
        if (nameMatches(text)) {
          if (rect.width > 0 && rect.height > 0 && rect.top > 0) {
            console.log('[Batch] Found rep in dropdown:', text, 'selector:', selector);
            option.click();
            foundAndClicked = true;
            await batchSleep(500);
            break;
          }
        }
      }
    }

    // If still not found, try a more aggressive search for clickable elements with rep name
    if (!foundAndClicked) {
      console.log('[Batch] Searching all visible elements for rep name...');

      // First, look specifically in floating-ui portals (where Roofr renders dropdowns)
      const floatingPortals = document.querySelectorAll('[data-floating-ui-portal], [class*="floating"], [class*="portal"]');
      console.log('[Batch] Found floating portals:', floatingPortals.length);

      for (const portal of floatingPortals) {
        const portalElements = portal.querySelectorAll('div, span, li, label, button');
        for (const el of portalElements) {
          if (el.getAttribute && el.getAttribute('data-testid') === 'calendar-card-add-filtered-team') continue;
          const fullText = el.textContent?.trim() || '';
          const rect = el.getBoundingClientRect();

          if (nameMatches(fullText) &&
            rect.width > 0 && rect.height > 0) {
            console.log('[Batch] Found rep in floating portal:', fullText, 'tag:', el.tagName);

            // If it's a label, try to find and click its associated checkbox or parent clickable
            if (el.tagName === 'LABEL') {
              const forId = el.getAttribute('for');
              if (forId) {
                const checkbox = document.getElementById(forId);
                if (checkbox) {
                  console.log('[Batch] Clicking checkbox for label');
                  checkbox.click();
                  foundAndClicked = true;
                  await batchSleep(500);
                  break;
                }
              }
              // Try clicking parent div which might be the clickable row
              const parentDiv = el.closest('div[class*="item"], div[class*="option"], div[role="option"]') || el.parentElement;
              if (parentDiv && parentDiv !== el) {
                console.log('[Batch] Clicking parent of label:', parentDiv.tagName);
                parentDiv.click();
                foundAndClicked = true;
                await batchSleep(500);
                break;
              }
            }

            el.click();
            foundAndClicked = true;
            await batchSleep(500);
            break;
          }
        }
        if (foundAndClicked) break;
      }
    }

    // SAFETY: do NOT fall back to blind keyboard selection. The invitee
    // dropdown's first item is the "Add filtered team" button, so ArrowDown+Enter
    // would invite the ENTIRE team — this caused the company-wide mass-invite
    // incident (2026-06-03). If we could not positively match the specific rep,
    // abort WITHOUT saving rather than add the wrong person or everyone.
    if (!foundAndClicked) {
      // They may ALREADY be an invitee — Roofr omits existing invitees from the
      // add-list, so "not found" can simply mean "already there". Treat that as
      // success (nothing to add) instead of aborting.
      const alreadyInvitee = Array.from(
        document.querySelectorAll('[data-testid*="calendar-card-invitees-row"], [data-testid*="invitees-row"], [class*="invitee"]')
      ).some(row => nameMatches(row.textContent));
      if (alreadyInvitee) {
        console.log('[Batch] Rep already an invitee on this event — nothing to add.');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        await batchSleep(300);
        return;
      }
      throw new Error(`Could not find rep "${repName}" in the invitee dropdown — aborting without saving (refusing to add the whole team).`);
    }

    // Find and click Save button — only reached when the exact rep was selected.
    await batchSleep(500); // Small wait before looking for save button

    const allButtons = document.querySelectorAll('button');
    console.log('[Batch] Looking for Save button among', allButtons.length, 'buttons');

    const saveButton = Array.from(allButtons)
      .find(btn => btn.textContent?.trim().toLowerCase() === 'save');

    if (saveButton) {
      console.log('[Batch] Found Save button, disabled:', saveButton.disabled);
      if (!saveButton.disabled) {
        console.log('[Batch] Clicking Save button');
        saveButton.click();
        // Wait for save to complete — poll until the edit form/save button disappears
        await waitForEl(() => {
          const stillOpen = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim().toLowerCase() === 'save');
          return stillOpen ? null : document.body; // Returns body (truthy) when save button is gone
        }, { timeout: 10000, message: 'save completion' });
        console.log('[Batch] Save completed');

        // After save, wait for the modal to settle. The popup controller reloads
        // the calendar tab before the next edit; blindly toggling "Select all"
        // here can leave Roofr filtered to an empty/partial team state.
        console.log('[Batch] Save complete — waiting for calendar to settle...');
        await batchSleep(500);
      } else {
        console.warn('[Batch] Save button is disabled - invitee may not be properly selected');
      }
    } else {
      console.warn('[Batch] Save button not found');
      // Debug: list all buttons
      allButtons.forEach((btn, i) => {
        if (i < 10) console.log(`  Button ${i}: "${btn.textContent?.trim().substring(0, 20)}"`);
      });
    }
  }
}

// Detect current calendar view (Monthly, Weekly, Daily, or Agenda)
function getCurrentCalendarView() {
  // Strategy 0: Roofr persists the choice in localStorage. Most reliable.
  try {
    const raw = localStorage.getItem('crm.calendar.view');
    if (raw) {
      const v = JSON.parse(raw);
      if (v === 'agenda' || v === 'week' || v === 'day' || v === 'month') {
        return { agenda: 'agenda', week: 'weekly', day: 'daily', month: 'monthly' }[v];
      }
    }
  } catch (_) {}

  // Strategy 0b: AgendaContainer present in DOM = agenda view, regardless of dropdown text.
  if (document.querySelector('[class*="AgendaContainer"]')) return 'agenda';

  // Strategy 1: Check for dropdown menu text showing current view
  const dropdownBtn = document.querySelector('[class*="dropdown"] button, button[aria-haspopup="listbox"]');
  if (dropdownBtn) {
    const text = dropdownBtn.textContent?.trim().toLowerCase();
    if (text === 'agenda') return 'agenda';
    if (text === 'weekly') return 'weekly';
    if (text === 'monthly') return 'monthly';
    if (text === 'daily') return 'daily';
  }

  // Strategy 2: Look for toolbar buttons with active state
  const toolbarButtons = document.querySelectorAll('.rbc-toolbar button, [class*="toolbar"] button');
  for (const btn of toolbarButtons) {
    const text = btn.textContent?.trim().toLowerCase();
    if ((text === 'week' || text === 'weekly') && (btn.classList.contains('rbc-active') || btn.classList.contains('active') || btn.getAttribute('aria-pressed') === 'true')) {
      return 'weekly';
    }
    if ((text === 'month' || text === 'monthly') && (btn.classList.contains('rbc-active') || btn.classList.contains('active') || btn.getAttribute('aria-pressed') === 'true')) {
      return 'monthly';
    }
    if ((text === 'day' || text === 'daily') && (btn.classList.contains('rbc-active') || btn.classList.contains('active') || btn.getAttribute('aria-pressed') === 'true')) {
      return 'daily';
    }
  }

  // Strategy 3: Infer from DOM structure
  // Weekly view has .rbc-time-view with multiple day columns
  if (document.querySelector('.rbc-time-view .rbc-time-header-content .rbc-header')) {
    const headers = document.querySelectorAll('.rbc-time-header-content .rbc-header');
    if (headers.length >= 7) return 'weekly';
    if (headers.length === 1) return 'daily';
  }

  // Monthly view has .rbc-month-view
  if (document.querySelector('.rbc-month-view')) {
    return 'monthly';
  }

  // Default fallback - check for multiple day backgrounds
  const dayBgs = document.querySelectorAll('.rbc-day-bg');
  if (dayBgs.length > 7) return 'monthly';
  if (dayBgs.length >= 5 && dayBgs.length <= 7) return 'weekly';
  if (dayBgs.length === 1) return 'daily';

  return 'unknown';
}

// Switch to Weekly view
function switchToWeeklyView() {
  // Strategy 1: Look for dropdown button showing Monthly/Daily and click it to open dropdown
  // Based on screenshot: there's a button showing "Monthly" with a chevron, clicking opens Daily/Weekly/Monthly options
  const allButtons = document.querySelectorAll('button');
  for (const btn of allButtons) {
    const text = btn.textContent?.trim().toLowerCase();
    // Find the view selector button (shows current view: monthly, daily, or weekly)
    if (text === 'monthly' || text === 'daily') {
      // This is the view dropdown button, click it to open the menu
      btn.click();
      console.log('[Roofr Extension] Clicked dropdown button:', text);

      // Use multiple attempts with increasing delays to click Weekly option
      setTimeout(() => {
        if (!clickWeeklyOption()) {
          setTimeout(() => {
            if (!clickWeeklyOption()) {
              setTimeout(() => {
                clickWeeklyOption();
              }, 300);
            }
          }, 200);
        }
      }, 100);

      return { ok: true, clicked: true, dropdown: true };
    }
  }

  // Strategy 2: Look for already open dropdown options
  const clicked = clickWeeklyOption();
  if (clicked) {
    return { ok: true, clicked: true };
  }

  // Strategy 3: Look for toolbar view buttons (rbc-toolbar style)
  const toolbarButtons = document.querySelectorAll('.rbc-toolbar button, [class*="toolbar"] button');
  for (const btn of toolbarButtons) {
    const text = btn.textContent?.trim().toLowerCase();
    if (text === 'week' || text === 'weekly') {
      btn.click();
      return { ok: true, clicked: true };
    }
  }

  return { ok: false, clicked: false, reason: 'Could not find Weekly view option' };
}

// Helper to click the Weekly option in an open dropdown
function clickWeeklyOption() {
  console.log('[Roofr Extension] Looking for Weekly option in dropdown...');

  // Strategy 1: Find any visible element containing exactly "Weekly" text
  // Search all elements and find the one that's likely a dropdown option
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    const text = el.textContent?.trim();
    // Check if this element has "Weekly" as its direct/primary text
    if (text === 'Weekly') {
      // Make sure it's visible and clickable
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        console.log('[Roofr Extension] Found Weekly element:', el.tagName, el.className);
        el.click();
        return true;
      }
    }
  }

  // Strategy 2: Look for dropdown menu items/options with various selectors
  const selectors = [
    '[role="option"]',
    '[role="menuitem"]',
    '[role="listbox"] > *',
    'ul li',
    'div[class*="menu"] > div',
    'div[class*="Menu"] > div',
    'div[class*="dropdown"] > div',
    'div[class*="Dropdown"] > div',
    '[class*="option"]',
    '[class*="Option"]',
    '[class*="item"]',
    '[class*="Item"]'
  ];

  for (const selector of selectors) {
    const options = document.querySelectorAll(selector);
    for (const opt of options) {
      const optText = opt.textContent?.trim();
      if (optText === 'Weekly') {
        const rect = opt.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          console.log('[Roofr Extension] Clicked Weekly via selector:', selector);
          opt.click();
          return true;
        }
      }
    }
  }

  // Strategy 3: Try to find by traversing from the open dropdown
  // Look for elements that appeared recently (dropdown menu)
  const possibleMenus = document.querySelectorAll('[class*="menu"], [class*="Menu"], [class*="dropdown"], [class*="Dropdown"], [class*="popover"], [class*="Popover"]');
  for (const menu of possibleMenus) {
    const rect = menu.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      // This menu is visible, look for Weekly inside it
      const children = menu.querySelectorAll('*');
      for (const child of children) {
        if (child.textContent?.trim() === 'Weekly') {
          console.log('[Roofr Extension] Clicked Weekly in menu');
          child.click();
          return true;
        }
      }
    }
  }

  console.log('[Roofr Extension] Could not find Weekly option');
  return false;
}

// Switch to Daily view
// Switch to Agenda view (Roofr's vertical list view that shows the full month).
// Two-pronged approach: write the persisted view to localStorage AND click the
// dropdown option, so it works whether the calendar React state has rendered
// yet or not.
async function switchToAgendaView() {
  console.log('[Roofr Extension] Switching to Agenda view...');

  const currentView = getCurrentCalendarView();
  if (currentView === 'agenda') {
    console.log('[Roofr Extension] Already in Agenda view');
    return { ok: true, clicked: false, alreadyAgenda: true };
  }

  // Persist the choice so Roofr will land on agenda next mount too.
  try { localStorage.setItem('crm.calendar.view', JSON.stringify('agenda')); } catch (_) {}

  // Find the view dropdown button (whatever it currently displays).
  const allButtons = document.querySelectorAll('button');
  for (const btn of allButtons) {
    const text = (btn.textContent || '').trim().toLowerCase();
    if (text.startsWith('weekly') || text.startsWith('monthly') ||
        text.startsWith('daily')  || text.startsWith('agenda')) {
      console.log('[Roofr Extension] Found view dropdown button:', text);
      btn.click();

      for (const delay of [400, 700, 1000]) {
        await new Promise(r => setTimeout(r, delay));
        if (await clickAgendaOption()) {
          await new Promise(r => setTimeout(r, 300));
          return { ok: true, clicked: true };
        }
        // Dropdown might have closed — try re-opening.
        btn.click();
      }
    }
  }

  return { ok: false, error: 'Could not switch to Agenda view' };
}

// Click the "Agenda" item in the open view-switcher dropdown.
async function clickAgendaOption() {
  // Roofr's dropdown items use these class hooks (verified by DOM inspection).
  const selectorBatches = [
    '.roofr-dropdown-item, [class*="roofr-dropdown-item"]',
    'button[class*="WrapperButton"], button[class*="styled__WrapperButton"]',
    '[data-value="agenda"], button[data-value="agenda"]',
    '[role="option"], [role="menuitem"]',
    '[class*="dropdown-item"], [class*="roofr-dropdown"]',
  ];
  for (const sel of selectorBatches) {
    for (const el of document.querySelectorAll(sel)) {
      if ((el.textContent || '').trim() === 'Agenda') {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          console.log('[Roofr Extension] Clicked Agenda via', sel);
          el.click();
          return true;
        }
      }
    }
  }
  return false;
}

async function switchToDailyView() {
  console.log('[Roofr Extension] Switching to Daily view...');

  // Strategy 0: Check if already Daily
  const currentView = getCurrentCalendarView();
  if (currentView === 'daily') {
    console.log('[Roofr Extension] Already in Daily view');
    return { ok: true, clicked: false, alreadyDaily: true };
  }

  // Strategy 1: Look for dropdown button showing "Weekly" or "Monthly" and click to open dropdown
  // The button text might include a chevron character, so check if it starts with or includes the view name
  const allButtons = document.querySelectorAll('button');
  for (const btn of allButtons) {
    const text = btn.textContent?.trim().toLowerCase();
    // Check for "weekly" at start of button text (may have chevron after)
    if (text.startsWith('weekly') || text.startsWith('monthly') || text === 'weekly' || text === 'monthly') {
      console.log('[Roofr Extension] Found view dropdown button with text:', text);
      btn.click();

      // Wait longer for dropdown to open and render (React needs time)
      await new Promise(r => setTimeout(r, 500));

      // Try to click Daily option
      if (await clickDailyOption()) {
        await new Promise(r => setTimeout(r, 300));
        return { ok: true, clicked: true };
      }

      // Retry with longer delay
      await new Promise(r => setTimeout(r, 600));
      if (await clickDailyOption()) {
        await new Promise(r => setTimeout(r, 300));
        return { ok: true, clicked: true };
      }

      // Third attempt - maybe dropdown closed, re-click
      console.log('[Roofr Extension] Re-clicking dropdown button...');
      btn.click();
      await new Promise(r => setTimeout(r, 800));
      if (await clickDailyOption()) {
        await new Promise(r => setTimeout(r, 300));
        return { ok: true, clicked: true };
      }
    }
  }

  return { ok: false, error: 'Could not switch to Daily view' };
}

// Helper to click Daily option in dropdown
async function clickDailyOption() {
  console.log('[Roofr Extension] Looking for Daily option...');

  // Strategy 0: Look for roofr-dropdown-item class with "Daily" text (most specific based on actual DOM)
  const roofDropdownItems = document.querySelectorAll('.roofr-dropdown-item, [class*="roofr-dropdown-item"]');
  console.log('[Roofr Extension] Found roofr-dropdown-item elements:', roofDropdownItems.length);
  for (const item of roofDropdownItems) {
    const text = item.textContent?.trim();
    console.log('[Roofr Extension] Checking dropdown item:', text);
    if (text === 'Daily') {
      const rect = item.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        console.log('[Roofr Extension] Found Daily via roofr-dropdown-item class');
        item.click();
        return true;
      }
    }
  }

  // Strategy 1: Look for styled__WrapperButton with "Daily" text
  const wrapperButtons = document.querySelectorAll('button[class*="WrapperButton"], button[class*="styled__WrapperButton"]');
  console.log('[Roofr Extension] Found WrapperButton elements:', wrapperButtons.length);
  for (const btn of wrapperButtons) {
    const text = btn.textContent?.trim();
    if (text === 'Daily') {
      const rect = btn.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        console.log('[Roofr Extension] Found Daily via WrapperButton class');
        btn.click();
        return true;
      }
    }
  }

  // Strategy 2: Look for Roofr-specific data-value="day" attribute
  const dayValueElements = document.querySelectorAll('[data-value="day"], button[data-value="day"]');
  for (const el of dayValueElements) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      console.log('[Roofr Extension] Found Daily via data-value="day"');
      el.click();
      return true;
    }
  }

  // Strategy 3: Look for dropdown items with dropdown-item class
  const dropdownItems = document.querySelectorAll('[class*="dropdown-item"], [class*="roofr-dropdown"]');
  for (const item of dropdownItems) {
    const text = item.textContent?.trim();
    if (text === 'Daily' || text.toLowerCase() === 'daily') {
      const rect = item.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        console.log('[Roofr Extension] Found Daily via dropdown-item class');
        item.click();
        return true;
      }
    }
  }

  // Strategy 2: Look for visible dropdown/popover containers
  const dropdownContainers = document.querySelectorAll(
    '[class*="dropdown"], [class*="Dropdown"], [class*="popover"], [class*="Popover"], ' +
    '[class*="menu"], [class*="Menu"], [role="listbox"], [role="menu"], [data-testid*="dropdown"]'
  );

  for (const container of dropdownContainers) {
    const rect = container.getBoundingClientRect();
    // Check if this container is visible
    if (rect.width > 0 && rect.height > 0 && rect.top >= 0) {
      // Look for Daily option within this container
      const options = container.querySelectorAll('button, div, span, li, a');
      for (const opt of options) {
        const text = opt.textContent?.trim();
        if (text === 'Daily') {
          const optRect = opt.getBoundingClientRect();
          if (optRect.width > 0 && optRect.height > 0) {
            console.log('[Roofr Extension] Found Daily in dropdown container');
            opt.click();
            return true;
          }
        }
      }
    }
  }

  // Strategy 3: Look for element containing exactly "Daily" text with various selectors
  const selectors = [
    '[role="option"]',
    '[role="menuitem"]',
    'li',
    'div[class*="option"]',
    'div[class*="Option"]',
    'button[class*="WrapperButton"]',
    'button[class*="item"]',
    'button'
  ];

  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      const text = el.textContent?.trim();
      if (text === 'Daily') {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          console.log('[Roofr Extension] Clicked Daily option via selector:', selector);
          el.click();
          return true;
        }
      }
    }
  }

  // Strategy 4: Search all visible elements for exact "Daily" text
  const allElements = document.querySelectorAll('span, div, button, a, li');
  for (const el of allElements) {
    // Check for exact text match (not containing other text)
    const directText = el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE
      ? el.firstChild.textContent?.trim()
      : null;

    if (directText === 'Daily' || el.textContent?.trim() === 'Daily') {
      const rect = el.getBoundingClientRect();
      // Make sure it's visible and reasonably sized (not a huge container)
      if (rect.width > 0 && rect.height > 0 && rect.width < 300 && rect.height < 100) {
        console.log('[Roofr Extension] Clicked Daily via fallback search');
        el.click();
        return true;
      }
    }
  }

  // Strategy 5: Debug - log what elements ARE visible that might be the dropdown
  console.log('[Roofr Extension] DEBUG: Searching for any visible dropdown-like elements...');
  const allVisible = document.querySelectorAll('*');
  for (const el of allVisible) {
    const rect = el.getBoundingClientRect();
    const text = el.textContent?.trim();
    // Look for elements that might contain Daily, Weekly, Monthly options
    if (rect.width > 0 && rect.height > 0 && rect.top > 0 && rect.top < 300) {
      if (text && (text.includes('Daily') || text.includes('Weekly') || text.includes('Monthly'))) {
        if (text.length < 50) { // Only small text elements
          console.log('[Roofr Extension] DEBUG: Found potential element:', {
            tag: el.tagName,
            class: el.className,
            text: text,
            dataValue: el.getAttribute('data-value'),
            rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
          });
        }
      }
    }
  }

  console.log('[Roofr Extension] Could not find Daily option');
  return false;
}

// Click a specific date in the mini calendar date picker
async function clickDateInPicker(day, month, year) {
  console.log(`[Roofr Extension] Clicking date: ${month}/${day}/${year}`);

  // The mini calendar shows a month grid with clickable day numbers
  // First check if we need to navigate to the correct month

  // Find the month/year header in the date picker
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const targetMonth = monthNames[month - 1];
  const targetMonthYear = `${targetMonth} ${year}`;

  // Look for the month header
  let foundCorrectMonth = false;
  const headerElements = document.querySelectorAll('*');
  for (const el of headerElements) {
    const text = el.textContent?.trim();
    if (text === targetMonthYear || text === `${targetMonth} ${year}`) {
      foundCorrectMonth = true;
      break;
    }
  }

  // If not on correct month, we may need to navigate
  // For now, assume we're on the right month (can enhance later)

  // Find and click the day number
  // The date picker has day numbers 1-31 in a grid
  const dayStr = String(day);

  // Look for day cells in the calendar grid
  const dayCells = document.querySelectorAll('button, div[role="button"], td, [class*="day"], [class*="Day"]');

  for (const cell of dayCells) {
    const text = cell.textContent?.trim();
    // Match exact day number (avoid matching "30" when looking for "3")
    if (text === dayStr) {
      // The mini date-picker cells are NOT inside the main react-big-calendar grid.
      // (Older code assumed the picker sat in the left half of the screen; Roofr now
      // renders it in the RIGHT-side panel, so filter by "not in .rbc-*" instead.)
      if (cell.closest('[class*="rbc-"]')) continue;
      const rect = cell.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.width < 60 && rect.height < 60) {
        console.log('[Roofr Extension] Clicking day in mini picker:', day);
        cell.click();
        return { ok: true, clicked: true, day, month, year };
      }
    }
  }

  // Fallback: look for aria-label with date
  const targetDate = new Date(year, month - 1, day);
  const ariaDateStr = targetDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const ariaElements = document.querySelectorAll(`[aria-label*="${day}"], [title*="${day}"]`);
  for (const el of ariaElements) {
    const label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    if (label.includes(String(day)) && label.includes(targetMonth)) {
      el.click();
      console.log('[Roofr Extension] Clicked day via aria-label');
      return { ok: true, clicked: true, day, month, year };
    }
  }

  return { ok: false, error: `Could not find day ${day} in date picker` };
}

// Uncheck all team members (click "Select all" if currently checked to uncheck all)
async function uncheckAllTeamMembers() {
  console.log('[Roofr Extension] Unchecking all team members...');

  // Find the "Select all" checkbox and uncheck it if checked
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    const text = el.textContent?.trim().toLowerCase();
    if (text === 'select all' || text.includes('select all')) {
      const parent = el.closest('label, div, li');
      if (parent) {
        const checkbox = parent.querySelector('input[type="checkbox"]');
        if (checkbox && checkbox.checked) {
          checkbox.click();
          console.log('[Roofr Extension] Unchecked Select all');
          await new Promise(r => setTimeout(r, 100));
          return { ok: true, unchecked: true };
        }

        // Check for custom checkbox
        const customCb = parent.querySelector('[role="checkbox"]');
        if (customCb) {
          const isChecked = customCb.getAttribute('aria-checked') === 'true';
          if (isChecked) {
            customCb.click();
            await new Promise(r => setTimeout(r, 100));
            return { ok: true, unchecked: true };
          }
        }
      }
    }
  }

  // If Select all is already unchecked, we still need to uncheck individual members
  // Find all checked team member checkboxes
  let uncheckedCount = 0;
  const checkboxes = document.querySelectorAll('input[type="checkbox"]:checked');
  for (const cb of checkboxes) {
    const parent = cb.closest('label, div, li');
    if (parent) {
      const text = parent.textContent?.trim();
      // Check if this looks like a person name (two words, capitalized)
      const nameParts = text.split(' ');
      if (nameParts.length >= 2 && nameParts[0].length > 1) {
        cb.click();
        uncheckedCount++;
        await new Promise(r => setTimeout(r, 30));
      }
    }
  }

  return { ok: true, uncheckedCount };
}

// Check specific team members by name (assumes they're currently unchecked)
async function checkTeamMembers(names) {
  console.log('[Roofr Extension] Checking team members:', names);

  if (!names || names.length === 0) {
    return { ok: false, error: 'No names provided' };
  }

  const namesToCheck = new Set(names.map(n => n.trim()));
  const alreadyCheckedNames = new Set(); // Track names we've already clicked
  let checkedCount = 0;

  // Find the Team section first - look for "Team" header or "Select all" near it
  let teamSection = null;
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    const text = el.textContent?.trim();
    if (text === 'Team' && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE') {
      // Found Team header, get its parent container
      teamSection = el.closest('div[class*="sidebar"], div[class*="panel"], aside') || el.parentElement?.parentElement;
      if (teamSection) {
        console.log('[Roofr Extension] Found Team section');
        break;
      }
    }
  }

  // Search within team section if found, otherwise search entire document
  const searchRoot = teamSection || document;

  // Look for checkbox rows - find elements that look like team member rows
  // In Roofr, each team member has a row with checkbox + name
  const rows = searchRoot.querySelectorAll('label, div[class*="row"], div[class*="item"], li');

  for (const row of rows) {
    // Get the direct text or text from a child span/label
    let nameText = '';
    const textEl = row.querySelector('span, label') || row;
    const childText = textEl.childNodes;
    for (const node of childText) {
      if (node.nodeType === Node.TEXT_NODE) {
        nameText = node.textContent?.trim();
        if (nameText) break;
      }
    }
    if (!nameText) {
      nameText = textEl.textContent?.trim();
    }

    // Check if this row contains one of our target names and we haven't clicked it yet
    if (nameText && namesToCheck.has(nameText) && !alreadyCheckedNames.has(nameText)) {
      // Find the checkbox in this row
      const checkbox = row.querySelector('input[type="checkbox"]');
      if (checkbox) {
        if (!checkbox.checked) {
          checkbox.click();
          checkedCount++;
          alreadyCheckedNames.add(nameText);
          console.log('[Roofr Extension] Checked:', nameText);
          await new Promise(r => setTimeout(r, 100));
        } else {
          // Already checked
          alreadyCheckedNames.add(nameText);
        }
        continue;
      }

      // For custom checkboxes, click the row/label itself
      const clickTarget = row.querySelector('[role="checkbox"]') || row;
      // Check if already checked by looking for checked state
      const isChecked = clickTarget.getAttribute('aria-checked') === 'true' ||
        row.querySelector('svg[class*="check"]') !== null ||
        row.classList.contains('checked');

      if (!isChecked) {
        clickTarget.click();
        checkedCount++;
        alreadyCheckedNames.add(nameText);
        console.log('[Roofr Extension] Checked via click:', nameText);
        await new Promise(r => setTimeout(r, 100));
      } else {
        alreadyCheckedNames.add(nameText);
      }
    }
  }

  // Log which names we couldn't find
  const notFound = [...namesToCheck].filter(n => !alreadyCheckedNames.has(n));
  if (notFound.length > 0) {
    console.log('[Roofr Extension] Could not find:', notFound);
  }

  return { ok: true, checkedCount, requested: names.length, found: alreadyCheckedNames.size };
}

// Select Sales event type
// Uncheck the "D2D Sales appointment" sub-filter under Sales. Called AFTER
// selectSalesEventType so the parent Sales group has already checked all
// subtypes — we then turn D2D back off so the scanner doesn't accidentally
// suck in D2D-booked appointments alongside the regular Sales pipeline.
async function uncheckD2DSalesEventType() {
  if (!window.location.pathname.includes('/calendar')) {
    return { ok: false, reason: 'Not on calendar page' };
  }

  const D2D_RE = /^D2D\s+Sales\s+appointment$/i;

  const findD2DCheckbox = () => {
    for (const el of document.querySelectorAll('*')) {
      const direct = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .join('');
      if (D2D_RE.test(direct) || (el.children.length === 0 && D2D_RE.test((el.textContent || '').trim()))) {
        let cur = el;
        for (let i = 0; i < 6; i++) {
          const parent = cur.parentElement;
          if (!parent) break;
          const cb = parent.querySelector('input[type="checkbox"]');
          if (cb) return { label: el, cb, container: parent };
          cur = parent;
        }
      }
    }
    return null;
  };

  // Try expanding the Sales group accordion if D2D isn't visible yet — its
  // sub-checkboxes only mount in the DOM when the group is expanded.
  const expandSalesGroup = () => {
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length === 0 && (el.textContent || '').trim() === 'Sales') {
        // Click the row/header that contains "Sales" to toggle the accordion.
        const expandable = el.closest('[role="button"]')
          || el.closest('[class*="accordion"]')
          || el.closest('[class*="collapse"]')
          || el.closest('[class*="expand"]')
          || el.closest('button')
          || el.parentElement;
        if (expandable) { expandable.click(); return true; }
      }
    }
    return false;
  };

  let found = findD2DCheckbox();
  if (!found) {
    expandSalesGroup();
    // Wait a tick for the accordion to render
    await new Promise(r => setTimeout(r, 200));
    found = findD2DCheckbox();
  }

  if (!found) return { ok: false, reason: 'D2D Sales appointment not found' };

  if (found.cb.checked) {
    found.cb.click();
    return { ok: true, unchecked: true };
  }
  return { ok: true, unchecked: false, wasAlreadyUnchecked: true };
}

function selectSalesEventType() {
  // Only run on calendar pages
  if (!window.location.pathname.includes('/calendar')) {
    return { ok: false, clicked: false, reason: 'Not on calendar page' };
  }

  console.log('[Roofr Extension] Looking for Sales checkbox...');

  // Strategy 1: Look for the sidebar/filter section first to narrow the search
  const filterSection = document.querySelector('.rbc-calendar, [class*="sidebar"], [class*="filter"], [class*="legend"]');
  const searchRoot = filterSection || document.body;

  // Strategy 2: Find the Sales row in Event types section
  // The UI shows colored boxes next to event type names
  // Look for elements that contain "Sales" text and have a checkbox nearby
  const allElements = searchRoot.querySelectorAll('*');

  for (const el of allElements) {
    // Check if this element's direct text content is "Sales"
    const directText = Array.from(el.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent.trim())
      .join('');

    if (directText === 'Sales' || el.textContent?.trim() === 'Sales') {
      // Found Sales label, look for checkbox in parent hierarchy
      let current = el;
      for (let i = 0; i < 5; i++) { // Check up to 5 levels up
        const parent = current.parentElement;
        if (!parent) break;

        // Look for checkbox input
        const checkbox = parent.querySelector('input[type="checkbox"]');
        if (checkbox) {
          const isChecked = checkbox.checked;
          console.log('[Roofr Extension] Found Sales checkbox, checked:', isChecked);
          if (!isChecked) {
            checkbox.click();
            return { ok: true, clicked: true, wasAlreadyChecked: false };
          }
          return { ok: true, clicked: false, wasAlreadyChecked: true };
        }

        // Look for clickable row/container that might toggle the checkbox
        if (parent.classList.contains('cursor-pointer') ||
          parent.style.cursor === 'pointer' ||
          parent.onclick ||
          parent.getAttribute('role') === 'checkbox') {
          // Check if this row has a colored indicator (meaning it's a filter row)
          const hasColorBox = parent.querySelector('[style*="background"]') ||
            parent.querySelector('[class*="color"]') ||
            parent.querySelector('[class*="badge"]');
          if (hasColorBox) {
            console.log('[Roofr Extension] Found Sales row, clicking...');
            parent.click();
            return { ok: true, clicked: true, wasAlreadyChecked: false };
          }
        }

        current = parent;
      }

      // If we found "Sales" but couldn't find checkbox, try clicking the element itself
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        console.log('[Roofr Extension] Clicking Sales element directly');
        el.click();
        return { ok: true, clicked: true, wasAlreadyChecked: false };
      }
    }
  }

  // Strategy 2: Look for checkboxes near "Sales" text in Event types section
  const checkboxes = document.querySelectorAll('input[type="checkbox"]');
  for (const cb of checkboxes) {
    const parent = cb.closest('div, label, li');
    if (parent && parent.textContent?.includes('Sales')) {
      // Make sure it's specifically "Sales" not just contains it
      const text = parent.textContent.trim();
      if (text === 'Sales' || text.startsWith('Sales') || text.endsWith('Sales')) {
        console.log('[Roofr Extension] Found checkbox near Sales text, checked:', cb.checked);
        if (!cb.checked) {
          cb.click();
          return { ok: true, clicked: true, wasAlreadyChecked: false };
        }
        return { ok: true, clicked: false, wasAlreadyChecked: true };
      }
    }
  }

  // Strategy 3: Look for the Event types section and find Sales within it
  const eventTypesSection = Array.from(document.querySelectorAll('*')).find(el =>
    el.textContent?.includes('Event types') && el.textContent?.includes('Sales')
  );

  if (eventTypesSection) {
    // Find all rows/items in this section
    const items = eventTypesSection.querySelectorAll('div, li, label');
    for (const item of items) {
      const itemText = item.textContent?.trim();
      if (itemText === 'Sales') {
        // Try to find and click checkbox
        const cb = item.querySelector('input[type="checkbox"]') ||
          item.closest('label')?.querySelector('input[type="checkbox"]');
        if (cb) {
          if (!cb.checked) {
            cb.click();
            return { ok: true, clicked: true, wasAlreadyChecked: false };
          }
          return { ok: true, clicked: false, wasAlreadyChecked: true };
        }
        // Click the item itself
        item.click();
        return { ok: true, clicked: true };
      }
    }
  }

  console.log('[Roofr Extension] Could not find Sales checkbox');
  return { ok: false, clicked: false, reason: 'Could not find Sales checkbox' };
}

// Helper function to check an event type (make it selected)
function checkEventType(eventTypeName) {
  if (!window.location.pathname.includes('/calendar')) {
    return { ok: false, clicked: false, reason: 'Not on calendar page' };
  }

  console.log(`[Roofr Extension] Looking for ${eventTypeName} checkbox to check...`);

  const filterSection = document.querySelector('.rbc-calendar, [class*="sidebar"], [class*="filter"], [class*="legend"]');
  const searchRoot = filterSection || document.body;
  const allElements = searchRoot.querySelectorAll('*');

  for (const el of allElements) {
    const directText = Array.from(el.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent.trim())
      .join('');

    if (directText === eventTypeName || el.textContent?.trim() === eventTypeName) {
      let current = el;
      for (let i = 0; i < 5; i++) {
        const parent = current.parentElement;
        if (!parent) break;

        const checkbox = parent.querySelector('input[type="checkbox"]');
        if (checkbox) {
          const isChecked = checkbox.checked;
          console.log(`[Roofr Extension] Found ${eventTypeName} checkbox, checked:`, isChecked);
          if (!isChecked) {
            checkbox.click();
            return { ok: true, clicked: true, wasAlreadyChecked: false };
          }
          return { ok: true, clicked: false, wasAlreadyChecked: true };
        }

        if (parent.classList.contains('cursor-pointer') ||
          parent.style.cursor === 'pointer' ||
          parent.onclick ||
          parent.getAttribute('role') === 'checkbox') {
          const hasColorBox = parent.querySelector('[style*="background"]') ||
            parent.querySelector('[class*="color"]') ||
            parent.querySelector('[class*="badge"]');
          if (hasColorBox) {
            console.log(`[Roofr Extension] Found ${eventTypeName} row, clicking...`);
            parent.click();
            return { ok: true, clicked: true, wasAlreadyChecked: false };
          }
        }

        current = parent;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        console.log(`[Roofr Extension] Clicking ${eventTypeName} element directly`);
        el.click();
        return { ok: true, clicked: true, wasAlreadyChecked: false };
      }
    }
  }

  console.log(`[Roofr Extension] Could not find ${eventTypeName} checkbox`);
  return { ok: false, clicked: false, reason: `Could not find ${eventTypeName} checkbox` };
}

// Helper function to uncheck an event type (make it deselected)
function uncheckEventType(eventTypeName) {
  if (!window.location.pathname.includes('/calendar')) {
    return { ok: false, clicked: false, reason: 'Not on calendar page' };
  }

  console.log(`[Roofr Extension] Looking for ${eventTypeName} checkbox to uncheck...`);

  const filterSection = document.querySelector('.rbc-calendar, [class*="sidebar"], [class*="filter"], [class*="legend"]');
  const searchRoot = filterSection || document.body;
  const allElements = searchRoot.querySelectorAll('*');

  for (const el of allElements) {
    const directText = Array.from(el.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent.trim())
      .join('');

    if (directText === eventTypeName || el.textContent?.trim() === eventTypeName) {
      let current = el;
      for (let i = 0; i < 5; i++) {
        const parent = current.parentElement;
        if (!parent) break;

        const checkbox = parent.querySelector('input[type="checkbox"]');
        if (checkbox) {
          const isChecked = checkbox.checked;
          console.log(`[Roofr Extension] Found ${eventTypeName} checkbox, checked:`, isChecked);
          if (isChecked) {
            checkbox.click();
            return { ok: true, clicked: true, wasAlreadyChecked: true };
          }
          return { ok: true, clicked: false, wasAlreadyChecked: false };
        }

        if (parent.classList.contains('cursor-pointer') ||
          parent.style.cursor === 'pointer' ||
          parent.onclick ||
          parent.getAttribute('role') === 'checkbox') {
          const hasColorBox = parent.querySelector('[style*="background"]') ||
            parent.querySelector('[class*="color"]') ||
            parent.querySelector('[class*="badge"]');
          if (hasColorBox) {
            console.log(`[Roofr Extension] Found ${eventTypeName} row, clicking...`);
            parent.click();
            return { ok: true, clicked: true, wasAlreadyChecked: true };
          }
        }

        current = parent;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        console.log(`[Roofr Extension] Clicking ${eventTypeName} element directly`);
        el.click();
        return { ok: true, clicked: true, wasAlreadyChecked: true };
      }
    }
  }

  console.log(`[Roofr Extension] Could not find ${eventTypeName} checkbox`);
  return { ok: false, clicked: false, reason: `Could not find ${eventTypeName} checkbox` };
}

// Select production event types (Dropoffs and pickups, Production, Post-production)
function selectProductionEventTypes() {
  if (!window.location.pathname.includes('/calendar')) {
    return { ok: false, reason: 'Not on calendar page' };
  }

  console.log('[Roofr Extension] Selecting production event types...');

  const eventTypes = ['Dropoffs and pickups', 'Production', 'Post-production'];
  const results = {};

  // Uncheck Sales first
  results.salesUnchecked = uncheckEventType('Sales');

  // Check each production type
  for (const eventType of eventTypes) {
    results[eventType] = checkEventType(eventType);
  }

  console.log('[Roofr Extension] Production event types selection results:', results);
  return { ok: true, results };
}

// --- Robust event-type filter control (verified against Roofr's live DOM 2026-06-03) ---
// Each event-type row in Roofr's calendar filter is a <label> whose text is the type
// name and which CONTAINS its own checkbox. So the correct, unambiguous way to find a
// type's checkbox is: the <label> whose trimmed text === name -> the checkbox inside it.
// (The old walk-up-to-first-ancestor-checkbox approach cross-wired siblings, e.g. it
// toggled "Sales appointment" when asked for "D2D Sales appointment".)
function findEventTypeCheckbox(name) {
  const labels = document.querySelectorAll('label');
  for (const l of labels) {
    if ((l.innerText || '').trim() === name) {
      const cb = l.querySelector('input[type="checkbox"]');
      if (cb) return cb;
    }
  }
  return null;
}

function setEventTypeFilter(name, shouldCheck) {
  const cb = findEventTypeCheckbox(name);
  if (!cb) return { name, ok: false, reason: 'not found' };
  if (cb.checked !== shouldCheck) { cb.click(); return { name, ok: true, changed: true, now: shouldCheck }; }
  return { name, ok: true, changed: false, now: shouldCheck };
}

// Every event type, grouped. Checking a GROUP checkbox cascades to its children
// (verified). The full list is used for a deterministic clean-slate so a profile
// never depends on uncheck-cascade behavior.
const EVENT_TYPE_GROUPS = {
  'Sales': ['Sales appointment', 'Sales followup', 'Self-gen appointment', 'Paint consultation', 'D2D Sales appointment'],
  'General': ['Adjuster meeting'],
  'Dropoffs and pickups': ['Material drop', 'Material pickup', 'ITEL Sample', 'Repair Test'],
  'Production': ['Roof install', 'Roof repair', 'Exterior paint install', 'Solar detach', 'Solar reinstall', 'Tarp'],
  'Post-production': ['Warranty inspection', 'Final walkthrough', 'Go Backs'],
};

// Per-profile desired CHILD event types (the leaf checkboxes that should end up checked).
const PROFILE_TYPES = {
  retail: ['Sales appointment', 'Sales followup', 'Self-gen appointment', 'Paint consultation'],
  d2d: ['D2D Sales appointment'],
  insurance: ['Adjuster meeting'],
  production: [
    'Material drop', 'Material pickup', 'ITEL Sample', 'Repair Test',
    'Roof install', 'Roof repair', 'Exterior paint install', 'Solar detach', 'Solar reinstall', 'Tarp',
    'Warranty inspection', 'Final walkthrough', 'Go Backs',
  ],
};
// Which group checkbox to click first per profile (cascades to children = few clicks).
const PROFILE_GROUPS = {
  retail: ['Sales'],
  d2d: [],
  insurance: ['General'],
  production: ['Dropoffs and pickups', 'Production', 'Post-production'],
};

// Apply a team SCAN PROFILE by driving Roofr's event-type filter checkboxes.
// CLICK-LIGHT to avoid Roofr's re-render storm (many rapid clicks froze it and caused
// late clicks like "Repair Test"/"Go Backs" to be dropped). Strategy:
//   1. Clean slate by unchecking only the 5 GROUP checkboxes (cascades to children).
//   2. Check the profile's group(s) (cascades).
//   3. "Ensure" pass: explicitly check each desired child only if it's NOT already checked
//      (catches any child the cascade missed) — usually 0 extra clicks.
//   4. retail also drops D2D after the Sales group is on.
async function applyScanProfile(profile) {
  if (!window.location.pathname.includes('/calendar')) {
    return { ok: false, reason: 'Not on calendar page' };
  }
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const p = PROFILE_TYPES[profile] ? profile : 'retail';

  // 1. Clean slate — uncheck the 5 groups only (cascades to children; few clicks).
  for (const g of Object.keys(EVENT_TYPE_GROUPS)) setEventTypeFilter(g, false);
  await wait(500);

  // 2. Check the profile's group(s) (cascade).
  for (const g of (PROFILE_GROUPS[p] || [])) setEventTypeFilter(g, true);
  await wait(700);

  // 3. Ensure each desired child is checked (only clicks the ones the cascade missed).
  for (const child of PROFILE_TYPES[p]) {
    const cb = findEventTypeCheckbox(child);
    if (cb && !cb.checked) { cb.click(); await wait(120); }
  }

  // 4. retail: drop D2D (the Sales group cascade turned it on).
  if (p === 'retail') { await wait(150); setEventTypeFilter('D2D Sales appointment', false); }

  await wait(300);
  return { ok: true, profile: p };
}

// Select ONLY the given team members (by name): deselect everyone via the "Select all"
// master, then check just the named people. Robust + click-light vs toggling each of the
// ~100 non-members. Each team row is a <label> (text=name) with its checkbox inside.
async function selectOnlyTeamMembers(names) {
  if (!window.location.pathname.includes('/calendar')) {
    return { ok: false, reason: 'Not on calendar page' };
  }
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  // Case-insensitive match: the roster sheet's casing can differ from Roofr's team list
  // (e.g. sheet "Robert Mcpherson" vs Roofr "Robert McPherson").
  const norm = (s) => (s || '').trim().toLowerCase();
  const labelCb = (t) => {
    const tn = norm(t);
    const l = Array.from(document.querySelectorAll('label')).find(x => norm(x.innerText) === tn);
    return l ? l.querySelector('input[type="checkbox"]') : null;
  };
  // Force "Select all" through a known cycle so EVERYONE ends up deselected, regardless
  // of starting state (checked / unchecked / indeterminate).
  const selAll = labelCb('Select all');
  if (selAll) {
    if (!selAll.checked) { selAll.click(); await wait(350); }  // -> all checked
    selAll.click(); await wait(500);                            // -> all unchecked
  }
  // Check just the requested people.
  let selected = 0;
  const want = [...new Set((names || []).map(n => n.trim()).filter(Boolean))];
  for (const n of want) {
    const cb = labelCb(n);
    if (cb) { if (!cb.checked) { cb.click(); await wait(90); } selected++; }
  }
  return { ok: true, selected, requested: want.length };
}

// Robust calendar VIEW switch (verified). Roofr's view selector is a dropdown button
// whose text IS the current view (Agenda / Weekly / Monthly / Daily). Click it to open,
// then click the option matching the target. Also writes localStorage as a backup.
// target: 'agenda' | 'weekly' | 'daily' | 'monthly'
async function switchCalendarView(target) {
  if (!window.location.pathname.includes('/calendar')) {
    return { ok: false, reason: 'Not on calendar page' };
  }
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const DISPLAY = { agenda: 'Agenda', weekly: 'Weekly', daily: 'Daily', monthly: 'Monthly' };
  const LS = { agenda: 'agenda', weekly: 'week', daily: 'day', monthly: 'month' };
  const want = DISPLAY[target] || 'Agenda';

  // Already on it?
  if (getCurrentCalendarView() === target) return { ok: true, alreadyOn: true };

  // Backup: persist the choice so React picks it up even if the click misses.
  try { localStorage.setItem('crm.calendar.view', JSON.stringify(LS[target] || 'agenda')); } catch (_) {}

  // Open the dropdown: the button whose text is the CURRENT view name.
  const viewNames = ['Agenda', 'Weekly', 'Monthly', 'Daily'];
  const dropdownBtn = Array.from(document.querySelectorAll('button'))
    .find(b => viewNames.includes((b.textContent || '').trim()));
  if (!dropdownBtn) return { ok: false, reason: 'view dropdown button not found' };
  if ((dropdownBtn.textContent || '').trim() === want) return { ok: true, alreadyOn: true };
  dropdownBtn.click();
  await wait(350);

  // Click the option matching the target view.
  const opt = Array.from(document.querySelectorAll('[role="option"],[role="menuitem"],li,div,span'))
    .find(e => e.children.length === 0 && (e.textContent || '').trim() === want && e.getBoundingClientRect().width > 0);
  if (opt) { opt.click(); return { ok: true, switchedTo: target }; }
  return { ok: false, reason: `${want} option not found in dropdown` };
}

// Select all team members
function selectAllTeamMembers() {
  const isCheckedLike = (el) => {
    if (!el) return null;
    const ariaChecked = el.getAttribute?.('aria-checked');
    if (ariaChecked === 'true') return true;
    if (ariaChecked === 'false') return false;
    const ariaPressed = el.getAttribute?.('aria-pressed');
    if (ariaPressed === 'true') return true;
    if (ariaPressed === 'false') return false;
    const dataState = el.getAttribute?.('data-state') || el.dataset?.state;
    if (dataState === 'checked' || dataState === 'selected') return true;
    if (dataState === 'unchecked' || dataState === 'unselected') return false;
    if (el.classList?.contains('checked') || el.classList?.contains('selected')) return true;
    const nestedChecked = el.querySelector?.('input[type="checkbox"]:checked, [aria-checked="true"], [data-state="checked"]');
    if (nestedChecked) return true;
    const nestedUnchecked = el.querySelector?.('input[type="checkbox"]:not(:checked), [aria-checked="false"], [data-state="unchecked"]');
    if (nestedUnchecked) return false;
    return null;
  };

  // Look for "Select all" checkbox/button in Team section
  const selectAllLabels = document.querySelectorAll('label, span, div, button');

  for (const el of selectAllLabels) {
    const text = el.textContent?.trim().toLowerCase();
    if (text === 'select all' || text.includes('select all')) {
      // Found Select all, click it
      const parent = el.closest('label, div, li, button');
      if (parent) {
        let checkbox = parent.querySelector('input[type="checkbox"]');
        if (checkbox) {
          if (!checkbox.checked) {
            checkbox.click();
            return { ok: true, clicked: true, wasAlreadyChecked: false };
          }
          return { ok: true, clicked: false, wasAlreadyChecked: true };
        }

        // Try clicking the element directly (could be a button or custom checkbox)
        const clickable = parent.querySelector('[role="checkbox"]') || el;
        const checkedState = isCheckedLike(clickable) ?? isCheckedLike(parent);
        if (checkedState === true) {
          return { ok: true, clicked: false, wasAlreadyChecked: true };
        }
        clickable.click();
        return { ok: true, clicked: true, wasAlreadyChecked: false, checkedState };
      }

      const checkedState = isCheckedLike(el);
      if (checkedState === true) {
        return { ok: true, clicked: false, wasAlreadyChecked: true };
      }
      el.click();
      return { ok: true, clicked: true, wasAlreadyChecked: false, checkedState };
    }
  }

  // Fallback: look for checkbox by aria-label or data attribute
  const selectAllCheckbox = document.querySelector('[aria-label*="select all" i], [data-testid*="select-all"]');
  if (selectAllCheckbox) {
    const checkedState = isCheckedLike(selectAllCheckbox);
    if (checkedState === true) {
      return { ok: true, clicked: false, wasAlreadyChecked: true };
    }
    selectAllCheckbox.click();
    return { ok: true, clicked: true, wasAlreadyChecked: false, checkedState };
  }

  return { ok: false, clicked: false, reason: 'Could not find Select all option' };
}

// Select specific team members by name (uncheck all others first)
async function selectSpecificTeamMembers(names) {
  console.log('[Roofr Extension] Selecting specific team members:', names);

  if (!names || names.length === 0) {
    return { ok: false, error: 'No names provided' };
  }

  const namesToSelect = new Set(names.map(n => n.trim()));
  let selectedCount = 0;
  let processedCount = 0;

  // Find all team member checkboxes by looking for labels/spans with names
  const allLabels = document.querySelectorAll('label, span, div');
  const teamMemberElements = [];

  for (const label of allLabels) {
    const text = label.textContent?.trim();
    // Skip if it's not a person name (basic heuristic: contains space, not too long, no special chars)
    if (!text || text.length > 50 || text.includes('Select all') || text.includes(':')) continue;

    // Check if this could be a team member name (has first and last name pattern)
    const nameParts = text.split(' ');
    if (nameParts.length >= 2 && nameParts.every(p => p.length >= 2 && /^[A-Z][a-z]+$/.test(p))) {
      const parent = label.closest('label, div[role="option"], div[class*="checkbox"], li');
      if (parent) {
        // Look for checkbox
        const checkbox = parent.querySelector('input[type="checkbox"]');
        const clickable = checkbox || parent.querySelector('[role="checkbox"]') || parent;

        if (clickable) {
          teamMemberElements.push({
            name: text,
            element: clickable,
            checkbox: checkbox,
            parent: parent
          });
        }
      }
    }
  }

  console.log(`[Roofr Extension] Found ${teamMemberElements.length} team member elements`);

  // Process each team member: check if in our list, set accordingly
  for (const member of teamMemberElements) {
    const shouldBeSelected = namesToSelect.has(member.name);
    let isCurrentlyChecked = false;

    if (member.checkbox) {
      isCurrentlyChecked = member.checkbox.checked;
    } else {
      // Check for custom checkbox state
      isCurrentlyChecked = member.element.getAttribute('aria-checked') === 'true' ||
        member.parent.classList.contains('checked') ||
        member.parent.querySelector('svg[class*="check"]') !== null;
    }

    if (shouldBeSelected !== isCurrentlyChecked) {
      // Need to toggle
      if (member.checkbox) {
        member.checkbox.click();
      } else {
        member.element.click();
      }
      processedCount++;

      // Small delay between clicks to avoid UI issues
      await new Promise(r => setTimeout(r, 50));
    }

    if (shouldBeSelected) {
      selectedCount++;
    }
  }

  console.log(`[Roofr Extension] Selected ${selectedCount} members, toggled ${processedCount}`);
  return { ok: true, selectedCount, processedCount };
}

// Toggle a team member checkbox in the Roofr calendar sidebar
function toggleTeamCheckbox(name) {
  // Look for the Team section - find checkboxes/labels containing the name
  // The team list has checkboxes with labels like "Travis Jones", "Aaron Munz", etc.

  // First, find the Team section to narrow our search (avoid matching name in job cards elsewhere)
  let teamSection = null;
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    const text = el.textContent?.trim();
    // Look for "Team" header or team-related section identifiers
    if ((text === 'Team' || text === 'Select all' || text.startsWith('Team ')) &&
        el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE') {
      // Found Team header, get its parent container
      teamSection = el.closest('div[class*="sidebar"], div[class*="panel"], div[class*="filter"], aside, section') ||
                    el.parentElement?.parentElement?.parentElement;
      if (teamSection) {
        console.log('[Roofr Extension] Found Team section for checkbox toggle');
        break;
      }
    }
  }

  // Search within team section if found, otherwise fall back to entire document
  const searchRoot = teamSection || document;
  const nameLower = name.toLowerCase();

  // Try finding by label text within the team section (case-insensitive)
  const labels = searchRoot.querySelectorAll('label, span, div');
  for (const label of labels) {
    const text = label.textContent?.trim();
    if (text && text.toLowerCase() === nameLower) {
      // Found the label, look for associated checkbox
      // Could be a sibling, parent's sibling, or nearby input
      const parent = label.closest('label, div, li');
      if (parent) {
        // Look for checkbox input
        let checkbox = parent.querySelector('input[type="checkbox"]');

        // If no checkbox found, the label itself might be clickable
        if (!checkbox) {
          // Try clicking the parent or label directly (some UI libraries use custom checkboxes)
          const clickable = parent.querySelector('[role="checkbox"], [data-testid*="checkbox"]') || parent;
          if (clickable) {
            clickable.click();
            // Check if there's an aria-checked attribute to determine state
            const isChecked = clickable.getAttribute('aria-checked') === 'true' ||
              clickable.classList.contains('checked') ||
              clickable.querySelector('svg'); // Often checked state shows an SVG icon
            return { ok: true, toggled: true, checked: isChecked, name };
          }
        }

        if (checkbox) {
          checkbox.click();
          return { ok: true, toggled: true, checked: checkbox.checked, name };
        }
      }

      // Try clicking the label directly
      label.click();
      return { ok: true, toggled: true, checked: null, name };
    }
  }

  // Fallback: search for checkbox by nearby text content within team section (case-insensitive)
  const checkboxes = searchRoot.querySelectorAll('input[type="checkbox"]');
  for (const cb of checkboxes) {
    const parent = cb.closest('label, div, li, tr');
    if (parent && parent.textContent?.toLowerCase().includes(nameLower)) {
      cb.click();
      return { ok: true, toggled: true, checked: cb.checked, name };
    }
  }

  // Try finding custom checkbox components (React/styled-components) within team section (case-insensitive)
  const customCheckboxes = searchRoot.querySelectorAll('[role="checkbox"], [data-testid*="team"], [class*="checkbox"]');
  for (const el of customCheckboxes) {
    const parent = el.closest('div, label, li');
    if (parent && parent.textContent?.toLowerCase().includes(nameLower)) {
      el.click();
      const isChecked = el.getAttribute('aria-checked') === 'true';
      return { ok: true, toggled: true, checked: isChecked, name };
    }
  }

  // Last resort: search entire document if team section search failed (case-insensitive)
  if (teamSection) {
    console.log('[Roofr Extension] Team section search failed, trying full document for:', name);
    const allLabels = document.querySelectorAll('label, span, div');
    for (const label of allLabels) {
      const text = label.textContent?.trim();
      if (text && text.toLowerCase() === nameLower) {
        const parent = label.closest('label, div, li');
        if (parent) {
          let checkbox = parent.querySelector('input[type="checkbox"]');
          if (checkbox) {
            checkbox.click();
            return { ok: true, toggled: true, checked: checkbox.checked, name };
          }
          const clickable = parent.querySelector('[role="checkbox"]') || parent;
          if (clickable) {
            clickable.click();
            return { ok: true, toggled: true, checked: null, name };
          }
        }
        label.click();
        return { ok: true, toggled: true, checked: null, name };
      }
    }
  }

  return { ok: false, toggled: false, name };
}

// ==================================================
// END: Roofr page bridge
// ==================================================


// ==================================================
// START: Roofr Job Card Automation (for /jobs pages)
// ==================================================
// Guard to prevent duplicate declarations when script is re-injected
if (typeof window.__roofrJobVarsInitialized === 'undefined') {
  window.__roofrJobVarsInitialized = true;

  // Check for various job page URL patterns:
  // - /jobs (list view)
  // - /jobs/ (with trailing slash)
  // - /jobs/list-view
  // - /job/ (single job view)
  // - Any page with selectedJobId parameter
  // - Any roofr.com page (we'll initialize anyway for injected scripts)
  window.__isRoofrDomain = window.location.hostname.includes('roofr.com');
  window.__hasJobInPath = window.location.pathname.includes('/jobs') ||
    window.location.pathname.includes('/job/') ||
    window.location.pathname.includes('/job');
  window.__hasJobIdParam = window.location.search.includes('selectedJobId=');
  window.__isRoofrJobPage = window.__isRoofrDomain && (window.__hasJobInPath || window.__hasJobIdParam);

  console.log('[Roofr Automation] URL check:', {
    hostname: window.location.hostname,
    pathname: window.location.pathname,
    search: window.location.search,
    isRoofrDomain: window.__isRoofrDomain,
    hasJobInPath: window.__hasJobInPath,
    hasJobIdParam: window.__hasJobIdParam,
    isRoofrJobPage: window.__isRoofrJobPage,
    alreadyLoaded: window.__roofrJobAutomationLoaded
  });
}

if (window.__isRoofrJobPage && !window.__roofrJobAutomationLoaded) {
  window.__roofrJobAutomationLoaded = true;
  console.log('[Roofr Automation] Job automation script loaded on:', window.location.href);

  // Helper to wait for element to appear
  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) {
        resolve(el);
        return;
      }
      const observer = new MutationObserver((mutations, obs) => {
        const el = document.querySelector(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for ${selector}`));
      }, timeout);
    });
  }

  // Helper to wait for element with text
  function waitForElementWithText(selector, text, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          if (el.textContent?.trim().toLowerCase().includes(text.toLowerCase())) {
            return el;
          }
        }
        return null;
      };
      const el = check();
      if (el) {
        resolve(el);
        return;
      }
      const observer = new MutationObserver((mutations, obs) => {
        const el = check();
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for ${selector} with text "${text}"`));
      }, timeout);
    });
  }

  // Helper to sleep
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Step 1: Select a rep from Job owner dropdown
  async function selectJobOwner(repName) {
    console.log('[Roofr Automation] Selecting job owner:', repName);

    // Retry logic - wait for dropdown to become available
    let dropdownTrigger = null;
    let jobOwnerSection = null;
    const maxRetries = 15; // Increased from 10
    const retryDelay = 1500; // Increased from 1000ms

    for (let retry = 0; retry < maxRetries; retry++) {
      // Find the Job owner dropdown - look for the label first
      const labels = document.querySelectorAll('label, span, div');
      dropdownTrigger = null;
      jobOwnerSection = null;

      for (const label of labels) {
        const labelText = label.textContent?.trim();
        if (labelText === 'Job owner' || labelText === 'Job owner ⓘ') {
          // Found the label, look for the dropdown nearby
          jobOwnerSection = label.closest('div')?.parentElement || label.closest('div');
          console.log('[Roofr Automation] Found Job owner label');
          break;
        }
      }

      if (jobOwnerSection) {
        // Look for a button or combobox-like element
        dropdownTrigger = jobOwnerSection.querySelector('button[type="button"], [role="combobox"], [class*="trigger"], [class*="select"]');

        if (!dropdownTrigger) {
          const candidates = jobOwnerSection.querySelectorAll('button, [role="button"], [tabindex]');
          for (const c of candidates) {
            const text = c.textContent?.trim() || '';
            // Match: "Unassigned", names like "Travis Jones", "Select", etc.
            if (text && (text.includes('Unassigned') || /^[A-Z][a-z]+ [A-Z]/.test(text) || text === 'Select' || text.length > 0)) {
              // Make sure it's not the info icon or label itself
              if (!text.includes('ⓘ') && !text.includes('Job owner') && c.tagName === 'BUTTON') {
                dropdownTrigger = c;
                break;
              }
            }
          }
        }

        // Additional fallback: look for any clickable element that looks like a dropdown
        if (!dropdownTrigger) {
          const allClickables = jobOwnerSection.querySelectorAll('button, [role="combobox"], [aria-haspopup]');
          for (const el of allClickables) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 50 && rect.height > 20) { // Must be reasonably sized
              dropdownTrigger = el;
              console.log('[Roofr Automation] Found dropdown via fallback search');
              break;
            }
          }
        }
      }

      if (dropdownTrigger) {
        const rect = dropdownTrigger.getBoundingClientRect();
        console.log(`[Roofr Automation] Found dropdown on attempt ${retry + 1}, size: ${rect.width}x${rect.height}, text: "${dropdownTrigger.textContent?.trim().substring(0, 30)}"`);
        break;
      }

      console.log(`[Roofr Automation] Waiting for Job owner dropdown... attempt ${retry + 1}/${maxRetries}`);

      // Log what we can see for debugging
      if (retry === 5 || retry === 10) {
        console.log('[Roofr Automation] Debug - Page state:');
        console.log('  URL:', window.location.href);
        console.log('  Job owner section found:', !!jobOwnerSection);
        if (jobOwnerSection) {
          console.log('  Section HTML preview:', jobOwnerSection.innerHTML?.substring(0, 200));
        }
      }

      await sleep(retryDelay);
    }

    // If still not found after retries, try fallback methods
    if (!dropdownTrigger) {
      console.log('[Roofr Automation] Trying fallback methods to find dropdown...');

      // Fallback 1: find dropdown with current rep name or "Unassigned"
      const allDropdowns = document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"], [class*="select-trigger"]');
      for (const dd of allDropdowns) {
        const text = dd.textContent?.trim();
        if (text === 'Unassigned' || text.includes('Select') || dd.closest('[class*="job-owner"]')) {
          dropdownTrigger = dd;
          console.log('[Roofr Automation] Found dropdown via fallback 1');
          break;
        }
      }
    }

    if (!dropdownTrigger) {
      // Fallback 2: Try to find by data-testid or name/id
      dropdownTrigger = document.querySelector('[data-testid*="job-owner"]') ||
        document.querySelector('[name*="owner"]') ||
        document.querySelector('[id*="owner"]');
      if (dropdownTrigger) {
        console.log('[Roofr Automation] Found dropdown via data-testid/name/id');
      }
    }

    if (!dropdownTrigger) {
      // Fallback 3: Look for any button in the sidebar that has a person's name or "Unassigned"
      console.log('[Roofr Automation] Trying sidebar button fallback...');
      const sidebar = document.querySelector('[class*="sidebar"], [class*="panel"], [class*="drawer"]');
      if (sidebar) {
        const buttons = sidebar.querySelectorAll('button');
        for (const btn of buttons) {
          const text = btn.textContent?.trim() || '';
          // Check if it looks like a name (First Last format) or "Unassigned"
          if ((text === 'Unassigned' || /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(text)) &&
            !text.includes('Save') && !text.includes('Cancel')) {
            dropdownTrigger = btn;
            console.log('[Roofr Automation] Found dropdown via sidebar fallback:', text);
            break;
          }
        }
      }
    }

    if (!dropdownTrigger) {
      // Fallback 4: Log the entire job panel structure for debugging
      console.log('[Roofr Automation] DEBUG - Could not find dropdown. Logging page structure...');
      const panels = document.querySelectorAll('[class*="panel"], [class*="Panel"], [class*="sidebar"], [class*="Sidebar"], [class*="drawer"], [class*="Drawer"]');
      panels.forEach((panel, i) => {
        console.log(`Panel ${i}: class="${panel.className?.substring(0, 80)}"`);
        const buttons = panel.querySelectorAll('button');
        buttons.forEach((btn, j) => {
          if (j < 10) {
            console.log(`  Button ${j}: "${btn.textContent?.trim().substring(0, 40)}"`);
          }
        });
      });

      throw new Error('Could not find Job owner dropdown');
    }

    console.log('[Roofr Automation] Clicking dropdown trigger');

    // Click to open the dropdown
    dropdownTrigger.click();
    await sleep(1000); // Increased wait for dropdown to render

    // Find the dropdown options - Roofr uses styled-components with class names like "styled__Container-hwOSnb"
    // Look for the container that has the dropdown options
    let optionsContainer = document.querySelector('[class*="Container-hwOSnb"], [class*="styled__Container"], [role="listbox"], [data-radix-popper-content-wrapper], [class*="dropdown-menu"], [class*="popover"], [class*="menu-list"]');

    console.log('[Roofr Automation] Options container found:', !!optionsContainer, optionsContainer?.className);

    // If no container found, search in the whole document
    if (!optionsContainer) {
      optionsContainer = document;
    }

    // First, try to find by data-testid which has the manager name
    const targetTestId = `[data-testid="job-owner-select-manager-${repName}"]`;
    let targetOption = document.querySelector(targetTestId);
    if (targetOption) {
      console.log('[Roofr Automation] Found option by data-testid:', targetTestId);
      // Click the parent label element that contains the checkbox
      const clickableElement = targetOption.closest('label') || targetOption;
      clickableElement.click();
      console.log('[Roofr Automation] Selected rep via data-testid:', repName);
      await sleep(300);
      return { ok: true, selected: repName };
    }

    // Find and click the rep option - try multiple selector patterns for Roofr's styled components
    const selectors = [
      '[data-testid*="job-owner-select-manager"]', // Roofr specific
      '[class*="Content-hRA"]', // Roofr styled component for option text
      '[class*="styled__Content"]', // Alternative styled component pattern
      'label[for*="dropdown-control"]', // Labels wrapping checkboxes
      '[role="option"]',
      '[role="menuitem"]',
      '[class*="option"]',
      '[class*="menu-item"]',
      '[class*="dropdown-item"]',
      '[class*="list-item"]',
      'li'
    ];

    let options = [];
    for (const selector of selectors) {
      const found = document.querySelectorAll(selector); // Search whole document since dropdown may be in portal
      if (found.length > 0) {
        options = [...options, ...found];
      }
    }

    // Remove duplicates
    options = [...new Set(options)];

    console.log('[Roofr Automation] Found', options.length, 'options in dropdown');

    // Log first few options for debugging
    const optionTexts = options.slice(0, 15).map(o => o.textContent?.trim()).filter(Boolean);
    console.log('[Roofr Automation] Sample options:', optionTexts);

    // First try exact match
    for (const opt of options) {
      const optText = opt.textContent?.trim();
      if (optText === repName) {
        // Click the label or parent clickable element
        const clickable = opt.closest('label') || opt;
        clickable.click();
        console.log('[Roofr Automation] Selected rep:', repName);
        await sleep(300);
        return { ok: true, selected: repName };
      }
    }

    // If exact match not found, try partial match
    for (const opt of options) {
      const optText = opt.textContent?.trim();
      if (optText && optText.toLowerCase().includes(repName.toLowerCase())) {
        const clickable = opt.closest('label') || opt;
        clickable.click();
        console.log('[Roofr Automation] Selected rep (partial match):', optText);
        await sleep(300);
        return { ok: true, selected: optText };
      }
    }

    // Nickname-aware match: the schedule/CSR list uses nicknames (e.g. "Madi
    // Meyers") but Roofr stores the legal name ("Madison Meyers"). Match by
    // first-name prefix + last name so the owner step works for nicknamed reps.
    {
      const tks = repName.trim().split(/\s+/);
      const wf = (tks[0] || '').toLowerCase();
      const wl = (tks[tks.length - 1] || '').toLowerCase();
      for (const opt of options) {
        const optText = (opt.textContent || '').trim();
        const w = optText.toLowerCase().split(/\s+/);
        const first = w[0] || '', last = w[w.length - 1] || '';
        const firstOk = !!wf && (first.startsWith(wf) || wf.startsWith(first));
        const lastOk = !!wl && (last === wl || last.startsWith(wl) || wl.startsWith(last));
        if (firstOk && lastOk) {
          const clickable = opt.closest('label') || opt;
          clickable.click();
          console.log('[Roofr Automation] Selected rep (nickname match):', optText, 'for', repName);
          await sleep(300);
          return { ok: true, selected: optText };
        }
      }
    }

    // Try scrolling through the dropdown to find the option
    console.log('[Roofr Automation] Trying to scroll through dropdown to find rep...');
    const scrollContainer = document.querySelector('[class*="Container-hwOSnb"]') || optionsContainer.querySelector('[class*="scroll"], [style*="overflow"]') || optionsContainer;
    if (scrollContainer && scrollContainer !== document) {
      console.log('[Roofr Automation] Scrolling in container:', scrollContainer.className);
      // Scroll down in increments and check for the option
      for (let i = 0; i < 10; i++) {
        scrollContainer.scrollTop += 200;
        await sleep(200);

        // Re-search for the option after scrolling
        const targetAfterScroll = document.querySelector(targetTestId);
        if (targetAfterScroll) {
          const clickable = targetAfterScroll.closest('label') || targetAfterScroll;
          clickable.click();
          console.log('[Roofr Automation] Selected rep after scrolling via data-testid:', repName);
          await sleep(300);
          return { ok: true, selected: repName };
        }

        const newOptions = document.querySelectorAll(selectors.join(', '));
        for (const opt of newOptions) {
          const optText = opt.textContent?.trim();
          if (optText === repName || (optText && optText.toLowerCase().includes(repName.toLowerCase()))) {
            const clickable = opt.closest('label') || opt;
            clickable.click();
            console.log('[Roofr Automation] Selected rep after scrolling:', optText);
            await sleep(300);
            return { ok: true, selected: optText };
          }
        }
      }
    }

    throw new Error(`Could not find rep "${repName}" in dropdown. Available options: ${optionTexts.join(', ')}`);
  }

  // Step 2: Click Measurements tab (on the job card, not the sidebar)
  async function clickMeasurementsTab() {
    console.log('[Roofr Automation] Clicking Measurements tab on job card');

    // First, try to find the Measurements tab specifically on the job card using data-value attribute
    // The job card tabs have: class="roofr-tabs-item" data-value="measurements"
    let measurementsTab = document.querySelector('button.roofr-tabs-item[data-value="measurements"]');

    if (measurementsTab) {
      console.log('[Roofr Automation] Found Measurements tab by data-value attribute');
      measurementsTab.click();
      await sleep(500);
      return { ok: true };
    }

    // Alternative: look for button with data-identity="tabs-item" and data-value="measurements"
    measurementsTab = document.querySelector('[data-identity="tabs-item"][data-value="measurements"]');
    if (measurementsTab) {
      console.log('[Roofr Automation] Found Measurements tab by data-identity');
      measurementsTab.click();
      await sleep(500);
      return { ok: true };
    }

    // Fallback: Find within the job detail panel/card area (not the sidebar)
    // The job card is usually in a modal or panel with specific class
    const jobDetailPanel = document.querySelector('[class*="job-detail"], [class*="JobDetail"], [class*="modal"], [class*="panel"], [class*="drawer"]');
    if (jobDetailPanel) {
      const tabsInPanel = jobDetailPanel.querySelectorAll('button, [role="tab"]');
      for (const tab of tabsInPanel) {
        if (tab.textContent?.trim() === 'Measurements') {
          console.log('[Roofr Automation] Found Measurements tab within job panel');
          tab.click();
          await sleep(500);
          return { ok: true };
        }
      }
    }

    // Another fallback: look for roofr-tabs container and find Measurements within it
    const tabsContainer = document.querySelector('.roofr-tabs, [class*="roofr-tabs"], [class*="tabs-content"]');
    if (tabsContainer) {
      const tabsInContainer = tabsContainer.querySelectorAll('button, [role="tab"]');
      for (const tab of tabsInContainer) {
        if (tab.textContent?.trim() === 'Measurements') {
          console.log('[Roofr Automation] Found Measurements tab within tabs container');
          tab.click();
          await sleep(500);
          return { ok: true };
        }
      }
    }

    // Last resort: Find all Measurements buttons but avoid sidebar navigation
    // Sidebar nav items usually have different classes or are within nav elements
    const allTabs = document.querySelectorAll('button, [role="tab"]');
    for (const tab of allTabs) {
      if (tab.textContent?.trim() === 'Measurements') {
        // Skip if this is in the sidebar navigation
        const isInSidebar = tab.closest('nav, [class*="sidebar"], [class*="navigation"], [class*="menu-list"]');
        if (!isInSidebar) {
          console.log('[Roofr Automation] Found Measurements tab (not in sidebar)');
          tab.click();
          await sleep(500);
          return { ok: true };
        }
      }
    }

    throw new Error('Could not find Measurements tab on job card');
  }

  // Step 3: Click "Roofr report" button
  async function clickRoofrReportButton() {
    console.log('[Roofr Automation] Clicking Roofr report button');

    // Wait for the button to appear
    await sleep(500);

    const buttons = document.querySelectorAll('button, a');
    for (const btn of buttons) {
      const text = btn.textContent?.trim();
      if (text === 'Roofr report' || text?.includes('Roofr report')) {
        btn.click();
        console.log('[Roofr Automation] Clicked Roofr report button');
        await sleep(1000);
        return { ok: true };
      }
    }
    throw new Error('Could not find Roofr report button');
  }

  // Step 4: Click Confirm on map page
  async function clickConfirmOnMap() {
    console.log('[Roofr Automation] Waiting for Confirm button on map');

    // Wait for the map page to load
    await sleep(2000);

    // Note: We don't try to detect if a building exists because:
    // 1. Roofr relies on visual satellite imagery - there's no programmatic indicator
    // 2. The "1" marker only appears for multi-building selection, not as a building detector
    // 3. If the location is empty land, Roofr will show its own error after confirmation
    // This matches the same behavior as clicking manually

    // Look for Confirm button
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent?.trim() === 'Confirm') {
        btn.click();
        console.log('[Roofr Automation] Clicked Confirm button');
        await sleep(1000);
        return { ok: true };
      }
    }
    throw new Error('Could not find Confirm button');
  }

  // Step 5: Select "All" for secondary structures and click Next
  async function selectAllSecondaryStructures() {
    console.log('[Roofr Automation] Selecting All for secondary structures');

    // Wait longer for the modal/page to appear after map confirmation
    await sleep(2000);

    // Try multiple times to find the buttons (in case page is still loading)
    for (let attempt = 0; attempt < 5; attempt++) {
      console.log(`[Roofr Automation] Attempt ${attempt + 1} to find All/Next buttons`);

      // Re-query buttons each attempt
      const buttons = document.querySelectorAll('button');
      console.log(`[Roofr Automation] Found ${buttons.length} buttons on page`);

      // Find and click "All" button if present
      for (const btn of buttons) {
        const btnText = btn.textContent?.trim();
        if (btnText === 'All') {
          btn.click();
          console.log('[Roofr Automation] Clicked All button');
          await sleep(500);
          break;
        }
      }

      // Find and click "Next" button
      for (const btn of buttons) {
        const btnText = btn.textContent?.trim();
        if (btnText === 'Next') {
          btn.click();
          console.log('[Roofr Automation] Clicked Next button');
          await sleep(500);
          return { ok: true };
        }
      }

      // If we didn't find Next, wait and try again
      console.log('[Roofr Automation] Next button not found, waiting...');
      await sleep(2000);
    }

    // Log what buttons we can see for debugging
    const allButtonTexts = Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean);
    console.log('[Roofr Automation] Available buttons:', allButtonTexts.slice(0, 20));

    throw new Error('Could not find Next button after multiple attempts');
  }

  // Step 6+: Continue clicking Next until we reach the final page or see completion indicators
  async function continueReportToCompletion() {
    console.log('[Roofr Automation] Continuing report to completion...');

    const maxPages = 10; // Safety limit
    let pageCount = 0;

    while (pageCount < maxPages) {
      pageCount++;
      await sleep(2000); // Wait for page to load

      // Check for completion indicators
      const pageText = document.body.textContent || '';
      const buttons = document.querySelectorAll('button');
      const buttonTexts = Array.from(buttons).map(b => b.textContent?.trim().toLowerCase() || '');

      console.log(`[Roofr Automation] Page ${pageCount} - checking for completion or Next`);

      // Check if we're on the final page (various indicators)
      const completionIndicators = [
        'report complete',
        'report generated',
        'view report',
        'download report',
        'report ready',
        'generate report',
        'finish',
        'done',
        'complete'
      ];

      // Check for completion text on page
      const isComplete = completionIndicators.some(indicator =>
        pageText.toLowerCase().includes(indicator)
      );

      // Check for a "Finish", "Done", "Generate Report", "View Report", or "Complete" button
      let finishButton = null;
      for (const btn of buttons) {
        const btnText = btn.textContent?.trim().toLowerCase() || '';
        if (btnText === 'finish' || btnText === 'done' || btnText === 'complete' ||
          btnText === 'generate report' || btnText === 'view report' ||
          btnText === 'create report') {
          finishButton = btn;
          console.log(`[Roofr Automation] Found finish button: "${btn.textContent?.trim()}"`);
          break;
        }
      }

      if (finishButton) {
        // Click the finish button
        finishButton.click();
        console.log('[Roofr Automation] Clicked finish button');
        await sleep(2000);
        return { ok: true, status: 'completed', pages: pageCount };
      }

      // Check if Next button exists
      let nextButton = null;
      for (const btn of buttons) {
        const btnText = btn.textContent?.trim();
        if (btnText === 'Next') {
          nextButton = btn;
          break;
        }
      }

      // If no Next button and no finish button, check if there's a close/X button (modal completed)
      if (!nextButton) {
        // Check for modal close indicators
        const closeButton = document.querySelector('[aria-label="Close"], [aria-label="close"], button[class*="close"]');
        if (closeButton || isComplete) {
          console.log('[Roofr Automation] Report appears complete (no Next button found)');
          return { ok: true, status: 'completed', pages: pageCount };
        }

        // Look for "All" button which might appear on intermediate pages
        for (const btn of buttons) {
          const btnText = btn.textContent?.trim();
          if (btnText === 'All') {
            btn.click();
            console.log('[Roofr Automation] Clicked All button on page', pageCount);
            await sleep(500);
            break;
          }
        }

        // Re-check for Next after clicking All
        const buttonsAfterAll = document.querySelectorAll('button');
        for (const btn of buttonsAfterAll) {
          const btnText = btn.textContent?.trim();
          if (btnText === 'Next') {
            nextButton = btn;
            break;
          }
        }
      }

      if (nextButton) {
        nextButton.click();
        console.log(`[Roofr Automation] Clicked Next on page ${pageCount}`);
        continue;
      }

      // If we still can't find Next or finish, log available buttons and break
      console.log('[Roofr Automation] Available buttons:', buttonTexts.slice(0, 15));

      // Check if we're in a loading state
      const loadingIndicator = document.querySelector('[class*="loading"], [class*="spinner"], [class*="progress"]');
      if (loadingIndicator) {
        console.log('[Roofr Automation] Loading in progress, waiting...');
        await sleep(3000);
        continue;
      }

      // If we get here, we might be done or stuck
      console.log('[Roofr Automation] Could not find Next or finish button, assuming complete');
      return { ok: true, status: 'assumed_complete', pages: pageCount };
    }

    console.log('[Roofr Automation] Reached max page limit');
    return { ok: true, status: 'max_pages_reached', pages: pageCount };
  }

  // Wait for job page to fully load before starting automation
  async function waitForJobPageLoad() {
    console.log('[Roofr Automation] Waiting for job page to load...');

    const maxWait = 20000; // 20 seconds max (increased)
    const checkInterval = 500;
    let waited = 0;
    let foundJobOwnerDropdown = false;

    // First, wait a moment for any navigation/page change to start
    await sleep(1000);

    while (waited < maxWait) {
      // Check for key indicators that the job panel is loaded
      const jobOwnerLabel = Array.from(document.querySelectorAll('label, span, div')).find(
        el => el.textContent?.trim() === 'Job owner' || el.textContent?.trim() === 'Job owner ⓘ'
      );
      const measurementsTab = document.querySelector('[data-value="measurements"], [role="tab"]');
      const jobPanel = document.querySelector('[class*="job-panel"], [class*="JobPanel"], [class*="sidebar"]');

      // Also check for any loading spinners or skeleton loaders
      const loadingSpinner = document.querySelector('[class*="loading"], [class*="spinner"], [class*="skeleton"], [class*="Skeleton"]');

      // CRITICAL: Check if the Job owner dropdown is actually interactive
      // This is more reliable than just checking for the label
      let jobOwnerDropdown = null;
      if (jobOwnerLabel) {
        const section = jobOwnerLabel.closest('div')?.parentElement || jobOwnerLabel.closest('div');
        if (section) {
          jobOwnerDropdown = section.querySelector('button[type="button"], [role="combobox"], [class*="trigger"], [class*="select"]');
          if (!jobOwnerDropdown) {
            // Try finding any clickable button in the section
            const buttons = section.querySelectorAll('button, [role="button"]');
            for (const btn of buttons) {
              const text = btn.textContent?.trim() || '';
              if (text && !text.includes('ⓘ')) {
                jobOwnerDropdown = btn;
                break;
              }
            }
          }
        }
      }

      if (jobOwnerDropdown && !loadingSpinner) {
        console.log(`[Roofr Automation] Job page fully loaded after ${waited}ms - dropdown found`);
        foundJobOwnerDropdown = true;
        // Wait a bit more to ensure the dropdown is interactive
        await sleep(500);
        return { ok: true, waited, dropdownFound: true };
      }

      if (jobOwnerLabel && !loadingSpinner && waited > 5000) {
        // Label found but no dropdown yet after 5 seconds - the page structure might be different
        console.log(`[Roofr Automation] Job owner label found but dropdown not detected after ${waited}ms`);
      }

      // Also accept if we have measurements tab visible (fallback)
      if (measurementsTab && !loadingSpinner && waited > 8000) {
        console.log(`[Roofr Automation] Job page loaded (found tabs) after ${waited}ms - proceeding without dropdown confirmation`);
        return { ok: true, waited, dropdownFound: false };
      }

      await sleep(checkInterval);
      waited += checkInterval;

      if (waited % 3000 === 0) {
        console.log(`[Roofr Automation] Still waiting for job page... ${waited}ms, label=${!!jobOwnerLabel}, dropdown=${!!jobOwnerDropdown}, loading=${!!loadingSpinner}`);
      }
    }

    console.log('[Roofr Automation] Timeout waiting for job page, proceeding anyway...');
    return { ok: false, waited, timeout: true, dropdownFound: false };
  }

  // Full automation sequence
  async function runReportAutomation(repName) {
    const results = {
      steps: [],
      success: false,
      error: null
    };

    try {
      // Step 0: Wait for job page to fully load
      const loadResult = await waitForJobPageLoad();
      results.steps.push({ step: 'waitForJobPageLoad', ...loadResult });

      // Extra wait after page appears loaded to ensure all elements are interactive
      await sleep(1500);

      // Step 1: Select rep if provided
      if (repName) {
        const step1 = await selectJobOwner(repName);
        results.steps.push({ step: 'selectJobOwner', ...step1 });
        await sleep(1000); // Wait for Roofr to save the owner change
      }

      // Step 2: Click Measurements tab
      const step2 = await clickMeasurementsTab();
      results.steps.push({ step: 'clickMeasurementsTab', ...step2 });
      await sleep(1500); // Wait for Measurements tab content to load

      // Step 3: Click Roofr report button
      const step3 = await clickRoofrReportButton();
      results.steps.push({ step: 'clickRoofrReportButton', ...step3 });
      await sleep(2500); // Wait for map to load - this can take a while

      // Step 4: Click Confirm on map
      const step4 = await clickConfirmOnMap();
      results.steps.push({ step: 'clickConfirmOnMap', ...step4 });
      await sleep(3000); // Wait for Roofr to process the map confirmation

      // Step 5: Select All and click Next
      const step5 = await selectAllSecondaryStructures();
      results.steps.push({ step: 'selectAllSecondaryStructures', ...step5 });

      // Step 6: Continue through remaining pages until completion
      const step6 = await continueReportToCompletion();
      results.steps.push({ step: 'continueReportToCompletion', ...step6 });

      results.success = true;
      results.reportStatus = step6.status;
      results.totalPages = step6.pages;
      console.log(`[Roofr Automation] Completed successfully! Status: ${step6.status}, Pages: ${step6.pages}`);
    } catch (error) {
      results.error = error.message;
      console.error('[Roofr Automation] Error:', error);
    }

    return results;
  }

  // Get current job info from the page
  function getJobInfo() {
    const info = {
      address: null,
      jobOwner: null,
      jobId: null,
      contactName: null,
      reportStatus: null
    };

    // Get address from page title/header
    const header = document.querySelector('h1, h2, [class*="job-title"], [class*="address"]');
    if (header) {
      info.address = header.textContent?.trim();
    }

    // Get job ID from URL
    const urlMatch = window.location.search.match(/selectedJobId=(\d+)/);
    if (urlMatch) {
      info.jobId = urlMatch[1];
    }

    // Get current job owner
    const labels = document.querySelectorAll('label, span, div');
    for (const label of labels) {
      if (label.textContent?.trim() === 'Job owner') {
        const parent = label.closest('div')?.parentElement;
        const dropdown = parent?.querySelector('button, [role="combobox"]');
        if (dropdown) {
          info.jobOwner = dropdown.textContent?.trim();
        }
        break;
      }
    }

    // Get contact name from sidebar
    const contactNameEl = document.querySelector('[class*="contact-name"], [data-testid*="contact"]');
    if (contactNameEl) {
      info.contactName = contactNameEl.textContent?.trim();
    }

    // Get Roofr report status from the tags (e.g., "Complete", "Pending", "No proposals")
    // Look for data-testid="reports-tag" or data-testid="proposals-tag"
    const reportTag = document.querySelector('[data-testid="reports-tag"]');
    const proposalsTag = document.querySelector('[data-testid="proposals-tag"]');

    if (reportTag) {
      info.reportStatus = reportTag.textContent?.trim().toLowerCase();
    } else if (proposalsTag) {
      info.reportStatus = proposalsTag.textContent?.trim().toLowerCase();
    } else {
      // Fallback: look for status text in spans with roofr-tag class
      const statusTags = document.querySelectorAll('span[class*="roofr-tag"]');
      for (const tag of statusTags) {
        const text = tag.textContent?.trim().toLowerCase();
        if (text === 'complete' || text === 'pending' || text === 'no proposals' || text === 'in progress') {
          info.reportStatus = text;
          break;
        }
      }
    }

    return info;
  }

  // Check if we're on a job details page with the panel open
  function isJobPanelOpen() {
    return window.location.search.includes('selectedJobId=');
  }

  // NOTE: Message handlers have been moved to the global handler section below
  // to ensure they're always registered even if this guard doesn't pass

  console.log('[Roofr Automation] Job card automation loaded');

  // Expose the runReportAutomation function globally so it can be called from outside the guard
  window.__roofrRunReportAutomation = runReportAutomation;
  window.__roofrGetJobInfo = getJobInfo;
  window.__roofrIsJobPanelOpen = isJobPanelOpen;
  window.__roofrSelectJobOwner = selectJobOwner;
  window.__roofrClickMeasurementsTab = clickMeasurementsTab;
  window.__roofrClickRoofrReportButton = clickRoofrReportButton;
  window.__roofrClickConfirmOnMap = clickConfirmOnMap;
  window.__roofrSelectAllSecondaryStructures = selectAllSecondaryStructures;
}
// ==================================================
// END: Roofr Job Card Automation
// ==================================================

// ==================================================
// START: Global Message Handler for Report Automation
// ==================================================
// This handler is OUTSIDE the guard so it always registers,
// allowing the popup to communicate even if the guard hasn't run yet
(function () {
  // Only register once
  if (window.__roofrGlobalMessageHandlerRegistered) return;
  window.__roofrGlobalMessageHandlerRegistered = true;

  console.log('[Roofr Global] Registering global message handler for report automation');

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Only handle report automation messages here
    if (msg.type === "RUN_REPORT_AUTOMATION") {
      console.log('[Roofr Global] Received RUN_REPORT_AUTOMATION message');

      // Check if the automation function is available
      if (typeof window.__roofrRunReportAutomation === 'function') {
        console.log('[Roofr Global] Calling runReportAutomation...');
        window.__roofrRunReportAutomation(msg.repName).then(result => {
          console.log('[Roofr Global] Automation result:', result);
          sendResponse(result);
        }).catch(err => {
          console.error('[Roofr Global] Automation error:', err);
          sendResponse({ success: false, error: err.message });
        });
        return true; // Will respond asynchronously
      } else {
        console.error('[Roofr Global] runReportAutomation not available - page may not be a job page');
        sendResponse({
          success: false,
          error: 'Report automation not available on this page. Make sure you are on a Roofr job page.',
          pageUrl: window.location.href
        });
        return true;
      }
    }

    if (msg.type === "GET_JOB_INFO") {
      if (typeof window.__roofrGetJobInfo === 'function') {
        const info = window.__roofrGetJobInfo();
        sendResponse({ ok: true, info });
      } else {
        sendResponse({ ok: false, error: 'Not on a job page' });
      }
      return true;
    }

    if (msg.type === "IS_JOB_PANEL_OPEN") {
      if (typeof window.__roofrIsJobPanelOpen === 'function') {
        sendResponse({ ok: true, isOpen: window.__roofrIsJobPanelOpen() });
      } else {
        sendResponse({ ok: true, isOpen: false });
      }
      return true;
    }

    if (msg.type === "SELECT_JOB_OWNER") {
      if (typeof window.__roofrSelectJobOwner === 'function') {
        window.__roofrSelectJobOwner(msg.repName).then(result => {
          sendResponse(result);
        }).catch(err => {
          sendResponse({ ok: false, error: err.message });
        });
        return true;
      }
      sendResponse({ ok: false, error: 'Not on a job page' });
      return true;
    }

    if (msg.type === "CLICK_MEASUREMENTS_TAB") {
      if (typeof window.__roofrClickMeasurementsTab === 'function') {
        window.__roofrClickMeasurementsTab().then(result => {
          sendResponse(result);
        }).catch(err => {
          sendResponse({ ok: false, error: err.message });
        });
        return true;
      }
      sendResponse({ ok: false, error: 'Not on a job page' });
      return true;
    }

    if (msg.type === "CLICK_ROOFR_REPORT") {
      if (typeof window.__roofrClickRoofrReportButton === 'function') {
        window.__roofrClickRoofrReportButton().then(result => {
          sendResponse(result);
        }).catch(err => {
          sendResponse({ ok: false, error: err.message });
        });
        return true;
      }
      sendResponse({ ok: false, error: 'Not on a job page' });
      return true;
    }

    if (msg.type === "CLICK_CONFIRM_MAP") {
      if (typeof window.__roofrClickConfirmOnMap === 'function') {
        window.__roofrClickConfirmOnMap().then(result => {
          sendResponse(result);
        }).catch(err => {
          sendResponse({ ok: false, error: err.message });
        });
        return true;
      }
      sendResponse({ ok: false, error: 'Not on a job page' });
      return true;
    }

    if (msg.type === "SELECT_ALL_SECONDARY") {
      if (typeof window.__roofrSelectAllSecondaryStructures === 'function') {
        window.__roofrSelectAllSecondaryStructures().then(result => {
          sendResponse(result);
        }).catch(err => {
          sendResponse({ ok: false, error: err.message });
        });
        return true;
      }
      sendResponse({ ok: false, error: 'Not on a job page' });
      return true;
    }

    return false;
  });

  console.log('[Roofr Global] Global message handler registered');
})();
// ==================================================
// END: Global Message Handler for Report Automation
// ==================================================

// ==================================================
// START: Google Earth Address Search Handler
// ==================================================
(function() {
  // Only run on Google Earth pages
  if (!window.location.hostname.includes('earth.google.com')) return;

  // Prevent duplicate registration
  if (window.__googleEarthSearchRegistered) return;
  window.__googleEarthSearchRegistered = true;

  console.log('[Google Earth] Registering address search handler');

  // Google Earth is a Flutter WebGL app - keyboard/mouse simulation doesn't work on the canvas.
  // The URL-based search (earth.google.com/web/search/ADDRESS) is the only reliable method.
  // Google Earth automatically parses the address from the URL and flies to the location.

  // Listen for search messages (mainly for logging/confirmation)
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SEARCH_GOOGLE_EARTH_ADDRESS') {
      console.log('[Google Earth] Received search request for:', msg.address);

      const currentUrl = window.location.href;

      // Check if URL already contains a search
      if (currentUrl.includes('/search/')) {
        console.log('[Google Earth] URL contains search path - Earth should auto-navigate');
        console.log('[Google Earth] Current URL:', currentUrl);
        sendResponse({ success: true, method: 'url_already_set', url: currentUrl });
      } else {
        // URL doesn't have search - navigate to it
        const searchUrl = `https://earth.google.com/web/search/${encodeURIComponent(msg.address)}`;
        console.log('[Google Earth] Navigating to search URL:', searchUrl);
        window.location.href = searchUrl;
        sendResponse({ success: true, method: 'url_navigation', url: searchUrl });
      }

      return true;
    }
    return false;
  });

  console.log('[Google Earth] Address search handler registered');
})();
// ==================================================
// END: Google Earth Address Search Handler
// ==================================================

// ==================================================
// START: Roofr middle-click / Ctrl+Cmd-click -> open in new tab
// Job list rows (.ag-row) + board cards (.job-card--modal-link), plus inside a job card:
// proposals + PDF-signer docs (whole card) and invoice & work-order "View" buttons.
// Roofr cards/buttons run JS handlers instead of being <a href>, so native middle-click
// does nothing; we resolve the deep-link and open it ourselves. Material-order View
// buttons are handled by the companion MAIN-world script roofr-material-order-newtab.js
// (their id is only in React fiber, which this isolated-world script can't read).
// ==================================================
if (location.hostname.includes('roofr.com') && !window.__roofrProposalNewTab) {
  window.__roofrProposalNewTab = true;
  (() => {
    const CARD = '.job-item-card--container';
    const TIMELINE = '.proposals-card-view-timeline';            // proposal-specific marker
    const INNER = 'button,[role="menu"],[role="menuitem"],a,input,select,textarea,[contenteditable]';
    const jobCache = new Map();                                   // jobId -> Promise<{proposals[], signatureDocs[]}>
    const woCache = new Map();                                    // jobId -> Promise<[{id,number}]>

    const teamId = () => (location.pathname.match(/\/dashboard\/team\/(\d+)/) || [])[1] || null;
    // jobId: prefer the URL's selectedJobId; fall back to data-roofr-job-id, which the
    // MAIN-world script (roofr-material-order-newtab.js) sets from React fiber. The fallback
    // covers job cards opened on a URL WITHOUT selectedJobId (e.g. "View job details" from a
    // proposal page), where the URL alone can't tell us which job is open.
    const jobId  = () => (location.search.match(/selectedJobId=(\d+)/) || [])[1]
                    || document.documentElement.dataset.roofrJobId || null;

    // Open a Roofr URL in a BACKGROUND tab via the service worker (chrome.tabs.create {active:false}),
    // so middle-click / Ctrl+Cmd-click never steals focus. Falls back to window.open if messaging fails.
    function openTab(url) {
      try { chrome.runtime.sendMessage({ type: 'ROOFR_OPEN_BG_TAB', url }); }
      catch (e) { window.open(url, '_blank'); }
    }
    // Relay background-tab requests from the MAIN-world script (it has no chrome.* APIs).
    window.addEventListener('message', (e) => {
      if (e.source === window && e.data && typeof e.data.__roofrBgTab === 'string'
          && /^https:\/\/app\.roofr\.com\//.test(e.data.__roofrBgTab)) {
        openTab(e.data.__roofrBgTab);
      }
      // Relay attachment (PDF/image) opens from the MAIN-world script. The SW re-serves the
      // file inline via the bundled viewer so it VIEWS in a background tab (the raw S3 link
      // force-downloads). Host is re-validated in the SW.
      if (e.source === window && e.data && e.data.__roofrAttachmentTab
          && typeof e.data.__roofrAttachmentTab.url === 'string') {
        const a = e.data.__roofrAttachmentTab;
        try { chrome.runtime.sendMessage({ type: 'ROOFR_OPEN_ATTACHMENT', url: a.url, name: a.name || '', ext: (a.ext || '').toLowerCase() }); }
        catch (err) { /* SW asleep / context invalidated — ignore */ }
      }
    });

    // Proposals AND PDF-signer documents both render as .job-item-card--container.
    // Proposal cards carry the proposal-specific timeline; PDF-signer doc cards don't.
    // (Material/work-order cards use different classes, so they never match CARD.)
    const itemCards     = () => [...document.querySelectorAll(CARD)];
    const proposalCards = () => itemCards().filter(c => c.querySelector(TIMELINE));
    const pdfCards      = () => itemCards().filter(c => !c.querySelector(TIMELINE));

    // One /api/job fetch feeds both: proposals[] and signature_documents[] (PDF signer),
    // each already in the same order as its on-screen cards. The ids aren't in the DOM.
    function jobData(jid, tid) {
      if (!jobCache.has(jid)) {
        const p = fetch(`https://app.roofr.com/api/job/${jid}`, {
          credentials: 'include', headers: { 'team-id': String(tid) }
        }).then(r => { if (!r.ok) throw new Error('job ' + r.status); return r.json(); })
          .then(d => ({
            proposals: Array.isArray(d.proposals) ? d.proposals.map(p => String(p.id)) : [],
            signatureDocs: Array.isArray(d.signature_documents) ? d.signature_documents.map(x => String(x.id)) : []
          }));
        p.catch(() => jobCache.delete(jid));                      // evict on failure -> retry next click
        jobCache.set(jid, p);
      }
      return jobCache.get(jid);
    }

    async function openProposal(card) {
      const tid = teamId(), jid = jobId();
      if (!tid || !jid) return;
      const idx = proposalCards().indexOf(card);                 // capture index BEFORE await (DOM stable now)
      if (idx < 0) return;
      const pid = (await jobData(jid, tid)).proposals[idx];
      if (pid) openTab(`https://app.roofr.com/dashboard/team/${tid}/proposals/proposal/${pid}`);
    }

    async function openPdfDoc(card) {
      const tid = teamId(), jid = jobId();
      if (!tid || !jid) return;
      const idx = pdfCards().indexOf(card);                      // capture index BEFORE await
      if (idx < 0) return;
      const id = (await jobData(jid, tid)).signatureDocs[idx];
      if (id) openTab(`https://app.roofr.com/dashboard/team/${tid}/pdf-signer/document/${id}`);
    }

    // A "View" button (material orders, work orders, invoices). Exact text "View".
    function viewBtn(target) {
      const b = target.closest && target.closest('button');
      return (b && /^\s*View\s*$/.test(b.textContent || '')) ? b : null;
    }

    // Invoice cards (.job-invoice-card) embed a real <a href=".../invoice/{uuid}/details">.
    // Bound the lookup to the clicked element's OWN invoice card so a material/work-order
    // "View" button can't accidentally grab an invoice anchor from a sibling section.
    function invoiceHref(fromEl) {
      const card = fromEl.closest && fromEl.closest('.job-invoice-card');
      if (!card) return null;
      const a = card.querySelector('a[href*="/invoice/"][href*="/details"]');
      return a && a.href ? a.href : null;
    }

    // Work orders: no in-DOM href, but the job-scoped API returns them with UUIDs.
    // GET /api/work-orders?filter[job_id]={jobId} -> [{id(uuid), number, ...}].
    function workOrders(jid, tid) {
      if (!woCache.has(jid)) {
        const p = fetch(`https://app.roofr.com/api/work-orders?filter%5Bjob_id%5D=${jid}`, {
          credentials: 'include', headers: { 'team-id': String(tid) }
        }).then(r => { if (!r.ok) throw new Error('wo ' + r.status); return r.json(); })
          .then(d => (d && Array.isArray(d.data) ? d.data : []).map(w => ({ id: String(w.id), number: String(w.number) })));
        p.catch(() => woCache.delete(jid));
        woCache.set(jid, p);
      }
      return woCache.get(jid);
    }

    // A "View" button is a work order's if it's NOT inside an invoice or material-order
    // card and its enclosing card text mentions "Work order". Returns that card or null.
    function workOrderCard(fromEl) {
      if (fromEl.closest('.job-invoice-card') || fromEl.closest('.card--material-order')) return null;
      let n = fromEl;
      for (let i = 0; i < 8 && n; i++) {
        if (/work order/i.test(n.textContent || '')) return n;
        n = n.parentElement;
      }
      return null;
    }

    async function openWorkOrder(card) {
      const tid = teamId(), jid = jobId();
      if (!tid || !jid) return;
      const m = (card.textContent || '').match(/work order\s*#?\s*0*(\d+)/i);  // strip leading zeros (display "02019" == API "2019")
      const num = m ? m[1] : null;
      const list = await workOrders(jid, tid);
      if (!list.length) return;
      let wo = num ? list.find(w => parseInt(w.number, 10) === parseInt(num, 10)) : null;
      if (!wo && list.length === 1) wo = list[0];                // single work order: unambiguous
      if (wo) openTab(`https://app.roofr.com/dashboard/work-orders/${wo.id}`);
    }

    function handle(e) {
      try {
        const mid = e.type === 'auxclick' && e.button === 1;
        const mod = e.type === 'click' && (e.ctrlKey || e.metaKey);
        if (!mid && !mod) return;
        // (C) Job list row (.ag-row[row-id]) or board card (.job-card--modal-link[data-board-job-id]).
        //     The jobId is a plain DOM attribute on these. Open the job's modal deep-link.
        const jobEl = e.target.closest('.ag-row[row-id], .job-card--modal-link[data-board-job-id]');
        if (jobEl) {
          if (e.target.closest('a[href],input,[role="menu"],[role="menuitem"]')) return; // let real links/menus/checkboxes act natively
          const jid = jobEl.getAttribute('row-id') || jobEl.getAttribute('data-board-job-id');
          const tid = teamId();
          if (tid && /^\d+$/.test(jid || '')) {
            e.preventDefault(); e.stopPropagation();
            openTab(`https://app.roofr.com/dashboard/team/${tid}/jobs/list-view?selectedJobId=${jid}`);
          }
          return;
        }
        // (A) "View" button on a card. Invoice -> in-DOM <a href>; work order -> job-scoped API.
        //     (Material-order View buttons are handled in roofr-material-order-newtab.js (MAIN world).)
        const vb = viewBtn(e.target);
        if (vb) {
          const href = invoiceHref(vb);
          if (href) { e.preventDefault(); e.stopPropagation(); openTab(href); return; }
          const woCard = workOrderCard(vb);
          if (woCard) { e.preventDefault(); e.stopPropagation(); openWorkOrder(woCard).catch(err => console.warn('[RoofrNewTab]', err)); }
          return;
        }
        // (B) Whole-card click on a .job-item-card--container: proposal OR PDF-signer doc.
        if (e.target.closest(INNER)) return;                     // don't hijack kebab/badge/links/inputs
        const card = e.target.closest(CARD);
        if (!card) return;
        if (proposalCards().includes(card)) {
          e.preventDefault(); e.stopPropagation();
          openProposal(card).catch(err => console.warn('[RoofrNewTab]', err));
        } else if (pdfCards().includes(card)) {
          e.preventDefault(); e.stopPropagation();
          openPdfDoc(card).catch(err => console.warn('[RoofrNewTab]', err));
        }
      } catch (err) { console.warn('[RoofrNewTab]', err); }
    }

    // Suppress the middle-click autoscroll cursor when over a proposal card or a "View" button.
    document.addEventListener('mousedown', e => {
      if (e.button !== 1) return;
      const onJobRow = e.target.closest('.ag-row[row-id], .job-card--modal-link[data-board-job-id]')
                       && !e.target.closest('a[href],input,[role="menu"],[role="menuitem"]');
      if (viewBtn(e.target) || (e.target.closest(CARD) && !e.target.closest(INNER)) || onJobRow) e.preventDefault();
    }, true);
    document.addEventListener('auxclick', handle, true);
    document.addEventListener('click', handle, true);

    // Evict the per-job cache when the open job changes (SPA navigation).
    let last = jobId();
    const evict = () => { const n = jobId(); if (n !== last) { if (last) { jobCache.delete(last); woCache.delete(last); } last = n; } };
    addEventListener('popstate', evict);
    if (!window.__roofrHistPatched) {
      window.__roofrHistPatched = true;
      for (const m of ['pushState', 'replaceState']) {
        const orig = history[m].bind(history);
        history[m] = (...a) => { const r = orig(...a); evict(); return r; };
      }
    }

    console.log('[RoofrNewTab] middle-click / Ctrl+Cmd-click handler registered (proposals, PDF signer, invoices, work orders)');
  })();
}
// ==================================================
// END: Roofr middle-click proposal cards
// ==================================================

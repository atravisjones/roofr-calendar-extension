// content.js (MERGED SCRIPT, GUARDED)

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
// START: CallRail Call Detection (Only runs on CallRail domains)
// ==================================================
if (window.location.hostname.includes('callrail.com') && !window.__callrailBridgeLoaded) {
  window.__callrailBridgeLoaded = true;

  console.log('[CallRail Extension] Checking if call detection is enabled...');

  // State tracking
  let isCallActive = false;
  let activeCallPhoneNumber = null;
  let lastSearchedNumber = null;
  let isFeatureEnabled = true; // Will be checked on init
  let configuredCsr = ''; // The primary CSR name (display name or user name)
  let configuredCsrUser = ''; // The selected CSR name from dropdown
  let configuredCsrDisplay = ''; // Alternative display name if different in CallRail
  let lastLoggedCallKey = null; // Prevents duplicate logging for same call

  // Normalize phone number to digits only
  function normalizePhoneNumber(phone) {
    if (!phone) return null;
    return phone.replace(/[^\d]/g, '');
  }

  // Format phone for display (XXX-XXX-XXXX)
  function formatPhoneForDisplay(phone) {
    const cleaned = normalizePhoneNumber(phone);
    if (!cleaned) return phone;
    if (cleaned.length === 10) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    if (cleaned.length === 11 && cleaned[0] === '1') {
      return `${cleaned.slice(1, 4)}-${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    return phone;
  }

  // Extract phone number from an element
  function extractPhoneFromElement(element) {
    if (!element) return null;

    // Try data attributes first
    const dataPhone = element.getAttribute('data-phone') ||
      element.getAttribute('data-phone-number');
    if (dataPhone) return normalizePhoneNumber(dataPhone);

    // Try href="tel:..." links
    const telLink = element.querySelector('a[href^="tel:"]');
    if (telLink) {
      const href = telLink.getAttribute('href');
      return normalizePhoneNumber(href.replace('tel:', ''));
    }

    // Try text content matching phone pattern (XXX-XXX-XXXX or similar)
    const text = element.textContent || '';
    const phoneMatch = text.match(/(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);
    if (phoneMatch) {
      return normalizePhoneNumber(phoneMatch[1]);
    }

    return null;
  }

  // Nickname mappings - maps full names to nicknames and vice versa
  const NICKNAME_MAP = {
    'madison': ['madi', 'maddie', 'maddy'],
    'madi': ['madison'],
    'maddie': ['madison'],
    'maddy': ['madison'],
    'bronte': ['bronté'],
    'bronté': ['bronte'],
    'robert': ['rob', 'bob', 'bobby'],
    'rob': ['robert'],
    'bob': ['robert'],
    'bobby': ['robert'],
    'william': ['will', 'bill', 'billy'],
    'will': ['william'],
    'bill': ['william'],
    'billy': ['william'],
    'michael': ['mike', 'mikey'],
    'mike': ['michael'],
    'mikey': ['michael'],
    'christopher': ['chris'],
    'chris': ['christopher'],
    'jennifer': ['jen', 'jenny'],
    'jen': ['jennifer'],
    'jenny': ['jennifer'],
    'elizabeth': ['liz', 'beth', 'lizzy'],
    'liz': ['elizabeth'],
    'beth': ['elizabeth'],
    'lizzy': ['elizabeth'],
    'katherine': ['kate', 'katie', 'kathy'],
    'kate': ['katherine'],
    'katie': ['katherine'],
    'kathy': ['katherine'],
    'nicholas': ['nick', 'nicky'],
    'nick': ['nicholas'],
    'nicky': ['nicholas'],
    'alexander': ['alex'],
    'alex': ['alexander', 'alexandra'],
    'alexandra': ['alex'],
    'benjamin': ['ben'],
    'ben': ['benjamin'],
    'daniel': ['dan', 'danny'],
    'dan': ['daniel'],
    'danny': ['daniel'],
    'matthew': ['matt'],
    'matt': ['matthew'],
    'anthony': ['tony'],
    'tony': ['anthony'],
    'joseph': ['joe', 'joey'],
    'joe': ['joseph'],
    'joey': ['joseph'],
    'joshua': ['josh'],
    'josh': ['joshua'],
    'andrew': ['andy', 'drew'],
    'andy': ['andrew'],
    'drew': ['andrew'],
    'timothy': ['tim', 'timmy'],
    'tim': ['timothy'],
    'timmy': ['timothy'],
    'steven': ['steve'],
    'steve': ['steven', 'stephen'],
    'stephen': ['steve'],
    'jonathan': ['jon', 'john'],
    'jon': ['jonathan'],
    'jessica': ['jess', 'jessie'],
    'jess': ['jessica'],
    'jessie': ['jessica'],
    'samantha': ['sam', 'sammy'],
    'sam': ['samantha', 'samuel'],
    'sammy': ['samantha', 'samuel'],
    'samuel': ['sam', 'sammy'],
    'rebecca': ['becca', 'becky'],
    'becca': ['rebecca'],
    'becky': ['rebecca'],
    'patricia': ['pat', 'patty', 'tricia'],
    'pat': ['patricia', 'patrick'],
    'patty': ['patricia'],
    'tricia': ['patricia'],
    'patrick': ['pat'],
    'travis': ['trav'],
    'trav': ['travis']
  };

  // Remove accents from characters (Bronté → Bronte)
  function removeAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // Normalize name for comparison (lowercase, remove extra spaces, remove accents)
  function normalizeName(name) {
    if (!name) return '';
    return removeAccents(name.toLowerCase().trim().replace(/\s+/g, ' '));
  }

  // Check if two first names match (including nickname variations)
  function firstNamesMatch(name1, name2) {
    if (!name1 || !name2) return false;
    const n1 = normalizeName(name1);
    const n2 = normalizeName(name2);

    // Direct match
    if (n1 === n2) return true;

    // Check nickname mappings
    const nicknames1 = NICKNAME_MAP[n1] || [];
    const nicknames2 = NICKNAME_MAP[n2] || [];

    // Check if n2 is a nickname of n1 or vice versa
    if (nicknames1.includes(n2) || nicknames2.includes(n1)) return true;

    // Check if one contains the other (for partial matches)
    if (n1.includes(n2) || n2.includes(n1)) return true;

    return false;
  }

  // Check if two names match (handles variations like "First Last" vs "Last, First" and nicknames)
  function namesMatch(name1, name2) {
    if (!name1 || !name2) return false;

    const n1 = normalizeName(name1);
    const n2 = normalizeName(name2);

    // Direct match
    if (n1 === n2) return true;

    // Check if one contains the other
    if (n1.includes(n2) || n2.includes(n1)) return true;

    // Split into parts and check if all parts are present
    const parts1 = n1.split(' ').filter(p => p.length > 1);
    const parts2 = n2.split(' ').filter(p => p.length > 1);

    // Check if all parts of the shorter name are in the longer name
    const shorter = parts1.length <= parts2.length ? parts1 : parts2;
    const longer = parts1.length <= parts2.length ? parts2 : parts1;

    // For each part in shorter, check if it matches any part in longer (including nicknames)
    const allPartsMatch = shorter.every(part =>
      longer.some(lpart =>
        lpart.includes(part) || part.includes(lpart) || firstNamesMatch(part, lpart)
      )
    );

    if (allPartsMatch) return true;

    // Also check if first names match via nickname (e.g., "Madison Meyers" vs "Madi Meyers")
    if (parts1.length >= 1 && parts2.length >= 1) {
      const firstName1 = parts1[0];
      const firstName2 = parts2[0];
      const lastName1 = parts1.length > 1 ? parts1[parts1.length - 1] : '';
      const lastName2 = parts2.length > 1 ? parts2[parts2.length - 1] : '';

      // If last names match and first names are nickname variations
      if (lastName1 && lastName2 && lastName1 === lastName2 && firstNamesMatch(firstName1, firstName2)) {
        return true;
      }
    }

    return false;
  }

  // Extract the agent name who is handling the call from the call card
  function extractAgentNameFromElement(element) {
    if (!element) return null;

    // Look for agent name in the Active section
    // Based on CallRail UI: agent name appears as a link at the TOP of the call item
    // The caller name appears BELOW the agent name

    // Strategy 1: Look for the FIRST link element (typically the agent name)
    const firstLink = element.querySelector('a');
    if (firstLink) {
      const text = firstLink.textContent?.trim();
      // Agent names are typically 2+ words with capital letters, no numbers
      if (text && text.match(/^[A-Z][a-z]+ [A-Z][a-z]+/) && !text.match(/\d/)) {
        return text;
      }
    }

    // Strategy 2: Look for spans with agent/user classes
    const agentSpans = element.querySelectorAll('[class*="agent"], [class*="user"], span.segment');
    for (const span of agentSpans) {
      const text = span.textContent?.trim();
      if (text && text.match(/^[A-Z][a-z]+ [A-Z][a-z]+/) && !text.match(/\d/)) {
        return text;
      }
    }

    // Strategy 3: Find all name-like text and take the first one (usually the agent)
    const allText = element.textContent || '';
    const nameMatches = allText.match(/[A-Z][a-z]+ [A-Z][a-z]+/g);
    if (nameMatches && nameMatches.length > 0) {
      // Filter out any that look like phone numbers or dates
      for (const name of nameMatches) {
        if (!name.match(/\d/) && !name.match(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i)) {
          return name;
        }
      }
    }

    return null;
  }

  // Extract customer phone from call list item - looks for phone displayed near timer
  // This should be the customer's phone, NOT the tracking number
  function extractCustomerPhoneFromCallItem(timerElement) {
    // Walk up to find the call list item container
    let container = timerElement.parentElement;
    let depth = 0;

    while (container && depth < 8) {
      // Look for phone number displayed as text in this container's direct children/descendants
      // The structure is: Agent Name, Customer Name, Customer Phone, Timer
      // The phone should be a sibling element near the timer, not in a details panel

      const childElements = container.querySelectorAll('*');
      for (const child of childElements) {
        // Skip if this element has many children (likely a container, not a text element)
        if (child.children.length > 2) continue;

        const text = child.textContent?.trim() || '';

        // Look for phone number pattern (XXX-XXX-XXXX or similar)
        // Must be a relatively short text (just the phone number)
        if (text.length > 5 && text.length < 20) {
          const phoneMatch = text.match(/^(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})$/);
          if (phoneMatch) {
            // This looks like a standalone phone number display
            return normalizePhoneNumber(phoneMatch[1]);
          }
        }
      }

      container = container.parentElement;
      depth++;
    }

    return null;
  }

  // Find ALL active calls - uses CallRail's DOM class structure
  // STRICT: Only returns calls with live elapsed timers (Xm Xs format like "17m 0s")
  // Skips calls with timestamps (8:12 am) or dates (Dec 31)
  function findAllActiveCalls() {
    const activeCalls = [];
    const seenPhones = new Set();

    // STRICT timer pattern: matches elapsed time formats:
    // - "Xm Xs" format (e.g., "17m 0s", "5m 43s", "0m 12s") for calls >= 1 minute
    // - "Xs" format (e.g., "6s", "59s") for calls < 1 minute
    // Also allow no space: "17m0s"
    const STRICT_TIMER_REGEX = /(\d+m\s*\d+s|\d+s)/;

    // Find all phone number elements with the CallRail class
    const phoneElements = document.querySelectorAll('[class*="list-item-number"]');

    for (const phoneEl of phoneElements) {
      const phoneText = phoneEl.textContent?.trim() || '';
      if (!phoneText) continue;

      // Extract phone number
      const phoneMatch = phoneText.match(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/);
      if (!phoneMatch) continue;

      const phone = normalizePhoneNumber(phoneMatch[1]);
      if (!phone || phone.length < 10 || seenPhones.has(phone)) continue;

      // Get the container - IMPORTANT: Get the parent list-item div, not just list-item-contact
      // The timer is in list-item-meta > list-item-date-time, which is a SIBLING of list-item-contact
      const container = phoneEl.closest('[id^="list-item-"]') ||
        phoneEl.closest('[class*="list-item u-"]') ||
        phoneEl.closest('[class*="list-item-wrapper"]')?.parentElement ||
        phoneEl.closest('[class*="list-item"]');

      if (!container) continue;

      const containerText = container.textContent || '';

      // Also specifically look for the date-time element which contains the timer
      const dateTimeEl = container.querySelector('[class*="list-item-date-time"], [class*="date-time"]');
      const dateTimeText = dateTimeEl?.textContent?.trim() || '';

      // Combine both for checking
      const fullText = containerText + ' ' + dateTimeText;

      // SKIP if it has am/pm timestamps - these are completed calls
      if (/\d{1,2}:\d{2}\s*(am|pm)/i.test(fullText)) continue;

      // SKIP if it has date like "Dec 31" - these are historical
      if (/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i.test(fullText)) continue;

      // STRICT CHECK: Must have a timer in "Xm Xs" format
      const timerMatch = fullText.match(STRICT_TIMER_REGEX);
      if (!timerMatch) {
        // No timer found - skip this call
        continue;
      }

      // IMPORTANT: Skip calls that haven't been answered yet
      // If "Answer" or "Decline" buttons are present, the call is still ringing
      // The rep name shown might be from a previous interaction, not who's answering
      const answerBtn = container.querySelector('button[class*="btn--primary"]');
      const declineBtn = container.querySelector('button');
      const hasAnswerButton = answerBtn && /answer/i.test(answerBtn.textContent || '');
      const hasDeclineButton = declineBtn && /decline/i.test(declineBtn.textContent || '');

      if (hasAnswerButton || hasDeclineButton) {
        // Call is still ringing/incoming - not answered yet, skip it
        continue;
      }

      const timer = timerMatch[1];

      // This is a verified active call with live timer (and answered)
      seenPhones.add(phone);

      // Extract names using specific DOM elements
      let csrName = null;
      let customerName = null;

      // CSR/Agent name is in span.segment inside list-item-info
      const infoEl = container.querySelector('[class*="list-item-info"]');
      if (infoEl) {
        const segmentEl = infoEl.querySelector('[class*="segment"], span');
        if (segmentEl) {
          csrName = segmentEl.textContent?.trim() || null;
        }
      }

      // Customer name is in list-item-name
      const nameEl = container.querySelector('[class*="list-item-name"]');
      if (nameEl) {
        customerName = nameEl.textContent?.trim() || null;
      }

      // Fallback to regex if DOM elements not found
      if (!csrName || !customerName) {
        const allNames = containerText.match(/[A-Z][a-z]+ [A-Z][a-z]+/g) || [];
        if (!csrName && allNames.length >= 1) {
          csrName = allNames[0];
        }
        if (!customerName && allNames.length >= 2) {
          customerName = allNames[1];
        } else if (!customerName && allNames.length === 1) {
          customerName = allNames[0];
        }
      }

      activeCalls.push({
        phoneNumber: phone,
        formattedPhone: formatPhoneForDisplay(phone),
        timer: timer,
        agentName: csrName,      // CSR handling the call (for filtering)
        callerName: customerName  // Customer calling (for tab group title)
      });
    }

    return activeCalls;
  }

  // Find active/answered calls in the Active section
  // STRICT: Only finds calls with live elapsed timers
  function findActiveIncomingCall() {
    // IMPORTANT: We are looking for CURRENTLY ACTIVE calls only
    // Must have timer in "Xm Xs" format (e.g., "17m 0s", "5m 43s") or "Xs" format (e.g., "6s", "59s")

    // STRICT timer pattern: matches elapsed time formats:
    // - "Xm Xs" format for calls >= 1 minute
    // - "Xs" format for calls < 1 minute
    const STRICT_TIMER_REGEX = /(\d+m\s*\d+s|\d+s)/;

    // Strategy 1: Use CallRail's DOM class structure
    const phoneElements = document.querySelectorAll('[class*="list-item-number"]');

    // DEBUG: Log how many phone elements found
    if (phoneElements.length === 0) {
      // Try alternate selectors
      const altElements = document.querySelectorAll('[class*="phone"], [class*="number"], [class*="caller"]');
      console.log('[CallRail Extension] DEBUG: No list-item-number elements found. Alt selectors found:', altElements.length);
    }

    for (const phoneEl of phoneElements) {
      const phoneText = phoneEl.textContent?.trim() || '';
      if (!phoneText) continue;

      const phoneMatch = phoneText.match(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/);
      if (!phoneMatch) continue;

      const phone = normalizePhoneNumber(phoneMatch[1]);
      if (!phone || phone.length < 10) continue;

      // Get the container - IMPORTANT: Get the parent list-item div, not just list-item-contact
      // The timer is in list-item-meta > list-item-date-time, which is a SIBLING of list-item-contact
      // So we need the parent that contains BOTH (the main list-item div with id)
      const container = phoneEl.closest('[id^="list-item-"]') ||
        phoneEl.closest('[class*="list-item u-"]') ||
        phoneEl.closest('[class*="list-item-wrapper"]')?.parentElement ||
        phoneEl.closest('[class*="list-item"]');

      if (!container) continue;

      // Get text from the whole container including the date-time element
      const containerText = container.textContent || '';

      // Also specifically look for the date-time element which contains the timer
      const dateTimeEl = container.querySelector('[class*="list-item-date-time"], [class*="date-time"]');
      const dateTimeText = dateTimeEl?.textContent?.trim() || '';

      // Combine both for checking
      const fullText = containerText + ' ' + dateTimeText;

      // Check for timer, timestamp, and date
      const hasTimestamp = /\d{1,2}:\d{2}\s*(am|pm)/i.test(fullText);
      const hasDate = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i.test(fullText);
      const timerMatch = fullText.match(STRICT_TIMER_REGEX);

      // SKIP if it has am/pm timestamps - these are completed calls
      if (hasTimestamp) continue;

      // SKIP if it has date like "Dec 31" - these are historical
      if (hasDate) continue;

      // STRICT CHECK: Must have a timer in "Xm Xs" format
      if (!timerMatch) {
        // No timer found - skip this call
        continue;
      }

      // IMPORTANT: Skip calls that haven't been answered yet
      // If "Answer" or "Decline" buttons are present, the call is still ringing
      // The rep name shown might be from a previous interaction, not who's answering
      const answerBtn = container.querySelector('button[class*="btn--primary"]');
      const declineBtn = container.querySelector('button');
      const hasAnswerButton = answerBtn && /answer/i.test(answerBtn.textContent || '');
      const hasDeclineButton = declineBtn && /decline/i.test(declineBtn.textContent || '');

      if (hasAnswerButton || hasDeclineButton) {
        // Call is still ringing/incoming - not answered yet, skip it
        continue;
      }

      // Extract names using specific DOM elements
      let csrName = null;
      let customerName = null;

      // CSR/Agent name is in span.segment inside list-item-info
      const infoEl = container.querySelector('[class*="list-item-info"]');
      if (infoEl) {
        const segmentEl = infoEl.querySelector('[class*="segment"], span');
        if (segmentEl) {
          csrName = segmentEl.textContent?.trim() || null;
        }
      }

      // Customer name is in list-item-name
      const nameEl = container.querySelector('[class*="list-item-name"]');
      if (nameEl) {
        customerName = nameEl.textContent?.trim() || null;
      }

      // Fallback to regex if DOM elements not found
      if (!csrName || !customerName) {
        const allNames = containerText.match(/[A-Z][a-z]+ [A-Z][a-z]+/g) || [];
        if (!csrName && allNames.length >= 1) {
          csrName = allNames[0];
        }
        if (!customerName && allNames.length >= 2) {
          customerName = allNames[1];
        } else if (!customerName && allNames.length === 1) {
          customerName = allNames[0];
        }
      }

      // Return agentName as CSR name (for filtering), callerName as customer (for tab group)
      return {
        phoneNumber: phone,
        element: container,
        agentName: csrName,      // CSR handling the call - used for filtering
        callerName: customerName  // Customer - used for tab group title
      };
    }

    // Strategy 2: Look for "Hangup", "End Call", "Mute", "Keypad" buttons
    // These buttons appear ONLY when a call has been answered and is active.
    // They are the most reliable indicator that the "Answer" phase is over and we are "In Call".
    const potentialActiveButtons = document.querySelectorAll('button, [role="button"]');
    for (const btn of potentialActiveButtons) {
      const btnText = btn.textContent?.toLowerCase() || '';
      const btnLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
      const combinedText = btnText + ' ' + btnLabel;

      // Check for common in-call button text/labels
      const isInCallButton = combinedText.includes('hang up') ||
        combinedText.includes('hangup') ||
        combinedText.includes('end call') ||
        combinedText.includes('mute') ||
        combinedText.includes('keypad') ||
        combinedText.includes('transfer') ||
        combinedText.includes('hold');

      if (isInCallButton) {
        // This is likely an active call control
        // Ignore if it looks like a decline button for an incoming call (rare, but possible overlap)
        if (combinedText.includes('decline') || combinedText.includes('reject')) continue;

        // Try to find customer phone from call list (use same logic as timer detection)
        const phone = extractCustomerPhoneFromCallItem(btn);
        if (phone && phone.length >= 10) {
          // Walk up to find container for agent name
          let container = btn.parentElement;
          let depth = 0;
          while (container && depth < 6) {
            container = container.parentElement;
            depth++;
          }

          const agentName = container ? extractAgentNameFromElement(container) : null;
          console.log('[CallRail Extension] Found active call via In-Call button:', combinedText, 'Customer phone:', phone);
          return { phoneNumber: phone, element: container, agentName };
        }
      }
    }

    // NO active call found - this is the expected state most of the time
    return null;
  }

  // Handle detected incoming call
  function handleIncomingCall(callData) {
    if (!callData || !callData.phoneNumber) return;

    // Check if feature is still enabled
    if (!isFeatureEnabled) {
      return; // Silently skip - already logged in checkForCallStateChange
    }

    const phone = callData.phoneNumber;
    const csrName = callData.agentName;      // CSR handling the call (for filtering)
    const customerName = callData.callerName; // Customer name (for tab group title)

    // Prevent duplicate processing for the same call
    if (phone === activeCallPhoneNumber && isCallActive) {
      return; // Already processed this call
    }

    // Mark this call as active to prevent reprocessing
    isCallActive = true;
    activeCallPhoneNumber = phone;

    // Check if a CSR is configured and if the call's CSR matches
    if (configuredCsr || configuredCsrUser) {
      if (csrName) {
        // Try matching against primary CSR name (display name or user name)
        let isMatchingCsr = configuredCsr && namesMatch(csrName, configuredCsr);

        // If display name was set but didn't match, also try the user name as fallback
        if (!isMatchingCsr && configuredCsrUser && configuredCsrUser !== configuredCsr) {
          isMatchingCsr = namesMatch(csrName, configuredCsrUser);
        }

        // Also try display name if it exists and is different from primary
        if (!isMatchingCsr && configuredCsrDisplay && configuredCsrDisplay !== configuredCsr) {
          isMatchingCsr = namesMatch(csrName, configuredCsrDisplay);
        }

        if (!isMatchingCsr) {
          // Log once then return without searching - this call is for a different CSR
          const namesConfigured = [configuredCsr, configuredCsrUser, configuredCsrDisplay].filter(n => n).join(' / ');
          console.log('[CallRail Extension] Call handled by', csrName, '- not matching configured CSR:', namesConfigured);
          return;
        }
        console.log('[CallRail Extension] Call handled by', csrName, '- matches configured CSR');
      } else {
        // Could not detect CSR name - do NOT proceed if a CSR is configured
        // because we can't verify this is their call
        console.log('[CallRail Extension] Could not detect CSR name, skipping (cannot verify if this is the configured CSR\'s call)');
        return;
      }
    }

    // Prevent duplicate searches for the same number
    if (phone === lastSearchedNumber) {
      return; // Already searched for this number recently
    }

    console.log('[CallRail Extension] Triggering Roofr contact search for:', phone, 'CSR:', csrName, 'Customer:', customerName);
    lastSearchedNumber = phone;

    // Send message to service worker to handle Roofr tab
    try {
      chrome.runtime.sendMessage({
        type: 'CALLRAIL_INCOMING_CALL',
        phoneNumber: phone,
        formattedPhone: formatPhoneForDisplay(phone),
        callerName: customerName // Customer name for tab group title
      });
    } catch (e) {
      console.warn('[CallRail Extension] Extension context invalidated - please refresh the CallRail page');
      // Reset state since we couldn't send the message
      isCallActive = false;
      activeCallPhoneNumber = null;
    }
  }

  // Handle call ended
  function handleCallEnded() {
    console.log('[CallRail Extension] Call ended for:', activeCallPhoneNumber);

    // Notify service worker to clear tracking for this phone number
    if (activeCallPhoneNumber) {
      try {
        chrome.runtime.sendMessage({
          type: 'CALLRAIL_CALL_ENDED',
          phoneNumber: activeCallPhoneNumber
        });
      } catch (e) {
        // Extension context may be invalidated
      }
    }

    isCallActive = false;
    activeCallPhoneNumber = null;
    lastSearchedNumber = null; // Clear so if they call back immediately, we search again
  }

  // Check for call state changes
  function checkForCallStateChange() {
    if (!isFeatureEnabled) return;

    const activeCall = findActiveIncomingCall();

    if (activeCall) {
      // Only log if this is a new/different call than what we last logged
      const callKey = `${activeCall.phoneNumber}-${activeCall.agentName}`;
      if (callKey !== lastLoggedCallKey) {
        console.log('[CallRail Extension] Active call found:', {
          phone: activeCall.phoneNumber,
          agent: activeCall.agentName,
          isNewCall: !isCallActive,
          isDifferentCall: isCallActive && activeCall.phoneNumber !== activeCallPhoneNumber
        });
        lastLoggedCallKey = callKey;
      }
    } else if (lastLoggedCallKey) {
      // Call ended, reset the logged call key
      lastLoggedCallKey = null;
    }

    if (activeCall && !isCallActive) {
      // New active call detected
      handleIncomingCall(activeCall);
    } else if (activeCall && isCallActive && activeCall.phoneNumber !== activeCallPhoneNumber) {
      // Different call detected (rare, but handle it)
      handleIncomingCall(activeCall);
    } else if (!activeCall && isCallActive) {
      // Call appears to have ended (no longer in active section)
      handleCallEnded();
    }
  }

  // Debounce utility
  function debounce(fn, ms) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), ms);
    };
  }

  const debouncedCheck = debounce(checkForCallStateChange, 300);

  // Set up MutationObserver to watch for incoming calls
  function initObserver() {
    // Find the best container to observe
    const container = document.querySelector('[class*="lead-center"]') ||
      document.querySelector('[class*="LeadCenter"]') ||
      document.querySelector('[class*="lc-inbox"]') ||
      document.querySelector('[class*="call-list"]') ||
      document.querySelector('[class*="CallList"]') ||
      document.querySelector('main') ||
      document.body;

    const observer = new MutationObserver(debouncedCheck);

    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: ['class', 'data-state', 'data-status', 'style']
    });

    // Initial check
    checkForCallStateChange();

    // Also set up a periodic check as backup (every 2 seconds)
    // This catches any DOM changes the MutationObserver might miss
    setInterval(() => {
      if (isFeatureEnabled) {
        checkForCallStateChange();
      }
    }, 2000);

    console.log('[CallRail Extension] Observer initialized on', container.tagName || 'container', '+ periodic check every 2s');
  }

  // Handle messages from service worker
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'CALLRAIL_PING') {
      sendResponse({ ok: true, isCallActive, activeCallPhoneNumber, isFeatureEnabled });
      return true;
    }

    if (msg.type === 'CALLRAIL_CLEAR_CALL_STATE') {
      lastSearchedNumber = null;
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === 'CALLRAIL_SET_ENABLED') {
      isFeatureEnabled = msg.enabled;
      console.log('[CallRail Extension] Feature enabled state updated:', isFeatureEnabled);
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === 'GET_ACTIVE_CALLS') {
      const activeCalls = findAllActiveCalls();
      sendResponse({ ok: true, calls: activeCalls });
      return true;
    }

    return false;
  });

  // Listen for storage changes to update feature state in real-time
  chrome.storage.onChanged.addListener((changes, areaName) => {
    try {
      if (areaName === 'sync') {
        if (changes.callrail_enabled) {
          isFeatureEnabled = changes.callrail_enabled.newValue !== false;
          console.log('[CallRail Extension] Feature enabled changed to:', isFeatureEnabled);
        }
        // Handle callrail_csr from popup modal "Start Calls" button
        if (changes.callrail_csr) {
          const newCsr = changes.callrail_csr.newValue || '';
          // This is the primary CSR from the popup modal
          configuredCsr = newCsr;
          console.log('[CallRail Extension] Configured CSR changed to:', newCsr);
        }
        // Handle callrail_user from settings page
        if (changes.callrail_user) {
          configuredCsrUser = changes.callrail_user.newValue || '';
          // Only update primary CSR if callrail_csr isn't set
          if (!configuredCsr) {
            configuredCsr = configuredCsrUser;
          }
          console.log('[CallRail Extension] Configured CSR user changed to:', configuredCsrUser);
        }
        if (changes.callrail_display_name) {
          configuredCsrDisplay = changes.callrail_display_name.newValue || '';
          console.log('[CallRail Extension] Configured CSR display name changed to:', configuredCsrDisplay);
        }
      }
    } catch (e) {
      // Extension context may have been invalidated
      console.warn('[CallRail Extension] Storage listener error (context may be invalidated)');
    }
  });

  // Check if feature is enabled and initialize
  async function checkAndInit() {
    try {
      // Load all settings via message to service worker (content scripts can't access storage directly in MV3)
      const response = await chrome.runtime.sendMessage({ type: 'GET_CALLRAIL_SETTINGS' });
      const settings = response?.settings || {
        callrail_enabled: false,
        callrail_csr: '',
        callrail_user: '',
        callrail_display_name: ''
      };

      isFeatureEnabled = settings.callrail_enabled !== false;
      // Priority: callrail_csr (popup modal) > callrail_display_name > callrail_user (settings page)
      configuredCsr = settings.callrail_csr || '';
      configuredCsrUser = settings.callrail_user || '';
      configuredCsrDisplay = settings.callrail_display_name || '';

      console.log('[CallRail Extension] Settings loaded:', {
        enabled: isFeatureEnabled,
        primaryCsr: configuredCsr,
        userFromSettings: configuredCsrUser,
        displayName: configuredCsrDisplay
      });

      if (!isFeatureEnabled) {
        console.log('[CallRail Extension] Feature is disabled in settings, not initializing');
        return;
      }

      console.log('[CallRail Extension] Feature is enabled, initializing call detection...');
      initObserver();
    } catch (e) {
      console.warn('[CallRail Extension] Could not check settings, initializing anyway:', e);
      initObserver();
    }
  }

  // Initialize after a delay to ensure DOM is ready
  // Wait 3 seconds to allow CallRail to switch active calls from timestamp to timer format
  async function initWithDelay() {
    // Clear service worker tracking on page load/refresh (in case call was active before refresh)
    try {
      chrome.runtime.sendMessage({ type: 'CALLRAIL_PAGE_LOADED' });
      console.log('[CallRail Extension] Notified service worker of page load');
    } catch (e) {
      // Extension context may be invalidated
    }

    // Wait 3 seconds for CallRail to fully render and switch timestamps to timers
    await new Promise(r => setTimeout(r, 3000));
    await checkAndInit();

    // Do a second check 2 seconds later as a safety net
    // (catches calls that switched from timestamp to timer format after initial check)
    setTimeout(() => {
      if (isFeatureEnabled) {
        console.log('[CallRail Extension] Running secondary check for active calls');
        checkForCallStateChange();
      }
    }, 2000);
  }

  if (document.readyState === 'complete') {
    initWithDelay();
  } else {
    window.addEventListener('load', initWithDelay);
  }
}
// ==================================================
// END: CallRail Call Detection
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

  // Inject phone number into contacts search input (for CallRail integration)
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

  function parseDateFromClass(cls) {
    const m = cls.match(/-(\d{2})-(\d{2})-(\d{4})--/);
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1]);
  }

  function parseTimeRange(str) {
    const m = str.match(/(\d{1,2}(?::\d{2})?\s*[AP]M)\s*[–-]\s*(\d{1,2}(?::\d{2})?\s*[AP]M)/i);
    if (!m) return null;
    return [m[1], m[2]];
  }

  function extractTimes(el) {
    const title = el.getAttribute("title") || "";
    const labelEl = el.querySelector(".rbc-event-label");
    const label = labelEl ? labelEl.textContent.trim() : "";
    const src = title || label;
    const tr = parseTimeRange(src);
    if (!tr) return { start: null, end: null };

    const date = parseDateFromClass(el.className);
    if (!date) return { start: null, end: null };

    const s = parseTime12h(tr[0]), e = parseTime12h(tr[1]);
    if (!s || !e) return { start: null, end: null };

    const ds = new Date(date.getFullYear(), date.getMonth(), date.getDate(), s.h, s.min);
    const de = new Date(date.getFullYear(), date.getMonth(), date.getDate(), e.h, e.min);
    return { start: toLocalISO(ds), end: toLocalISO(de) };
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
    return Array.from(document.querySelectorAll(".rbc-event"));
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

    // Handle contact search injection from CallRail integration
    if (msg.type === "INJECT_CONTACT_SEARCH") {
      injectContactSearch(msg.phoneNumber).then(result => {
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
      const events = nodes.map(el => {
        const { start, end } = extractTimes(el);
        return { start, end, title: getTitle(el) };
      }).filter(e => e.start && e.end);
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
      batchOpenJobInNewTab(msg.address).then(result => {
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

    return false;
  });

  // ========================================
  // BATCH PROCESSING FUNCTIONS
  // ========================================

  // Helper to wait
  function batchSleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

    // Get all calendar events - be specific to avoid matching popups or other elements
    // React Big Calendar uses .rbc-event for the event wrapper, but the clickable part is often a button inside
    // We want the most specific element with the event content
    let events = document.querySelectorAll('.rbc-event-content');

    // If no rbc-event-content found, fall back to rbc-event buttons
    if (events.length === 0) {
      events = document.querySelectorAll('.rbc-event button, button.rbc-event');
    }

    // Final fallback to rbc-event but filter out things that look like popups
    if (events.length === 0) {
      const allEvents = document.querySelectorAll('.rbc-event');
      events = Array.from(allEvents).filter(e => {
        // Exclude if it's inside a popup/dialog
        const isInPopup = e.closest('[class*="EventCard"]') || e.closest('[role="dialog"]') || e.closest('.modal');
        return !isInPopup;
      });
    }

    console.log('[Batch] Found', events.length, 'calendar events');

    // Extract address number for initial search (e.g., "10545" from "10545 E Fanfol Ln")
    const addressNumber = address.match(/^\d+/)?.[0] || '';
    const streetPart = address.split(',')[0].trim().toLowerCase(); // e.g., "10545 e fanfol ln"
    const cityPart = address.split(',')[1]?.trim().toLowerCase() || ''; // e.g., "scottsdale"

    console.log('[Batch] Searching for address number:', addressNumber, 'street:', streetPart, 'city:', cityPart);

    // First pass: Find events matching the address number
    let matchingEvents = [];
    for (const event of events) {
      const eventText = event.textContent?.toLowerCase() || '';

      // Check if event contains the address number
      if (addressNumber && eventText.includes(addressNumber)) {
        matchingEvents.push({ event, text: eventText });
      }
    }

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

      // Wait and check for popup with retries
      let popupAppeared = null;
      let isNewEventDialog = false;

      for (let popupAttempt = 0; popupAttempt < 10; popupAttempt++) {
        await batchSleep(300);

        // Check if the "New event" dialog opened instead (wrong click target)
        const newEventDialog = document.querySelector('button[aria-label="Close this dialog"]')?.closest('[class*="EventCard"]');
        if (newEventDialog) {
          const dialogText = newEventDialog.textContent || '';
          if (dialogText.includes('New event') || dialogText.includes('Type...') || dialogText.includes('Add title')) {
            console.log('[Batch] ERROR: "New event" dialog opened instead of event popup - wrong element clicked');
            isNewEventDialog = true;

            // Close it by clicking the close button
            const closeBtn = document.querySelector('button[aria-label="Close this dialog"]');
            if (closeBtn) {
              closeBtn.click();
              await batchSleep(300);
            }
            break;
          }
        }

        // Check for the correct event popup (has the address button)
        popupAppeared = document.querySelector('[data-testid="job-map-options-dropdown-trigger"]');
        if (popupAppeared) {
          console.log('[Batch] Correct event popup appeared on attempt', popupAttempt + 1);
          break;
        }

        // Also check for EventCard that contains job info (not "New event")
        const eventCard = document.querySelector('[class*="EventCard"]');
        if (eventCard) {
          const cardText = eventCard.textContent || '';
          if (!cardText.includes('New event') && !cardText.includes('Add title') && cardText.includes(addressNumber)) {
            console.log('[Batch] Event popup (with matching address) appeared on attempt', popupAttempt + 1);
            popupAppeared = eventCard;
            break;
          }
        }

        console.log('[Batch] Waiting for popup, attempt', popupAttempt + 1);
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

    throw new Error(`Could not find event with address: ${address}`);
  }

  // Open job in new tab by clicking the address link in the event popup
  // Per Roofr DOM structure:
  // 1. Calendar event click opens a popup/card
  // 2. Inside popup, there's a button containing the address
  // 3. Clicking address button reveals a context menu with "Open job" link
  async function batchOpenJobInNewTab(address) {
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

    // Wait for popup to appear with retry logic
    let popup = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      await batchSleep(500);
      popup = findEventPopup();
      if (popup) {
        console.log('[Batch] Popup found on attempt', attempt + 1, ':', getClassName(popup).substring(0, 50));
        break;
      }
      console.log('[Batch] Waiting for popup, attempt', attempt + 1);
    }

    if (!popup) {
      console.log('[Batch] Popup not found after 8 attempts, continuing with fallback...');
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

    // Wait for dropdown with retry - the dropdown has data-testid="job-map-options-dropdown"
    for (let attempt = 0; attempt < 10; attempt++) {
      await batchSleep(300);

      // BEST: Find by specific data-testid (from screenshot)
      openJobLink = document.querySelector('[data-testid="job-map-options-dropdown-open-job"]');
      if (openJobLink) {
        console.log('[Batch] Found "Open job" link by data-testid on attempt', attempt + 1);
        break;
      }

      // Also check for the dropdown container
      const dropdown = document.querySelector('[data-testid="job-map-options-dropdown"]');
      if (dropdown) {
        console.log('[Batch] Found dropdown container, looking for Open job inside...');
        // Find the Open job link inside
        const linkInDropdown = dropdown.querySelector('a[href*="/jobs/"]');
        if (linkInDropdown) {
          openJobLink = linkInDropdown;
          console.log('[Batch] Found job link in dropdown');
          break;
        }
      }

      // Fallback: any link with /jobs/details/ that's visible
      const jobLinks = document.querySelectorAll('a[href*="/jobs/details/"]');
      for (const link of jobLinks) {
        const rect = link.getBoundingClientRect();
        const text = link.textContent?.toLowerCase() || '';
        if (rect.width > 0 && rect.height > 0 && text.includes('open')) {
          openJobLink = link;
          console.log('[Batch] Found job link by href on attempt', attempt + 1);
          break;
        }
      }
      if (openJobLink) break;

      console.log('[Batch] Dropdown not yet visible, attempt', attempt + 1);
    }

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

    // Extract job URL and open in new tab
    const jobUrl = openJobLink.href;
    if (jobUrl && jobUrl.includes('/jobs/')) {
      console.log('[Batch] Opening job URL:', jobUrl);
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
        window.open(link.href, '_blank');
        return { ok: true, needsTabLookup: true, url: link.href };
      }
    }

    return { ok: true, needsTabLookup: true };
  }

  // Edit event and add rep as invitee
  async function batchEditEventAddRep(address, time, repName) {
    console.log('[Batch] Editing event to add rep:', repName);

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
      // Fallback CSR list
      csrList = ["bronté pisz", "diva shahpur", "madison meyers", "nica javier", "raven pelfrey", "travis jones"];
    }

    // First, find and click the event again
    await batchFindAndClickEvent(address, time);
    await batchSleep(800);

    // Find and click the Edit button
    const editButton = Array.from(document.querySelectorAll('button'))
      .find(btn => btn.textContent?.trim().toLowerCase() === 'edit');

    if (!editButton) {
      throw new Error('Could not find Edit button');
    }

    console.log('[Batch] Clicking Edit button');
    editButton.click();
    await batchSleep(1000);

    // Check for existing invitees BEFORE doing anything else
    // Look for invitee rows (data-testid contains "calendar-card-invitees-row")
    const existingInviteeRows = document.querySelectorAll('[data-testid*="calendar-card-invitees-row"]');
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

          // Roofr bug: after canceling, calendar doesn't show all events
          // Fix: click "Select all" twice to refresh (deselect then reselect)
          console.log('[Batch] Refreshing calendar by toggling Select all...');
          await batchSleep(300);
          const selectAllCheckbox = document.querySelector('input[name="team-select-all"]') ||
                                   document.querySelector('[data-testid*="select-all"]') ||
                                   document.querySelector('input[type="checkbox"][id*="select"]');
          if (selectAllCheckbox) {
            // Click 1: Deselect all
            selectAllCheckbox.click();
            console.log('[Batch] Clicked Select all (deselect)');
            await batchSleep(800);
            // Click 2: Select all again to reload events
            selectAllCheckbox.click();
            console.log('[Batch] Clicked Select all (reselect)');
            await batchSleep(1000);
          } else {
            console.log('[Batch] Could not find Select all checkbox');
          }

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

        if (isCsr) {
          console.log('[Batch] Existing invitee is a CSR:', inviteeName, '- removing them first...');

          // Find the remove button - try multiple approaches
          let removeButton = row.querySelector('[data-testid="calendar-card-invitees-item-remove"]');

          if (!removeButton) {
            // Try finding any button in the row
            removeButton = row.querySelector('button');
            console.log('[Batch] Fallback: found button in row:', removeButton?.className);
          }

          if (!removeButton) {
            // Try finding globally near the invitee name
            const allRemoveButtons = document.querySelectorAll('[data-testid="calendar-card-invitees-item-remove"]');
            console.log('[Batch] Found', allRemoveButtons.length, 'remove buttons globally');
            if (allRemoveButtons.length > 0) {
              removeButton = allRemoveButtons[0]; // Take the first one (should be the visible one)
            }
          }

          if (removeButton) {
            console.log('[Batch] Clicking remove button for CSR:', removeButton.className);
            removeButton.click();
            await batchSleep(800);
            console.log('[Batch] CSR removed, waiting for UI update...');
            await batchSleep(500);
          } else {
            console.log('[Batch] Could not find remove button for CSR');
            // Log the row HTML for debugging
            console.log('[Batch] Row HTML:', row.innerHTML?.substring(0, 300));
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
    return { ok: true };
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

    // Step 2: Type the rep name to filter the dropdown
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await batchSleep(200);

    // Type character by character
    console.log('[Batch] Typing rep name:', repName);
    for (const char of repName) {
      input.value += char;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
      await batchSleep(100);
    }
    await batchSleep(1500); // Wait for dropdown to filter

    console.log('[Batch] Typed rep name, looking for dropdown option...');

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
        const text = option.textContent?.trim() || '';
        const rect = option.getBoundingClientRect();

        // Check if this option matches the rep name and is visible
        if (text.toLowerCase() === repName.toLowerCase() ||
          (text.toLowerCase().includes(repName.toLowerCase()) && text.length < repName.length + 20)) {
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
          const fullText = el.textContent?.trim() || '';
          const rect = el.getBoundingClientRect();

          if (fullText.toLowerCase() === repName.toLowerCase() &&
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

    // Last resort: try keyboard navigation
    if (!foundAndClicked) {
      console.warn('[Batch] Could not find rep in dropdown, trying keyboard selection...');
      // Press down arrow to highlight first option, then Enter
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
      await batchSleep(300);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      await batchSleep(500);
    }

    // Find and click Save button
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
        // Wait for save to complete and page to reload
        await batchSleep(4000);
        console.log('[Batch] Save completed, waiting for page refresh...');
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

// Detect current calendar view (Monthly, Weekly, or Daily)
function getCurrentCalendarView() {
  // Check for view selector dropdown or buttons
  // Look for active view indicator in the toolbar

  // Strategy 1: Check for dropdown menu text showing current view
  const dropdownBtn = document.querySelector('[class*="dropdown"] button, button[aria-haspopup="listbox"]');
  if (dropdownBtn) {
    const text = dropdownBtn.textContent?.trim().toLowerCase();
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
      // Make sure it's a clickable day cell (not header or other element)
      const rect = cell.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.width < 60 && rect.height < 60) {
        // Check if it's within the mini calendar area (left side panel)
        if (rect.left < window.innerWidth / 2) {
          console.log('[Roofr Extension] Clicking day:', day);
          cell.click();
          return { ok: true, clicked: true, day, month, year };
        }
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
function selectSalesEventType() {
  console.log('[Roofr Extension] Looking for Sales checkbox...');

  // Strategy 1: Find the Sales row in Event types section
  // The UI shows colored boxes next to event type names
  // Look for elements that contain "Sales" text and have a checkbox nearby
  const allElements = document.querySelectorAll('*');

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

// Select all team members
function selectAllTeamMembers() {
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
        clickable.click();
        return { ok: true, clicked: true };
      }

      // Try clicking the element directly
      el.click();
      return { ok: true, clicked: true };
    }
  }

  // Fallback: look for checkbox by aria-label or data attribute
  const selectAllCheckbox = document.querySelector('[aria-label*="select all" i], [data-testid*="select-all"]');
  if (selectAllCheckbox) {
    selectAllCheckbox.click();
    return { ok: true, clicked: true };
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
      contactName: null
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


import { CONFIG, PEOPLE_DATA } from './config.js';
import { THEMES, applyTheme } from './themes.js';

document.addEventListener('DOMContentLoaded', async () => {

    // Track the window ID where the extension was opened - ALL tab operations should use this window
    // This ensures multiple browser windows with the same profile don't interfere with each other
    window.__targetWindowId = null;
    try {
        const currentWindow = await chrome.windows.getCurrent();
        window.__targetWindowId = currentWindow.id;
        console.log('[Popup] Initialized with target window ID:', window.__targetWindowId);
    } catch (e) {
        console.warn('[Popup] Could not get current window ID:', e);
    }

    // ========================================
    // AUTO-UPDATE BANNER LOGIC
    // ========================================
    const updateBanner = document.getElementById('update-banner');
    const updateNewVersion = document.getElementById('update-new-version');
    const updateCurrentVersion = document.getElementById('update-current-version');
    const updateShowChangelog = document.getElementById('update-show-changelog');
    const updateChangelog = document.getElementById('update-changelog');
    const updateDownloadBtn = document.getElementById('update-download-btn');
    const updateDismissBtn = document.getElementById('update-dismiss-btn');
    let currentUpdateInfo = null;

    async function checkAndDisplayUpdate() {
        try {
            const response = await chrome.runtime.sendMessage({ type: 'GET_UPDATE_STATUS' });
            if (response?.update?.available) {
                currentUpdateInfo = response.update;
                displayUpdateBanner(response.update);
            }
        } catch (e) {
            console.warn('[Update] Failed to check update status:', e);
        }
    }

    function displayUpdateBanner(update) {
        if (!updateBanner) return;

        updateNewVersion.textContent = `v${update.newVersion}`;
        updateCurrentVersion.textContent = `v${update.currentVersion}`;

        // Show changelog button if there are changes
        if (update.changelog && update.changelog.length > 0) {
            updateShowChangelog.style.display = 'block';
            updateChangelog.innerHTML = update.changelog.map(item => `<li>${item}</li>`).join('');
        } else {
            updateShowChangelog.style.display = 'none';
        }

        updateBanner.style.display = 'block';
    }

    // Toggle changelog visibility
    if (updateShowChangelog) {
        updateShowChangelog.addEventListener('click', () => {
            const isHidden = updateChangelog.style.display === 'none';
            updateChangelog.style.display = isHidden ? 'block' : 'none';
            updateShowChangelog.textContent = isHidden ? 'Hide changes' : 'View changes';
        });
    }

    // Download button - open GitHub release
    if (updateDownloadBtn) {
        updateDownloadBtn.addEventListener('click', () => {
            if (currentUpdateInfo?.downloadUrl) {
                chrome.tabs.create({ url: currentUpdateInfo.downloadUrl });
            }
        });
    }

    // Dismiss button - hide banner for this version
    if (updateDismissBtn) {
        updateDismissBtn.addEventListener('click', async () => {
            if (currentUpdateInfo?.newVersion) {
                await chrome.runtime.sendMessage({
                    type: 'DISMISS_UPDATE',
                    version: currentUpdateInfo.newVersion
                });
                updateBanner.style.display = 'none';
                currentUpdateInfo = null;
            }
        });
    }

    // Check for updates on popup open
    checkAndDisplayUpdate();

    // Check if we were opened as a popup with a target tab ID
    const urlParams = new URLSearchParams(window.location.search);
    const targetTabIdFromUrl = urlParams.get('targetTabId');
    const targetWindowIdFromUrl = urlParams.get('targetWindowId');
    const isPopoutMode = !!targetTabIdFromUrl || window.opener !== null;

    if (targetTabIdFromUrl) {
        window.__targetRoofrTabId = parseInt(targetTabIdFromUrl, 10);
        console.log('[Popup] Initialized with target tab ID:', window.__targetRoofrTabId);
    }

    // If window ID was passed via URL, use that (for popout mode)
    if (targetWindowIdFromUrl) {
        window.__targetWindowId = parseInt(targetWindowIdFromUrl, 10);
        console.log('[Popup] Using window ID from URL:', window.__targetWindowId);
    }

    // If in popout mode, verify connection to Roofr tab
    if (isPopoutMode) {
        setTimeout(async () => {
            // Find and verify Roofr tab connection
            let foundTab = false;

            if (window.__targetRoofrTabId) {
                try {
                    const tab = await chrome.tabs.get(window.__targetRoofrTabId);
                    if (tab?.url?.includes('app.roofr.com')) {
                        foundTab = true;
                        console.log('[Popup] Connected to Roofr tab:', tab.id);
                    }
                } catch (e) {
                    window.__targetRoofrTabId = null;
                }
            }

            if (!foundTab) {
                // Search for Roofr tabs in the target window only
                const queryOpts = { url: "*://app.roofr.com/*" };
                if (window.__targetWindowId) queryOpts.windowId = window.__targetWindowId;
                const roofrTabs = await chrome.tabs.query(queryOpts);
                if (roofrTabs.length > 0) {
                    window.__targetRoofrTabId = roofrTabs[0].id;
                    foundTab = true;
                    console.log('[Popup] Found Roofr tab:', roofrTabs[0].id);
                }
            }

            // Show status toast
            const toast = document.getElementById('toast');
            if (toast) {
                if (foundTab) {
                    toast.textContent = 'Connected to Roofr tab';
                    toast.style.background = 'var(--success)';
                } else {
                    toast.textContent = 'No Roofr tab found - open app.roofr.com';
                    toast.style.background = 'var(--danger)';
                }
                toast.classList.add('show');
                setTimeout(() => {
                    toast.classList.remove('show');
                    toast.style.background = ''; // Reset
                }, 3000);
            }
        }, 500); // Small delay to ensure DOM is ready

        // Listen for tab updates to auto-reconnect if a Roofr tab becomes available
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete' && tab.url?.includes('app.roofr.com')) {
                if (!window.__targetRoofrTabId) {
                    window.__targetRoofrTabId = tabId;
                    console.log('[Popup] Auto-connected to new Roofr tab:', tabId);
                }
            }
        });
    }

    let logs = [];
    function addLog(message, type = 'INFO') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `[${timestamp} ${type}] ${message}`;
        logs.push(logEntry);
        console.log(`[${type}] ${message}`); // Always log to console for debugging
        if (type === 'ERROR') console.error(message);
    }

    /* ========= DOM refs ========= */
    const scanBtn = document.getElementById("scanBtn");
    const linksBtn = document.getElementById("linksBtn");
    const linksMenu = document.getElementById("linksMenu");
    const toggleAllBtn = document.getElementById("toggleAll");
    const daysWrap = document.getElementById("days");
    const footerTotal = document.getElementById("footerTotal");
    const addrInput = document.getElementById("addrInput");
    const addrClearBtn = document.getElementById("addrClearBtn");
    const addrGoBtn = document.getElementById("addrGoBtn");
    const assignedRepDisplay = document.getElementById("assigned-rep-display");
    const mainTabs = Array.from(document.querySelectorAll(".nav-tab"));
    const sections = {
        "sec-scanner": document.getElementById("sec-scanner"),
        "sec-sorting": document.getElementById("sec-sorting"),
        "sec-reports": document.getElementById("sec-reports"),
        "sec-people": document.getElementById("sec-people"),
        "sec-clipboard": document.getElementById("sec-clipboard"),
    };
    const regionPills = Array.from(document.querySelectorAll(".region-pill"));
    const stickyHeader = document.getElementById("sticky-header");
    const scannerToolbar = document.getElementById("scanner-toolbar");
    const recoOptions = document.getElementById("reco-options"); // Adjacent cities buttons
    const verifiedAddressesList = document.getElementById("verified-addresses-container"); // Autofill container (custom div)

    // Global Find Bar
    const findInput = document.getElementById("global-find-q");
    const findClearBtn = document.getElementById("global-find-clear");
    const findCounter = document.getElementById("global-find-counter");
    const findPrevBtn = document.getElementById("global-find-prev");
    const findNextBtn = document.getElementById("global-find-next");

    // Dock Notes
    const dockNoteInput = document.getElementById("dock-note-input");
    const dockNoteSaveBtn = document.getElementById("dock-note-save-btn");
    const dockResizeHandle = document.getElementById("dock-resize-handle");
    const dockNoteToggleFormat = document.getElementById("dock-note-toggle-format");
    const dockNoteSizeDown = document.getElementById("dock-note-size-down");
    const dockNoteSizeUp = document.getElementById("dock-note-size-up");
    const dockNoteSizeDisplay = document.getElementById("dock-note-size-display");
    const popoutBtn = document.getElementById("popout-btn");

    const repsList = document.getElementById("repsList");
    const csrsList = document.getElementById("csrsList");
    const mgmtList = document.getElementById("mgmtList");

    // Read B6 Button
    const readB6Btn = document.getElementById("readB6Btn");
    const b6Result = document.getElementById("b6Result");

    // Clipboard
    const clipboardContainer = document.getElementById('clipboard-container');
    const addClipboardBtn = document.getElementById('add-clipboard-btn');
    const uploadClipboardBtn = document.getElementById('upload-clipboard-btn');
    const clipboardFileInput = document.getElementById('clipboard-file-input');

    // Job Sorting
    const jobListContainer = document.getElementById('job-list-container');
    const jobSortFilters = {
        tags: document.getElementById('sort-filter-tags'),
        roofType: document.getElementById('sort-filter-roofType'),
        jobType: document.getElementById('sort-filter-jobType'),
        city: document.getElementById('sort-filter-city'),
        stories: document.getElementById('sort-filter-stories'),
        day: document.getElementById('sort-filter-day'),
        time: document.getElementById('sort-filter-time'),
    };

    // Open Active Calls Button (phone icon)
    const openActiveCallsBtn = document.getElementById('openActiveCallsBtn');

    // Settings Modal
    const settingsBtn = document.getElementById("settingsBtn");
    const settingsModal = document.getElementById("settings-modal");
    const closeSettingsBtn = document.getElementById("close-settings-btn");
    const goToSettingsBtn = document.getElementById("go-to-settings-btn");
    const openAdvOptionsBtn = document.getElementById("open-adv-options");

    // Settings Inputs
    const settingTheme = document.getElementById("setting-theme");
    const settingFontSize = document.getElementById("setting-font-size");
    const settingCompact = document.getElementById("setting-compact");
    const settingGlobalPanel = document.getElementById("setting-global-panel");
    const settingAutoScan = document.getElementById("setting-autoscan");
    const settingAutoScanWeek = document.getElementById("setting-autoscan-week");
    const settingShowUncat = document.getElementById("setting-show-uncat");
    const settingIdlePopup = document.getElementById("setting-idle-popup");
    const settingDefaultRegion = document.getElementById("setting-default-region");
    const settingShowJobSorting = document.getElementById("setting-show-job-sorting");
    const settingShowPeople = document.getElementById("setting-show-people");
    const settingShowClipboard = document.getElementById("setting-show-clipboard");
    const settingShowReports = document.getElementById("setting-show-reports");
    const settingShowNotes = document.getElementById("setting-show-notes");
    const settingShowFind = document.getElementById("setting-show-find");

    // Idle Recommendation Modal (legacy - keeping for settings)
    const idleModal = document.getElementById("idle-modal");
    const idleDismissBtn = document.getElementById("idle-dismiss-btn");
    const idleRecoAddress = document.getElementById("idle-reco-address");
    const idleRecoBtn = document.getElementById("idle-reco-btn");
    const idlePriorityDesc = document.getElementById("idle-priority-desc");
    const idlePriorityBtns = document.querySelectorAll(".idle-priority-btn");
    const settingIdleTimeout = document.getElementById("setting-idle-timeout");
    const idleTimeoutRow = document.getElementById("idle-timeout-row");

    // Main priority pills (inline in scanner)
    const mainPriorityPills = document.querySelectorAll(".priority-pill");

    // Address Input Recommendation Modal
    const addressRecoModal = document.getElementById("address-reco-modal");
    const addressRecoInput = document.getElementById("address-reco-input");
    const addressRecoBtn = document.getElementById("address-reco-btn");
    const closeAddressRecoBtn = document.getElementById("close-address-reco-btn");
    const addressPriorityDesc = document.getElementById("address-priority-desc");
    const addressPriorityBtns = addressRecoModal ? addressRecoModal.querySelectorAll(".idle-priority-btn") : [];

    // Toast
    const toast = document.getElementById("toast");

    const AFFIRMATIONS = [
        "You got this!", "Time to raise the roof!", "Stay cool up there.", "Nailed it!", "Don't worry, it's over your head.", "Every shingle counts.", "Safety first, speed second.", "Roofing: It's a high calling.", "Keep hammering away!", "You're on top of the world!"
    ];

    /* ========= State Management ========= */
    const SHARED_STATE_KEY = 'roofr_shared_state';
    const CLIPBOARDS_KEY = 'roofr_clipboards_data';
    const USER_PREFS_KEY = 'roofr_user_prefs';
    const DYNAMIC_CITIES_KEY = 'roofr_dynamic_cities';

    // Google Sheet for cities database
    const CITIES_SHEET_ID = '1cFFEZNl7wXt40riZHnuZxGc1Zfm5lTlOz0rDCWGZJ0g';
    const CITIES_SHEET_TAB = 'Appointment Blocks'; // Tab name where cities are stored
    const CITIES_RANGE = 'A82:C200'; // PHX in A, North in B, South in C starting at row 82

    let state = {
        currentRegion: "PHX",
        allEvents: [],
        parsedJobs: [],
        availability: { PHX: null, SOUTH: null, NORTH: null, ALL: null },
        weekDays: [], // This will now store the exact visible days
        addressInput: "",
        highlightedCity: null,
        recoCandidates: [],
        recoIndex: 0,
        regionOverrides: {}, // Store overrides mapping: "Event Title + Start Time" -> "PHX" | "NORTH" | "SOUTH"
        dayCutoffs: [], // Array of booleans for Mon-Sun indicating if day is cutoff
        ignoredEvents: {}, // Store ignored uncategorized events: "Event Title + Start Time" -> true
        earliestAvailableByCity: {}, // Track earliest available date per city across weeks: { "MESA": "2025-12-27", ... }
        recentAddresses: [], // Track last 3 entered addresses/cities for quick access
        lastNavDirection: null, // Track last week navigation direction to prevent loops
        weekNavCount: 0 // Count of week navigations to prevent infinite loops
    };
    let clipboards = [];
    let findStats = { count: 0, index: 0 };
    let settings = {};
    let pageDatesISO = null;
    let userAddedCities = { PHX: [], NORTH: [], SOUTH: [] };

    let userPrefs = {
        theme: 'light',
        fontSizeStep: 0,
        compactView: false,
        globalPanel: true,
        autoScan: false,
        autoScanWeek: true,
        showUncatCollapsed: true, // Default to true now based on request
        idlePopup: true, // Default enabled
        idleTimeout: 60000, // Default 1 minute
        defaultRegion: 'PHX',
        showJobSortingTab: false,
        showPeopleTab: true,
        showClipboardTab: true,
        showReportsTab: false,
        showQuickNotes: true,
        showFindBar: true
    };

    function showToast(msg) {
        if (!toast) return;
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    }

    // Phone number detection - returns normalized phone if valid, null otherwise
    function detectPhoneNumber(input) {
        if (!input) return null;

        // First, check if this looks like an address (not a phone number)
        // Address indicators: street types, city/state patterns, zip codes at end
        const addressIndicators = /\b(rd|road|st|street|ave|avenue|blvd|boulevard|ln|lane|dr|drive|ct|court|cir|circle|way|pl|place|pkwy|parkway|hwy|highway)\b/i;
        const statePattern = /\b(AZ|CA|TX|NV|NM|CO|UT|OR|WA|FL|GA|NC|SC|VA|MD|PA|NY|NJ|OH|MI|IL|MO|TN|AL|MS|LA|AR|OK|KS|NE|SD|ND|MT|WY|ID|HI|AK|WI|MN|IA|IN|KY|WV|DE|CT|RI|MA|VT|NH|ME|DC)\b/i;
        const cityStateZipPattern = /,\s*[A-Za-z\s]+,?\s*(AZ|CA|TX|NV|NM|CO|UT|OR|WA|FL|GA|NC|SC|VA|MD|PA|NY|NJ|OH|MI|IL|MO|TN|AL|MS|LA|AR|OK|KS|NE|SD|ND|MT|WY|ID|HI|AK|WI|MN|IA|IN|KY|WV|DE|CT|RI|MA|VT|NH|ME|DC)?\s*\d{5}(-\d{4})?$/i;

        // If input contains address indicators, it's an address, not a phone
        if (addressIndicators.test(input) || statePattern.test(input) || cityStateZipPattern.test(input)) {
            return null;
        }

        // Check for actual phone number patterns (must have some formatting or be just digits)
        // Pattern: optional +1 or 1, then 10 digits with optional separators
        const phonePattern = /^[\s]*(\+?1?[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})[\s]*$/;
        const match = input.match(phonePattern);

        if (match) {
            // Extract the 10 digits from the matched groups
            return match[2] + match[3] + match[4];
        }

        // Also accept pure 10-digit or 11-digit (with leading 1) strings
        const digitsOnly = input.replace(/\D/g, '');
        if (input.replace(/[\s\-().+]/g, '').length === digitsOnly.length) {
            // Input was mostly just digits and phone punctuation
            if (digitsOnly.length === 10) {
                return digitsOnly;
            }
            if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
                return digitsOnly.substring(1);
            }
        }

        return null;
    }

    // Format phone number for display
    function formatPhoneForDisplay(digits) {
        if (!digits || digits.length !== 10) return digits;
        return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
    }

    function updateScanButtonState() {
        if (!scanBtn) return;
        const isOutOfSync = pageDatesISO && state.weekDays && JSON.stringify(pageDatesISO) !== JSON.stringify(state.weekDays);
        if (isOutOfSync) {
            scanBtn.textContent = "Scan New Week";
            scanBtn.style.backgroundColor = '#f59e0b'; // Warn color
            scanBtn.title = `The calendar view has changed. Click to scan the new visible dates.`;
        } else {
            scanBtn.textContent = "Scan Page";
            scanBtn.style.backgroundColor = '';
            scanBtn.title = '';
        }
    }

    function renderUIFromState() {
        addLog(`Rendering UI for region: ${state.currentRegion}`);
        regionPills.forEach(t => t.classList.toggle("active", t.dataset.region === state.currentRegion));
        if (addrInput) {
            addrInput.value = state.addressInput || "";
            updateAddressClearButton();
        }
        applyRegionFilter();
        populateVerifiedAddresses();
    }

    function updateAddressClearButton() {
        // Clear adjacent city options if no address
        if (!addrInput?.value && recoOptions) {
            recoOptions.innerHTML = '';
            recoOptions.classList.add('hidden');
        }
        // Show/hide the clear button (× inside input) based on input value
        if (addrClearBtn) {
            const hasAddress = addrInput?.value?.trim();
            addrClearBtn.classList.toggle('hidden', !hasAddress);
        }
        // Go button always stays as "Go"
    }

    function updateFindClearButton() {
        if (findClearBtn && findInput) findClearBtn.classList.toggle("hidden", !findInput.value);
    }

    function populateVerifiedAddresses() {
        // This is now just a fallback for cities - actual address suggestions come from API
        if (!verifiedAddressesList) return;

        // Only populate with cities if we don't have API suggestions
        if (verifiedAddressesList.children.length > 0) return;

        // Add cities from all known regions for quick lookup as fallback
        const citySet = new Set();
        for (const regionKey of ['PHX', 'NORTH', 'SOUTH']) {
            const cities = CONFIG.REGION_CITY_WHITELISTS[regionKey];
            if (cities) {
                for (const city of cities) {
                    citySet.add(city);
                }
            }
        }

        const sortedCities = Array.from(citySet).sort();
        for (const city of sortedCities) {
            const option = document.createElement('option');
            option.value = city;
            verifiedAddressesList.appendChild(option);
        }
    }

    // Save address to recent addresses list (max 3, most recent first)
    function saveRecentAddress(address) {
        if (!address || address.length < 2) return;

        const trimmed = address.trim();
        // Remove if already exists (will re-add at front)
        state.recentAddresses = state.recentAddresses.filter(a => a.toLowerCase() !== trimmed.toLowerCase());
        // Add to front
        state.recentAddresses.unshift(trimmed);
        // Keep only last 3
        state.recentAddresses = state.recentAddresses.slice(0, 3);
        debouncedSaveState();
    }

    // Show recent addresses dropdown when input is focused and empty
    function showRecentAddresses() {
        if (!verifiedAddressesList || !state.recentAddresses || state.recentAddresses.length === 0) return;
        if (addrInput?.value?.trim()) return; // Only show when input is empty

        verifiedAddressesList.innerHTML = '';

        // Add header
        const header = document.createElement('div');
        header.className = 'suggestion-header';
        header.textContent = 'Recent';
        verifiedAddressesList.appendChild(header);

        // Add recent addresses
        for (const address of state.recentAddresses) {
            const item = document.createElement('div');
            item.className = 'suggestion-item';
            item.textContent = address;

            item.addEventListener('click', () => {
                if (addrInput) {
                    addrInput.value = address;
                    addrInput.dispatchEvent(new Event('input', { bubbles: true }));
                    verifiedAddressesList.classList.add('hidden');
                    updateGoButtonState();
                }
            });

            verifiedAddressesList.appendChild(item);
        }

        verifiedAddressesList.classList.remove('hidden');
    }

    // Fetch address suggestions using multiple geocoding APIs for better coverage
    // Helper to add options to the custom suggestions container
    const addOption = (address, addedAddresses) => {
        if (!verifiedAddressesList || !address || address.length <= 3) return;

        const titleCaseAddress = toTitleCase(address);
        if (!addedAddresses.has(titleCaseAddress)) {
            addedAddresses.add(titleCaseAddress);

            const item = document.createElement("div");
            item.className = "suggestion-item";
            item.textContent = titleCaseAddress;

            item.addEventListener("click", () => {
                if (addrInput) {
                    // Set value and trigger input event
                    addrInput.value = titleCaseAddress;
                    addrInput.dispatchEvent(new Event("input", { bubbles: true }));

                    // Hide suggestions
                    verifiedAddressesList.classList.add("hidden");

                    // Trigger button state update
                    updateGoButtonState();
                }
            });

            verifiedAddressesList.appendChild(item);
        }
    };

    // Helper to convert to title case (capitalize first letter of each word)
    const toTitleCase = (str) => {
        if (!str) return str;

        // Words that should stay uppercase (state abbreviations, directions)
        const keepUppercase = ['AZ', 'CA', 'NV', 'NM', 'UT', 'TX', 'CO', 'N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'USA', 'US'];
        // Words that should stay lowercase
        const keepLowercase = ['of', 'the', 'and', 'at'];

        return str.split(' ').map((word, index) => {
            const upperWord = word.toUpperCase();
            if (keepUppercase.includes(upperWord)) {
                return upperWord;
            }
            if (index > 0 && keepLowercase.includes(word.toLowerCase())) {
                return word.toLowerCase();
            }
            // Capitalize first letter, lowercase the rest
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        }).join(' ');
    };

    // Fetch address suggestions using multiple geocoding APIs for better coverage
    async function fetchAddressSuggestions(query) {
        if (!verifiedAddressesList) return;

        // Hide if query is too short
        if (!query || query.length < 3) {
            verifiedAddressesList.classList.add('hidden');
            return;
        }

        // Clear existing options first
        verifiedAddressesList.innerHTML = '';
        const addedAddresses = new Set();
        let hasResults = false;

        try {
            // Try LocationIQ first - has better residential address coverage
            // Free tier: 5000 requests/day
            const locationIQKey = 'pk.c79c63c7e7d0dcbde7a65c67af5de77f'; // Free tier demo key
            const locationIQUrl = `https://us1.locationiq.com/v1/autocomplete?key=${locationIQKey}&q=${encodeURIComponent(query)}&countrycodes=us&limit=10&dedupe=1&tag=place:house,place:address,highway:residential`;

            const locationIQResponse = await fetch(locationIQUrl);

            if (locationIQResponse.ok) {
                const locationIQData = await locationIQResponse.json();

                for (const result of locationIQData) {
                    const addr = result.address || {};
                    const state = addr.state || '';

                    // Filter to Arizona and nearby states
                    if (state && !['Arizona'].includes(state) &&
                        !['Nevada', 'California', 'New Mexico', 'Utah'].includes(state)) {
                        continue;
                    }

                    // Build formatted address
                    let parts = [];

                    // Street address
                    if (addr.house_number && addr.road) {
                        parts.push(`${addr.house_number} ${addr.road}`);
                    } else if (addr.road) {
                        parts.push(addr.road);
                    } else if (result.display_name) {
                        // Use first part of display name
                        const displayParts = result.display_name.split(',');
                        if (displayParts[0]) parts.push(displayParts[0].trim());
                    }

                    // City
                    const city = addr.city || addr.town || addr.village || addr.hamlet || addr.municipality;
                    if (city) parts.push(city);

                    // State abbreviation
                    if (state) {
                        const stateMap = { 'Arizona': 'AZ', 'Nevada': 'NV', 'California': 'CA', 'New Mexico': 'NM', 'Utah': 'UT' };
                        parts.push(stateMap[state] || state);
                    }

                    // Zip code
                    if (addr.postcode) parts.push(addr.postcode);

                    const formatted = parts.join(', ');
                    if (formatted.length > 5) {
                        addOption(formatted, addedAddresses);
                        hasResults = true;
                    }
                }
            }

            // If we didn't get enough results, also try Geoapify
            if (addedAddresses.size < 5) {
                const geoapifyKey = 'a23dc46289844c50a3b12c3ab8b6759b';
                const geoapifyUrl = `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(query)}&filter=countrycode:us&bias=proximity:-112.07,33.45&limit=8&apiKey=${geoapifyKey}`;

                try {
                    const geoapifyResponse = await fetch(geoapifyUrl);

                    if (geoapifyResponse.ok) {
                        const geoapifyData = await geoapifyResponse.json();

                        for (const feature of geoapifyData.features || []) {
                            const props = feature.properties;
                            const state = props.state || '';

                            // Filter to Arizona and nearby states
                            if (state && !['Arizona', 'AZ'].includes(state) &&
                                !['Nevada', 'NV', 'California', 'CA', 'New Mexico', 'NM', 'Utah', 'UT'].includes(state)) {
                                continue;
                            }

                            let formattedAddress = props.formatted || '';
                            formattedAddress = formattedAddress.replace(/,?\s*United States\s*$/i, '').trim();
                            addOption(formattedAddress, addedAddresses);
                            hasResults = true;
                        }
                    }
                } catch (e) {
                    console.log('Geoapify error', e);
                }
            }

            // Also try the US Census Bureau geocoder for exact matches (best for US addresses)
            if (addedAddresses.size < 3) {
                const censusUrl = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(query + ', AZ')}&benchmark=Public_AR_Current&format=json`;

                try {
                    const censusResponse = await fetch(censusUrl);
                    if (censusResponse.ok) {
                        const censusData = await censusResponse.json();
                        const matches = censusData.result?.addressMatches || [];

                        for (const match of matches) {
                            const formatted = match.matchedAddress;
                            if (formatted) {
                                // Clean up the address format
                                const cleaned = formatted.replace(/,\s*USA?\s*$/i, '').trim();
                                addOption(cleaned, addedAddresses);
                                hasResults = true;
                            }
                        }
                    }
                } catch (e) {
                    // Census API can be slow, don't block on errors
                }
            }

            addLog(`Fetched ${addedAddresses.size} address suggestions from APIs`);

        } catch (error) {
            addLog(`Address suggestion error: ${error.message}`, 'WARN');
        }

        // Also add matching cities from our whitelists for quick access
        const queryUpper = query.toUpperCase();
        for (const regionKey of ['PHX', 'NORTH', 'SOUTH']) {
            const cities = CONFIG.REGION_CITY_WHITELISTS[regionKey];
            if (cities) {
                for (const city of cities) {
                    if (city.includes(queryUpper)) {
                        addOption(city, addedAddresses);
                        hasResults = true;
                    }
                }
            }
        }

        // Show/hide container based on results
        // Don't show if the only suggestion matches the current input (already verified)
        const currentInputValue = addrInput?.value?.trim() || '';
        const suggestions = Array.from(addedAddresses);
        const onlyMatchesInput = suggestions.length === 1 &&
            suggestions[0].toLowerCase() === currentInputValue.toLowerCase();

        if (hasResults && addedAddresses.size > 0 && !onlyMatchesInput) {
            verifiedAddressesList.classList.remove('hidden');
        } else {
            verifiedAddressesList.classList.add('hidden');
        }
    }

    // Close suggestions when clicking outside
    document.addEventListener("click", (e) => {
        if (verifiedAddressesList && !verifiedAddressesList.classList.contains("hidden")) {
            // If click is outside the input and the list
            if (!e.target.closest("#verified-addresses-container") && e.target.id !== "addrInput") {
                verifiedAddressesList.classList.add("hidden");
            }
        }
    });

    // Debounced version for typing
    const debouncedFetchAddressSuggestions = debounce(fetchAddressSuggestions, 300);

    const debouncedSaveState = debounce(async () => {
        if (chrome.storage && chrome.storage.local) await chrome.storage.local.set({ [SHARED_STATE_KEY]: state });
        addLog('Shared state saved.');
    }, 250);

    async function loadState() {
        const data = await chrome.storage.local.get(SHARED_STATE_KEY);
        if (data && data[SHARED_STATE_KEY]) {
            state = { ...state, ...data[SHARED_STATE_KEY] };
            state.regionOverrides = state.regionOverrides || {}; // Ensure initialized
            state.ignoredEvents = state.ignoredEvents || {}; // Ensure initialized
            state.recentAddresses = state.recentAddresses || []; // Ensure initialized
            addLog('Shared state loaded.');
        } else {
            addLog('No shared state found.');
        }
    }

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes[SHARED_STATE_KEY]) {
            addLog('Shared state changed externally. Updating UI.');
            state = { ...state, ...changes[SHARED_STATE_KEY].newValue };
            renderUIFromState();
        }
        // Listen for clipboard changes (local storage) - sync between popup/sidepanel
        if (changes[CLIPBOARDS_KEY]) {
            addLog(`Clipboards changed externally (${namespace}). Updating UI.`);
            clipboards = changes[CLIPBOARDS_KEY].newValue || [];
            renderClipboards();
        }
        // Listen for settings changes from options page (sync storage)
        if (namespace === 'sync') {
            const settingsToWatch = [
                'theme', 'compact_mode', 'global_panel_mode', 'auto_scan_on_load',
                'show_job_sorting', 'show_people', 'show_clipboard', 'show_reports',
                'show_uncategorized_alerts'
            ];
            const hasSettingChange = settingsToWatch.some(key => changes[key]);
            if (hasSettingChange) {
                addLog('Settings changed in options page. Applying...');
                applyUserPrefs();
            }
            // Sync CallRail toggle state between popup/sidepanel and across browsers
            if (changes.callrail_enabled !== undefined || changes.callrail_csr !== undefined) {
                addLog('CallRail settings changed externally. Updating UI.');
                const enabled = changes.callrail_enabled?.newValue;
                const csr = changes.callrail_csr?.newValue;
                if (callrailToggle && enabled !== undefined) {
                    callrailToggle.checked = enabled;
                }
                // Update the display name
                if (enabled && csr) {
                    updateAssignedRepDisplay(csr);
                } else if (enabled === false) {
                    updateAssignedRepDisplay(null);
                }
            }
        }
    });

    if (chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((msg) => {
            if (msg.type === "ROOFR_DATES_CHANGED") {
                addLog(`Page navigated to new dates.`);
                pageDatesISO = msg.datesISO;
                updateScanButtonState();
                // Check if we should auto-scan this new week
                // BUT skip if we're already doing a recommendation-triggered navigation (pendingWeekNav is set)
                // to avoid duplicate scans
                if (userPrefs.autoScanWeek && !state.pendingWeekNav) {
                    // Only if dates are actually different from what we have
                    if (state.weekDays && JSON.stringify(pageDatesISO) !== JSON.stringify(state.weekDays)) {
                        console.log("Auto-scanning new week...");
                        runScanFlow(true); // Pass true for isAuto
                    }
                }
            }
            // Auto-scan when calendar first loads (after Sales checkbox is checked)
            if (msg.type === "AUTO_SCAN_READY") {
                addLog("Calendar ready, auto-scanning...");
                console.log("AUTO_SCAN_READY received, running scan...");
                runScanFlow(true); // Auto-scan
            }
        });
    }

    /* ========= Time helpers ========= */
    function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    function toISO(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
    const localDayKey = (isoLocal) => isoLocal ? String(isoLocal).slice(0, 10) : "";

    /* ========= Roofr bridge ========= */
    async function sendFindCommand(payload) {
        let tabId;
        try {
            // Check if we have a stored target Roofr tab ID (from handleScanClick)
            if (window.__targetRoofrTabId) {
                tabId = window.__targetRoofrTabId;
                // Verify the tab still exists
                try {
                    const tab = await chrome.tabs.get(tabId);
                    if (tab && tab.url && tab.url.includes('app.roofr.com')) {
                        // Tab is valid, use it
                        return await chrome.tabs.sendMessage(tabId, payload);
                    }
                } catch (e) {
                    // Tab no longer exists, clear the stored ID
                    window.__targetRoofrTabId = null;
                }
            }

            // First try active tab in current window
            let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            // If we're in a popup window or the active tab isn't Roofr, search in target window for a Roofr tab
            if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://') || !tab.url.includes('app.roofr.com')) {
                addLog("Active tab not suitable, searching for Roofr tab in target window...", "INFO");
                const queryOpts = { url: "*://app.roofr.com/*" };
                if (window.__targetWindowId) queryOpts.windowId = window.__targetWindowId;
                const roofrTabs = await chrome.tabs.query(queryOpts);
                if (roofrTabs.length > 0) {
                    tab = roofrTabs[0];
                    window.__targetRoofrTabId = tab.id; // Store for future use
                    addLog(`Found Roofr tab (ID: ${tab.id})`, "INFO");
                } else {
                    addLog("No Roofr tab found in target window.", "WARN");
                    return null;
                }
            }

            tabId = tab.id;
            return await chrome.tabs.sendMessage(tabId, payload);
        } catch (e) {
            if (e.message && e.message.includes('Receiving end does not exist')) {
                addLog("Content script not ready. Injecting...", "INFO");
                if (!tabId) {
                    // Try to find a Roofr tab one more time in target window
                    const queryOpts = { url: "*://app.roofr.com/*" };
                    if (window.__targetWindowId) queryOpts.windowId = window.__targetWindowId;
                    const roofrTabs = await chrome.tabs.query(queryOpts);
                    if (roofrTabs.length > 0) {
                        tabId = roofrTabs[0].id;
                        window.__targetRoofrTabId = tabId;
                    } else {
                        addLog("No Roofr tab found for script injection", "ERROR");
                        return null;
                    }
                }
                try {
                    // Inject content script
                    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
                    // Wait longer for script to initialize
                    await new Promise(r => setTimeout(r, 500));
                    // Retry sending message
                    return await chrome.tabs.sendMessage(tabId, payload);
                } catch (retryError) {
                    // Try one more time with a longer delay
                    try {
                        await new Promise(r => setTimeout(r, 1000));
                        return await chrome.tabs.sendMessage(tabId, payload);
                    } catch (finalError) {
                        addLog(`Failed to communicate with Roofr tab: ${finalError.message}`, 'ERROR');
                        return null;
                    }
                }
            }
            addLog(`Failed to send message: ${e.message}`, 'ERROR');
            return null;
        }
    }

    /* ========= Sheets capacities ========= */
    async function discoverWeeklyTabNameForDate(forDate) {
        const apiKey = CONFIG.apiKey;
        const sheetId = settings.NEXT_SHEET_ID;
        const { titlePrefixes } = CONFIG;
        if (!apiKey || !sheetId) return null;

        const dayOfWeek = forDate.getUTCDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday

        // Calculate Monday-Sunday week (sheets use Monday as start, e.g., "SRA 12/22-12/28" where 12/22 is Monday)
        const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(forDate);
        monday.setUTCDate(forDate.getUTCDate() + diffToMonday);
        const sunday = new Date(monday);
        sunday.setUTCDate(monday.getUTCDate() + 6);

        // Generate multiple date format variations to match different tab naming conventions
        const fmt = (d, pad) => {
            const m = d.getUTCMonth() + 1;
            const day = d.getUTCDate();
            return pad ? `${String(m).padStart(2, '0')}/${String(day).padStart(2, '0')}` : `${m}/${day}`;
        };

        // Create format variations for Monday-Sunday
        const monPadded = fmt(monday, true);
        const monSimple = fmt(monday, false);
        const sunPadded = fmt(sunday, true);
        const sunSimple = fmt(sunday, false);

        // All possible range combinations (Mon-Sun format)
        const rangeVariations = [
            `${monPadded}-${sunPadded}`,      // 12/22-12/28
            `${monSimple}-${sunSimple}`,       // 12/22-12/28
            `${monPadded}-${sunSimple}`,       // mixed padding
            `${monSimple}-${sunPadded}`,       // mixed padding
            // Without slash separator
            `${monPadded.replace('/', '')}-${sunPadded.replace('/', '')}`,
            `${monSimple.replace('/', '')}-${sunSimple.replace('/', '')}`,
        ];

        addLog(`Looking for tab with date range: ${monSimple}-${sunSimple}`);

        const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=sheets.properties.title&key=${encodeURIComponent(apiKey)}`;
        try {
            const res = await fetch(metaUrl, { cache: "no-store" });
            if (!res.ok) throw new Error(`API error ${res.status}`);
            const data = await res.json();

            // Log all available tabs for debugging
            const allTabs = (data.sheets || []).map(s => s?.properties?.title).filter(Boolean);
            addLog(`Available tabs: ${allTabs.join(', ')}`);

            for (const sheet of data.sheets || []) {
                const title = (sheet?.properties?.title || "").toUpperCase();
                if (titlePrefixes.some(p => title.startsWith(p.toUpperCase()))) {
                    // Check all range variations
                    for (const range of rangeVariations) {
                        if (title.includes(range.toUpperCase())) {
                            addLog(`Found matching tab: ${sheet.properties.title}`);
                            return sheet.properties.title;
                        }
                    }
                }
            }
            addLog(`No matching tab found for week ${monSimple}-${sunSimple}`, 'WARN');
            return null;
        } catch (e) {
            addLog(`Error during tab discovery: ${e.message}`, 'ERROR');
            return null;
        }
    }

    function parseTotalsRange(values) {
        if (!Array.isArray(values) || !values.length) return null;
        let headerRow = values.findIndex(r => String(r?.[0] || "").trim().toUpperCase() === "APPOINTMENT BLOCKS");
        if (headerRow < 0) return null;
        const map = { B1: [], B2: [], B3: [], B4: [] };
        const keys = ["B1", "B2", "B3", "B4"];
        for (let i = 0; i < 4; i++) {
            const row = values[headerRow + 1 + i] || [];
            for (let c = 1; c <= 7; c++) {
                const raw = row[c] ?? ""; const n = parseInt(String(raw).replace(/[^0-9-]/g, ""), 10);
                map[keys[i]].push(Number.isFinite(n) ? n : 0);
            }
        }
        return map;
    }
    async function fetchCapacitiesForTab(tabName) {
        if (!tabName) return null;
        const { apiKey } = CONFIG;
        const sheetId = settings.NEXT_SHEET_ID;
        const ranges = { phxRange: settings.AVAIL_RANGE_PHX, southRange: settings.AVAIL_RANGE_SOUTH, northRange: settings.AVAIL_RANGE_NORTH };
        const qTab = `'${tabName.replace(/'/g, "''")}'`;
        let url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?key=${encodeURIComponent(apiKey)}`;
        Object.values(ranges).forEach(r => { if (r) url += `&ranges=${encodeURIComponent(`${qTab}!${r}`)}`; });
        try {
            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) throw new Error(`API error: ${res.statusText}`);
            const data = await res.json();
            return {
                PHX: parseTotalsRange(data.valueRanges?.[0]?.values),
                SOUTH: parseTotalsRange(data.valueRanges?.[1]?.values),
                NORTH: parseTotalsRange(data.valueRanges?.[2]?.values),
            };
        } catch (e) {
            addLog(`Failed to fetch from tab "${tabName}": ${e.message}`, 'ERROR');
            return null;
        }
    }
    async function fetchDayCutoffs(tabName) {
        if (!tabName) return [false, false, false, false, false, false, false]; // Default: no cutoffs
        const { apiKey } = CONFIG;
        const sheetId = settings.NEXT_SHEET_ID;
        if (!apiKey || !sheetId) return [false, false, false, false, false, false, false];

        const qTab = `'${tabName.replace(/'/g, "''")}'`;

        // Row 250 contains the "Next Days Cutoff" checkboxes (B250:H250 for Mon-Sun)
        // Using UNFORMATTED_VALUE to get boolean true/false for checkboxes
        const range = `${qTab}!B250:H250`;
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?key=${encodeURIComponent(apiKey)}&valueRenderOption=UNFORMATTED_VALUE`;

        try {
            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) {
                // Try to get more error details from response body
                let errorDetail = res.statusText || `HTTP ${res.status}`;
                try {
                    const errorData = await res.json();
                    if (errorData.error?.message) {
                        errorDetail = errorData.error.message;
                    }
                } catch (e) { /* ignore parse errors */ }

                // Don't treat as fatal error - just log and return defaults
                addLog(`Day cutoffs not available for "${tabName}" (${errorDetail}) - using defaults`, 'WARN');
                return [false, false, false, false, false, false, false];
            }
            const data = await res.json();
            const values = data.values?.[0] || [];

            // Convert to array of booleans (Mon-Sun)
            // Note: Sheet columns B-H map to array indices 0-6, but values array is 0-indexed from column B
            const cutoffs = [];
            for (let i = 0; i < 7; i++) {
                cutoffs[i] = values[i] === true; // Checkbox checked = cutoff enabled
            }

            addLog(`Fetched day cutoffs: ${cutoffs.map((c, i) => c ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i] : null).filter(Boolean).join(', ') || 'None'}`);
            return cutoffs;
        } catch (e) {
            addLog(`Day cutoffs fetch error for "${tabName}": ${e.message} - using defaults`, 'WARN');
            return [false, false, false, false, false, false, false]; // Default: no cutoffs on error
        }
    }

    /* ========= Cities Database (Google Sheet) ========= */
    async function fetchCitiesFromSheet() {
        const apiKey = CONFIG.apiKey;
        if (!apiKey) return null;

        const qTab = `'${CITIES_SHEET_TAB.replace(/'/g, "''")}'`;
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(CITIES_SHEET_ID)}/values/${encodeURIComponent(`${qTab}!${CITIES_RANGE}`)}?key=${encodeURIComponent(apiKey)}`;

        try {
            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) throw new Error(`API error: ${res.status}`);
            const data = await res.json();
            const values = data.values || [];

            const cities = { PHX: [], NORTH: [], SOUTH: [] };
            for (const row of values) {
                if (row[0] && row[0].trim()) cities.PHX.push(row[0].trim().toUpperCase());
                if (row[1] && row[1].trim()) cities.NORTH.push(row[1].trim().toUpperCase());
                if (row[2] && row[2].trim()) cities.SOUTH.push(row[2].trim().toUpperCase());
            }

            addLog(`Loaded cities from Google Sheet: PHX(${cities.PHX.length}), North(${cities.NORTH.length}), South(${cities.SOUTH.length})`);
            return cities;
        } catch (e) {
            addLog(`Failed to fetch cities from Google Sheet: ${e.message}`, 'ERROR');
            return null;
        }
    }

    async function appendCityToSheet(city, region) {
        const apiKey = CONFIG.apiKey;
        if (!apiKey || !city || !region) return false;

        // First, get current data to find the next empty row for this region
        const qTab = `'${CITIES_SHEET_TAB.replace(/'/g, "''")}'`;
        const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(CITIES_SHEET_ID)}/values/${encodeURIComponent(`${qTab}!${CITIES_RANGE}`)}?key=${encodeURIComponent(apiKey)}`;

        try {
            const readRes = await fetch(readUrl, { cache: "no-store" });
            if (!readRes.ok) throw new Error(`Read API error: ${readRes.status}`);
            const readData = await readRes.json();
            const values = readData.values || [];

            // Find the column index for this region
            const colIndex = region === 'PHX' ? 0 : (region === 'NORTH' ? 1 : 2);
            const colLetter = ['A', 'B', 'C'][colIndex];

            // Find the first empty row in this column
            let nextRow = 82; // Starting row
            for (let i = 0; i < values.length; i++) {
                if (values[i] && values[i][colIndex] && values[i][colIndex].trim()) {
                    nextRow = 82 + i + 1;
                }
            }

            // Use the Sheets API to append the value
            // Note: This requires write access. For read-only API key, we'll fall back to local storage
            const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(CITIES_SHEET_ID)}/values/${encodeURIComponent(`${qTab}!${colLetter}${nextRow}`)}:append?valueInputOption=RAW&insertDataOption=OVERWRITE&key=${encodeURIComponent(apiKey)}`;

            const appendRes = await fetch(appendUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ values: [[city.toUpperCase()]] })
            });

            if (!appendRes.ok) {
                // API key doesn't have write access - this is expected
                // Cities are still saved to local chrome.storage.sync
                addLog(`Cannot write to Google Sheet (read-only API key). City saved locally.`, 'WARN');
                return false;
            }

            addLog(`Added city "${city}" to ${region} in Google Sheet at row ${nextRow}`);
            return true;
        } catch (e) {
            addLog(`Failed to append city to Google Sheet: ${e.message}`, 'WARN');
            return false;
        }
    }

    async function fetchSheetCapacitiesForSunday(sISO) {
        if (!sISO || !CONFIG.apiKey || !settings.NEXT_SHEET_ID) return;
        addLog('Fetching capacities...');
        const sunDate = new Date(`${sISO}T12:00:00Z`);

        // Calendar shows Sun-Sat, but sheets use Mon-Sun format
        // So we need TWO tabs: one for Mon-Sat (next day's week), one for Sunday (current week)
        const monDate = new Date(sunDate);
        monDate.setUTCDate(sunDate.getUTCDate() + 1); // Monday after this Sunday

        const [primaryTab, secondaryTab] = await Promise.all([
            discoverWeeklyTabNameForDate(monDate),    // Tab for Mon-Sat (the week starting Monday)
            discoverWeeklyTabNameForDate(sunDate)     // Tab for Sunday (the week containing this Sunday)
        ]);
        addLog(`Tabs found -> Mon-Sat: ${primaryTab || 'N/A'}, Sun: ${secondaryTab || 'N/A'}`);

        // Fetch capacity data and day cutoffs in parallel
        const [primaryData, secondaryData, dayCutoffs] = await Promise.all([
            fetchCapacitiesForTab(primaryTab),
            fetchCapacitiesForTab(secondaryTab),
            fetchDayCutoffs(primaryTab)
        ]);

        // Store cutoffs in state
        state.dayCutoffs = dayCutoffs;

        if (!primaryData && !secondaryData) {
            state.availability = { PHX: null, SOUTH: null, NORTH: null, ALL: null };
            applyRegionFilter();
            alert("Could not find a valid weekly tab in Google Sheets for the selected week.");
            return;
        }
        const regions = ['PHX', 'NORTH', 'SOUTH'];
        for (const region of regions) {
            const pData = primaryData?.[region], sData = secondaryData?.[region];
            if (!pData && !sData) { state.availability[region] = null; continue; }
            const newAvail = { B1: [], B2: [], B3: [], B4: [] };
            const keys = ['B1', 'B2', 'B3', 'B4'];
            for (const key of keys) {
                // Availability array is Monday-first: [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
                // Mon-Sat (indexes 0-5) come from primaryTab (current week starting Monday)
                // Sunday (index 6) comes from secondaryTab (previous week's Sunday)
                for (let i = 0; i < 6; i++) {
                    newAvail[key][i] = pData?.[key]?.[i] ?? 0;  // Mon-Sat from current week's tab
                }
                newAvail[key][6] = sData?.[key]?.[6] ?? 0;  // Sunday from previous week's tab
            }
            state.availability[region] = newAvail;
        }
        state.availability.ALL = CONFIG.sumMaps(CONFIG.sumMaps(state.availability.PHX, state.availability.NORTH), state.availability.SOUTH);
        addLog("Successfully combined data from sheets.");
    }

    /* ========= Day rendering ========= */

    function clearAllSuggested() {
        document.querySelectorAll(".block-item.suggested").forEach(el => {
            el.classList.remove("suggested");
            const reason = el.querySelector('.reco-reason');
            if (reason) reason.remove();
        });
    }
    function highlightSuggested(card, blockKey, reasonText) {
        clearAllSuggested();
        const target = card.querySelector(`.block-item[data-block-key="${blockKey}"]`);
        if (target) {
            target.classList.add("suggested");

            const hasMultiple = state.recoCandidates && state.recoCandidates.length > 1;
            const currentIdx = state.recoIndex + 1;
            const total = state.recoCandidates ? state.recoCandidates.length : 0;

            const reasonDiv = document.createElement('div');
            reasonDiv.className = 'reco-reason';

            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'flex-start';

            const textDiv = document.createElement('div');
            textDiv.innerHTML = `<strong>Recommendation ${hasMultiple ? `(${currentIdx}/${total})` : ''}:</strong> ${reasonText}`;
            row.appendChild(textDiv);

            if (hasMultiple) {
                const btnDiv = document.createElement('div');
                btnDiv.style.display = 'flex';
                btnDiv.style.gap = '4px';
                btnDiv.style.marginLeft = '8px';
                btnDiv.style.flexShrink = '0';

                const prevBtn = document.createElement('button');
                prevBtn.className = 'reco-nav-btn';
                prevBtn.innerHTML = '◀';
                prevBtn.title = 'Previous recommendation';
                prevBtn.onclick = (e) => { e.stopPropagation(); handlePrevRecommendation(); };

                const nextBtn = document.createElement('button');
                nextBtn.className = 'reco-nav-btn';
                nextBtn.innerHTML = '▶';
                nextBtn.title = 'Next recommendation';
                nextBtn.onclick = (e) => { e.stopPropagation(); handleNextRecommendation(); };

                btnDiv.appendChild(prevBtn);
                btnDiv.appendChild(nextBtn);
                row.appendChild(btnDiv);
            }

            reasonDiv.appendChild(row);
            target.appendChild(reasonDiv);

            target.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }

    function setCardCollapsed(card, collapsed) {
        card.dataset.collapsed = collapsed;
        const toggle = card.querySelector(".toggle-btn[data-role='day']");
        if (toggle) toggle.innerHTML = collapsed ? "Expand" : "Collapse";

        const body = card.querySelector('.card-body');
        const footer = card.querySelector('.card-footer');
        if (body) body.classList.toggle('hidden', collapsed);
        if (footer) footer.classList.toggle('hidden', collapsed);
    }

    function areAllCardsCollapsed() { return document.querySelectorAll(".day-card").length > 0 && ![...document.querySelectorAll(".day-card")].some(c => c.dataset.collapsed === "false"); }
    function setAllCardsCollapsed(collapsed) { document.querySelectorAll(".day-card").forEach(card => setCardCollapsed(card, collapsed)); }
    function updateToggleAllLabel() { if (toggleAllBtn) toggleAllBtn.textContent = areAllCardsCollapsed() ? "Expand All" : "Collapse All"; }

    function extractCityFromUncategorized(title) {
        if (!title) return null;
        const addressPart = title.split(' - ').pop().trim();
        if (!addressPart) return null;

        let potentialCity = addressPart;
        potentialCity = potentialCity.replace(/\b\d{5}(-\d{4})?\b/, '').trim(); // remove zip
        potentialCity = potentialCity.replace(/,?\s*\b(AZ|Arizona)\b/i, '').trim(); // remove state and preceding comma
        potentialCity = potentialCity.replace(/,$/, '').trim(); // remove trailing comma

        let city = potentialCity.split(',').pop().trim();

        // Clean up street-like artifacts
        city = city.replace(/^\d+\s+([A-Z]\.?\s+)?/, ''); // remove starting numbers like "123 E "

        if (/\b(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Blvd|Boulevard|Ln|Lane|Ct|Court|Way|Pkwy|Parkway)\b/i.test(city)) {
            return null;
        }

        return city ? city.toUpperCase() : null;
    }

    function renderDayCard(dateStr, eventsForDay) {
        const totals = CONFIG.computeDailyTotals(dateStr, eventsForDay, state.availability, state.currentRegion);
        const d = new Date(dateStr + "T00:00");
        const card = document.createElement("div");
        card.className = "day-card"; card.dataset.date = dateStr;

        const todayISO = toISO(startOfDay(new Date()));
        const isPast = dateStr < todayISO;
        const isToday = dateStr === todayISO;
        if (isToday) card.classList.add("today");
        else if (isPast) card.classList.add("past");

        // Check if tomorrow should be marked as "Reps Scheduled" after 5pm MST
        const now = new Date();
        const mstOffset = -7; // MST is UTC-7
        const utcHours = now.getUTCHours();
        const mstHours = (utcHours + mstOffset + 24) % 24;
        const isAfter5pmMST = mstHours >= 17;

        const tomorrow = new Date(startOfDay(new Date()));
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowISO = toISO(tomorrow);
        const isTomorrowAfterCutoff = dateStr === tomorrowISO && isAfter5pmMST;

        // Check if this day is cutoff (but not for past days)
        // Today always shows "Reps Scheduled", tomorrow shows it after 5pm MST
        const dayOfWeek = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
        const monFirstIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convert to Mon=0, ..., Sun=6
        const isCutoff = !isPast && (isToday || (state.dayCutoffs && state.dayCutoffs[monFirstIndex]) || isTomorrowAfterCutoff);
        if (isCutoff) card.classList.add("day-cutoff");

        // Mark days that should be shrunk (past, no availability, or reps scheduled/cutoff)
        const noAvailability = totals.capacity === 0;
        if (isPast || noAvailability || isCutoff) {
            card.classList.add("day-shrunk");
        }

        // Header
        const header = document.createElement('div');
        header.className = 'card-header';

        let badgesHtml = '';
        if (isCutoff) {
            badgesHtml += `<span class="badge warning" style="background: #f59e0b; color: white;">Reps Scheduled</span> `;
        } else if (noAvailability) {
            // No capacity set for this day
            badgesHtml += `<span class="badge muted">No Availability</span>`;
        } else {
            if (totals.dayOver > 0) badgesHtml += `<span class="badge danger">${totals.dayOver} Over</span> `;
            if (totals.netAvailable > 0) badgesHtml += `<span class="badge success">${totals.netAvailable} Open</span>`;
            else if (totals.dayOver === 0) badgesHtml += `<span class="badge neutral">Full</span>`;
        }

        const dayName = d.toLocaleDateString(undefined, { weekday: "short" });
        const fullDate = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

        header.innerHTML = `
    <div class="date-group">
      <span class="collapse-chevron">▶</span>
      <div class="date-title"><span class="day-name">${dayName}</span>, ${fullDate}</div>
      ${badgesHtml}
    </div>
    <button class="btn ghost copy-day-btn" style="font-size:11px;">Copy</button>
  `;
        card.appendChild(header);

        // Uncategorized Events (Moved outside .card-body to show when collapsed)
        // Filter events that do NOT have a region override, are not ignored, and don't contain "sales"
        const uncatEvents = eventsForDay.filter(ev => {
            const uniqueKey = `${ev.title}|${ev.start}`;
            // Skip if already categorized or has override
            if (CONFIG.getCityFromEvent(ev) || state.regionOverrides[uniqueKey]) return false;
            // Skip if manually ignored
            if (state.ignoredEvents[uniqueKey]) return false;
            // Skip if title contains "sales" (case-insensitive)
            if (ev.title && ev.title.toLowerCase().includes('sales')) return false;
            return true;
        });

        if (uncatEvents.length > 0) {
            const uncatBox = document.createElement('div');
            uncatBox.className = `uncat-box ${!userPrefs.showUncatCollapsed ? 'hidden' : ''}`; // Hidden if pref is off

            uncatBox.innerHTML = `<div class="uncat-title">Uncategorized (${uncatEvents.length})</div>`;

            uncatEvents.forEach(ev => {
                const item = document.createElement('div');
                item.className = 'uncat-item';
                const rawAddress = ev.title.split(' - ').pop().trim();

                item.innerHTML = `
            <div class="uncat-content">
                <div class="uncat-text">• ${ev.title || 'No Title'}</div>
                <div class="uncat-actions">
                    <button class="uncat-btn region-btn" data-r="PHX" title="Assign to PHX">P</button>
                    <button class="uncat-btn region-btn" data-r="NORTH" title="Assign to North">N</button>
                    <button class="uncat-btn region-btn" data-r="SOUTH" title="Assign to South">S</button>
                    <span class="uncat-divider">|</span>
                    <button class="verify-btn" title="Auto-verify address">🔍</button>
                    <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rawAddress)}" target="_blank" class="map-link" title="Open in Google Maps">📍</a>
                    <div class="verify-result hidden"></div>
                </div>
            </div>
            <button class="ignore-btn" title="Ignore this job">✕</button>
        `;

                const verifyBtn = item.querySelector('.verify-btn');
                const verifyResult = item.querySelector('.verify-result');

                // Address verification handler
                verifyBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    verifyBtn.disabled = true;
                    verifyBtn.textContent = '...';
                    verifyResult.classList.remove('hidden');
                    verifyResult.innerHTML = '<span style="color:#666;">Verifying...</span>';

                    try {
                        const result = await CONFIG.verifyAndCategorizeEvent(ev);

                        if (result.success) {
                            const uniqueKey = `${ev.title}|${ev.start}`;
                            const city = result.city;
                            const region = result.region || result.suggestedRegion;

                            // Auto-assign the region
                            state.regionOverrides[uniqueKey] = region;

                            // Add city to whitelist if new
                            if (result.isNewCity && city) {
                                CONFIG.REGION_CITY_WHITELISTS[region].add(city);

                                // Try to save to Google Sheet first
                                const savedToSheet = await appendCityToSheet(city, region);

                                // Always save to local storage as backup
                                const data = await chrome.storage.sync.get(DYNAMIC_CITIES_KEY);
                                const currentDynamicCities = data[DYNAMIC_CITIES_KEY] || { PHX: [], NORTH: [], SOUTH: [] };

                                if (!currentDynamicCities[region]) currentDynamicCities[region] = [];
                                if (!currentDynamicCities[region].includes(city)) {
                                    currentDynamicCities[region].push(city);
                                    await chrome.storage.sync.set({ [DYNAMIC_CITIES_KEY]: currentDynamicCities });
                                    userAddedCities = currentDynamicCities;
                                }

                                const sheetStatus = savedToSheet ? ' (saved to database)' : '';
                                showToast(`Verified: "${city}" added to ${region}${sheetStatus}`);
                                addLog(`Address verified. New city "${city}" added to ${region}.${savedToSheet ? ' Saved to Google Sheet.' : ''}`);
                            } else {
                                showToast(`Verified: ${city} (${region})`);
                                addLog(`Address verified: ${city} in ${region} region.`);
                            }

                            await debouncedSaveState();
                            renderUIFromState();
                        } else {
                            verifyResult.innerHTML = `<span style="color:#ef4444;font-size:10px;">${result.error || 'Could not verify'}</span>`;
                            verifyBtn.textContent = '🔍';
                            verifyBtn.disabled = false;
                            addLog(`Address verification failed: ${result.error}`);
                        }
                    } catch (err) {
                        verifyResult.innerHTML = '<span style="color:#ef4444;font-size:10px;">Error</span>';
                        verifyBtn.textContent = '🔍';
                        verifyBtn.disabled = false;
                        addLog(`Address verification error: ${err.message}`);
                    }
                });


                // Ignore button handler
                const ignoreBtn = item.querySelector('.ignore-btn');
                ignoreBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const uniqueKey = `${ev.title}|${ev.start}`;
                    state.ignoredEvents[uniqueKey] = true;
                    addLog(`Ignored uncategorized event: ${ev.title}`);
                    await debouncedSaveState();
                    renderUIFromState();
                });

                // Highlight event on Roofr page when hovering over uncategorized item
                item.addEventListener('mouseenter', async () => {
                    await sendFindCommand({
                        type: 'HIGHLIGHT_EVENT',
                        title: ev.title,
                        start: ev.start
                    });
                });

                item.addEventListener('mouseleave', async () => {
                    await sendFindCommand({ type: 'CLEAR_HIGHLIGHT' });
                });

                // Also highlight on click
                item.addEventListener('click', async (e) => {
                    // Don't trigger if clicking on buttons inside
                    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;

                    await sendFindCommand({
                        type: 'HIGHLIGHT_EVENT',
                        title: ev.title,
                        start: ev.start
                    });
                });

                item.querySelectorAll('.uncat-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const region = btn.dataset.r;
                        const uniqueKey = `${ev.title}|${ev.start}`;

                        state.regionOverrides[uniqueKey] = region;

                        const city = extractCityFromUncategorized(ev.title);
                        if (city) {
                            addLog(`Extracted city candidate "${city}" from uncategorized event.`);
                            const exists = CONFIG.REGION_CITY_WHITELISTS.PHX.has(city) ||
                                CONFIG.REGION_CITY_WHITELISTS.NORTH.has(city) ||
                                CONFIG.REGION_CITY_WHITELISTS.SOUTH.has(city);

                            if (!exists) {
                                CONFIG.REGION_CITY_WHITELISTS[region].add(city);

                                // Try to save to Google Sheet first
                                const savedToSheet = await appendCityToSheet(city, region);

                                // Always save to local storage as backup
                                const data = await chrome.storage.sync.get(DYNAMIC_CITIES_KEY);
                                const currentDynamicCities = data[DYNAMIC_CITIES_KEY] || { PHX: [], NORTH: [], SOUTH: [] };

                                if (!currentDynamicCities[region]) currentDynamicCities[region] = [];
                                if (!currentDynamicCities[region].includes(city)) {
                                    currentDynamicCities[region].push(city);
                                    await chrome.storage.sync.set({ [DYNAMIC_CITIES_KEY]: currentDynamicCities });
                                    userAddedCities = currentDynamicCities; // Keep local copy in sync
                                }

                                const sheetStatus = savedToSheet ? ' (saved to database)' : '';
                                showToast(`"${city}" added to ${region} region${sheetStatus}`);
                                addLog(`Added new city "${city}" to ${region}.${savedToSheet ? ' Saved to Google Sheet.' : ' Saved to local storage.'}`);
                            } else {
                                showToast(`Assigned to ${region}`);
                                addLog(`City "${city}" already exists in whitelists. Assigning event.`);
                            }
                        } else {
                            showToast(`Assigned to ${region}`);
                            addLog(`Could not extract city from "${ev.title}". Assigning event.`);
                        }

                        await debouncedSaveState();
                        renderUIFromState();
                    });
                });

                uncatBox.appendChild(item);
            });

            card.appendChild(uncatBox);
            card.uncatBox = uncatBox; // Store ref for toggling logic if we want to change prefs
        }

        // Body Wrapper
        const body = document.createElement('div');
        body.className = 'card-body hidden';

        // Blocks Grid
        const grid = document.createElement('div');
        grid.className = 'blocks-grid';
        const blocks = CONFIG.blockWindowForDate(d);

        for (const blk of blocks) {
            const div = document.createElement("div");
            div.className = "block-item"; div.dataset.blockKey = blk.key;

            const booked = totals.perBlockBooked[blk.key] || 0;
            const cap = CONFIG.getCapacity(state.currentRegion, d.getDay(), blk.key, state.availability);
            const remaining = Number.isFinite(cap) ? cap - booked : null;

            if (remaining !== null && remaining < 0) div.classList.add("over");

            let statusHtml = '';
            if (remaining !== null) {
                if (cap === 0) {
                    // No capacity set for this time slot
                    statusHtml = `<span class="stat-muted stat-bold">No Availability</span>`;
                } else if (remaining === 0) {
                    statusHtml = `<span class="stat-full stat-bold">Fully Booked</span>`;
                } else if (remaining > 0) {
                    statusHtml = `<span class="stat-ok stat-bold">${remaining} left</span>`;
                } else {
                    statusHtml = `<span class="stat-err stat-bold">${Math.abs(remaining)} over</span>`;
                }
            }

            // Find cities
            const evsInBlock = eventsForDay.filter(ev => CONFIG.overlapMinutes({ start: ev.start, end: ev.end }, blk) >= 15);
            const uniqueCities = [...new Set(evsInBlock.map(ev => CONFIG.getCityFromEvent(ev) || "Uncategorized"))].filter(c => c !== "Uncategorized").sort();

            const cityItems = uniqueCities.map(c => {
                const classes = ["city-hover"];
                if (state.highlightedCity && c.toUpperCase() === state.highlightedCity.toUpperCase()) {
                    classes.push("city-text-highlight");
                }
                return `<span class="${classes.join(' ')}">${c}</span>`;
            });

            const citiesHtml = cityItems.length > 0 ? `<div class="block-context">Scheduled: ${cityItems.join(", ")}</div>` : '';

            // NEW: Find manually assigned events in this block (override set, but no city detected)
            const manuallyAssigned = evsInBlock.filter(ev => {
                const uniqueKey = `${ev.title}|${ev.start}`;
                return state.regionOverrides[uniqueKey] && !CONFIG.getCityFromEvent(ev);
            });

            let assignedHtml = '';
            if (manuallyAssigned.length > 0) {
                assignedHtml = `<div class="assigned-events">`;
                manuallyAssigned.forEach(ev => {
                    // Heuristic: usually "Name - Address". Grab address.
                    const parts = ev.title.split(' - ');
                    const display = parts.length > 1 ? parts[parts.length - 1] : ev.title;
                    assignedHtml += `<div class="assigned-item" title="${ev.title}">
                <span class="assigned-text">${display}</span>
                <button class="btn-icon undo-assign-btn" style="font-size:10px; padding:0 2px;" title="Undo Assignment">↺</button>
            </div>`;
                });
                assignedHtml += `</div>`;
            }

            div.innerHTML = `
        <div class="block-header">
            <span class="time-slot">${blk.label}</span>
            <span class="sheet-cap">${booked}/${cap !== null ? cap : '-'}</span>
        </div>
        <div class="block-stats">
            ${statusHtml}
        </div>
        ${citiesHtml}
        ${assignedHtml}
    `;

            // Undo Button Logic
            if (manuallyAssigned.length > 0) {
                const undoBtns = div.querySelectorAll('.undo-assign-btn');
                undoBtns.forEach((btn, idx) => {
                    btn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const ev = manuallyAssigned[idx];
                        const uniqueKey = `${ev.title}|${ev.start}`;
                        delete state.regionOverrides[uniqueKey];
                        await debouncedSaveState();
                        renderUIFromState();
                    });
                });
            }

            // Hover logic
            div.querySelectorAll('.city-hover').forEach(el => {
                el.addEventListener('mouseenter', () => {
                    sendFindCommand({ type: 'HIGHLIGHT_CITY', city: el.textContent });
                });
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const city = el.textContent;
                    findInput.value = city;
                    updateFindClearButton();
                    pushFindUpdate(city);
                });
            });

            grid.appendChild(div);
        }
        body.appendChild(grid);

        // Footer inside body (shows when expanded)
        const footer = document.createElement('div');
        footer.className = 'card-footer';
        const totalJobsForDay = eventsForDay ? eventsForDay.length : 0;
        footer.innerHTML = `<span class="card-cap">Total Cap: ${totals.capacity}</span><span class="card-booked">Booked: ${totalJobsForDay}</span>`;
        body.appendChild(footer);

        // Copy Day button at bottom
        const copyDayBtn = document.createElement('button');
        copyDayBtn.className = 'copy-day-footer-btn btn ghost';
        copyDayBtn.style.cssText = 'width: 100%; margin-top: 8px; font-size: 11px; padding: 6px; color: var(--textSecondary);';
        copyDayBtn.textContent = 'Copy Day';
        copyDayBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const allDayEvents = (state.allEvents || []).filter(ev => localDayKey(ev.start) === dateStr);
            await copyToClipboard(buildCopyLinesForDay(dateStr, allDayEvents).join("\n"), e.currentTarget);
        });
        body.appendChild(copyDayBtn);

        card.appendChild(body);

        // Copy button handler (in header)
        header.querySelector('.copy-day-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            const allDayEvents = (state.allEvents || []).filter(ev => localDayKey(ev.start) === dateStr);
            await copyToClipboard(buildCopyLinesForDay(dateStr, allDayEvents).join("\n"), e.currentTarget);
        });

        // Events - Toggle logic on header click
        header.addEventListener("click", () => {
            const willExpand = card.dataset.collapsed === "true"; // currently collapsed, so will open
            setCardCollapsed(card, !willExpand);

            // Handle Uncategorized Box visibility if preference dictates
            if (card.uncatBox && !userPrefs.showUncatCollapsed) {
                if (willExpand) card.uncatBox.classList.remove('hidden');
                else card.uncatBox.classList.add('hidden');
            }

            updateToggleAllLabel();
        });

        // Right-click: Open daily calendar view with appropriate people selected
        header.addEventListener("contextmenu", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await openDailyCalendarForDate(dateStr);
        });

        setCardCollapsed(card, true);
        // If userPrefs.showUncatCollapsed is true, uncatBox is already visible.

        return card;
    }

    function buildCopyLinesForDay(dateStr, eventsForDay) {
        const day = new Date(dateStr + "T00:00");
        const blocks = CONFIG.blockWindowForDate(day);
        const sorted = [...eventsForDay].sort((a, b) => new Date(a.start) - new Date(b.start));
        const dateHeader = day.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
        const result = [dateHeader, ""];
        for (const blk of blocks) {
            const evs = sorted.filter(ev => CONFIG.overlapMinutes({ start: ev.start, end: ev.end }, blk) >= 15);
            result.push(`${blk.label} (${evs.length})`);
            evs.forEach(ev => {
                const city = (CONFIG.getCityFromEvent(ev) || "UNCAT").toUpperCase();
                const rawTitle = ev.title || "";
                const title = rawTitle.trim();
                const cityRegex = new RegExp(`^${city}`, 'i');
                if (cityRegex.test(title)) {
                    result.push(title);
                } else {
                    result.push(`${city} - ${title}`);
                }
            });
            result.push("");
        }
        return result;
    }
    function buildCopyLinesForWeek() {
        if (!state.weekDays || state.weekDays.length === 0) return ["No days detected."];
        const days = state.weekDays;
        return days.flatMap(d => [...buildCopyLinesForDay(d, (state.allEvents || []).filter(e => localDayKey(e.start) === d)), ""]);
    }

    /* ========= Helpers ========= */
    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
    async function copyToClipboard(text, feedbackBtn) {
        try {
            await navigator.clipboard.writeText(text);
            if (feedbackBtn) { const prev = feedbackBtn.textContent; feedbackBtn.textContent = "Copied!"; setTimeout(() => feedbackBtn.textContent = prev, 900); }
        } catch (e) { addLog(`Copy failed: ${e.message}`, 'ERROR'); }
    }
    function getTextFromHtml(html) {
        const temp = document.createElement('div');
        temp.innerHTML = html || "";
        return temp.innerText || temp.textContent || "";
    }
    function getRandomAffirmation() {
        return AFFIRMATIONS[Math.floor(Math.random() * AFFIRMATIONS.length)];
    }

    /* ========= Region filter/render ========= */
    function applyRegionFilter() {
        addLog(`Applying region filter: ${state.currentRegion}`);

        const filteredEvents = (state.allEvents || []).filter(e => {
            // Check if there is an override
            const uniqueKey = `${e.title}|${e.start}`;
            const override = state.regionOverrides[uniqueKey];
            if (override) {
                return state.currentRegion === "ALL" || override === state.currentRegion;
            }
            return CONFIG.passesRegion(e, state.currentRegion);
        });

        renderDays(filteredEvents);

        if (state.recoCandidates && state.recoCandidates.length > 0 && state.recoIndex < state.recoCandidates.length) {
            const current = state.recoCandidates[state.recoIndex];
            const card = document.querySelector(`.day-card[data-date="${current.dateStr}"]`);
            if (card) {
                setCardCollapsed(card, false);
                highlightSuggested(card, current.blockKey, current.reason);
            }
        }
    }
    function renderDays(filteredEvents) {
        daysWrap.innerHTML = "";
        if (!state.weekDays || state.weekDays.length === 0) {
            daysWrap.innerHTML = '<div style="text-align: center; padding: 32px; color: #64748b;"><h3 style="font-weight: 600; margin-bottom:8px;">Ready to Scan</h3><p style="font-size: 12px;">Click "Scan Page" to load data.</p></div>';
            return;
        }
        const week = state.weekDays;
        const groups = new Map(week.map(iso => [iso, []]));
        for (const e of filteredEvents) {
            const key = localDayKey(e.start);
            if (groups.has(key)) groups.get(key).push(e);
        }
        week.forEach(d => daysWrap.appendChild(renderDayCard(d, groups.get(d))));

        let grandTotalBooked = (state.allEvents || []).length;
        footerTotal.textContent = `Total: ${grandTotalBooked} booked`;
        updateToggleAllLabel();
    }

    const tagColorCache = new Map();
    const totalTagColors = 8; // Must match the number of .tag-color-* classes in CSS
    function getTagColorClass(tag) {
        if (tagColorCache.has(tag)) {
            return tagColorCache.get(tag);
        }
        // Simple hash function to get a consistent color index
        let hash = 0;
        for (let i = 0; i < tag.length; i++) {
            const char = tag.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        const colorIndex = (Math.abs(hash) % totalTagColors) + 1;
        const className = `tag-color-${colorIndex}`;
        tagColorCache.set(tag, className);
        return className;
    }


    /* ========= Job Sorting Tab ========= */
    function initJobSortingTab() {
        // This function now only sets up listeners and does an initial render.
        // The population logic is moved to applyJobFiltersAndRender.
        Object.values(jobSortFilters).forEach(el => {
            if (el) {
                // Add listener for any change
                el.addEventListener('change', applyJobFiltersAndRender);
            }
        });

        // Initial population and render
        applyJobFiltersAndRender();
    }

    function applyJobFiltersAndRender() {
        if (!jobListContainer) return;
        if (!state.parsedJobs || state.parsedJobs.length === 0) {
            jobListContainer.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted);">Scan the calendar to see sortable jobs.</div>';
            // Hide all filter options initially
            Object.values(jobSortFilters).forEach(selectEl => {
                if (!selectEl) return;
                const defaultOption = selectEl.querySelector('option[value=""]');
                selectEl.innerHTML = '';
                if (defaultOption) selectEl.appendChild(defaultOption);
            });
            return;
        }

        // 1. Get current selections from the DOM
        const currentSelections = {
            tags: parseInt(jobSortFilters.tags?.value || "0"),
            roofType: jobSortFilters.roofType?.value || "",
            jobType: jobSortFilters.jobType?.value || "",
            city: jobSortFilters.city?.value || "",
            stories: jobSortFilters.stories?.value || "",
            day: jobSortFilters.day?.value || "",
            time: jobSortFilters.time?.value || "",
        };

        // 2. Helper to filter jobs based on a dynamic set of selections
        const getFilteredJobs = (jobs, selectionsToApply) => {
            return jobs.filter(job => {
                if (selectionsToApply.tags && job.hashTags < selectionsToApply.tags) return false;
                if (selectionsToApply.roofType && job.roofType !== selectionsToApply.roofType) return false;
                if (selectionsToApply.city && job.city !== selectionsToApply.city) return false;
                if (selectionsToApply.stories && job.stories !== selectionsToApply.stories) return false;
                if (selectionsToApply.day && job.day !== selectionsToApply.day) return false;
                if (selectionsToApply.time && job.time !== selectionsToApply.time) return false;

                // Job Type filtering
                if (selectionsToApply.jobType) {
                    if (selectionsToApply.jobType === 'Residential') {
                        if (job.jobType !== 'Residential') return false;
                    } else {
                        if (!job.rawTags.includes(selectionsToApply.jobType)) return false;
                    }
                }
                return true;
            });
        };

        // 3. For each filter, calculate its available options based on OTHER filters
        const filterKeys = ['roofType', 'jobType', 'city', 'stories', 'day', 'time', 'tags'];
        const availableOptions = {};

        filterKeys.forEach(key => {
            const otherFilters = { ...currentSelections };
            otherFilters[key] = ""; // Consider the current filter as "All" to find its possibilities

            const possibleJobs = getFilteredJobs(state.parsedJobs, otherFilters);
            const options = new Set();
            possibleJobs.forEach(job => {
                if (key === 'tags') {
                    if (job.hashTags > 0) options.add(job.hashTags);
                } else if (key === 'jobType') {
                    if (job.rawTags.length > 0) {
                        job.rawTags.forEach(tag => options.add(tag));
                    } else {
                        options.add('Residential');
                    }
                } else if (job[key] && job[key] !== 'Unknown') {
                    options.add(job[key]);
                }
            });
            availableOptions[key] = options;
        });

        // 4. Helper to repopulate a select element, preserving its value
        const updateSelectOptions = (selectEl, optionsSet, sortFn) => {
            if (!selectEl) return;

            const currentValue = selectEl.value;
            const defaultOptionText = selectEl.id === 'sort-filter-tags' ? 'Any' : 'All';
            selectEl.innerHTML = `<option value="">${defaultOptionText}</option>`;

            let sortedOptions = [...optionsSet];
            if (sortFn) sortedOptions.sort(sortFn);
            else sortedOptions.sort((a, b) => a.localeCompare(b));

            sortedOptions.forEach(val => {
                const opt = document.createElement('option');
                opt.value = val;
                opt.textContent = val;
                selectEl.appendChild(opt);
            });

            // Restore the previous value if it's still a valid option
            selectEl.value = optionsSet.has(currentValue) ? currentValue : "";
        };

        // 5. Update the DOM for each select element
        updateSelectOptions(jobSortFilters.roofType, availableOptions.roofType);
        updateSelectOptions(jobSortFilters.jobType, availableOptions.jobType);

        const citySortFn = (a, b) => {
            const indexA = CONFIG.CITY_SORT_ORDER.indexOf(a);
            const indexB = CONFIG.CITY_SORT_ORDER.indexOf(b);
            if (indexA === -1 && indexB === -1) return a.localeCompare(b);
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
        };
        updateSelectOptions(jobSortFilters.city, availableOptions.city, citySortFn);

        updateSelectOptions(jobSortFilters.stories, availableOptions.stories, (a, b) => a.localeCompare(b, undefined, { numeric: true }));

        const dayOrder = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        updateSelectOptions(jobSortFilters.day, availableOptions.day, (a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));

        const timeOrder = ['7:30am-9am', '10am-12pm', '1pm-3pm', '4pm-6pm'];
        updateSelectOptions(jobSortFilters.time, availableOptions.time, (a, b) => timeOrder.indexOf(a) - timeOrder.indexOf(b));

        // Special handling for tags dropdown
        if (jobSortFilters.tags) {
            const currentTagVal = jobSortFilters.tags.value;
            const availableTagCounts = availableOptions.tags;

            const tagOptions = [
                { value: '1', text: '#+', enabled: availableTagCounts.has(1) || availableTagCounts.has(2) || availableTagCounts.has(3) },
                { value: '2', text: '##+', enabled: availableTagCounts.has(2) || availableTagCounts.has(3) },
                { value: '3', text: '###+', enabled: availableTagCounts.has(3) }
            ];

            jobSortFilters.tags.innerHTML = '<option value="">Any</option>';
            tagOptions.forEach(opt => {
                if (opt.enabled) {
                    jobSortFilters.tags.innerHTML += `<option value="${opt.value}">${opt.text}</option>`;
                }
            });

            jobSortFilters.tags.value = currentTagVal;
        }

        // 6. Render the final list of jobs using the `currentSelections`
        const finalFilteredJobs = getFilteredJobs(state.parsedJobs, currentSelections);

        jobListContainer.innerHTML = '';
        if (finalFilteredJobs.length === 0) {
            jobListContainer.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted);">No jobs match filters.</div>';
        } else {
            finalFilteredJobs.forEach(job => {
                const item = document.createElement('div');
                item.className = 'job-item-v2';

                const hashtagsHTML = `<span class="job-v2-hashtags count-${job.hashTags}">${'#'.repeat(job.hashTags)}</span>`;

                let rawTagsHTML = '';
                if (job.rawTags && job.rawTags.length > 0) {
                    const tagPills = job.rawTags.map(tag =>
                        `<span class="job-v2-tag-pill ${getTagColorClass(tag)}">${tag}</span>`
                    ).join('');
                    rawTagsHTML = `<div class="job-v2-raw-tags">${tagPills}</div>`;
                }

                item.innerHTML = `
                <div class="job-v2-main">
                    <div class="job-v2-address">${job.address}</div>
                    <div class="job-v2-city">${job.city}</div>
                    <div class="job-v2-details-compact">
                        ${job.hashTags > 0 ? hashtagsHTML : ''}
                        <span title="Roof Type"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M2 15.5s2-1.5 4-1.5 4 1.5 4 1.5 2-1.5 4-1.5 4 1.5 4 1.5v4s-2-1.5-4-1.5-4 1.5-4-1.5-2-1.5-4-1.5-4 1.5-4 1.5zM2 8.5s2-1.5 4-1.5 4 1.5 4 1.5 2-1.5 4-1.5 4 1.5 4 1.5v4s-2-1.5-4-1.5-4 1.5-4-1.5-2-1.5-4-1.5-4 1.5-4 1.5z"/></svg> ${job.roofType}</span>
                        <span title="Roof Age"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${job.roofAge !== 'Unknown' ? job.roofAge + ' yrs' : 'N/A'}</span>
                        <span title="Stories"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> ${job.stories !== 'Unknown' ? job.stories + 'S' : 'N/A'}</span>
                    </div>
                    ${rawTagsHTML}
                </div>
                <div class="job-v2-time">
                    <div class="job-v2-day">${job.day}</div>
                    <div class="job-v2-timeslot">${job.time}</div>
                </div>
            `;
                item.addEventListener('click', () => {
                    sendFindCommand({ type: 'HIGHLIGHT_EVENT', title: job.event.title, start: job.event.start });
                });
                jobListContainer.appendChild(item);
            });
        }
    }


    /* ========= Event Listeners Setup ========= */
    if (toggleAllBtn) toggleAllBtn.addEventListener("click", () => { setAllCardsCollapsed(!areAllCardsCollapsed()); updateToggleAllLabel(); });

    function updateFindCounter() { if (findCounter) findCounter.textContent = `${findStats.index > 0 ? findStats.index : 0} / ${findStats.count}`; }
    const pushFindUpdate = debounce(async (term) => {
        const res = await sendFindCommand({ type: "SIDEFIND_UPDATE", term, flags: { caseSensitive: false, wholeWord: false } });
        if (res?.stats) { findStats = res.stats; updateFindCounter(); }
    }, 250);
    if (findInput) findInput.addEventListener("input", (e) => {
        pushFindUpdate(e.target.value);
        updateFindClearButton();
    });
    if (findClearBtn) {
        findClearBtn.addEventListener("click", async () => {
            findInput.value = "";
            updateFindClearButton();
            const res = await sendFindCommand({ type: "SIDEFIND_CLEAR_HIGHLIGHTS" });
            if (res?.stats) { findStats = res.stats; updateFindCounter(); }
        });
    }
    if (findNextBtn) findNextBtn.addEventListener("click", async () => {
        const res = await sendFindCommand({ type: "SIDEFIND_NEXT" });
        if (res?.stats) { findStats = res.stats; updateFindCounter(); }
    });
    if (findPrevBtn) findPrevBtn.addEventListener("click", async () => {
        const res = await sendFindCommand({ type: "SIDEFIND_PREV" });
        if (res?.stats) { findStats = res.stats; updateFindCounter(); }
    });
    if (dockNoteSaveBtn && dockNoteInput) {
        // Auto-save dock notes to storage
        const DOCK_NOTE_KEY = 'roofr_dock_note';
        let dockNoteDebounce = null;

        // Load saved dock note on startup (try sync first for cross-browser, then local)
        chrome.storage.sync.get(DOCK_NOTE_KEY, (result) => {
            if (result[DOCK_NOTE_KEY]) {
                dockNoteInput.innerHTML = result[DOCK_NOTE_KEY];
            } else {
                // Fallback to local storage
                chrome.storage.local.get(DOCK_NOTE_KEY, (localResult) => {
                    if (localResult[DOCK_NOTE_KEY]) {
                        dockNoteInput.innerHTML = localResult[DOCK_NOTE_KEY];
                    }
                });
            }
        });

        // Listen for dock note changes from other instances
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (changes[DOCK_NOTE_KEY] && document.activeElement !== dockNoteInput) {
                dockNoteInput.innerHTML = changes[DOCK_NOTE_KEY].newValue || '';
            }
        });

        // Auto-save on input with debounce (to both sync and local)
        dockNoteInput.addEventListener('input', () => {
            clearTimeout(dockNoteDebounce);
            dockNoteDebounce = setTimeout(() => {
                const content = dockNoteInput.innerHTML;
                // Save to sync for cross-browser sync
                chrome.storage.sync.set({ [DOCK_NOTE_KEY]: content }).catch(() => {
                    console.warn('[Dock Note] Sync storage quota exceeded');
                });
                // Also save to local as backup
                chrome.storage.local.set({ [DOCK_NOTE_KEY]: content });
            }, 500);
        });

        // Add paste event handler - respects formatting toggle
        dockNoteInput.addEventListener('paste', (e) => {
            e.preventDefault(); // Prevent default paste behavior

            let pastedContent;

            // Check if formatting is enabled (use window function since toggle state is defined later)
            const formattingEnabled = window.__dockNoteFormattingEnabled ? window.__dockNoteFormattingEnabled() : true;

            if (formattingEnabled) {
                // Try to get HTML content first (preserves formatting)
                pastedContent = e.clipboardData.getData('text/html');

                // If no HTML, fall back to plain text
                if (!pastedContent) {
                    pastedContent = e.clipboardData.getData('text/plain');
                    // Preserve line breaks when pasting plain text
                    pastedContent = pastedContent.replace(/\n/g, '<br>');
                }
            } else {
                // Formatting disabled - always use plain text
                pastedContent = e.clipboardData.getData('text/plain');
                // Preserve line breaks
                pastedContent = pastedContent.replace(/\n/g, '<br>');
            }

            // Insert the content at cursor position
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                range.deleteContents();

                // Create a document fragment from the HTML
                const template = document.createElement('template');
                template.innerHTML = pastedContent;
                const fragment = template.content;

                // Insert the fragment at cursor
                range.insertNode(fragment);

                // Move cursor to end of inserted content
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        });

        dockNoteSaveBtn.addEventListener("click", () => {
            const content = dockNoteInput.innerHTML.trim();
            if (content) {
                addNewClipboard(content, "Quick Note " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

                // Auto-enable clipboard tab if hidden
                if (!userPrefs.showClipboardTab) {
                    userPrefs.showClipboardTab = true;
                    saveUserPrefs();
                    // Fix: also save to sync so it doesn't get overwritten on reload
                    if (chrome.storage && chrome.storage.sync) {
                        chrome.storage.sync.set({ show_clipboard: true });
                    }
                    applyUserPrefs();
                    showToast("Clipboard Tab & Auto-Enabled");
                }

                dockNoteInput.innerHTML = "";
                // Clear auto-saved note from both sync and local
                chrome.storage.sync.remove(DOCK_NOTE_KEY);
                chrome.storage.local.remove(DOCK_NOTE_KEY);
                const originalText = dockNoteSaveBtn.textContent;
                dockNoteSaveBtn.textContent = "Saved!";
                setTimeout(() => dockNoteSaveBtn.textContent = originalText, 1000);
            }
        });

        // Highlight selected text on the Roofr page
        dockNoteInput.addEventListener("mouseup", async () => {
            const selection = window.getSelection();
            const selectedText = selection.toString().trim();

            if (selectedText) {
                // Use the SideFind functionality to highlight the selected text
                const res = await sendFindCommand({
                    type: "SIDEFIND_UPDATE",
                    term: selectedText,
                    flags: {
                        caseSensitive: false,
                        wholeWord: false,
                        useRegex: false
                    }
                });

                if (res?.stats) {
                    findStats = res.stats;
                    updateFindCounter();
                    // Update the find input to show what's being searched
                    if (findInput) {
                        findInput.value = selectedText;
                        updateFindClearButton();
                    }
                }
            }
        });

        // Also trigger on keyboard selection (arrow keys + shift)
        dockNoteInput.addEventListener("keyup", async (e) => {
            // Only trigger for shift+arrow keys or other selection keys
            if (e.shiftKey || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
                const selection = window.getSelection();
                const selectedText = selection.toString().trim();

                if (selectedText) {
                    const res = await sendFindCommand({
                        type: "SIDEFIND_UPDATE",
                        term: selectedText,
                        flags: {
                            caseSensitive: false,
                            wholeWord: false,
                            useRegex: false
                        }
                    });

                    if (res?.stats) {
                        findStats = res.stats;
                        updateFindCounter();
                        if (findInput) {
                            findInput.value = selectedText;
                            updateFindClearButton();
                        }
                    }
                }
            }
        });
    }

    // === DOCK NOTES TEXT SIZE & FORMAT CONTROLS ===
    let dockNoteTextSize = 100; // Default 100%
    const DOCK_NOTE_SIZE_KEY = 'roofr_dock_note_size';

    // Load saved text size
    chrome.storage.local.get(DOCK_NOTE_SIZE_KEY, (result) => {
        if (result[DOCK_NOTE_SIZE_KEY]) {
            dockNoteTextSize = result[DOCK_NOTE_SIZE_KEY];
            updateDockNoteTextSize();
        }
    });

    function updateDockNoteTextSize() {
        if (dockNoteInput) {
            dockNoteInput.style.fontSize = `${dockNoteTextSize * 0.009}rem`; // Base is 0.9rem at 100%
        }
        if (dockNoteSizeDisplay) {
            dockNoteSizeDisplay.textContent = `${dockNoteTextSize}%`;
        }
        chrome.storage.local.set({ [DOCK_NOTE_SIZE_KEY]: dockNoteTextSize });
    }

    if (dockNoteSizeUp) {
        dockNoteSizeUp.addEventListener('click', () => {
            if (dockNoteTextSize < 200) {
                dockNoteTextSize += 10;
                updateDockNoteTextSize();
            }
        });
    }

    if (dockNoteSizeDown) {
        dockNoteSizeDown.addEventListener('click', () => {
            if (dockNoteTextSize > 50) {
                dockNoteTextSize -= 10;
                updateDockNoteTextSize();
            }
        });
    }

    // Formatting toggle state
    let dockNoteFormattingEnabled = true;
    const DOCK_NOTE_FORMAT_KEY = 'roofr_dock_note_formatting';

    // Load saved formatting preference
    chrome.storage.local.get(DOCK_NOTE_FORMAT_KEY, (result) => {
        if (result[DOCK_NOTE_FORMAT_KEY] !== undefined) {
            dockNoteFormattingEnabled = result[DOCK_NOTE_FORMAT_KEY];
            updateFormatToggleUI();
        }
    });

    function updateFormatToggleUI() {
        if (dockNoteToggleFormat) {
            if (dockNoteFormattingEnabled) {
                dockNoteToggleFormat.classList.add('active');
                dockNoteToggleFormat.title = 'Formatting: ON (click to toggle)';
                dockNoteToggleFormat.textContent = 'T';
            } else {
                dockNoteToggleFormat.classList.remove('active');
                dockNoteToggleFormat.title = 'Formatting: OFF (click to toggle)';
                dockNoteToggleFormat.textContent = 'T';
            }
        }
    }

    if (dockNoteToggleFormat && dockNoteInput) {
        dockNoteToggleFormat.addEventListener('click', () => {
            dockNoteFormattingEnabled = !dockNoteFormattingEnabled;
            chrome.storage.local.set({ [DOCK_NOTE_FORMAT_KEY]: dockNoteFormattingEnabled });
            updateFormatToggleUI();

            if (!dockNoteFormattingEnabled) {
                // When turning OFF formatting, strip existing formatting
                const htmlContent = dockNoteInput.innerHTML;
                const temp = document.createElement('div');
                temp.innerHTML = htmlContent;
                let plainText = temp.innerText || temp.textContent || '';
                plainText = plainText.replace(/\n/g, '<br>');
                dockNoteInput.innerHTML = plainText;
                dockNoteInput.dispatchEvent(new Event('input', { bubbles: true }));
                showToast('Formatting OFF - pasted text will be plain');
            } else {
                showToast('Formatting ON - pasted text keeps styling');
            }
        });
    }

    // Export formatting state for paste handler
    window.__dockNoteFormattingEnabled = () => dockNoteFormattingEnabled;

    // === DOCK RESIZE LOGIC ===
    if (dockResizeHandle && dockNoteInput) {
        let isDragging = false;
        let startY;
        let startHeight;

        dockResizeHandle.addEventListener("mousedown", (e) => {
            isDragging = true;
            startY = e.clientY;
            startHeight = parseInt(window.getComputedStyle(dockNoteInput).height, 10);
            document.body.style.userSelect = "none";
            dockResizeHandle.style.cursor = "ns-resize";
        });

        document.addEventListener("mousemove", (e) => {
            if (!isDragging) return;
            const delta = startY - e.clientY;
            let newHeight = startHeight + delta;
            const minHeight = 36;
            const maxHeight = window.innerHeight * 0.8;
            if (newHeight < minHeight) newHeight = minHeight;
            if (newHeight > maxHeight) newHeight = maxHeight;
            dockNoteInput.style.height = `${newHeight}px`;
        });

        document.addEventListener("mouseup", () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.userSelect = "";
                dockResizeHandle.style.cursor = "";
            }
        });
    }


    const copyWeekBtn = document.getElementById("copyWeekBtn");
    if (copyWeekBtn) copyWeekBtn.addEventListener("click", async () => await copyToClipboard(buildCopyLinesForWeek().join("\n"), copyWeekBtn));
    regionPills.forEach(t => t.addEventListener("click", () => {
        state.currentRegion = t.dataset.region || "PHX";
        debouncedSaveState();
        renderUIFromState();
    }));
    function activateMainTab(targetId) {
        mainTabs.forEach(btn => btn.classList.toggle("active", btn.getAttribute("data-target") === targetId));
        Object.values(sections).forEach(el => { if (el) el.classList.remove('active'); });
        const activeSection = sections[targetId];
        if (activeSection) activeSection.classList.add('active');

        // Toggle secondary header actions based on tab
        if (scannerToolbar) {
            if (targetId === 'sec-scanner') {
                scannerToolbar.classList.remove('hidden');
            } else {
                scannerToolbar.classList.add('hidden');
            }
        }

        // Check prefs to see if we should hide this tab
        if (targetId === 'sec-people' && !userPrefs.showPeopleTab) activateMainTab('sec-scanner');
        if (targetId === 'sec-clipboard' && !userPrefs.showClipboardTab) activateMainTab('sec-scanner');
    }
    mainTabs.forEach(btn => btn.addEventListener("click", () => activateMainTab(btn.getAttribute("data-target"))));

    /* ========= Sticky Header Scroll Logic with Hysteresis ========= */
    let isShrunk = false;
    window.addEventListener("scroll", () => {
        const scrollY = window.scrollY;
        if (!isShrunk && scrollY > 50) {
            // Only shrink after scrolling down a bit
            stickyHeader.classList.add("shrink");
            isShrunk = true;
        } else if (isShrunk && scrollY < 10) {
            // Only expand when almost at the top
            stickyHeader.classList.remove("shrink");
            isShrunk = false;
        }
    });

    /* ========= Load Settings ========= */
    async function loadSettings() {
        if (chrome.storage && chrome.storage.sync) {
            const keys = [
                "NEXT_SHEET_ID", "AVAIL_RANGE_PHX", "AVAIL_RANGE_NORTH", "AVAIL_RANGE_SOUTH",
                "search_google_earth", "search_gemini", "search_roofr"
            ];
            const defaults = {
                search_google_earth: true,
                search_gemini: true,
                search_roofr: true
            };
            const result = await chrome.storage.sync.get(keys);
            settings = { ...defaults, ...settings, ...result };
        }
    }

    /* ========= Scan Logic ========= */
    async function runScanFlow(isAuto = false) {
        addLog("Scan flow initiated.");
        scanBtn.disabled = true;
        scanBtn.innerHTML = '<span class="scan-spinner"></span> Scanning...';
        if (!settings.NEXT_SHEET_ID) {
            document.getElementById('setup-banner')?.classList.remove('hidden');
            scanBtn.disabled = false; updateScanButtonState();
            return;
        }

        // Polling logic to wait for content
        const maxRetries = 10;
        let attempts = 0;

        const attemptScan = async () => {
            // 0. Ensure Sales event type is selected
            await sendFindCommand({ type: "SELECT_SALES_EVENT_TYPE" });
            // Small wait to allow calendar to update events if needed
            await new Promise(r => setTimeout(r, 500));

            // 0.5 Check view - only switch if Monthly (preserve Daily view for single-day scans)
            const viewResult = await sendFindCommand({ type: "GET_CALENDAR_VIEW" });
            if (viewResult && viewResult.ok) {
                if (viewResult.view === 'monthly') {
                    addLog("Monthly view detected, switching to Weekly...");
                    await sendFindCommand({ type: "SWITCH_TO_WEEKLY_VIEW" });
                    // Wait for view transition
                    await new Promise(r => setTimeout(r, 1500));
                } else if (viewResult.view === 'daily') {
                    addLog("Daily view detected, scanning single day...");
                }
            }

            // 1. Check for Dates
            const visibleDates = await sendFindCommand({ type: "GET_VISIBLE_DATES" });

            if (visibleDates?.ok && visibleDates.datesISO && visibleDates.datesISO.length > 0) {

                // 2. Check for Events (wait for them to load)
                let eventRetries = 5;
                let eventsFound = false;
                let eventData = null;

                while (eventRetries > 0) {
                    eventData = await sendFindCommand({ type: "EXTRACT_ROOFR_EVENTS" });
                    if (eventData && eventData.events && eventData.events.length > 0) {
                        eventsFound = true;
                        break;
                    }
                    // Wait 500ms before checking events again
                    await new Promise(r => setTimeout(r, 500));
                    eventRetries--;
                }

                // Even if no events found after retries, we proceed (maybe it's an empty week)
                // But we gave it a fair chance.

                state.weekDays = visibleDates.datesISO;
                pageDatesISO = visibleDates.datesISO;

                const firstDate = new Date(state.weekDays[0] + "T12:00:00Z");
                const dayOfWeek = firstDate.getUTCDay();
                const sundayDate = new Date(firstDate);
                sundayDate.setUTCDate(firstDate.getUTCDate() - dayOfWeek);
                const sundayISO = `${sundayDate.getUTCFullYear()}-${String(sundayDate.getUTCMonth() + 1).padStart(2, '0')}-${String(sundayDate.getUTCDate()).padStart(2, '0')}`;

                await fetchSheetCapacitiesForSunday(sundayISO);

                state.allEvents = eventData?.events || [];
                state.parsedJobs = state.allEvents.map(ev => CONFIG.parseJobDetails(ev));
                initJobSortingTab();

                addLog(`Scan complete. Extracted ${state.allEvents.length} events.`);
                await debouncedSaveState();
                renderUIFromState();
                scanBtn.disabled = false;
                updateScanButtonState();

                // Clear the stored target tab ID after successful scan
                window.__targetRoofrTabId = null;

                // Auto-verify uncategorized events
                await autoVerifyUncategorizedEvents();

                // Re-apply city highlight if address input has a value
                if (state.addressInput) {
                    const cityList = CONFIG.resolveCityCandidatesFromInput(state.addressInput);
                    if (cityList.length > 0) {
                        const primaryCity = cityList[0];
                        state.highlightedCity = primaryCity;
                        await sendFindCommand({ type: 'HIGHLIGHT_CITY', city: primaryCity });
                    }
                }

                // If we navigated to a new week due to priority recommendation, re-run the recommendation
                if (state.pendingWeekNav && state.addressInput) {
                    addLog("Re-running recommendation after week navigation...");
                    // NOTE: Keep pendingWeekNav set until runMainRecommendation checks it
                    // This allows the loop prevention logic to work correctly
                    await debouncedSaveState();
                    // Small delay to ensure UI is updated
                    setTimeout(() => {
                        runMainRecommendation();
                    }, 500);
                }

            } else {
                // Dates not found yet
                attempts++;
                if (attempts < maxRetries) {
                    addLog(`Scan attempt ${attempts} failed (no dates). Retrying...`);
                    setTimeout(attemptScan, 500);
                } else {
                    // Final failure
                    if (!isAuto) alert("Could not detect dates on page. Please ensure the calendar is visible.");
                    scanBtn.disabled = false;
                    updateScanButtonState();
                    // Clear the stored target tab ID on failure
                    window.__targetRoofrTabId = null;
                }
            }
        };

        attemptScan();
    }

    // Helper function to send command to a specific tab
    async function sendCommandToTab(tabId, payload) {
        try {
            return await chrome.tabs.sendMessage(tabId, payload);
        } catch (e) {
            if (e.message && e.message.includes('Receiving end does not exist')) {
                // Inject content script and retry
                try {
                    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
                    await new Promise(r => setTimeout(r, 200));
                    return await chrome.tabs.sendMessage(tabId, payload);
                } catch (retryError) {
                    addLog(`Failed to inject script: ${retryError.message}`, 'ERROR');
                    return null;
                }
            }
            addLog(`Failed to send message: ${e.message}`, 'ERROR');
            return null;
        }
    }

    // Setup calendar: switch to weekly view, select Sales, select all team members
    // forceWeekly: true when opening/switching to calendar tab (not already on it)
    async function setupCalendarForScan(tabId, forceWeekly = true) {
        addLog("Setting up calendar for scan...");

        // Step 1: Check current view and switch to weekly if needed
        const viewResult = await sendCommandToTab(tabId, { type: "GET_CALENDAR_VIEW" });
        if (viewResult?.ok) {
            addLog(`Current view: ${viewResult.view}`);
            // If forceWeekly is true (navigating to calendar), always switch to weekly unless already weekly
            // If forceWeekly is false (already on calendar), only switch from monthly
            const shouldSwitch = forceWeekly
                ? (viewResult.view !== 'weekly')
                : (viewResult.view === 'monthly');

            if (shouldSwitch) {
                addLog(`Switching to weekly view (forceWeekly: ${forceWeekly})...`);
                const switchResult = await sendCommandToTab(tabId, { type: "SWITCH_TO_WEEKLY_VIEW" });
                // If dropdown was clicked, wait for the dropdown to open, Weekly to be clicked, and view to change
                if (switchResult?.dropdown) {
                    addLog("Dropdown opened, waiting for Weekly selection...");
                    await new Promise(r => setTimeout(r, 1000)); // Wait for dropdown animation and Weekly click
                }
                await new Promise(r => setTimeout(r, 2000)); // Wait for view to fully change and render
            } else if (viewResult.view === 'daily' && !forceWeekly) {
                addLog("Daily view detected, scanning single day...");
            }
        }

        // Step 2: Select Sales event type (with retries)
        addLog("Selecting Sales event type...");
        let salesResult = await sendCommandToTab(tabId, { type: "SELECT_SALES_EVENT_TYPE" });

        // Retry if Sales wasn't found (page might still be loading)
        if (!salesResult?.ok) {
            addLog("Sales not found, retrying...");
            await new Promise(r => setTimeout(r, 1000));
            salesResult = await sendCommandToTab(tabId, { type: "SELECT_SALES_EVENT_TYPE" });
        }
        if (!salesResult?.ok) {
            addLog("Sales not found, retrying again...");
            await new Promise(r => setTimeout(r, 1000));
            salesResult = await sendCommandToTab(tabId, { type: "SELECT_SALES_EVENT_TYPE" });
        }

        if (salesResult?.ok) {
            addLog(salesResult.wasAlreadyChecked ? "Sales already selected" : "Sales selected");
        } else {
            addLog("Warning: Could not select Sales event type", "WARN");
        }
        await new Promise(r => setTimeout(r, 500));

        // Step 3: Select all team members (with retries)
        addLog("Selecting all team members...");
        let teamResult = await sendCommandToTab(tabId, { type: "SELECT_ALL_TEAM_MEMBERS" });

        // Retry if Select All wasn't found
        if (!teamResult?.ok) {
            addLog("Select All not found, retrying...");
            await new Promise(r => setTimeout(r, 1000));
            teamResult = await sendCommandToTab(tabId, { type: "SELECT_ALL_TEAM_MEMBERS" });
        }

        if (teamResult?.ok) {
            addLog("All team members selected");
        } else {
            addLog("Warning: Could not select all team members", "WARN");
        }
        await new Promise(r => setTimeout(r, 1500)); // Wait for calendar to update with all events

        return true;
    }

    // Helper to ensure calendar tab is open and focused
    // Returns the calendar tab, or null if already on calendar
    async function ensureCalendarTabOpen() {
        // Check stored target tab first (for popup mode)
        if (window.__targetRoofrTabId) {
            try {
                const storedTab = await chrome.tabs.get(window.__targetRoofrTabId);
                if (storedTab?.url?.includes('app.roofr.com') && storedTab?.url?.includes('/calendar')) {
                    return null; // Already have a valid calendar tab
                }
            } catch (e) {
                window.__targetRoofrTabId = null;
            }
        }

        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const isRoofrCalendarTab = currentTab?.url?.includes('app.roofr.com') && currentTab?.url?.includes('/calendar');

        if (isRoofrCalendarTab) {
            window.__targetRoofrTabId = currentTab.id;
            return null; // Already on calendar
        }

        // Not on Roofr calendar - find existing calendar tab or open new one in target window
        const calendarUrl = "https://app.roofr.com/dashboard/team/239329/calendar";
        let targetTab = null;

        // Search for existing Roofr calendar tabs in target window only
        const queryOpts = { url: "*://app.roofr.com/dashboard/team/*/calendar*" };
        if (window.__targetWindowId) queryOpts.windowId = window.__targetWindowId;
        const roofrCalendarTabs = await chrome.tabs.query(queryOpts);

        if (roofrCalendarTabs.length > 0) {
            // Found existing Roofr calendar tab(s), use the first one
            targetTab = roofrCalendarTabs[0];
            window.__targetRoofrTabId = targetTab.id;
            addLog(`Found existing Roofr calendar tab (ID: ${targetTab.id})`);
            try {
                await chrome.tabs.update(targetTab.id, { active: true });
                await chrome.windows.update(targetTab.windowId, { focused: true });
            } catch (e) {
                addLog("Could not focus tab (may be in popup mode)", "INFO");
            }
        } else {
            // No existing Roofr calendar tab, open new one in target window
            addLog("Opening new Roofr calendar tab...");
            const createOpts = { url: calendarUrl, active: true };
            if (window.__targetWindowId) createOpts.windowId = window.__targetWindowId;
            targetTab = await chrome.tabs.create(createOpts);
            window.__targetRoofrTabId = targetTab.id;

            // Wait for page to load
            await new Promise(resolve => {
                const checkLoaded = (tabId, changeInfo) => {
                    if (tabId === targetTab.id && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(checkLoaded);
                        resolve();
                    }
                };
                chrome.tabs.onUpdated.addListener(checkLoaded);
                setTimeout(() => {
                    chrome.tabs.onUpdated.removeListener(checkLoaded);
                    resolve();
                }, 30000);
            });

            // Additional wait for React to render
            await new Promise(r => setTimeout(r, 3000));
        }

        return targetTab;
    }

    // Main scan handler that checks tab and navigates if needed
    async function handleScanClick() {
        scanBtn.disabled = true;
        scanBtn.innerHTML = '<span class="scan-spinner"></span> Scanning...';

        try {
            // Check if we have a stored target tab ID (from popup window)
            if (window.__targetRoofrTabId) {
                try {
                    const storedTab = await chrome.tabs.get(window.__targetRoofrTabId);
                    if (storedTab?.url?.includes('app.roofr.com') && storedTab?.url?.includes('/calendar')) {
                        addLog(`Using stored Roofr calendar tab (ID: ${storedTab.id})`);
                        runScanFlow(false);
                        return;
                    }
                } catch (e) {
                    window.__targetRoofrTabId = null;
                }
            }

            // Get current tab
            const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const isRoofrCalendarTab = currentTab?.url?.includes('app.roofr.com') && currentTab?.url?.includes('/calendar');

            if (isRoofrCalendarTab) {
                // Already on Roofr calendar, just run the scan
                addLog("Already on Roofr calendar, running scan...");
                window.__targetRoofrTabId = currentTab.id;
                runScanFlow(false);
                return;
            }

            // Not on Roofr calendar - find existing calendar tab or open new one in target window
            addLog("Looking for existing calendar tab in target window...");
            const calendarUrl = "https://app.roofr.com/dashboard/team/239329/calendar";
            let targetTab = null;

            // Search for existing Roofr calendar tabs in target window only
            const queryOpts = { url: "*://app.roofr.com/dashboard/team/*/calendar*" };
            if (window.__targetWindowId) queryOpts.windowId = window.__targetWindowId;
            const roofrCalendarTabs = await chrome.tabs.query(queryOpts);

            if (roofrCalendarTabs.length > 0) {
                // Found existing Roofr calendar tab(s), use the first one
                targetTab = roofrCalendarTabs[0];
                window.__targetRoofrTabId = targetTab.id; // Store for popup mode
                addLog(`Found existing Roofr calendar tab (ID: ${targetTab.id})`);

                // Focus the tab (but don't if we're in popup mode - let user keep their focus)
                try {
                    await chrome.tabs.update(targetTab.id, { active: true });
                    await chrome.windows.update(targetTab.windowId, { focused: true });
                } catch (e) {
                    addLog("Could not focus tab (may be in popup mode)", "INFO");
                }
            } else {
                // No existing Roofr calendar tab, open new one in target window
                addLog("No existing Roofr calendar tab found, opening new one...");
                const createOpts = { url: calendarUrl, active: true };
                if (window.__targetWindowId) createOpts.windowId = window.__targetWindowId;
                targetTab = await chrome.tabs.create(createOpts);
                window.__targetRoofrTabId = targetTab.id; // Store for popup mode

                // Wait for page to load
                addLog("Waiting for calendar to load...");
                await new Promise(resolve => {
                    const checkLoaded = (tabId, changeInfo) => {
                        if (tabId === targetTab.id && changeInfo.status === 'complete') {
                            chrome.tabs.onUpdated.removeListener(checkLoaded);
                            resolve();
                        }
                    };
                    chrome.tabs.onUpdated.addListener(checkLoaded);
                    // Timeout after 30 seconds
                    setTimeout(() => {
                        chrome.tabs.onUpdated.removeListener(checkLoaded);
                        resolve();
                    }, 30000);
                });

                // Additional wait for React to render
                await new Promise(r => setTimeout(r, 3000));
            }

            // Now setup the calendar and scan
            await setupCalendarForScan(targetTab.id);

            // Run the scan on the target tab
            // We need to update sendFindCommand to use the target tab
            addLog("Running scan on Roofr calendar...");

            // Store the target tab ID for sendFindCommand to use
            window.__targetRoofrTabId = targetTab.id;

            runScanFlow(false);

        } catch (error) {
            addLog(`Error during scan setup: ${error.message}`, 'ERROR');
            scanBtn.disabled = false;
            updateScanButtonState();
        }
    }

    if (scanBtn) scanBtn.addEventListener("click", handleScanClick);

    // Open daily calendar view for a specific date with appropriate people selected
    async function openDailyCalendarForDate(dateStr) {
        try {
            const clickedDate = new Date(dateStr + "T00:00:00");
            const today = startOfDay(new Date());
            const todayISO = toISO(today);
            const isToday = dateStr === todayISO;

            addLog(`Opening daily calendar for ${dateStr} (${isToday ? 'today' : 'future date'})`);
            showToast(`Opening ${isToday ? 'today' : dateStr}...`);

            // Determine which people to select
            let peopleToSelect = [];

            if (isToday) {
                // Today: get reps working today from availability data
                const todayAvailability = await fetchTomorrowRepAvailability(today);
                peopleToSelect = PEOPLE_DATA.REPS.filter(name => todayAvailability[name] === true);
                addLog(`Will select ${peopleToSelect.length} working reps for today`);
            } else {
                // Tomorrow or later: select all CSRs
                peopleToSelect = [...PEOPLE_DATA.CSRS];
                addLog(`Will select ${peopleToSelect.length} CSRs for future date`);
            }

            // Open new tab with base calendar URL in target window
            const baseCalendarUrl = "https://app.roofr.com/dashboard/team/239329/calendar";
            const createOpts = { url: baseCalendarUrl, active: true };
            if (window.__targetWindowId) createOpts.windowId = window.__targetWindowId;
            const newTab = await chrome.tabs.create(createOpts);

            // Wait for the page to load
            await new Promise(resolve => {
                const checkLoaded = (tabId, changeInfo) => {
                    if (tabId === newTab.id && changeInfo.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(checkLoaded);
                        resolve();
                    }
                };
                chrome.tabs.onUpdated.addListener(checkLoaded);
                setTimeout(() => {
                    chrome.tabs.onUpdated.removeListener(checkLoaded);
                    resolve();
                }, 15000);
            });

            // Wait for React to render
            await new Promise(r => setTimeout(r, 2500));

            // Step 1: Switch to Daily view
            addLog('Switching to Daily view...');
            const switchResult = await chrome.tabs.sendMessage(newTab.id, {
                type: "SWITCH_TO_DAILY_VIEW"
            });
            if (!switchResult?.ok) {
                addLog(`Failed to switch to Daily view: ${switchResult?.error || 'Unknown'}`, 'WARN');
            }
            await new Promise(r => setTimeout(r, 500));

            // Step 2: Click the date in the mini calendar
            const day = clickedDate.getDate();
            const month = clickedDate.getMonth() + 1;
            const year = clickedDate.getFullYear();

            addLog(`Clicking date ${month}/${day}/${year} in picker...`);
            const dateResult = await chrome.tabs.sendMessage(newTab.id, {
                type: "CLICK_DATE_IN_PICKER",
                day, month, year
            });
            if (!dateResult?.ok) {
                addLog(`Failed to click date: ${dateResult?.error || 'Unknown'}`, 'WARN');
            }
            await new Promise(r => setTimeout(r, 500));

            // Step 3: Uncheck all team members first
            if (peopleToSelect.length > 0) {
                addLog('Unchecking all team members...');
                const uncheckResult = await chrome.tabs.sendMessage(newTab.id, {
                    type: "UNCHECK_ALL_TEAM_MEMBERS"
                });
                addLog(`Uncheck result: ${JSON.stringify(uncheckResult)}`);
                await new Promise(r => setTimeout(r, 300));

                // Step 4: Check only the people we want
                addLog(`Checking ${peopleToSelect.length} team members...`);
                const checkResult = await chrome.tabs.sendMessage(newTab.id, {
                    type: "CHECK_TEAM_MEMBERS",
                    names: peopleToSelect
                });

                if (checkResult?.ok) {
                    showToast(`Selected ${checkResult.checkedCount || peopleToSelect.length} ${isToday ? 'reps' : 'CSRs'}`);
                    addLog(`Checked ${checkResult.checkedCount}/${peopleToSelect.length} team members`);
                } else {
                    addLog(`Failed to check team members: ${checkResult?.error || 'Unknown'}`, 'WARN');
                }
            } else {
                showToast(isToday ? 'No reps working today' : 'No CSRs configured');
            }

        } catch (error) {
            addLog(`Error opening daily calendar: ${error.message}`, 'ERROR');
            showToast('Failed to open calendar');
        }
    }

    // Links dropdown toggle
    if (linksBtn && linksMenu) {
        linksBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            // Close other dropdowns first
            document.querySelectorAll('.dropdown-menu.show').forEach(m => {
                if (m !== linksMenu) m.classList.remove('show');
            });
            linksMenu.classList.toggle("show");
        });
    }

    // Popout button - opens extension in a separate popup window OR reconnects if already in popout
    if (popoutBtn) {
        // If in popout mode, change button to "Reconnect"
        if (isPopoutMode) {
            popoutBtn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round" style="margin-right:3px;">
                  <path d="M21 2v6h-6"></path>
                  <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
                  <path d="M3 22v-6h6"></path>
                  <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
                </svg>
                Reconnect`;
            popoutBtn.title = "Reconnect to Roofr tab";
        }

        popoutBtn.addEventListener("click", async () => {
            if (isPopoutMode) {
                // Reconnect mode - find Roofr tab in target window and show status
                const queryOpts = { url: "*://app.roofr.com/*" };
                if (window.__targetWindowId) queryOpts.windowId = window.__targetWindowId;
                const roofrTabs = await chrome.tabs.query(queryOpts);
                if (roofrTabs.length > 0) {
                    window.__targetRoofrTabId = roofrTabs[0].id;
                    showToast(`Connected to Roofr tab`);
                    console.log('[Popup] Reconnected to Roofr tab:', roofrTabs[0].id);
                } else {
                    window.__targetRoofrTabId = null;
                    showToast('No Roofr tab found - open app.roofr.com');
                }
                return;
            }

            // Normal popout mode - open new popup window
            const popupWidth = 420;
            const popupHeight = 700;
            const left = Math.round((screen.width - popupWidth) / 2);
            const top = Math.round((screen.height - popupHeight) / 2);

            // Get the current Roofr tab ID and window ID to pass to the popup
            let targetTabId = window.__targetRoofrTabId;
            if (!targetTabId) {
                // Try to find a Roofr calendar tab in target window
                const queryOpts = { url: "*://app.roofr.com/*" };
                if (window.__targetWindowId) queryOpts.windowId = window.__targetWindowId;
                const roofrTabs = await chrome.tabs.query(queryOpts);
                if (roofrTabs.length > 0) {
                    targetTabId = roofrTabs[0].id;
                }
            }

            // Build popup URL with both tab ID and window ID
            let popupUrl = chrome.runtime.getURL('popup.html');
            const params = [];
            if (targetTabId) params.push(`targetTabId=${targetTabId}`);
            if (window.__targetWindowId) params.push(`targetWindowId=${window.__targetWindowId}`);
            if (params.length > 0) popupUrl += '?' + params.join('&');

            window.open(
                popupUrl,
                'RoofrCalendarPopup',
                `width=${popupWidth},height=${popupHeight},left=${left},top=${top},resizable=yes,scrollbars=yes`
            );
        });
    }

    /* ========= Auto-Verify Uncategorized Events ========= */
    async function autoVerifyUncategorizedEvents() {
        // Find all uncategorized events
        const uncatEvents = state.allEvents.filter(ev => {
            const uniqueKey = `${ev.title}|${ev.start}`;
            // Skip if already categorized or has override
            if (CONFIG.getCityFromEvent(ev) || state.regionOverrides[uniqueKey]) return false;
            // Skip if manually ignored
            if (state.ignoredEvents[uniqueKey]) return false;
            // Skip if title contains "sales" (case-insensitive)
            if (ev.title && ev.title.toLowerCase().includes('sales')) return false;
            return true;
        });

        if (uncatEvents.length === 0) {
            addLog('No uncategorized events to auto-verify.');
            return;
        }

        addLog(`Auto-verifying ${uncatEvents.length} uncategorized event(s)...`);
        let verified = 0;
        let failed = 0;

        for (const ev of uncatEvents) {
            try {
                const result = await CONFIG.verifyAndCategorizeEvent(ev);

                if (result.success) {
                    const uniqueKey = `${ev.title}|${ev.start}`;
                    const city = result.city;
                    const region = result.region || result.suggestedRegion;

                    // Auto-assign the region
                    state.regionOverrides[uniqueKey] = region;

                    // Add city to whitelist if new
                    if (result.isNewCity && city) {
                        CONFIG.REGION_CITY_WHITELISTS[region].add(city);

                        // Try to save to Google Sheet
                        await appendCityToSheet(city, region);

                        // Save to local storage as backup
                        const data = await chrome.storage.sync.get(DYNAMIC_CITIES_KEY);
                        const currentDynamicCities = data[DYNAMIC_CITIES_KEY] || { PHX: [], NORTH: [], SOUTH: [] };

                        if (!currentDynamicCities[region]) currentDynamicCities[region] = [];
                        if (!currentDynamicCities[region].includes(city)) {
                            currentDynamicCities[region].push(city);
                            await chrome.storage.sync.set({ [DYNAMIC_CITIES_KEY]: currentDynamicCities });
                            userAddedCities = currentDynamicCities;
                        }

                        addLog(`Auto-verified: "${city}" added to ${region}`);
                    } else {
                        addLog(`Auto-verified: ${city} (${region})`);
                    }
                    verified++;
                } else {
                    failed++;
                }
            } catch (err) {
                addLog(`Auto-verify error for "${ev.title}": ${err.message}`);
                failed++;
            }

            // Small delay between requests to avoid rate limiting
            await new Promise(r => setTimeout(r, 200));
        }

        if (verified > 0) {
            await debouncedSaveState();
            renderUIFromState();
            showToast(`Auto-verified ${verified} event(s)`);
        }

        addLog(`Auto-verify complete: ${verified} verified, ${failed} failed.`);
    }

    /* ========= Read B6 from Google Sheets ========= */
    if (readB6Btn) readB6Btn.addEventListener("click", async () => {
        try {
            const apiKey = CONFIG.apiKey;
            const sheetId = settings.NEXT_SHEET_ID;
            if (!apiKey || !sheetId) {
                if (b6Result) b6Result.textContent = "Error: Sheet ID not configured";
                return;
            }

            const tabName = "SRA 12/15-12/21";
            const range = "B6";
            const qTab = `'${tabName.replace(/'/g, "''")}'`;
            const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(`${qTab}!${range}`)}?key=${encodeURIComponent(apiKey)}`;

            if (b6Result) b6Result.textContent = "Reading...";

            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) throw new Error(`API error: ${res.statusText}`);

            const data = await res.json();
            const value = data.values?.[0]?.[0] || "(empty)";

            if (b6Result) b6Result.textContent = `B6 = ${value}`;
            addLog(`Read B6 from ${tabName}: ${value}`);
        } catch (e) {
            if (b6Result) b6Result.textContent = `Error: ${e.message}`;
            addLog(`Error reading B6: ${e.message}`, 'ERROR');
        }
    });

    /* ========= Recommendation Logic ========= */
    function findBestSlotStacking(targetCity, weekDays, allEvents, availability, currentRegion) {
        const candidates = [];
        const today = startOfDay(new Date());
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowISO = toISO(tomorrow);
        const keyToIndex = { "B1": 0, "B2": 1, "B3": 2, "B4": 3 };
        const cityStr = targetCity.toUpperCase();

        console.log('findBestSlotStacking debug:', { tomorrowISO, weekDays, currentRegion });

        for (const dateStr of weekDays) {
            // Only recommend tomorrow or later (never today)
            if (dateStr < tomorrowISO) {
                console.log(`Skipping ${dateStr}: before tomorrow (${tomorrowISO})`);
                continue;
            }
            const dailyEvents = allEvents.filter(e => localDayKey(e.start) === dateStr);
            const totals = CONFIG.computeDailyTotals(dateStr, dailyEvents, availability, currentRegion);
            // Check if ANY block has availability (don't skip based on netAvailable alone)
            // perBlockRemaining values can be null if no capacity set, or negative if overbooked
            const hasAnyBlockAvailable = Object.values(totals.perBlockRemaining || {}).some(v => v !== null && v > 0);

            console.log(`Day ${dateStr}:`, {
                netAvailable: totals.netAvailable,
                hasAnyBlockAvailable,
                perBlockRemaining: totals.perBlockRemaining
            });

            if (totals.netAvailable <= 0 && !hasAnyBlockAvailable) {
                console.log(`Skipping ${dateStr}: no availability`);
                continue;
            }

            const cityEvents = dailyEvents.filter(e => {
                const c = CONFIG.getCityFromEvent(e);
                return c && c.toUpperCase() === cityStr;
            });
            const stackSize = cityEvents.length;
            if (stackSize >= 4) continue;

            const blocks = CONFIG.blockWindowForDate(new Date(dateStr + "T00:00"));
            const usedBlocks = new Set();
            cityEvents.forEach(ev => {
                blocks.forEach(b => {
                    if (CONFIG.overlapMinutes({ start: ev.start, end: ev.end }, b) >= 15) {
                        usedBlocks.add(b.key);
                    }
                });
            });

            const validOptions = [];
            blocks.forEach((b) => {
                const remaining = totals.perBlockRemaining[b.key] ?? 0;
                if (remaining > 0 && !usedBlocks.has(b.key)) {
                    const idx = keyToIndex[b.key];
                    let minDistance = Infinity;

                    if (stackSize === 0) {
                        minDistance = 0;
                    } else {
                        for (const usedKey of usedBlocks) {
                            const usedIdx = keyToIndex[usedKey];
                            const dist = Math.abs(idx - usedIdx);
                            if (dist < minDistance) minDistance = dist;
                        }
                    }
                    validOptions.push({ key: b.key, idx, minDistance, remaining });
                }
            });

            if (validOptions.length > 0) {
                validOptions.sort((a, b) => {
                    // 1. Proximity
                    if (a.minDistance !== b.minDistance) return a.minDistance - b.minDistance;
                    // 2. Availability
                    if (b.remaining !== a.remaining) return b.remaining - a.remaining;
                    // 3. Time
                    return a.idx - b.idx;
                });
                const best = validOptions[0];
                let reason = "";

                if (stackSize > 0) {
                    const existingIndices = Array.from(usedBlocks).map(k => keyToIndex[k]);
                    const bestIdx = best.idx;
                    const above = existingIndices.some(i => i < bestIdx);
                    const below = existingIndices.some(i => i > bestIdx);

                    if (above && below) {
                        reason = `There are ${stackSize} ${cityStr} jobs surrounding this time slot.`;
                    } else if (above) {
                        reason = `There are ${stackSize} ${cityStr} jobs scheduled before this time slot.`;
                    } else {
                        reason = `There are ${stackSize} ${cityStr} jobs scheduled after this time slot.`;
                    }
                } else {
                    reason = `Start a new stack: High availability in this slot.`;
                }

                candidates.push({ dateStr, blockKey: best.key, stackSize, reason, remaining: best.remaining });
            }
        }

        candidates.sort((a, b) => {
            if (b.stackSize !== a.stackSize) return b.stackSize - a.stackSize;
            return new Date(a.dateStr) - new Date(b.dateStr);
        });

        return candidates;
    }

    async function runAddressRecommendation() {
        const text = (addrInput?.value || "").trim();
        if (!text) return;

        const cityList = CONFIG.resolveCityCandidatesFromInput(text);
        if (!cityList.length) { alert("City not found."); return; }

        const primaryCity = cityList[0];

        const potentialNeighbors = cityList.slice(1);
        const activeNeighbors = potentialNeighbors.filter(city => {
            const cUpper = city.toUpperCase();
            return (state.allEvents || []).some(ev => {
                const evCity = CONFIG.getCityFromEvent(ev);
                return evCity && evCity.toUpperCase() === cUpper;
            });
        });

        renderAdjacentButtons(activeNeighbors);
        await runAddressRecommendationForCity(primaryCity);
    }

    function renderAdjacentButtons(cities) {
        if (!recoOptions) return;
        recoOptions.innerHTML = '';

        if (cities.length === 0) {
            recoOptions.classList.add('hidden');
            return;
        }
        recoOptions.classList.remove('hidden');

        const label = document.createElement('span');
        label.textContent = "Close Jobs:";
        label.style.fontSize = "11px";
        label.style.fontWeight = "800";
        label.style.color = "#92400e";
        label.style.display = "flex";
        label.style.alignItems = "center";
        label.style.marginRight = "2px";
        recoOptions.appendChild(label);

        cities.forEach(city => {
            const btn = document.createElement('button');
            btn.className = 'reco-city-btn';
            btn.textContent = city;
            btn.title = `Recommend for ${city}`;
            btn.addEventListener('click', () => {
                runAddressRecommendationForCity(city);
            });
            recoOptions.appendChild(btn);
        });
    }

    async function runAddressRecommendationForCity(primaryCity) {
        const region = CONFIG.getRegionForCity(primaryCity);
        if (region) state.currentRegion = region;
        state.highlightedCity = primaryCity;

        await sendFindCommand({ type: 'CLEAR_HIGHLIGHT' });
        await sendFindCommand({ type: 'HIGHLIGHT_CITY', city: primaryCity });

        const candidates = findBestSlotStacking(
            primaryCity, state.weekDays, state.allEvents, state.availability, state.currentRegion
        );

        state.recoCandidates = candidates;
        state.recoIndex = 0;

        debouncedSaveState();
        renderUIFromState();

        if (candidates.length === 0) {
            alert(`No available capacity found for ${primaryCity} in the visible week.`);
        }
    }

    function handleNextRecommendation() {
        if (!state.recoCandidates || state.recoCandidates.length === 0) return;
        state.recoIndex = (state.recoIndex + 1) % state.recoCandidates.length;
        debouncedSaveState();
        renderUIFromState();
    }

    function handlePrevRecommendation() {
        if (!state.recoCandidates || state.recoCandidates.length === 0) return;
        state.recoIndex = (state.recoIndex - 1 + state.recoCandidates.length) % state.recoCandidates.length;
        debouncedSaveState();
        renderUIFromState();
    }

    // Main priority pills handler
    let mainPriority = 'high'; // Default
    mainPriorityPills.forEach(pill => {
        pill.addEventListener('click', async () => {
            mainPriorityPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            mainPriority = pill.dataset.priority;

            // Ensure calendar is open when clicking priority
            const targetTab = await ensureCalendarTabOpen();
            if (targetTab) {
                // Calendar was just opened/focused, setup and scan it
                await setupCalendarForScan(targetTab.id);
                window.__targetRoofrTabId = targetTab.id;
                runScanFlow(true); // Auto-scan will trigger recommendation via state
            }

            // Auto-run recommendation if there's an address already entered
            const hasAddress = addrInput?.value?.trim();
            if (hasAddress) {
                await runMainRecommendation();
                updateGoButtonState();
            }
        });
    });

    // Helper to check if it's after 5pm MST
    function isAfter5pmMST() {
        const now = new Date();
        const mstOffset = -7; // MST is UTC-7
        const utcHours = now.getUTCHours();
        const mstHours = (utcHours + mstOffset + 24) % 24;
        return mstHours >= 17;
    }

    // Helper to check if it's after 5pm MST (used for HIGH priority adjustment)
    // If after 5pm, we skip tomorrow for HIGH priority

    // Helper to find the first available date from tomorrow onwards
    function findFirstAvailableDate(allCandidates) {
        const tomorrow = new Date(startOfDay(new Date()));
        tomorrow.setDate(tomorrow.getDate() + 1);
        // If after 5pm MST, start from day after tomorrow
        if (isAfter5pmMST()) {
            tomorrow.setDate(tomorrow.getDate() + 1);
        }
        const tomorrowISO = toISO(tomorrow);

        // Filter to candidates from tomorrow onwards and find earliest
        const validCandidates = allCandidates.filter(c => c.dateStr >= tomorrowISO);
        if (validCandidates.length === 0) return null;

        // Find earliest date
        return validCandidates.reduce((min, c) =>
            c.dateStr < min ? c.dateStr : min, validCandidates[0].dateStr);
    }

    // Helper to find candidates on a specific date, with ±1 day fallback
    function findCandidatesForDate(allCandidates, targetDateISO, allowFallback = true) {
        // First try exact date
        let candidates = allCandidates.filter(c => c.dateStr === targetDateISO);
        if (candidates.length > 0) return { candidates, actualDate: targetDateISO };

        if (!allowFallback) return { candidates: [], actualDate: targetDateISO };

        // Try day after
        const targetDate = new Date(targetDateISO + 'T12:00:00');
        const dayAfter = new Date(targetDate);
        dayAfter.setDate(targetDate.getDate() + 1);
        const dayAfterISO = toISO(dayAfter);

        candidates = allCandidates.filter(c => c.dateStr === dayAfterISO);
        if (candidates.length > 0) return { candidates, actualDate: dayAfterISO };

        // Try day before
        const dayBefore = new Date(targetDate);
        dayBefore.setDate(targetDate.getDate() - 1);
        const dayBeforeISO = toISO(dayBefore);

        candidates = allCandidates.filter(c => c.dateStr === dayBeforeISO);
        if (candidates.length > 0) return { candidates, actualDate: dayBeforeISO };

        return { candidates: [], actualDate: targetDateISO };
    }

    // Helper to add days to a date string
    function addDaysToDateStr(dateStr, days) {
        const date = new Date(dateStr + 'T12:00:00');
        date.setDate(date.getDate() + days);
        return toISO(date);
    }

    // Helper to filter candidates by priority
    // Logic: HIGH = first available day (not today)
    //        MED = HIGH + 2 days (with ±1 day fallback)
    //        LOW = HIGH + 4 days (with ±1 day fallback)
    function filterCandidatesByPriority(allCandidates, priority, city) {
        const today = startOfDay(new Date());
        const todayISO = toISO(today);
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        const tomorrowISO = toISO(tomorrow);

        // Check if we should skip navigation to prevent loops
        const justNavigated = state.lastNavDirection !== null;

        // Get calendar date range
        const calendarDates = state.weekDays || [];
        const firstCalDate = calendarDates[0];
        const lastCalDate = calendarDates[calendarDates.length - 1];

        // If no candidates at all, recommend scanning next week
        if (allCandidates.length === 0) {
            if (justNavigated) {
                addLog(`No candidates after ${state.lastNavDirection} navigation - stopping to prevent loop`);
                return { candidates: [], targetDate: tomorrowISO, needsWeekChange: null, baselineDate: todayISO };
            }
            return { candidates: [], targetDate: tomorrowISO, needsWeekChange: 'next', baselineDate: todayISO };
        }

        // Step 1: Find HIGH (first available date from tomorrow onwards)
        const highDateISO = findFirstAvailableDate(allCandidates);

        if (!highDateISO) {
            // No availability from tomorrow onwards on this calendar
            if (justNavigated) {
                addLog(`No HIGH priority candidates after ${state.lastNavDirection} navigation - stopping to prevent loop`);
                return { candidates: [], targetDate: tomorrowISO, needsWeekChange: null, baselineDate: todayISO };
            }
            return { candidates: [], targetDate: tomorrowISO, needsWeekChange: 'next', baselineDate: todayISO };
        }

        addLog(`First available date (HIGH): ${highDateISO}`);

        // Step 2: Calculate MED and LOW based on HIGH
        const medDateISO = addDaysToDateStr(highDateISO, 2);  // HIGH + 2 days
        const lowDateISO = addDaysToDateStr(highDateISO, 4);  // HIGH + 4 days

        addLog(`Priority dates - HIGH: ${highDateISO}, MED: ${medDateISO}, LOW: ${lowDateISO}`);

        // Step 3: Get target date based on selected priority
        let targetDateISO;
        if (priority === 'high') {
            targetDateISO = highDateISO;
        } else if (priority === 'med') {
            targetDateISO = medDateISO;
        } else {
            targetDateISO = lowDateISO;
        }

        // Step 4: Check if target date is on current calendar
        if (targetDateISO < firstCalDate) {
            if (justNavigated) {
                addLog(`Target date ${targetDateISO} before calendar after navigation - stopping`);
                return { candidates: [], targetDate: targetDateISO, needsWeekChange: null, baselineDate: todayISO };
            }
            return { candidates: [], targetDate: targetDateISO, needsWeekChange: 'prev', baselineDate: todayISO };
        }

        if (targetDateISO > lastCalDate) {
            if (justNavigated) {
                addLog(`Target date ${targetDateISO} after calendar after navigation - stopping`);
                return { candidates: [], targetDate: targetDateISO, needsWeekChange: null, baselineDate: todayISO };
            }
            return { candidates: [], targetDate: targetDateISO, needsWeekChange: 'next', baselineDate: todayISO };
        }

        // Step 5: Find candidates for the target date (with ±1 fallback for MED/LOW)
        const allowFallback = (priority !== 'high'); // HIGH is exact, MED/LOW can fallback
        const result = findCandidatesForDate(allCandidates, targetDateISO, allowFallback);

        if (result.candidates.length === 0) {
            // No candidates found even with fallback
            addLog(`No candidates for ${priority} priority on ${targetDateISO} (or adjacent days)`);
            return { candidates: [], targetDate: targetDateISO, needsWeekChange: null, baselineDate: todayISO };
        }

        // Sort candidates: prioritize stacking, then by remaining capacity
        result.candidates.sort((a, b) => {
            // Prioritize stacking
            if (a.stackSize > 0 && b.stackSize === 0) return -1;
            if (b.stackSize > 0 && a.stackSize === 0) return 1;
            // Then by remaining capacity
            return (b.remaining || 0) - (a.remaining || 0);
        });

        return { candidates: result.candidates, targetDate: result.actualDate, needsWeekChange: null, baselineDate: todayISO };
    }

    // Run recommendation directly with selected priority
    async function runMainRecommendation() {
        const text = addrInput?.value?.trim();
        if (!text) {
            showToast("Enter an address or city");
            return;
        }

        const cityList = CONFIG.resolveCityCandidatesFromInput(text);
        if (!cityList.length) {
            showToast("City not found");
            return;
        }

        const primaryCity = cityList[0];
        const region = CONFIG.getRegionForCity(primaryCity);
        if (region) state.currentRegion = region;
        state.highlightedCity = primaryCity;
        state.addressInput = text; // Save address to state so it persists

        // Check if this is a follow-up after week navigation
        const isFollowUpAfterNavigation = state.pendingWeekNav !== null;

        // If this is a fresh user-initiated search (not after week navigation), clear the nav tracking
        // This prevents the loop detection from triggering on fresh searches
        if (!isFollowUpAfterNavigation) {
            state.lastNavDirection = null;
            state.weekNavCount = 0; // Reset navigation count for fresh searches
        }

        // Clear pendingWeekNav now that we've checked it
        if (state.pendingWeekNav) {
            state.pendingWeekNav = null;
        }

        // Hard limit: prevent more than 2 week navigations per search
        const MAX_WEEK_NAVS = 2;
        if (state.weekNavCount >= MAX_WEEK_NAVS) {
            addLog(`Max week navigations (${MAX_WEEK_NAVS}) reached - stopping to prevent loop`);
            state.weekNavCount = 0;
            state.lastNavDirection = null;
            showToast("No slots found in nearby weeks");
            return;
        }

        // Save to recent addresses for quick access
        saveRecentAddress(text);

        await sendFindCommand({ type: 'CLEAR_HIGHLIGHT' });
        await sendFindCommand({ type: 'HIGHLIGHT_CITY', city: primaryCity });

        const allCandidates = findBestSlotStacking(
            primaryCity, state.weekDays, state.allEvents, state.availability, state.currentRegion
        );

        // Update earliest available date tracking for this city
        const cityKey = primaryCity.toUpperCase();
        const tomorrow = new Date(startOfDay(new Date()));
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowISO = toISO(tomorrow);

        // Find earliest candidate from tomorrow onwards on current calendar
        const validCandidates = allCandidates.filter(c => c.dateStr >= tomorrowISO);
        if (validCandidates.length > 0) {
            const earliestOnThisWeek = validCandidates.reduce((min, c) =>
                c.dateStr < min ? c.dateStr : min, validCandidates[0].dateStr);

            // Only update if this is earlier than what we have stored (or nothing stored)
            const currentEarliest = state.earliestAvailableByCity[cityKey];
            if (!currentEarliest || earliestOnThisWeek < currentEarliest) {
                state.earliestAvailableByCity[cityKey] = earliestOnThisWeek;
            }
        }

        // Filter candidates based on priority (today-relative with stack flexibility)
        const result = filterCandidatesByPriority(allCandidates, mainPriority, primaryCity);

        // Handle week navigation needed
        if (result.needsWeekChange) {
            state.recoCandidates = [];
            state.recoIndex = 0;
            state.pendingWeekNav = result.needsWeekChange; // Store for UI indicator
            state.lastNavDirection = result.needsWeekChange; // Track navigation to prevent loops
            state.weekNavCount = (state.weekNavCount || 0) + 1; // Increment navigation count
            addLog(`Week navigation #${state.weekNavCount}: ${result.needsWeekChange}`);
            debouncedSaveState();
            renderUIFromState();

            // Format target date for display
            const targetDate = new Date(result.targetDate + 'T12:00:00');
            const dayName = targetDate.toLocaleDateString('en-US', { weekday: 'short' });
            const monthDay = targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

            const direction = result.needsWeekChange === 'next' ? 'next' : 'previous';
            showToast(`Target: ${dayName} ${monthDay} - Navigating to ${direction} week...`);

            // Automatically click the week navigation button
            await sendFindCommand({
                type: 'CLICK_WEEK_NAV',
                direction: result.needsWeekChange
            });

            // Wait for page to update then trigger a scan
            // The scan completion will detect pendingWeekNav and re-run the recommendation
            setTimeout(() => {
                addLog("Scanning new week after navigation...");
                runScanFlow(true); // Auto-scan the new week
            }, 1500);

            return;
        }

        if (result.candidates.length === 0) {
            // Clear the nav direction since we're done (no candidates found after any navigation)
            state.lastNavDirection = null;
            state.weekNavCount = 0;
            showToast("No slots available for " + primaryCity);
            return;
        }

        state.recoCandidates = result.candidates;
        state.recoIndex = 0;
        state.pendingWeekNav = null; // Clear any pending nav
        state.lastNavDirection = null; // Clear navigation tracking since we found candidates
        state.weekNavCount = 0; // Reset navigation count on success

        debouncedSaveState();
        renderUIFromState();

        // Show helpful message about the recommendation
        const firstReco = result.candidates[0];
        const recoDate = new Date(firstReco.dateStr + 'T12:00:00');
        const dayName = recoDate.toLocaleDateString('en-US', { weekday: 'short' });
        const monthDay = recoDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const hasStack = firstReco.stackSize > 0;
        const stackMsg = hasStack ? ' 📍' : '';
        showToast(`${dayName} ${monthDay}: ${result.candidates.length} slot(s)${stackMsg}`);

        // Expand and scroll to the recommended day
        if (firstReco) {
            const card = document.querySelector(`.day-card[data-date="${firstReco.dateStr}"]`);
            if (card) {
                setCardCollapsed(card, false);
                highlightSuggested(card, firstReco.blockKey, firstReco.reason);
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }

    // Update Go button state - always shows "Go" now (clear is separate × button)
    function updateGoButtonState() {
        if (!addrGoBtn) return;
        // Go button always stays as "Go"
        addrGoBtn.textContent = 'Go';
        addrGoBtn.classList.remove('secondary');
    }

    // Clear address and highlights
    async function clearAddressAndHighlights() {
        state.addressInput = "";
        state.highlightedCity = null;
        state.recoCandidates = [];
        state.recoIndex = 0;
        state.earliestAvailableByCity = {}; // Clear stored earliest dates when clearing address
        if (addrInput) addrInput.value = "";
        updateAddressClearButton();
        updateGoButtonState();
        await sendFindCommand({ type: 'CLEAR_HIGHLIGHT' });
        debouncedSaveState();
        renderUIFromState();
    }

    if (addrGoBtn) {
        addrGoBtn.addEventListener("click", async () => {
            const inputValue = addrInput?.value?.trim();
            if (!inputValue) return;

            // Check if input is a phone number
            const phoneDigits = detectPhoneNumber(inputValue);
            if (phoneDigits) {
                // It's a phone number - open contacts page like an incoming call
                const formattedPhone = formatPhoneForDisplay(phoneDigits);
                showToast(`Searching for ${formattedPhone}...`);

                try {
                    await chrome.runtime.sendMessage({
                        type: 'OPEN_CONTACTS_FOR_PHONE',
                        phoneNumber: phoneDigits,
                        formattedPhone: formattedPhone,
                        callerName: '', // No caller name for manual search
                        windowId: window.__targetWindowId // Pass target window for window isolation
                    });
                    addLog(`Opened contacts search for phone: ${formattedPhone}`);
                } catch (err) {
                    console.error('[Popup] Error opening contacts for phone:', err);
                    showToast('Error opening contacts');
                }
                return; // Don't continue with address flow
            }

            // Not a phone number - treat as address
            const hasAddress = inputValue;
            if (hasAddress) {
                // Go mode - always run recommendation
                await runMainRecommendation();
                updateGoButtonState();

                // Get the verified address from the input
                const verifiedAddress = addrInput?.value?.trim();

                // Only open Google Earth and Gemini for full addresses (must contain a street number)
                // City names like "Mesa" won't have a number, but "1310 N Lesueur, Mesa, AZ" will
                const isFullAddress = verifiedAddress && /\d/.test(verifiedAddress);

                if (verifiedAddress && isFullAddress) {
                    try {
                        // Track which tabs are created based on settings
                        let earthTab = null;
                        let geminiTab = null;
                        let jobsTab = null;

                        // Find or create Google Earth tab in target window (reuse existing if found)
                        if (settings.search_google_earth !== false) {
                        const googleEarthUrl = `https://earth.google.com/web/search/${encodeURIComponent(verifiedAddress)}`;
                        const earthQueryOpts = { url: "*://earth.google.com/*" };
                        if (window.__targetWindowId) earthQueryOpts.windowId = window.__targetWindowId;
                        const existingEarthTabs = await chrome.tabs.query(earthQueryOpts);

                        if (existingEarthTabs.length > 0) {
                            // Reuse existing Google Earth tab - update its URL
                            earthTab = existingEarthTabs[0];
                            await chrome.tabs.update(earthTab.id, { url: googleEarthUrl });
                            addLog(`Reusing existing Google Earth tab (ID: ${earthTab.id})`);
                        } else {
                            // Create new Google Earth tab in target window
                            const earthCreateOpts = { url: googleEarthUrl, active: false };
                            if (window.__targetWindowId) earthCreateOpts.windowId = window.__targetWindowId;
                            earthTab = await chrome.tabs.create(earthCreateOpts);
                            addLog(`Created new Google Earth tab (ID: ${earthTab.id})`);
                        }

                        // Google Earth uses canvas-based UI, so we need to send a message to trigger search
                        // after the page loads. The URL contains the address but we also send a message
                        // to interact with the search UI for more reliable navigation.
                        // Google Earth is a Flutter WebGL app - URL-based search is the only reliable method.
                        // The address in the URL path (earth.google.com/web/search/ADDRESS) triggers auto-navigation.
                        addLog('Google Earth loading (may take ~10s)...');

                        // Set up listener to confirm Google Earth loaded
                        const earthTabId = earthTab.id;
                        const addressToSearch = verifiedAddress;
                        chrome.tabs.onUpdated.addListener(function earthLoadListener(tabId, info) {
                            if (tabId === earthTabId && info.status === 'complete') {
                                chrome.tabs.onUpdated.removeListener(earthLoadListener);
                                // Wait for Google Earth Flutter app to fully initialize
                                setTimeout(async () => {
                                    try {
                                        await chrome.tabs.sendMessage(earthTabId, {
                                            type: 'SEARCH_GOOGLE_EARTH_ADDRESS',
                                            address: addressToSearch
                                        });
                                        addLog('Google Earth navigating to address');
                                    } catch (err) {
                                        // URL already contains search, Earth will auto-navigate
                                        addLog('Google Earth searching via URL');
                                        console.log('[Popup] Earth note:', err.message);
                                    }
                                }, 10000); // Wait 10 seconds for Google Earth to initialize
                            }
                        });
                        } // end search_google_earth check

                        // Find or create Gemini Gem tab in target window (reuse existing Arizona Roofers Note Assistant gem)
                        if (settings.search_gemini !== false) {
                        const geminiGemBaseUrl = 'https://gemini.google.com/gem/70a0cb5e71a1';
                        const geminiQueryOpts = { url: "*://gemini.google.com/gem/70a0cb5e71a1*" };
                        if (window.__targetWindowId) geminiQueryOpts.windowId = window.__targetWindowId;
                        const existingGeminiTabs = await chrome.tabs.query(geminiQueryOpts);
                        let needsPageLoad = false;

                        if (existingGeminiTabs.length > 0) {
                            // Reuse existing Arizona Roofers Note Assistant Gem tab
                            geminiTab = existingGeminiTabs[0];
                            addLog(`Reusing existing Gemini Gem tab (ID: ${geminiTab.id})`);
                        } else {
                            // Create new Gemini tab in target window with the base Gem URL (will start a new chat)
                            const geminiCreateOpts = { url: geminiGemBaseUrl, active: false };
                            if (window.__targetWindowId) geminiCreateOpts.windowId = window.__targetWindowId;
                            geminiTab = await chrome.tabs.create(geminiCreateOpts);
                            needsPageLoad = true;
                            addLog(`Created new Gemini Gem tab (ID: ${geminiTab.id})`);
                        }

                        // Function to paste address and send in Gemini
                        const pasteAddressAndSend = (tabId) => {
                            addLog(`Attempting to paste address to Gemini tab ${tabId}`);
                            chrome.scripting.executeScript({
                                target: { tabId: tabId },
                                func: (address) => {
                                    console.log('[Roofr Extension] Starting paste operation for:', address);
                                    // Try to find and fill the input field
                                    const findAndFillInput = () => {
                                        // Look for contenteditable div or textarea/input - Gemini specific selectors first
                                        const selectors = [
                                            'rich-textarea div[contenteditable="true"]',
                                            'div.ql-editor[contenteditable="true"]',
                                            'div[contenteditable="true"][aria-label*="prompt"]',
                                            'div[contenteditable="true"]',
                                            'textarea[aria-label*="prompt"]',
                                            'textarea',
                                            'input[type="text"]',
                                            '.ql-editor',
                                            '[data-placeholder]'
                                        ];

                                        for (const selector of selectors) {
                                            const el = document.querySelector(selector);
                                            if (el) {
                                                console.log('[Roofr Extension] Found input element:', selector);
                                                if (el.tagName === 'DIV') {
                                                    // For contenteditable, we need to set innerText and trigger proper events
                                                    el.focus();
                                                    el.innerText = address;
                                                    el.dispatchEvent(new Event('input', { bubbles: true }));
                                                    el.dispatchEvent(new Event('change', { bubbles: true }));
                                                } else {
                                                    el.focus();
                                                    el.value = address;
                                                    el.dispatchEvent(new Event('input', { bubbles: true }));
                                                    el.dispatchEvent(new Event('change', { bubbles: true }));
                                                }
                                                return true;
                                            }
                                        }
                                        console.log('[Roofr Extension] No input element found');
                                        return false;
                                    };

                                    // Function to click the send button
                                    const clickSendButton = () => {
                                        // Try various selectors for the send button
                                        const sendButtonSelectors = [
                                            'button[aria-label*="send" i]',
                                            'button[aria-label*="Send" i]',
                                            '.send-button',
                                            '.send-button-icon',
                                            'button[data-test-id="send-button"]',
                                            'mat-icon[fonticon="send"]',
                                            'button.send-button-container',
                                            'button.mdc-icon-button',
                                            'button[class*="send"]'
                                        ];

                                        for (const selector of sendButtonSelectors) {
                                            const btn = document.querySelector(selector);
                                            if (btn) {
                                                btn.click();
                                                return true;
                                            }
                                        }

                                        // Try to find button containing send icon by mat-icon
                                        const sendIcon = document.querySelector('mat-icon[fonticon="send"]');
                                        if (sendIcon) {
                                            const btn = sendIcon.closest('button');
                                            if (btn) {
                                                btn.click();
                                                return true;
                                            }
                                        }

                                        // Try clicking any button with send-related classes
                                        const allButtons = document.querySelectorAll('button');
                                        for (const btn of allButtons) {
                                            if (btn.className.includes('send') ||
                                                btn.querySelector('mat-icon[fonticon="send"]') ||
                                                btn.getAttribute('aria-label')?.toLowerCase().includes('send')) {
                                                btn.click();
                                                return true;
                                            }
                                        }

                                        return false;
                                    };

                                    // Try immediately and then retry after delays
                                    const fillAndSend = () => {
                                        if (findAndFillInput()) {
                                            // Wait a bit for the input to register, then click send
                                            setTimeout(() => {
                                                if (!clickSendButton()) {
                                                    // Retry clicking send
                                                    setTimeout(clickSendButton, 500);
                                                }
                                            }, 500);
                                            return true;
                                        }
                                        return false;
                                    };

                                    if (!fillAndSend()) {
                                        setTimeout(() => {
                                            if (!fillAndSend()) {
                                                setTimeout(fillAndSend, 2000);
                                            }
                                        }, 1000);
                                    }
                                },
                                args: [verifiedAddress]
                            }).then(result => {
                                addLog(`Gemini paste script executed successfully`);
                            }).catch(err => {
                                addLog(`Error pasting to Gemini: ${err.message}`, 'ERROR');
                                console.error('Could not auto-paste address to Gemini:', err);
                            });
                        };

                        if (needsPageLoad) {
                            // Wait for new Gemini tab to load
                            chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                                if (tabId === geminiTab.id && info.status === 'complete') {
                                    chrome.tabs.onUpdated.removeListener(listener);
                                    addLog(`Gemini tab loaded, waiting 2s before paste...`);
                                    setTimeout(() => pasteAddressAndSend(geminiTab.id), 2000);
                                }
                            });
                        } else {
                            // Existing tab - paste with a longer delay to ensure page is ready
                            addLog(`Using existing Gemini tab, waiting 1s before paste...`);
                            setTimeout(() => pasteAddressAndSend(geminiTab.id), 1000);
                        }
                        } // end search_gemini check

                        // Get the current window ID (where the extension popup/sidepanel is running)
                        const currentWindow = await chrome.windows.getCurrent();
                        const currentWindowId = currentWindow.id;
                        addLog(`Current window ID: ${currentWindowId}`);

                        // Roofr job search
                        if (settings.search_roofr !== false) {
                        // Extract street address for search (e.g., "1310 N Lesueur" from "1310 N Lesueur, Mesa, Az, 85203")
                        const streetAddress = verifiedAddress.split(',')[0].trim();
                        // Expand abbreviations for search: N -> North, S -> South, E -> East, W -> West
                        const expandedStreetAddress = streetAddress
                            .replace(/\bN\.?\s+/gi, 'North ')
                            .replace(/\bS\.?\s+/gi, 'South ')
                            .replace(/\bE\.?\s+/gi, 'East ')
                            .replace(/\bW\.?\s+/gi, 'West ')
                            .replace(/\bNE\.?\s+/gi, 'Northeast ')
                            .replace(/\bNW\.?\s+/gi, 'Northwest ')
                            .replace(/\bSE\.?\s+/gi, 'Southeast ')
                            .replace(/\bSW\.?\s+/gi, 'Southwest ');

                        // Build search URL - search for the address first before creating a new job
                        const roofrSearchUrl = `https://app.roofr.com/dashboard/team/239329/jobs/list-view?page=1&filter%5Bq%5D=${encodeURIComponent(expandedStreetAddress)}`;
                        const roofrJobsUrl = 'https://app.roofr.com/dashboard/team/239329/jobs';
                        addLog(`Searching Roofr for: ${expandedStreetAddress}`);

                        let jobsNeedsPageLoad = false;

                        // Always create a new tab for the search
                        jobsTab = await chrome.tabs.create({ url: roofrSearchUrl, active: false, windowId: currentWindowId });
                        jobsNeedsPageLoad = true;
                        addLog(`Created Roofr search tab (ID: ${jobsTab.id})`);

                        // Store the original address for job creation fallback
                        const originalAddress = verifiedAddress;

                        // Function to check search results and either click the first result or create new job
                        const handleSearchResults = (tabId, address, jobsUrl) => {
                            addLog(`Checking search results on tab ${tabId}`);
                            chrome.scripting.executeScript({
                                target: { tabId: tabId },
                                func: (address, jobsUrl) => {
                                    console.log('[Roofr Extension] Checking search results for:', address);

                                    // Function to count job rows in the list view
                                    const countJobRows = () => {
                                        // Primary: Look for table rows in list view
                                        const tableRows = document.querySelectorAll('table tbody tr');
                                        if (tableRows.length > 0) {
                                            console.log('[Roofr Extension] Found', tableRows.length, 'table rows');
                                            return tableRows.length;
                                        }

                                        // Alternative: Look for job card links
                                        const jobLinks = document.querySelectorAll('a[href*="/jobs/details/"]');
                                        if (jobLinks.length > 0) {
                                            console.log('[Roofr Extension] Found', jobLinks.length, 'job links');
                                            return jobLinks.length;
                                        }

                                        // Check for any rows with data-testid
                                        const testIdRows = document.querySelectorAll('[data-testid*="row"], [data-testid*="job"]');
                                        if (testIdRows.length > 0) {
                                            console.log('[Roofr Extension] Found', testIdRows.length, 'testid rows');
                                            return testIdRows.length;
                                        }

                                        return 0;
                                    };

                                    // Function to click the View button on the first job row
                                    const clickFirstJobRow = () => {
                                        // Priority 1: Find the "View" button in the first row
                                        const firstRow = document.querySelector('table tbody tr:first-child, [role="row"]:first-of-type');
                                        if (firstRow) {
                                            // Look for View button/link in the row
                                            const viewButton = firstRow.querySelector('button, a, [role="button"]');
                                            if (viewButton) {
                                                // Check if it contains "View" text
                                                const buttons = firstRow.querySelectorAll('button, a, [role="button"], .d-flex');
                                                for (const btn of buttons) {
                                                    const text = btn.textContent?.trim();
                                                    if (text === 'View' || text?.includes('View')) {
                                                        console.log('[Roofr Extension] Clicking View button:', text);
                                                        btn.click();
                                                        return true;
                                                    }
                                                }
                                            }

                                            // Look for any clickable element with "View" text in the row
                                            const allElements = firstRow.querySelectorAll('*');
                                            for (const el of allElements) {
                                                if (el.textContent?.trim() === 'View' && el.children.length === 0) {
                                                    console.log('[Roofr Extension] Clicking View element');
                                                    el.click();
                                                    return true;
                                                }
                                            }
                                        }

                                        // Priority 2: Find View button anywhere in the results
                                        const allViewButtons = document.querySelectorAll('button, a, [role="button"]');
                                        for (const btn of allViewButtons) {
                                            if (btn.textContent?.trim() === 'View') {
                                                console.log('[Roofr Extension] Clicking standalone View button');
                                                btn.click();
                                                return true;
                                            }
                                        }

                                        // Priority 3: Fall back to clicking job details link
                                        const selectors = [
                                            'table tbody tr:first-child a[href*="/jobs/details/"]',
                                            'a[href*="/jobs/details/"]:first-of-type'
                                        ];

                                        for (const selector of selectors) {
                                            const element = document.querySelector(selector);
                                            if (element) {
                                                console.log('[Roofr Extension] Clicking job link:', selector);
                                                element.click();
                                                return true;
                                            }
                                        }

                                        return false;
                                    };

                                    // Function to check for "no results" state
                                    const hasNoResults = () => {
                                        // Check for specific Roofr "no results" elements
                                        const noSearchResults = document.querySelector('.no-search-results, [class*="no-search-results"]');
                                        if (noSearchResults) {
                                            console.log('[Roofr Extension] Found no-search-results element');
                                            return true;
                                        }

                                        // Check for empty state indicators
                                        const emptySelectors = [
                                            '[class*="no-results"]',
                                            '[class*="empty-state"]',
                                            '[class*="no-data"]'
                                        ];

                                        for (const selector of emptySelectors) {
                                            const el = document.querySelector(selector);
                                            if (el && el.offsetParent !== null) {
                                                console.log('[Roofr Extension] Found empty state:', selector);
                                                return true;
                                            }
                                        }

                                        // Check for "No results matched your search" or similar text
                                        const pageText = document.body.innerText.toLowerCase();
                                        if (pageText.includes('no results matched') ||
                                            pageText.includes('0 results') ||
                                            pageText.includes('no jobs found') ||
                                            pageText.includes('no results found')) {
                                            console.log('[Roofr Extension] Found "no results" text');
                                            return true;
                                        }

                                        return false;
                                    };

                                    // Function to create new job (click New > Job > fill address)
                                    const createNewJobOnPage = () => {
                                        console.log('[Roofr Extension] Creating new job - clicking New button');

                                        // Step 1: Click the "New" button
                                        const newButton = document.querySelector('button.jobs-entry-board-do-it-all-button, button[class*="do-it-all-button"]');
                                        if (!newButton) {
                                            // Try finding by text
                                            const allButtons = document.querySelectorAll('button');
                                            for (const btn of allButtons) {
                                                if (btn.textContent?.includes('New')) {
                                                    btn.click();
                                                    console.log('[Roofr Extension] Clicked New button (by text)');
                                                    return true;
                                                }
                                            }
                                            console.log('[Roofr Extension] New button not found');
                                            return false;
                                        }
                                        newButton.click();
                                        console.log('[Roofr Extension] Clicked New button');
                                        return true;
                                    };

                                    // Step 2: Click Job option (called after New dropdown opens)
                                    const clickJobOption = () => {
                                        const jobButton = document.querySelector('button[data-testid="job-board-do-it-all-dropdown-item-job"]');
                                        if (jobButton) {
                                            jobButton.click();
                                            console.log('[Roofr Extension] Clicked Job option');
                                            return true;
                                        }
                                        // Fallback: find by text
                                        const buttons = document.querySelectorAll('button');
                                        for (const btn of buttons) {
                                            const text = btn.textContent?.trim();
                                            if (text?.startsWith('Job') && text?.includes('create a card')) {
                                                btn.click();
                                                console.log('[Roofr Extension] Clicked Job option (by text)');
                                                return true;
                                            }
                                        }
                                        return false;
                                    };

                                    // Step 3: Fill address in modal
                                    const fillAddressInModal = (addr) => {
                                        const addressInput = document.querySelector('input[id*="address-resolution-input"], input[placeholder="Enter address and select"]');
                                        if (addressInput) {
                                            addressInput.focus();
                                            addressInput.value = addr;
                                            addressInput.dispatchEvent(new Event('input', { bubbles: true }));
                                            addressInput.dispatchEvent(new Event('change', { bubbles: true }));
                                            console.log('[Roofr Extension] Filled address:', addr);
                                            return true;
                                        }
                                        return false;
                                    };

                                    // Check results with retries (page may still be loading)
                                    let attempts = 0;
                                    const maxAttempts = 20;

                                    const checkAndAct = () => {
                                        attempts++;
                                        console.log(`[Roofr Extension] Attempt ${attempts}/${maxAttempts} to check search results`);

                                        const jobCount = countJobRows();
                                        const noResults = hasNoResults();

                                        console.log(`[Roofr Extension] Found ${jobCount} job rows, noResults: ${noResults}`);

                                        if (jobCount >= 1) {
                                            // Found result(s) - click the first one and STOP
                                            console.log('[Roofr Extension] Found ' + jobCount + ' result(s) - clicking first one');
                                            if (clickFirstJobRow()) {
                                                return { action: 'clicked_result', count: jobCount };
                                            }
                                        }

                                        if (noResults || (attempts >= maxAttempts && jobCount === 0)) {
                                            // No results found - create new job directly on this page
                                            console.log('[Roofr Extension] No results found - creating new job');

                                            // Click New button
                                            if (createNewJobOnPage()) {
                                                // Wait for dropdown, then click Job
                                                setTimeout(() => {
                                                    if (clickJobOption()) {
                                                        // Wait for modal, then fill address
                                                        setTimeout(() => {
                                                            fillAddressInModal(address);
                                                        }, 1500);
                                                    }
                                                }, 1000);
                                            }
                                            return { action: 'no_results', createNew: true };
                                        }

                                        if (attempts < maxAttempts) {
                                            // Still loading, retry
                                            setTimeout(checkAndAct, 500);
                                            return null;
                                        }

                                        return { action: 'timeout' };
                                    };

                                    // Start checking after a brief delay for page to render
                                    setTimeout(checkAndAct, 2000);
                                },
                                args: [address, jobsUrl]
                            }).then((results) => {
                                if (results && results[0] && results[0].result) {
                                    const result = results[0].result;
                                    if (result.action === 'clicked_result') {
                                        addLog(`Found existing job (${result.count}) - opened it`);
                                        // STOP - job found and clicked, nothing more to do
                                    } else if (result.action === 'no_results') {
                                        addLog(`No existing job found - creating new (New > Job > Address)`);
                                        // Job creation handled directly in the injected script
                                    }
                                }
                            }).catch(err => {
                                addLog(`Error checking search results: ${err.message}`, 'ERROR');
                            });
                        };

                        // Function to click New button, then Job, then fill address (used as fallback)
                        const createNewJob = (tabId, address) => {
                            addLog(`Creating new job on Roofr Jobs tab ${tabId}`);
                            chrome.scripting.executeScript({
                                target: { tabId: tabId },
                                func: (address) => {
                                    console.log('[Roofr Extension] Starting job creation for:', address);

                                    // Step 1: Click the "New" button (with retry logic)
                                    const clickNewButton = () => {
                                        // Log all buttons on the page for debugging
                                        const allBtns = document.querySelectorAll('button');
                                        console.log('[Roofr Extension] Found', allBtns.length, 'buttons on page');
                                        allBtns.forEach((btn, i) => {
                                            if (btn.textContent.trim()) {
                                                console.log(`[Roofr Extension] Button ${i}: "${btn.textContent.trim().substring(0, 50)}" class="${btn.className}"`);
                                            }
                                        });

                                        // Look for the New button - try multiple selectors
                                        const newBtnSelectors = [
                                            'button.roofr-button.jobs-entry-board-do-it-all-button',
                                            'button[class*="jobs-entry-board-do-it-all-button"]',
                                            'button[class*="do-it-all"]',
                                            'button[class*="roofr-button"]'
                                        ];

                                        for (const selector of newBtnSelectors) {
                                            const buttons = document.querySelectorAll(selector);
                                            for (const btn of buttons) {
                                                if (btn.textContent.includes('New')) {
                                                    console.log('[Roofr Extension] Found New button via selector:', selector);
                                                    btn.click();
                                                    return true;
                                                }
                                            }
                                        }

                                        // Fallback: find any button with "New" text
                                        for (const btn of allBtns) {
                                            const text = btn.textContent.trim();
                                            if (text === 'New' || text.startsWith('New')) {
                                                console.log('[Roofr Extension] Found New button (fallback), text:', text);
                                                btn.click();
                                                return true;
                                            }
                                        }
                                        console.log('[Roofr Extension] New button not found');
                                        return false;
                                    };

                                    // Step 2: Click the "Job" option in the dropdown
                                    const clickJobOption = () => {
                                        // Primary: Use the exact data-testid selector from the DOM
                                        const jobBtn = document.querySelector('button[data-testid="job-board-do-it-all-dropdown-item-job"]');
                                        if (jobBtn) {
                                            console.log('[Roofr Extension] Found Job button via data-testid');
                                            jobBtn.click();
                                            return true;
                                        }

                                        // Secondary: Look for button with the specific class pattern
                                        const classSelectors = [
                                            'button.jobs-entry-board-do-it-all-list-item',
                                            'button[class*="do-it-all-list-item"]',
                                            'button[class*="dropdown-item-job"]'
                                        ];

                                        for (const selector of classSelectors) {
                                            const buttons = document.querySelectorAll(selector);
                                            for (const btn of buttons) {
                                                const text = btn.textContent?.trim();
                                                // The button has "Job This will create a card on the CRM board"
                                                if (text && text.startsWith('Job')) {
                                                    console.log('[Roofr Extension] Found Job button via class:', text.substring(0, 50));
                                                    btn.click();
                                                    return true;
                                                }
                                            }
                                        }

                                        // Tertiary: Look for any button with "create a card" text (unique to Job option)
                                        const allButtons = document.querySelectorAll('button');
                                        for (const btn of allButtons) {
                                            const text = btn.textContent?.trim();
                                            const rect = btn.getBoundingClientRect();
                                            if (text && rect.width > 0 && rect.height > 0 &&
                                                text.includes('create a card') && text.includes('CRM')) {
                                                console.log('[Roofr Extension] Found Job button (CRM text):', text.substring(0, 50));
                                                btn.click();
                                                return true;
                                            }
                                        }

                                        // Fallback: Look for visible button starting with "Job"
                                        for (const btn of allButtons) {
                                            const text = btn.textContent?.trim();
                                            const rect = btn.getBoundingClientRect();
                                            if (text && rect.width > 0 && rect.height > 0 &&
                                                text.startsWith('Job') && !text.includes('Jobs')) {
                                                console.log('[Roofr Extension] Found Job button (fallback):', text.substring(0, 50));
                                                btn.click();
                                                return true;
                                            }
                                        }

                                        // Debug: Log visible buttons with data-testid
                                        console.log('[Roofr Extension] Job option not found. Buttons with data-testid:');
                                        for (const btn of allButtons) {
                                            const testid = btn.getAttribute('data-testid');
                                            if (testid) {
                                                console.log(`  data-testid="${testid}"`);
                                            }
                                        }

                                        return false;
                                    };

                                    // Step 3: Fill the address input in the modal (NOT the search bar)
                                    const fillAddressInput = () => {
                                        // The modal input has specific attributes:
                                        // - placeholder="Enter address and select"
                                        // - role="combobox"
                                        // - class contains "autocomplete-input form-control w-100"
                                        // - It's inside an address-field form-group

                                        // Primary: Find input with exact placeholder from the modal
                                        const modalInput = document.querySelector('input[placeholder="Enter address and select"]');
                                        if (modalInput) {
                                            console.log('[Roofr Extension] Found modal address input via placeholder');
                                            modalInput.focus();
                                            modalInput.value = address;
                                            modalInput.dispatchEvent(new Event('input', { bubbles: true }));
                                            modalInput.dispatchEvent(new Event('change', { bubbles: true }));
                                            return true;
                                        }

                                        // Secondary: Find input inside address-field container
                                        const addressFieldInput = document.querySelector('.address-field input, .address-field-form-group input, [class*="address-field"] input');
                                        if (addressFieldInput) {
                                            console.log('[Roofr Extension] Found address field input');
                                            addressFieldInput.focus();
                                            addressFieldInput.value = address;
                                            addressFieldInput.dispatchEvent(new Event('input', { bubbles: true }));
                                            addressFieldInput.dispatchEvent(new Event('change', { bubbles: true }));
                                            return true;
                                        }

                                        // Tertiary: Find combobox input with Job address label nearby
                                        const comboboxInputs = document.querySelectorAll('input[role="combobox"]');
                                        for (const input of comboboxInputs) {
                                            // Check if it's the Job address input (has specific ID pattern)
                                            if (input.id && input.id.includes('address-resolution-input')) {
                                                console.log('[Roofr Extension] Found address input via combobox role');
                                                input.focus();
                                                input.value = address;
                                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                                input.dispatchEvent(new Event('change', { bubbles: true }));
                                                return true;
                                            }
                                        }

                                        // Fallback: Find any visible autocomplete input that's NOT in the search bar
                                        const autocompleteInputs = document.querySelectorAll('input.autocomplete-input');
                                        for (const input of autocompleteInputs) {
                                            // Skip the search bar (it's in the header/nav area)
                                            const isInSearchBar = input.closest('[class*="search"], [class*="Search"], nav, header');
                                            const isVisible = input.offsetParent !== null;
                                            const isInModal = input.closest('[class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"], [class*="drawer"], [class*="Drawer"]');

                                            if (isVisible && !isInSearchBar && isInModal) {
                                                console.log('[Roofr Extension] Found autocomplete input in modal');
                                                input.focus();
                                                input.value = address;
                                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                                input.dispatchEvent(new Event('change', { bubbles: true }));
                                                return true;
                                            }
                                        }

                                        // Last resort: Find input with w-100 class inside form-group
                                        const formInputs = document.querySelectorAll('.form-group input.w-100, .form-control.w-100');
                                        for (const input of formInputs) {
                                            const isVisible = input.offsetParent !== null;
                                            if (isVisible && input.placeholder && input.placeholder.toLowerCase().includes('address')) {
                                                console.log('[Roofr Extension] Found form input with address placeholder');
                                                input.focus();
                                                input.value = address;
                                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                                input.dispatchEvent(new Event('change', { bubbles: true }));
                                                return true;
                                            }
                                        }

                                        console.log('[Roofr Extension] Address input not found');
                                        return false;
                                    };

                                    // Check if dropdown is visible (Job option should be present)
                                    const isDropdownOpen = () => {
                                        // Look for the Job dropdown item by data-testid or by text
                                        const jobBtn = document.querySelector('button[data-testid="job-board-do-it-all-dropdown-item-job"]');
                                        if (jobBtn) return true;

                                        // Also check for any button with "create a card" text
                                        const allButtons = document.querySelectorAll('button');
                                        for (const btn of allButtons) {
                                            const text = btn.textContent?.trim();
                                            if (text && text.includes('create a card')) {
                                                return true;
                                            }
                                        }
                                        return false;
                                    };

                                    // Execute with retries for both New button and Job option
                                    let newAttempts = 0;
                                    const maxNewAttempts = 10;
                                    let newClickCount = 0; // Track how many times we've clicked New

                                    const tryClickJob = (jobAttempt = 1) => {
                                        const maxJobAttempts = 20;
                                        console.log(`[Roofr Extension] Attempt ${jobAttempt}/${maxJobAttempts} to find Job option`);

                                        if (clickJobOption()) {
                                            // Success - wait for modal then fill address with retries
                                            console.log('[Roofr Extension] Job option clicked, waiting for modal...');
                                            const tryFillAddress = (fillAttempt = 1) => {
                                                const maxFillAttempts = 10;
                                                console.log(`[Roofr Extension] Attempt ${fillAttempt}/${maxFillAttempts} to fill address`);
                                                if (fillAddressInput()) {
                                                    console.log('[Roofr Extension] Address filled successfully!');
                                                } else if (fillAttempt < maxFillAttempts) {
                                                    setTimeout(() => tryFillAddress(fillAttempt + 1), 500);
                                                } else {
                                                    console.log('[Roofr Extension] Failed to fill address after', maxFillAttempts, 'attempts');
                                                }
                                            };
                                            setTimeout(() => tryFillAddress(), 1000);
                                        } else if (jobAttempt < maxJobAttempts) {
                                            // Check if dropdown is open - if not, re-click New button
                                            if (jobAttempt % 5 === 0 && !isDropdownOpen() && newClickCount < 3) {
                                                console.log('[Roofr Extension] Dropdown not open, re-clicking New button...');
                                                newClickCount++;
                                                clickNewButton();
                                                setTimeout(() => tryClickJob(jobAttempt + 1), 1000);
                                            } else {
                                                // Normal retry with increasing delays
                                                const delay = 300 + (jobAttempt * 50);
                                                setTimeout(() => tryClickJob(jobAttempt + 1), delay);
                                            }
                                        } else {
                                            console.log('[Roofr Extension] Failed to find Job option after', maxJobAttempts, 'attempts');
                                        }
                                    };

                                    const tryClickNew = () => {
                                        newAttempts++;
                                        console.log(`[Roofr Extension] Attempt ${newAttempts}/${maxNewAttempts} to find New button`);

                                        if (clickNewButton()) {
                                            newClickCount++;
                                            // Success - wait longer for dropdown to render, then try Job with retries
                                            console.log('[Roofr Extension] New button clicked, waiting for dropdown...');
                                            // Wait 2 seconds for dropdown animation
                                            setTimeout(() => tryClickJob(), 2000);
                                        } else if (newAttempts < maxNewAttempts) {
                                            // Retry after delay
                                            setTimeout(tryClickNew, 500);
                                        } else {
                                            console.log('[Roofr Extension] Failed to find New button after', maxNewAttempts, 'attempts');
                                        }
                                    };

                                    tryClickNew();
                                },
                                args: [address]
                            }).then(() => {
                                addLog('Roofr job creation script executed');
                            }).catch(err => {
                                addLog(`Error creating Roofr job: ${err.message}`, 'ERROR');
                            });
                        };

                        if (jobsNeedsPageLoad) {
                            // Wait for search results page to load
                            chrome.tabs.onUpdated.addListener(function jobsListener(tabId, info) {
                                if (tabId === jobsTab.id && info.status === 'complete') {
                                    chrome.tabs.onUpdated.removeListener(jobsListener);
                                    // Wait for React to render the search results
                                    addLog(`Roofr search page loaded, checking for results...`);
                                    setTimeout(() => handleSearchResults(jobsTab.id, originalAddress, roofrJobsUrl), 3000);
                                }
                            });
                        } else {
                            // Existing tab - run script with a delay
                            addLog(`Checking existing search results...`);
                            setTimeout(() => handleSearchResults(jobsTab.id, originalAddress, roofrJobsUrl), 2000);
                        }
                        } // end search_roofr check

                        // Group all tabs together, reorder, and move to the far left (only if multiple tabs are open)
                        const tabIdsInOrder = [
                            jobsTab?.id,
                            earthTab?.id,
                            geminiTab?.id
                        ].filter(id => id);

                        if (tabIdsInOrder.length > 0) {
                        try {
                            // Create a short address label for the group (e.g., "1310 N Lesueur, Mesa")
                            const addressParts = verifiedAddress.split(',');
                            const shortAddress = addressParts.length >= 2
                                ? `${addressParts[0].trim()}, ${addressParts[1].trim()}`
                                : verifiedAddress.substring(0, 40);

                            // Only group if we have multiple tabs
                            if (tabIdsInOrder.length > 1) {
                                // Check if any of these tabs are already in a group
                                let existingGroupId = null;
                                for (const tabId of tabIdsInOrder) {
                                    const tab = await chrome.tabs.get(tabId);
                                    if (tab.groupId && tab.groupId !== -1) {
                                        existingGroupId = tab.groupId;
                                        break;
                                    }
                                }

                                let groupId;
                                if (existingGroupId) {
                                    // Add all tabs to existing group
                                    await chrome.tabs.group({ tabIds: tabIdsInOrder, groupId: existingGroupId });
                                    groupId = existingGroupId;
                                } else {
                                    // Create new group with all tabs
                                    groupId = await chrome.tabs.group({ tabIds: tabIdsInOrder });
                                }

                                // Update group title to the address (renamed each submission)
                                await chrome.tabGroups.update(groupId, {
                                    title: shortAddress,
                                    color: 'blue',
                                    collapsed: false
                                });
                                addLog(`Tab group: "${shortAddress}"`);

                                // Move the group to the far left (index 0)
                                await chrome.tabGroups.move(groupId, { index: 0 });

                                // Reorder tabs within the group
                                for (let i = 0; i < tabIdsInOrder.length; i++) {
                                    await chrome.tabs.move(tabIdsInOrder[i], { index: i });
                                }
                            }

                            // Make Google Earth the active tab if it exists, otherwise use first available tab
                            if (earthTab && earthTab.id) {
                                await chrome.tabs.update(earthTab.id, { active: true });
                                addLog(`Google Earth tab is now active`);
                            } else if (tabIdsInOrder.length > 0) {
                                await chrome.tabs.update(tabIdsInOrder[0], { active: true });
                            }

                        } catch (groupErr) {
                            addLog(`Note: Could not group tabs: ${groupErr.message}`);
                            console.log('Tab grouping error (non-critical):', groupErr);
                        }
                        }

                        // Log which tabs were opened
                        const openedTabs = [];
                        if (earthTab) openedTabs.push('Google Earth');
                        if (geminiTab) openedTabs.push('Gemini');
                        if (jobsTab) openedTabs.push('Roofr Jobs');
                        if (openedTabs.length > 0) {
                            addLog(`Opened ${openedTabs.join(', ')} for: ${verifiedAddress}`);
                        }
                    } catch (err) {
                        addLog(`Error opening tabs: ${err.message}`, 'ERROR');
                        console.error('Error opening Google Earth/Gemini tabs:', err);
                    }
                }
            } else {
                // No address - just run recommendation
                await runMainRecommendation();
                updateGoButtonState();
            }
        });
    }

    if (addrInput) {
        // Show recent addresses when focusing on empty input
        addrInput.addEventListener("focus", () => {
            if (!addrInput.value?.trim()) {
                showRecentAddresses();
            }
        });

        // Also show on click when empty (in case already focused)
        addrInput.addEventListener("click", () => {
            if (!addrInput.value?.trim()) {
                showRecentAddresses();
            }
        });

        // Update button state when input changes
        addrInput.addEventListener("input", (e) => {
            const value = e.target.value.trim();
            updateAddressClearButton();
            updateGoButtonState();

            // Fetch address suggestions from API as user types
            if (value.length >= 3) {
                debouncedFetchAddressSuggestions(value);
            }

            // If input is cleared, reset button to "Go"
            if (!value) {
                if (addrGoBtn) {
                    addrGoBtn.textContent = 'Go';
                    addrGoBtn.classList.remove('secondary');
                }
                // Reset datalist to just cities
                if (verifiedAddressesList) {
                    verifiedAddressesList.innerHTML = '';
                    populateVerifiedAddresses();
                }
            } else {
                // Hide recent addresses when typing
                // (API suggestions will replace them)
            }
        });

        addrInput.addEventListener("keydown", async (e) => {
            if (e.key === "Enter") {
                const inputValue = addrInput?.value?.trim();
                if (!inputValue) return;

                // Check if input is a phone number
                const phoneDigits = detectPhoneNumber(inputValue);
                if (phoneDigits) {
                    // It's a phone number - open contacts page
                    const formattedPhone = formatPhoneForDisplay(phoneDigits);
                    showToast(`Searching for ${formattedPhone}...`);
                    try {
                        await chrome.runtime.sendMessage({
                            type: 'OPEN_CONTACTS_FOR_PHONE',
                            phoneNumber: phoneDigits,
                            formattedPhone: formattedPhone,
                            callerName: ''
                        });
                    } catch (err) {
                        console.error('[Popup] Error opening contacts for phone:', err);
                        showToast('Error opening contacts');
                    }
                } else {
                    // It's an address - run recommendation
                    await runMainRecommendation();
                    updateGoButtonState();
                }
            }
        });
    }

    if (addrClearBtn) {
        addrClearBtn.addEventListener("click", clearAddressAndHighlights);
    }

    /* ========= People Tab ========= */
    function renderPeopleList(container, names) {
        if (!container) return;
        container.innerHTML = "";

        const group = container.closest('.people-group');
        const isRepsContainer = container.id === 'repsList';
        const hasAvailabilityData = isRepsContainer && Object.keys(repAvailabilityStatus).length > 0;

        if (group) {
            const header = group.querySelector('.people-header');

            // Remove existing buttons and nav elements to allow re-rendering
            const existingElements = header.querySelectorAll('.highlight-all-btn');
            existingElements.forEach(el => el.remove());
            const existingNavRow = group.querySelector('.date-nav-row');
            if (existingNavRow) existingNavRow.remove();
            const existingHintLine = group.querySelector('.hint-line');
            if (existingHintLine) existingHintLine.remove();

            if (header) {
                // Create Highlight All button (consistent across all groups)
                const highlightBtn = document.createElement('button');
                highlightBtn.className = 'highlight-all-btn btn ghost';
                highlightBtn.style.fontSize = '10px';
                highlightBtn.style.padding = '2px 6px';
                highlightBtn.textContent = "Highlight All";

                // Left-click: highlight all names in the calendar
                highlightBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const escapedNames = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                    const term = `(${escapedNames.join('|')})`;

                    findInput.value = `[Group: ${names.length}]`;
                    updateFindClearButton();

                    const res = await sendFindCommand({
                        type: "SIDEFIND_UPDATE",
                        term: term,
                        flags: { caseSensitive: false, wholeWord: true, useRegex: true }
                    });
                    if (res?.stats) { findStats = res.stats; updateFindCounter(); }
                });

                // Right-click: select all checkboxes
                highlightBtn.addEventListener('contextmenu', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    let toggledCount = 0;
                    for (const name of names) {
                        const res = await sendFindCommand({ type: "TOGGLE_TEAM_CHECKBOX", name: name });
                        if (res?.toggled) toggledCount++;
                    }
                    showToast(`Toggled ${toggledCount} checkboxes`);
                });

                highlightBtn.title = "Click: highlight all | Right-click: toggle all checkboxes";

                // Insert button before drag handle
                const dragHandle = header.querySelector('.drag-handle');
                if (dragHandle) header.insertBefore(highlightBtn, dragHandle);
                else header.appendChild(highlightBtn);

                // Add date navigation row for Sales Reps only
                if (hasAvailabilityData) {
                    if (!selectedDate) initializeSelectedDate();

                    const dayOfWeek = selectedDate.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
                    const monthDay = selectedDate.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
                    const displayDate = `${dayOfWeek}, ${monthDay}`;
                    const availableReps = names.filter(name => repAvailabilityStatus[name] === true);
                    const availableCount = availableReps.length;

                    // Add hint line
                    const hintLine = document.createElement('div');
                    hintLine.className = 'hint-line';
                    hintLine.style.cssText = 'font-size: 9px; color: var(--textSecondary); margin-bottom: 4px; text-align: center;';
                    hintLine.textContent = 'Left-click to highlight • Right-click to select';
                    header.insertAdjacentElement('afterend', hintLine);

                    // Create date navigation row (separate from header)
                    const dateNavRow = document.createElement('div');
                    dateNavRow.className = 'date-nav-row';
                    dateNavRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; padding: 6px 10px; background: var(--surface); border-radius: 6px; border: 1px solid var(--border);';

                    // Left side: date navigation
                    const navGroup = document.createElement('div');
                    navGroup.style.cssText = 'display: flex; align-items: center; gap: 8px;';

                    const leftBtn = document.createElement('button');
                    leftBtn.className = 'btn ghost';
                    leftBtn.innerHTML = '◀';
                    leftBtn.style.cssText = 'font-size: 10px; padding: 4px 8px; min-width: auto; line-height: 1;';
                    leftBtn.title = 'Previous day';

                    const dateDisplay = document.createElement('span');
                    dateDisplay.style.cssText = 'font-size: 12px; font-weight: 600; min-width: 85px; text-align: center; color: var(--textPrimary);';
                    dateDisplay.textContent = displayDate;

                    const rightBtn = document.createElement('button');
                    rightBtn.className = 'btn ghost';
                    rightBtn.innerHTML = '▶';
                    rightBtn.style.cssText = 'font-size: 10px; padding: 4px 8px; min-width: auto; line-height: 1;';
                    rightBtn.title = 'Next day';

                    navGroup.appendChild(leftBtn);
                    navGroup.appendChild(dateDisplay);
                    navGroup.appendChild(rightBtn);

                    // Right side: Highlight Available button with count
                    const availBtn = document.createElement('button');
                    availBtn.className = 'btn ghost';
                    availBtn.style.cssText = 'font-size: 10px; padding: 2px 8px;';
                    availBtn.innerHTML = `<strong style="color: var(--success)">${availableCount}</strong>&nbsp;Available`;
                    availBtn.title = "Click: highlight available | Right-click: select available checkboxes";

                    // Left-click: highlight available reps
                    availBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        if (availableCount === 0) {
                            showToast('No available reps for selected date');
                            return;
                        }

                        const escapedNames = availableReps.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                        const term = `(${escapedNames.join('|')})`;

                        findInput.value = `[Available ${displayDate}: ${availableCount}]`;
                        updateFindClearButton();

                        const res = await sendFindCommand({
                            type: "SIDEFIND_UPDATE",
                            term: term,
                            flags: { caseSensitive: false, wholeWord: true, useRegex: true }
                        });
                        if (res?.stats) { findStats = res.stats; updateFindCounter(); }
                    });

                    // Right-click: toggle checkboxes for available reps only
                    availBtn.addEventListener('contextmenu', async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (availableCount === 0) {
                            showToast('No available reps for selected date');
                            return;
                        }

                        let toggledCount = 0;
                        for (const name of availableReps) {
                            const res = await sendFindCommand({ type: "TOGGLE_TEAM_CHECKBOX", name: name });
                            if (res?.toggled) toggledCount++;
                        }
                        showToast(`Toggled ${toggledCount} available rep checkboxes`);
                    });

                    dateNavRow.appendChild(navGroup);
                    dateNavRow.appendChild(availBtn);

                    // Insert after hint line
                    hintLine.insertAdjacentElement('afterend', dateNavRow);

                    // Date navigation event listeners
                    async function updateDateAndRefresh(daysToAdd) {
                        const newDate = new Date(selectedDate);
                        newDate.setDate(newDate.getDate() + daysToAdd);
                        selectedDate = newDate;
                        repAvailabilityStatus = await fetchTomorrowRepAvailability(selectedDate);
                        renderPeopleList(container, names);
                    }

                    leftBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await updateDateAndRefresh(-1);
                    });

                    rightBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await updateDateAndRefresh(1);
                    });
                }
            }
        }

        // Separate working and off reps (only for Sales Reps list)
        const workingNames = [];
        const offNames = [];

        if (hasAvailabilityData) {
            for (const name of names) {
                if (repAvailabilityStatus[name] === true) {
                    workingNames.push(name);
                } else {
                    offNames.push(name);
                }
            }
        }

        // Render the names
        const namesToRender = hasAvailabilityData
            ? [...workingNames, ...offNames]
            : names;

        for (const name of namesToRender) {
            const btn = document.createElement("div");
            btn.className = "name-tag";
            btn.textContent = name;

            // Apply desaturated styling for off reps
            if (isRepsContainer && repAvailabilityStatus[name] === false) {
                btn.classList.add('rep-off');
            }

            // Left-click: copy name and highlight in calendar
            btn.addEventListener("click", async () => {
                await copyToClipboard(name);
                findInput.value = name;
                updateFindClearButton();
                const res = await sendFindCommand({ type: "SIDEFIND_UPDATE", term: name, flags: { caseSensitive: false, wholeWord: true } });
                if (res?.stats) { findStats = res.stats; updateFindCounter(); }
            });

            // Right-click: toggle the team checkbox on the Roofr calendar
            btn.addEventListener("contextmenu", async (e) => {
                e.preventDefault();
                const res = await sendFindCommand({ type: "TOGGLE_TEAM_CHECKBOX", name: name });
                if (res?.toggled) {
                    showToast(`${res.checked ? '☑' : '☐'} ${name}`);
                } else {
                    showToast(`Checkbox not found for ${name}`);
                }
            });

            btn.title = `Click to highlight, right-click to toggle checkbox`;
            container.appendChild(btn);
        }
    }

    /* ========= Rep Availability Checking ========= */
    let repAvailabilityStatus = {}; // { repName: true/false }
    let selectedDate = null; // The currently selected date for rep availability

    // Initialize selected date to tomorrow
    function initializeSelectedDate() {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        selectedDate = tomorrow;
        return tomorrow;
    }

    async function fetchTomorrowRepAvailability(targetDate = null) {
        try {
            const apiKey = CONFIG.apiKey;
            const sheetId = settings.NEXT_SHEET_ID;
            if (!apiKey || !sheetId) return {};

            // Use provided date or fall back to tomorrow
            const checkDate = targetDate || (() => {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(0, 0, 0, 0);
                return tomorrow;
            })();

            // Update selected date if not set
            if (!selectedDate) {
                selectedDate = new Date(checkDate);
            }

            // Find the tab for the target date's week
            const tabName = await discoverWeeklyTabNameForDate(checkDate);
            if (!tabName) {
                addLog('Could not find weekly tab for the selected date', 'WARN');
                return {};
            }
            addLog(`Found tab: ${tabName} for date ${checkDate.toLocaleDateString()}`);

            // Determine which day column to check (0=Monday, 6=Sunday)
            const dayOfWeek = checkDate.getDay();
            const monFirstIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convert Sunday=0 to Sunday=6
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            addLog(`Checking ${dayNames[dayOfWeek]} (column index ${monFirstIndex + 1})`)

            // Fetch the entire sheet to find rep sections (use UNFORMATTED_VALUE to get boolean values for checkboxes)
            const qTab = `'${tabName.replace(/'/g, "''")}'`;
            const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(qTab)}?key=${encodeURIComponent(apiKey)}&valueRenderOption=UNFORMATTED_VALUE`;

            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) throw new Error(`API error: ${res.statusText}`);
            const data = await res.json();
            const values = data.values || [];

            // Parse the sheet structure to find rep availability
            const availability = {};
            const checkColumn = monFirstIndex + 1; // B=1 (Monday), C=2 (Tuesday), etc.

            addLog(`Parsing sheet data - checking column ${checkColumn} (${['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'][checkColumn]})`);

            for (let i = 0; i < values.length; i++) {
                const row = values[i] || [];

                // Check if this row contains a rep name in column A (first column only for header rows)
                // This avoids matching timeslot rows like "Justin Parker: 7:30am - 10am"
                const cellA = String(row[0] || '').trim();
                const matchedRep = PEOPLE_DATA.REPS.find(rep => {
                    // Match only if cell A contains the rep name AND doesn't contain a colon (timeslot indicator)
                    return cellA.includes(rep) && !cellA.includes(':');
                });

                if (matchedRep) {
                    addLog(`Row ${i}: Found "${matchedRep}" HEADER - checking next 4 rows in column ${checkColumn}`);
                    // Found a rep header row, now check the next 4 rows for availability
                    availability[matchedRep] = false; // Default to off

                    // Check the next 4 rows (time slot rows) for availability
                    // STRICT LOGIC: Must be explicit TRUE (boolean) to be available.
                    // Empty cells or unchecked checkboxes are considered UNAVAILABLE.
                    for (let offset = 1; offset <= 4 && (i + offset) < values.length; offset++) {
                        const timeSlotRow = values[i + offset] || [];
                        const cellValue = timeSlotRow[checkColumn];

                        addLog(`  Row ${i + offset}: Slot ${offset} value = ${JSON.stringify(cellValue)} (type: ${typeof cellValue})`);

                        // Check if this slot is explicitly AVAILABLE
                        // With UNFORMATTED_VALUE, checked checkboxes return boolean true
                        const isAvailable = cellValue === true;

                        if (isAvailable) {
                            availability[matchedRep] = true;
                            addLog(`  ✓ ${matchedRep} marked as WORKING (slot ${offset} checked)`);
                            break; // Found at least one available slot, rep is working
                        }
                    }

                    if (!availability[matchedRep]) {
                        addLog(`${matchedRep} marked as OFF (all slots unavailable)`);
                    }
                }
            }

            addLog(`Fetched availability for ${Object.keys(availability).length} reps for ${checkDate.toLocaleDateString()}`);
            return availability;
        } catch (e) {
            addLog(`Error fetching availability: ${e.message}`, 'ERROR');
            return {};
        }
    }

    async function loadPeopleLists() {
        if (chrome.storage && chrome.storage.sync) {
            const keys = ["PEOPLE_REPS", "PEOPLE_MGMT", "PEOPLE_CSRS"];
            const settings = await chrome.storage.sync.get(keys);

            // Check if stored data contains old removed reps or is missing new people and clear if so
            const removedReps = ["Brandon Cook", "Brian Griggs", "Phil Merrell", "Ted Pear"];
            const removedCSRs = ["Layla Fairfield"];
            const newMgmt = ["Andrew Clark"]; // New management members to check for
            let needsClear = false;

            if (settings.PEOPLE_REPS) {
                const storedReps = settings.PEOPLE_REPS.split(',').map(s => s.trim());
                if (removedReps.some(removed => storedReps.includes(removed))) {
                    needsClear = true;
                }
            }

            if (settings.PEOPLE_CSRS) {
                const storedCSRs = settings.PEOPLE_CSRS.split(',').map(s => s.trim());
                if (removedCSRs.some(removed => storedCSRs.includes(removed))) {
                    needsClear = true;
                }
            }

            if (settings.PEOPLE_MGMT) {
                const storedMgmt = settings.PEOPLE_MGMT.split(',').map(s => s.trim());
                if (newMgmt.some(newPerson => !storedMgmt.includes(newPerson))) {
                    needsClear = true;
                }
            }

            // Clear outdated storage and use config defaults
            if (needsClear) {
                await chrome.storage.sync.remove(keys);
                addLog('Cleared outdated people lists from storage, using config defaults');
            } else {
                // Load from storage if valid
                if (settings.PEOPLE_REPS) PEOPLE_DATA.REPS = settings.PEOPLE_REPS.split(',').map(s => s.trim()).filter(Boolean).sort();
                if (settings.PEOPLE_MGMT) PEOPLE_DATA.MGMT = settings.PEOPLE_MGMT.split(',').map(s => s.trim()).filter(Boolean).sort();
                if (settings.PEOPLE_CSRS) PEOPLE_DATA.CSRS = settings.PEOPLE_CSRS.split(',').map(s => s.trim()).filter(Boolean).sort();
            }
        }

        // Fetch tomorrow's availability
        repAvailabilityStatus = await fetchTomorrowRepAvailability();

        renderPeopleList(repsList, PEOPLE_DATA.REPS);
        renderPeopleList(mgmtList, PEOPLE_DATA.MGMT);
        renderPeopleList(csrsList, PEOPLE_DATA.CSRS);
    }

    // Update the assigned rep display next to the toggle
    function updateAssignedRepDisplay(repName) {
        if (!assignedRepDisplay) return;
        if (repName && repName !== 'Unassigned') {
            const firstName = repName.split(' ')[0];
            assignedRepDisplay.textContent = firstName;
            assignedRepDisplay.style.color = 'var(--primary)';
        } else {
            assignedRepDisplay.textContent = '--';
            assignedRepDisplay.style.color = 'var(--text-muted)';
        }
    }

    /* ========= Clipboard Functionality ========= */
    const debouncedSaveClipboards = debounce(async () => {
        if (chrome.storage) {
            // Save to both local (for large data fallback) and sync (for cross-browser sync)
            try {
                // Try sync first for cross-browser sync
                if (chrome.storage.sync) {
                    await chrome.storage.sync.set({ [CLIPBOARDS_KEY]: clipboards });
                }
            } catch (e) {
                // Sync storage quota exceeded - fall back to local only
                console.warn('[Clipboard] Sync storage quota exceeded, using local only:', e);
            }
            // Always save to local as backup
            if (chrome.storage.local) {
                await chrome.storage.local.set({ [CLIPBOARDS_KEY]: clipboards });
            }
        }
    }, 500);

    document.addEventListener('click', () => {
        document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
    });

    function renderClipboards() {
        if (!clipboardContainer) return;
        clipboardContainer.innerHTML = '';
        const fragment = document.createDocumentFragment();

        clipboards.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'note-card';

            const header = document.createElement('div');
            header.className = 'note-header';

            const titleInput = document.createElement('input');
            titleInput.type = 'text';
            titleInput.className = 'note-title';
            titleInput.value = item.title;
            titleInput.placeholder = 'Untitled Note';
            titleInput.addEventListener('input', () => {
                clipboards[index].title = titleInput.value;
                debouncedSaveClipboards();
            });

            const actions = document.createElement('div');
            actions.className = 'note-actions';

            const delBtn = document.createElement('button');
            delBtn.className = 'btn-icon';
            delBtn.title = 'Delete Note';
            delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
            delBtn.style.color = 'var(--danger)';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                clipboards.splice(index, 1);
                debouncedSaveClipboards();
                renderClipboards();
            });
            actions.appendChild(delBtn);

            const copyBtn = document.createElement('button');
            copyBtn.textContent = 'Copy';
            copyBtn.className = 'btn ghost';
            copyBtn.style.fontSize = '10px';
            copyBtn.addEventListener('click', async (e) => {
                try {
                    const html = item.content || "";
                    const text = getTextFromHtml(html);
                    const blobHtml = new Blob([html], { type: 'text/html' });
                    const blobText = new Blob([text], { type: 'text/plain' });
                    const data = [new ClipboardItem({ ["text/plain"]: blobText, ["text/html"]: blobHtml })];
                    await navigator.clipboard.write(data);
                    e.target.textContent = "Copied";
                    setTimeout(() => e.target.textContent = "Copy", 1000);
                } catch (err) {
                    copyToClipboard(getTextFromHtml(item.content), e.target);
                }
            });
            actions.appendChild(copyBtn);

            const dropdown = document.createElement('div');
            dropdown.className = 'dropdown';

            const optsBtn = document.createElement('button');
            optsBtn.className = 'btn-icon';
            optsBtn.innerHTML = '⋮';

            const menu = document.createElement('div');
            menu.className = 'dropdown-menu';

            const addAction = (label, handler) => {
                const btn = document.createElement('button');
                btn.className = 'menu-action';
                btn.textContent = label;
                btn.addEventListener('click', (e) => { e.stopPropagation(); handler(); menu.classList.remove('show'); });
                menu.appendChild(btn);
            };

            addAction('Save HTML', () => {
                const blob = new Blob([item.content], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `${item.title || 'note'}.html`;
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
            });
            addAction('Duplicate', () => addNewClipboard(item.content, `${item.title} (Copy)`));

            optsBtn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('show'); });
            dropdown.appendChild(optsBtn);
            dropdown.appendChild(menu);
            actions.appendChild(dropdown);

            header.appendChild(titleInput);
            header.appendChild(actions);

            const contentDiv = document.createElement('div');
            contentDiv.className = 'note-content';
            contentDiv.contentEditable = "true";
            contentDiv.innerHTML = item.content || "";
            // If only one note, make it full page height; otherwise use saved height or default
            if (clipboards.length === 1) {
                contentDiv.style.height = item.height || 'calc(100vh - 320px)';
            } else {
                contentDiv.style.height = item.height || '15vh';
            }

            contentDiv.addEventListener('input', () => {
                clipboards[index].content = contentDiv.innerHTML;
                debouncedSaveClipboards();
            });

            contentDiv.addEventListener('focus', () => {
                const rawText = contentDiv.innerText.trim();
                if (item.locked && AFFIRMATIONS.includes(rawText)) {
                    contentDiv.innerHTML = "";
                    clipboards[index].content = "";
                    debouncedSaveClipboards();
                }
            });

            // Handle paste to preserve formatting - intercept and manually insert formatted content
            contentDiv.addEventListener('paste', (e) => {
                e.preventDefault(); // Prevent default paste behavior

                // Try to get HTML content first (preserves formatting)
                let pastedContent = e.clipboardData.getData('text/html');

                // If no HTML, fall back to plain text
                if (!pastedContent) {
                    pastedContent = e.clipboardData.getData('text/plain');
                    // Preserve line breaks when pasting plain text
                    pastedContent = pastedContent.replace(/\n/g, '<br>');
                }

                // Insert the content at cursor position
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    range.deleteContents();

                    // Create a document fragment from the HTML
                    const template = document.createElement('template');
                    template.innerHTML = pastedContent;
                    const fragment = template.content;

                    // Insert the fragment at cursor
                    range.insertNode(fragment);

                    // Move cursor to end of inserted content
                    range.collapse(false);
                    selection.removeAllRanges();
                    selection.addRange(range);
                }

                // Save the updated content with formatting preserved
                setTimeout(() => {
                    clipboards[index].content = contentDiv.innerHTML;
                    debouncedSaveClipboards();
                }, 10);
            });

            // Handle copy to include formatting
            contentDiv.addEventListener('copy', (e) => {
                const selection = window.getSelection();
                if (!selection.rangeCount) return;

                e.preventDefault();

                // Get the selected content
                const range = selection.getRangeAt(0);
                const fragment = range.cloneContents();

                // Create a temporary container to get HTML
                const tempDiv = document.createElement('div');
                tempDiv.appendChild(fragment);

                // Set both plain text and HTML to clipboard
                const htmlContent = tempDiv.innerHTML;
                const textContent = selection.toString();

                e.clipboardData.setData('text/html', htmlContent);
                e.clipboardData.setData('text/plain', textContent);
            });

            // Highlight selected text on the Roofr page
            contentDiv.addEventListener('mouseup', async () => {
                const selection = window.getSelection();
                const selectedText = selection.toString().trim();

                if (selectedText) {
                    // Use the SideFind functionality to highlight the selected text
                    const res = await sendFindCommand({
                        type: "SIDEFIND_UPDATE",
                        term: selectedText,
                        flags: {
                            caseSensitive: false,
                            wholeWord: false,
                            useRegex: false
                        }
                    });

                    if (res?.stats) {
                        findStats = res.stats;
                        updateFindCounter();
                        // Update the find input to show what's being searched
                        if (findInput) {
                            findInput.value = selectedText;
                            updateFindClearButton();
                        }
                    }
                }
            });

            // Also trigger on keyboard selection
            contentDiv.addEventListener('keyup', async (e) => {
                // Only trigger for shift+arrow keys or other selection keys
                if (e.shiftKey || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
                    const selection = window.getSelection();
                    const selectedText = selection.toString().trim();

                    if (selectedText) {
                        const res = await sendFindCommand({
                            type: "SIDEFIND_UPDATE",
                            term: selectedText,
                            flags: {
                                caseSensitive: false,
                                wholeWord: false,
                                useRegex: false
                            }
                        });

                        if (res?.stats) {
                            findStats = res.stats;
                            updateFindCounter();
                            if (findInput) {
                                findInput.value = selectedText;
                                updateFindClearButton();
                            }
                        }
                    }
                }
            });

            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'note-resize-handle';

            let isNoteDragging = false;
            let startY;
            let startHeight;

            resizeHandle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                isNoteDragging = true;
                startY = e.clientY;
                startHeight = parseInt(window.getComputedStyle(contentDiv).height, 10);
                document.body.style.userSelect = "none";
                resizeHandle.style.cursor = "ns-resize";

                const onMouseMove = (moveEvent) => {
                    if (!isNoteDragging) return;
                    const delta = moveEvent.clientY - startY;
                    let newHeight = startHeight + delta;
                    if (newHeight < 60) newHeight = 60;
                    if (newHeight > window.innerHeight * 0.8) newHeight = window.innerHeight * 0.8;
                    contentDiv.style.height = `${newHeight}px`;
                };

                const onMouseUp = () => {
                    if (isNoteDragging) {
                        isNoteDragging = false;
                        document.body.style.userSelect = "";
                        resizeHandle.style.cursor = "";
                        clipboards[index].height = contentDiv.style.height;
                        debouncedSaveClipboards();
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                    }
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            card.appendChild(header);
            card.appendChild(contentDiv);
            card.appendChild(resizeHandle);
            fragment.appendChild(card);
        });

        clipboardContainer.appendChild(fragment);
    }

    function addNewClipboard(initialContent = '', initialTitle = 'New Note', isLocked = false) {
        clipboards.push({
            id: Date.now().toString(),
            title: initialTitle,
            content: initialContent,
            locked: isLocked
        });
        debouncedSaveClipboards();
        renderClipboards();
    }

    async function loadClipboards() {
        if (!chrome.storage) {
            clipboards = [{ id: 'default', title: 'Quick Notes', content: getRandomAffirmation(), locked: true }];
            renderClipboards();
            return;
        }

        // Try sync storage first (for cross-browser sync), then local as fallback
        let data = null;
        if (chrome.storage.sync) {
            try {
                data = await chrome.storage.sync.get(CLIPBOARDS_KEY);
            } catch (e) {
                console.warn('[Clipboard] Error reading from sync storage:', e);
            }
        }

        // If no sync data, try local storage
        if ((!data || !data[CLIPBOARDS_KEY] || data[CLIPBOARDS_KEY].length === 0) && chrome.storage.local) {
            data = await chrome.storage.local.get(CLIPBOARDS_KEY);
        }

        if (data && data[CLIPBOARDS_KEY] && data[CLIPBOARDS_KEY].length > 0) {
            clipboards = data[CLIPBOARDS_KEY];
        } else {
            clipboards = [{
                id: 'default',
                title: 'Quick Notes',
                content: getRandomAffirmation(),
                locked: true
            }];
        }
        renderClipboards();
    }

    if (addClipboardBtn) addClipboardBtn.addEventListener('click', () => addNewClipboard());
    if (uploadClipboardBtn && clipboardFileInput) {
        uploadClipboardBtn.addEventListener('click', () => clipboardFileInput.click());
        clipboardFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const title = file.name ? file.name.replace(/\.(txt|html|htm)$/i, '') : 'Import';
                addNewClipboard(ev.target.result, title);
                clipboardFileInput.value = '';
            };
            reader.readAsText(file);
        });
    }

    /* ========= Settings Logic ========= */
    function toggleSettings(show) {
        if (settingsModal) {
            if (show) settingsModal.classList.remove('hidden');
            else settingsModal.classList.add('hidden');
        }
    }

    // Settings button opens options page directly (no modal)
    if (settingsBtn) settingsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });
    // Keep modal handlers for legacy support
    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', () => toggleSettings(false));
    if (goToSettingsBtn) goToSettingsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });
    if (openAdvOptionsBtn) openAdvOptionsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    async function loadUserPrefs() {
        if (!chrome.storage || !chrome.storage.local) return;
        const data = await chrome.storage.local.get(USER_PREFS_KEY);
        if (data[USER_PREFS_KEY]) {
            userPrefs = { ...userPrefs, ...data[USER_PREFS_KEY] };
        }
        applyUserPrefs();
    }

    function saveUserPrefs() {
        chrome.storage.local.set({ [USER_PREFS_KEY]: userPrefs });
    }

    function applyUserPrefs() {
        // One-time migration: reset tab visibility to correct defaults (Scanner + People + Clipboard on, others off)
        chrome.storage.local.get('tabs_visibility_migrated_v4', (result) => {
            if (!result.tabs_visibility_migrated_v4) {
                chrome.storage.sync.set({
                    show_job_sorting: false,
                    show_people: true,
                    show_clipboard: true,
                    show_reports: false
                }, () => {
                    chrome.storage.local.set({ tabs_visibility_migrated_v4: true });
                    console.log('[Popup] Migrated tab visibility: Scanner + People + Clipboard on, others off');
                });
            }
        });

        // Theme
        const themeName = userPrefs.theme || 'light';
        applyTheme(themeName);

        // For backwards compatibility, also apply dark-theme class for dark theme
        if (themeName === 'dark') document.body.classList.add('dark-theme');
        else document.body.classList.remove('dark-theme');

        if (settingTheme) settingTheme.value = themeName;

        // Font Size
        const baseSize = 13 + parseInt(userPrefs.fontSizeStep || 0);
        document.documentElement.style.fontSize = `${baseSize}px`;
        if (settingFontSize) settingFontSize.value = userPrefs.fontSizeStep;

        // Compact
        if (userPrefs.compactView) document.body.classList.add('compact-mode');
        else document.body.classList.remove('compact-mode');
        if (settingCompact) settingCompact.checked = userPrefs.compactView;

        // Global Panel
        if (settingGlobalPanel) settingGlobalPanel.checked = userPrefs.globalPanel;
        const desc = document.getElementById('mode-desc');
        if (desc) desc.textContent = userPrefs.globalPanel ? 'Global (All Tabs)' : 'Roofr Only';

        // Autoscan
        if (settingAutoScan) settingAutoScan.checked = userPrefs.autoScan;
        if (settingAutoScanWeek) settingAutoScanWeek.checked = userPrefs.autoScanWeek;

        // Show Uncat
        if (settingShowUncat) settingShowUncat.checked = userPrefs.showUncatCollapsed;

        // Idle Popup
        if (settingIdlePopup) settingIdlePopup.checked = userPrefs.idlePopup;
        if (settingIdleTimeout) settingIdleTimeout.value = userPrefs.idleTimeout;
        if (idleTimeoutRow) idleTimeoutRow.style.display = userPrefs.idlePopup ? '' : 'none';

        // Default Region
        if (settingDefaultRegion) settingDefaultRegion.value = userPrefs.defaultRegion;
        if (state.currentRegion === "PHX" && userPrefs.defaultRegion !== "PHX") {
            state.currentRegion = userPrefs.defaultRegion;
            renderUIFromState();
        }

        // Interface Toggles
        if (settingShowJobSorting) settingShowJobSorting.checked = userPrefs.showJobSortingTab;
        if (settingShowPeople) settingShowPeople.checked = userPrefs.showPeopleTab;
        if (settingShowClipboard) settingShowClipboard.checked = userPrefs.showClipboardTab;
        if (settingShowReports) settingShowReports.checked = userPrefs.showReportsTab;

        // Sync with options page settings if available
        chrome.storage.sync.get([
            // Tab visibility
            'show_job_sorting', 'show_people', 'show_clipboard', 'show_reports',
            // Appearance
            'theme', 'compact_mode', 'show_color_indicators', 'show_icons', 'animate_transitions',
            // Interface
            'global_panel_mode', 'auto_expand_days',
            // Scanner
            'auto_scan_on_load', 'show_uncategorized_alerts'
        ], (result) => {
            // Appearance settings
            if (result.theme !== undefined) {
                userPrefs.theme = result.theme;
                applyTheme(result.theme);
                // Handle dark-theme class for backwards compatibility
                if (result.theme === 'dark') document.body.classList.add('dark-theme');
                else document.body.classList.remove('dark-theme');
                if (settingTheme) settingTheme.value = result.theme;
            }
            if (result.compact_mode !== undefined) {
                userPrefs.compactView = result.compact_mode;
                if (result.compact_mode) document.body.classList.add('compact-mode');
                else document.body.classList.remove('compact-mode');
                if (settingCompact) settingCompact.checked = result.compact_mode;
            }
            if (result.global_panel_mode !== undefined) {
                userPrefs.globalPanel = result.global_panel_mode;
                if (settingGlobalPanel) settingGlobalPanel.checked = result.global_panel_mode;
            }
            if (result.auto_scan_on_load !== undefined) {
                userPrefs.autoScan = result.auto_scan_on_load;
                if (settingAutoScan) settingAutoScan.checked = result.auto_scan_on_load;
            }
            if (result.show_uncategorized_alerts !== undefined) {
                userPrefs.showUncatCollapsed = !result.show_uncategorized_alerts;
                if (settingShowUncat) settingShowUncat.checked = !result.show_uncategorized_alerts;
            }

            // Tab visibility - only update if value exists in storage
            // Default is to show all tabs (true), only hide if explicitly set to false
            if (result.show_job_sorting !== undefined) userPrefs.showJobSortingTab = result.show_job_sorting;
            if (result.show_people !== undefined) userPrefs.showPeopleTab = result.show_people;
            if (result.show_clipboard !== undefined) userPrefs.showClipboardTab = result.show_clipboard;
            if (result.show_reports !== undefined) userPrefs.showReportsTab = result.show_reports;

            // Update checkboxes
            if (settingShowJobSorting) settingShowJobSorting.checked = userPrefs.showJobSortingTab;
            if (settingShowPeople) settingShowPeople.checked = userPrefs.showPeopleTab;
            if (settingShowClipboard) settingShowClipboard.checked = userPrefs.showClipboardTab;
            if (settingShowReports) settingShowReports.checked = userPrefs.showReportsTab;

            // Update tab visibility - tabs are visible by default, only hide if explicitly false
            const jobSortingTabBtn = document.querySelector('.nav-tab[data-target="sec-sorting"]');
            if (jobSortingTabBtn) jobSortingTabBtn.style.display = userPrefs.showJobSortingTab === false ? 'none' : '';

            const peopleTabBtn = document.querySelector('.nav-tab[data-target="sec-people"]');
            if (peopleTabBtn) peopleTabBtn.style.display = userPrefs.showPeopleTab === false ? 'none' : '';

            const clipTabBtn = document.querySelector('.nav-tab[data-target="sec-clipboard"]');
            if (clipTabBtn) clipTabBtn.style.display = userPrefs.showClipboardTab === false ? 'none' : '';

            const reportsTabBtn = document.querySelector('.nav-tab[data-target="sec-reports"]');
            if (reportsTabBtn) reportsTabBtn.style.display = userPrefs.showReportsTab === false ? 'none' : '';
        });

        // Dock Toggles
        const dockFind = document.getElementById('dock-find-container');
        if (dockFind) dockFind.style.display = userPrefs.showFindBar ? '' : 'none';
        if (settingShowFind) settingShowFind.checked = userPrefs.showFindBar;

        const dockNotes = document.getElementById('dock-notes-container');
        if (dockNotes) dockNotes.style.display = userPrefs.showQuickNotes ? '' : 'none';
        if (settingShowNotes) settingShowNotes.checked = userPrefs.showQuickNotes;

        const dock = document.getElementById('bottom-dock');
        const app = document.getElementById('app-container');
        if (!userPrefs.showFindBar && !userPrefs.showQuickNotes) {
            if (dock) dock.classList.add('hidden');
            if (app) app.classList.add('no-dock');
        } else {
            if (dock) dock.classList.remove('hidden');
            if (app) app.classList.remove('no-dock');
        }
    }

    // --- Settings Listeners ---
    if (settingTheme) settingTheme.addEventListener('change', (e) => {
        const themeName = e.target.value;
        userPrefs.theme = themeName;

        // Apply theme immediately
        applyTheme(themeName);
        if (themeName === 'dark') document.body.classList.add('dark-theme');
        else document.body.classList.remove('dark-theme');

        // Save to both local and sync storage
        saveUserPrefs();
        chrome.storage.sync.set({ theme: themeName });
    });
    if (settingFontSize) settingFontSize.addEventListener('input', (e) => {
        userPrefs.fontSizeStep = e.target.value;
        saveUserPrefs(); applyUserPrefs();
    });
    if (settingCompact) settingCompact.addEventListener('change', (e) => {
        userPrefs.compactView = e.target.checked;
        saveUserPrefs(); applyUserPrefs();
    });
    if (settingGlobalPanel) settingGlobalPanel.addEventListener('change', (e) => {
        userPrefs.globalPanel = e.target.checked;
        saveUserPrefs(); applyUserPrefs();
        chrome.runtime.sendMessage({ type: "UPDATE_PANEL_BEHAVIOR", global: userPrefs.globalPanel });
    });
    if (settingAutoScan) settingAutoScan.addEventListener('change', (e) => {
        userPrefs.autoScan = e.target.checked;
        saveUserPrefs();
    });
    if (settingAutoScanWeek) settingAutoScanWeek.addEventListener('change', (e) => {
        userPrefs.autoScanWeek = e.target.checked;
        saveUserPrefs();
    });
    if (settingShowUncat) settingShowUncat.addEventListener('change', (e) => {
        userPrefs.showUncatCollapsed = e.target.checked;
        saveUserPrefs(); applyUserPrefs();
        renderUIFromState(); // Re-render to update uncat boxes
    });
    if (settingIdlePopup) settingIdlePopup.addEventListener('change', (e) => {
        userPrefs.idlePopup = e.target.checked;
        saveUserPrefs(); applyUserPrefs();
        resetIdleTimer(); // Reset timer with new setting
    });
    if (settingIdleTimeout) settingIdleTimeout.addEventListener('change', (e) => {
        userPrefs.idleTimeout = parseInt(e.target.value);
        saveUserPrefs(); applyUserPrefs();
        resetIdleTimer(); // Reset timer with new timeout
    });
    if (settingDefaultRegion) settingDefaultRegion.addEventListener('change', (e) => {
        userPrefs.defaultRegion = e.target.value;
        saveUserPrefs();
    });
    if (settingShowJobSorting) settingShowJobSorting.addEventListener('change', (e) => {
        userPrefs.showJobSortingTab = e.target.checked;
        saveUserPrefs(); applyUserPrefs();
        if (chrome.storage && chrome.storage.sync) chrome.storage.sync.set({ show_job_sorting: e.target.checked });
        // If we just hid the active tab, switch to scanner
        if (!e.target.checked && document.querySelector('.nav-tab[data-target="sec-sorting"].active')) {
            document.querySelector('.nav-tab[data-target="sec-scanner"]').click();
        }
    });
    if (settingShowPeople) settingShowPeople.addEventListener('change', (e) => {
        userPrefs.showPeopleTab = e.target.checked;
        saveUserPrefs(); applyUserPrefs();
        if (chrome.storage && chrome.storage.sync) chrome.storage.sync.set({ show_people: e.target.checked });
        // If we just hid the active tab, switch to scanner
        if (!e.target.checked && document.querySelector('.nav-tab[data-target="sec-people"].active')) {
            document.querySelector('.nav-tab[data-target="sec-scanner"]').click();
        }
    });
    if (settingShowClipboard) settingShowClipboard.addEventListener('change', (e) => {
        userPrefs.showClipboardTab = e.target.checked;
        saveUserPrefs(); applyUserPrefs();
        if (chrome.storage && chrome.storage.sync) chrome.storage.sync.set({ show_clipboard: e.target.checked });
        if (!e.target.checked && document.querySelector('.nav-tab[data-target="sec-clipboard"].active')) {
            document.querySelector('.nav-tab[data-target="sec-scanner"]').click();
        }
    });
    if (settingShowReports) settingShowReports.addEventListener('change', (e) => {
        userPrefs.showReportsTab = e.target.checked;
        saveUserPrefs(); applyUserPrefs();
        if (chrome.storage && chrome.storage.sync) chrome.storage.sync.set({ show_reports: e.target.checked });
        if (!e.target.checked && document.querySelector('.nav-tab[data-target="sec-reports"].active')) {
            document.querySelector('.nav-tab[data-target="sec-scanner"]').click();
        }
    });
    if (settingShowNotes) settingShowNotes.addEventListener('change', (e) => {
        userPrefs.showQuickNotes = e.target.checked;
        saveUserPrefs(); applyUserPrefs();
    });
    if (settingShowFind) settingShowFind.addEventListener('change', (e) => {
        userPrefs.showFindBar = e.target.checked;
        saveUserPrefs(); applyUserPrefs();
    });


    /* ========= Idle Recommendation Timer ========= */
    let idleTimer;
    let currentIdlePriority = 'high'; // Default priority

    function getIdleTimeout() {
        return userPrefs.idleTimeout || 60000; // Default 1 minute
    }

    // Idle timer functionality disabled - recommendation is now inline
    function resetIdleTimer() {
        // No-op: idle popup removed, functionality is now inline
    }

    // Priority descriptions used by inline recommendation
    const priorityDescriptions = {
        high: 'Next available day, best slot',
        med: '2+ days after next available',
        low: '4+ days after next available'
    };

    /* ========= Load Settings ========= */
    async function loadSettings() {
        if (chrome.storage && chrome.storage.sync) {
            const keys = [
                "NEXT_SHEET_ID", "AVAIL_RANGE_PHX", "AVAIL_RANGE_NORTH", "AVAIL_RANGE_SOUTH",
                "search_google_earth", "search_gemini", "search_roofr"
            ];
            const defaults = {
                search_google_earth: true,
                search_gemini: true,
                search_roofr: true
            };
            const result = await chrome.storage.sync.get(keys);
            settings = { ...defaults, ...settings, ...result };
        }
    }

    async function loadDynamicCities() {
        // First, try to load cities from Google Sheet (primary source)
        const sheetCities = await fetchCitiesFromSheet();
        if (sheetCities) {
            for (const region of ['PHX', 'NORTH', 'SOUTH']) {
                if (sheetCities[region] && sheetCities[region].length > 0) {
                    for (const city of sheetCities[region]) {
                        CONFIG.REGION_CITY_WHITELISTS[region].add(city);
                    }
                }
            }
        }

        // Also load any locally-stored cities (backup/offline additions)
        if (chrome.storage && chrome.storage.sync) {
            const data = await chrome.storage.sync.get(DYNAMIC_CITIES_KEY);
            const loadedCities = data[DYNAMIC_CITIES_KEY] || {};

            // Safely merge loaded cities into our local variable
            userAddedCities = {
                PHX: loadedCities.PHX || [],
                NORTH: loadedCities.NORTH || [],
                SOUTH: loadedCities.SOUTH || [],
            };

            // Merge locally-stored cities into CONFIG (may overlap with sheet cities, Sets handle duplicates)
            for (const region of ['PHX', 'NORTH', 'SOUTH']) {
                if (userAddedCities[region] && userAddedCities[region].length > 0) {
                    for (const city of userAddedCities[region]) {
                        CONFIG.REGION_CITY_WHITELISTS[region].add(city);
                    }
                }
            }
        }

        addLog('Loaded and merged dynamic cities from Google Sheet and local storage.');
    }

    /* ========= Initialization ========= */
    async function init() {
        await loadSettings();
        await loadUserPrefs(); // Load and apply prefs
        await loadDynamicCities();
        await loadState();
        await loadPeopleLists();
        await loadClipboards();

        renderUIFromState();
        updateScanButtonState();
        resetIdleTimer();

        if (userPrefs.autoScan) {
            runScanFlow(true); // Pass true to suppress alert on failure
        }

        // Check if there's a pending auto-scan from page load
        checkPendingAutoScan();

        // Try to fetch job owner from any open Roofr job tab
        fetchCurrentJobOwner();
    }

    // Fetch job owner from current Roofr job tab in target window and update display
    async function fetchCurrentJobOwner() {
        try {
            const queryOpts = { url: '*://app.roofr.com/*' };
            if (window.__targetWindowId) queryOpts.windowId = window.__targetWindowId;
            const tabs = await chrome.tabs.query(queryOpts);
            for (const tab of tabs) {
                if (tab.url?.includes('selectedJobId=')) {
                    const result = await chrome.tabs.sendMessage(tab.id, { type: 'GET_JOB_INFO' });
                    if (result?.ok && result?.info?.jobOwner) {
                        updateAssignedRepDisplay(result.info.jobOwner);
                        break;
                    }
                }
            }
        } catch (e) {
            // Ignore - no job tab open or content script not ready
        }
    }

    // Check for pending auto-scan flag set by content script
    async function checkPendingAutoScan() {
        try {
            const data = await chrome.storage.session.get(['autoScanPending', 'autoScanTimestamp']);
            if (data.autoScanPending) {
                // Only auto-scan if the flag was set recently (within last 30 seconds)
                const age = Date.now() - (data.autoScanTimestamp || 0);
                if (age < 30000) {
                    addLog("Found pending auto-scan from page load, scanning...");
                    // Clear the flag first
                    await chrome.storage.session.remove(['autoScanPending', 'autoScanTimestamp']);
                    // Run the scan
                    setTimeout(() => runScanFlow(true), 500);
                } else {
                    // Flag is stale, clear it
                    await chrome.storage.session.remove(['autoScanPending', 'autoScanTimestamp']);
                }
            }
        } catch (e) {
            // Session storage might not be available
            console.log("Could not check pending auto-scan:", e);
        }
    }

    // ========================================
    // REPORTS AUTOMATION SECTION
    // ========================================

    // Reports Automation DOM refs
    const reportsRepSelect = document.getElementById('reports-rep-select');
    const reportsJobAddress = document.getElementById('reports-job-address');
    const reportsJobOwner = document.getElementById('reports-job-owner');
    const reportsStatus = document.getElementById('reports-status');
    const reportsLog = document.getElementById('reports-log');
    const runFullAutomationBtn = document.getElementById('run-full-automation');
    const stepSelectOwnerBtn = document.getElementById('step-select-owner');
    const stepMeasurementsBtn = document.getElementById('step-measurements');
    const stepRoofrReportBtn = document.getElementById('step-roofr-report');
    const stepConfirmMapBtn = document.getElementById('step-confirm-map');
    const stepAllSecondaryBtn = document.getElementById('step-all-secondary');

    // Reports Sub-Tab Switching
    const reportsSubTabs = document.querySelectorAll('.reports-sub-tab');
    const reportsPanels = document.querySelectorAll('.reports-panel');

    reportsSubTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetPanel = tab.dataset.reportsTab;

            // Update tab styles
            reportsSubTabs.forEach(t => {
                t.classList.remove('active');
                t.style.background = 'transparent';
                t.style.color = 'var(--text-muted)';
            });
            tab.classList.add('active');
            tab.style.background = 'var(--surface)';
            tab.style.color = 'var(--primary)';

            // Show/hide panels
            reportsPanels.forEach(panel => {
                panel.style.display = 'none';
            });
            const activePanel = document.getElementById(`reports-panel-${targetPanel}`);
            if (activePanel) {
                activePanel.style.display = 'block';
            }
        });
    });

    // Populate rep dropdown
    function populateReportsRepDropdown() {
        if (!reportsRepSelect) return;
        reportsRepSelect.innerHTML = '<option value="">-- Keep current owner --</option>';

        // Add all reps from PEOPLE_DATA
        const allPeople = [...PEOPLE_DATA.REPS, ...PEOPLE_DATA.CSRS].sort();
        allPeople.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            reportsRepSelect.appendChild(opt);
        });
    }

    // Show status in the Reports section
    function showReportsStatus(message, type = 'info') {
        if (!reportsStatus) return;
        reportsStatus.style.display = 'block';
        reportsStatus.textContent = message;

        // Set colors based on type
        if (type === 'success') {
            reportsStatus.style.background = 'var(--success-bg)';
            reportsStatus.style.color = 'var(--success)';
            reportsStatus.style.border = '1px solid var(--success)';
        } else if (type === 'error') {
            reportsStatus.style.background = 'var(--danger-bg)';
            reportsStatus.style.color = 'var(--danger)';
            reportsStatus.style.border = '1px solid var(--danger)';
        } else if (type === 'warning') {
            reportsStatus.style.background = 'var(--warn-bg)';
            reportsStatus.style.color = 'var(--warn)';
            reportsStatus.style.border = '1px solid var(--warn)';
        } else {
            reportsStatus.style.background = 'var(--primary-light)';
            reportsStatus.style.color = 'var(--primary)';
            reportsStatus.style.border = '1px solid var(--primary)';
        }
    }

    // Add to log
    function addReportsLog(message) {
        if (!reportsLog) return;
        reportsLog.style.display = 'block';
        const timestamp = new Date().toLocaleTimeString();
        reportsLog.innerHTML += `[${timestamp}] ${message}<br>`;
        reportsLog.scrollTop = reportsLog.scrollHeight;
    }

    // Clear log
    function clearReportsLog() {
        if (reportsLog) {
            reportsLog.innerHTML = '';
            reportsLog.style.display = 'none';
        }
    }

    // Get current active tab (searches target window for popup mode)
    async function getActiveRoofrJobTab() {
        // Helper to check if a tab is a valid Roofr job page
        const isValidJobTab = (tab) => {
            if (!tab?.url?.includes('roofr.com')) return false;
            const isJobsPage = tab.url.includes('/jobs');
            const hasSelectedJob = tab.url.includes('selectedJobId=');
            const isJobDetailPage = tab.url.includes('/job/');
            return isJobsPage || hasSelectedJob || isJobDetailPage;
        };

        // First try active tab in current window
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && isValidJobTab(tab)) {
            console.log('[Reports] Valid Roofr job page detected:', tab.url);
            return tab;
        }

        // If in popup mode or active tab isn't suitable, search target window only
        const queryOpts = { url: "*://app.roofr.com/*" };
        if (window.__targetWindowId) queryOpts.windowId = window.__targetWindowId;
        const roofrTabs = await chrome.tabs.query(queryOpts);
        for (const roofrTab of roofrTabs) {
            if (isValidJobTab(roofrTab)) {
                console.log('[Reports] Found Roofr job page in target window:', roofrTab.url);
                return roofrTab;
            }
        }

        console.log('[Reports] No Roofr job page found');
        return null;
    }

    // Send message to content script (with auto-injection if needed)
    async function sendReportsCommand(tabId, message) {
        const injectAndRetry = async () => {
            addReportsLog("Injecting content script...");
            try {
                // Clear the flag so the script re-initializes
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => { window.__roofrJobAutomationLoaded = false; }
                });
                // Inject the content script
                await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
                await new Promise(r => setTimeout(r, 1000)); // Wait longer for script to initialize
                const response = await chrome.tabs.sendMessage(tabId, message);
                return response || { ok: false, error: 'No response after injection' };
            } catch (retryError) {
                console.error('[Reports] Injection failed:', retryError);
                return { ok: false, error: `Failed to inject script: ${retryError.message}` };
            }
        };

        try {
            const response = await chrome.tabs.sendMessage(tabId, message);
            if (response) {
                return response;
            }
            // Got null/undefined response - try injecting
            console.log('[Reports] No response, attempting injection');
            return await injectAndRetry();
        } catch (e) {
            console.log('[Reports] Send message error:', e.message);
            if (e.message && (e.message.includes('Receiving end does not exist') || e.message.includes('Could not establish connection'))) {
                // Content script not loaded, inject it and retry
                return await injectAndRetry();
            }
            return { ok: false, error: e.message };
        }
    }

    // Update job info display
    async function updateReportsJobInfo() {
        const tab = await getActiveRoofrJobTab();

        if (!tab) {
            if (reportsJobAddress) reportsJobAddress.textContent = 'Navigate to a Roofr job page';
            if (reportsJobOwner) reportsJobOwner.textContent = '';
            showReportsStatus('', ''); // Clear any status
            return;
        }

        // Show loading state
        if (reportsJobAddress) reportsJobAddress.textContent = 'Loading job info...';

        const result = await sendReportsCommand(tab.id, { type: 'GET_JOB_INFO' });

        if (result.ok && result.info) {
            if (reportsJobAddress) {
                reportsJobAddress.textContent = result.info.address || 'Job loaded';
            }
            if (reportsJobOwner) {
                reportsJobOwner.textContent = result.info.jobOwner ? `Owner: ${result.info.jobOwner}` : '';
            }
            // Also update the header display with job owner
            updateAssignedRepDisplay(result.info.jobOwner);
            showReportsStatus('', ''); // Clear any error status
        } else if (result.error) {
            // Show error but don't block - user can still try to run automation
            console.log('[Reports] Failed to get job info:', result.error);
            if (reportsJobAddress) {
                reportsJobAddress.textContent = 'Job page detected - click Run to start';
            }
            if (reportsJobOwner) {
                reportsJobOwner.textContent = '';
            }
        }
    }

    // Run full automation
    async function runFullReportAutomation() {
        clearReportsLog();
        addReportsLog('Starting report automation...');
        showReportsStatus('Running automation...', 'info');

        const tab = await getActiveRoofrJobTab();
        if (!tab) {
            showReportsStatus('Please navigate to a Roofr job page first', 'error');
            addReportsLog('ERROR: Not on a Roofr job page');
            return;
        }

        const repName = reportsRepSelect?.value || null;
        addReportsLog(`Rep selection: ${repName || 'Keep current'}`);

        const result = await sendReportsCommand(tab.id, {
            type: 'RUN_REPORT_AUTOMATION',
            repName
        });

        if (result.success) {
            showReportsStatus('Automation completed successfully!', 'success');
            addReportsLog('Automation completed successfully!');
            result.steps.forEach(step => {
                addReportsLog(`✓ ${step.step}`);
            });
        } else {
            showReportsStatus(`Automation failed: ${result.error}`, 'error');
            addReportsLog(`ERROR: ${result.error}`);
            if (result.steps) {
                result.steps.forEach(step => {
                    addReportsLog(`✓ ${step.step}`);
                });
            }
        }
    }

    // Individual step handlers
    async function runStep(messageType, stepName) {
        const tab = await getActiveRoofrJobTab();
        if (!tab) {
            showReportsStatus('Please navigate to a Roofr job page first', 'error');
            return;
        }

        showReportsStatus(`Running: ${stepName}...`, 'info');
        addReportsLog(`Running: ${stepName}`);

        let message = { type: messageType };

        // Add repName for SELECT_JOB_OWNER
        if (messageType === 'SELECT_JOB_OWNER') {
            const repName = reportsRepSelect?.value;
            if (!repName) {
                showReportsStatus('Please select a rep first', 'warning');
                return;
            }
            message.repName = repName;
        }

        const result = await sendReportsCommand(tab.id, message);

        if (result.ok) {
            showReportsStatus(`${stepName} completed!`, 'success');
            addReportsLog(`✓ ${stepName} completed`);
        } else {
            showReportsStatus(`${stepName} failed: ${result.error}`, 'error');
            addReportsLog(`✗ ${stepName} failed: ${result.error}`);
        }
    }

    // Bind event listeners for Reports section
    if (runFullAutomationBtn) {
        runFullAutomationBtn.addEventListener('click', runFullReportAutomation);
    }

    if (stepSelectOwnerBtn) {
        stepSelectOwnerBtn.addEventListener('click', () => runStep('SELECT_JOB_OWNER', 'Set Owner'));
    }

    if (stepMeasurementsBtn) {
        stepMeasurementsBtn.addEventListener('click', () => runStep('CLICK_MEASUREMENTS_TAB', 'Measurements'));
    }

    if (stepRoofrReportBtn) {
        stepRoofrReportBtn.addEventListener('click', () => runStep('CLICK_ROOFR_REPORT', 'Roofr Report'));
    }

    if (stepConfirmMapBtn) {
        stepConfirmMapBtn.addEventListener('click', () => runStep('CLICK_CONFIRM_MAP', 'Confirm Map'));
    }

    if (stepAllSecondaryBtn) {
        stepAllSecondaryBtn.addEventListener('click', () => runStep('SELECT_ALL_SECONDARY', 'All Secondary + Next'));
    }

    // Update job info when Reports tab is selected
    mainTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.dataset.target === 'sec-reports') {
                updateReportsJobInfo();
            }
        });
    });

    // Initialize Reports section
    populateReportsRepDropdown();

    // ========================================
    // BATCH PROCESSING SECTION
    // ========================================

    const batchScheduleInput = document.getElementById('batch-schedule-input');
    const parseBatchBtn = document.getElementById('parse-batch-schedule');
    const batchParsedJobs = document.getElementById('batch-parsed-jobs');
    const batchJobsList = document.getElementById('batch-jobs-list');
    const runBatchBtn = document.getElementById('run-batch-automation');
    const batchProgress = document.getElementById('batch-progress');
    const batchProgressText = document.getElementById('batch-progress-text');
    const batchProgressBar = document.getElementById('batch-progress-bar');
    const batchLog = document.getElementById('batch-log');

    let parsedAppointments = [];
    let batchIsPaused = false;
    let batchIsCancelled = false;
    let batchIsRunning = false;

    // Parse schedule text into appointments
    function parseScheduleReport(text) {
        const appointments = [];
        const lines = text.trim().split('\n');

        let currentRep = null;

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            // Check if this is a rep name line (e.g., "Travis Jones (2)" or just "Travis Jones")
            const repMatch = trimmedLine.match(/^([A-Z][a-z]+ [A-Z][a-z]+)(?:\s*\(\d+\))?$/);
            if (repMatch) {
                currentRep = repMatch[1];
                continue;
            }

            // Skip "Available:" and availability time lines
            if (trimmedLine.toLowerCase().startsWith('available') ||
                /^\d{1,2}(?:am|pm)\s*-\s*\d{1,2}(?:am|pm)$/i.test(trimmedLine) ||
                /^\d{1,2}:\d{2}(?:am|pm)?\s*-\s*\d{1,2}:\d{2}(?:am|pm)?$/i.test(trimmedLine)) {
                continue;
            }

            // Parse appointment line (e.g., "7:30am-9am: 10545 E Fanfol Ln, SCOTTSDALE, AZ 85258 (41yrs Tile)")
            const appointmentMatch = trimmedLine.match(/^(\d{1,2}(?::\d{2})?(?:am|pm)?)\s*-\s*(\d{1,2}(?::\d{2})?(?:am|pm)?)\s*:\s*(.+)$/i);
            if (appointmentMatch && currentRep) {
                const startTime = appointmentMatch[1];
                const endTime = appointmentMatch[2];
                const addressPart = appointmentMatch[3];

                // Extract address (everything before the parenthesis or end)
                const addressMatch = addressPart.match(/^(.+?)\s*(?:\(|##|#|$)/);
                const address = addressMatch ? addressMatch[1].trim() : addressPart.trim();

                appointments.push({
                    rep: currentRep,
                    startTime: normalizeTime(startTime),
                    endTime: normalizeTime(endTime),
                    address: address,
                    fullLine: trimmedLine,
                    status: 'pending'
                });
            }
        }

        return appointments;
    }

    // Normalize time format to "H:MMam/pm"
    function normalizeTime(time) {
        time = time.toLowerCase().trim();
        // If no am/pm, assume based on hour
        if (!time.includes('am') && !time.includes('pm')) {
            const hour = parseInt(time.split(':')[0]);
            time += hour < 6 || hour === 12 ? 'pm' : (hour < 12 ? 'am' : 'pm');
        }
        // Add :00 if no minutes
        if (!time.includes(':')) {
            time = time.replace(/(am|pm)/i, ':00$1');
        }
        return time;
    }

    // Add log entry to batch log
    function addBatchLog(message, type = 'info') {
        if (!batchLog) return;
        batchLog.style.display = 'block';
        const timestamp = new Date().toLocaleTimeString();
        const color = type === 'error' ? 'var(--danger)' : type === 'success' ? 'var(--success)' : 'inherit';
        const logEntry = `<div style="color: ${color}">[${timestamp}] ${message}</div>`;

        // Add to inline log content
        const logContent = document.getElementById('batch-log-content');
        if (logContent) {
            logContent.innerHTML += logEntry;
        } else {
            batchLog.innerHTML += logEntry;
        }
        batchLog.scrollTop = batchLog.scrollHeight;

        // Also add to modal content if it exists
        const modalContent = document.getElementById('batch-logs-modal-content');
        if (modalContent) {
            modalContent.innerHTML += logEntry;
            modalContent.scrollTop = modalContent.scrollHeight;
        }
    }

    // Clear batch log
    function clearBatchLog() {
        const logContent = document.getElementById('batch-log-content');
        if (logContent) {
            logContent.innerHTML = '';
        }
        if (batchLog) {
            if (!logContent) batchLog.innerHTML = '';
            batchLog.style.display = 'none';
        }
        const modalContent = document.getElementById('batch-logs-modal-content');
        if (modalContent) {
            modalContent.innerHTML = '';
        }
    }

    // Update progress display
    function updateBatchProgress(current, total, text) {
        if (!batchProgress) return;
        batchProgress.style.display = 'block';
        batchProgressText.textContent = text || `Processing ${current} of ${total}`;
        const percent = total > 0 ? (current / total) * 100 : 0;
        batchProgressBar.style.width = `${percent}%`;
    }

    // Render parsed appointments
    function renderParsedAppointments() {
        if (!batchJobsList || !batchParsedJobs) return;

        if (parsedAppointments.length === 0) {
            batchParsedJobs.style.display = 'none';
            runBatchBtn.style.display = 'none';
            return;
        }

        batchParsedJobs.style.display = 'block';
        runBatchBtn.style.display = 'block';

        let html = '';
        let currentRep = null;

        for (let i = 0; i < parsedAppointments.length; i++) {
            const apt = parsedAppointments[i];
            if (apt.rep !== currentRep) {
                if (currentRep !== null) html += '</div>';
                currentRep = apt.rep;
                html += `<div style="margin-bottom: 8px;"><strong style="color: var(--primary);">${apt.rep}</strong>`;
            }
            const statusIcon = apt.status === 'done' ? '✓' : apt.status === 'error' ? '✗' : '○';
            const statusColor = apt.status === 'done' ? 'var(--success)' : apt.status === 'error' ? 'var(--danger)' : 'var(--text-muted)';
            html += `<div style="margin-left: 12px; color: ${statusColor};" id="batch-apt-${i}">
                ${statusIcon} ${apt.startTime}: ${apt.address}
            </div>`;
        }
        if (currentRep !== null) html += '</div>';

        batchJobsList.innerHTML = html;
    }

    // Parse button click handler
    if (parseBatchBtn) {
        parseBatchBtn.addEventListener('click', () => {
            const text = batchScheduleInput?.value || '';
            if (!text.trim()) {
                alert('Please paste a schedule report first');
                return;
            }

            parsedAppointments = parseScheduleReport(text);

            if (parsedAppointments.length === 0) {
                alert('No appointments found. Make sure the format includes time ranges and addresses.');
                return;
            }

            renderParsedAppointments();
            addBatchLog(`Parsed ${parsedAppointments.length} appointments`);
        });
    }

    // Run batch automation
    if (runBatchBtn) {
        // Right-click to cancel
        runBatchBtn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (batchIsRunning) {
                batchIsCancelled = true;
                batchIsPaused = false;
                addBatchLog('Cancelling automation...', 'error');
                runBatchBtn.textContent = 'Cancelling...';
                runBatchBtn.style.background = 'var(--danger)';
            }
        });

        runBatchBtn.addEventListener('click', async () => {
            // If running, toggle pause
            if (batchIsRunning && !batchIsCancelled) {
                batchIsPaused = !batchIsPaused;
                if (batchIsPaused) {
                    runBatchBtn.textContent = 'Resume Automation';
                    runBatchBtn.style.background = 'var(--warning, #f59e0b)';
                    addBatchLog('Automation paused - click to resume', 'info');
                } else {
                    runBatchBtn.textContent = 'Pause Automation';
                    runBatchBtn.style.background = 'var(--warning, #f59e0b)';
                    addBatchLog('Resuming automation...', 'info');
                }
                return;
            }

            if (parsedAppointments.length === 0) {
                alert('No appointments to process');
                return;
            }

            // Reset state
            batchIsPaused = false;
            batchIsCancelled = false;
            batchIsRunning = true;

            clearBatchLog();
            addBatchLog('Starting batch automation... (right-click to cancel)');
            runBatchBtn.textContent = 'Pause Automation';
            runBatchBtn.style.background = 'var(--warning, #f59e0b)';

            // Get the calendar tab in target window only
            const calQueryOpts = { url: "*://app.roofr.com/*/calendar*" };
            if (window.__targetWindowId) calQueryOpts.windowId = window.__targetWindowId;
            const calendarTabs = await chrome.tabs.query(calQueryOpts);
            if (calendarTabs.length === 0) {
                addBatchLog('ERROR: Please open the Roofr calendar first', 'error');
                // Reset button state on error
                batchIsRunning = false;
                runBatchBtn.textContent = 'Run Batch Automation';
                runBatchBtn.style.background = '';
                runBatchBtn.disabled = false;
                return;
            }

            const calendarTab = calendarTabs[0];
            addBatchLog(`Found calendar tab: ${calendarTab.id}`);

            // Create a "Reports" tab group and add the calendar tab to it
            let reportsGroupId = null;
            try {
                // Check if calendar tab is already in a group
                const calTabInfo = await chrome.tabs.get(calendarTab.id);
                if (calTabInfo.groupId && calTabInfo.groupId !== -1) {
                    // Already in a group - update its title to "Reports"
                    reportsGroupId = calTabInfo.groupId;
                    await chrome.tabGroups.update(reportsGroupId, {
                        title: 'Reports',
                        color: 'purple',
                        collapsed: false
                    });
                    addBatchLog('Updated existing tab group to "Reports"');
                } else {
                    // Create a new tab group with the calendar tab
                    reportsGroupId = await chrome.tabs.group({ tabIds: [calendarTab.id] });
                    await chrome.tabGroups.update(reportsGroupId, {
                        title: 'Reports',
                        color: 'purple',
                        collapsed: false
                    });
                    addBatchLog('Created "Reports" tab group');
                }
            } catch (groupError) {
                console.warn('[Batch] Could not create/update tab group:', groupError);
                addBatchLog('Note: Could not create tab group', 'info');
            }

            for (let i = 0; i < parsedAppointments.length; i++) {
                // Check if cancelled
                if (batchIsCancelled) {
                    addBatchLog('Automation cancelled by user', 'error');
                    break;
                }

                // Check if paused - wait until resumed
                while (batchIsPaused && !batchIsCancelled) {
                    await new Promise(r => setTimeout(r, 500));
                }
                if (batchIsCancelled) {
                    addBatchLog('Automation cancelled by user', 'error');
                    break;
                }

                const apt = parsedAppointments[i];
                updateBatchProgress(i + 1, parsedAppointments.length, `Processing: ${apt.address}`);
                addBatchLog(`\n--- Processing appointment ${i + 1}/${parsedAppointments.length} ---`);
                addBatchLog(`Rep: ${apt.rep}, Time: ${apt.startTime}, Address: ${apt.address}`);

                try {
                    // Step 1: Find and click the calendar event (runs in background - no tab activation)
                    addBatchLog('Step 1: Finding calendar event...');

                    // On first appointment, give extra time for page and scripts to be ready
                    if (i === 0) {
                        await new Promise(r => setTimeout(r, 2000));
                    } else {
                        await new Promise(r => setTimeout(r, 500));
                    }

                    // Send message to find and click the event (works on inactive tabs)
                    const findResult = await sendMessageToTab(calendarTab.id, {
                        type: 'BATCH_FIND_EVENT',
                        address: apt.address,
                        time: apt.startTime
                    });

                    if (!findResult || !findResult.ok) {
                        throw new Error(findResult?.error || 'Could not find calendar event');
                    }
                    addBatchLog('Found event, opening popup...');

                    // Wait for popup to fully load - extra time on first appointment
                    const popupWait = i === 0 ? 6000 : 4000;
                    await new Promise(r => setTimeout(r, popupWait));

                    // Step 2: Click the address to open job in new tab (runs in background)
                    addBatchLog('Step 2: Opening job in new tab...');
                    const openResult = await sendMessageToTab(calendarTab.id, {
                        type: 'BATCH_OPEN_JOB',
                        address: apt.address
                    });

                    if (!openResult || !openResult.ok) {
                        throw new Error(openResult?.error || 'Could not open job');
                    }

                    // Find the job tab - either we got the ID directly, or we need to look it up
                    let jobTabId = openResult.tabId;

                    if (!jobTabId || openResult.needsTabLookup) {
                        // Wait for tab to open and find it
                        await new Promise(r => setTimeout(r, 2000));

                        // Look for newly opened Roofr job tab in target window
                        const jobQueryOpts = { url: "*://app.roofr.com/*/jobs*" };
                        if (window.__targetWindowId) jobQueryOpts.windowId = window.__targetWindowId;
                        const jobTabs = await chrome.tabs.query(jobQueryOpts);
                        const recentJobTab = jobTabs.find(t => t.id !== calendarTab.id);

                        if (recentJobTab) {
                            jobTabId = recentJobTab.id;
                            addBatchLog(`Found job tab: ${jobTabId}`);
                        } else {
                            throw new Error('Could not find the opened job tab');
                        }
                    } else {
                        addBatchLog(`Job opened in tab ${jobTabId}`);
                    }

                    // Job tab opened in background (no focus stealing)
                    addBatchLog('Step 3: Job opened in new tab (running in background)');

                    // Add job tab to the Reports tab group
                    if (reportsGroupId) {
                        try {
                            await chrome.tabs.group({ tabIds: [jobTabId], groupId: reportsGroupId });
                            addBatchLog('Added job tab to Reports group');
                        } catch (groupErr) {
                            console.warn('[Batch] Could not add job tab to group:', groupErr);
                        }
                    }

                    // Brief wait before next step
                    await new Promise(r => setTimeout(r, 1000));

                    // Step 4: Edit the calendar event (runs in background)
                    addBatchLog('Step 4: Adding rep to calendar event...');
                    await new Promise(r => setTimeout(r, 500));

                    // Find the event again and click Edit
                    const editResult = await sendMessageToTab(calendarTab.id, {
                        type: 'BATCH_EDIT_EVENT',
                        address: apt.address,
                        time: apt.startTime,
                        repName: apt.rep
                    });

                    if (!editResult || !editResult.ok) {
                        addBatchLog(`Warning: Could not edit event - ${editResult?.error || 'unknown'}`, 'error');
                    } else {
                        addBatchLog('Rep added to calendar event', 'success');
                    }

                    apt.status = 'done';
                    addBatchLog(`✓ Appointment ${i + 1} completed`, 'success');

                } catch (error) {
                    addBatchLog(`ERROR: ${error.message}`, 'error');
                    apt.status = 'error';

                    // Close any open popup/modal before moving to next appointment
                    try {
                        await sendMessageToTab(calendarTab.id, { type: 'BATCH_CLOSE_POPUP' });
                    } catch (e) {
                        // Ignore errors closing popup
                    }
                }

                renderParsedAppointments();

                // Wait between appointments
                if (i < parsedAppointments.length - 1) {
                    addBatchLog('Waiting before next appointment...');
                    await new Promise(r => setTimeout(r, 2000));
                }
            }

            updateBatchProgress(parsedAppointments.length, parsedAppointments.length,
                batchIsCancelled ? 'Batch cancelled' : 'Batch processing complete!');
            addBatchLog(batchIsCancelled ? '\n=== Batch cancelled ===' : '\n=== Batch processing finished ===',
                batchIsCancelled ? 'error' : 'success');

            // Reset button state
            batchIsRunning = false;
            batchIsPaused = false;
            batchIsCancelled = false;
            runBatchBtn.textContent = 'Run Batch Automation';
            runBatchBtn.style.background = '';
            runBatchBtn.disabled = false;
        });
    }

    // Click handler to expand batch logs
    if (batchLog) {
        batchLog.addEventListener('click', () => {
            const modal = document.getElementById('batch-logs-modal');
            if (modal) {
                modal.classList.remove('hidden');
                // Sync content to modal
                const logContent = document.getElementById('batch-log-content');
                const modalContent = document.getElementById('batch-logs-modal-content');
                if (logContent && modalContent) {
                    modalContent.innerHTML = logContent.innerHTML;
                    modalContent.scrollTop = modalContent.scrollHeight;
                }
            }
        });
    }

    // Batch logs modal controls
    const batchLogsModal = document.getElementById('batch-logs-modal');
    const closeBatchLogsModal = document.getElementById('close-batch-logs-modal');
    const copyBatchLogs = document.getElementById('copy-batch-logs');
    const clearBatchLogsBtn = document.getElementById('clear-batch-logs');

    if (closeBatchLogsModal) {
        closeBatchLogsModal.addEventListener('click', () => {
            if (batchLogsModal) batchLogsModal.classList.add('hidden');
        });
    }

    if (batchLogsModal) {
        batchLogsModal.addEventListener('click', (e) => {
            if (e.target === batchLogsModal) {
                batchLogsModal.classList.add('hidden');
            }
        });
    }

    if (copyBatchLogs) {
        copyBatchLogs.addEventListener('click', () => {
            const modalContent = document.getElementById('batch-logs-modal-content');
            if (modalContent) {
                const text = modalContent.innerText || modalContent.textContent;
                navigator.clipboard.writeText(text).then(() => {
                    copyBatchLogs.textContent = 'Copied!';
                    setTimeout(() => { copyBatchLogs.textContent = 'Copy Logs'; }, 1500);
                });
            }
        });
    }

    if (clearBatchLogsBtn) {
        clearBatchLogsBtn.addEventListener('click', () => {
            clearBatchLog();
            if (batchLogsModal) batchLogsModal.classList.add('hidden');
        });
    }

    // Helper to send message to a specific tab (with auto-injection)
    async function sendMessageToTab(tabId, message) {
        const injectAndRetry = async () => {
            addBatchLog("Injecting content script...");
            try {
                // Clear the flag so the script re-initializes
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => { window.__roofrJobAutomationLoaded = false; }
                });
                // Inject the content script
                await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
                await new Promise(r => setTimeout(r, 1000)); // Wait for script to initialize
                const response = await chrome.tabs.sendMessage(tabId, message);
                return response || { ok: false, error: 'No response after injection' };
            } catch (retryError) {
                console.error('[Batch] Injection failed:', retryError);
                return { ok: false, error: `Failed to inject script: ${retryError.message}` };
            }
        };

        try {
            const response = await chrome.tabs.sendMessage(tabId, message);
            if (response) {
                return response;
            }
            // Got null/undefined response - try injecting
            console.log('[Batch] No response, attempting injection');
            return await injectAndRetry();
        } catch (e) {
            console.log('[Batch] Send message error:', e.message);
            if (e.message && (e.message.includes('Receiving end does not exist') || e.message.includes('Could not establish connection'))) {
                // Content script not loaded, inject it and retry
                return await injectAndRetry();
            }
            return { ok: false, error: e.message };
        }
    }

    // ========================================
    // END REPORTS AUTOMATION SECTION
    // ========================================

    // ========================================
    // CALLRAIL TOGGLE SECTION
    // ========================================

    // Nickname mappings for CSR name matching
    const NICKNAME_MAP = {
        'madison': ['madi', 'maddie', 'maddy'],
        'madi': ['madison'],
        'maddie': ['madison'],
        'maddy': ['madison'],
        'bronte': ['bronté'],
        'bronté': ['bronte'],
        'robert': ['rob', 'bob', 'bobby'],
        'michael': ['mike', 'mikey'],
        'mike': ['michael'],
        'christopher': ['chris'],
        'chris': ['christopher'],
        'jennifer': ['jen', 'jenny'],
        'elizabeth': ['liz', 'beth', 'lizzy'],
        'katherine': ['kate', 'katie', 'kathy'],
        'nicholas': ['nick', 'nicky'],
        'nick': ['nicholas'],
        'alexander': ['alex'],
        'alex': ['alexander', 'alexandra'],
        'benjamin': ['ben'],
        'ben': ['benjamin'],
        'daniel': ['dan', 'danny'],
        'matthew': ['matt'],
        'matt': ['matthew'],
        'anthony': ['tony'],
        'joseph': ['joe', 'joey'],
        'joshua': ['josh'],
        'josh': ['joshua'],
        'andrew': ['andy', 'drew'],
        'timothy': ['tim', 'timmy'],
        'steven': ['steve'],
        'steve': ['steven', 'stephen'],
        'jonathan': ['jon'],
        'jessica': ['jess', 'jessie'],
        'samantha': ['sam', 'sammy'],
        'sam': ['samantha', 'samuel'],
        'rebecca': ['becca', 'becky'],
        'travis': ['trav'],
        'trav': ['travis']
    };

    // Remove accents from characters (Bronté → Bronte)
    function removeAccents(str) {
        return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    // Check if two names match (including nickname variations)
    function csrNamesMatch(name1, name2) {
        if (!name1 || !name2) return false;

        const n1 = removeAccents(name1.toLowerCase().trim());
        const n2 = removeAccents(name2.toLowerCase().trim());

        // Direct match
        if (n1 === n2) return true;

        // Check if one contains the other
        if (n1.includes(n2) || n2.includes(n1)) return true;

        // Split into parts
        const parts1 = n1.split(' ').filter(p => p.length > 1);
        const parts2 = n2.split(' ').filter(p => p.length > 1);

        // Check nickname mappings for first names
        if (parts1.length >= 1 && parts2.length >= 1) {
            const firstName1 = parts1[0];
            const firstName2 = parts2[0];
            const lastName1 = parts1.length > 1 ? parts1[parts1.length - 1] : '';
            const lastName2 = parts2.length > 1 ? parts2[parts2.length - 1] : '';

            // Check if first names are nickname variations
            const nicknames1 = NICKNAME_MAP[firstName1] || [];
            const nicknames2 = NICKNAME_MAP[firstName2] || [];
            const firstNamesMatch = firstName1 === firstName2 ||
                                   nicknames1.includes(firstName2) ||
                                   nicknames2.includes(firstName1) ||
                                   firstName1.includes(firstName2) ||
                                   firstName2.includes(firstName1);

            // If last names match (or one is missing) and first names match
            if (firstNamesMatch && (!lastName1 || !lastName2 || lastName1 === lastName2)) {
                return true;
            }
        }

        // Check if any parts match
        const allPartsMatch = parts1.some(part =>
            parts2.some(p2 => {
                const nicknames = NICKNAME_MAP[part] || [];
                return part === p2 || p2.includes(part) || part.includes(p2) ||
                       nicknames.includes(p2) || (NICKNAME_MAP[p2] || []).includes(part);
            })
        );

        return allPartsMatch;
    }

    const callrailToggle = document.getElementById('callrail-toggle');
    const callrailCsrModal = document.getElementById('callrail-csr-modal');
    const callrailCsrSelect = document.getElementById('callrail-csr-select');
    const callrailProductionSelect = document.getElementById('callrail-production-select');
    const callrailMgmtSelect = document.getElementById('callrail-mgmt-select');
    const callrailInsuranceSelect = document.getElementById('callrail-insurance-select');
    const callrailCsrConfirm = document.getElementById('callrail-csr-confirm');
    const callrailCsrCancel = document.getElementById('callrail-csr-cancel');
    const closeCallrailCsrModal = document.getElementById('close-callrail-csr-modal');

    // Populate all CallRail dropdowns
    function populateCallRailDropdowns() {
        // Populate CSR dropdown
        if (callrailCsrSelect) {
            callrailCsrSelect.innerHTML = '<option value="">-- Select CSR --</option>';
            const csrs = PEOPLE_DATA.CSRS || [];
            csrs.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                callrailCsrSelect.appendChild(opt);
            });
        }

        // Populate Production dropdown
        if (callrailProductionSelect) {
            callrailProductionSelect.innerHTML = '<option value="">-- Select Production --</option>';
            const production = PEOPLE_DATA.PRODUCTION || [];
            production.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                callrailProductionSelect.appendChild(opt);
            });
        }

        // Populate Management dropdown
        if (callrailMgmtSelect) {
            callrailMgmtSelect.innerHTML = '<option value="">-- Select Management --</option>';
            const mgmt = PEOPLE_DATA.MGMT || [];
            mgmt.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                callrailMgmtSelect.appendChild(opt);
            });
        }

        // Populate Insurance dropdown
        if (callrailInsuranceSelect) {
            callrailInsuranceSelect.innerHTML = '<option value="">-- Select Insurance --</option>';
            const insurance = ['Aaron Munz', 'Caite Bonomo'];
            insurance.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                callrailInsuranceSelect.appendChild(opt);
            });
        }
    }

    // Clear other dropdowns when one is selected
    function setupCallRailDropdownListeners() {
        if (callrailCsrSelect) {
            callrailCsrSelect.addEventListener('change', () => {
                if (callrailCsrSelect.value) {
                    if (callrailProductionSelect) callrailProductionSelect.value = '';
                    if (callrailMgmtSelect) callrailMgmtSelect.value = '';
                    if (callrailInsuranceSelect) callrailInsuranceSelect.value = '';
                }
            });
        }
        if (callrailProductionSelect) {
            callrailProductionSelect.addEventListener('change', () => {
                if (callrailProductionSelect.value) {
                    if (callrailCsrSelect) callrailCsrSelect.value = '';
                    if (callrailMgmtSelect) callrailMgmtSelect.value = '';
                    if (callrailInsuranceSelect) callrailInsuranceSelect.value = '';
                }
            });
        }
        if (callrailMgmtSelect) {
            callrailMgmtSelect.addEventListener('change', () => {
                if (callrailMgmtSelect.value) {
                    if (callrailCsrSelect) callrailCsrSelect.value = '';
                    if (callrailProductionSelect) callrailProductionSelect.value = '';
                    if (callrailInsuranceSelect) callrailInsuranceSelect.value = '';
                }
            });
        }
        if (callrailInsuranceSelect) {
            callrailInsuranceSelect.addEventListener('change', () => {
                if (callrailInsuranceSelect.value) {
                    if (callrailCsrSelect) callrailCsrSelect.value = '';
                    if (callrailProductionSelect) callrailProductionSelect.value = '';
                    if (callrailMgmtSelect) callrailMgmtSelect.value = '';
                }
            });
        }
    }

    // Get selected person from any dropdown
    function getSelectedCallHandler() {
        if (callrailCsrSelect?.value) return callrailCsrSelect.value;
        if (callrailProductionSelect?.value) return callrailProductionSelect.value;
        if (callrailMgmtSelect?.value) return callrailMgmtSelect.value;
        if (callrailInsuranceSelect?.value) return callrailInsuranceSelect.value;
        return '';
    }

    // Show CSR modal
    function showCallRailCsrModal() {
        if (!callrailCsrModal) return;
        populateCallRailDropdowns();
        setupCallRailDropdownListeners();
        callrailCsrModal.classList.remove('hidden');
    }

    // Hide CSR modal
    function hideCallRailCsrModal() {
        if (!callrailCsrModal) return;
        callrailCsrModal.classList.add('hidden');
    }

    // Initialize CallRail toggle state from storage
    async function initCallRailToggle() {
        if (!callrailToggle) return;

        try {
            // Get CSR from popup modal, settings page user, or settings page display name
            const result = await chrome.storage.sync.get({
                callrail_enabled: false,
                callrail_csr: '',
                callrail_user: '',
                callrail_display_name: ''
            });
            callrailToggle.checked = result.callrail_enabled;
            // Update the display to show who's taking calls - prefer popup selection, fallback to settings
            const csrName = result.callrail_csr || result.callrail_display_name || result.callrail_user;
            if (result.callrail_enabled && csrName) {
                updateAssignedRepDisplay(csrName);
            } else {
                updateAssignedRepDisplay(null);
            }
        } catch (e) {
            console.warn('Could not load CallRail setting:', e);
            callrailToggle.checked = false; // Default to disabled
            updateAssignedRepDisplay(null);
        }
    }

    // Open/pin CallRail Lead Center in target window and optionally reload
    async function openCallRailLeadCenter(shouldReload = false) {
        const CALLRAIL_URL = 'https://app.callrail.com/lead-center/a/629065099/agent-tool/dialer/call?company_id=459564228';

        try {
            // Search for CallRail tabs in target window only
            const queryOpts = { url: '*://app.callrail.com/*' };
            if (window.__targetWindowId) queryOpts.windowId = window.__targetWindowId;
            const tabs = await chrome.tabs.query(queryOpts);
            const leadCenterTab = tabs.find(t => t.url && t.url.includes('/lead-center'));

            if (leadCenterTab) {
                // Lead Center is already open
                if (!leadCenterTab.pinned) {
                    await chrome.tabs.update(leadCenterTab.id, { pinned: true });
                    console.log('[Popup] Pinned existing CallRail Lead Center tab:', leadCenterTab.id);
                }
                if (shouldReload) {
                    await chrome.tabs.reload(leadCenterTab.id);
                    console.log('[Popup] Reloaded CallRail Lead Center tab:', leadCenterTab.id);
                }
            } else if (tabs.length > 0) {
                // CallRail is open but not Lead Center - navigate to Lead Center
                await chrome.tabs.update(tabs[0].id, { url: CALLRAIL_URL, pinned: true });
                console.log('[Popup] Navigated to Lead Center and pinned tab:', tabs[0].id);
            } else {
                // No CallRail tab open - create one in target window and pin it
                const createOpts = { url: CALLRAIL_URL, active: false, pinned: true };
                if (window.__targetWindowId) createOpts.windowId = window.__targetWindowId;
                const newTab = await chrome.tabs.create(createOpts);
                console.log('[Popup] Opened and pinned CallRail Lead Center tab:', newTab.id);
            }
        } catch (err) {
            console.error('Could not open/pin CallRail tab:', err);
        }
    }

    // Handle CallRail toggle change
    if (callrailToggle) {
        callrailToggle.addEventListener('change', async (e) => {
            const enabled = e.target.checked;

            if (enabled) {
                // Check if a CSR is already selected
                try {
                    const result = await chrome.storage.sync.get({ callrail_csr: '' });
                    if (!result.callrail_csr) {
                        // No CSR selected - show modal
                        // Don't save enabled state yet - wait for CSR selection
                        e.target.checked = false; // Revert toggle
                        showCallRailCsrModal();
                        return;
                    }

                    // CSR is selected - proceed with enabling
                    await chrome.storage.sync.set({ callrail_enabled: true });
                    console.log('[Popup] CallRail auto-search: enabled for', result.callrail_csr);
                    // Update the display to show who's taking calls
                    updateAssignedRepDisplay(result.callrail_csr);
                    await openCallRailLeadCenter(false);

                    // Check if the selected CSR is already on an active call and open that contact
                    const selectedCsr = result.callrail_csr;
                    try {
                        const calls = await fetchActiveCalls();
                        if (calls.length > 0) {
                            // Find calls handled by the selected CSR (using nickname-aware matching)
                            const csrCalls = calls.filter(call => {
                                if (!call.agentName) return false;
                                return csrNamesMatch(call.agentName, selectedCsr);
                            });

                            if (csrCalls.length > 0) {
                                console.log('[Popup] Found active call(s) for', selectedCsr, ':', csrCalls);
                                for (const call of csrCalls) {
                                    try {
                                        await chrome.runtime.sendMessage({
                                            type: 'OPEN_CONTACTS_FOR_PHONE',
                                            phoneNumber: call.phoneNumber,
                                            formattedPhone: call.formattedPhone,
                                            callerName: call.callerName,
                                            windowId: window.__targetWindowId // Pass target window for window isolation
                                        });
                                        showToast(`Opened contact for ${call.callerName || call.formattedPhone}`);
                                    } catch (err) {
                                        console.error('[Popup] Error opening contact for CSR call:', err);
                                    }
                                }
                            }
                        }
                    } catch (callErr) {
                        console.error('[Popup] Error checking for active CSR calls:', callErr);
                    }
                } catch (err) {
                    console.error('Could not check/save CallRail setting:', err);
                }
            } else {
                // Turning OFF - save setting but KEEP the CSR selection for next time
                try {
                    await chrome.storage.sync.set({ callrail_enabled: false });
                    console.log('[Popup] CallRail auto-search: disabled (CSR selection preserved)');
                    // Clear the display (CSR still saved, just not shown while disabled)
                    updateAssignedRepDisplay(null);
                } catch (err) {
                    console.error('Could not save CallRail setting:', err);
                }
            }
        });
    }

    // Handle CSR confirmation
    if (callrailCsrConfirm) {
        callrailCsrConfirm.addEventListener('click', async () => {
            const selectedPerson = getSelectedCallHandler();

            if (!selectedPerson) {
                // No person selected - show error state on all dropdowns briefly
                const dropdowns = [callrailCsrSelect, callrailProductionSelect, callrailMgmtSelect, callrailInsuranceSelect];
                dropdowns.forEach(select => {
                    if (select) {
                        select.style.borderColor = 'var(--danger)';
                        setTimeout(() => {
                            select.style.borderColor = '';
                        }, 2000);
                    }
                });
                return;
            }

            try {
                // Save selected person and enable CallRail
                await chrome.storage.sync.set({
                    callrail_enabled: true,
                    callrail_csr: selectedPerson
                });
                console.log('[Popup] CallRail enabled for:', selectedPerson);

                // Update toggle state
                if (callrailToggle) {
                    callrailToggle.checked = true;
                }

                // Update the display to show who's taking calls
                updateAssignedRepDisplay(selectedPerson);

                // Hide modal
                hideCallRailCsrModal();

                // Open/reload CallRail Lead Center
                await openCallRailLeadCenter(true);

                // Check if the selected CSR is already on an active call and open that contact
                try {
                    const calls = await fetchActiveCalls();
                    if (calls.length > 0) {
                        // Find calls handled by the selected CSR (using nickname-aware matching)
                        const csrCalls = calls.filter(call => {
                            if (!call.agentName) return false;
                            return csrNamesMatch(call.agentName, selectedPerson);
                        });

                        if (csrCalls.length > 0) {
                            console.log('[Popup] Found active call(s) for', selectedPerson, ':', csrCalls);
                            // Open contact for the CSR's active call
                            for (const call of csrCalls) {
                                try {
                                    await chrome.runtime.sendMessage({
                                        type: 'OPEN_CONTACTS_FOR_PHONE',
                                        phoneNumber: call.phoneNumber,
                                        formattedPhone: call.formattedPhone,
                                        callerName: call.callerName,
                                        windowId: window.__targetWindowId // Pass target window for window isolation
                                    });
                                    showToast(`Opened contact for ${call.callerName || call.formattedPhone}`);
                                } catch (err) {
                                    console.error('[Popup] Error opening contact for CSR call:', err);
                                }
                            }
                        } else {
                            console.log('[Popup] No active calls for', selectedPerson);
                        }
                    }
                } catch (err) {
                    console.error('[Popup] Error checking for active CSR calls:', err);
                }

            } catch (err) {
                console.error('Could not save CallRail CSR setting:', err);
            }
        });
    }

    // Handle CSR cancel
    if (callrailCsrCancel) {
        callrailCsrCancel.addEventListener('click', () => {
            hideCallRailCsrModal();
            // Make sure toggle stays off
            if (callrailToggle) {
                callrailToggle.checked = false;
            }
        });
    }

    // Handle modal close button
    if (closeCallrailCsrModal) {
        closeCallrailCsrModal.addEventListener('click', () => {
            hideCallRailCsrModal();
            // Make sure toggle stays off
            if (callrailToggle) {
                callrailToggle.checked = false;
            }
        });
    }

    // Close modal on backdrop click
    if (callrailCsrModal) {
        callrailCsrModal.addEventListener('click', (e) => {
            if (e.target === callrailCsrModal) {
                hideCallRailCsrModal();
                if (callrailToggle) {
                    callrailToggle.checked = false;
                }
            }
        });
    }

    // Initialize toggle on load
    initCallRailToggle();

    // ========================================
    // END CALLRAIL TOGGLE SECTION
    // ========================================

    // ========================================
    // PHONE ICON - OPEN CONTACTS FOR ACTIVE CALLS
    // ========================================

    // Fetch active calls from CallRail tabs in target window
    async function fetchActiveCalls() {
        try {
            // Find CallRail tabs in target window only
            const queryOpts = { url: '*://app.callrail.com/*' };
            if (window.__targetWindowId) queryOpts.windowId = window.__targetWindowId;
            const callrailTabs = await chrome.tabs.query(queryOpts);
            if (callrailTabs.length === 0) {
                return [];
            }

            // Try to get active calls from each tab
            for (const tab of callrailTabs) {
                try {
                    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_ACTIVE_CALLS' });
                    if (response && response.ok && response.calls) {
                        return response.calls;
                    }
                } catch (e) {
                    // Tab might not have content script loaded
                    console.log('[Popup] Could not get active calls from tab', tab.id);
                }
            }
            return [];
        } catch (e) {
            console.warn('[Popup] Error fetching active calls:', e);
            return [];
        }
    }

    // Active Calls Dropdown
    const activeCallsDropdown = document.getElementById('activeCallsDropdown');
    const activeCallsList = document.getElementById('activeCallsList');
    const activeCallsBadge = document.getElementById('activeCallsBadge');

    // Move dropdown to body to escape stacking context issues
    if (activeCallsDropdown && activeCallsDropdown.parentElement !== document.body) {
        document.body.appendChild(activeCallsDropdown);
    }

    // Track active calls for auto-update
    let lastActiveCallsCount = 0;
    let activeCallsPollingInterval = null;

    // Update badge with call count
    function updateActiveCallsBadge(count) {
        if (!activeCallsBadge) return;
        if (count > 0) {
            activeCallsBadge.textContent = count > 9 ? '9+' : count;
            activeCallsBadge.style.display = 'flex';
            // Add pulsing animation for new calls
            if (count > lastActiveCallsCount) {
                activeCallsBadge.style.animation = 'pulse 0.5s ease-in-out 3';
                setTimeout(() => {
                    if (activeCallsBadge) activeCallsBadge.style.animation = '';
                }, 1500);
            }
        } else {
            activeCallsBadge.style.display = 'none';
        }
        lastActiveCallsCount = count;
    }

    // Poll for active calls and update badge
    async function pollActiveCalls() {
        try {
            const calls = await fetchActiveCalls();
            updateActiveCallsBadge(calls.length);

            // If dropdown is open, update the list too
            if (activeCallsDropdown && activeCallsDropdown.style.display !== 'none') {
                updateActiveCallsList(calls);
            }
        } catch (e) {
            console.log('[Popup] Error polling active calls:', e);
        }
    }

    // Update the dropdown list with calls
    function updateActiveCallsList(calls) {
        if (!activeCallsList) return;

        if (calls.length === 0) {
            activeCallsList.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--muted);">No active calls</div>';
            return;
        }

        activeCallsList.innerHTML = calls.map(call => `
            <div class="active-call-item"
                 data-phone="${call.phoneNumber}"
                 data-formatted="${call.formattedPhone || ''}"
                 data-caller="${call.callerName || ''}"
                 style="padding: 10px 12px; cursor: pointer; border-bottom: 1px solid var(--border); transition: background 0.15s;">
                <div style="font-weight: 500;">${call.callerName || 'Unknown Caller'}</div>
                <div style="font-size: 12px; color: var(--muted); display: flex; justify-content: space-between;">
                    <span>${call.formattedPhone || call.phoneNumber}</span>
                    <span style="color: #22c55e; font-weight: 500;">${call.timer || ''}</span>
                </div>
                ${call.agentName ? `<div style="font-size: 11px; color: var(--muted); margin-top: 2px;">Rep: ${call.agentName}</div>` : ''}
            </div>
        `).join('');

        // Re-attach click handlers
        activeCallsList.querySelectorAll('.active-call-item').forEach(item => {
            item.addEventListener('mouseenter', () => {
                item.style.background = 'var(--hover)';
            });
            item.addEventListener('mouseleave', () => {
                item.style.background = '';
            });
            item.addEventListener('click', async () => {
                const phone = item.dataset.phone;
                const formatted = item.dataset.formatted;
                const callerName = item.dataset.caller;

                if (phone) {
                    hideActiveCallsDropdown();
                    showToast(`Opening contacts for ${formatted || phone}...`);

                    try {
                        await chrome.runtime.sendMessage({
                            type: 'OPEN_CONTACTS_FOR_PHONE',
                            phoneNumber: phone,
                            formattedPhone: formatted || phone,
                            callerName: callerName || '',
                            windowId: window.__targetWindowId
                        });
                    } catch (err) {
                        console.error('[Popup] Error opening contacts:', err);
                        showToast('Error opening contacts');
                    }
                }
            });
        });
    }

    // Start polling when popup opens
    function startActiveCallsPolling() {
        // Initial poll
        pollActiveCalls();
        // Poll every 2 seconds
        if (activeCallsPollingInterval) clearInterval(activeCallsPollingInterval);
        activeCallsPollingInterval = setInterval(pollActiveCalls, 2000);
    }

    // Stop polling when popup closes
    function stopActiveCallsPolling() {
        if (activeCallsPollingInterval) {
            clearInterval(activeCallsPollingInterval);
            activeCallsPollingInterval = null;
        }
    }

    // Start polling immediately
    startActiveCallsPolling();

    // Toggle dropdown visibility
    function toggleActiveCallsDropdown() {
        if (activeCallsDropdown.style.display === 'none') {
            showActiveCallsDropdown();
        } else {
            hideActiveCallsDropdown();
        }
    }

    // Show dropdown and populate with calls
    async function showActiveCallsDropdown() {
        // Position dropdown using fixed positioning - centered in popup
        if (openActiveCallsBtn) {
            const btnRect = openActiveCallsBtn.getBoundingClientRect();
            const popupWidth = document.body.clientWidth || 400;
            const dropdownWidth = 240;
            activeCallsDropdown.style.top = (btnRect.bottom + 6) + 'px';
            activeCallsDropdown.style.left = Math.max(10, (popupWidth - dropdownWidth) / 2) + 'px';
            activeCallsDropdown.style.width = dropdownWidth + 'px';
        }
        activeCallsDropdown.style.display = 'block';
        activeCallsList.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--muted);">Loading...</div>';

        try {
            const calls = await fetchActiveCalls();

            if (calls.length === 0) {
                activeCallsList.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--muted);">No active calls</div>';
                return;
            }

            // Build the list of calls
            activeCallsList.innerHTML = calls.map(call => `
                <div class="active-call-item"
                     data-phone="${call.phoneNumber}"
                     data-formatted="${call.formattedPhone || ''}"
                     data-caller="${call.callerName || ''}"
                     data-csr="${call.agentName || ''}"
                     style="padding: 10px 12px; cursor: pointer; border-bottom: 1px solid var(--border); transition: background 0.15s;">
                    <div style="font-weight: 500; color: var(--text);">${call.callerName || 'Unknown Caller'}</div>
                    <div style="font-size: 12px; color: var(--muted); display: flex; justify-content: space-between; margin-top: 2px;">
                        <span>${call.formattedPhone || call.phoneNumber}</span>
                        <span style="color: var(--success);">${call.timer || ''}</span>
                    </div>
                    ${call.agentName ? `<div style="font-size: 11px; color: var(--muted); margin-top: 2px;">CSR: ${call.agentName}</div>` : ''}
                </div>
            `).join('');

            // Add click handlers to each call item
            activeCallsList.querySelectorAll('.active-call-item').forEach(item => {
                item.addEventListener('mouseenter', () => {
                    item.style.background = 'var(--hover)';
                });
                item.addEventListener('mouseleave', () => {
                    item.style.background = '';
                });
                item.addEventListener('click', async () => {
                    const phoneNumber = item.dataset.phone;
                    const formattedPhone = item.dataset.formatted;
                    const callerName = item.dataset.caller;

                    // Show loading state
                    item.style.opacity = '0.6';
                    item.style.pointerEvents = 'none';

                    try {
                        const response = await chrome.runtime.sendMessage({
                            type: 'OPEN_CONTACTS_FOR_PHONE',
                            phoneNumber: phoneNumber,
                            formattedPhone: formattedPhone,
                            callerName: callerName,
                            windowId: window.__targetWindowId // Pass target window for window isolation
                        });

                        if (response && response.ok) {
                            showToast('Contact opened');
                            hideActiveCallsDropdown();
                            // Try to fetch job owner after contact loads
                            setTimeout(async () => {
                                try {
                                    // Query Roofr tabs in target window to get job info
                                    const queryOpts = { url: '*://app.roofr.com/*' };
                                    if (window.__targetWindowId) queryOpts.windowId = window.__targetWindowId;
                                    const tabs = await chrome.tabs.query(queryOpts);
                                    // Find the active one or just use the first one
                                    const roofrTab = tabs.find(t => t.active) || tabs[0];
                                    if (roofrTab && roofrTab.url?.includes('roofr.com')) {
                                        const result = await chrome.tabs.sendMessage(roofrTab.id, { type: 'GET_JOB_INFO' });
                                        if (result?.ok && result?.info?.jobOwner) {
                                            updateAssignedRepDisplay(result.info.jobOwner);
                                        }
                                    }
                                } catch (e) {
                                    // Ignore - contact may not have loaded job yet
                                }
                            }, 2000);
                        } else {
                            showToast('Failed to open contact');
                            item.style.opacity = '1';
                            item.style.pointerEvents = '';
                        }
                    } catch (err) {
                        console.error('[Popup] Error opening contact:', err);
                        showToast('Error opening contact');
                        item.style.opacity = '1';
                        item.style.pointerEvents = '';
                    }
                });
            });
        } catch (err) {
            console.error('[Popup] Error fetching active calls:', err);
            activeCallsList.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--danger);">Error loading calls</div>';
        }
    }

    // Hide dropdown
    function hideActiveCallsDropdown() {
        activeCallsDropdown.style.display = 'none';
    }

    // Phone icon click handler - shows dropdown
    if (openActiveCallsBtn) {
        openActiveCallsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleActiveCallsDropdown();
        });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (activeCallsDropdown && activeCallsDropdown.style.display !== 'none') {
            if (!activeCallsDropdown.contains(e.target) && e.target !== openActiveCallsBtn) {
                hideActiveCallsDropdown();
            }
        }
    });

    // ========================================
    // END PHONE ICON SECTION
    // ========================================

    init();

});
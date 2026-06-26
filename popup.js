

import { CONFIG, PEOPLE_DATA } from './config.js';
import { THEMES, applyTheme } from './themes.js';

const SLOT_HOLDS_URL = 'https://roofr-search.vercel.app/api/slot-holds';
const SLOT_HOLDS_INTERNAL_KEY = 'WSDnmjsudtcCEWvb_TKQKcyWS3TXtcjWqfuLMsnmT96XfqZF';
const slotHolds = new Map();
const slotHoldHeartbeats = new Map();
const holdBookingBaseline = new Map(); // hold.id -> real-booked count in its block when first seen (mine), for auto-release when the booking lands
let currentRepIdentity = null;
let slotHoldsPollInFlight = false;
let slotHoldsPollTimer = null;
let slotCountdownTimer = null;
const expandedDays = new Set();   // dateStr of day cards the user manually expanded — persisted across re-renders
let slotHoldsSig = null;          // signature of the last holds set, to skip needless re-renders (and the collapse-reset they caused)

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
        // The extension now auto-updates via the managed/enterprise update_url,
        // so the "Update Available" banner is redundant — suppress it.
        if (updateBanner) updateBanner.style.display = 'none';
        return;

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
                    if (tab?.url?.includes('app.roofr.com') && (!window.__targetWindowId || tab.windowId === window.__targetWindowId)) {
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
            if (changeInfo.status === 'complete' && tab.url?.includes('app.roofr.com')
                && (!window.__targetWindowId || tab.windowId === window.__targetWindowId)) {
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
    const slotRepIdentitySelect = document.getElementById("slot-rep-identity-select");
    const mainTabs = Array.from(document.querySelectorAll(".nav-tab"));
    const sections = {
        "sec-scanner": document.getElementById("sec-scanner"),
        "sec-calls": document.getElementById("sec-calls"),
        "sec-reports": document.getElementById("sec-reports"),
        "sec-people": document.getElementById("sec-people"),
        "sec-clipboard": document.getElementById("sec-clipboard"),
        "sec-dialer": document.getElementById("sec-dialer"),
    };
    const regionPills = Array.from(document.querySelectorAll(".region-pill"));
    const stickyHeader = document.getElementById("sticky-header");
    const scannerToolbar = document.getElementById("scanner-toolbar");
    const recoOptions = document.getElementById("reco-options"); // Adjacent cities buttons
    const verifiedAddressesList = document.getElementById("verified-addresses-container"); // Autofill container (custom div)
    // When a search fires (Go/Enter), suppress the suggestion dropdown so an
    // in-flight (debounced) fetch from typing can't flash it back open. Cleared
    // the moment the user types again.
    let _suppressAddressSuggestions = false;

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
    const productionList = document.getElementById("productionList");
    const insuranceList = document.getElementById("insuranceList");
    const d2dList = document.getElementById("d2dList");

    // Read B6 Button
    const readB6Btn = document.getElementById("readB6Btn");
    const b6Result = document.getElementById("b6Result");

    // Clipboard
    const clipboardContainer = document.getElementById('clipboard-container');
    const addClipboardBtn = document.getElementById('add-clipboard-btn');
    const uploadClipboardBtn = document.getElementById('upload-clipboard-btn');
    const clipboardFileInput = document.getElementById('clipboard-file-input');

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
    const settingShowDialer = document.getElementById("setting-show-dialer");
    const scanProfileSelect = document.getElementById("scan-profile-select");
    const scanViewSelect = document.getElementById("scan-view-select");
    const settingScanProfile = document.getElementById("setting-scan-profile");
    const settingScanView = document.getElementById("setting-scan-view");
    const settingShowPeople = document.getElementById("setting-show-people");
    const settingShowClipboard = document.getElementById("setting-show-clipboard");
    const settingShowReports = document.getElementById("setting-show-reports");
    const settingShowNotes = document.getElementById("setting-show-notes");
    const settingShowFind = document.getElementById("setting-show-find");
    const settingShowFormatting = document.getElementById("setting-show-formatting");
    const settingShowPopupBtn = document.getElementById("setting-show-popup-btn");
    const settingShowLinks = document.getElementById("setting-show-links");

    // Idle Recommendation Modal (legacy - keeping for settings)
    const idleModal = document.getElementById("idle-modal");
    const idleDismissBtn = document.getElementById("idle-dismiss-btn");
    const idleRecoAddress = document.getElementById("idle-reco-address");
    const idleRecoBtn = document.getElementById("idle-reco-btn");
    const idlePriorityDesc = document.getElementById("idle-priority-desc");
    const idlePriorityBtns = document.querySelectorAll(".idle-priority-btn");
    const settingIdleTimeout = document.getElementById("setting-idle-timeout");
    const idleTimeoutRow = document.getElementById("idle-timeout-row");

    // Idle-popup timer. The legacy idle-recommendation modal was retired in an earlier
    // refactor, but call sites (settings handlers + init) still invoke resetIdleTimer().
    // It was never re-defined, so every load threw "ReferenceError: resetIdleTimer is not
    // defined" and aborted the tail end of init(). Define a safe version: clear any pending
    // timer. The idle popup is currently disabled, so we don't arm a new one.
    let _idleTimer = null;
    function resetIdleTimer() {
        if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
    }

    // Address Input Recommendation Modal
    const addressRecoModal = document.getElementById("address-reco-modal");
    const addressRecoInput = document.getElementById("address-reco-input");
    const addressRecoBtn = document.getElementById("address-reco-btn");
    const closeAddressRecoBtn = document.getElementById("close-address-reco-btn");
    const addressPriorityDesc = document.getElementById("address-priority-desc");
    const addressPriorityBtns = addressRecoModal ? addressRecoModal.querySelectorAll(".idle-priority-btn") : [];

    // Toast
    const toast = document.getElementById("toast");

    // Unknown City Region Selection Modal
    const unknownCityModal = document.getElementById("unknown-city-modal");
    const unknownCityName = document.getElementById("unknown-city-name");
    const unknownCityPhx = document.getElementById("unknown-city-phx");
    const unknownCityNorth = document.getElementById("unknown-city-north");
    const unknownCitySouth = document.getElementById("unknown-city-south");
    const unknownCitySkip = document.getElementById("unknown-city-skip");
    const closeUnknownCityModal = document.getElementById("close-unknown-city-modal");

    // Promise resolver for unknown city modal
    let unknownCityResolve = null;

    // Show unknown city modal and return promise with selected region (or null if skipped)
    function promptForCityRegion(cityName) {
        return new Promise((resolve) => {
            unknownCityResolve = resolve;
            if (unknownCityName) unknownCityName.textContent = cityName;
            if (unknownCityModal) unknownCityModal.classList.remove('hidden');
        });
    }

    function closeUnknownCityModalFn(selectedRegion) {
        if (unknownCityModal) unknownCityModal.classList.add('hidden');
        if (unknownCityResolve) {
            unknownCityResolve(selectedRegion);
            unknownCityResolve = null;
        }
    }

    // Unknown city modal button handlers
    if (unknownCityPhx) unknownCityPhx.addEventListener('click', () => closeUnknownCityModalFn('PHX'));
    if (unknownCityNorth) unknownCityNorth.addEventListener('click', () => closeUnknownCityModalFn('NORTH'));
    if (unknownCitySouth) unknownCitySouth.addEventListener('click', () => closeUnknownCityModalFn('SOUTH'));
    if (unknownCitySkip) unknownCitySkip.addEventListener('click', () => closeUnknownCityModalFn(null));
    if (closeUnknownCityModal) closeUnknownCityModal.addEventListener('click', () => closeUnknownCityModalFn(null));

    const AFFIRMATIONS = [
        "You got this!", "Time to raise the roof!", "Stay cool up there.", "Nailed it!", "Don't worry, it's over your head.", "Every shingle counts.", "Safety first, speed second.", "Roofing: It's a high calling.", "Keep hammering away!", "You're on top of the world!"
    ];

    /* ========= State Management ========= */
    const SHARED_STATE_KEY = 'roofr_shared_state';
    const CLIPBOARDS_KEY = 'roofr_clipboards_data';
    // Signature of the clipboards array THIS window last saved, so the
    // storage.onChanged echo of our own write doesn't trigger a full
    // renderClipboards() that would destroy the card we're typing in.
    let _lastWrittenClipboardsSig = null;
    const USER_PREFS_KEY = 'roofr_user_prefs';
    const DYNAMIC_CITIES_KEY = 'roofr_dynamic_cities';

    function addCityToRegionWhitelist(city, requestedRegion) {
        const normalizedCity = String(city || '').trim().toUpperCase();
        const region = CONFIG.getRequiredRegionForCity(normalizedCity) || requestedRegion;
        if (normalizedCity && CONFIG.REGION_CITY_WHITELISTS[region]) {
            CONFIG.REGION_CITY_WHITELISTS[region].add(normalizedCity);
        }
        return region;
    }

    // Google Sheet for cities database
    const CITIES_SHEET_ID = '1cFFEZNl7wXt40riZHnuZxGc1Zfm5lTlOz0rDCWGZJ0g';
    const CITIES_SHEET_TAB = 'Appointment Blocks'; // Tab name where cities are stored
    const CITIES_RANGE = 'A82:C200'; // PHX in A, North in B, South in C starting at row 82
    const NORTH_ROUTING_RANGE = 'A40:C45';

    let state = {
        currentRegion: "PHX",
        allEvents: [],
        parsedJobs: [],
        availability: { PHX: null, SOUTH: null, NORTH: null, ALL: null },
        availabilityByWeek: {}, // Per-week availability keyed by week's Sunday ISO (visible range can span weeks)
        weekDays: [], // This will now store the exact visible days
        addressInput: "",
        highlightedCity: null,
        recoCandidates: [],
        recoIndex: 0,
        recoGlobalIndex: 0, // Track position across ALL candidates (including fallbacks)
        recoDayIndex: 0, // Current day index for day navigation
        recoAvailableDays: [], // Array of date strings with available slots
        allCandidatesForCity: [], // All candidates before day filtering
        recoBestPerDay: {}, // Map: dateStr -> best candidate for that day (for day-based navigation)
        regionOverrides: {}, // Store overrides mapping: "Event Title + Start Time" -> "PHX" | "NORTH" | "SOUTH"
        dayCutoffs: [], // Array of booleans for Mon-Sun indicating if day is cutoff
        ignoredEvents: {}, // Store ignored uncategorized events: "Event Title + Start Time" -> true
        earliestAvailableByCity: {}, // Track earliest available date per city across weeks: { "MESA": "2025-12-27", ... }
        recentAddresses: [], // Track last 3 entered addresses/cities for quick access
        weekDataCache: {} // Cache scan data per week: { "2026-01-04": { events, availability, weekDays, timestamp } }
    };
    let clipboards = [];
    let findStats = { count: 0, index: 0 };
    let settings = {};
    let pageDatesISO = null;
    let userAddedCities = { PHX: [], NORTH: [], SOUTH: [] };
    let isNavigatingDays = false; // Flag to prevent full re-render during day navigation

    // ========= Roofr Job Database (fetched from roofr-search API) =========
    let _roofrDataCache = null;
    let _roofrDataPromise = null;
    window.__selectedRoofrJobLink = null;
    window.__selectedRoofrJob = null;
    window.__selectedRoofrJobInputValue = null;

    function _normalizeAddress(val) {
        if (!val) return '';
        return String(val).toLowerCase()
            .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\bstreet\b/g, 'st').replace(/\bavenue\b/g, 'ave')
            .replace(/\bboulevard\b/g, 'blvd').replace(/\broad\b/g, 'rd')
            .replace(/\bdrive\b/g, 'dr').replace(/\blane\b/g, 'ln')
            .replace(/\bcourt\b/g, 'ct').replace(/\bplace\b/g, 'pl')
            .replace(/\bparkway\b/g, 'pkwy').replace(/\bnorth\b/g, 'n')
            .replace(/\bsouth\b/g, 's').replace(/\beast\b/g, 'e').replace(/\bwest\b/g, 'w')
            .replace(/\s+/g, ' ').trim();
    }

    function _normalizePhone(val) { return String(val || '').replace(/\D/g, ''); }

    // Score how well a candidate address matches what the rep typed (higher = better).
    // Drives dropdown ordering so a near-exact match lands at the top instead of 4-6 down.
    function _addressMatchScore(candidate, qNorm, qStreetNorm, qHouseNum) {
        const cNorm = _normalizeAddress(candidate);
        if (!cNorm || !qStreetNorm) return 0;
        if (cNorm === qNorm) return 100;
        if (cNorm === qStreetNorm) return 95;
        // Directional guard: if the rep typed a directional (N/S/E/W after the house number) and
        // the candidate carries the OPPOSITE one, it's a different street — sink it so it can never
        // sit at or above the matching-direction result. LocationIQ returns BOTH "265 West McLellan"
        // and "265 East McLellan" for an ambiguous "265 McLellan", West first; without this they
        // score identically and West wins the tie.
        const _dirOf = (s) => { const m = s.match(/^\d+\s+(ne|nw|se|sw|[nsew])\b/); return m ? m[1] : ''; };
        const _qDir = _dirOf(qStreetNorm), _cDir = _dirOf(cNorm);
        if (_qDir && _cDir && _qDir !== _cDir) return -100;
        if (cNorm.startsWith(qStreetNorm) || qNorm.startsWith(cNorm) || qStreetNorm.startsWith(cNorm)) {
            // Same street — break ties on whatever the rep typed beyond it (city/state/zip),
            // so "123 Main St, Mesa" ranks the Mesa candidate above a Phoenix one.
            // Token-prefix match: "Mes" hits "mesa", but "az" can't hit inside "plaza".
            let s = 80;
            const extra = qNorm.length > qStreetNorm.length ? qNorm.slice(qStreetNorm.length).split(' ').filter(Boolean) : [];
            if (extra.length) {
                const cParts = cNorm.split(' ');
                const matched = extra.filter(t => cParts.some(p => p.startsWith(t))).length;
                s += Math.round(15 * matched / extra.length);
            }
            return s;
        }
        let score = 0;
        const cHouse = (cNorm.match(/^\d+/) || [''])[0];
        if (qHouseNum) {
            if (cHouse === qHouseNum) score += 40;
            else if (cHouse) score -= 30; // different house number = almost certainly the wrong property
        }
        const qTokens = qStreetNorm.split(' ').filter(t => t && t !== qHouseNum);
        if (qTokens.length) {
            const cTokens = new Set(cNorm.split(' '));
            let hit = 0;
            for (const t of qTokens) if (cTokens.has(t)) hit++;
            score += Math.round(30 * hit / qTokens.length);
        }
        return score;
    }

    function _escapeHtml(val) {
        return String(val || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _highlightMatch(text, query) {
        if (!text || !query) return _escapeHtml(text);
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return _escapeHtml(text);
        return _escapeHtml(text.slice(0, idx)) +
            `<mark>${_escapeHtml(text.slice(idx, idx + query.length))}</mark>` +
            _escapeHtml(text.slice(idx + query.length));
    }

    async function fetchRoofrData() {
        if (_roofrDataCache) return _roofrDataCache;
        if (_roofrDataPromise) return _roofrDataPromise;
        _roofrDataPromise = (async () => {
            try {
                const resp = await fetch('https://roofr-search.vercel.app/api/data', {
                    cache: 'no-store',
                    headers: { 'X-Internal-Key': 'WSDnmjsudtcCEWvb_TKQKcyWS3TXtcjWqfuLMsnmT96XfqZF' }
                });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const json = await resp.json();
                if (!json?.success || !Array.isArray(json.rows)) throw new Error('Bad payload');
                _roofrDataCache = json.rows.map(job => ({
                    ...job,
                    _nAddr: _normalizeAddress(job.Address || ''),
                    _nCust: (job.Customer || '').toLowerCase().trim(),
                    _nPhone: _normalizePhone(job.Phone || '')
                }));
                console.log(`[Roofr Data] Cached ${_roofrDataCache.length} jobs`);
                _suggestionCatalog = _buildSuggestionCatalog();
                console.log(`[Roofr Data] Catalog: ${_suggestionCatalog?.customers.size || 0} customers, ${_suggestionCatalog?.cities.size || 0} cities`);
                return _roofrDataCache;
            } catch (e) {
                console.error('[Roofr Data] Fetch failed:', e);
                _roofrDataCache = [];
                _roofrDataPromise = null;
                return [];
            }
        })();
        return _roofrDataPromise;
    }

    function searchRoofrData(query) {
        if (!query || query.length < 2 || !_roofrDataCache || !_roofrDataCache.length) return [];
        const q = query.toLowerCase().trim();
        const qAddr = _normalizeAddress(query);
        const qPhone = _normalizePhone(query);
        const qTokens = qAddr.split(' ').filter(Boolean);

        return _roofrDataCache
            .map(job => {
                let score = 0;
                // Phone match (highest priority)
                if (qPhone.length >= 4 && job._nPhone) {
                    if (job._nPhone === qPhone) score += 300;
                    else if (job._nPhone.includes(qPhone)) score += 240;
                }
                // Customer match
                if (job._nCust) {
                    if (job._nCust === q) score += 220;
                    else if (job._nCust.startsWith(q)) score += 180;
                    else if (job._nCust.includes(q)) score += 140;
                }
                // Address match
                if (job._nAddr) {
                    if (job._nAddr === qAddr) score += 260;
                    else if (job._nAddr.startsWith(qAddr)) score += 210;
                    else if (job._nAddr.includes(qAddr)) score += 170;
                    else if (qTokens.length > 1 && qTokens.every(t => job._nAddr.includes(t))) score += 130;
                }
                return score > 0 ? { ...job, _score: score } : null;
            })
            .filter(Boolean)
            .sort((a, b) => b._score - a._score || (a.Customer || '').localeCompare(b.Customer || ''))
            .slice(0, 8);
    }

    // Preload Roofr data on popup open
    fetchRoofrData().catch(() => {});

    // ========= Suggestion Catalog (roofr-search style) =========
    let _suggestionCatalog = null;
    let _activeSuggestionIndex = -1;
    let _suggestionItems = []; // flat list of clickable elements for keyboard nav
    let _suggestFetchGen = 0; // stale async suggestion fetches must not touch the DOM
    let _geoAbort = null; // AbortController for the in-flight address-suggestion fetch (cancelled on next keystroke)
    let _placesSession = null; // Google Places autocomplete session token — one per address entry, consumed on selection (keeps cost in the free tier)

    // ========= Quick Links (company tools hub) =========
    // Typing in the calendar search surfaces matching company tool links as ORANGE
    // suggestions. Pulled LIVE from arizona-roofers-tools.vercel.app (so any card added
    // to the hub auto-appears here), with this baked-in snapshot as the offline fallback.
    const HUB_LINKS_BASE = 'https://arizona-roofers-tools.vercel.app';
    const HUB_LINKS_FALLBACK = [
      { t: 'Monsoon Season', u: 'https://monsoon-season.vercel.app', k: 'monsoon season tv display conference room lead center hype dashboard widgets music jukebox soundboard' },
      { t: 'Speed to Lead', u: 'https://speed-to-leads.vercel.app', k: 'ctm speed to lead uncalled leads dashboard agent stats' },
      { t: 'Rep Scheduler', u: 'https://az-roofers-tech-scheduler.vercel.app/', k: 'rep scheduler scheduling availability appointments' },
      { t: 'Production Map', u: 'https://az-production-map.vercel.app', k: 'production map gps trucks installs material drops walkthroughs weather radar' },
      { t: 'Roofr Job Search', u: 'https://roofr-search.vercel.app', k: 'roofr job search master sheet address owner stage' },
      { t: 'KPI Dashboard', u: 'https://az-roofers-kpi.vercel.app', k: 'kpi dashboard metrics overview sales production finance insurance door knocking leads' },
      { t: 'Training Attendance', u: 'https://training-attendance.vercel.app', k: 'training attendance tracking reps am pm' },
      { t: 'Team Contacts', u: 'team-contacts.html', k: 'team contacts import phone roster onboarding vcf google' },
      { t: 'Roofr', u: 'https://app.roofr.com/dashboard/team/239329/jobs', k: 'roofr crm pipeline estimates contracts production' },
      { t: 'CallTrackingMetrics', u: 'https://app.calltrackingmetrics.com/calls', k: 'calltrackingmetrics ctm call log recordings agent activity lead source' },
      { t: 'Lead Truffle', u: 'https://app.leadtruffle.com/leads', k: 'leadtruffle lead truffle leads workflows automation' },
      { t: 'Meeting Room', u: 'https://meet.google.com/ntd-wksz-puj', k: 'meeting room google meet team calls' },
      { t: 'Calendar Extension', u: 'https://drive.google.com/drive/folders/1rS_onL-NIqCm6hOyQngn1HVof_vx01Mx?usp=sharing', k: 'calendar extension chrome download install' },
      { t: 'All Spreadsheets', u: 'https://docs.google.com/spreadsheets/d/1cQmwCxWCTXAhNV3KertNuCUB41uNGjqZi9NumWv274w/edit?gid=0#gid=0', k: 'all spreadsheets master index directory' },
      { t: 'Outcomes Tracker', u: 'https://docs.google.com/spreadsheets/d/1TtweJEEhVEO_DAgmvTY7PcaPQdmbxlOtPfffKdiXBcw/edit?gid=1729256075#gid=1729256075', k: 'appointment outcomes tracker results sales follow-up' },
      { t: 'Daily KPIs', u: 'https://docs.google.com/spreadsheets/d/1Yo5zNhOI0fo8i2IgykxeUVLjyBYpVTcm1b3Ut4GGelc/edit?gid=2085167582#gid=2085167582', k: 'daily kpi key performance indicators metrics' },
      { t: 'Company Contacts', u: 'https://docs.google.com/spreadsheets/d/1XFJHD0IVZ8sJrQ7H2CrqU26a6n-FulPM8ABKc1hrh9o/edit?gid=0#gid=0', k: 'company contacts team directory info' },
      { t: 'Lead Tracking', u: 'https://docs.google.com/spreadsheets/d/1LY_Gu4noq99DQ-TjS0Gm9qUvU6HhOzL4kLlj4u7uKxc/edit?gid=0#gid=0', k: 'lead tracking pipeline management leads form' },
      { t: 'CSR Schedule', u: 'https://docs.google.com/spreadsheets/d/1M7sUgcrCDvlnKUo4l7VQ_tdSDqLXyDRTuaUK04XCkEs/edit?gid=2016674944#gid=2016674944', k: 'csr schedule customer service rep scheduling shift' },
      { t: 'Refund Tracker', u: 'https://docs.google.com/spreadsheets/d/1PvNW-coD_XPgVjE8FVjmo3pVJHiccpcAAKYGL_cQIk0/edit?gid=1647746646#gid=1647746646', k: 'refund request tracker refunds customer money back' },
      { t: 'Submit Refund', u: 'https://docs.google.com/forms/d/e/1FAIpQLScgD9L7vG6nOC2ZV6fE2SeK__3u2CNl_qyrzvgQ42xwA_mpqA/viewform', k: 'refund request form submit new refund' },
      { t: 'Reimbursement Request', u: 'https://docs.google.com/forms/d/e/1FAIpQLSeBdZWJxvo97jsrRdJcXbug3z_xG-NWii-CZRCkmPgTmHYiLw/viewform', k: 'reimbursement request form submit expense employee' },
      { t: 'Task List', u: 'https://docs.google.com/spreadsheets/d/14pj5qmZ4aRZoqUovPmgd2tEjTt8TQkIigaJ-yNdLkJs/edit?gid=859552318#gid=859552318', k: 'task list submit tasks checklist to do management assign' },
      { t: 'Tarping Request', u: 'https://docs.google.com/forms/d/e/1FAIpQLSdcTNSdm0iVRYY45apJcKfFi8AngqvWRcjXyzfyvyfFhgiB-Q/viewform', k: 'tarping request form submit tarp roof emergency leak' },
      { t: 'Tarping Task List', u: 'https://docs.google.com/spreadsheets/d/14pj5qmZ4aRZoqUovPmgd2tEjTt8TQkIigaJ-yNdLkJs/edit?resourcekey=&gid=1718143539#gid=1718143539', k: 'tarping task list tarp jobs tracking status schedule' },
      { t: 'Roof Pro LSA', u: 'https://docs.google.com/spreadsheets/d/1ffa3ykIDUUj74OmszrZlq3LR8T2JTEBrtAgX0Rc-lqg/edit?gid=1991507099#gid=1991507099', k: 'roof pro lsa local services ads google ads leads tracking' },
      { t: 'Intake Calls', u: 'https://docs.google.com/document/d/1HcyETaKhA0d_fSdzDdj9X5Pf3eSWTeAkuj0iHs2Fjjk/edit?tab=t.0', k: 'intake calls script inbound phone' },
      { t: 'No-Legger Video Call', u: 'https://docs.google.com/document/d/1eLq-p3g4pjsPYhCms3ZVR2_fKmS_6SRsOLEhDWlmnkI/edit?tab=t.0', k: 'no-legger video call script remote' },
      { t: 'New Construction Calls', u: 'https://docs.google.com/document/d/1trSvAeypsbEDIJ4yUbQ9-iK3b17W89zxFJpLW3LdIKU/edit?tab=t.0', k: 'new construction calls script building' },
      { t: 'Real Estate Script', u: 'https://docs.google.com/document/d/1kjtD45-jxmtoFDkvpOBH37TbFDqIxRV081p9imPRq8g/edit?tab=t.0#heading=h.ks93ctvvkerv', k: 'real estate inspections script call' },
      { t: 'Free Roof Promo', u: 'https://docs.google.com/document/d/1nHmBcxAYl_rZglIdXIWadn32SJ9PLXuMKOrUoIz4kZo/edit?tab=t.0#heading=h.efj2c1gls5lb', k: 'win free roof promotion script call' },
      { t: 'Referrals Guide', u: 'https://docs.google.com/document/d/1u1o5Ij1PRP9TXSJyW5SubFF8nbKMkmyJFZJ9MG9rcz4/edit?tab=t.0#heading=h.g02fsfn0d3zx', k: 'referrals guide referral program talking points' },
      { t: 'Who to Book', u: 'https://docs.google.com/document/d/17V9vVgUuDFa-gSqq0aqdwIEYrXnM4kfTlQSjRkN18gY/edit?tab=t.0', k: 'who to book guide rep appointments booking' },
      { t: 'Lost vs Unqualified', u: 'https://docs.google.com/document/d/1ageFvljDRjqss645d1tFyJ_-aYLhKwoXmV6glSsO2YQ/edit?tab=t.0', k: 'lost unqualified disposition guide criteria' },
      { t: 'Christmas Party Call List', u: 'https://docs.google.com/document/d/1ZDyDXvJ7cjTLXg2GNPaggreeYnO7EDul1TIAgMRAsRo/edit?tab=t.0', k: 'christmas party call list holiday event invitations outreach' },
      { t: 'Hiring Script', u: 'https://docs.google.com/document/d/1FQKwntUVb_igXon4z-jhxhi8_wtozhgzZHfWKPEyVWc/edit?tab=t.0', k: 'hiring script recruiting new hire interview candidate onboarding' },
      { t: 'RE Inspection Fee Training', u: 'https://docs.google.com/presentation/d/1PLFZs9qWW58Ij6gtUPXPFDhT0VFInPfotufc7CKDUP4/edit?slide=id.p2#slide=id.p2', k: 'real estate inspection fee training slides presentation' },
      { t: 'Tarping Benefits', u: 'https://docs.google.com/document/d/1FRTb3shFFbM1ng1e-dsK4b_YrNd7ToEkGrydTp8iO0A/edit?tab=t.0#heading=h.lvlvivj7e4n2', k: 'tarping benefits tarp roof protection value talking points' },
      { t: 'Tarping SOP', u: 'https://docs.google.com/document/d/1ekxsrEGjdmIReJYzzXpeqCex4det0zu4h9rOsL2JAcY/edit?tab=t.0#heading=h.r1ixdcvw5cdy', k: 'tarping sop standard operating procedure tarp install process steps' },
    ];
    function _absLinkUrl(u) {
        if (!u) return '';
        return /^https?:\/\//i.test(u) ? u : `${HUB_LINKS_BASE}/${String(u).replace(/^\//, '')}`;
    }
    function _normalizeHubLink(l) {
        const url = _absLinkUrl(l.u || l.url);
        const title = (l.t || l.title || '').trim();
        let host = '';
        try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) {}
        return { title, url, host, keywords: `${l.k || l.keywords || ''} ${title}`.toLowerCase() };
    }
    let _hubLinks = HUB_LINKS_FALLBACK.map(_normalizeHubLink);

    async function loadHubLinks() {
        try {
            const { hubLinksCache: c } = await chrome.storage.local.get('hubLinksCache');
            if (c && Array.isArray(c.links) && c.links.length) {
                _hubLinks = c.links;
                if ((Date.now() - (c.ts || 0)) < 6 * 60 * 60 * 1000) return; // fresh enough
            }
        } catch (e) { /* fall through to live fetch */ }
        try {
            const res = await fetch(`${HUB_LINKS_BASE}/`, { credentials: 'omit' });
            if (!res.ok) return;
            const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
            const links = [];
            for (const a of doc.querySelectorAll('a.card')) {
                const url = _absLinkUrl(a.getAttribute('href'));
                const title = (a.querySelector('.card-title')?.textContent || '').trim();
                if (!url || !title) continue;
                links.push(_normalizeHubLink({ t: title, u: url, k: a.getAttribute('data-search') || '' }));
            }
            if (links.length) {
                _hubLinks = links;
                try { await chrome.storage.local.set({ hubLinksCache: { ts: Date.now(), links } }); } catch (e) {}
            }
        } catch (e) { /* keep cache/fallback */ }
    }

    function getHubLinkMatches(query) {
        const q = String(query || '').trim().toLowerCase();
        if (q.length < 2) return [];
        const out = [];
        for (const l of _hubLinks) {
            if (l.keywords.includes(q)) { out.push(l); if (out.length >= 6) break; }
        }
        return out;
    }
    loadHubLinks().catch(() => {});

    function _buildSuggestionCatalog() {
        if (!_roofrDataCache || !_roofrDataCache.length) return null;
        const catalog = {
            customers: new Map(),
            addresses: new Map(),
            phones: new Map(),
            claims: new Map(),
            stages: new Map(),
            cities: new Map(),
            tags: new Map(),
        };
        for (const job of _roofrDataCache) {
            // Customer
            if (job._nCust) {
                const display = job.Customer?.trim() || '';
                if (!catalog.customers.has(job._nCust)) {
                    catalog.customers.set(job._nCust, { display, jobs: [], count: 0 });
                }
                const entry = catalog.customers.get(job._nCust);
                entry.jobs.push(job);
                entry.count++;
            }
            // Address (street only, before first comma)
            if (job._nAddr) {
                const display = (job.Address || '').split(',')[0].trim();
                const key = _normalizeAddress(display);
                if (display && key) {
                    if (!catalog.addresses.has(key)) {
                        catalog.addresses.set(key, { display, jobs: [], count: 0 });
                    }
                    const entry = catalog.addresses.get(key);
                    entry.jobs.push(job);
                    entry.count++;
                }
            }
            // Phone
            if (job._nPhone && job._nPhone.length >= 10) {
                if (!catalog.phones.has(job._nPhone)) {
                    catalog.phones.set(job._nPhone, { display: job.Phone?.trim() || job._nPhone, jobs: [] });
                }
                catalog.phones.get(job._nPhone).jobs.push(job);
            }
            // Insurance claim # (normalize to alphanumerics so dashes/spaces don't block matches)
            const claimRaw = (job['Claim #'] || '').toString().trim();
            if (claimRaw) {
                const ckey = claimRaw.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (ckey.length >= 3) {
                    if (!catalog.claims.has(ckey)) {
                        catalog.claims.set(ckey, { display: claimRaw, jobs: [] });
                    }
                    catalog.claims.get(ckey).jobs.push(job);
                }
            }
            // Stage
            const stage = job.Stage?.trim();
            if (stage) catalog.stages.set(stage, (catalog.stages.get(stage) || 0) + 1);
            // City (extract from address: "123 Main St, Mesa, AZ 85201" → "Mesa")
            const city = (job.Address || '').split(',')[1]?.trim();
            if (city && city.length > 1 && !/^\d/.test(city)) {
                catalog.cities.set(city, (catalog.cities.get(city) || 0) + 1);
            }
            // Tags
            if (job.Tags) {
                for (const tag of job.Tags.split(',')) {
                    const t = tag.trim();
                    if (t) catalog.tags.set(t, (catalog.tags.get(t) || 0) + 1);
                }
            }
        }
        return catalog;
    }

    function _queryMatchesCatalog(q, catalog) {
        if (!catalog || !q || q.length < 2) return null;
        const qLow = q.toLowerCase().trim();
        const qNAddr = _normalizeAddress(q);
        // Street-only form: catalog keys are street-only, so a typed city/state ("..., Phoenix, AZ")
        // must not block the match
        const qNAddrStreet = _normalizeAddress(q.split(',')[0]) || qNAddr;
        const qHouseNum = (qNAddrStreet.match(/^\d+/) || [''])[0];
        const qNPhone = _normalizePhone(q);
        const results = { customers: [], addresses: [], phones: [], claims: [], stages: [], cities: [], tags: [] };
        let total = 0;

        // Customers
        for (const [key, entry] of catalog.customers) {
            if (key.includes(qLow) || entry.display.toLowerCase().includes(qLow)) {
                results.customers.push(entry);
                total++;
            }
        }
        results.customers.sort((a, b) => {
            const aP = a.display.toLowerCase().startsWith(qLow) ? 1 : 0;
            const bP = b.display.toLowerCase().startsWith(qLow) ? 1 : 0;
            return (bP - aP) || (b.count - a.count) || a.display.localeCompare(b.display);
        });
        results.customers = results.customers.slice(0, 5);

        // Addresses (need 3+ chars)
        if (qNAddrStreet.length >= 3) {
            for (const [key, entry] of catalog.addresses) {
                if (key.includes(qNAddrStreet) || entry.display.toLowerCase().includes(qLow)) {
                    let sc;
                    if (qNAddr !== qNAddrStreet) {
                        // Rep typed beyond the street (city/state/zip): judge ONLY by full job
                        // addresses — the street-only display can't tell cities apart and would
                        // score a same-street wrong-city entry as near-exact
                        sc = 0;
                        for (const j of entry.jobs) {
                            if (j && j.Address) sc = Math.max(sc, _addressMatchScore(j.Address, qNAddr, qNAddrStreet, qHouseNum));
                        }
                    } else {
                        sc = _addressMatchScore(entry.display, qNAddr, qNAddrStreet, qHouseNum);
                    }
                    entry.__score = sc;
                    results.addresses.push(entry);
                    total++;
                }
            }
            results.addresses.sort((a, b) => (b.__score - a.__score) || (b.count - a.count));
            results.addresses = results.addresses.slice(0, 5);
        }

        // Phones (need 4+ digits) — but ONLY when the query looks like a phone, not an address.
        // Typing a street address ("1310 N Lesueur") normalizes to the bare digits "1310", which
        // would otherwise match any customer whose phone CONTAINS "1310". Phone numbers never
        // contain letters, so if the query has ANY letters treat it as an address/name and skip
        // phone matching entirely. (Pure-digit phone searches still work.)
        const qLooksLikePhone = !/[a-z]/i.test(q);
        if (qLooksLikePhone && qNPhone.length >= 4) {
            for (const [key, entry] of catalog.phones) {
                if (key.includes(qNPhone)) {
                    results.phones.push(entry);
                    total++;
                }
            }
            results.phones = results.phones.slice(0, 3);
        }

        // Claim # (need 4+ alphanumerics; match dashes/spaces-insensitively)
        const qNClaim = qLow.replace(/[^a-z0-9]/g, '');
        if (qNClaim.length >= 4) {
            for (const [key, entry] of catalog.claims) {
                if (key.includes(qNClaim)) {
                    results.claims.push(entry);
                    total++;
                }
            }
            results.claims = results.claims.slice(0, 4);
        }

        // Stages
        for (const [stage, count] of catalog.stages) {
            if (stage.toLowerCase().includes(qLow)) {
                results.stages.push({ display: stage, count });
                total++;
            }
        }
        results.stages.sort((a, b) => b.count - a.count);
        results.stages = results.stages.slice(0, 4);

        // Cities
        for (const [city, count] of catalog.cities) {
            if (city.toLowerCase().includes(qLow)) {
                results.cities.push({ display: city, count });
                total++;
            }
        }
        results.cities.sort((a, b) => b.count - a.count);
        results.cities = results.cities.slice(0, 4);

        // Tags
        for (const [tag, count] of catalog.tags) {
            if (tag.toLowerCase().includes(qLow)) {
                results.tags.push({ display: tag, count });
                total++;
            }
        }
        results.tags.sort((a, b) => b.count - a.count);
        results.tags = results.tags.slice(0, 4);

        return total > 0 ? results : null;
    }

    async function openJobCard(job) {
        if (!job || !job.Link) {
            showToast('No job link found');
            return;
        }
        try {
            const createOpts = { url: job.Link, active: false };
            if (window.__targetWindowId) createOpts.windowId = window.__targetWindowId;
            await chrome.tabs.create(createOpts);
            addLog(`Opened job card: ${job.Customer || ''} — ${job.Address || ''}`);
        } catch (err) {
            console.error('[Popup] Error opening job card:', err);
            showToast('Error opening job card');
        }
    }

    async function selectCalendarSuggestion(suggestion) {
        if (!suggestion) return;

        if (suggestion.group === 'Link') {
            if (suggestion.url) chrome.tabs.create({ url: suggestion.url });
            return;
        }

        if (suggestion.group === 'Customer') {
            const jobs = suggestion.jobs || [];
            if (jobs.length === 1) {
                await openJobCard(jobs[0]);
            } else if (jobs.length > 1) {
                // Show sub-list of addresses for this customer
                if (!verifiedAddressesList) return;
                verifiedAddressesList.innerHTML = '';
                _suggestionItems = [];
                _activeSuggestionIndex = -1;
                const hdr = document.createElement('div');
                hdr.className = 'suggestion-section-header';
                hdr.textContent = `${suggestion.display} — ${jobs.length} jobs`;
                verifiedAddressesList.appendChild(hdr);
                for (const job of jobs) {
                    const el = document.createElement('div');
                    el.className = 'suggestion-item sheet-match';
                    const addr = _escapeHtml((job.Address || '').trim() || 'Unknown');
                    const stage = _escapeHtml(job.Stage || '');
                    el.innerHTML = `<div class="match-primary">${addr}</div><div class="match-meta">${stage}</div>`;
                    el.addEventListener('mousedown', (e) => e.preventDefault());
                    el.addEventListener('click', () => {
                        verifiedAddressesList.classList.add('hidden');
                        openJobCard(job);
                    });
                    verifiedAddressesList.appendChild(el);
                    _suggestionItems.push(el);
                }
                verifiedAddressesList.classList.remove('hidden');
            }
            return;
        }

        if (suggestion.group === 'Address' || suggestion.group === 'Phone' || suggestion.group === 'Claim') {
            const jobs = suggestion.jobs || [];
            if (jobs.length > 0) {
                await openJobCard(jobs[0]);
            }
            return;
        }

        // Stage/City/Tags — put value in input as filter text
        if (addrInput) {
            addrInput.value = suggestion.display;
            addrInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (verifiedAddressesList) verifiedAddressesList.classList.add('hidden');
    }

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
        scanProfile: 'retail', // retail | d2d | production | insurance — which event types the scan reads
        scanView: 'weekly',    // agenda | weekly | daily — calendar view used when scanning
        showDialerTab: true,
        showPeopleTab: true,
        showClipboardTab: true,
        showReportsTab: false, // Hidden by default
        showQuickNotes: true,
        showFindBar: true,
        // Footer tools
        footerShowFormatting: true,
        footerShowPopupBtn: true,
        footerShowLinks: true,
        // New settings from options page
        showColorIndicators: true,
        showIcons: true,
        animateTransitions: true,
        autoExpandDays: false  // Default to collapsed
    };

    function showToast(msg) {
        if (!toast) return;
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    }

    function normalizeRepIdentityName(name) {
        const repName = String(name || '').trim();
        if (!repName) return null;
        return {
            rep_id: repName.toLowerCase().replace(/\W+/g, '-').replace(/^-+|-+$/g, ''),
            rep_name: repName
        };
    }

    async function getRepIdentity() {
        // Identity = the existing "Who's Taking Calls" (CTM) selection — no separate picker.
        const stored = await chrome.storage.sync.get({ ctm_csr: '' });
        currentRepIdentity = normalizeRepIdentityName(stored.ctm_csr);
        return currentRepIdentity;
    }

    function openSlotIdentityPicker() {
        // No dedicated picker — send the rep to the existing "Who's Taking Calls" modal.
        if (typeof showCtmCsrModal === 'function') showCtmCsrModal();
    }

    function buildSlotHoldKey(region, dateStr, block) {
        return `${String(region || '').toUpperCase()}|${dateStr}|${block}`;
    }

    function formatSlotCountdown(expiresAt) {
        const remainingMs = new Date(expiresAt).getTime() - Date.now();
        const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        return `${minutes}:${seconds}`;
    }

    function updateSlotCountdowns() {
        document.querySelectorAll('[data-slot-expires-at]').forEach(el => {
            const expiresAt = el.dataset.slotExpiresAt;
            el.textContent = formatSlotCountdown(expiresAt);
        });
        for (const [key, hold] of slotHolds.entries()) {
            if (new Date(hold.expires_at).getTime() <= Date.now()) {
                slotHolds.delete(key);
                clearSlotHeartbeat(key);
                renderUIFromState();
            }
        }
    }

    async function refreshSlotHolds() {
        if (slotHoldsPollInFlight) return;
        slotHoldsPollInFlight = true;
        try {
            await getRepIdentity();
            const resp = await fetch(`${SLOT_HOLDS_URL}?active=1`, {
                cache: 'no-store',
                headers: { 'X-Internal-Key': SLOT_HOLDS_INTERNAL_KEY }
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const json = await resp.json();
            if (!json?.success || !Array.isArray(json.holds)) throw new Error('Bad holds payload');
            slotHolds.clear();
            for (const hold of json.holds) {
                const key = buildSlotHoldKey(hold.region, hold.hold_date, hold.block);
                slotHolds.set(key, { ...hold, region: String(hold.region || '').toUpperCase() });
            }
            const liveHoldIds = new Set(json.holds.map(h => h.id));
            for (const id of [...holdBookingBaseline.keys()]) if (!liveHoldIds.has(id)) holdBookingBaseline.delete(id);
            for (const key of [...slotHoldHeartbeats.keys()]) {
                if (!slotHolds.has(key)) clearSlotHeartbeat(key);
            }
            // No auto-renew heartbeat — a hold is a fixed 12-min reservation that counts down and
            // expires. (Renewing every 90s made the countdown reset forever and the slot never free.)
            // Only re-render when the holds set actually changed — avoids the 5s flicker and the
            // expand/collapse reset it caused. Countdowns tick via updateSlotCountdowns separately.
            const sig = json.holds.map(h => `${h.id}:${h.expires_at}`).sort().join('|') + `~${currentRepIdentity?.rep_id || ''}`;
            if (sig !== slotHoldsSig) {
                slotHoldsSig = sig;
                renderUIFromState();
            }
        } catch (e) {
            console.warn('[Slot Holds] Refresh failed:', e);
        } finally {
            slotHoldsPollInFlight = false;
        }
    }

    function clearSlotHeartbeat(key) {
        const timer = slotHoldHeartbeats.get(key);
        if (timer) clearInterval(timer);
        slotHoldHeartbeats.delete(key);
    }

    function startSlotHeartbeat(hold, repId) {
        const key = buildSlotHoldKey(hold.region, hold.hold_date, hold.block);
        clearSlotHeartbeat(key);
        slotHoldHeartbeats.set(key, setInterval(async () => {
            try {
                const resp = await fetch(SLOT_HOLDS_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Internal-Key': SLOT_HOLDS_INTERNAL_KEY
                    },
                    body: JSON.stringify({ action: 'renew', id: hold.id, rep_id: repId })
                });
                const json = await resp.json();
                if (!resp.ok || json.renewed === false || json.success === false) {
                    clearSlotHeartbeat(key);
                    refreshSlotHolds();
                }
            } catch (e) {
                console.warn('[Slot Holds] Renew failed:', e);
            }
        }, 90 * 1000));
    }

    async function claimSlot(dateStr, region, block) {
        const identity = await getRepIdentity();
        if (!identity) {
            openSlotIdentityPicker();
            showToast('Pick your name before reserving a slot');
            return;
        }
        try {
            const resp = await fetch(SLOT_HOLDS_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Internal-Key': SLOT_HOLDS_INTERNAL_KEY
                },
                body: JSON.stringify({
                    action: 'claim',
                    hold_date: dateStr,
                    region,
                    block,
                    rep_id: identity.rep_id,
                    rep_name: identity.rep_name
                })
            });
            const json = await resp.json();
            if (!resp.ok || !json.claimed || !json.hold) throw new Error(json.reason || json.error || 'Claim failed');
            showToast('Slot reserved');
            await refreshSlotHolds();
        } catch (e) {
            console.warn('[Slot Holds] Claim failed:', e);
            showToast(e.message || 'Could not reserve slot');
            await refreshSlotHolds();
        }
    }

    async function releaseSlot(hold) {
        const identity = await getRepIdentity();
        if (!identity || !hold?.id) return;
        const key = buildSlotHoldKey(hold.region, hold.hold_date, hold.block);
        clearSlotHeartbeat(key);
        try {
            await fetch(SLOT_HOLDS_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Internal-Key': SLOT_HOLDS_INTERNAL_KEY
                },
                body: JSON.stringify({ action: 'release', id: hold.id, rep_id: identity.rep_id })
            });
            showToast('Slot released');
        } catch (e) {
            console.warn('[Slot Holds] Release failed:', e);
            showToast('Could not release slot');
        } finally {
            await refreshSlotHolds();
        }
    }

    function startSlotHoldsPolling() {
        if (slotHoldsPollTimer) return;
        refreshSlotHolds();
        slotHoldsPollTimer = setInterval(refreshSlotHolds, 5000);
        slotCountdownTimer = setInterval(updateSlotCountdowns, 1000);
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

    // Name detection - returns the name if it looks like a person's name, null otherwise
    function detectName(input) {
        if (!input) return null;

        // Already detected as phone number? Not a name.
        if (detectPhoneNumber(input)) return null;

        // Contains numbers at the start (like an address "123 Main St")? Not a name.
        if (/^\d/.test(input.trim())) return null;

        // Contains address indicators? Not a name.
        const addressIndicators = /\b(rd|road|st|street|ave|avenue|blvd|boulevard|ln|lane|dr|drive|ct|court|cir|circle|way|pl|place|pkwy|parkway|hwy|highway|apt|suite|ste|unit|#)\b/i;
        if (addressIndicators.test(input)) return null;

        // Contains state abbreviations or zip codes? Not a name.
        const stateZipPattern = /\b(AZ|CA|TX|NV|NM|CO|UT|OR|WA|FL|GA|NC|SC|VA|MD|PA|NY|NJ|OH|MI|IL|MO|TN|AL|MS|LA|AR|OK|KS|NE|SD|ND|MT|WY|ID|HI|AK|WI|MN|IA|IN|KY|WV|DE|CT|RI|MA|VT|NH|ME|DC)\b|\b\d{5}(-\d{4})?\b/i;
        if (stateZipPattern.test(input)) return null;

        // Contains commas (likely an address like "City, AZ")? Not a name.
        if (input.includes(',')) return null;

        // Check if it looks like a name: mostly letters, spaces, hyphens, apostrophes
        // Names can be 1-4 words (first, first last, first middle last, etc.)
        const namePattern = /^[A-Za-z][A-Za-z'\-\s]*$/;
        const trimmed = input.trim();

        // Must match name pattern
        if (!namePattern.test(trimmed)) return null;

        // Should be 2-40 characters (reasonable name length)
        if (trimmed.length < 2 || trimmed.length > 40) return null;

        // Should have 1-4 words
        const words = trimmed.split(/\s+/).filter(w => w.length > 0);
        if (words.length < 1 || words.length > 4) return null;

        // Check if this matches a known city name (from CONFIG) - if so, it's not a name
        // This prevents "Mesa" or "Phoenix" from being treated as person names
        const cityList = CONFIG.resolveCityCandidatesFromInput(trimmed);
        if (cityList.length > 0) {
            // It's a known city, not a person name
            return null;
        }

        return trimmed;
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

    // Debounce render to prevent stutter from multiple rapid calls
    let _renderTimeout = null;
    let _lastRenderTime = 0;
    const RENDER_DEBOUNCE_MS = 50;

    function renderUIFromState(immediate = false) {
        const now = Date.now();

        // If immediate or enough time has passed, render now
        if (immediate || now - _lastRenderTime > RENDER_DEBOUNCE_MS) {
            if (_renderTimeout) {
                clearTimeout(_renderTimeout);
                _renderTimeout = null;
            }
            _lastRenderTime = now;
            _doRenderUI();
        } else {
            // Debounce: schedule render for later, canceling any pending render
            if (_renderTimeout) clearTimeout(_renderTimeout);
            _renderTimeout = setTimeout(() => {
                _renderTimeout = null;
                _lastRenderTime = Date.now();
                _doRenderUI();
            }, RENDER_DEBOUNCE_MS);
        }
    }

    function _doRenderUI() {
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
        const _gen = ++_suggestFetchGen;
        // Cancel any in-flight address fetch — its result is now stale.
        if (_geoAbort) { try { _geoAbort.abort(); } catch (e) {} _geoAbort = null; }
        _activeSuggestionIndex = -1;
        _suggestionItems = [];

        if (!query || query.length < 2) {
            verifiedAddressesList.innerHTML = '';
            verifiedAddressesList.classList.add('hidden');
            return;
        }

        // Clear Roofr job selection if user changed input
        if (window.__selectedRoofrJobLink && window.__selectedRoofrJobInputValue &&
            query.trim() !== window.__selectedRoofrJobInputValue) {
            window.__selectedRoofrJobLink = null;
            window.__selectedRoofrJob = null;
            window.__selectedRoofrJobInputValue = null;
        }

        verifiedAddressesList.innerHTML = '';
        const addedNormalized = new Set();
        let hasResults = false;

        // ═══ SECTION 0: Quick Links (company tools hub) — orange ═══
        const linkMatches = getHubLinkMatches(query);
        if (linkMatches.length) {
            const hdr = document.createElement('div');
            hdr.className = 'suggestion-section-header';
            hdr.textContent = 'Links';
            verifiedAddressesList.appendChild(hdr);
            for (const link of linkMatches) {
                const el = document.createElement('div');
                el.className = 'suggestion-item link-match';
                el.innerHTML = `<div class="match-primary">${_highlightMatch(link.title, query)}</div>` +
                    `<div class="match-meta">${_escapeHtml(link.host)}</div>`;
                el.addEventListener('mousedown', (e) => e.preventDefault());
                el.addEventListener('click', () => {
                    verifiedAddressesList.classList.add('hidden');
                    chrome.tabs.create({ url: link.url });
                });
                verifiedAddressesList.appendChild(el);
                _suggestionItems.push(el);
                el.__suggestion = { group: 'Link', url: link.url };
                hasResults = true;
            }
        }

        // ═══ SECTION 1: DB Catalog Matches (grouped) ═══
        const catalogResults = _queryMatchesCatalog(query, _suggestionCatalog);

        if (catalogResults) {
            const addGroup = (label, items, renderFn) => {
                if (!items.length) return;
                const hdr = document.createElement('div');
                hdr.className = 'suggestion-section-header';
                hdr.textContent = label;
                verifiedAddressesList.appendChild(hdr);
                for (const item of items) renderFn(item);
            };

            // Customers → click opens job card directly
            addGroup('Customers', catalogResults.customers, (entry) => {
                const el = document.createElement('div');
                el.className = 'suggestion-item sheet-match';
                const countBadge = entry.count > 1 ? `<span class="match-count">${entry.count} jobs</span>` : '';
                const firstJob = entry.jobs[0];
                const stage = _escapeHtml(firstJob?.Stage || '');
                el.innerHTML = `<div class="match-primary">${_highlightMatch(entry.display, query)} ${countBadge}</div>` +
                    `<div class="match-meta">${stage}${entry.count > 1 ? ' +more' : ''}</div>`;
                el.addEventListener('mousedown', (e) => e.preventDefault());
                el.addEventListener('click', () => {
                    verifiedAddressesList.classList.add('hidden');
                    selectCalendarSuggestion({ group: 'Customer', display: entry.display, jobs: entry.jobs, count: entry.count });
                });
                verifiedAddressesList.appendChild(el);
                _suggestionItems.push(el);
                el.__suggestion = { group: 'Customer', display: entry.display, jobs: entry.jobs, count: entry.count };
                hasResults = true;
                // Track addresses to avoid dupes with geocoding
                for (const j of entry.jobs) {
                    if (j._nAddr) addedNormalized.add(j._nAddr);
                }
            });

            // Addresses → click opens job card directly
            addGroup('Addresses', catalogResults.addresses, (entry) => {
                const el = document.createElement('div');
                el.className = 'suggestion-item sheet-match';
                const firstJob = entry.jobs[0];
                el.innerHTML = `<div class="match-primary">${_highlightMatch(entry.display, query)}</div>` +
                    `<div class="match-meta">${_escapeHtml(firstJob?.Customer || '')} — ${_escapeHtml(firstJob?.Stage || '')}</div>`;
                el.addEventListener('mousedown', (e) => e.preventDefault());
                el.addEventListener('click', () => {
                    verifiedAddressesList.classList.add('hidden');
                    selectCalendarSuggestion({ group: 'Address', display: entry.display, jobs: entry.jobs });
                });
                verifiedAddressesList.appendChild(el);
                _suggestionItems.push(el);
                el.__suggestion = { group: 'Address', display: entry.display, jobs: entry.jobs };
                hasResults = true;
                if (entry.jobs[0]?._nAddr) addedNormalized.add(entry.jobs[0]._nAddr);
            });

            // Phones → click opens job card directly
            addGroup('Phone', catalogResults.phones, (entry) => {
                const el = document.createElement('div');
                el.className = 'suggestion-item sheet-match';
                const firstJob = entry.jobs[0];
                el.innerHTML = `<div class="match-primary">${_highlightMatch(entry.display, query)}</div>` +
                    `<div class="match-meta">${_escapeHtml(firstJob?.Customer || '')} — ${_escapeHtml(firstJob?.Address || '')}</div>`;
                el.addEventListener('mousedown', (e) => e.preventDefault());
                el.addEventListener('click', () => {
                    verifiedAddressesList.classList.add('hidden');
                    selectCalendarSuggestion({ group: 'Phone', display: entry.display, jobs: entry.jobs });
                });
                verifiedAddressesList.appendChild(el);
                _suggestionItems.push(el);
                el.__suggestion = { group: 'Phone', display: entry.display, jobs: entry.jobs };
                hasResults = true;
            });

            // Claim # → click opens job card directly
            addGroup('Claim #', catalogResults.claims, (entry) => {
                const el = document.createElement('div');
                el.className = 'suggestion-item sheet-match';
                const firstJob = entry.jobs[0];
                el.innerHTML = `<div class="match-primary">${_highlightMatch(entry.display, query)}</div>` +
                    `<div class="match-meta">${_escapeHtml(firstJob?.Customer || '')} — ${_escapeHtml(firstJob?.Address || '')}</div>`;
                el.addEventListener('mousedown', (e) => e.preventDefault());
                el.addEventListener('click', () => {
                    verifiedAddressesList.classList.add('hidden');
                    selectCalendarSuggestion({ group: 'Claim', display: entry.display, jobs: entry.jobs });
                });
                verifiedAddressesList.appendChild(el);
                _suggestionItems.push(el);
                el.__suggestion = { group: 'Claim', display: entry.display, jobs: entry.jobs };
                hasResults = true;
            });

            // Stages → filter text
            addGroup('Stage', catalogResults.stages, (entry) => {
                const el = document.createElement('div');
                el.className = 'suggestion-item filter-match';
                el.innerHTML = `<div class="match-primary">${_highlightMatch(entry.display, query)}</div>` +
                    `<div class="match-meta">${entry.count} job${entry.count !== 1 ? 's' : ''}</div>`;
                el.addEventListener('mousedown', (e) => e.preventDefault());
                el.addEventListener('click', () => {
                    verifiedAddressesList.classList.add('hidden');
                    selectCalendarSuggestion({ group: 'Stage', display: entry.display });
                });
                verifiedAddressesList.appendChild(el);
                _suggestionItems.push(el);
                el.__suggestion = { group: 'Stage', display: entry.display };
                hasResults = true;
            });

            // Cities → filter text
            addGroup('City', catalogResults.cities, (entry) => {
                const el = document.createElement('div');
                el.className = 'suggestion-item filter-match';
                el.innerHTML = `<div class="match-primary">${_highlightMatch(entry.display, query)}</div>` +
                    `<div class="match-meta">${entry.count} job${entry.count !== 1 ? 's' : ''}</div>`;
                el.addEventListener('mousedown', (e) => e.preventDefault());
                el.addEventListener('click', () => {
                    verifiedAddressesList.classList.add('hidden');
                    selectCalendarSuggestion({ group: 'City', display: entry.display });
                });
                verifiedAddressesList.appendChild(el);
                _suggestionItems.push(el);
                el.__suggestion = { group: 'City', display: entry.display };
                hasResults = true;
            });

            // Tags → filter text
            addGroup('Tags', catalogResults.tags, (entry) => {
                const el = document.createElement('div');
                el.className = 'suggestion-item filter-match';
                el.innerHTML = `<div class="match-primary">${_highlightMatch(entry.display, query)}</div>` +
                    `<div class="match-meta">${entry.count} job${entry.count !== 1 ? 's' : ''}</div>`;
                el.addEventListener('mousedown', (e) => e.preventDefault());
                el.addEventListener('click', () => {
                    verifiedAddressesList.classList.add('hidden');
                    selectCalendarSuggestion({ group: 'Tag', display: entry.display });
                });
                verifiedAddressesList.appendChild(el);
                _suggestionItems.push(el);
                el.__suggestion = { group: 'Tag', display: entry.display };
                hasResults = true;
            });
        }

        // ═══ SECTION 2: Address suggestions (address-like queries only) ═══
        // Fire for anything that looks like an address — not just queries with a
        // digit. Catches street-name-first typing ("lesueur dr", "n mclellan")
        // that the old digit/comma gate ignored (the "rigid" complaint). Bare
        // city/name/stage queries (no number, directional, or street-type word)
        // still skip geo so the omni-search dropdown isn't polluted with street noise.
        const looksLikeAddress = /\d/.test(query)
            || query.includes(',')
            || /(^|\s)(n|s|e|w|ne|nw|se|sw)(\s|$)/i.test(query)
            || /\b(st|street|ave|avenue|dr|drive|rd|road|ln|lane|blvd|boulevard|ct|court|way|pl|place|cir|circle|loop|trl|trail|pkwy|hwy|ter|terrace|cv|cove|pt|point)\b/i.test(query);
        // When query is specific (house number + 15+ chars), prioritize new address results —
        // UNLESS the DB already has a near-exact match for what was typed (rep is looking up a
        // verified/existing job, not entering a new address). A strong DB match stays on top.
        const queryIsSpecific = /\d/.test(query) && query.trim().length >= 15;
        const _qNorm = _normalizeAddress(query);
        const _qStreetNorm = _normalizeAddress(query.split(',')[0]) || _qNorm;
        const _qHouseNum = (_qStreetNorm.match(/^\d+/) || [''])[0];
        // When the rep typed a city/state too, "strong" requires EVERY typed beyond-street token
        // to appear in a job's full address — a same-street hit in another city (or a same-state
        // "AZ" coincidence) must not pin the DB section above fresher geo suggestions
        const _qExtraTokens = _qNorm.length > _qStreetNorm.length
            ? _qNorm.slice(_qStreetNorm.length).split(' ').filter(t => t.length >= 2) : [];
        const dbHasStrongMatch = !!(catalogResults && (catalogResults.addresses || []).some(e => {
            if ((e.__score || 0) < 80) return false;
            if (!_qExtraTokens.length) return true;
            return (e.jobs || []).some(j => {
                const full = _normalizeAddress((j && j.Address) || '');
                if (!full.startsWith(_qStreetNorm)) return false;
                // Token-prefix match, not substring — "az" must not hit inside "plaza"
                const fullParts = full.split(' ');
                return _qExtraTokens.every(t => fullParts.some(p => p.startsWith(t)));
            });
        }));
        const dbInsertRef = (queryIsSpecific && !dbHasStrongMatch) ? verifiedAddressesList.firstChild : null;
        if (looksLikeAddress) {
            let geoHeaderAdded = false;
            const geoSuggestionItems = []; // track geo items for re-ordering _suggestionItems
            const _geoByNorm = new Map(); // norm → element, for upgrading repaired entries
            // Strip a trailing unit/suite/lot so the provider returns base-address
            // suggestions, then re-attach exactly what the rep typed. Declared here
            // (not inside the try) so addGeoOption's click handler can reuse withUnit.
            const geoQuery = query.replace(/(?:#|\b(?:unit|apt|apartment|ste|suite|spc|space|bldg|building|lot)\s*)\s*[A-Za-z0-9-]+\s*$/i, '').replace(/\s{2,}/g, ' ').trim() || query;
            const _unitMatch = query.match(/((?:#|\b(?:unit|apt|apartment|ste|suite|spc|space|bldg|building|lot)\s*)\s*[A-Za-z0-9-]+)\s*$/i);
            const unitDisplay = _unitMatch ? _unitMatch[1].replace(/\s+/g, ' ').trim() : '';
            const withUnit = (fmt) => (unitDisplay && fmt) ? fmt.replace(/^([^,]+)/, `$1 ${unitDisplay}`) : fmt;
            const addGeoOption = (address, lat, lng, placeId) => {
                if (_gen !== _suggestFetchGen) return; // newer keystroke owns the dropdown
                if (!address || address.length <= 3) return;
                const titleCaseAddress = toTitleCase(address);
                const norm = _normalizeAddress(titleCaseAddress);
                const validCoords = (lat != null && lng != null && !isNaN(+lat) && !isNaN(+lng));
                if (addedNormalized.has(norm)) {
                    // A repaired (coord-less) entry already holds this slot — give it the real
                    // coordinates from this exact geocoder hit instead of discarding them
                    const prior = _geoByNorm.get(norm);
                    if (prior && !prior.__coords && validCoords) prior.__coords = { lat: +lat, lng: +lng };
                    return;
                }
                addedNormalized.add(norm);

                if (!geoHeaderAdded) {
                    geoHeaderAdded = true;
                    const hdr = document.createElement('div');
                    hdr.className = 'suggestion-section-header';
                    hdr.textContent = 'Address Suggestions';
                    if (queryIsSpecific && dbInsertRef) {
                        verifiedAddressesList.insertBefore(hdr, dbInsertRef);
                    } else {
                        verifiedAddressesList.appendChild(hdr);
                    }
                }

                const el = document.createElement('div');
                el.className = 'suggestion-item api-match';
                el.textContent = titleCaseAddress;
                el.__coords = validCoords ? { lat: +lat, lng: +lng } : null;
                el.__placeId = placeId || '';
                _geoByNorm.set(norm, el);
                el.addEventListener('mousedown', (e) => e.preventDefault());
                el.addEventListener('click', async () => {
                    // Invalidate any in-flight fetch and close. We set the value WITHOUT
                    // dispatching an 'input' event, so the dropdown can't reopen and we
                    // don't burn an extra autocomplete call — we just replicate the input
                    // handler's essential side effects below.
                    _suggestFetchGen++;
                    if (_geoAbort) { try { _geoAbort.abort(); } catch (e) {} _geoAbort = null; }
                    verifiedAddressesList.classList.add('hidden');
                    window.__selectedRoofrJobLink = null;
                    window.__selectedRoofrJob = null;
                    window.__selectedRoofrJobInputValue = null;
                    // Resolve the canonical address + exact coords via Place Details, reusing
                    // this entry's session token (completes ONE free Google session). Falls
                    // back to the suggestion text + null coords (Google Earth resolves the
                    // pin from the address) if Details is unavailable.
                    let finalAddr = titleCaseAddress;
                    let coords = el.__coords || null;
                    if (el.__placeId) {
                        try {
                            const dUrl = `https://speed-to-leads.vercel.app/api/address-autocomplete?placeId=${encodeURIComponent(el.__placeId)}` +
                                (_placesSession ? `&session=${encodeURIComponent(_placesSession)}` : '');
                            const dResp = await fetch(dUrl, { headers: { 'X-Dialer-Client': 'roofr-extension' } });
                            if (dResp.ok) {
                                const dData = await dResp.json();
                                if (dData && dData.success) {
                                    if (dData.display) finalAddr = withUnit(toTitleCase(dData.display));
                                    if (dData.lat != null && dData.lng != null) coords = { lat: +dData.lat, lng: +dData.lng };
                                }
                            }
                        } catch (e) { /* keep suggestion text + null coords */ }
                    }
                    _placesSession = null; // session consumed by this selection
                    if (addrInput) addrInput.value = finalAddr;
                    state.addressInput = finalAddr;
                    window.__selectedAddrCoords = coords;
                    debouncedSaveState();
                    if (typeof updateAddressClearButton === 'function') updateAddressClearButton();
                    updateGoButtonState();
                });
                // Insert in relevance order within the geo section — the APIs' own ordering
                // routinely buries the near-exact match several slots down
                el.__geoScore = _addressMatchScore(titleCaseAddress, _qNorm, _qStreetNorm, _qHouseNum);
                let beforeEl = null;
                for (const g of geoSuggestionItems) {
                    if ((g.__geoScore || 0) < el.__geoScore) { beforeEl = g; break; }
                }
                if (beforeEl) {
                    verifiedAddressesList.insertBefore(el, beforeEl);
                    geoSuggestionItems.splice(geoSuggestionItems.indexOf(beforeEl), 0, el);
                } else {
                    if (queryIsSpecific && dbInsertRef) {
                        verifiedAddressesList.insertBefore(el, dbInsertRef);
                    } else {
                        verifiedAddressesList.appendChild(el);
                    }
                    geoSuggestionItems.push(el);
                }
                _suggestionItems.push(el);
                el.__suggestion = null; // geocoding result, not a DB match
                hasResults = true;
            };

            try {
                // Single residential-grade source: Google Places Autocomplete (New)
                // via the speed-to-lead proxy (GOOGLE_PLACES_KEY stays server-side).
                // Replaces the old LocationIQ → Geoapify → Census waterfall and the
                // house-number/directional "repair" logic. Google returns complete,
                // verified US addresses, so we never fabricate a street. Coords arrive
                // later via Place Details when the rep clicks (see addGeoOption). One
                // session token spans this address entry → keeps us in the free tier.
                if (geoQuery.length >= 3) {
                    const controller = new AbortController();
                    _geoAbort = controller;
                    if (!_placesSession) {
                        _placesSession = (typeof crypto !== 'undefined' && crypto.randomUUID)
                            ? crypto.randomUUID()
                            : (String(Date.now()) + Math.random().toString(36).slice(2));
                    }
                    const proxyUrl = `https://speed-to-leads.vercel.app/api/address-autocomplete?q=${encodeURIComponent(geoQuery)}&session=${encodeURIComponent(_placesSession)}`;
                    const resp = await fetch(proxyUrl, { headers: { 'X-Dialer-Client': 'roofr-extension' }, signal: controller.signal });
                    if (resp.ok) {
                        const data = await resp.json();
                        for (const s of (data.suggestions || [])) {
                            if (s && s.display) addGeoOption(withUnit(s.display), null, null, s.placeId);
                        }
                    }
                }
            } catch (error) {
                if (error.name !== 'AbortError') addLog(`Address suggestion error: ${error.message}`, 'WARN');
            }

            if (_gen !== _suggestFetchGen) return; // newer keystroke owns the dropdown now

            // Fallback: always let the rep force the EXACT typed address through. Free geocoders
            // (LocationIQ/Census) miss some real addresses that Google knows — new/renamed streets,
            // gated communities — e.g. "6725 E Terrace Dr, Scottsdale" returns nothing/wrong streets.
            // Coords stay null so Google Earth resolves the pin with Google's own geocoder; Roofr
            // search/create use the house number.
            if (/^\s*\d+\s+[A-Za-z]/.test(query) && query.trim().length >= 8) {
                const typed = toTitleCase(query.trim());
                const norm = _normalizeAddress(typed);
                if (!addedNormalized.has(norm)) {
                    addedNormalized.add(norm);
                    if (!geoHeaderAdded) {
                        geoHeaderAdded = true;
                        const hdr = document.createElement('div');
                        hdr.className = 'suggestion-section-header';
                        hdr.textContent = 'Address Suggestions';
                        if (queryIsSpecific && dbInsertRef) verifiedAddressesList.insertBefore(hdr, dbInsertRef);
                        else verifiedAddressesList.appendChild(hdr);
                    }
                    const el = document.createElement('div');
                    el.className = 'suggestion-item manual-entry';
                    el.textContent = '✏️ Use exactly what I typed: ' + typed;
                    el.addEventListener('mousedown', (e) => e.preventDefault());
                    el.addEventListener('click', () => {
                        if (addrInput) {
                            addrInput.value = typed;
                            addrInput.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                        window.__selectedRoofrJobLink = null;
                        window.__selectedRoofrJob = null;
                        window.__selectedRoofrJobInputValue = null;
                        window.__selectedAddrCoords = null; // no geocoder coords -> Google Earth address-searches it
                        verifiedAddressesList.classList.add('hidden');
                        updateGoButtonState();
                    });
                    if (queryIsSpecific && dbInsertRef) verifiedAddressesList.insertBefore(el, dbInsertRef);
                    else verifiedAddressesList.appendChild(el);
                    _suggestionItems.push(el);
                    el.__suggestion = null;
                    hasResults = true;
                }
            }

            // Keyboard nav order must mirror visual order (sorted insertion above reshuffles the DOM)
            _suggestionItems = Array.from(verifiedAddressesList.querySelectorAll('.suggestion-item'));
        }

        // Also add matching cities from our whitelists
        if (!looksLikeAddress) {
            const queryUpper = query.toUpperCase();
            for (const regionKey of ['PHX', 'NORTH', 'SOUTH']) {
                const cities = CONFIG.REGION_CITY_WHITELISTS[regionKey];
                if (cities) {
                    for (const city of cities) {
                        if (city.includes(queryUpper) && !addedNormalized.has(_normalizeAddress(city))) {
                            const el = document.createElement('div');
                            el.className = 'suggestion-item filter-match';
                            el.innerHTML = `<div class="match-primary">${_highlightMatch(city, query)}</div><div class="match-meta">Region city</div>`;
                            el.addEventListener('mousedown', (e) => e.preventDefault());
                            el.addEventListener('click', () => {
                                if (addrInput) { addrInput.value = city; addrInput.dispatchEvent(new Event('input', { bubbles: true })); }
                                verifiedAddressesList.classList.add('hidden');
                            });
                            verifiedAddressesList.appendChild(el);
                            _suggestionItems.push(el);
                            hasResults = true;
                        }
                    }
                }
            }
        }

        // Show/hide container. If a search just fired, stay hidden no matter what
        // this (possibly stale, in-flight) fetch found — prevents the dropdown
        // flashing open right after Go/Enter.
        if (hasResults && !_suppressAddressSuggestions) {
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

    // Debounced version for typing. 200ms feels snappy now that each keystroke
    // fires ONE cancellable Radar request (not a 3-geocoder sequential waterfall).
    const debouncedFetchAddressSuggestions = debounce(fetchAddressSuggestions, 200);

    let _selfSavingState = false; // Flag to prevent re-render when we save state ourselves
    const debouncedSaveState = debounce(async () => {
        _selfSavingState = true;
        if (chrome.storage && chrome.storage.local) await chrome.storage.local.set({ [SHARED_STATE_KEY]: state });
        addLog('Shared state saved.');
        // Reset flag after a short delay to allow storage event to fire
        setTimeout(() => { _selfSavingState = false; }, 100);
    }, 250);

    async function loadState() {
        const data = await chrome.storage.local.get(SHARED_STATE_KEY);
        if (data && data[SHARED_STATE_KEY]) {
            state = { ...state, ...data[SHARED_STATE_KEY] };
            state.regionOverrides = state.regionOverrides || {}; // Ensure initialized
            state.ignoredEvents = state.ignoredEvents || {}; // Ensure initialized
            state.recentAddresses = state.recentAddresses || []; // Ensure initialized
            state.weekDataCache = state.weekDataCache || {}; // Ensure initialized
            addLog('Shared state loaded.');
        } else {
            addLog('No shared state found.');
        }
    }

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes[SHARED_STATE_KEY]) {
            // Skip re-render if we're the ones who saved the state
            if (_selfSavingState) {
                addLog('Shared state changed (self-triggered). Skipping re-render.');
                return;
            }
            // Skip full re-render if we're just navigating between days
            if (isNavigatingDays) {
                addLog('Shared state changed (day navigation). Skipping full re-render.');
                state = { ...state, ...changes[SHARED_STATE_KEY].newValue };
                return;
            }
            addLog('Shared state changed externally. Updating UI.');
            state = { ...state, ...changes[SHARED_STATE_KEY].newValue };
            renderUIFromState();
        }
        // Listen for clipboard changes (local storage) - sync between popup/sidepanel
        if (changes[CLIPBOARDS_KEY]) {
            const incoming = changes[CLIPBOARDS_KEY].newValue || [];
            // Ignore the echo of our own save (fires for both sync + local areas).
            if (JSON.stringify(incoming) === _lastWrittenClipboardsSig) return;
            // Don't rebuild the cards while the user is editing one here — that
            // destroys the contenteditable and drops the caret mid-typing. Leave
            // the in-memory edits intact (last-write-wins on next save).
            if (clipboardContainer && clipboardContainer.contains(document.activeElement)) {
                return;
            }
            addLog(`Clipboards changed externally (${namespace}). Updating UI.`);
            clipboards = incoming;
            renderClipboards();
        }
        // Listen for settings changes from options page (sync storage)
        if (namespace === 'sync') {
            const settingsToWatch = [
                // Appearance
                'theme', 'compact_mode', 'show_color_indicators', 'show_icons', 'animate_transitions',
                // Interface - Tab visibility
                'show_dialer', 'show_people', 'show_clipboard', 'show_reports',
                // Scan
                'scan_profile', 'scan_view',
                // Interface - Navigation & Controls
                'show_week_navigation', 'show_date_picker', 'show_team_selector',
                'show_refresh_button', 'show_tab_badges', 'show_dock_note',
                'global_panel_mode', 'auto_expand_days',
                // Footer Tools
                'footer_show_find', 'footer_show_notes', 'footer_show_formatting',
                'footer_show_popup_btn', 'footer_show_links',
                // Scanner
                'scanner_enabled', 'auto_scan_on_load', 'show_capacity_display',
                'show_daily_totals', 'show_city_chips', 'show_region_filter',
                'show_availability_section', 'show_booked_count', 'show_available_count',
                'show_uncategorized_alerts', 'highlight_recommended_slots',
                'show_out_of_sync_warning', 'show_overbooked_warning',
                // Home Search
                'home_search_enabled', 'address_verification_enabled', 'show_recent_addresses',
                'show_address_suggestions', 'auto_copy_verified_address', 'show_geocode_results',
                'normalize_addresses', 'search_google_earth', 'search_gemini', 'search_roofr',
                // Phone Search
                'phone_search_enabled', 'auto_format_phone', 'show_phone_history', 'phone_search_auto_open',
                // CTM
                'ctm_enabled', 'ctm_auto_search', 'ctm_show_notifications',
                'ctm_show_active_calls', 'ctm_auto_open_calls_page', 'ctm_group_tabs',
                // Reports
                'reports_enabled', 'reports_calendar_enabled', 'reports_job_card_enabled',
                'reports_batch_enabled', 'reports_auto_export',
                // People
                'people_show_reps', 'people_show_mgmt', 'people_show_csrs', 'people_show_production',
                'people_clickable_names', 'people_show_counts',
                // Clipboard
                'clipboard_smart_formatting', 'clipboard_auto_format_paste',
                'clipboard_show_day_copy', 'clipboard_show_week_copy', 'clipboard_preserve_formatting',
                // Find
                'find_enabled', 'find_highlight_enabled', 'find_case_sensitive',
                'find_whole_word', 'find_regex_enabled', 'find_show_counter', 'find_show_navigation',
                // Data & Cities
                'dynamic_city_learning', 'city_whitelist_strict', 'show_learned_cities', 'auto_categorize_jobs',
                // Configuration
                'NEXT_SHEET_ID', 'AVAIL_RANGE_PHX', 'AVAIL_RANGE_NORTH', 'AVAIL_RANGE_SOUTH',
                'PEOPLE_REPS', 'PEOPLE_MGMT', 'PEOPLE_CSRS'
            ];
            const hasSettingChange = settingsToWatch.some(key => changes[key]);
            if (hasSettingChange) {
                addLog('Settings changed in options page. Applying...');
                // Reload all settings and refresh UI
                (async () => {
                    await loadSettings();
                    applyUserPrefs();
                    await loadPeopleLists();
                    // Update setup banner visibility
                    const setupBanner = document.getElementById('setup-banner');
                    if (setupBanner) {
                        if (settings.NEXT_SHEET_ID) {
                            setupBanner.classList.add('hidden');
                        } else {
                            setupBanner.classList.remove('hidden');
                        }
                    }
                    renderUIFromState();
                })();
            }
        }
    });

    if (chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((msg) => {
            if (msg.type === "ROOFR_DATES_CHANGED") {
                addLog(`Page navigated to new dates.`);
                console.log('[RECO DEBUG] ROOFR_DATES_CHANGED received');
                console.log('[RECO DEBUG] pageDatesISO:', msg.datesISO);
                console.log('[RECO DEBUG] userPrefs.autoScanWeek:', userPrefs.autoScanWeek);
                console.log('[RECO DEBUG] state.addressInput:', state.addressInput);
                pageDatesISO = msg.datesISO;
                updateScanButtonState();
                // Check if we should auto-scan this new week
                if (userPrefs.autoScanWeek) {
                    // Only if dates are actually different from what we have
                    if (state.weekDays && JSON.stringify(pageDatesISO) !== JSON.stringify(state.weekDays)) {
                        console.log("[RECO DEBUG] Auto-scanning new week...");
                        runScanFlow(true); // Pass true for isAuto
                    } else {
                        console.log("[RECO DEBUG] Skipped auto-scan - dates same as current");
                    }
                } else {
                    console.log("[RECO DEBUG] Skipped auto-scan - autoScanWeek disabled");
                }
            }
            // Auto-scan when calendar first loads (after Sales checkbox is checked)
            if (msg.type === "AUTO_SCAN_READY") {
                if (serverAvailabilityReady) {
                    addLog("Calendar ready, but server availability is already loaded; skipping DOM auto-scan.");
                    return;
                }
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
    // Business-timezone (America/Phoenix) date helpers. Use these for "today"/"tomorrow" so the
    // scanner's date math matches Arizona for reps anywhere — the machine clock is irrelevant.
    function phoenixTodayISO() {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(new Date());
    }
    function addDaysISO(iso, n) {
        const [y, m, d] = iso.split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        dt.setUTCDate(dt.getUTCDate() + n);
        return dt.toISOString().slice(0, 10);
    }

    function roofrServerDateTimeToEventISO(value) {
        const raw = String(value || '').trim();
        if (!raw) return null;
        const match = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
        return match ? `${match[1]}T${match[2]}` : null;
    }

    function mapCalendarEventRowToScanEvent(row) {
        const start = roofrServerDateTimeToEventISO(row?.start_date);
        const end = roofrServerDateTimeToEventISO(row?.end_date) || start;
        const attendees = Array.isArray(row?.attendees)
            ? row.attendees
            : String(row?.attendees || '').split(',').map(s => s.trim()).filter(Boolean);
        return {
            start,
            end,
            title: String(row?.title || '').trim(),
            address: row?.address || '',
            eventType: row?.category || 'Unknown',
            category: row?.category || '',
            eventId: row?.id != null ? String(row.id) : undefined,
            job_id: row?.job_id,
            jobId: row?.job_id,
            lat: row?.latitude,   // from jobs join — drives GPS region classification
            lng: row?.longitude,
            attendees,
            isAllDay: false
        };
    }

    let serverAvailabilityReady = false;
    let twoWeekAvailabilityInFlight = false;
    async function loadTwoWeekAvailability() {
        if (twoWeekAvailabilityInFlight) return false;
        twoWeekAvailabilityInFlight = true;
        try {
            const startISO = phoenixTodayISO();
            const days = Array.from({ length: 14 }, (_, i) => addDaysISO(startISO, i));
            const endISO = days[days.length - 1];
            // Only count events that actually consume appointment slots. Production has its own
            // category; retail/d2d/insurance appointments are all category 'sales' in calendar_events.
            // (Without this, all-day pickup/dropoff windows would wrongly read as booked slots.)
            const eventCategory = (userPrefs.scanProfile || 'retail') === 'production' ? 'production' : 'sales';
            const url = `https://roofr-search.vercel.app/api/calendar-events?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}&category=${encodeURIComponent(eventCategory)}`;

            addLog(`Loading server availability ${startISO} through ${endISO}...`);
            const resp = await fetch(url, {
                cache: 'no-store',
                headers: { 'X-Internal-Key': SLOT_HOLDS_INTERNAL_KEY }
            });
            if (!resp.ok) throw new Error(`Calendar events HTTP ${resp.status}`);
            const json = await resp.json();
            if (!json?.success || !Array.isArray(json.events)) throw new Error('Bad calendar events payload');

            state.weekDays = days;
            pageDatesISO = days;
            state.allEvents = json.events
                .map(mapCalendarEventRowToScanEvent)
                .filter(ev => ev.start && ev.end && ev.title);
            state.parsedJobs = state.allEvents.map(ev => CONFIG.parseJobDetails(ev));

            const distinctSundays = [...new Set(state.weekDays.map(weekSundayKey))].sort();
            const availabilityResults = await Promise.all(distinctSundays.map(s => computeAvailabilityForSunday(s)));
            state.availabilityByWeek = {};
            distinctSundays.forEach((s, i) => {
                if (availabilityResults[i]) state.availabilityByWeek[s] = availabilityResults[i];
            });
            state.availability = state.availabilityByWeek[distinctSundays[0]] || { PHX: null, SOUTH: null, NORTH: null, ALL: null };
            state.dayCutoffs = [];

            addLog(`Server availability loaded. Extracted ${state.allEvents.length} events.`);
            serverAvailabilityReady = true;
            await debouncedSaveState();
            renderUIFromState();
            updateScanButtonState();
            return true;
        } catch (e) {
            serverAvailabilityReady = false;
            addLog(`Server availability load failed: ${e.message}`, 'ERROR');
            showToast('Could not load server availability');
            return false;
        } finally {
            twoWeekAvailabilityInFlight = false;
        }
    }

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
                    await chrome.scripting.executeScript({ target: { tabId }, files: ["roofr-api.js", "reports-batch.js", "content.js"] });
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

        const metaUrl = `https://az-roofers-tech-scheduler.vercel.app/api/sheets?spreadsheetId=${encodeURIComponent(sheetId)}&fields=sheets.properties.title`;
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
        let url = `https://az-roofers-tech-scheduler.vercel.app/api/sheets?spreadsheetId=${encodeURIComponent(sheetId)}&op=batchGet`;
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
        const url = `https://az-roofers-tech-scheduler.vercel.app/api/sheets?spreadsheetId=${encodeURIComponent(sheetId)}&range=${encodeURIComponent(range)}&valueRenderOption=UNFORMATTED_VALUE`;

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
        const url = `https://az-roofers-tech-scheduler.vercel.app/api/sheets?spreadsheetId=${encodeURIComponent(CITIES_SHEET_ID)}&range=${encodeURIComponent(`${qTab}!${CITIES_RANGE}`)}`;

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

    async function fetchNorthRoutingFromSheet() {
        const apiKey = CONFIG.apiKey;
        if (!apiKey) return false;

        const qTab = `'${CITIES_SHEET_TAB.replace(/'/g, "''")}'`;
        const url = `https://az-roofers-tech-scheduler.vercel.app/api/sheets?spreadsheetId=${encodeURIComponent(CITIES_SHEET_ID)}&range=${encodeURIComponent(`${qTab}!${NORTH_ROUTING_RANGE}`)}`;

        try {
            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) throw new Error(`API error: ${res.status}`);
            const data = await res.json();
            const values = data.values || [];
            const corridorCities = new Set();
            const flagstaffCities = new Set();

            for (const row of values) {
                const route = String(row[0] || '').trim().toUpperCase();
                const cities = String(row[2] || '').split(',')
                    .map(city => city.trim().toUpperCase())
                    .filter(Boolean);

                if (route === 'I17' || route === 'SR87') {
                    for (const city of cities) corridorCities.add(city);
                } else if (route === 'FLAGSTAFF') {
                    for (const city of cities) flagstaffCities.add(city);
                }
            }

            if (!corridorCities.size || !flagstaffCities.size) return false;

            CONFIG.UP_NORTH_TRAVEL_CITIES.clear();
            for (const city of corridorCities) {
                CONFIG.UP_NORTH_TRAVEL_CITIES.add(city);
                CONFIG.REGION_CITY_WHITELISTS.PHX.add(city);
                CONFIG.REGION_CITY_WHITELISTS.NORTH.delete(city);
            }

            CONFIG.REQUIRED_NORTH_CITIES.clear();
            for (const city of flagstaffCities) {
                CONFIG.REQUIRED_NORTH_CITIES.add(city);
                CONFIG.REGION_CITY_WHITELISTS.NORTH.add(city);
            }

            return true;
        } catch (e) {
            addLog(`Failed to fetch north routing from Google Sheet: ${e.message}`, 'ERROR');
            return false;
        }
    }

    async function appendCityToSheet(city, region) {
        const apiKey = CONFIG.apiKey;
        if (!apiKey || !city || !region) return false;

        // First, get current data to find the next empty row for this region
        const qTab = `'${CITIES_SHEET_TAB.replace(/'/g, "''")}'`;
        const readUrl = `https://az-roofers-tech-scheduler.vercel.app/api/sheets?spreadsheetId=${encodeURIComponent(CITIES_SHEET_ID)}&range=${encodeURIComponent(`${qTab}!${CITIES_RANGE}`)}`;

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

    // Sunday (UTC) ISO of the calendar week containing dISO — the key for
    // state.availabilityByWeek. Matches the Sunday math used when fetching.
    function weekSundayKey(dISO) {
        const dt = new Date(dISO + "T12:00:00Z");
        dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay());
        return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    }

    // Availability map for the week that dISO falls in. Falls back to the primary
    // week's data if that week wasn't fetched. This is what lets each day card
    // read ITS OWN week's capacity when the visible range spans several weeks.
    function getAvailabilityForDate(dISO) {
        const byWeek = state.availabilityByWeek;
        if (byWeek) {
            const a = byWeek[weekSundayKey(dISO)];
            if (a) return a;
        }
        return state.availability;
    }

    // Pure availability fetch for one Sunday's week — returns the
    // {PHX,NORTH,SOUTH,ALL} map without mutating state or alerting. Used to fetch
    // each additional visible week (see runScanFlow) so multi-week / agenda day
    // cards don't all inherit the first week's numbers.
    async function computeAvailabilityForSunday(sISO) {
        if (!sISO || !CONFIG.apiKey || !settings.NEXT_SHEET_ID) return null;
        const sunDate = new Date(`${sISO}T12:00:00Z`);
        const monDate = new Date(sunDate);
        monDate.setUTCDate(sunDate.getUTCDate() + 1);
        const [primaryTab, secondaryTab] = await Promise.all([
            discoverWeeklyTabNameForDate(monDate),
            discoverWeeklyTabNameForDate(sunDate)
        ]);
        const [primaryData, secondaryData] = await Promise.all([
            fetchCapacitiesForTab(primaryTab),
            fetchCapacitiesForTab(secondaryTab)
        ]);
        const avail = { PHX: null, SOUTH: null, NORTH: null, ALL: null };
        if (!primaryData && !secondaryData) return avail;
        for (const region of ['PHX', 'NORTH', 'SOUTH']) {
            const pData = primaryData?.[region], sData = secondaryData?.[region];
            if (!pData && !sData) { avail[region] = null; continue; }
            const m = { B1: [], B2: [], B3: [], B4: [] };
            for (const key of ['B1', 'B2', 'B3', 'B4']) {
                for (let i = 0; i < 6; i++) m[key][i] = pData?.[key]?.[i] ?? 0;
                m[key][6] = sData?.[key]?.[6] ?? 0;
            }
            avail[region] = m;
        }
        avail.ALL = CONFIG.sumMaps(CONFIG.sumMaps(avail.PHX, avail.NORTH), avail.SOUTH);
        return avail;
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
        });
        // Remove reco-reason from day cards
        document.querySelectorAll(".day-card .reco-reason").forEach(el => {
            el.remove();
        });
        // Restore block-context elements and remove wrapper rows
        document.querySelectorAll(".block-context-row").forEach(row => {
            const blockContext = row.querySelector('.block-context');
            if (blockContext && row.parentNode) {
                row.parentNode.insertBefore(blockContext, row);
            }
            row.remove();
        });
    }
    // Recommended-slot callout disabled per request (slimming down the scanner):
    // address submit no longer highlights a "suggested" time block or draws the
    // "Recommendation:" box / prev-next day arrows. We still clear any stale highlight
    // (so toggling it back on is a one-line revert), then bail before drawing anything.
    // This is the single choke point for every reco path (address submit, post-scan
    // re-run, manual day-expand, prev/next nav), so neutering it removes the callout everywhere.
    const SHOW_SLOT_RECOMMENDATION = false;
    function highlightSuggested(card, blockKey, reasonText, availableReps = []) {
        clearAllSuggested();
        if (!SHOW_SLOT_RECOMMENDATION) return;
        const target = card.querySelector(`.block-item[data-block-key="${blockKey}"]`);
        if (target) {
            target.classList.add("suggested");

            // Day-based navigation: check if there are multiple days with recommendations
            const hasMultipleDays = state.recoAvailableDays && state.recoAvailableDays.length > 1;

            // Create recommendation container inside the block
            const reasonDiv = document.createElement('div');
            reasonDiv.className = 'reco-reason';

            // Recommendation text with day position indicator
            const textDiv = document.createElement('div');
            const totalDays = state.recoAvailableDays?.length || 1;
            const currentDayPos = (state.recoDayIndex || 0) + 1;
            const posIndicator = totalDays > 1 ? ` <span style="opacity:0.7">(Day ${currentDayPos}/${totalDays})</span>` : '';
            textDiv.innerHTML = `<strong>Recommendation${posIndicator}:</strong> ${reasonText}`;
            reasonDiv.appendChild(textDiv);

            // Insert recommendation inside the block-item
            target.appendChild(reasonDiv);

            // Always show prev/next navigation arrows (outside reco box, next to cities)
            const navRow = document.createElement('div');
            navRow.className = 'reco-nav-row reco-nav-external';

            const prevBtn = document.createElement('button');
            prevBtn.className = 'reco-nav-btn';
            prevBtn.type = 'button';
            prevBtn.innerHTML = '&#9664;'; // ◀
            prevBtn.title = 'Previous day';
            if (!hasMultipleDays) {
                prevBtn.disabled = true;
                prevBtn.style.opacity = '0.4';
            }
            prevBtn.addEventListener('click', (e) => {
                console.log('[RECO DEBUG] Prev day button CLICKED');
                e.stopPropagation();
                e.preventDefault();
                handlePrevRecommendation();
            });

            const nextBtn = document.createElement('button');
            nextBtn.className = 'reco-nav-btn';
            nextBtn.type = 'button';
            nextBtn.innerHTML = '&#9654;'; // ▶
            nextBtn.title = 'Next day';
            if (!hasMultipleDays) {
                nextBtn.disabled = true;
                nextBtn.style.opacity = '0.4';
            }
            nextBtn.addEventListener('click', (e) => {
                console.log('[RECO DEBUG] Next button CLICKED');
                e.stopPropagation();
                e.preventDefault();
                handleNextRecommendation();
            });

            navRow.appendChild(prevBtn);
            navRow.appendChild(nextBtn);

            // Find the block-context (cities line) and add nav next to it
            const blockContext = target.querySelector('.block-context');
            if (blockContext) {
                // Wrap cities and nav in a flex container
                const wrapper = document.createElement('div');
                wrapper.className = 'block-context-row';
                blockContext.parentNode.insertBefore(wrapper, blockContext);
                wrapper.appendChild(blockContext);
                wrapper.appendChild(navRow);
            } else {
                // No cities shown, create a row just for nav
                const wrapper = document.createElement('div');
                wrapper.className = 'block-context-row';
                wrapper.appendChild(navRow);
                // Insert before the reco-reason
                reasonDiv.parentNode.insertBefore(wrapper, reasonDiv);
            }

            // Note: Scrolling is handled by the caller to allow control over scroll behavior
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
        // Use the availability for THIS date's week (the visible range may span
        // several weeks; each card must read its own week's capacity).
        const dayAvail = getAvailabilityForDate(dateStr);
        const totals = CONFIG.computeDailyTotals(dateStr, eventsForDay, dayAvail, state.currentRegion);
        const d = new Date(dateStr + "T00:00");
        const card = document.createElement("div");
        card.className = "day-card"; card.dataset.date = dateStr;

        const todayISO = phoenixTodayISO();
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

        const tomorrowISO = addDaysISO(todayISO, 1);
        const isTomorrowAfterCutoff = dateStr === tomorrowISO && isAfter5pmMST;

        // Check if this day is cutoff (but not for past days)
        // Today always shows "Reps Scheduled", tomorrow shows it after 5pm MST
        const dayOfWeek = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
        const monFirstIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convert to Mon=0, ..., Sun=6
        const isCutoff = !isPast && (isToday || (state.dayCutoffs && state.dayCutoffs[monFirstIndex]) || isTomorrowAfterCutoff);
        if (isCutoff) card.classList.add("day-cutoff");

        // Mark days that should be shrunk (past, no availability, or reps scheduled/cutoff).
        // EXCEPT today — keep it full-sized so reps can see today's events and any
        // late-cancellation slots. The "Reps Scheduled" badge still appears.
        const noAvailability = totals.capacity === 0;
        if (!isToday && (isPast || noAvailability || isCutoff)) {
            card.classList.add("day-shrunk");
        }

        // Header
        const header = document.createElement('div');
        header.className = 'card-header';

        let badgesHtml = '';
        if (isCutoff) {
            badgesHtml += `<span class="badge warning" style="background: #f59e0b; color: white;">Reps Scheduled</span> `;
        } else if (isPast && !noAvailability) {
            // Past day with availability set - reps were scheduled
            badgesHtml += `<span class="badge warning" style="background: #f59e0b; color: white;">Reps Scheduled</span> `;
        } else if (noAvailability) {
            // No capacity set for this day
            badgesHtml += `<span class="badge muted">No Availability</span>`;
        } else {
            if (totals.dayOver > 0) badgesHtml += `<span class="badge danger">${totals.dayOver} Over</span> `;
            if (totals.netAvailable > 0) badgesHtml += `<span class="badge success">${totals.netAvailable} Open</span>`;
            else if (totals.dayOver === 0) badgesHtml += `<span class="badge neutral">Full</span>`;
        }

        // Reserved indicator — only the rep who reserved sees it (others just see reduced
        // availability), and it stays visible even when the day card is collapsed.
        const myRepId = currentRepIdentity?.rep_id;
        const dayHoldCount = myRepId ? [...slotHolds.values()].filter(h =>
            String(h.region || '').toUpperCase() === String(state.currentRegion || '').toUpperCase()
            && h.hold_date === dateStr && h.rep_id === myRepId
        ).length : 0;
        if (dayHoldCount > 0) badgesHtml += ` <span class="badge reserved-badge">&#128274; ${dayHoldCount} reserved</span>`;

        // Recommendation time badge removed per request — keeps the scan list clean.
        // The address-based tool still highlights a suggested slot when invoked.

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
                                addCityToRegionWhitelist(city, region);

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
                                addCityToRegionWhitelist(city, region);

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
            const cap = CONFIG.getCapacity(state.currentRegion, d.getDay(), blk.key, dayAvail);
            const regionKey = String(state.currentRegion || '').toUpperCase();
            const holds = [...slotHolds.values()].filter(hold =>
                hold.region === regionKey && hold.hold_date === dateStr && hold.block === blk.key
            );
            const heldCount = holds.length;
            const me = currentRepIdentity?.rep_id;
            const myHold = me ? holds.find(hold => hold.rep_id === me) : null;
            const others = me ? holds.filter(hold => hold.rep_id !== me) : holds;
            const remaining = Number.isFinite(cap) ? cap - booked - heldCount : null;

            // Auto-release: when a real booking lands in a slot I reserved (the booked count rises
            // above what it was when I placed the hold), drop my hold so it flips cleanly to
            // "booked" instead of double-counting (hold + booking). `booked` here is already
            // region-correct (computeDailyTotals over this region's events).
            if (myHold) {
                const base = holdBookingBaseline.get(myHold.id);
                if (base === undefined) holdBookingBaseline.set(myHold.id, booked);
                else if (booked > base) { holdBookingBaseline.delete(myHold.id); releaseSlot(myHold); }
                else if (booked < base) holdBookingBaseline.set(myHold.id, booked);
            }

            if (remaining !== null && remaining < 0) div.classList.add("over");
            else if (remaining === 0) div.classList.add("full"); // fully booked -> red highlight
            if (myHold) div.classList.add("slot-reserved"); // dark blue/purple — only the rep who reserved it

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
                const cityUpper = c.toUpperCase();
                const highlightedUpper = (state.highlightedCity || '').toUpperCase();

                if (highlightedUpper && cityUpper === highlightedUpper) {
                    // Primary city - yellow highlight
                    classes.push("city-text-highlight");
                } else if (highlightedUpper && CONFIG.isAdjacentTo(cityUpper, highlightedUpper)) {
                    // Adjacent city - light blue highlight
                    classes.push("city-text-highlight-adjacent");
                }
                return `<span class="${classes.join(' ')}">${c}</span>`;
            });

            const citiesHtml = cityItems.length > 0 ? `<span class="block-context" title="Scheduled: ${uniqueCities.join(", ")}">${cityItems.join(", ")}</span>` : '';
            // Other reps just see a held slot as unavailable (the count is reduced below) — no
            // "being booked by {rep}" badge, to keep their view uncluttered.
            const lockBadgesHtml = '';
            // Reserve button renders INLINE inside the block-line; held-state row renders below.
            const reserveInlineHtml = (!myHold && remaining !== null && remaining > 0)
                ? `<button class="btn reserve-slot-btn" data-date="${dateStr}" data-region="${regionKey}" data-block="${blk.key}">Reserve</button>`
                : '';
            let slotActionHtml = '';
            if (myHold) {
                slotActionHtml = `
        <div class="slot-held-row">
            <span class="slot-held-you">Held by you</span>
            <span data-slot-expires-at="${_escapeHtml(myHold.expires_at)}">${formatSlotCountdown(myHold.expires_at)}</span>
            <button class="btn release-slot-btn" data-hold-id="${_escapeHtml(myHold.id)}">Release</button>
        </div>
    `;
            }

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
        <div class="block-line">
            <span class="time-slot">${blk.label}</span>
            ${statusHtml ? `<span class="block-sep">·</span>${statusHtml}` : ''}
            ${citiesHtml ? `<span class="block-sep">·</span>${citiesHtml}` : ''}
            ${lockBadgesHtml}
            <span class="sheet-cap">${booked + heldCount}/${cap !== null ? cap : '-'}</span>
            ${reserveInlineHtml}
        </div>
        ${slotActionHtml}
        ${assignedHtml}
    `;

            const reserveBtn = div.querySelector('.reserve-slot-btn');
            if (reserveBtn) {
                reserveBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    reserveBtn.disabled = true;
                    await claimSlot(reserveBtn.dataset.date, reserveBtn.dataset.region, reserveBtn.dataset.block);
                });
            }

            const releaseBtn = div.querySelector('.release-slot-btn');
            if (releaseBtn && myHold) {
                releaseBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    releaseBtn.disabled = true;
                    await releaseSlot(myHold);
                });
            }

            const openRoofrSlotBtn = div.querySelector('.open-roofr-slot-btn');
            if (openRoofrSlotBtn) {
                openRoofrSlotBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await openDailyCalendarForDate(openRoofrSlotBtn.dataset.date);
                });
            }

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

        // (Removed: full-width "Copy Day" button at the bottom of the card — per request.
        //  The small "Copy" button in the day header still handles per-day copy.)

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
            if (willExpand) expandedDays.add(dateStr); else expandedDays.delete(dateStr);

            // Handle Uncategorized Box visibility if preference dictates
            if (card.uncatBox && !userPrefs.showUncatCollapsed) {
                if (willExpand) card.uncatBox.classList.remove('hidden');
                else card.uncatBox.classList.add('hidden');
            }

            // When manually expanding a day that has a recommendation, show it
            if (willExpand && state.recoBestPerDay?.[dateStr]) {
                const reco = state.recoBestPerDay[dateStr];
                // Update recoDayIndex to match manually expanded day
                const dayIdx = state.recoAvailableDays?.indexOf(dateStr);
                if (dayIdx !== -1 && dayIdx !== undefined) {
                    state.recoDayIndex = dayIdx;
                    state.recoCandidates = [reco];
                    state.recoIndex = 0;
                }
                // Highlight the recommendation after a short delay (to let DOM update)
                setTimeout(() => {
                    highlightSuggested(card, reco.blockKey, reco.reason);
                    // Smooth scroll for user-initiated expansion
                    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 50);
            } else if (!willExpand) {
                // When collapsing, clear suggestion from this card
                const suggested = card.querySelector('.block-item.suggested');
                if (suggested) {
                    suggested.classList.remove('suggested');
                    const reasonDiv = suggested.querySelector('.reco-reason');
                    if (reasonDiv) reasonDiv.remove();
                    const navRow = suggested.querySelector('.block-context-row');
                    if (navRow) navRow.remove();
                }
            }

            updateToggleAllLabel();
        });

        // Right-click: Open daily calendar view with appropriate people selected
        header.addEventListener("contextmenu", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await openDailyCalendarForDate(dateStr);
        });

        // Determine collapse state:
        // - If there's an active recommendation search, only expand the first available day
        // - Otherwise, respect the auto_expand_days user preference
        const isFirstRecoDay = state.recoAvailableDays?.length > 0 &&
                               state.recoAvailableDays[state.recoDayIndex || 0] === dateStr;
        const hasActiveReco = state.recoBestPerDay && Object.keys(state.recoBestPerDay).length > 0;

        if (hasActiveReco) {
            // In recommendation mode: only expand the current recommended day
            setCardCollapsed(card, !isFirstRecoDay);
        } else {
            // Normal mode: respect user preference
            setCardCollapsed(card, !userPrefs.autoExpandDays);
        }
        // Keep days the user manually expanded OPEN across re-renders (5s holds poll, 5-min refresh).
        if (expandedDays.has(dateStr)) setCardCollapsed(card, false);
        // If userPrefs.showUncatCollapsed is true, uncatBox is already visible.

        return card;
    }

    function buildCopyLinesForDay(dateStr, eventsForDay) {
        const day = new Date(dateStr + "T00:00");
        // Order jobs by time slot first (chronological), then left-to-right by
        // on-screen position within the same slot (weekly view tiles same-time
        // appts side by side). So: all the 8-10s left→right, then all the 11-1s,
        // etc. domLeft comes from the scan; falls back gracefully when position
        // data is absent (older cached scans, agenda/daily's single column).
        const sorted = [...eventsForDay].sort((a, b) => {
            const ts = new Date(a.start) - new Date(b.start);
            if (ts !== 0) return ts;
            const la = (a.domLeft ?? Infinity), lb = (b.domLeft ?? Infinity);
            if (la !== lb) return la - lb;
            return (a.domTop ?? 0) - (b.domTop ?? 0);
        });
        const dateHeader = day.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
        const result = [dateHeader, `Total: ${sorted.length} jobs`, ""];

        // Format time as "8:30am" style
        function formatTime(date) {
            const d = new Date(date);
            let hours = d.getHours();
            const minutes = d.getMinutes();
            const ampm = hours >= 12 ? 'pm' : 'am';
            hours = hours % 12;
            hours = hours ? hours : 12; // 0 should be 12
            const minStr = minutes < 10 ? '0' + minutes : minutes;
            return `${hours}:${minStr}${ampm}`;
        }

        // Show ALL jobs with their exact start and end times
        sorted.forEach(ev => {
            const city = (CONFIG.getCityFromEvent(ev) || "UNCAT").toUpperCase();
            const rawTitle = ev.title || "";
            const title = rawTitle.trim();
            const startTime = formatTime(ev.start);
            const endTime = formatTime(ev.end);
            const timeRange = `${startTime}-${endTime}`;

            // Build the line with exact time range
            const cityRegex = new RegExp(`^${city}`, 'i');
            if (cityRegex.test(title)) {
                result.push(`${timeRange} - ${title}`);
            } else {
                result.push(`${timeRange} - ${city} - ${title}`);
            }
        });

        result.push("");
        return result;
    }
    function buildCopyLinesForWeek() {
        if (!state.weekDays || state.weekDays.length === 0) return ["No days detected."];
        const days = state.weekDays;
        return days.flatMap(d => [...buildCopyLinesForDay(d, (state.allEvents || []).filter(e => localDayKey(e.start) === d)), ""]);
    }

    /* ========= Production Copy Functions ========= */
    function isAllDayEvent(event) {
        // Check if event is explicitly marked as all-day
        if (event.isAllDay === true) return true;

        if (!event.start || !event.end) return true;

        const start = new Date(event.start);
        const end = new Date(event.end);

        // Check if duration is >= 23 hours
        const durationHours = (end - start) / (1000 * 60 * 60);
        if (durationHours >= 23) return true;

        // Check if times are midnight to midnight or 00:00 to 23:59
        if (start.getHours() === 0 && start.getMinutes() === 0 &&
            (end.getHours() === 23 && end.getMinutes() === 59 ||
             end.getHours() === 0 && end.getMinutes() === 0)) {
            return true;
        }

        return false;
    }

    function formatEventTime(event) {
        if (isAllDayEvent(event)) return null;

        const start = new Date(event.start);
        const end = new Date(event.end);

        // Format start time - simplified (7am not 7:00am)
        const startHours = start.getHours();
        const startMinutes = start.getMinutes();
        const startAmpm = startHours >= 12 ? 'pm' : 'am';
        const startDisplayHours = startHours % 12 || 12;
        const startDisplayMinutes = startMinutes > 0 ? `:${String(startMinutes).padStart(2, '0')}` : '';

        // Format end time
        const endHours = end.getHours();
        const endMinutes = end.getMinutes();
        const endAmpm = endHours >= 12 ? 'pm' : 'am';
        const endDisplayHours = endHours % 12 || 12;
        const endDisplayMinutes = endMinutes > 0 ? `:${String(endMinutes).padStart(2, '0')}` : '';

        // Return simplified time range (7am - 9am, not 7:00am - 9:00am)
        return `${startDisplayHours}${startDisplayMinutes}${startAmpm} - ${endDisplayHours}${endDisplayMinutes}${endAmpm}`;
    }

    function buildProductionCopyLinesForDay(dateStr, events) {
        if (!events || events.length === 0) return [];

        const result = [];

        // Parse date and format day header
        const date = new Date(dateStr + 'T12:00:00');
        const dayHeader = date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
        result.push(dayHeader);
        result.push("");

        // Group events by type
        const dropoffs = events.filter(e =>
            e.eventType === 'Dropoffs and pickups' ||
            (isAllDayEvent(e) && !e.eventType) // Fallback for all-day events without type
        );
        const production = events.filter(e => e.eventType === 'Production');
        const postProduction = events.filter(e => e.eventType === 'Post-production');

        // Sort function for timed events
        const sortByTime = (a, b) => {
            const timeA = new Date(a.start).getTime();
            const timeB = new Date(b.start).getTime();
            if (timeA === timeB) {
                return (a.title || '').localeCompare(b.title || '');
            }
            return timeA - timeB;
        };

        // DROPOFFS section (all-day events)
        if (dropoffs.length > 0) {
            result.push("DROPOFFS:");
            dropoffs.forEach(event => {
                result.push(`- ${event.title}`);
            });
            result.push("");
        }

        // PRODUCTION section
        if (production.length > 0) {
            result.push("PRODUCTION:");
            production.sort(sortByTime).forEach(event => {
                const time = formatEventTime(event);
                if (time) {
                    result.push(`${time} - ${event.title}`);
                } else {
                    result.push(`- ${event.title}`);
                }
            });
            result.push("");
        }

        // POST-PRODUCTION section
        if (postProduction.length > 0) {
            result.push("POST-PRODUCTION:");
            postProduction.sort(sortByTime).forEach(event => {
                const time = formatEventTime(event);
                if (time) {
                    result.push(`${time} - ${event.title}`);
                } else {
                    result.push(`- ${event.title}`);
                }
            });
            result.push("");
        }

        return result;
    }

    function buildProductionCopyLinesForWeek(events) {
        if (!state.weekDays || state.weekDays.length === 0) return ["No days detected."];
        if (!events || events.length === 0) return ["No production events found."];

        const days = state.weekDays;
        const lines = [];

        days.forEach((dateStr, index) => {
            const dayEvents = events.filter(e => {
                const eventDate = localDayKey(e.start);
                // Handle multi-day events - show on each day they span
                if (isAllDayEvent(e) && e.start && e.end) {
                    const start = new Date(e.start);
                    const end = new Date(e.end);
                    const current = new Date(dateStr + 'T12:00:00');
                    return current >= start && current <= end;
                }
                return eventDate === dateStr;
            });

            const dayLines = buildProductionCopyLinesForDay(dateStr, dayEvents);
            if (dayLines.length > 0) {
                lines.push(...dayLines);
                // Add blank line between days (but not after the last day)
                if (index < days.length - 1) {
                    lines.push("");
                }
            }
        });

        return lines.length > 0 ? lines : ["No production events found."];
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
    async function applyRegionFilter() {
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

        if (SHOW_SLOT_RECOMMENDATION && state.recoCandidates && state.recoCandidates.length > 0 && state.recoIndex < state.recoCandidates.length) {
            const current = state.recoCandidates[state.recoIndex];
            const card = document.querySelector(`.day-card[data-date="${current.dateStr}"]`);
            if (card) {
                setCardCollapsed(card, false);

                // If candidate has repName (from smart API), use that; otherwise fetch from sheet
                let availableReps = [];
                if (current.repName) {
                    availableReps = [current.repName];
                } else {
                    const targetDate = new Date(current.dateStr + "T00:00");
                    availableReps = await fetchRepsForSlot(targetDate, current.blockKey);
                }

                highlightSuggested(card, current.blockKey, current.reason, availableReps);
                // Instant scroll to prevent flash during UI updates
                card.scrollIntoView({ behavior: 'instant', block: 'center' });
            }
        }
    }
    function renderDays(filteredEvents) {
        daysWrap.innerHTML = "";
        if (!state.weekDays || state.weekDays.length === 0) {
            daysWrap.innerHTML = '<div style="text-align: center; padding: 32px; color: #64748b;"><h3 style="font-weight: 600; margin-bottom:8px;">Ready to Scan</h3><p style="font-size: 12px;">Click "Scan Page" to load data.</p></div>';
            return;
        }
        // On multi-day views (weekly / agenda / monthly) keep yesterday + today +
        // future, and hide only days before yesterday — reps need to see/copy
        // today's and yesterday's appointments too. The daily view always shows
        // its single day.
        const scanView = userPrefs?.scanView || 'weekly';
        let week = state.weekDays;
        if (scanView !== 'daily') {
            const cutoffISO = addDaysISO(phoenixTodayISO(), -1); // cutoff = yesterday (Arizona), inclusive
            week = state.weekDays.filter(d => d >= cutoffISO);
        }
        if (week.length === 0) {
            daysWrap.innerHTML = '<div style="text-align: center; padding: 32px; color: #64748b;"><h3 style="font-weight: 600; margin-bottom:8px;">No recent or upcoming days</h3><p style="font-size: 12px;">Every scanned day is before yesterday. Switch to Daily view or scan a more recent week.</p></div>';
            footerTotal.textContent = `Total: ${(state.allEvents || []).length} booked`;
            updateToggleAllLabel();
            return;
        }
        const groups = new Map(week.map(iso => [iso, []]));
        for (const e of filteredEvents) {
            const key = localDayKey(e.start);
            if (groups.has(key)) groups.get(key).push(e);
        }
        // Alternate background per calendar week (Mon-Sun) so the strip
        // visually breaks at week boundaries. Tag each card with stripe-a or
        // stripe-b based on the Monday of the week it belongs to.
        let lastWeekKey = null;
        let stripeIndex = -1;
        week.forEach(d => {
            const card = renderDayCard(d, groups.get(d));
            const dt = new Date(d + "T00:00");
            const monday = new Date(dt);
            // (dt.getDay()+6)%7 -> 0 for Mon, 6 for Sun
            monday.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
            const weekKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
            if (weekKey !== lastWeekKey) { stripeIndex++; lastWeekKey = weekKey; }
            card.classList.add(stripeIndex % 2 === 0 ? 'week-stripe-a' : 'week-stripe-b');
            daysWrap.appendChild(card);
        });

        let grandTotalBooked = (state.allEvents || []).length;
        footerTotal.textContent = `Total: ${grandTotalBooked} booked`;
        updateToggleAllLabel();
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
        // Tracks the last value THIS instance wrote, so we can ignore the
        // storage.onChanged echo of our own save (fires for both sync + local
        // areas, in every context including this popup window). Without this,
        // re-assigning innerHTML collapses the caret mid-typing.
        let dockNoteLastWritten = null;

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
            const change = changes[DOCK_NOTE_KEY];
            if (!change) return;
            const incoming = change.newValue || '';
            // Ignore the echo of our own save (fires for both sync + local areas).
            if (incoming === dockNoteLastWritten) return;
            // Never clobber the caret while the user is editing here.
            if (document.activeElement === dockNoteInput) return;
            // No-op if the content is already identical (avoids caret reset).
            if (dockNoteInput.innerHTML === incoming) return;
            dockNoteInput.innerHTML = incoming;
        });

        // Auto-save on input with debounce (to both sync and local)
        dockNoteInput.addEventListener('input', () => {
            clearTimeout(dockNoteDebounce);
            dockNoteDebounce = setTimeout(() => {
                const content = dockNoteInput.innerHTML;
                // Remember what we wrote so onChanged can skip our own echo.
                dockNoteLastWritten = content;
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

        // Allow clicking links inside the notes area (contenteditable captures clicks)
        dockNoteInput.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (link && link.href) {
                e.preventDefault();
                e.stopPropagation();
                window.open(link.href, '_blank');
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

    // === DOCK NOTES UNDO / REDO ===
    const dockNoteUndo = document.getElementById('dock-note-undo');
    const dockNoteRedo = document.getElementById('dock-note-redo');

    if (dockNoteUndo && dockNoteInput) {
        dockNoteUndo.addEventListener('click', () => {
            dockNoteInput.focus();
            document.execCommand('undo');
        });
    }
    if (dockNoteRedo && dockNoteInput) {
        dockNoteRedo.addEventListener('click', () => {
            dockNoteInput.focus();
            document.execCommand('redo');
        });
    }

    // Ctrl+Shift+Z as alternative redo (browser handles Ctrl+Z/Y natively in contenteditable)
    if (dockNoteInput) {
        dockNoteInput.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
                e.preventDefault();
                document.execCommand('redo');
            }
            // Ctrl+A selects only within the notes area, not the whole page
            if (e.ctrlKey && !e.shiftKey && e.key === 'a') {
                e.preventDefault();
                const range = document.createRange();
                range.selectNodeContents(dockNoteInput);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }
        });
    }

    // === DOCK NOTES CONTEXT MENU ===
    const dockNotesContextMenu = document.getElementById('dock-notes-context-menu');

    // Helper to get plain text from HTML
    function getTextFromHtml(html) {
        const temp = document.createElement('div');
        temp.innerHTML = html;
        return temp.innerText || temp.textContent || '';
    }

    // Saved selection text from right-click (captured before menu steals focus)
    let savedSelectionText = '';

    if (dockNotesContextMenu && dockNoteInput) {
        // Show context menu on right-click in dock notes area
        dockNoteInput.addEventListener('contextmenu', (e) => {
            e.preventDefault();

            // Capture selection NOW before menu click clears it
            const sel = window.getSelection();
            if (sel && sel.toString().trim().length > 0 && dockNoteInput.contains(sel.anchorNode)) {
                savedSelectionText = sel.toString();
            } else {
                savedSelectionText = '';
            }

            // Position the menu at mouse location
            const x = e.clientX;
            const y = e.clientY;

            // Get viewport dimensions
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            // Show menu temporarily to get its dimensions
            dockNotesContextMenu.style.left = '-9999px';
            dockNotesContextMenu.classList.add('show');
            const menuWidth = dockNotesContextMenu.offsetWidth;
            const menuHeight = dockNotesContextMenu.offsetHeight;

            // Calculate position, ensuring menu stays in viewport
            let posX = x;
            let posY = y;

            if (x + menuWidth > viewportWidth) {
                posX = viewportWidth - menuWidth - 10;
            }
            if (y + menuHeight > viewportHeight) {
                posY = y - menuHeight;
            }

            dockNotesContextMenu.style.left = `${posX}px`;
            dockNotesContextMenu.style.top = `${posY}px`;
        });

        // Hide context menu when clicking elsewhere
        document.addEventListener('click', (e) => {
            if (!dockNotesContextMenu.contains(e.target)) {
                dockNotesContextMenu.classList.remove('show');
            }
        });

        // Hide on scroll
        document.addEventListener('scroll', () => {
            dockNotesContextMenu.classList.remove('show');
        }, true);

        // Handle context menu actions
        dockNotesContextMenu.addEventListener('click', async (e) => {
            const menuItem = e.target.closest('.menu-item');
            if (!menuItem) return;

            const action = menuItem.dataset.action;
            const content = dockNoteInput.innerHTML.trim();

            switch (action) {
                case 'copy':
                    // Copy highlighted text if any was selected at right-click, otherwise copy all
                    {
                        const hasSelection = savedSelectionText.length > 0;
                        const textToCopy = hasSelection ? savedSelectionText : getTextFromHtml(content);
                        if (textToCopy) {
                            try {
                                await navigator.clipboard.writeText(textToCopy);
                                showToast(hasSelection ? 'Selection copied' : 'Copied to clipboard');
                            } catch (err) {
                                console.error('Failed to copy:', err);
                                showToast('Failed to copy');
                            }
                        } else {
                            showToast('Nothing to copy');
                        }
                    }
                    break;

                case 'save':
                    // Save to Notes clipboard (existing functionality)
                    if (content) {
                        addNewClipboard(content, "Quick Note " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

                        // Auto-enable clipboard tab if hidden
                        if (!userPrefs.showClipboardTab) {
                            userPrefs.showClipboardTab = true;
                            saveUserPrefs();
                            if (chrome.storage && chrome.storage.sync) {
                                chrome.storage.sync.set({ show_clipboard: true });
                            }
                            applyUserPrefs();
                        }

                        showToast('Saved to Notes');
                    } else {
                        showToast('Nothing to save');
                    }
                    break;

                case 'download':
                    // Download as text file
                    if (content) {
                        const plainText = getTextFromHtml(content);
                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                        const filename = `notes-${timestamp}.txt`;

                        const blob = new Blob([plainText], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);

                        showToast('Downloaded');
                    } else {
                        showToast('Nothing to download');
                    }
                    break;

                case 'paste-plain':
                    // Paste clipboard contents as plain text
                    try {
                        const clipText = await navigator.clipboard.readText();
                        if (clipText) {
                            dockNoteInput.focus();
                            document.execCommand('insertText', false, clipText);
                            showToast('Pasted as plain text');
                        } else {
                            showToast('Clipboard is empty');
                        }
                    } catch (err) {
                        console.error('Failed to paste:', err);
                        showToast('Failed to read clipboard');
                    }
                    break;

                case 'find-replace':
                    // Show the find & replace bar
                    {
                        const findBar = document.getElementById('dock-notes-find-bar');
                        if (findBar) {
                            findBar.style.display = 'block';
                            const findInput = document.getElementById('dock-notes-find-input');
                            if (findInput) {
                                // Pre-fill with selected text if any
                                if (savedSelectionText) findInput.value = savedSelectionText;
                                findInput.focus();
                                findInput.select();
                            }
                        }
                    }
                    break;

                case 'clear':
                    // Clear the notes content
                    if (content) {
                        dockNoteInput.innerHTML = '';
                        // Clear auto-saved note from storage
                        const DOCK_NOTE_KEY = 'roofr_dock_note';
                        chrome.storage.sync.remove(DOCK_NOTE_KEY);
                        chrome.storage.local.remove(DOCK_NOTE_KEY);
                        dockNoteInput.dispatchEvent(new Event('input', { bubbles: true }));
                        showToast('Notes cleared');
                    } else {
                        showToast('Already empty');
                    }
                    break;
            }

            // Hide menu after action
            dockNotesContextMenu.classList.remove('show');
        });
    }

    // === DOCK NOTES FIND & REPLACE ===
    {
        const findBar = document.getElementById('dock-notes-find-bar');
        const findInput = document.getElementById('dock-notes-find-input');
        const replaceInput = document.getElementById('dock-notes-replace-input');
        const findCount = document.getElementById('dock-notes-find-count');
        const findPrev = document.getElementById('dock-notes-find-prev');
        const findNext = document.getElementById('dock-notes-find-next');
        const replaceOne = document.getElementById('dock-notes-replace-one');
        const replaceAll = document.getElementById('dock-notes-replace-all');
        const findClose = document.getElementById('dock-notes-find-close');

        let findMatches = [];
        let findIndex = -1;
        const HIGHLIGHT_CLASS = 'dock-note-find-highlight';
        const ACTIVE_CLASS = 'dock-note-find-active';

        function clearHighlights() {
            if (!dockNoteInput) return;
            // Remove highlight spans and restore original text
            const highlights = dockNoteInput.querySelectorAll('.' + HIGHLIGHT_CLASS);
            highlights.forEach(span => {
                const parent = span.parentNode;
                parent.replaceChild(document.createTextNode(span.textContent), span);
                parent.normalize();
            });
            findMatches = [];
            findIndex = -1;
            if (findCount) findCount.textContent = '0/0';
        }

        function doFind() {
            clearHighlights();
            const query = findInput ? findInput.value : '';
            if (!query || !dockNoteInput) return;

            // Walk text nodes and wrap matches
            const walker = document.createTreeWalker(dockNoteInput, NodeFilter.SHOW_TEXT, null);
            const textNodes = [];
            while (walker.nextNode()) textNodes.push(walker.currentNode);

            const lowerQuery = query.toLowerCase();
            textNodes.forEach(node => {
                const text = node.textContent;
                const lowerText = text.toLowerCase();
                let idx = lowerText.indexOf(lowerQuery);
                if (idx === -1) return;

                const frag = document.createDocumentFragment();
                let lastIdx = 0;
                while (idx !== -1) {
                    if (idx > lastIdx) frag.appendChild(document.createTextNode(text.slice(lastIdx, idx)));
                    const span = document.createElement('span');
                    span.className = HIGHLIGHT_CLASS;
                    span.style.cssText = 'background: #fbbf24; color: #000; border-radius: 2px;';
                    span.textContent = text.slice(idx, idx + query.length);
                    frag.appendChild(span);
                    lastIdx = idx + query.length;
                    idx = lowerText.indexOf(lowerQuery, lastIdx);
                }
                if (lastIdx < text.length) frag.appendChild(document.createTextNode(text.slice(lastIdx)));
                node.parentNode.replaceChild(frag, node);
            });

            findMatches = Array.from(dockNoteInput.querySelectorAll('.' + HIGHLIGHT_CLASS));
            if (findMatches.length > 0) {
                findIndex = 0;
                activateMatch();
            }
            updateCount();
        }

        function activateMatch() {
            // Remove active from all
            findMatches.forEach(m => {
                m.style.background = '#fbbf24';
                m.classList.remove(ACTIVE_CLASS);
            });
            if (findIndex >= 0 && findIndex < findMatches.length) {
                const active = findMatches[findIndex];
                active.style.background = '#f97316';
                active.classList.add(ACTIVE_CLASS);
                active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
            updateCount();
        }

        function updateCount() {
            if (findCount) {
                findCount.textContent = findMatches.length > 0
                    ? `${findIndex + 1}/${findMatches.length}`
                    : '0/0';
            }
        }

        if (findInput) {
            findInput.addEventListener('input', doFind);
            findInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.shiftKey) { // Shift+Enter = prev
                        if (findMatches.length) { findIndex = (findIndex - 1 + findMatches.length) % findMatches.length; activateMatch(); }
                    } else { // Enter = next
                        if (findMatches.length) { findIndex = (findIndex + 1) % findMatches.length; activateMatch(); }
                    }
                }
                if (e.key === 'Escape') { closeFindBar(); }
            });
        }
        if (replaceInput) {
            replaceInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') closeFindBar();
            });
        }
        if (findNext) findNext.addEventListener('click', () => {
            if (findMatches.length) { findIndex = (findIndex + 1) % findMatches.length; activateMatch(); }
        });
        if (findPrev) findPrev.addEventListener('click', () => {
            if (findMatches.length) { findIndex = (findIndex - 1 + findMatches.length) % findMatches.length; activateMatch(); }
        });
        if (replaceOne) replaceOne.addEventListener('click', () => {
            if (findIndex >= 0 && findIndex < findMatches.length && replaceInput) {
                const match = findMatches[findIndex];
                match.replaceWith(document.createTextNode(replaceInput.value));
                dockNoteInput.dispatchEvent(new Event('input', { bubbles: true }));
                doFind(); // Re-search
            }
        });
        if (replaceAll) replaceAll.addEventListener('click', () => {
            if (findMatches.length && replaceInput) {
                const count = findMatches.length;
                findMatches.forEach(match => {
                    match.replaceWith(document.createTextNode(replaceInput.value));
                });
                dockNoteInput.dispatchEvent(new Event('input', { bubbles: true }));
                clearHighlights();
                showToast(`Replaced ${count} match${count !== 1 ? 'es' : ''}`);
            }
        });

        function closeFindBar() {
            clearHighlights();
            if (findBar) findBar.style.display = 'none';
            if (findInput) findInput.value = '';
            if (replaceInput) replaceInput.value = '';
            dockNoteInput.focus();
        }

        if (findClose) findClose.addEventListener('click', closeFindBar);

        // Ctrl+H opens find & replace from within notes
        if (dockNoteInput) {
            dockNoteInput.addEventListener('keydown', (e) => {
                if (e.ctrlKey && e.key === 'h') {
                    e.preventDefault();
                    if (findBar) {
                        findBar.style.display = 'block';
                        const sel = window.getSelection();
                        if (sel && sel.toString().trim() && findInput) {
                            findInput.value = sel.toString();
                        }
                        if (findInput) { findInput.focus(); findInput.select(); }
                    }
                }
            });
        }
    }

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

    const copyProductionWeekBtn = document.getElementById("copyProductionWeekBtn");
    if (copyProductionWeekBtn) {
        copyProductionWeekBtn.addEventListener("click", async () => {
            try {
                // Show loading state
                copyProductionWeekBtn.disabled = true;
                const originalText = copyProductionWeekBtn.textContent;
                copyProductionWeekBtn.textContent = "Scanning...";
                addLog("Switching to production event types...");

                // 1. Select production event types
                const filterResult = await sendFindCommand({
                    type: "SELECT_PRODUCTION_EVENT_TYPES"
                });

                if (!filterResult.ok) {
                    throw new Error("Failed to select production event types");
                }

                addLog("Production event types selected, waiting for calendar update...");

                // 2. Wait for calendar to update (500ms)
                await new Promise(resolve => setTimeout(resolve, 500));

                // 3. Re-scan events with production filters
                addLog("Extracting production events...");
                const scanResult = await sendFindCommand({
                    type: "EXTRACT_ROOFR_EVENTS"
                });

                if (!scanResult.events || scanResult.events.length === 0) {
                    addLog("No production events found", "WARN");
                    alert("No production events found this week");
                    return;
                }

                // 4. Store in temporary variable
                const productionEvents = scanResult.events;
                addLog(`Found ${productionEvents.length} production events`);

                // 5. Build production format
                const lines = buildProductionCopyLinesForWeek(productionEvents);

                if (lines.length === 0 || (lines.length === 1 && lines[0] === "No production events found.")) {
                    addLog("No production events to copy", "WARN");
                    alert("No production events found this week");
                    return;
                }

                // 6. Copy to clipboard
                const text = lines.join("\n");

                // Restore button text before copying so copyToClipboard can show "Copied!" properly
                copyProductionWeekBtn.textContent = "Copy Production Week";
                await copyToClipboard(text, copyProductionWeekBtn);

                // Show success message with count
                addLog(`Copied ${productionEvents.length} production events to clipboard`, "SUCCESS");

                // Note: Keep production filter active per user preference

            } catch (err) {
                console.error("Production copy error:", err);
                addLog(`Production copy error: ${err.message}`, "ERROR");
                alert("Failed to copy production week. See console for details.");
                // Restore button text on error
                copyProductionWeekBtn.textContent = "Copy Production Week";
            } finally {
                // Restore button state
                copyProductionWeekBtn.disabled = false;
            }
        });
    }

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

        // Hide the Notes/Find bottom dock on the Dialer tab — the dialer has its
        // own sticky footer there, and Notes/Find aren't useful while dialing.
        const bottomDock = document.getElementById('bottom-dock');
        if (bottomDock) bottomDock.style.display = (targetId === 'sec-dialer') ? 'none' : '';

        // On the Dialer tab, the iframe-hosted dialer manages its own sticky
        // header + footer, so the POPUP must not scroll (otherwise it drags the
        // whole iframe — and its pinned elements — around). Lock popup scroll and
        // size the iframe to fill exactly the space under the sticky header.
        const onDialer = (targetId === 'sec-dialer');
        document.body.classList.toggle('dialer-active', onDialer);
        if (onDialer) {
            const sh = document.getElementById('sticky-header');
            const h = sh ? Math.round(sh.getBoundingClientRect().height) : 90;
            const frame = document.getElementById('dialer-iframe');
            if (frame) frame.style.height = `calc(100vh - ${h}px)`;
        }

        // Notify the dialer iframe whether it's the active tab. If the rep
        // switches away from the Dialer tab while a session is running, the
        // dialer pauses itself so we don't keep dialing in the background.
        try {
            const dialerFrame = document.getElementById('dialer-iframe');
            if (dialerFrame && dialerFrame.contentWindow) {
                dialerFrame.contentWindow.postMessage({
                    type: 'AD_TAB_ACTIVE',
                    active: targetId === 'sec-dialer',
                    sectionId: targetId,
                }, '*');
            }
        } catch (_) { /* iframe not loaded yet — fine */ }

        // Check prefs to see if we should hide this tab
        if (targetId === 'sec-people' && !userPrefs.showPeopleTab) activateMainTab('sec-scanner');
        if (targetId === 'sec-clipboard' && !userPrefs.showClipboardTab) activateMainTab('sec-scanner');
        if (targetId === 'sec-dialer' && !userPrefs.showDialerTab) activateMainTab('sec-scanner');
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
                "search_google_earth", "search_gemini", "search_roofr",
                "ROUTING_API_URL", "ROUTING_API_KEY", "scanner_name"
            ];
            const defaults = {
                NEXT_SHEET_ID: "1cFFEZNl7wXt40riZHnuZxGc1Zfm5lTlOz0rDCWGZJ0g",
                AVAIL_RANGE_PHX: "I2:Q9",
                AVAIL_RANGE_NORTH: "I18:Q25",
                AVAIL_RANGE_SOUTH: "I10:Q17",
                search_google_earth: true,
                search_gemini: true,
                search_roofr: true,
                ROUTING_API_URL: '', // e.g., "https://your-api.vercel.app/api/v1"
                ROUTING_API_KEY: '',
                scanner_name: '' // Name of person using the scanner (for shared caching)
            };
            const result = await chrome.storage.sync.get(keys);
            settings = { ...defaults, ...settings, ...result };
        }
    }

    /* ========= Scan Logic ========= */
    // Re-entrancy guard: a single "scan page" action can trigger runScanFlow from several
    // paths at once (the Scan button click, the content script's AUTO_SCAN_READY message,
    // and ROOFR_DATES_CHANGED). Each run re-applies the scan profile, which re-checks the
    // Sales group (cascading D2D back on) then drops D2D again — that's the "reselects D2D
    // and deselects it again" flicker. Allow only ONE scan in flight; ignore duplicate
    // triggers until it finishes (cleared anywhere scanBtn is re-enabled below).
    let scanInProgress = false;
    let _scanGuardTimer = null;
    // When Roofr's calendar was last force-reloaded (scan toggle OR the 3-min background
    // refresh both stamp this). A scan within CALENDAR_FRESH_MS skips the costly reload TOGGLE
    // (but still confirms the grid via WAIT_CALENDAR_STABLE before extracting). 0 = unknown
    // (first scan always forces a reload). Kept SHORT on purpose: while we're stamping out
    // double-booking, freshness beats speed — we don't want a scan trusting stale availability
    // and showing a just-booked slot as open. (The wider ~3-min "let the toggle pay off" window
    // is parked until server-side fresh data lands.)
    let lastCalendarRefreshAt = 0;
    const CALENDAR_FRESH_MS = 75 * 1000;
    async function runScanFlow(isAuto = false) {
        if (scanInProgress) {
            addLog("Scan already in progress — ignoring duplicate trigger.");
            return;
        }
        scanInProgress = true;
        // Backstop: never let the guard stick forever. If a scan ever throws past its normal
        // clear points, this releases it so future scans aren't permanently blocked.
        clearTimeout(_scanGuardTimer);
        _scanGuardTimer = setTimeout(() => { scanInProgress = false; }, 45000);
        addLog("Scan flow initiated.");
        scanBtn.disabled = true;
        scanBtn.innerHTML = '<span class="scan-spinner"></span> Scanning...';
        if (!settings.NEXT_SHEET_ID) {
            document.getElementById('setup-banner')?.classList.remove('hidden');
            scanBtn.disabled = false; updateScanButtonState();
            scanInProgress = false;
            return;
        }

        // ── One-time setup — runs ONCE, before the date-polling retries below, so the
        // profile / view / team selection are NOT re-applied on every retry (that was
        // firing the event types and "Select all" several times). ──
        const profile = userPrefs.scanProfile || 'retail';
        addLog(`Applying scan profile: ${profile}`);
        await sendFindCommand({ type: "APPLY_SCAN_PROFILE", profile });
        await new Promise(r => setTimeout(r, 250));

        // Ensure the calendar is in the chosen scan view (agenda/weekly/daily). Switch only if needed.
        const desiredView = userPrefs.scanView || 'weekly';
        const setupViewResult = await sendFindCommand({ type: "GET_CALENDAR_VIEW" });
        if (setupViewResult && setupViewResult.ok && setupViewResult.view !== desiredView) {
            addLog(`Switching from ${setupViewResult.view} to ${desiredView} view...`);
            await sendFindCommand({ type: 'SWITCH_CALENDAR_VIEW', view: desiredView });
            await new Promise(r => setTimeout(r, 1500));
        }

        // For Production/D2D, narrow the team filter to just that department (once).
        if (profile === 'production' || profile === 'd2d') {
            const deptNames = profile === 'production' ? (PEOPLE_DATA.PRODUCTION || []) : (PEOPLE_DATA.D2D || []);
            if (deptNames.length) {
                addLog(`Narrowing team to ${profile} (${deptNames.length})...`);
                await sendFindCommand({ type: "SELECT_ONLY_TEAM_MEMBERS", names: deptNames });
                await new Promise(r => setTimeout(r, 300));
            }
        }

        // GATE: a scan can read stale data because Roofr doesn't reload on event-type/profile
        // changes alone. We fix that by toggling Yousef Ayad's checkbox (a filter change forces
        // a re-fetch) — a SINGLE click left flipped, alternating each scan. BUT the reload +
        // settle is the bulk of scan time, so we SKIP it when the calendar was refreshed within
        // CALENDAR_FRESH_MS (by a prior scan or the 3-min background refresh) and just read the
        // already-loaded data. The content handler skips daily view (exempt per spec).
        const freshAgeMs = Date.now() - lastCalendarRefreshAt;
        const calendarIsFresh = lastCalendarRefreshAt > 0 && freshAgeMs < CALENDAR_FRESH_MS;
        if (calendarIsFresh) {
            addLog(`Calendar refreshed ${Math.round(freshAgeMs / 1000)}s ago — skipping reload (fresh).`);
            // Skip the costly reload TOGGLE (the data's already loaded), but STILL confirm the
            // grid is fully painted before extracting. The old blind 400ms wait here could read a
            // half-loaded/empty grid and report booked slots as open (false availability). The
            // stable-wait returns fast when the calendar is genuinely settled.
            await new Promise(r => setTimeout(r, 200));
            const freshStable = await sendFindCommand({ type: "WAIT_CALENDAR_STABLE" });
            if (freshStable && freshStable.timedOut) {
                addLog(`Fresh-path load wait timed out (~${Math.round((freshStable.ms || 0) / 1000)}s, ${freshStable.count} events visible).`, "WARN");
            } else if (freshStable && freshStable.ok) {
                addLog(`Calendar confirmed loaded (${freshStable.count} events).`);
            }
        } else {
            addLog("Refreshing Roofr calendar (team-toggle) before scan...");
            let refreshed = await sendFindCommand({ type: "REFRESH_CALENDAR_TOGGLE", member: "Yousef Ayad" });
            if (refreshed && refreshed.skipped) {
                addLog(`Refresh skipped: ${refreshed.reason}.`);
            } else if (!refreshed || !refreshed.ok) {
                // Toggle didn't take (e.g., the Team panel/checkbox wasn't ready). Retry once
                // before reading, so we don't scan un-refreshed data.
                addLog("Refresh toggle didn't take — retrying once before scanning...", "WARN");
                await new Promise(r => setTimeout(r, 800));
                refreshed = await sendFindCommand({ type: "REFRESH_CALENDAR_TOGGLE", member: "Yousef Ayad" });
                if (!refreshed || !refreshed.ok) {
                    addLog("Could not toggle Yousef to refresh — check the exact name in Roofr's Team filter. Scan may show stale data.", "ERROR");
                }
            }
            if (refreshed && refreshed.ok) {
                lastCalendarRefreshAt = Date.now();
                addLog(`Calendar refreshed via ${refreshed.member} toggle.`);
            }

            // GATE 2: a reload was kicked — don't extract until the calendar content has finished
            // loading. Wait for the event DOM to stop changing so we never read a half-loaded or
            // pre-refresh set. (Skipped on the fresh path above, where nothing was reloaded.)
            addLog("Waiting for calendar content to finish loading...");
            const stableRes = await sendFindCommand({ type: "WAIT_CALENDAR_STABLE" });
            if (stableRes && stableRes.timedOut) {
                addLog(`Proceeded after load timeout (~${Math.round((stableRes.ms || 0) / 1000)}s, ${stableRes.count} events visible).`, "WARN");
            } else if (stableRes && stableRes.ok) {
                addLog(`Calendar content loaded (${stableRes.count} events).`);
            }
        }

        // Polling logic to wait for content (retries ONLY the date/event detection).
        const maxRetries = 10;
        let attempts = 0;

        const attemptScan = async () => {
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

                // The visible range can cover MULTIPLE calendar weeks (agenda view
                // shows several weeks at once). Fetch availability for EACH distinct
                // week so every day card reads ITS OWN week's capacity — otherwise
                // later weeks wrongly inherit the first week's numbers (e.g. a flex
                // rep added to next week never shows up).
                const distinctSundays = [...new Set(state.weekDays.map(weekSundayKey))].sort();
                const firstSunday = distinctSundays[0];
                await fetchSheetCapacitiesForSunday(firstSunday); // primary week: sets state.availability, dayCutoffs, empty-alert
                state.availabilityByWeek = { [firstSunday]: state.availability };
                const otherSundays = distinctSundays.filter(s => s !== firstSunday);
                const otherAvail = await Promise.all(otherSundays.map(s => computeAvailabilityForSunday(s)));
                otherSundays.forEach((s, i) => { if (otherAvail[i]) state.availabilityByWeek[s] = otherAvail[i]; });

                state.allEvents = eventData?.events || [];
                state.parsedJobs = state.allEvents.map(ev => CONFIG.parseJobDetails(ev));

                // Cache this week's data for quick access later
                const weekKey = state.weekDays[0]; // Use first day as key
                state.weekDataCache[weekKey] = {
                    events: [...state.allEvents],
                    availability: JSON.parse(JSON.stringify(state.availability)),
                    weekDays: [...state.weekDays],
                    dayCutoffs: [...(state.dayCutoffs || [])],
                    timestamp: Date.now()
                };
                // Keep only last 4 weeks to avoid memory bloat
                const cacheKeys = Object.keys(state.weekDataCache).sort();
                while (cacheKeys.length > 4) {
                    delete state.weekDataCache[cacheKeys.shift()];
                }
                addLog(`Cached week data for ${weekKey} (${Object.keys(state.weekDataCache).length} weeks cached)`);

                // Save to Routing API for sharing with coworkers (non-blocking)
                saveCalendarCacheToAPI(
                    weekKey,
                    state.currentRegion,
                    state.allEvents,
                    state.availability,
                    state.weekDays
                ).catch(e => addLog(`API cache save failed: ${e.message}`, 'WARN'));

                addLog(`Scan complete. Extracted ${state.allEvents.length} events.`);
                await debouncedSaveState();
                renderUIFromState();
                scanBtn.disabled = false;
                scanInProgress = false;
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

                // If we have an active address, re-run recommendation for the new week's data
                console.log('[RECO DEBUG] Scan complete. Checking for active address...');
                console.log('[RECO DEBUG] state.addressInput:', state.addressInput);
                console.log('[RECO DEBUG] state.allCandidatesForCity length:', state.allCandidatesForCity?.length);
                if (state.addressInput) {
                    console.log('[RECO DEBUG] Address found, will re-run recommendation in 500ms');
                    addLog("Re-running recommendation after scan with active address...");
                    await debouncedSaveState();
                    // Small delay to ensure UI is updated
                    setTimeout(() => {
                        console.log('[RECO DEBUG] Now calling runMainRecommendation()');
                        runMainRecommendation();
                    }, 500);
                } else {
                    console.log('[RECO DEBUG] No address input, skipping recommendation re-run');
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
                    scanInProgress = false;
                    updateScanButtonState();
                    // Clear the stored target tab ID on failure
                    window.__targetRoofrTabId = null;
                }
            }
        };

        attemptScan();
    }

    // Keep Roofr's calendar fresh while the side panel is open: every 3 minutes, force a
    // refresh via the same team-toggle the scan uses. The content handler skips daily view
    // (only weekly/agenda). Paused while a scan is running so it can't clobber one. This
    // interval lives only as long as the side panel is open (its popup context).
    setInterval(() => {
        if (scanInProgress) return;
        sendFindCommand({ type: "REFRESH_CALENDAR_TOGGLE", member: "Yousef Ayad" })
            .then(r => { if (r && r.ok) lastCalendarRefreshAt = Date.now(); })
            .catch(() => {});
    }, 3 * 60 * 1000);

    // Helper function to send command to a specific tab
    async function sendCommandToTab(tabId, payload) {
        try {
            return await chrome.tabs.sendMessage(tabId, payload);
        } catch (e) {
            if (e.message && e.message.includes('Receiving end does not exist')) {
                // Inject content script and retry
                try {
                    await chrome.scripting.executeScript({ target: { tabId }, files: ["roofr-api.js", "reports-batch.js", "content.js"] });
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

    // Setup calendar: switch to the user's scan view (default Weekly), select
    // Sales, select all team members.
    // (Parameter name kept as forceWeekly for backwards-compatibility with callers;
    // semantics now mean "force switch when navigating to calendar".)
    async function setupCalendarForScan(tabId, forceWeekly = true) {
        addLog("Setting up calendar for scan...");

        // Step 1: Check current view.
        // - If navigating to calendar (forceWeekly=true): land on the chosen view (default Weekly).
        // - If already on calendar: accept agenda/weekly/daily and scrape in place.
        //   Only force a switch when the user is on monthly (which doesn't have
        //   per-event details).
        const desiredView = userPrefs.scanView || 'weekly';
        const viewResult = await sendCommandToTab(tabId, { type: "GET_CALENDAR_VIEW" });
        if (viewResult?.ok) {
            addLog(`Current view: ${viewResult.view}`);
            const v = viewResult.view;
            const scrapeableNow = (v === 'agenda' || v === 'weekly' || v === 'daily');
            // Switch to the user's chosen scan view when navigating in, or whenever
            // the current view isn't scrapable (e.g. monthly).
            const shouldSwitch = forceWeekly ? (v !== desiredView) : !scrapeableNow;

            if (shouldSwitch) {
                addLog(`Switching to ${desiredView} view...`);
                const switchResult = await sendCommandToTab(tabId, { type: 'SWITCH_CALENDAR_VIEW', view: desiredView });
                if (switchResult?.ok) {
                    addLog(`Switched to ${desiredView} view`);
                } else {
                    addLog(`Warning: ${desiredView} switch returned: ${switchResult?.error || 'unknown'}`, "WARN");
                }
                await new Promise(r => setTimeout(r, 2000)); // Wait for view to render
            }
        }

        // Step 2: Apply the active scan profile (which event types to read), with retries.
        const profile = userPrefs.scanProfile || 'retail';
        addLog(`Applying scan profile: ${profile}...`);
        let profileResult = await sendCommandToTab(tabId, { type: "APPLY_SCAN_PROFILE", profile });
        if (!profileResult?.ok) {
            addLog("Profile apply failed, retrying...");
            await new Promise(r => setTimeout(r, 1000));
            profileResult = await sendCommandToTab(tabId, { type: "APPLY_SCAN_PROFILE", profile });
        }
        if (profileResult?.ok) {
            addLog(`Scan profile '${profile}' applied`);
        } else {
            addLog(`Warning: could not apply scan profile (${profileResult?.reason || profileResult?.error || 'unknown'})`, "WARN");
        }
        await new Promise(r => setTimeout(r, 500));

        // Step 3: Select team members. For Production/D2D, select ONLY that department's
        // people (from the roster-synced PEOPLE_DATA); for Retail/Insurance, select everyone.
        const teamProfile = profile;
        let teamResult;
        if (teamProfile === 'production' || teamProfile === 'd2d') {
            const names = teamProfile === 'production' ? (PEOPLE_DATA.PRODUCTION || []) : (PEOPLE_DATA.D2D || []);
            addLog(`Selecting ${teamProfile} team members only (${names.length})...`);
            teamResult = await sendCommandToTab(tabId, { type: "SELECT_ONLY_TEAM_MEMBERS", names });
            if (!teamResult?.ok) {
                await new Promise(r => setTimeout(r, 1000));
                teamResult = await sendCommandToTab(tabId, { type: "SELECT_ONLY_TEAM_MEMBERS", names });
            }
            addLog(teamResult?.ok ? `Selected ${teamResult.selectedCount} ${teamProfile} members` : `Warning: could not select ${teamProfile} members`, teamResult?.ok ? undefined : "WARN");
        } else {
            addLog("Selecting all team members...");
            teamResult = await sendCommandToTab(tabId, { type: "SELECT_ALL_TEAM_MEMBERS" });
            if (!teamResult?.ok) {
                addLog("Select All not found, retrying...");
                await new Promise(r => setTimeout(r, 1000));
                teamResult = await sendCommandToTab(tabId, { type: "SELECT_ALL_TEAM_MEMBERS" });
            }
            addLog(teamResult?.ok ? "All team members selected" : "Warning: Could not select all team members", teamResult?.ok ? undefined : "WARN");
        }
        await new Promise(r => setTimeout(r, 1500)); // Wait for calendar to update with events

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

    // Open/refresh a Roofr calendar tab in the BACKGROUND (no focus steal) so the
    // DOM-dependent features (Reports/Reviews batch, the job-card openers) have a loaded
    // calendar to work with. The server-availability path (loadTwoWeekAvailability) no
    // longer opens the calendar — it keeps the rep on the 14-day availability view — so
    // this restores the live calendar WITHOUT yanking them off that view. Reuses an
    // existing calendar tab if one is already open (never spawns a duplicate).
    async function ensureCalendarTabInBackground() {
        try {
            let workingWindowId = window.__targetWindowId || null;
            if (!workingWindowId) {
                try { workingWindowId = (await chrome.windows.getCurrent()).id; } catch (_) {}
            }
            const queryOpts = { url: "*://app.roofr.com/dashboard/team/*/calendar*" };
            if (workingWindowId) queryOpts.windowId = workingWindowId;
            const existing = await chrome.tabs.query(queryOpts);
            if (existing.length > 0) {
                // Already have a calendar tab — leave it where it is, just remember it.
                window.__targetRoofrTabId = existing[0].id;
                return existing[0];
            }
            // None open — create one in the background (active:false keeps the rep on the scanner).
            addLog("Opening Roofr calendar in background for scraper features...");
            const createOpts = { url: "https://app.roofr.com/dashboard/team/239329/calendar", active: false };
            if (workingWindowId) createOpts.windowId = workingWindowId;
            const tab = await chrome.tabs.create(createOpts);
            window.__targetRoofrTabId = tab.id;
            return tab;
        } catch (e) {
            addLog(`Background calendar open failed: ${e.message}`, "INFO");
            return null;
        }
    }

    // Main scan handler that checks tab and navigates if needed
    async function handleScanClick() {
        scanBtn.disabled = true;
        scanBtn.innerHTML = '<span class="scan-spinner"></span> Scanning...';

        try {
            // Primary path: refresh the 2-week server availability (no DOM scrape, keeps the
            // full 14-day view). Only fall through to the live Roofr DOM scan if the server fails.
            const serverOk = await loadTwoWeekAvailability();
            if (serverOk) {
                // Server gave us the 14-day availability — the rep stays on this view.
                // But the DOM-dependent features (Reports/Reviews batch, job-card openers)
                // still need a loaded Roofr calendar tab. Open one in the BACKGROUND so they
                // work without the rep manually opening the calendar. Fire-and-forget so it
                // never delays showing the availability.
                ensureCalendarTabInBackground();
                scanBtn.disabled = false;
                updateScanButtonState();
                return;
            }

            // Resolve the window the user is working in. In popout mode that's the
            // original browser window (passed as __targetWindowId); otherwise it's
            // the window this panel is docked to. ALL tab lookups/opens below are
            // scoped to it so we never latch onto — or open — a calendar in some
            // OTHER window. (That was the regression: a stored/auto-connected tab
            // from a different window made the scan skip the open-a-calendar step
            // and just sit on "Scanning...".)
            let workingWindowId = window.__targetWindowId || null;
            if (!workingWindowId) {
                try { workingWindowId = (await chrome.windows.getCurrent()).id; } catch (_) {}
            }

            // Reuse a stored target tab ONLY if it's a calendar IN the working window.
            if (window.__targetRoofrTabId) {
                try {
                    const storedTab = await chrome.tabs.get(window.__targetRoofrTabId);
                    const sameWindow = !workingWindowId || storedTab.windowId === workingWindowId;
                    if (sameWindow && storedTab?.url?.includes('app.roofr.com') && storedTab?.url?.includes('/calendar')) {
                        addLog(`Using stored Roofr calendar tab (ID: ${storedTab.id})`);
                        // Bring the calendar to the foreground before scanning. A hidden/background
                        // tab is throttled by Chrome (setTimeout clamped to ~1s, rendering
                        // deprioritized), which ~triples scan time (≈15s vs 5-8s) and leaves you
                        // staring at the wrong page. Activating it lets the settle-wait poll at
                        // full 400ms speed — the other scan paths already do this.
                        try {
                            await chrome.tabs.update(storedTab.id, { active: true });
                            await chrome.windows.update(storedTab.windowId, { focused: true });
                        } catch (e) {
                            addLog("Could not focus stored calendar tab", "INFO");
                        }
                        runScanFlow(false);
                        return;
                    }
                    // Stale or wrong-window — drop it and fall through to find/open here.
                    window.__targetRoofrTabId = null;
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

            // Search for existing Roofr calendar tabs in the working window only.
            const queryOpts = { url: "*://app.roofr.com/dashboard/team/*/calendar*" };
            if (workingWindowId) queryOpts.windowId = workingWindowId;
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
                // No existing Roofr calendar tab in this window — open one HERE.
                addLog("No existing Roofr calendar tab found, opening new one...");
                const createOpts = { url: calendarUrl, active: true };
                if (workingWindowId) createOpts.windowId = workingWindowId;
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

            // Run the scan on the target tab. runScanFlow() (its attemptScan) now does the
            // full setup itself — calendar view, scan profile (event types), and team-member
            // selection — so we no longer call setupCalendarForScan() here. Calling both made
            // the profile/view/team get applied TWICE (visible as deselect-all → pick dept →
            // select-all → deselect-all → pick dept again).
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

    // Right-click the Scan button to toggle the scan-options popover (profile + view).
    if (scanBtn) {
        const scanOptionsPopover = document.getElementById('scan-options-popover');
        scanBtn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (!scanOptionsPopover) return;
            scanOptionsPopover.style.display = (scanOptionsPopover.style.display === 'none' || !scanOptionsPopover.style.display) ? 'flex' : 'none';
        });
        // Dismiss on outside click.
        document.addEventListener('click', (e) => {
            if (scanOptionsPopover && scanOptionsPopover.style.display === 'flex'
                && !scanOptionsPopover.contains(e.target) && e.target !== scanBtn && !scanBtn.contains(e.target)) {
                scanOptionsPopover.style.display = 'none';
            }
        });
    }

    // Open daily calendar view for a specific date with appropriate people selected
    async function openDailyCalendarForDate(dateStr) {
        try {
            const clickedDate = new Date(dateStr + "T00:00:00");
            const todayISO = phoenixTodayISO();
            const today = new Date(todayISO + "T00:00:00");
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

            // Resolve the browser window to bind the popout to — the panel's own
            // window when we don't already know it. Passing it through lets the
            // popout scope its scan to the right window (and open a calendar THERE
            // if none exists) instead of grabbing one from some other window.
            let targetWindowId = window.__targetWindowId || null;
            if (!targetWindowId) {
                try { targetWindowId = (await chrome.windows.getCurrent()).id; } catch (_) {}
            }

            // Get the current Roofr tab ID to pass to the popup (from that window).
            let targetTabId = window.__targetRoofrTabId;
            if (!targetTabId) {
                const queryOpts = { url: "*://app.roofr.com/*" };
                if (targetWindowId) queryOpts.windowId = targetWindowId;
                const roofrTabs = await chrome.tabs.query(queryOpts);
                if (roofrTabs.length > 0) {
                    targetTabId = roofrTabs[0].id;
                }
            }

            // Build popup URL with both tab ID and window ID
            let popupUrl = chrome.runtime.getURL('popup.html');
            const params = [];
            if (targetTabId) params.push(`targetTabId=${targetTabId}`);
            if (targetWindowId) params.push(`targetWindowId=${targetWindowId}`);
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
                        addCityToRegionWhitelist(city, region);

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
            const url = `https://az-roofers-tech-scheduler.vercel.app/api/sheets?spreadsheetId=${encodeURIComponent(sheetId)}&range=${encodeURIComponent(`${qTab}!${range}`)}`;

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
        const tomorrowISO = addDaysISO(phoenixTodayISO(), 1);
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

    /**
     * Groups all candidates by day and picks the BEST one per day.
     * Used for day-based navigation where each day shows its single best recommendation.
     * @param {Array} allCandidates - Array of candidate objects from findBestSlotStacking
     * @returns {Object} Map of dateStr -> best candidate for that day
     */
    function computeBestPerDay(allCandidates) {
        const bestPerDay = {};

        // Group candidates by date
        const byDate = {};
        for (const c of allCandidates) {
            if (!byDate[c.dateStr]) byDate[c.dateStr] = [];
            byDate[c.dateStr].push(c);
        }

        // For each date, pick the BEST candidate
        // Priority: stackSize (higher is better) > remaining capacity (higher is better) > earlier block
        const keyOrder = { "B1": 0, "B2": 1, "B3": 2, "B4": 3 };
        for (const [dateStr, candidates] of Object.entries(byDate)) {
            candidates.sort((a, b) => {
                if (b.stackSize !== a.stackSize) return b.stackSize - a.stackSize;
                if ((b.remaining || 0) !== (a.remaining || 0)) return (b.remaining || 0) - (a.remaining || 0);
                return (keyOrder[a.blockKey] || 0) - (keyOrder[b.blockKey] || 0);
            });
            bestPerDay[dateStr] = candidates[0];
        }

        return bestPerDay;
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
        label.style.color = "#854d0e";
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

        // Try to get smart recommendations from the Routing API first
        const address = state.addressInput || primaryCity;
        const smartRecs = await getSmartRecommendations(address, [], state.weekDays, 'normal');

        let candidates = [];

        if (smartRecs && smartRecs.length > 0) {
            // Convert API recommendations to our candidate format
            candidates = smartRecs.map(rec => {
                // Map API time slot to block key
                const slotToBlock = { 'ts-1': 'B1', 'ts-2': 'B2', 'ts-3': 'B3', 'ts-4': 'B4' };
                const blockKey = slotToBlock[rec.timeSlotId] || 'B1';

                // Build reason text with rep name and skills
                let reason = '';
                if (rec.repName) {
                    reason = `${rec.repName}`;
                    if (rec.reasons && rec.reasons.length > 0) {
                        reason += ` - ${rec.reasons.join(', ')}`;
                    }
                } else if (rec.reasons && rec.reasons.length > 0) {
                    reason = rec.reasons.join(', ');
                } else {
                    reason = 'Available slot';
                }

                return {
                    dateStr: rec.date,
                    blockKey,
                    stackSize: 0,
                    reason,
                    remaining: rec.remaining || 1,
                    repName: rec.repName,
                    repId: rec.repId,
                    score: rec.score
                };
            });
            addLog(`Using ${candidates.length} smart recommendations from API`);
        } else {
            // Fall back to local stacking algorithm
            candidates = findBestSlotStacking(
                primaryCity, state.weekDays, state.allEvents, state.availability, state.currentRegion
            );
            addLog(`Using ${candidates.length} local stacking recommendations`);
        }

        // Fallback: if no city-based candidates, find slots with highest availability
        if (candidates.length === 0) {
            candidates = findHighestAvailabilitySlots(state.weekDays, state.allEvents, state.availability, state.currentRegion);
            addLog(`Using ${candidates.length} highest-availability fallback recommendations`);
        }

        state.recoCandidates = candidates;
        state.recoIndex = 0;

        debouncedSaveState();
        renderUIFromState();

        if (candidates.length === 0) {
            // Check if there's cached data for next week
            const weekStart = state.weekDays[0];
            const nextWeekData = await checkNextWeekAvailability(weekStart, state.currentRegion);

            if (nextWeekData.hasCache) {
                const scannedAgo = nextWeekData.scannedAt
                    ? Math.round((Date.now() - new Date(nextWeekData.scannedAt).getTime()) / (1000 * 60))
                    : null;
                const timeAgoText = scannedAgo ? ` (scanned ${scannedAgo}m ago by ${nextWeekData.scannedBy})` : '';

                const useNextWeek = confirm(
                    `No availability in current week for ${primaryCity}.\n\n` +
                    `Cached data found for next week${timeAgoText}.\n\n` +
                    `Would you like to use the cached data to find availability?\n` +
                    `(You can still navigate to verify)`
                );

                if (useNextWeek) {
                    // Use the cached next week data
                    const nextCandidates = findBestSlotStacking(
                        primaryCity,
                        nextWeekData.weekDays,
                        nextWeekData.events,
                        nextWeekData.availability,
                        state.currentRegion
                    );

                    if (nextCandidates.length > 0) {
                        // Mark these as from cached data
                        nextCandidates.forEach(c => {
                            c.reason = `[From cache] ${c.reason}`;
                        });
                        state.recoCandidates = nextCandidates;
                        state.recoIndex = 0;
                        debouncedSaveState();
                        renderUIFromState();
                        showToast(`Found ${nextCandidates.length} options in next week (cached)`);
                        return;
                    }
                }
            }

            alert(`No available capacity found for ${primaryCity} in the visible week.`);
        }
    }

    // Find the slot with highest availability for each day (fallback when no city matches)
    function findHighestAvailabilitySlots(weekDays, allEvents, availability, currentRegion) {
        const candidates = [];
        const tomorrowISO = addDaysISO(phoenixTodayISO(), 1);

        for (const dateStr of weekDays) {
            // Only recommend tomorrow or later
            if (dateStr < tomorrowISO) continue;

            const dailyEvents = allEvents.filter(e => localDayKey(e.start) === dateStr);
            const totals = CONFIG.computeDailyTotals(dateStr, dailyEvents, availability, currentRegion);

            // Find the block with highest remaining capacity
            const blocks = CONFIG.blockWindowForDate(new Date(dateStr + "T00:00"));
            let bestBlock = null;
            let bestRemaining = -Infinity;

            blocks.forEach(b => {
                const remaining = totals.perBlockRemaining[b.key] ?? 0;
                if (remaining > bestRemaining) {
                    bestRemaining = remaining;
                    bestBlock = b.key;
                }
            });

            if (bestBlock && bestRemaining > 0) {
                candidates.push({
                    dateStr,
                    blockKey: bestBlock,
                    stackSize: 0,
                    reason: `Highest availability: ${bestRemaining} spots open`,
                    remaining: bestRemaining
                });
            }
        }

        // Sort by remaining capacity (highest first), then by date
        candidates.sort((a, b) => {
            if (b.remaining !== a.remaining) return b.remaining - a.remaining;
            return new Date(a.dateStr) - new Date(b.dateStr);
        });

        return candidates;
    }

    function handleNextRecommendation() {
        console.log('[RECO DEBUG] handleNextRecommendation (day-based) called');
        // Day-based navigation: cycle through days, not all candidates
        if (!state.recoAvailableDays || state.recoAvailableDays.length <= 1) {
            console.log('[RECO DEBUG] No multiple days available, returning');
            return;
        }

        // Collapse current day's card
        const currentDay = state.recoAvailableDays[state.recoDayIndex];
        const currentCard = document.querySelector(`.day-card[data-date="${currentDay}"]`);
        if (currentCard) {
            setCardCollapsed(currentCard, true);
            clearAllSuggested();
        }

        // Move to next day
        state.recoDayIndex = ((state.recoDayIndex || 0) + 1) % state.recoAvailableDays.length;
        const nextDay = state.recoAvailableDays[state.recoDayIndex];
        console.log('[RECO DEBUG] Moving to day:', nextDay, 'index:', state.recoDayIndex);

        // Get the best candidate for this day
        const reco = state.recoBestPerDay[nextDay];
        if (reco) {
            state.recoCandidates = [reco];
            state.recoIndex = 0;
        }

        // Set flag to prevent full re-render during navigation
        // Timeout must be longer than debounce (250ms) to ensure flag is still set when save executes
        isNavigatingDays = true;
        debouncedSaveState();
        setTimeout(() => { isNavigatingDays = false; }, 300);

        // Expand and highlight the new day's card
        const nextCard = document.querySelector(`.day-card[data-date="${nextDay}"]`);
        if (nextCard) {
            setCardCollapsed(nextCard, false);
            if (reco) {
                highlightSuggested(nextCard, reco.blockKey, reco.reason);
            }
            // Use instant scroll to prevent flash of unhighlighted content during smooth scroll
            nextCard.scrollIntoView({ behavior: 'instant', block: 'center' });
        }
    }

    function handlePrevRecommendation() {
        console.log('[RECO DEBUG] handlePrevRecommendation (day-based) called');
        // Day-based navigation: cycle through days, not all candidates
        if (!state.recoAvailableDays || state.recoAvailableDays.length <= 1) {
            console.log('[RECO DEBUG] No multiple days available, returning');
            return;
        }

        // Collapse current day's card
        const currentDay = state.recoAvailableDays[state.recoDayIndex];
        const currentCard = document.querySelector(`.day-card[data-date="${currentDay}"]`);
        if (currentCard) {
            setCardCollapsed(currentCard, true);
            clearAllSuggested();
        }

        // Move to previous day
        state.recoDayIndex = ((state.recoDayIndex || 0) - 1 + state.recoAvailableDays.length) % state.recoAvailableDays.length;
        const prevDay = state.recoAvailableDays[state.recoDayIndex];
        console.log('[RECO DEBUG] Moving to day:', prevDay, 'index:', state.recoDayIndex);

        // Get the best candidate for this day
        const reco = state.recoBestPerDay[prevDay];
        if (reco) {
            state.recoCandidates = [reco];
            state.recoIndex = 0;
        }

        // Set flag to prevent full re-render during navigation
        // Timeout must be longer than debounce (250ms) to ensure flag is still set when save executes
        isNavigatingDays = true;
        debouncedSaveState();
        setTimeout(() => { isNavigatingDays = false; }, 300);

        // Expand and highlight the new day's card
        const prevCard = document.querySelector(`.day-card[data-date="${prevDay}"]`);
        if (prevCard) {
            setCardCollapsed(prevCard, false);
            if (reco) {
                highlightSuggested(prevCard, reco.blockKey, reco.reason);
            }
            // Use instant scroll to prevent flash of unhighlighted content during smooth scroll
            prevCard.scrollIntoView({ behavior: 'instant', block: 'center' });
        }
    }

    function scrollToRecommendation(reco) {
        console.log('[RECO DEBUG] scrollToRecommendation called with:', reco);
        if (!reco) {
            console.log('[RECO DEBUG] No reco, returning');
            return;
        }
        const card = document.querySelector(`.day-card[data-date="${reco.dateStr}"]`);
        console.log('[RECO DEBUG] Looking for card with date:', reco.dateStr);
        console.log('[RECO DEBUG] Found card:', card);
        if (card) {
            setCardCollapsed(card, false);
            highlightSuggested(card, reco.blockKey, reco.reason);
            // Smooth scroll for programmatic recommendation navigation
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            console.log('[RECO DEBUG] Card not found for date:', reco.dateStr);
        }
    }

    // Day navigation functions
    function handleNextDay() {
        if (!state.recoAvailableDays || state.recoAvailableDays.length <= 1) return;
        state.recoDayIndex = (state.recoDayIndex + 1) % state.recoAvailableDays.length;

        // Set flag to prevent full re-render during navigation
        isNavigatingDays = true;
        updateRecommendationsForSelectedDay();
        setTimeout(() => { isNavigatingDays = false; }, 300);
    }

    function handlePrevDay() {
        if (!state.recoAvailableDays || state.recoAvailableDays.length <= 1) return;
        state.recoDayIndex = (state.recoDayIndex - 1 + state.recoAvailableDays.length) % state.recoAvailableDays.length;

        // Set flag to prevent full re-render during navigation
        isNavigatingDays = true;
        updateRecommendationsForSelectedDay();
        setTimeout(() => { isNavigatingDays = false; }, 300);
    }

    function updateRecommendationsForSelectedDay() {
        if (!state.recoAvailableDays || state.recoAvailableDays.length === 0) return;
        const selectedDay = state.recoAvailableDays[state.recoDayIndex];
        // Filter candidates to only include selected day
        state.recoCandidates = state.allCandidatesForCity.filter(c => c.dateStr === selectedDay);
        state.recoIndex = 0;
        debouncedSaveState();
        renderUIFromState();

        // Scroll to and highlight the selected day's first recommendation
        const firstReco = state.recoCandidates[0];
        if (firstReco) {
            const card = document.querySelector(`.day-card[data-date="${firstReco.dateStr}"]`);
            if (card) {
                setCardCollapsed(card, false);
                highlightSuggested(card, firstReco.blockKey, firstReco.reason);
                // Use instant scroll to prevent flash during navigation
                card.scrollIntoView({ behavior: 'instant', block: 'center' });
            }
        }
    }

    function formatDayLabel(dateStr) {
        // Format date string like "2026-01-21" to "Wed, Jan 21"
        const date = new Date(dateStr + 'T12:00:00');
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
    }

    /**
     * Returns all candidates for the currently viewed week, sorted by stacking priority.
     * No auto-navigation - just shows what's available on the current calendar.
     */
    function filterCandidatesForCurrentWeek(allCandidates) {
        const todayISO = phoenixTodayISO();

        // If no candidates on this week, just return empty
        if (allCandidates.length === 0) {
            return { candidates: [], needsWeekChange: null };
        }

        // Sort candidates: prioritize stacking, then by remaining capacity
        const sorted = [...allCandidates].sort((a, b) => {
            // Prioritize stacking
            if (a.stackSize > 0 && b.stackSize === 0) return -1;
            if (b.stackSize > 0 && a.stackSize === 0) return 1;
            // Then by remaining capacity
            return (b.remaining || 0) - (a.remaining || 0);
        });

        return { candidates: sorted, needsWeekChange: null };
    }

    // Run recommendation directly with selected priority
    let _recoRunning = false;
    let _recoQueued = false;
    async function runMainRecommendation() {
        console.log('[RECO DEBUG] runMainRecommendation() called');

        // Prevent duplicate runs - if already running, queue one re-run at the end
        if (_recoRunning) {
            console.log('[RECO DEBUG] Already running, queuing re-run');
            _recoQueued = true;
            return;
        }
        _recoRunning = true;
        _recoQueued = false;

        try {
        const text = addrInput?.value?.trim();
        console.log('[RECO DEBUG] addrInput value:', text);
        console.log('[RECO DEBUG] state.addressInput:', state.addressInput);
        if (!text) {
            console.log('[RECO DEBUG] No text in addrInput, exiting');
            showToast("Enter an address or city");
            return;
        }

        const cityList = CONFIG.resolveCityCandidatesFromInput(text);
        if (!cityList.length) {
            showToast("City not found");
            return;
        }

        const primaryCity = cityList[0];
        let region = CONFIG.getRegionForCity(primaryCity);

        // If city not in any region, prompt user to select one
        if (!region) {
            const selectedRegion = await promptForCityRegion(primaryCity);
            if (selectedRegion) {
                region = selectedRegion;

                // Save the city to the selected region
                try {
                    // Save to Google Sheet
                    await appendCityToSheet(primaryCity, selectedRegion);

                    // Save to local storage as backup
                    const data = await chrome.storage.sync.get(DYNAMIC_CITIES_KEY);
                    const currentDynamicCities = data[DYNAMIC_CITIES_KEY] || { PHX: [], NORTH: [], SOUTH: [] };

                    if (!currentDynamicCities[selectedRegion]) currentDynamicCities[selectedRegion] = [];
                    if (!currentDynamicCities[selectedRegion].includes(primaryCity)) {
                        currentDynamicCities[selectedRegion].push(primaryCity);
                        await chrome.storage.sync.set({ [DYNAMIC_CITIES_KEY]: currentDynamicCities });
                        userAddedCities = currentDynamicCities;
                    }

                    // Also add to CONFIG whitelist so it works immediately
                    addCityToRegionWhitelist(primaryCity, selectedRegion);

                    showToast(`${primaryCity} added to ${selectedRegion} region`);
                } catch (e) {
                    console.error('Error saving city:', e);
                    showToast(`${primaryCity} will be used for ${selectedRegion} (not saved)`);
                }
            }
            // If user skipped, still continue but without region filtering
        }

        if (region) state.currentRegion = region;
        state.highlightedCity = primaryCity;
        state.addressInput = text; // Save address to state so it persists

        // Save to recent addresses for quick access
        saveRecentAddress(text);

        await sendFindCommand({ type: 'CLEAR_HIGHLIGHT' });
        await sendFindCommand({ type: 'HIGHLIGHT_CITY', city: primaryCity });

        const allCandidates = findBestSlotStacking(
            primaryCity, state.weekDays, state.allEvents, state.availability, state.currentRegion
        );

        // Update earliest available date tracking for this city
        const cityKey = primaryCity.toUpperCase();
        const tomorrowISO = addDaysISO(phoenixTodayISO(), 1);

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

        // Get sorted candidates for the current week (no auto-navigation)
        const result = filterCandidatesForCurrentWeek(allCandidates);

        if (result.candidates.length === 0) {
            showToast("No slots available for " + primaryCity + " this week");
            return;
        }

        // Store all candidates for navigation - include city matches + high availability fallbacks
        const cityMatchCandidates = result.candidates;

        // Get all high-availability slots to allow cycling through other days
        const allAvailabilitySlots = findHighestAvailabilitySlots(
            state.weekDays, state.allEvents, state.availability, state.currentRegion
        );

        // Combine: city matches first, then add availability slots that aren't already covered
        const coveredKeys = new Set(cityMatchCandidates.map(c => `${c.dateStr}-${c.blockKey}`));
        const additionalSlots = allAvailabilitySlots.filter(s => !coveredKeys.has(`${s.dateStr}-${s.blockKey}`));

        // Mark additional slots as non-city-match for display purposes
        additionalSlots.forEach(s => { s.isFallback = true; });

        state.allCandidatesForCity = [...cityMatchCandidates, ...additionalSlots];

        // Extract unique days and sort them chronologically
        state.recoAvailableDays = [...new Set(state.allCandidatesForCity.map(c => c.dateStr))].sort();
        state.recoDayIndex = 0; // Start with first available day

        // Compute the best recommendation for each day (for day-based navigation)
        state.recoBestPerDay = computeBestPerDay(state.allCandidatesForCity);

        // Start with the best candidate from the first available day
        const firstDay = state.recoAvailableDays[0];
        state.recoCandidates = firstDay && state.recoBestPerDay[firstDay] ? [state.recoBestPerDay[firstDay]] : [];
        state.recoIndex = 0;
        state.recoGlobalIndex = 0; // Track position across all candidates

        debouncedSaveState();
        renderUIFromState();

        // Show helpful message about the recommendation
        const firstReco = state.recoCandidates[0];
        const recoDate = new Date(firstReco.dateStr + 'T12:00:00');
        const dayName = recoDate.toLocaleDateString('en-US', { weekday: 'short' });
        const monthDay = recoDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const hasStack = firstReco.stackSize > 0;
        const stackMsg = hasStack ? ' 📍' : '';
        const totalSlots = state.allCandidatesForCity.length;
        const cityMatchCount = cityMatchCandidates.length;
        const slotMsg = cityMatchCount > 0 ? `${cityMatchCount} match` : 'No match';
        showToast(`${dayName} ${monthDay}: ${slotMsg}, ${totalSlots} total slots`);

        // Expand and scroll to the recommended day
        if (firstReco) {
            const card = document.querySelector(`.day-card[data-date="${firstReco.dateStr}"]`);
            if (card) {
                setCardCollapsed(card, false);
                highlightSuggested(card, firstReco.blockKey, firstReco.reason);
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
        } finally {
            _recoRunning = false;
            // If another call was queued while running, execute it now
            if (_recoQueued) {
                console.log('[RECO DEBUG] Running queued recommendation');
                _recoQueued = false;
                setTimeout(() => runMainRecommendation(), 100);
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
        state.recoDayIndex = 0; // Clear day navigation
        state.recoAvailableDays = []; // Clear available days
        state.allCandidatesForCity = []; // Clear all candidates
        state.recoBestPerDay = {}; // Clear per-day recommendations
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

            // Suppress + collapse the suggestion dropdown for the whole search so a
            // late, in-flight fetch from typing can't flash it open mid-run.
            _suppressAddressSuggestions = true;
            _placesSession = null; // search fired → next address entry starts a fresh Google session
            if (verifiedAddressesList) verifiedAddressesList.classList.add('hidden');

            // Show loading state on Go button
            const originalBtnContent = addrGoBtn.innerHTML;
            addrGoBtn.innerHTML = '<span class="btn-spinner"></span>';
            addrGoBtn.disabled = true;

            try {
            // If user selected a known job from DB suggestion, open it directly
            if (window.__selectedRoofrJobLink && window.__selectedRoofrJob) {
                const url = window.__selectedRoofrJobLink;
                const jobInfo = window.__selectedRoofrJob;
                addLog(`Go: opening known job directly — ${jobInfo.Customer || ''}`);
                const createOpts = { url, active: false };
                if (window.__targetWindowId) createOpts.windowId = window.__targetWindowId;
                await chrome.tabs.create(createOpts);
                window.__selectedRoofrJobLink = null;
                window.__selectedRoofrJob = null;
                window.__selectedRoofrJobInputValue = null;
                return;
            }

            // Check if input is an exact insurance claim number (before phone — some claims are all-digits).
            // Only an EXACT normalized match short-circuits, so partial digit overlap with phones is unaffected.
            const qClaim = inputValue.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (qClaim.length >= 4 && _roofrDataCache && _roofrDataCache.length) {
                const claimMatch = _roofrDataCache.find(job => {
                    const jc = String(job['Claim #'] || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    return jc && jc === qClaim;
                });
                if (claimMatch && claimMatch.Link) {
                    showToast(`Opening claim ${inputValue.trim()}...`);
                    await openJobCard(claimMatch);
                    return;
                }
            }

            // Check if input is a phone number
            const phoneDigits = detectPhoneNumber(inputValue);
            if (phoneDigits) {
                const formattedPhone = formatPhoneForDisplay(phoneDigits);
                const qPhone = _normalizePhone(phoneDigits);

                // Check local catalog — opens job card directly (same as dropdown click)
                if (_roofrDataCache && qPhone.length >= 7) {
                    const match = _roofrDataCache.find(job => {
                        if (!job._nPhone || !job.Link) return false;
                        return job._nPhone === qPhone ||
                               job._nPhone.endsWith(qPhone) ||
                               qPhone.endsWith(job._nPhone) ||
                               job._nPhone.includes(qPhone) ||
                               qPhone.includes(job._nPhone);
                    });
                    if (match) {
                        console.log('[Popup] Phone catalog match:', match.Customer, match.Link);
                        showToast(`Opening ${match.Customer || formattedPhone}...`);
                        await openJobCard(match);
                        return;
                    }
                    console.log('[Popup] No catalog match for phone:', qPhone);
                }

                // Fallback: contacts page search if no local match
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

            // Check if input is a person's name
            const personName = detectName(inputValue);
            if (personName) {
                // It's a name - search Roofr contacts
                showToast(`Searching Roofr for "${personName}"...`);

                try {
                    await chrome.runtime.sendMessage({
                        type: 'OPEN_CONTACTS_FOR_PHONE',
                        phoneNumber: personName, // Reuse field - content script just injects into search
                        formattedPhone: personName,
                        callerName: '', // No caller name for manual search
                        windowId: window.__targetWindowId // Pass target window for window isolation
                    });
                    addLog(`Opened contacts search for name: ${personName}`);
                } catch (err) {
                    console.error('[Popup] Error opening contacts for name:', err);
                    showToast('Error opening contacts');
                }
                return; // Don't continue with address flow
            }

            // Not a phone or name - treat as address
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

                        // Lookup APN for the address
                        let apnResult = null;
                        const cityMatch = CONFIG.findCityInString(verifiedAddress);
                        if (cityMatch && cityMatch.city) {
                            addLog(`Looking up APN for ${verifiedAddress} in ${cityMatch.city}...`);
                            apnResult = await CONFIG.lookupAPN(verifiedAddress, cityMatch.city);
                            if (apnResult.success) {
                                const ownerInfo = apnResult.owner ? `, Owner: ${apnResult.owner}` : '';
                                const pd = apnResult.propertyData || {};
                                const extras = [];
                                if (pd.yearBuilt) extras.push(`Built ${pd.yearBuilt}`);
                                if (pd.sqftFormatted) extras.push(`${pd.sqftFormatted} sqft`);
                                if (pd.stories) extras.push(`${pd.stories}s`);
                                const extraInfo = extras.length > 0 ? ` | ${extras.join(', ')}` : '';
                                addLog(`Found APN: ${apnResult.apn}${ownerInfo} (${apnResult.county})${extraInfo}`);
                            } else {
                                addLog(`APN lookup: ${apnResult.error || 'not found'}`);
                            }
                        } else {
                            addLog('Could not determine city for APN lookup');
                        }

                        // Build the message to send to Gemini (address + APN + owner + property data)
                        let geminiMessage = verifiedAddress;
                        if (apnResult && apnResult.success) {
                            geminiMessage = `${verifiedAddress}\nAPN: ${apnResult.apn}`;
                            if (apnResult.owner) {
                                geminiMessage += `\nLegal Owner: ${apnResult.owner}`;
                            }
                            // Include verified property data so Gemini doesn't hallucinate
                            const pd = apnResult.propertyData || {};
                            if (pd.yearBuilt) geminiMessage += `\nYear Built: ${pd.yearBuilt}`;
                            if (pd.roofAge != null) geminiMessage += `\nRoof Age: ${pd.roofAge}yrs`;
                            if (pd.sqftFormatted) geminiMessage += `\nSq Ft: ${pd.sqftFormatted}`;
                            if (pd.stories) geminiMessage += `\nStories: ${pd.stories}`;
                            if (pd.subdivision) geminiMessage += `\nSubdivision: ${pd.subdivision}`;
                            if (pd.propertyValueFormatted) geminiMessage += `\nProperty Value: ${pd.propertyValueFormatted}`;
                            if (pd.salePriceFormatted) geminiMessage += `\nLast Sale: ${pd.salePriceFormatted}`;
                            if (pd.saleDate) geminiMessage += ` (${pd.saleDate})`;
                            if (pd.deedDate) geminiMessage += `\nDeed Recorded: ${pd.deedDate}`;
                            if (pd.ownerType) geminiMessage += `\nOwner Type: ${pd.ownerType}`;
                            if (pd.absentee) geminiMessage += `\nABSENTEE OWNER (mails to ${pd.absenteeLocation})`;
                            if (pd.mailAddress) geminiMessage += `\nOwner Mailing: ${pd.mailAddress}`;
                            if (pd.inCareOf) geminiMessage += `\nIn Care Of: ${pd.inCareOf}`;
                            if (pd.roofType) geminiMessage += `\nRoof Type: ${pd.roofType}`;
                            if (pd.qualityGrade) geminiMessage += `\nQuality Grade: ${pd.qualityGrade}`;
                            if (pd.suite) geminiMessage += `\nUnit: ${pd.suite}`;
                            if (pd.lat != null && pd.lng != null) geminiMessage += `\nGPS: ${pd.lat}, ${pd.lng}`;

                            // Append active call phone number
                            const geminiPhones = window.__activeCallPhones || [];
                            if (geminiPhones.length > 0) {
                                const gDigits = geminiPhones[0].replace(/\D/g, '');
                                const gPhone10 = gDigits.length === 11 && gDigits.startsWith('1') ? gDigits.substring(1) : gDigits;
                                if (gPhone10.length === 10) {
                                    geminiMessage += `\nCaller: ${gPhone10.substring(0,3)}-${gPhone10.substring(3,6)}-${gPhone10.substring(6)}`;
                                }
                            }
                        }

                        // Add APN info to Notes section (prepend to existing notes)
                        if (apnResult && apnResult.success) {
                            const dockNoteInput = document.getElementById("dock-note-input");
                            if (dockNoteInput) {
                                // Build the property info block
                                let propertyInfo = `<div><strong>${verifiedAddress}</strong></div>`;

                                // APN as clickable link to county assessor
                                if (apnResult.detailUrl) {
                                    propertyInfo += `<div>APN: <a href="${apnResult.detailUrl}" target="_blank" style="color:#1a73e8;text-decoration:underline;">${apnResult.apn}</a></div>`;
                                } else {
                                    propertyInfo += `<div>APN: ${apnResult.apn}</div>`;
                                }

                                // Owner as clickable link to county assessor
                                if (apnResult.owner && apnResult.detailUrl) {
                                    propertyInfo += `<div>Owner: <a href="${apnResult.detailUrl}" target="_blank" style="color:#1a73e8;text-decoration:underline;">${apnResult.owner}</a></div>`;
                                } else if (apnResult.owner) {
                                    propertyInfo += `<div>Owner: ${apnResult.owner}</div>`;
                                } else if (apnResult.detailUrl) {
                                    // For counties without owner data (like Pima), show link to view info
                                    propertyInfo += `<div>Owner: <a href="${apnResult.detailUrl}" target="_blank" style="color:#1a73e8;text-decoration:underline;">View on ${apnResult.county} site</a></div>`;
                                }

                                // Property details from county assessor (real data, not AI-generated)
                                const pd = apnResult.propertyData || {};
                                const detailLines = [];
                                if (apnResult.ambiguous) detailLines.push(`<span style="color:#d93025;font-weight:600;">⚠ ${apnResult.matchCount} units at this address — re-search with the unit # (e.g. "#2020") to lock the exact one</span>`);
                                if (pd.yearBuilt) detailLines.push(`Built: ${pd.yearBuilt} (${pd.roofAge}yrs)`);
                                if (pd.sqftFormatted) detailLines.push(`Sq Ft: ${pd.sqftFormatted}`);
                                if (pd.stories) detailLines.push(`Stories: ${pd.stories}`);
                                if (pd.subdivision) detailLines.push(`Subdiv: ${pd.subdivision}`);
                                if (pd.propertyValueFormatted) detailLines.push(`Value: ${pd.propertyValueFormatted}`);
                                if (pd.salePriceFormatted) {
                                    let saleLine = `Last Sale: ${pd.salePriceFormatted}`;
                                    if (pd.saleDate) saleLine += ` (${pd.saleDate})`;
                                    detailLines.push(saleLine);
                                }
                                // Added 2026-06-05: absentee / owner-occupancy / deed recency
                                if (pd.ownerType) detailLines.push(`Owner Type: ${pd.ownerType}`);
                                if (pd.absentee) detailLines.push(`<span style="color:#d93025;font-weight:600;">⚠ Absentee owner — mails to ${pd.absenteeLocation}</span>`);
                                if (pd.absentee && pd.mailAddress) detailLines.push(`Mailing: ${pd.mailAddress}`);
                                if (pd.deedDate) detailLines.push(`Deed: ${pd.deedDate}`);
                                if (pd.inCareOf) detailLines.push(`In Care Of: ${pd.inCareOf}`);
                                if (pd.roofType) detailLines.push(`<span style="color:#188038;font-weight:600;">🏠 Roof: ${pd.roofType}</span>`);
                                if (pd.qualityGrade) detailLines.push(`Quality: ${pd.qualityGrade}`);
                                if (pd.suite) detailLines.push(`Unit: ${pd.suite}`);
                                if (pd.lotNum) detailLines.push(`Lot: ${pd.lotNum}`);
                                if (pd.lat != null && pd.lng != null) detailLines.push(`📍 <a href="https://earth.google.com/web/search/${pd.lat},${pd.lng}" target="_blank" style="color:#1a73e8;text-decoration:underline;">${(+pd.lat).toFixed(5)}, ${(+pd.lng).toFixed(5)}</a>`);

                                if (detailLines.length > 0) {
                                    propertyInfo += detailLines.map(l => `<div>${l}</div>`).join('');
                                }

                                // Add active call phone number with CTM link
                                const activePhones = window.__activeCallPhones || [];
                                if (activePhones.length > 0) {
                                    const phone = activePhones[0];
                                    let phoneFormatted = phone;
                                    const digits = phone.replace(/\D/g, '');
                                    const phone10 = digits.length === 11 && digits.startsWith('1') ? digits.substring(1) : digits;
                                    if (phone10.length === 10) {
                                        phoneFormatted = `${phone10.substring(0,3)}-${phone10.substring(3,6)}-${phone10.substring(6)}`;
                                    }
                                    const ctmLink = `https://app.calltrackingmetrics.com/calls#filter=${phone10}`;
                                    propertyInfo += `<div><a href="${ctmLink}" target="_blank" style="color:#1a73e8;text-decoration:underline;">${phoneFormatted}</a></div>`;
                                }

                                // Nearby jobs we've already done — social proof for the rep to
                                // mention ("we did the roof down the street a few weeks ago").
                                // Computed entirely from the Roofr data already cached client-side
                                // (_roofrDataCache, preloaded on popup open) — NO extra API call.
                                // Coords: prefer the county parcel centroid (rooftop), fall back to
                                // the geocoder coords from the chosen suggestion.
                                try {
                                    const _njPd = apnResult.propertyData || {};
                                    let _njLat = (_njPd.lat != null) ? parseFloat(_njPd.lat) : NaN;
                                    let _njLng = (_njPd.lng != null) ? parseFloat(_njPd.lng) : NaN;
                                    if ((isNaN(_njLat) || isNaN(_njLng)) && window.__selectedAddrCoords) {
                                        _njLat = parseFloat(window.__selectedAddrCoords.lat);
                                        _njLng = parseFloat(window.__selectedAddrCoords.lng);
                                    }
                                    if (!isNaN(_njLat) && !isNaN(_njLng) && Array.isArray(_roofrDataCache) && _roofrDataCache.length) {
                                        const _njRelative = (val) => {
                                            if (!val) return '';
                                            const then = new Date(val);
                                            if (isNaN(then.getTime())) return '';
                                            const days = Math.floor((Date.now() - then.getTime()) / 86400000);
                                            if (days < 0) return 'recently';
                                            if (days === 0) return 'today';
                                            if (days === 1) return 'yesterday';
                                            if (days < 14) return `${days} days ago`;
                                            if (days < 60) return `${Math.round(days / 7)} weeks ago`;
                                            if (days < 365) return `${Math.round(days / 30)} months ago`;
                                            const yrs = days / 365;
                                            return yrs < 1.5 ? 'about a year ago' : `${Math.round(yrs)} years ago`;
                                        };
                                        // Haversine miles between the searched address and each
                                        // won/completed job that has coordinates.
                                        const _toRad = (d) => d * Math.PI / 180;
                                        const _latR = _toRad(_njLat);
                                        const _cosLat = Math.cos(_latR);
                                        const _near = [];
                                        for (const job of _roofrDataCache) {
                                            const cat = (job['Stage category'] || '').toLowerCase();
                                            if (cat !== 'won' && cat !== 'completed') continue;
                                            const jlat = parseFloat(job.Latitude);
                                            const jlng = parseFloat(job.Longitude);
                                            if (isNaN(jlat) || isNaN(jlng)) continue;
                                            const dLat = _toRad(jlat - _njLat);
                                            const dLng = _toRad(jlng - _njLng);
                                            const a = Math.sin(dLat / 2) ** 2 + _cosLat * Math.cos(_toRad(jlat)) * Math.sin(dLng / 2) ** 2;
                                            const dist = 2 * 3959 * Math.asin(Math.min(1, Math.sqrt(a)));
                                            if (dist > 0.01 && dist <= 1) _near.push({ job, dist, cat });
                                        }
                                        _near.sort((a, b) => a.dist - b.dist);
                                        if (_near.length) {
                                            propertyInfo += `<div style="margin-top:4px;"><strong>🏠 We've worked nearby:</strong></div>`;
                                            for (const { job, dist, cat } of _near.slice(0, 3)) {
                                                const tag = (cat === 'completed') ? '✅ Completed' : '🔨 In production';
                                                const distTxt = `${dist.toFixed(2)} mi`;
                                                const _val = parseFloat(job.Value);
                                                const valTxt = (!isNaN(_val) && _val > 0) ? ` · $${Math.round(_val).toLocaleString('en-US')}` : '';
                                                const when = _njRelative(job['Job close date']);
                                                const whenTxt = when ? ` · ${when}` : '';
                                                const stageTxt = job.Stage ? ` <span style="color:#5f6368;">(${job.Stage})</span>` : '';
                                                // Customer name → Roofr job card; address → Google Maps.
                                                const cust = (job.Customer || '').trim();
                                                const custLink = cust
                                                    ? (job.Link
                                                        ? `<a href="${job.Link}" target="_blank" style="color:#1a73e8;text-decoration:underline;">${_escapeHtml(cust)}</a>`
                                                        : _escapeHtml(cust))
                                                    : '';
                                                const custTxt = custLink ? `${custLink}, ` : '';
                                                const addr = job.Address || 'address n/a';
                                                const _mLat = parseFloat(job.Latitude);
                                                const _mLng = parseFloat(job.Longitude);
                                                const _mapsQuery = (!isNaN(_mLat) && !isNaN(_mLng)) ? `${_mLat},${_mLng}` : addr;
                                                const _mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(_mapsQuery)}`;
                                                const addrHtml = `<a href="${_mapsUrl}" target="_blank" style="color:#1a73e8;text-decoration:underline;">${_escapeHtml(addr)}</a>`;
                                                propertyInfo += `<div>${tag} ${distTxt}${valTxt} — ${custTxt}${addrHtml}${whenTxt}${stageTxt}</div>`;
                                            }
                                            const _njExtra = _near.length - Math.min(3, _near.length);
                                            if (_njExtra > 0) {
                                                propertyInfo += `<div style="color:#5f6368;">+${_njExtra} more within 1 mile</div>`;
                                            }
                                        }
                                    }
                                } catch (njErr) {
                                    addLog('Nearby jobs lookup failed: ' + njErr.message);
                                }

                                propertyInfo += `<div>---</div>`;

                                // Get existing notes content
                                const existingContent = dockNoteInput.innerHTML.trim();

                                // Prepend new info to existing notes
                                if (existingContent && existingContent !== '<br>') {
                                    dockNoteInput.innerHTML = propertyInfo + existingContent;
                                } else {
                                    dockNoteInput.innerHTML = propertyInfo;
                                }

                                // Trigger input event to save to storage
                                dockNoteInput.dispatchEvent(new Event('input', { bubbles: true }));
                                addLog('Added property info to Notes');
                            }
                        }

                        // Find or create Google Earth tab in target window (reuse existing if found)
                        if (settings.search_google_earth !== false) {
                        // Only trust coordinates from a REAL county parcel — that centroid sits on the
                        // actual rooftop for a normal lot. For mobile/RV parks, tribal land, new builds,
                        // or any address with no individual county parcel, the geocoder (LocationIQ/Census)
                        // only knows the park CENTER, not the specific space — that's the wrong-GPS problem.
                        // In that case let Google Earth search the address text and use Google's own
                        // geocoder, which places the unit/space far better than the centroid ever could.
                        const _gpsLat = (apnResult && apnResult.success && apnResult.propertyData) ? apnResult.propertyData.lat : null;
                        const _gpsLng = (apnResult && apnResult.success && apnResult.propertyData) ? apnResult.propertyData.lng : null;
                        // For the address-search fallback, Google Earth pins a unit address FAR more
                        // accurately from the bare "street #unit" than from the full string with
                        // city/state/zip (the ZIP makes it land mid-street). So when there's a unit/lot,
                        // search only the first segment; otherwise keep the full address for disambiguation.
                        const _firstSeg = verifiedAddress.split(',')[0].trim();
                        const _hasUnit = /(#\s*[A-Za-z0-9-]+|\b(?:unit|apt|apartment|ste|suite|spc|space|bldg|building|lot|trlr|trailer|rm|room)\s*#?\s*[A-Za-z0-9-]+)\s*$/i.test(_firstSeg);
                        const _earthQuery = _hasUnit ? _firstSeg : verifiedAddress;
                        const googleEarthUrl = (_gpsLat != null && _gpsLng != null && !isNaN(_gpsLat) && !isNaN(_gpsLng))
                            ? `https://earth.google.com/web/search/${_gpsLat},${_gpsLng}`
                            : `https://earth.google.com/web/search/${encodeURIComponent(_earthQuery)}`;
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
                            // Reuse the existing tab but RESET it to a fresh Gem chat (navigate to the
                            // base Gem URL) so each address search starts a clean conversation instead of
                            // stacking onto the previous one — and we never pile up extra Gemini tabs.
                            geminiTab = existingGeminiTabs[0];
                            // If duplicates already piled up, close all but the one we'll reuse.
                            if (existingGeminiTabs.length > 1) {
                                const extras = existingGeminiTabs.slice(1).map(t => t.id);
                                try { await chrome.tabs.remove(extras); } catch (e) { /* tabs may already be gone */ }
                                addLog(`Closed ${extras.length} duplicate Gemini tab(s)`);
                            }
                            await chrome.tabs.update(geminiTab.id, { url: geminiGemBaseUrl, active: false });
                            needsPageLoad = true;
                            addLog(`Reusing Gemini tab ${geminiTab.id} — reset to a fresh Gem chat`);
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

                                    // Function to switch Gemini to Pro mode (from Fast/Flash)
                                    // Returns a Promise that resolves when switch is complete (or skipped)
                                    const switchToProMode = () => {
                                        return new Promise((resolve) => {
                                            console.log('[Roofr Extension] Attempting to switch to Pro mode...');

                                            // STEP 1: Find the mode picker button using stable data-test-id
                                            let modeButton = document.querySelector('button[data-test-id="bard-mode-menu-button"]');

                                            // Fallback: aria-label
                                            if (!modeButton) {
                                                modeButton = document.querySelector('button[aria-label="Open mode picker"]');
                                            }

                                            // Fallback: text-based search
                                            if (!modeButton) {
                                                const allButtons = document.querySelectorAll('button');
                                                for (const btn of allButtons) {
                                                    const text = btn.textContent?.trim() || '';
                                                    if (/^(fast|pro|thinking)$/i.test(text)) {
                                                        console.log('[Roofr Extension] Found mode button by text:', text);
                                                        modeButton = btn;
                                                        break;
                                                    }
                                                }
                                            }

                                            if (!modeButton) {
                                                console.log('[Roofr Extension] Could not find mode picker button');
                                                resolve(false);
                                                return;
                                            }

                                            // Check if already on Pro — skip if so
                                            const currentMode = modeButton.textContent?.trim().toLowerCase() || '';
                                            if (currentMode === 'pro') {
                                                console.log('[Roofr Extension] Already on Pro mode, skipping switch');
                                                resolve(true);
                                                return;
                                            }

                                            console.log('[Roofr Extension] Current mode:', currentMode, '— clicking to open menu...');
                                            modeButton.click();

                                            // STEP 2: Poll for the Pro option to appear in the menu (menu items are dynamic)
                                            let attempts = 0;
                                            const maxAttempts = 40; // 40 x 100ms = 4 seconds max
                                            const pollForPro = () => {
                                                attempts++;

                                                // Primary: stable data-test-id
                                                let proOption = document.querySelector('[data-test-id="bard-mode-option-pro"]');

                                                // Fallback: menuitemradio with Pro text
                                                if (!proOption) {
                                                    const menuItems = document.querySelectorAll('[role="menuitemradio"]');
                                                    for (const item of menuItems) {
                                                        if (item.textContent?.includes('Pro')) {
                                                            proOption = item;
                                                            break;
                                                        }
                                                    }
                                                }

                                                if (proOption) {
                                                    console.log('[Roofr Extension] Found Pro option after', attempts, 'polls, clicking...');
                                                    proOption.click();

                                                    // Verify the switch took effect
                                                    setTimeout(() => {
                                                        const newMode = modeButton.textContent?.trim().toLowerCase() || '';
                                                        console.log('[Roofr Extension] Mode after switch:', newMode);
                                                        resolve(true);
                                                    }, 300);
                                                    return;
                                                }

                                                if (attempts >= maxAttempts) {
                                                    console.log('[Roofr Extension] Pro option not found after', maxAttempts, 'attempts');
                                                    // Close the menu so it doesn't block input
                                                    document.body.click();
                                                    resolve(false);
                                                    return;
                                                }

                                                setTimeout(pollForPro, 100);
                                            };

                                            // Start polling after a brief initial delay for the menu to begin rendering
                                            setTimeout(pollForPro, 100);
                                        });
                                    };

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

                                    // FIRST: Switch to Pro mode, THEN fill and send
                                    console.log('[Roofr Extension] Switching to Pro mode before sending...');
                                    switchToProMode().then((switched) => {
                                        console.log('[Roofr Extension] Pro mode switch result:', switched, '— now filling...');
                                        // Brief delay after switch for UI to stabilize
                                        setTimeout(() => {
                                            if (!fillAndSend()) {
                                                setTimeout(() => {
                                                    if (!fillAndSend()) {
                                                        setTimeout(fillAndSend, 2000);
                                                    }
                                                }, 1000);
                                            }
                                        }, 500);
                                    });
                                },
                                args: [geminiMessage]
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

                        // Roofr job search — shortcut if user selected a known job from database
                        if (window.__selectedRoofrJobLink) {
                            const directUrl = window.__selectedRoofrJobLink;
                            const jobInfo = window.__selectedRoofrJob;
                            addLog(`Opening known job directly: ${jobInfo?.Customer || ''} — ${directUrl}`);

                            // Open the job link in a new tab
                            const jobTab = await chrome.tabs.create({ url: directUrl, active: false, windowId: currentWindowId });
                            addLog(`Opened Roofr job tab (ID: ${jobTab.id})`);

                            // Clear the selection
                            window.__selectedRoofrJobLink = null;
                            window.__selectedRoofrJob = null;
                            window.__selectedRoofrJobInputValue = null;

                        // Fall back to DOM search if no known job selected
                        } else if (settings.search_roofr !== false) {
                        // Extract street address for search, INCLUDING any unit/lot. Roofr's search indexes
                        // the job NAME (verified live: searching "Vader" returns that job), and every unit in
                        // a complex shares the SAME base address — so searching WITH the unit is what finds the
                        // exact job (whose name carries the unit) and cleanly returns "No jobs found" for a new
                        // unit, instead of pulling up a neighbor's job at the same shared address.
                        const streetAddress = verifiedAddress.split(',')[0].trim();
                        // Expand abbreviations for search: N -> North, Ln -> Lane, etc.
                        const expandedStreetAddress = streetAddress
                            // Directional prefixes
                            .replace(/\bN\.?\s+/gi, 'North ')
                            .replace(/\bS\.?\s+/gi, 'South ')
                            .replace(/\bE\.?\s+/gi, 'East ')
                            .replace(/\bW\.?\s+/gi, 'West ')
                            .replace(/\bNE\.?\s+/gi, 'Northeast ')
                            .replace(/\bNW\.?\s+/gi, 'Northwest ')
                            .replace(/\bSE\.?\s+/gi, 'Southeast ')
                            .replace(/\bSW\.?\s+/gi, 'Southwest ')
                            // Street types (at end of street name)
                            .replace(/\bLn\.?$/gi, 'Lane')
                            .replace(/\bRd\.?$/gi, 'Road')
                            .replace(/\bSt\.?$/gi, 'Street')
                            .replace(/\bAve\.?$/gi, 'Avenue')
                            .replace(/\bBlvd\.?$/gi, 'Boulevard')
                            .replace(/\bDr\.?$/gi, 'Drive')
                            .replace(/\bCt\.?$/gi, 'Court')
                            .replace(/\bCir\.?$/gi, 'Circle')
                            .replace(/\bPl\.?$/gi, 'Place')
                            .replace(/\bPkwy\.?$/gi, 'Parkway')
                            .replace(/\bHwy\.?$/gi, 'Highway')
                            .replace(/\bWay\.?$/gi, 'Way')
                            .replace(/\bTrl\.?$/gi, 'Trail')
                            .replace(/\bTer\.?$/gi, 'Terrace')
                            .replace(/\bLoop\.?$/gi, 'Loop')
                            .replace(/\bPass\.?$/gi, 'Pass')
                            .replace(/\bAlley\.?$/gi, 'Alley')
                            .replace(/\bAly\.?$/gi, 'Alley');

                        // Roofr's job search is a CONTIGUOUS-substring match (verified live): a multi-word term
                        // must appear verbatim in the stored address. Geocoders routinely drop or reformat the
                        // directional ("1310 Lesueur" vs the stored "1310 North Lesueur", or "N" vs "North"), so
                        // searching the full street MISSES existing jobs and creates duplicates. The house NUMBER
                        // is always a contiguous token that reliably returns the job; the precise row-matcher
                        // (house# + street word + unit) then picks the exact one. Fall back to the full street
                        // only if there's no house number.
                        const _houseNumberForSearch = (streetAddress.match(/\b\d{1,6}\b/) || [])[0] || '';
                        const roofrSearchTerm = _houseNumberForSearch || expandedStreetAddress;

                        // Build search URL - navigate to base list view (will inject search via content script)
                        const roofrSearchUrl = 'https://app.roofr.com/dashboard/team/239329/jobs/list-view';
                        const roofrJobsUrl = 'https://app.roofr.com/dashboard/team/239329/jobs';
                        addLog(`Searching Roofr for: ${roofrSearchTerm} (full address: ${verifiedAddress})`);

                        let jobsNeedsPageLoad = false;

                        // Always create a new tab for the search
                        jobsTab = await chrome.tabs.create({ url: roofrSearchUrl, active: false, windowId: currentWindowId });
                        jobsNeedsPageLoad = true;
                        addLog(`Created Roofr search tab (ID: ${jobsTab.id})`);

                        // Store the original address for job creation fallback
                        const originalAddress = verifiedAddress;

                        // Wait for page to load, then inject search into the search bar
                        if (jobsNeedsPageLoad) {
                            chrome.tabs.onUpdated.addListener(function jobsListener(tabId, info) {
                                if (tabId === jobsTab.id && info.status === 'complete') {
                                    chrome.tabs.onUpdated.removeListener(jobsListener);

                                    // Add extra delay to ensure React has fully rendered
                                    setTimeout(() => {
                                        // Inject the address into the search bar with retry logic
                                        addLog(`Injecting job search: ${roofrSearchTerm}`);

                                        const attemptInjection = (attemptNum) => {
                                            if (attemptNum > 3) {
                                                addLog(`Failed to inject search after 3 attempts`, 'ERROR');
                                                return;
                                            }

                                            chrome.tabs.sendMessage(jobsTab.id, {
                                                type: 'INJECT_JOB_SEARCH',
                                                address: roofrSearchTerm
                                            }).then(result => {
                                                if (result && result.ok) {
                                                    addLog(`Job search injected successfully (attempt ${attemptNum})`);
                                                    // Wait for search results to load, then check results
                                                    setTimeout(() => handleSearchResults(jobsTab.id, originalAddress, roofrJobsUrl), 4000);
                                                } else {
                                                    addLog(`Injection attempt ${attemptNum} failed: ${result?.error || 'unknown'}, retrying...`);
                                                    setTimeout(() => attemptInjection(attemptNum + 1), 1000);
                                                }
                                            }).catch(err => {
                                                addLog(`Error on attempt ${attemptNum}: ${err.message}, retrying...`);
                                                setTimeout(() => attemptInjection(attemptNum + 1), 1000);
                                            });
                                        };

                                        attemptInjection(1);
                                    }, 1000); // Wait 1 extra second after page complete
                                }
                            });
                        }

                        // Function to check search results and either click the first result or create new job
                        const handleSearchResults = (tabId, address, jobsUrl) => {
                            addLog(`Checking search results on tab ${tabId}`);
                            chrome.scripting.executeScript({
                                target: { tabId: tabId },
                                func: (address, jobsUrl) => {
                                    console.log('[Roofr Extension] Checking search results for:', address);

                                    // Derive the house number + a distinctive street word so we ONLY open a
                                    // row that actually matches the searched address. Roofr's search bar
                                    // sometimes fails to filter (or the inject hits the wrong field); without
                                    // this we'd open whatever job sits on top — an unrelated job card.
                                    const _addrLc = String(address || '').toLowerCase();
                                    const _houseNum = (_addrLc.match(/\b(\d{1,6})\b/) || [])[1] || '';
                                    const _streetWord = (() => {
                                        const seg = _addrLc.split(',')[0]
                                            .replace(/\s*(?:#|\b(?:unit|apt|apartment|ste|suite|spc|space|bldg|building|lot|trlr|trailer|rm|room)\s*#?)\s*[a-z0-9-]+\s*$/i, '');
                                        const stop = new Set(['north','south','east','west','northeast','northwest','southeast','southwest','avenue','ave','street','st','drive','dr','road','rd','lane','ln','court','ct','place','pl','boulevard','blvd','circle','cir','trail','trl','way','terrace','ter','parkway','pkwy','highway','hwy','loop','pass','point','pt']);
                                        const words = seg.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !stop.has(w));
                                        return words.sort((a, b) => b.length - a.length)[0] || '';
                                    })();
                                    // Roofr stores EVERY unit in a complex under the same base address — the
                                    // unit/lot lives ONLY in the job NAME column. So when the searched address
                                    // has a unit, a row matches only if its NAME cell carries that same unit;
                                    // the shared address alone must NOT count as a hit (it'd open a neighbor's job).
                                    const _unitM = _addrLc.split(',')[0].match(/(?:#|\b(?:unit|apt|apartment|ste|suite|spc|space|bldg|building|lot|trlr|trailer|rm|room)\s*#?)\s*([a-z0-9-]+)\s*$/i);
                                    const _unitNum = _unitM ? _unitM[1].replace(/[^a-z0-9]/gi, '').replace(/^0+/, '') : '';
                                    const _cell = (row, col) => { const c = row.querySelector('[col-id="' + col + '"]'); return c ? (c.textContent || '').toLowerCase() : ''; };
                                    const _addrMatches = (el) => {
                                        const a = _cell(el, 'address') || (el.textContent || '').toLowerCase();
                                        if (_houseNum && !a.includes(_houseNum)) return false;
                                        if (_streetWord && !a.includes(_streetWord)) return false;
                                        return !!(_houseNum || _streetWord);
                                    };
                                    const _unitMatches = (el) => {
                                        if (!_unitNum) return true; // no unit to disambiguate
                                        const hay = (_cell(el, 'name') || el.textContent || '').toLowerCase();
                                        return new RegExp('(?:#|\\b(?:unit|apt|apartment|ste|suite|spc|space|bldg|building|lot|trlr|trailer|rm|room)\\s*#?)\\s*0*' + _unitNum + '\\b', 'i').test(hay);
                                    };
                                    // Only the center/data rows (the pinned-right container holds a duplicate row with the View button).
                                    const _dataRows = () => Array.from(document.querySelectorAll('.ag-row:not(.ag-header-row), table tbody tr')).filter(r => !r.closest('.ag-pinned-right-cols-container'));
                                    const findMatchingRow = () => { for (const r of _dataRows()) { if (_addrMatches(r) && _unitMatches(r)) return r; } return null; };
                                    const hasBaseAddressRow = () => _dataRows().some(r => _addrMatches(r));
                                    const clickRow = (row) => {
                                        if (!row) return false;
                                        // The "View" button lives in a sibling pinned-right .ag-row that shares row-id (= job id).
                                        const rid = row.getAttribute('row-id');
                                        const ridx = row.getAttribute('row-index');
                                        let scope = [row];
                                        if (rid != null) scope = Array.from(document.querySelectorAll('.ag-row[row-id="' + rid + '"]'));
                                        else if (ridx != null) scope = Array.from(document.querySelectorAll('.ag-row[row-index="' + ridx + '"]'));
                                        for (const r of scope) {
                                            for (const b of r.querySelectorAll('button, a, [role="button"]')) {
                                                const tx = b.textContent?.trim();
                                                if (tx === 'View' || (tx && tx.includes('View'))) { b.click(); return true; }
                                            }
                                        }
                                        (row.querySelector('[role="gridcell"], .ag-cell') || row).click();
                                        return true;
                                    };

                                    // Function to count job rows in the list view
                                    const countJobRows = () => {
                                        // Primary: AG Grid data rows (current Roofr UI)
                                        const agRows = document.querySelectorAll('.ag-row:not(.ag-header-row)');
                                        if (agRows.length > 0) {
                                            console.log('[Roofr Extension] Found', agRows.length, 'AG Grid data rows');
                                            return agRows.length;
                                        }

                                        // Fallback: Look for table rows (legacy)
                                        const tableRows = document.querySelectorAll('table tbody tr');
                                        if (tableRows.length > 0) {
                                            console.log('[Roofr Extension] Found', tableRows.length, 'table rows');
                                            return tableRows.length;
                                        }

                                        // Fallback: Count View buttons as proxy for job rows
                                        const viewBtns = Array.from(document.querySelectorAll('button, a')).filter(b => b.textContent?.trim() === 'View');
                                        if (viewBtns.length > 0) {
                                            console.log('[Roofr Extension] Found', viewBtns.length, 'View buttons');
                                            return viewBtns.length;
                                        }

                                        return 0;
                                    };

                                    // Function to click the View button on the first job row
                                    const clickFirstJobRow = () => {
                                        // Priority 1: Find View button in the first AG Grid data row
                                        const firstAgRow = document.querySelector('.ag-row:not(.ag-header-row)');
                                        if (firstAgRow) {
                                            const buttons = firstAgRow.querySelectorAll('button, a, [role="button"]');
                                            for (const btn of buttons) {
                                                const text = btn.textContent?.trim();
                                                if (text === 'View' || text?.includes('View')) {
                                                    console.log('[Roofr Extension] Clicking View button in AG Grid row:', text);
                                                    btn.click();
                                                    return true;
                                                }
                                            }
                                            // If no View button, try clicking the row itself
                                            console.log('[Roofr Extension] No View button in AG row, clicking row');
                                            firstAgRow.click();
                                            return true;
                                        }

                                        // Priority 2: Find View button in a table row (legacy)
                                        const firstTableRow = document.querySelector('table tbody tr:first-child');
                                        if (firstTableRow) {
                                            const buttons = firstTableRow.querySelectorAll('button, a, [role="button"]');
                                            for (const btn of buttons) {
                                                if (btn.textContent?.trim() === 'View') {
                                                    console.log('[Roofr Extension] Clicking View button in table row');
                                                    btn.click();
                                                    return true;
                                                }
                                            }
                                        }

                                        // Priority 3: Find any View button on the page
                                        const allViewButtons = document.querySelectorAll('button, a, [role="button"]');
                                        for (const btn of allViewButtons) {
                                            if (btn.textContent?.trim() === 'View') {
                                                console.log('[Roofr Extension] Clicking standalone View button');
                                                btn.click();
                                                return true;
                                            }
                                        }

                                        return false;
                                    };

                                    // Function to check for "no results" state
                                    const hasNoResults = () => {
                                        // Check for AG Grid overlay (no rows)
                                        const agOverlay = document.querySelector('.ag-overlay-no-rows-wrapper, .ag-overlay');
                                        if (agOverlay && agOverlay.offsetParent !== null) {
                                            console.log('[Roofr Extension] Found AG Grid no-rows overlay');
                                            return true;
                                        }

                                        // Check for zero AG Grid data rows (most reliable)
                                        const agRows = document.querySelectorAll('.ag-row:not(.ag-header-row)');
                                        if (agRows.length === 0) {
                                            console.log('[Roofr Extension] Zero AG Grid data rows');
                                            return true;
                                        }

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

                                        // Check for "No jobs found" or similar text
                                        const pageText = document.body.innerText.toLowerCase();
                                        if (pageText.includes('no results matched') ||
                                            pageText.includes('0 results') ||
                                            pageText.includes('no jobs found') ||
                                            pageText.includes('no results found') ||
                                            pageText.includes('try adjusting your search')) {
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
                                        const addressInput = document.querySelector('input[data-testid="create-job-address-input"], input[id*="address-resolution-input"], input[placeholder="Enter address and select"]');
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

                                    // --- Mirror lot/unit into the Job name (Roofr drops it from the address) ---
                                    const extractUnit = (addr) => {
                                        const seg = String(addr || '').split(',')[0];
                                        const m = seg.match(/(#\s*[A-Za-z0-9-]+|\b(?:unit|apt|apartment|ste|suite|spc|space|bldg|building|lot|trlr|trailer|rm|room)\s*#?\s*[A-Za-z0-9-]+)\s*$/i);
                                        return m ? m[1].replace(/\s+/g, ' ').trim() : '';
                                    };
                                    const setReactValue = (el, val) => {
                                        const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
                                        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
                                        setter.call(el, val);
                                        el.dispatchEvent(new Event('input', { bubbles: true }));
                                        el.dispatchEvent(new Event('change', { bubbles: true }));
                                    };
                                    const fillJobName = () => {
                                        const unit = extractUnit(address);
                                        if (!unit) return true; // no unit/lot — nothing to add
                                        let nameInput = null;
                                        const opt = document.querySelector('input[data-testid="create-job-name-input"], input[placeholder="Optional"]');
                                        if (opt && opt.offsetParent !== null) nameInput = opt;
                                        if (!nameInput) {
                                            for (const lb of document.querySelectorAll('label')) {
                                                if (lb.textContent && lb.textContent.trim().toLowerCase() === 'job name') {
                                                    const grp = lb.closest('.form-group, [class*="form-group"], div');
                                                    const cand = grp && grp.querySelector('input:not([role="combobox"])');
                                                    if (cand && cand.offsetParent !== null) { nameInput = cand; break; }
                                                }
                                            }
                                        }
                                        if (!nameInput) return false;
                                        if (nameInput.value && nameInput.value.trim()) return true; // never clobber a typed name
                                        nameInput.focus();
                                        setReactValue(nameInput, unit);
                                        console.log('[Roofr Extension] Filled Job name with unit/lot:', unit);
                                        return true;
                                    };
                                    const tryFillJobName = (a = 1) => { if (fillJobName()) return; if (a < 8) setTimeout(() => tryFillJobName(a + 1), 400); };

                                    // Check results with retries (page may still be loading)
                                    let attempts = 0;
                                    const maxAttempts = 20;

                                    const checkAndAct = () => {
                                        attempts++;
                                        console.log(`[Roofr Extension] Attempt ${attempts}/${maxAttempts} to check search results`);

                                        const jobCount = countJobRows();
                                        const noResults = hasNoResults();

                                        console.log(`[Roofr Extension] Found ${jobCount} job rows, noResults: ${noResults}`);

                                        // Only open a row that ACTUALLY matches the searched address — never
                                        // blindly open the top row (if the search didn't filter we'd open an
                                        // unrelated job, e.g. opening "Vader / Hatcher Rd" for a Peoria search).
                                        const matchRow = findMatchingRow();
                                        if (matchRow) {
                                            console.log('[Roofr Extension] Row matches searched address - opening it');
                                            if (clickRow(matchRow)) {
                                                return { action: 'clicked_result', count: jobCount };
                                            }
                                        }

                                        if (noResults || attempts >= maxAttempts) {
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
                                                            tryFillJobName();
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
                                        const modalInput = document.querySelector('input[data-testid="create-job-address-input"], input[placeholder="Enter address and select"]');
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

                                    // --- Mirror lot/unit into the Job name (Roofr drops it from the address) ---
                                    const extractUnit = (addr) => {
                                        const seg = String(addr || '').split(',')[0];
                                        const m = seg.match(/(#\s*[A-Za-z0-9-]+|\b(?:unit|apt|apartment|ste|suite|spc|space|bldg|building|lot|trlr|trailer|rm|room)\s*#?\s*[A-Za-z0-9-]+)\s*$/i);
                                        return m ? m[1].replace(/\s+/g, ' ').trim() : '';
                                    };
                                    const setReactValue = (el, val) => {
                                        const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
                                        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
                                        setter.call(el, val);
                                        el.dispatchEvent(new Event('input', { bubbles: true }));
                                        el.dispatchEvent(new Event('change', { bubbles: true }));
                                    };
                                    const fillJobName = () => {
                                        const unit = extractUnit(address);
                                        if (!unit) return true; // no unit/lot — nothing to add
                                        let nameInput = null;
                                        const opt = document.querySelector('input[data-testid="create-job-name-input"], input[placeholder="Optional"]');
                                        if (opt && opt.offsetParent !== null) nameInput = opt;
                                        if (!nameInput) {
                                            for (const lb of document.querySelectorAll('label')) {
                                                if (lb.textContent && lb.textContent.trim().toLowerCase() === 'job name') {
                                                    const grp = lb.closest('.form-group, [class*="form-group"], div');
                                                    const cand = grp && grp.querySelector('input:not([role="combobox"])');
                                                    if (cand && cand.offsetParent !== null) { nameInput = cand; break; }
                                                }
                                            }
                                        }
                                        if (!nameInput) return false;
                                        if (nameInput.value && nameInput.value.trim()) return true; // never clobber a typed name
                                        nameInput.focus();
                                        setReactValue(nameInput, unit);
                                        console.log('[Roofr Extension] Filled Job name with unit/lot:', unit);
                                        return true;
                                    };
                                    const tryFillJobName = (a = 1) => { if (fillJobName()) return; if (a < 8) setTimeout(() => tryFillJobName(a + 1), 400); };

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
                                                    tryFillJobName();
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

                        // NOTE: Tab listener and handleSearchResults call is now handled above in the injection flow (lines 4900-4937)
                        // The old duplicate listener has been removed to prevent double-clicking

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

                                // Move the group to the left, after any pinned tabs
                                const queryOpts = { pinned: true };
                                if (window.__targetWindowId) queryOpts.windowId = window.__targetWindowId;
                                const pinnedTabs = await chrome.tabs.query(queryOpts);
                                const pinnedCount = pinnedTabs.length;
                                await chrome.tabGroups.move(groupId, { index: pinnedCount });

                                // Reorder tabs within the group (relative to the group's starting position)
                                for (let i = 0; i < tabIdsInOrder.length; i++) {
                                    await chrome.tabs.move(tabIdsInOrder[i], { index: pinnedCount + i });
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
            } finally {
                // Restore Go button state
                addrGoBtn.innerHTML = originalBtnContent;
                addrGoBtn.disabled = false;
                // Collapse the autocomplete/verified-addresses dropdown. After Go
                // runs there's nothing left to pick from it, so leaving it open
                // just shows an empty white panel until the user clicks away.
                if (verifiedAddressesList) verifiedAddressesList.classList.add('hidden');
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

            // Invalidate any in-flight suggestion fetch immediately — once the input changes
            // it must not touch the dropdown (covers the debounce window and cleared input,
            // where a stale insertBefore against the wiped list would throw)
            _suggestFetchGen++;

            // The user is typing again → re-enable the suggestion dropdown.
            _suppressAddressSuggestions = false;
            // Manual edit invalidates any previously-picked suggestion's coordinates.
            window.__selectedAddrCoords = null;

            // Clear Roofr job selection if user manually edits the input
            if (window.__selectedRoofrJobLink && value !== window.__selectedRoofrJobInputValue) {
                window.__selectedRoofrJobLink = null;
                window.__selectedRoofrJob = null;
                window.__selectedRoofrJobInputValue = null;
            }

            // Always save input value to state so it persists through rescans
            state.addressInput = e.target.value; // Save raw value (not trimmed) to preserve spaces while typing
            debouncedSaveState();

            updateAddressClearButton();
            updateGoButtonState();

            // Fetch address suggestions (sheet data + API) as user types
            if (value.length >= 2) {
                debouncedFetchAddressSuggestions(value);
            }

            // If input is cleared, reset button to "Go"
            if (!value) {
                _placesSession = null; // box cleared → next address entry starts a fresh Google session
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
            // Keyboard navigation for suggestion dropdown
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                if (verifiedAddressesList && !verifiedAddressesList.classList.contains('hidden') && _suggestionItems.length > 0) {
                    e.preventDefault();
                    if (e.key === "ArrowDown") {
                        _activeSuggestionIndex = Math.min(_activeSuggestionIndex + 1, _suggestionItems.length - 1);
                    } else {
                        _activeSuggestionIndex = Math.max(_activeSuggestionIndex - 1, -1);
                    }
                    _suggestionItems.forEach((el, i) => el.classList.toggle('keyboard-active', i === _activeSuggestionIndex));
                    if (_activeSuggestionIndex >= 0) {
                        _suggestionItems[_activeSuggestionIndex].scrollIntoView({ block: 'nearest' });
                    }
                }
                return;
            }
            if (e.key === "Escape") {
                if (verifiedAddressesList && !verifiedAddressesList.classList.contains('hidden')) {
                    verifiedAddressesList.classList.add('hidden');
                    _activeSuggestionIndex = -1;
                }
                return;
            }
            // Enter with highlighted suggestion → select it
            if (e.key === "Enter" && _activeSuggestionIndex >= 0 && _suggestionItems[_activeSuggestionIndex]) {
                e.preventDefault();
                _suggestionItems[_activeSuggestionIndex].click();
                _activeSuggestionIndex = -1;
                return;
            }

            if (e.key === "Enter") {
                const inputValue = addrInput?.value?.trim();
                if (!inputValue) return;

                // Collapse + suppress the autocomplete dropdown — Enter fires the
                // search, so block any in-flight fetch from flashing it back open.
                _suppressAddressSuggestions = true;
                _placesSession = null; // search fired → next address entry starts a fresh Google session
                if (verifiedAddressesList) verifiedAddressesList.classList.add('hidden');
                _activeSuggestionIndex = -1;

                // Check if input is a phone number
                const phoneDigits = detectPhoneNumber(inputValue);
                if (phoneDigits) {
                    const formattedPhone = formatPhoneForDisplay(phoneDigits);
                    const qPhone = _normalizePhone(phoneDigits);

                    // Check local catalog — opens job card directly (same as dropdown click)
                    if (_roofrDataCache && qPhone.length >= 7) {
                        const match = _roofrDataCache.find(job => {
                            if (!job._nPhone || !job.Link) return false;
                            return job._nPhone === qPhone ||
                                   job._nPhone.endsWith(qPhone) ||
                                   qPhone.endsWith(job._nPhone) ||
                                   job._nPhone.includes(qPhone) ||
                                   qPhone.includes(job._nPhone);
                        });
                        if (match) {
                            console.log('[Popup] Phone catalog match:', match.Customer, match.Link);
                            showToast(`Opening ${match.Customer || formattedPhone}...`);
                            await openJobCard(match);
                            return;
                        }
                    }

                    // Fallback: contacts page search
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
                    return;
                }

                // Check if input is a person's name
                const personName = detectName(inputValue);
                if (personName) {
                    showToast(`Searching Roofr for "${personName}"...`);
                    try {
                        await chrome.runtime.sendMessage({
                            type: 'OPEN_CONTACTS_FOR_PHONE',
                            phoneNumber: personName,
                            formattedPhone: personName,
                            callerName: ''
                        });
                    } catch (err) {
                        console.error('[Popup] Error opening contacts for name:', err);
                        showToast('Error opening contacts');
                    }
                    return;
                }

                // It's an address - run recommendation
                await runMainRecommendation();
                updateGoButtonState();
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
        // Always show availability UI for reps container, even if no data (shows all as unavailable)
        const hasAvailabilityData = isRepsContainer;

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

                // Insert the Highlight-All button just left of the up/down move controls
                const moveControls = header.querySelector('.group-move-controls');
                if (moveControls) header.insertBefore(highlightBtn, moveControls);
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

            // Apply desaturated styling for off reps (false or undefined/no data)
            if (isRepsContainer && repAvailabilityStatus[name] !== true) {
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

    // Initialize selected date to tomorrow (in Arizona time, not the machine's local date)
    function initializeSelectedDate() {
        const tomorrow = new Date(addDaysISO(phoenixTodayISO(), 1) + "T00:00:00");
        selectedDate = tomorrow;
        return tomorrow;
    }

    async function fetchTomorrowRepAvailability(targetDate = null) {
        try {
            const apiKey = CONFIG.apiKey;
            const sheetId = settings.NEXT_SHEET_ID;
            if (!apiKey || !sheetId) return {};

            // Use provided date or fall back to tomorrow (Arizona time, not the machine's date)
            const checkDate = targetDate || new Date(addDaysISO(phoenixTodayISO(), 1) + "T00:00:00");

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
            const url = `https://az-roofers-tech-scheduler.vercel.app/api/sheets?spreadsheetId=${encodeURIComponent(sheetId)}&range=${encodeURIComponent(qTab)}&valueRenderOption=UNFORMATTED_VALUE`;

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

    // Fetch reps available for a specific date and time slot (B1, B2, B3, B4)
    async function fetchRepsForSlot(targetDate, blockKey) {
        try {
            const apiKey = CONFIG.apiKey;
            const sheetId = settings.NEXT_SHEET_ID;
            if (!apiKey || !sheetId) return [];

            // Map block key to slot offset (1-4)
            const slotOffsets = { 'B1': 1, 'B2': 2, 'B3': 3, 'B4': 4 };
            const slotOffset = slotOffsets[blockKey];
            if (!slotOffset) return [];

            // Find the tab for the target date's week
            const tabName = await discoverWeeklyTabNameForDate(targetDate);
            if (!tabName) return [];

            // Determine which day column to check (0=Monday, 6=Sunday)
            const dayOfWeek = targetDate.getDay();
            const monFirstIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            const checkColumn = monFirstIndex + 1; // B=1 (Monday), C=2 (Tuesday), etc.

            // Fetch the entire sheet
            const qTab = `'${tabName.replace(/'/g, "''")}'`;
            const url = `https://az-roofers-tech-scheduler.vercel.app/api/sheets?spreadsheetId=${encodeURIComponent(sheetId)}&range=${encodeURIComponent(qTab)}&valueRenderOption=UNFORMATTED_VALUE`;

            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) return [];
            const data = await res.json();
            const values = data.values || [];

            const availableReps = [];

            for (let i = 0; i < values.length; i++) {
                const row = values[i] || [];
                const cellA = String(row[0] || '').trim();

                // Match rep name in column A (no colon = header row)
                const matchedRep = PEOPLE_DATA.REPS.find(rep => {
                    return cellA.includes(rep) && !cellA.includes(':');
                });

                if (matchedRep && (i + slotOffset) < values.length) {
                    const timeSlotRow = values[i + slotOffset] || [];
                    const cellValue = timeSlotRow[checkColumn];

                    // Check if this specific slot is available
                    if (cellValue === true) {
                        availableReps.push(matchedRep);
                    }
                }
            }

            return availableReps;
        } catch (e) {
            addLog(`Error fetching reps for slot: ${e.message}`, 'ERROR');
            return [];
        }
    }

    // ============ ROUTING API INTEGRATION ============

    // Save scanned calendar data to the Routing API for sharing with coworkers
    async function saveCalendarCacheToAPI(weekStartISO, region, events, availability, weekDays) {
        try {
            const apiUrl = settings.ROUTING_API_URL;
            const apiKey = settings.ROUTING_API_KEY;
            if (!apiUrl) {
                addLog('Routing API URL not configured, skipping cache save');
                return false;
            }

            const response = await fetch(`${apiUrl}/sync/calendar-cache`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(apiKey ? { 'X-API-Key': apiKey } : {})
                },
                body: JSON.stringify({
                    weekStartISO,
                    region,
                    events,
                    availability,
                    weekDays,
                    scannedBy: settings.scanner_name || 'Unknown'
                })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
            }

            const result = await response.json();
            addLog(`Calendar cache saved to API for ${weekStartISO} (${region})`);
            return result.success;
        } catch (e) {
            addLog(`Error saving calendar cache to API: ${e.message}`, 'ERROR');
            return false;
        }
    }

    // Fetch cached calendar data from the Routing API
    async function fetchCalendarCacheFromAPI(weekStartISO = null, region = null) {
        try {
            const apiUrl = settings.ROUTING_API_URL;
            const apiKey = settings.ROUTING_API_KEY;
            if (!apiUrl) {
                return { caches: [] };
            }

            const params = new URLSearchParams();
            if (weekStartISO) params.append('weekStartISO', weekStartISO);
            if (region) params.append('region', region);

            const response = await fetch(`${apiUrl}/sync/calendar-cache?${params.toString()}`, {
                method: 'GET',
                headers: {
                    ...(apiKey ? { 'X-API-Key': apiKey } : {})
                }
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
            }

            return await response.json();
        } catch (e) {
            addLog(`Error fetching calendar cache from API: ${e.message}`, 'ERROR');
            return { caches: [] };
        }
    }

    // Get list of cached weeks from the API (for checking availability without scanning)
    async function fetchCachedWeeksFromAPI(region = null) {
        try {
            const apiUrl = settings.ROUTING_API_URL;
            const apiKey = settings.ROUTING_API_KEY;
            if (!apiUrl) {
                return { weeks: [] };
            }

            const params = new URLSearchParams();
            if (region) params.append('region', region);

            const response = await fetch(`${apiUrl}/sync/calendar-cache/weeks?${params.toString()}`, {
                method: 'GET',
                headers: {
                    ...(apiKey ? { 'X-API-Key': apiKey } : {})
                }
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
            }

            return await response.json();
        } catch (e) {
            addLog(`Error fetching cached weeks from API: ${e.message}`, 'ERROR');
            return { weeks: [] };
        }
    }

    // Get smart recommendations from the Routing API (considers rep skills, proximity, workload)
    async function getSmartRecommendations(address, requiredSkills = [], preferredDays = [], urgency = 'normal') {
        try {
            const apiUrl = settings.ROUTING_API_URL;
            const apiKey = settings.ROUTING_API_KEY;
            if (!apiUrl) {
                addLog('Routing API URL not configured, using local stacking algorithm');
                return null;
            }

            const response = await fetch(`${apiUrl}/appointments/recommend`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(apiKey ? { 'X-API-Key': apiKey } : {})
                },
                body: JSON.stringify({
                    address,
                    requiredSkills,
                    preferredDays,
                    urgency
                })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.statusText}`);
            }

            const result = await response.json();
            addLog(`Got ${result.recommendations?.length || 0} smart recommendations from API`);
            return result.recommendations;
        } catch (e) {
            addLog(`Error getting smart recommendations: ${e.message}`, 'ERROR');
            return null;
        }
    }

    // Check for cached next week data when current week is full
    async function checkNextWeekAvailability(currentWeekStart, region) {
        try {
            // Calculate next week's start date
            const currentStart = new Date(currentWeekStart + 'T00:00');
            const nextWeekStart = new Date(currentStart);
            nextWeekStart.setDate(nextWeekStart.getDate() + 7);
            const nextWeekISO = toISO(nextWeekStart);

            // Check if we have cached data for next week
            const cached = await fetchCalendarCacheFromAPI(nextWeekISO, region);
            if (cached.caches && cached.caches.length > 0) {
                const cache = cached.caches[0];
                addLog(`Found cached next week data (${nextWeekISO}) from ${cache.scannedBy}`);
                return {
                    hasCache: true,
                    weekStartISO: nextWeekISO,
                    events: cache.events,
                    availability: cache.availability,
                    weekDays: cache.weekDays,
                    scannedBy: cache.scannedBy,
                    scannedAt: cache.scannedAt
                };
            }

            return { hasCache: false, weekStartISO: nextWeekISO };
        } catch (e) {
            addLog(`Error checking next week availability: ${e.message}`, 'ERROR');
            return { hasCache: false };
        }
    }

    // Company Team Roster sheet — live source for the People tab's Production /
    // Insurance / Door-to-Door groups. The "Team Roster" tab holds ONLY active staff
    // (fired/archived people live on a separate "Archived Staff" tab), so a simple
    // Department bucket is safe. Reps / CSRs / Management are NOT sourced here.
    const ROSTER_SHEET_ID = "1XFJHD0IVZ8sJrQ7H2CrqU26a6n-FulPM8ABKc1hrh9o";
    const ROSTER_DEPT_MAP = { "Production": "PRODUCTION", "Insurance": "INSURANCE", "D2D Sales": "D2D" };

    // Pull Production / Insurance / D2D from the roster sheet (col B = Department, col C = Name).
    // Mutates PEOPLE_DATA in place. On any failure the existing config fallbacks are kept.
    // Note: names are intentionally NOT deduped across groups — someone can legitimately
    // belong to two teams (e.g. Khamilah Valles is both Insurance and a CSR).
    async function fetchRosterGroups() {
        try {
            const range = "'Team Roster'!A2:C200";
            const url = `https://az-roofers-tech-scheduler.vercel.app/api/sheets?spreadsheetId=${encodeURIComponent(ROSTER_SHEET_ID)}&range=${encodeURIComponent(range)}`;
            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) throw new Error(`roster sheet HTTP ${res.status}`);
            const data = await res.json();
            const rows = Array.isArray(data.values) ? data.values : [];

            const buckets = { PRODUCTION: [], INSURANCE: [], D2D: [] };
            for (const row of rows) {
                const dept = (row[1] || "").trim();
                const name = (row[2] || "").trim();
                if (!name || !dept) continue;
                const key = ROSTER_DEPT_MAP[dept];
                if (key) buckets[key].push(name);
            }

            // Only overwrite a group if the sheet actually returned people for it,
            // so a partial/empty read never blanks the tab.
            for (const key of Object.keys(buckets)) {
                if (buckets[key].length) {
                    PEOPLE_DATA[key] = [...new Set(buckets[key])].sort();
                }
            }
            addLog(`Roster sync: ${buckets.PRODUCTION.length} production, ${buckets.INSURANCE.length} insurance, ${buckets.D2D.length} D2D`);
        } catch (e) {
            console.warn('[People] Roster sheet sync failed, using config fallback:', e);
            addLog(`Roster sync failed (${e.message}) — using built-in lists`);
        }
    }

    async function loadPeopleLists() {
        if (chrome.storage && chrome.storage.sync) {
            const keys = ["PEOPLE_REPS", "PEOPLE_MGMT", "PEOPLE_CSRS"];
            const settings = await chrome.storage.sync.get(keys);

            // Check if stored data contains old removed reps or is missing new people and clear if so
            const removedReps = ["Ashkan Etemadi", "Brandon Cook", "Brian Griggs", "Oliver Johnson", "Phil Merrell", "Ted Pear", "Kyle Ludewig", "William Ludewig", "William Yost"];
            const newReps = ["Josh Jewett", "Stephen Chaidez", "Alex Tillotson"];
            const removedCSRs = ["Layla Fairfield", "Alex Tillotson"]; // Alex moved to Sales Reps
            const newMgmt = ["Andrew Clark", "Conor Smith", "Jayda Fairfield", "Raven Pelfrey", "Travis Jones"]; // New management members to check for
            let needsClear = false;

            if (settings.PEOPLE_REPS) {
                const storedReps = settings.PEOPLE_REPS.split(',').map(s => s.trim());
                if (removedReps.some(removed => storedReps.includes(removed))) {
                    needsClear = true;
                }
                if (newReps.some(newPerson => !storedReps.includes(newPerson))) {
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

        // Initialize selected date to tomorrow (ensures date nav shows even if fetch fails)
        initializeSelectedDate();

        // Fetch tomorrow's availability
        repAvailabilityStatus = await fetchTomorrowRepAvailability();

        // Live-sync Production / Insurance / D2D from the Company Team Roster sheet.
        await fetchRosterGroups();

        renderPeopleList(repsList, PEOPLE_DATA.REPS);
        renderPeopleList(mgmtList, PEOPLE_DATA.MGMT);
        renderPeopleList(csrsList, PEOPLE_DATA.CSRS);
        renderPeopleList(productionList, PEOPLE_DATA.PRODUCTION);
        renderPeopleList(insuranceList, PEOPLE_DATA.INSURANCE);
        renderPeopleList(d2dList, PEOPLE_DATA.D2D);
    }

    /* ===== People-tab group reordering — up/down arrows, persisted to sync ===== */
    const PEOPLE_GROUP_ORDER_KEY = 'PEOPLE_GROUP_ORDER';
    const peopleContainerEl = () => document.querySelector('#sec-people .people-container');

    // Grey out ▲ on the first panel and ▼ on the last.
    function updateGroupMoveButtons() {
        const container = peopleContainerEl();
        if (!container) return;
        const panels = [...container.querySelectorAll('.people-group')];
        panels.forEach((p, i) => {
            const up = p.querySelector('.group-move-btn[data-move="up"]');
            const down = p.querySelector('.group-move-btn[data-move="down"]');
            if (up) up.disabled = (i === 0);
            if (down) down.disabled = (i === panels.length - 1);
        });
    }

    // Persist the current DOM order of the group panels (array of data-group keys).
    async function savePeopleGroupOrder() {
        const container = peopleContainerEl();
        if (!container) return;
        const order = [...container.querySelectorAll('.people-group')].map(p => p.dataset.group).filter(Boolean);
        try {
            if (chrome.storage && chrome.storage.sync) await chrome.storage.sync.set({ [PEOPLE_GROUP_ORDER_KEY]: order });
        } catch (e) { console.warn('[People] save group order failed', e); }
    }

    // Apply a saved order to the DOM. Unknown/new groups (added in a later version)
    // simply stay where they are, after the saved ones.
    async function applyPeopleGroupOrder() {
        const container = peopleContainerEl();
        if (!container) return;
        let order = [];
        try {
            if (chrome.storage && chrome.storage.sync) {
                const r = await chrome.storage.sync.get(PEOPLE_GROUP_ORDER_KEY);
                if (Array.isArray(r[PEOPLE_GROUP_ORDER_KEY])) order = r[PEOPLE_GROUP_ORDER_KEY];
            }
        } catch (_) {}
        for (const key of order) {
            const panel = container.querySelector(`.people-group[data-group="${key}"]`);
            if (panel) container.appendChild(panel); // re-append in saved sequence
        }
        updateGroupMoveButtons();
    }

    // Wire the arrow buttons once (event delegation on the container).
    function setupPeopleGroupReorder() {
        const container = peopleContainerEl();
        if (!container || container.dataset.reorderWired) return;
        container.dataset.reorderWired = '1';
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.group-move-btn');
            if (!btn) return;
            const panel = btn.closest('.people-group');
            if (!panel) return;
            if (btn.dataset.move === 'up') {
                const prev = panel.previousElementSibling;
                if (prev) container.insertBefore(panel, prev);
            } else {
                const next = panel.nextElementSibling;
                if (next) container.insertBefore(next, panel);
            }
            updateGroupMoveButtons();
            savePeopleGroupOrder();
        });
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
            // Record what we're about to write so onChanged skips our own echo.
            _lastWrittenClipboardsSig = JSON.stringify(clipboards);
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

    // Sticky-note pastel palette. key === null is the default (no color).
    const NOTE_PASTELS = [
        { key: null,     bg: null,      label: 'Default' },
        { key: 'yellow', bg: '#FEF9C3', label: 'Yellow' },
        { key: 'pink',   bg: '#FCE7F3', label: 'Pink' },
        { key: 'green',  bg: '#DCFCE7', label: 'Green' },
        { key: 'blue',   bg: '#DBEAFE', label: 'Blue' },
        { key: 'purple', bg: '#EDE9FE', label: 'Purple' },
        { key: 'orange', bg: '#FFEDD5', label: 'Orange' },
    ];

    function renderClipboards() {
        if (!clipboardContainer) return;
        clipboardContainer.innerHTML = '';
        const fragment = document.createDocumentFragment();

        clipboards.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'note-card';
            // Apply saved sticky-note color (null/undefined = default surface).
            const pastel = NOTE_PASTELS.find(c => c.key === (item.color || null));
            if (pastel && pastel.key) {
                card.classList.add('note-colored');
                card.style.setProperty('--note-bg', pastel.bg);
            }

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

            // Sticky-note color swatches at the top of the menu.
            const colorRow = document.createElement('div');
            colorRow.className = 'note-color-row';
            NOTE_PASTELS.forEach(c => {
                const sw = document.createElement('button');
                sw.className = 'note-color-swatch';
                sw.title = c.label;
                sw.style.background = c.bg || 'var(--surface)';
                if (!c.key) sw.textContent = '✕'; // default / clear color
                if ((item.color || null) === c.key) sw.classList.add('active');
                sw.addEventListener('click', (e) => {
                    e.stopPropagation();
                    clipboards[index].color = c.key;
                    debouncedSaveClipboards();
                    renderClipboards();
                });
                colorRow.appendChild(sw);
            });
            menu.appendChild(colorRow);

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
            locked: isLocked,
            color: null
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
        // One-time migration: hide the Reports tab by default (team rollout 2026-06-03).
        // Bumped from v4 (which seeded Reports ON) so it re-runs once for everyone and
        // flips Reports OFF. Only touches show_reports — other tabs keep the user's choice.
        // v6: re-run once more — the service worker's onInstalled was re-seeding
        // show_reports:true on every reload (`if (!current[key])` treats false as missing),
        // so v5 alone wasn't enough for users who'd been re-enabled. SW seed is now false too.
        chrome.storage.local.get('tabs_visibility_migrated_v6', (result) => {
            if (!result.tabs_visibility_migrated_v6) {
                chrome.storage.sync.set({ show_reports: false }, () => {
                    chrome.storage.local.set({ tabs_visibility_migrated_v6: true });
                    userPrefs.showReportsTab = false;
                    const reportsTabBtn = document.querySelector('.nav-tab[data-target="sec-reports"]');
                    if (reportsTabBtn) reportsTabBtn.style.display = 'none';
                    console.log('[Popup] Migrated tab visibility v6: Reports tab hidden by default');
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

        // Color Indicators
        if (userPrefs.showColorIndicators === false) document.body.classList.add('hide-color-indicators');
        else document.body.classList.remove('hide-color-indicators');

        // Icons
        if (userPrefs.showIcons === false) document.body.classList.add('hide-icons');
        else document.body.classList.remove('hide-icons');

        // Animations
        if (userPrefs.animateTransitions === false) document.body.classList.add('no-animations');
        else document.body.classList.remove('no-animations');

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
        if (scanProfileSelect) scanProfileSelect.value = userPrefs.scanProfile || 'retail';
        if (scanViewSelect) scanViewSelect.value = userPrefs.scanView || 'weekly';
        if (settingScanProfile) settingScanProfile.value = userPrefs.scanProfile || 'retail';
        if (settingScanView) settingScanView.value = userPrefs.scanView || 'weekly';
        if (settingShowDialer) settingShowDialer.checked = userPrefs.showDialerTab;
        if (settingShowPeople) settingShowPeople.checked = userPrefs.showPeopleTab;
        if (settingShowClipboard) settingShowClipboard.checked = userPrefs.showClipboardTab;
        if (settingShowReports) settingShowReports.checked = userPrefs.showReportsTab;

        // Sync with options page settings if available
        chrome.storage.sync.get([
            // Tab visibility
            'show_dialer', 'show_people', 'show_clipboard', 'show_reports',
            // Scan
            'scan_profile', 'scan_view',
            // Appearance
            'theme', 'compact_mode', 'show_color_indicators', 'show_icons', 'animate_transitions',
            // Interface
            'global_panel_mode', 'auto_expand_days',
            // Scanner
            'auto_scan_on_load', 'show_uncategorized_alerts',
            // Footer tools
            'footer_show_find', 'footer_show_notes', 'footer_show_formatting',
            'footer_show_popup_btn', 'footer_show_links'
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
            // Color Indicators
            if (result.show_color_indicators !== undefined) {
                userPrefs.showColorIndicators = result.show_color_indicators;
                if (result.show_color_indicators === false) document.body.classList.add('hide-color-indicators');
                else document.body.classList.remove('hide-color-indicators');
            }
            // Icons
            if (result.show_icons !== undefined) {
                userPrefs.showIcons = result.show_icons;
                if (result.show_icons === false) document.body.classList.add('hide-icons');
                else document.body.classList.remove('hide-icons');
            }
            // Animations
            if (result.animate_transitions !== undefined) {
                userPrefs.animateTransitions = result.animate_transitions;
                if (result.animate_transitions === false) document.body.classList.add('no-animations');
                else document.body.classList.remove('no-animations');
            }
            // Auto expand days
            if (result.auto_expand_days !== undefined) {
                userPrefs.autoExpandDays = result.auto_expand_days;
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
            if (result.show_dialer !== undefined) userPrefs.showDialerTab = result.show_dialer;
            if (result.scan_profile) { userPrefs.scanProfile = result.scan_profile; if (scanProfileSelect) scanProfileSelect.value = result.scan_profile; if (settingScanProfile) settingScanProfile.value = result.scan_profile; }
            if (result.scan_view) { userPrefs.scanView = result.scan_view; if (scanViewSelect) scanViewSelect.value = result.scan_view; if (settingScanView) settingScanView.value = result.scan_view; }
            if (result.show_people !== undefined) userPrefs.showPeopleTab = result.show_people;
            if (result.show_clipboard !== undefined) userPrefs.showClipboardTab = result.show_clipboard;
            if (result.show_reports !== undefined) userPrefs.showReportsTab = result.show_reports;

            // Footer tools - sync from options page
            if (result.footer_show_find !== undefined) userPrefs.showFindBar = result.footer_show_find;
            if (result.footer_show_notes !== undefined) userPrefs.showQuickNotes = result.footer_show_notes;
            if (result.footer_show_formatting !== undefined) userPrefs.footerShowFormatting = result.footer_show_formatting;
            if (result.footer_show_popup_btn !== undefined) userPrefs.footerShowPopupBtn = result.footer_show_popup_btn;
            if (result.footer_show_links !== undefined) userPrefs.footerShowLinks = result.footer_show_links;

            // Update checkboxes
            if (settingShowDialer) settingShowDialer.checked = userPrefs.showDialerTab;
            if (settingShowPeople) settingShowPeople.checked = userPrefs.showPeopleTab;
            if (settingShowClipboard) settingShowClipboard.checked = userPrefs.showClipboardTab;
            if (settingShowReports) settingShowReports.checked = userPrefs.showReportsTab;

            // Update tab visibility - tabs are visible by default, only hide if explicitly false
            const dialerTabBtn = document.querySelector('.nav-tab[data-target="sec-dialer"]');
            if (dialerTabBtn) dialerTabBtn.style.display = userPrefs.showDialerTab === false ? 'none' : '';

            const peopleTabBtn = document.querySelector('.nav-tab[data-target="sec-people"]');
            if (peopleTabBtn) peopleTabBtn.style.display = userPrefs.showPeopleTab === false ? 'none' : '';

            const clipTabBtn = document.querySelector('.nav-tab[data-target="sec-clipboard"]');
            if (clipTabBtn) clipTabBtn.style.display = userPrefs.showClipboardTab === false ? 'none' : '';

            const reportsTabBtn = document.querySelector('.nav-tab[data-target="sec-reports"]');
            if (reportsTabBtn) reportsTabBtn.style.display = userPrefs.showReportsTab === false ? 'none' : '';

            // Dock Toggles (inside callback for reactive updates)
            const dockFind = document.getElementById('dock-find-container');
            if (dockFind) dockFind.style.display = userPrefs.showFindBar ? '' : 'none';
            if (settingShowFind) settingShowFind.checked = userPrefs.showFindBar;

            const dockNotes = document.getElementById('dock-notes-container');
            if (dockNotes) dockNotes.style.display = userPrefs.showQuickNotes ? '' : 'none';
            if (settingShowNotes) settingShowNotes.checked = userPrefs.showQuickNotes;

            // Footer tools visibility
            const dockNotesToolbar = document.querySelector('.dock-notes-toolbar');
            if (dockNotesToolbar) {
                // Formatting tools (T, A-, A+)
                const formatToggle = document.getElementById('dock-note-toggle-format');
                const sizeDown = document.getElementById('dock-note-size-down');
                const sizeDisplay = document.getElementById('dock-note-size-display');
                const sizeUp = document.getElementById('dock-note-size-up');
                if (formatToggle) formatToggle.style.display = userPrefs.footerShowFormatting ? '' : 'none';
                if (sizeDown) sizeDown.style.display = userPrefs.footerShowFormatting ? '' : 'none';
                if (sizeDisplay) sizeDisplay.style.display = userPrefs.footerShowFormatting ? '' : 'none';
                if (sizeUp) sizeUp.style.display = userPrefs.footerShowFormatting ? '' : 'none';

                // Popup button
                const popoutBtn = document.getElementById('popout-btn');
                if (popoutBtn) popoutBtn.style.display = userPrefs.footerShowPopupBtn ? '' : 'none';

                // Links dropdown
                const linksDropdown = document.querySelector('.links-dropdown');
                if (linksDropdown) linksDropdown.style.display = userPrefs.footerShowLinks ? '' : 'none';

                // Sync settings checkboxes for footer tools
                if (settingShowFormatting) settingShowFormatting.checked = userPrefs.footerShowFormatting;
                if (settingShowPopupBtn) settingShowPopupBtn.checked = userPrefs.footerShowPopupBtn;
                if (settingShowLinks) settingShowLinks.checked = userPrefs.footerShowLinks;
            }

            const dock = document.getElementById('bottom-dock');
            const app = document.getElementById('app-container');
            if (!userPrefs.showFindBar && !userPrefs.showQuickNotes) {
                if (dock) dock.classList.add('hidden');
                if (app) app.classList.add('no-dock');
            } else {
                if (dock) dock.classList.remove('hidden');
                if (app) app.classList.remove('no-dock');
            }
        });
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
    // Dark Mode on Roofr — inverts the Roofr page itself (roofr-dark-mode.js content
    // script watches this sync key, so writing storage is all the toggle has to do).
    const settingRoofrDark = document.getElementById('setting-roofr-dark');
    if (settingRoofrDark) {
        chrome.storage.sync.get('roofr_dark_mode', (result) => {
            settingRoofrDark.checked = !!result.roofr_dark_mode;
        });
        settingRoofrDark.addEventListener('change', (e) => {
            chrome.storage.sync.set({ roofr_dark_mode: e.target.checked });
        });
    }
    // Stage Timeline on/off — roofr-timeline.js watches this sync key (default OFF; opt-in).
    const settingStageTimeline = document.getElementById('setting-stage-timeline');
    if (settingStageTimeline) {
        chrome.storage.sync.get('roofr_timeline_enabled', (result) => {
            settingStageTimeline.checked = result.roofr_timeline_enabled === true;
        });
        settingStageTimeline.addEventListener('change', (e) => {
            chrome.storage.sync.set({ roofr_timeline_enabled: e.target.checked });
        });
    }
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
    // Shared setters keep BOTH the right-click popover selects and the Settings-panel
    // selects in sync, and persist to storage.
    function setScanProfile(val) {
        userPrefs.scanProfile = val;
        saveUserPrefs();
        if (chrome.storage && chrome.storage.sync) chrome.storage.sync.set({ scan_profile: val });
        if (scanProfileSelect) scanProfileSelect.value = val;
        if (settingScanProfile) settingScanProfile.value = val;
        addLog(`Scan profile set to: ${val}`);
    }
    function setScanView(val) {
        userPrefs.scanView = val;
        saveUserPrefs();
        if (chrome.storage && chrome.storage.sync) chrome.storage.sync.set({ scan_view: val });
        if (scanViewSelect) scanViewSelect.value = val;
        if (settingScanView) settingScanView.value = val;
        addLog(`Scan view set to: ${val}`);
        // Switch the live Roofr calendar to this view immediately (not just on next scan).
        sendFindCommand({ type: 'SWITCH_CALENDAR_VIEW', view: val });
    }
    if (scanProfileSelect) scanProfileSelect.addEventListener('change', (e) => setScanProfile(e.target.value));
    if (scanViewSelect) scanViewSelect.addEventListener('change', (e) => setScanView(e.target.value));
    if (settingScanProfile) settingScanProfile.addEventListener('change', (e) => setScanProfile(e.target.value));
    if (settingScanView) settingScanView.addEventListener('change', (e) => setScanView(e.target.value));
    if (settingShowDialer) settingShowDialer.addEventListener('change', (e) => {
        userPrefs.showDialerTab = e.target.checked;
        saveUserPrefs(); applyUserPrefs();
        if (chrome.storage && chrome.storage.sync) chrome.storage.sync.set({ show_dialer: e.target.checked });
        // If we just hid the active tab, switch to scanner
        if (!e.target.checked && document.querySelector('.nav-tab[data-target="sec-dialer"].active')) {
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
    if (settingShowFormatting) settingShowFormatting.addEventListener('change', (e) => {
        userPrefs.footerShowFormatting = e.target.checked;
        saveUserPrefs(); applyUserPrefs();
    });
    if (settingShowPopupBtn) settingShowPopupBtn.addEventListener('change', (e) => {
        userPrefs.footerShowPopupBtn = e.target.checked;
        saveUserPrefs(); applyUserPrefs();
    });
    if (settingShowLinks) settingShowLinks.addEventListener('change', (e) => {
        userPrefs.footerShowLinks = e.target.checked;
        saveUserPrefs(); applyUserPrefs();
    });


    /* ========= Load Settings ========= */
    async function loadSettings() {
        if (chrome.storage && chrome.storage.sync) {
            const keys = [
                "NEXT_SHEET_ID", "AVAIL_RANGE_PHX", "AVAIL_RANGE_NORTH", "AVAIL_RANGE_SOUTH",
                "search_google_earth", "search_gemini", "search_roofr",
                "ROUTING_API_URL", "ROUTING_API_KEY", "scanner_name"
            ];
            const defaults = {
                NEXT_SHEET_ID: "1cFFEZNl7wXt40riZHnuZxGc1Zfm5lTlOz0rDCWGZJ0g",
                AVAIL_RANGE_PHX: "I2:Q9",
                AVAIL_RANGE_NORTH: "I18:Q25",
                AVAIL_RANGE_SOUTH: "I10:Q17",
                search_google_earth: true,
                search_gemini: true,
                search_roofr: true,
                ROUTING_API_URL: '', // e.g., "https://your-api.vercel.app/api/v1"
                ROUTING_API_KEY: '',
                scanner_name: '' // Name of person using the scanner (for shared caching)
            };
            const result = await chrome.storage.sync.get(keys);
            settings = { ...defaults, ...settings, ...result };
        }
    }

    async function loadDynamicCities() {
        const northRoutingApplied = await fetchNorthRoutingFromSheet();
        addLog(northRoutingApplied
            ? 'Applied up-north routing cities from Google Sheet.'
            : 'Using default up-north routing cities.');

        // First, try to load cities from Google Sheet (primary source)
        const sheetCities = await fetchCitiesFromSheet();
        if (sheetCities) {
            for (const region of ['PHX', 'NORTH', 'SOUTH']) {
                if (sheetCities[region] && sheetCities[region].length > 0) {
                    for (const city of sheetCities[region]) {
                        addCityToRegionWhitelist(city, region);
                    }
                }
            }
        }

        // Also load any locally-stored cities (backup/offline additions)
        if (chrome.storage && chrome.storage.sync) {
            const data = await chrome.storage.sync.get(DYNAMIC_CITIES_KEY);
            const loadedCities = data[DYNAMIC_CITIES_KEY] || {};

            // Safely merge loaded cities into our local variable
            userAddedCities = { PHX: [], NORTH: [], SOUTH: [] };

            // Merge locally-stored cities into CONFIG (may overlap with sheet cities, Sets handle duplicates)
            for (const region of ['PHX', 'NORTH', 'SOUTH']) {
                if (loadedCities[region] && loadedCities[region].length > 0) {
                    for (const city of loadedCities[region]) {
                        const normalizedCity = String(city || '').trim().toUpperCase();
                        const effectiveRegion = addCityToRegionWhitelist(normalizedCity, region);
                        if (normalizedCity && !userAddedCities[effectiveRegion].includes(normalizedCity)) {
                            userAddedCities[effectiveRegion].push(normalizedCity);
                        }
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
        await getRepIdentity();
        setupPeopleGroupReorder();
        await applyPeopleGroupOrder();
        await loadClipboards();

        renderUIFromState();
        startSlotHoldsPolling();
        updateScanButtonState();
        resetIdleTimer();

        const serverAvailabilityLoaded = await loadTwoWeekAvailability();
        setInterval(loadTwoWeekAvailability, 5 * 60 * 1000);

        if (userPrefs.autoScan && !serverAvailabilityLoaded) {
            runScanFlow(true); // Pass true to suppress alert on failure
        }

        // Check if there's a pending auto-scan from page load
        checkPendingAutoScan(serverAvailabilityLoaded);

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
    async function checkPendingAutoScan(skipScan = false) {
        try {
            const data = await chrome.storage.session.get(['autoScanPending', 'autoScanTimestamp']);
            if (data.autoScanPending) {
                if (skipScan) {
                    addLog("Clearing pending auto-scan because server availability is loaded.");
                    await chrome.storage.session.remove(['autoScanPending', 'autoScanTimestamp']);
                    return;
                }
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

    // Rep Assignment v2 (API). This stays additive to the legacy Reports flow below.
    const reportsV2Date = document.getElementById('reports-v2-date');
    const reportsV2LoadBtn = document.getElementById('reports-v2-load');
    const reportsV2ScanBtn = document.getElementById('reports-v2-scan-directory');
    const reportsV2DirectoryStatus = document.getElementById('reports-v2-directory-status');
    const reportsV2Schedule = document.getElementById('reports-v2-schedule');
    const reportsV2ApplyScheduleBtn = document.getElementById('reports-v2-apply-schedule');
    const reportsV2ApplyResults = document.getElementById('reports-v2-apply-results');
    const reportsV2Status = document.getElementById('reports-v2-status');
    const reportsV2Queue = document.getElementById('reports-v2-queue');
    const reportsV2DryRun = document.getElementById('reports-v2-dry-run');
    const reportsV2WriteCap = document.getElementById('reports-v2-write-cap');
    const reportsV2PreflightBtn = document.getElementById('reports-v2-preflight');
    const reportsV2ExecuteBtn = document.getElementById('reports-v2-execute');
    const reportsV2ResumeBtn = document.getElementById('reports-v2-resume');
    const reportsV2RetryFailedBtn = document.getElementById('reports-v2-retry-failed');
    const reportsV2ExportBtn = document.getElementById('reports-v2-export');
    const reportsV2PreflightSummary = document.getElementById('reports-v2-preflight-summary');
    const reportsV2Progress = document.getElementById('reports-v2-progress');
    const reportsV2Tally = document.getElementById('reports-v2-tally');
    const REPORTS_V2_DIRECTORY_KEY = 'roofr_user_directory_v1';
    const REPORTS_V2_SEED_DIRECTORY = {
        '443464': { name: 'Travis Jones' },
        '525242': { name: 'Stephen Chaidez' },
        '500123': { name: 'Connor Hamby' }
    };
    let reportsV2Directory = {};
    let reportsV2Events = [];
    let reportsV2Selections = {};
    let reportsV2PreflightUnits = null;
    let reportsV2Running = false;

    function reportsV2Escape(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function reportsV2PhoenixDate(date = new Date()) {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Phoenix',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(date);
        const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${values.year}-${values.month}-${values.day}`;
    }

    function reportsV2SetStatus(message, type = 'info') {
        if (!reportsV2Status) return;
        reportsV2Status.style.display = message ? 'block' : 'none';
        reportsV2Status.textContent = message || '';
        const colors = type === 'error'
            ? ['var(--danger-bg)', 'var(--danger)']
            : type === 'success'
                ? ['var(--success-bg)', 'var(--success)']
                : type === 'warning'
                    ? ['var(--warn-bg)', 'var(--warn)']
                    : ['var(--primary-light)', 'var(--primary)'];
        reportsV2Status.style.background = colors[0];
        reportsV2Status.style.color = colors[1];
        reportsV2Status.style.border = `1px solid ${colors[1]}`;
    }

    function reportsV2InvalidatePreflight() {
        reportsV2PreflightUnits = null;
        if (reportsV2ExecuteBtn) reportsV2ExecuteBtn.disabled = true;
        if (reportsV2PreflightSummary) reportsV2PreflightSummary.style.display = 'none';
    }

    async function reportsV2SaveDirectory() {
        await chrome.storage.local.set({ [REPORTS_V2_DIRECTORY_KEY]: reportsV2Directory });
        if (reportsV2DirectoryStatus) {
            reportsV2DirectoryStatus.textContent = `${Object.keys(reportsV2Directory).length} users`;
        }
    }

    async function reportsV2LoadDirectory() {
        const stored = await chrome.storage.local.get(REPORTS_V2_DIRECTORY_KEY);
        reportsV2Directory = { ...REPORTS_V2_SEED_DIRECTORY, ...(stored[REPORTS_V2_DIRECTORY_KEY] || {}) };
        await reportsV2SaveDirectory();
    }

    async function reportsV2Harvest(detail) {
        let changed = false;
        for (const attendee of Array.isArray(detail?.attendees) ? detail.attendees : []) {
            const resource = attendee?.resource || attendee;
            const id = resource?.id ?? attendee?.id;
            const name = resource?.full_name || resource?.name;
            if (!id || !name) continue;
            if (reportsV2Directory[String(id)]?.name !== name) {
                reportsV2Directory[String(id)] = { name };
                changed = true;
            }
        }
        if (changed) await reportsV2SaveDirectory();
        return changed;
    }

    async function reportsV2GetRoofrTab() {
        if (window.__targetRoofrTabId) {
            try {
                const tab = await chrome.tabs.get(window.__targetRoofrTabId);
                if (tab?.url?.includes('app.roofr.com')) return tab;
            } catch (_) {
                window.__targetRoofrTabId = null;
            }
        }
        const query = { url: '*://app.roofr.com/*' };
        if (window.__targetWindowId) query.windowId = window.__targetWindowId;
        const tabs = await chrome.tabs.query(query);
        if (!tabs.length) throw new Error('Open a Roofr tab first');
        window.__targetRoofrTabId = tabs[0].id;
        return tabs[0];
    }

    async function reportsV2Send(message) {
        const tab = await reportsV2GetRoofrTab();
        const injectAndRetry = async () => {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['roofr-api.js', 'reports-batch.js', 'content.js']
            });
            await new Promise(resolve => setTimeout(resolve, 500));
            return chrome.tabs.sendMessage(tab.id, message);
        };
        let response;
        try {
            response = await chrome.tabs.sendMessage(tab.id, message);
        } catch (error) {
            if (!String(error?.message || error).match(/Receiving end does not exist|Could not establish connection/)) throw error;
            return injectAndRetry();
        }
        // Tab can be in a mixed state: content.js listening but roofr-api.js never injected
        // (legacy single-file injection or a tab opened before the extension loaded).
        if (response && response.ok === false && /RoofrApi is unavailable/.test(response?.error?.message || '')) {
            return injectAndRetry();
        }
        return response;
    }

    function reportsV2ResponseData(response) {
        if (!response?.ok) {
            const error = new Error(response?.error?.message || response?.error || 'Roofr API request failed');
            if (response?.error?.ambiguous) error.ambiguous = true;
            error.kind = response?.error?.kind;
            error.status = response?.error?.status;
            throw error;
        }
        return Object.prototype.hasOwnProperty.call(response, 'data') ? response.data : response;
    }

    const reportsV2ApiAdapter = {
        async getEvent(eventId) {
            const detail = reportsV2ResponseData(await reportsV2Send({ type: 'ROOFR_API_GET_EVENT', eventId }));
            await reportsV2Harvest(detail);
            return detail;
        },
        async getJob(jobId) {
            return reportsV2ResponseData(await reportsV2Send({ type: 'ROOFR_API_GET_JOB', jobId }));
        },
        async setJobOwner(jobId, userId) {
            const result = await reportsV2Send({ type: 'ROOFR_API_SET_JOB_OWNER', jobId, userId });
            if (result?.ok === false && result.error) {
                reportsV2ResponseData(result);
            }
            return result || { ok: false, error: { message: 'No response from Roofr tab' } };
        },
        async addAttendee(eventId, userId, jobId) {
            const result = await reportsV2Send({ type: 'ROOFR_API_ADD_ATTENDEE', eventId, userId, jobId });
            if (result?.before) await reportsV2Harvest(result.before);
            if (result?.after) await reportsV2Harvest(result.after);
            return result || { ok: false, verified: false, error: { message: 'No response from Roofr tab' } };
        },
        serializeError(error) {
            return {
                kind: error?.kind || 'network',
                message: error?.message || String(error),
                ...(error?.status !== undefined ? { status: error.status } : {}),
                ...(error?.ambiguous ? { ambiguous: true } : {})
            };
        }
    };

    function reportsV2SalesEvent(event) {
        const typeId = event?.calendar_event_type_id ?? event?.calendar_event_type?.id;
        return window.RoofrReportsBatch?.SALES_EVENT_TYPE_IDS.has(String(typeId));
    }

    function reportsV2StructuralEligibility(event) {
        return window.RoofrReportsBatch.eligibility(event, '__selected__');
    }

    function reportsV2AttendeeText(event) {
        const attendees = Array.isArray(event?.attendees) ? event.attendees : [];
        const ids = attendees.length
            ? attendees.map(attendee => attendee?.resource?.id ?? attendee?.id).filter(Boolean)
            : (event?.attendee_user_ids || []);
        if (!ids.length) return 'None';
        return ids.map(id => reportsV2Directory[String(id)]?.name || `id:${id}`).join(', ');
    }

    function reportsV2ParseTimeMinutes(value) {
        const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
        if (!match) return null;
        let hour = Number(match[1]);
        const minute = Number(match[2] || 0);
        if (hour < 1 || hour > 12 || minute > 59) return null;
        hour %= 12;
        if (match[3].toLowerCase() === 'pm') hour += 12;
        return hour * 60 + minute;
    }

    function reportsV2EventStartMinutes(event) {
        const match = String(event?.start_date_time || '').match(/[T\s](\d{1,2}):(\d{2})/);
        if (!match) return null;
        return Number(match[1]) * 60 + Number(match[2]);
    }

    function reportsV2StartOverlapsRange(event, startMinutes, endMinutes) {
        const eventMinutes = reportsV2EventStartMinutes(event);
        if (eventMinutes === null || startMinutes === null || endMinutes === null) return false;
        return endMinutes >= startMinutes
            ? eventMinutes >= startMinutes && eventMinutes <= endMinutes
            : eventMinutes >= startMinutes || eventMinutes <= endMinutes;
    }

    function reportsV2ParseSchedule(text) {
        const appointments = [];
        let currentRep = null;
        for (const rawLine of String(text || '').split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line) continue;
            const heading = line.match(/^(.+?)\s*\(\d+\)\s*$/);
            if (heading) {
                currentRep = heading[1].trim();
                continue;
            }
            const timeRange = line.match(/^(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*:/i);
            if (!timeRange || !currentRep) continue;
            const jid = line.match(/\[JID:(\d+)\]/);
            appointments.push({
                repName: currentRep,
                jid: jid?.[1] || null,
                startMinutes: reportsV2ParseTimeMinutes(timeRange[1]),
                endMinutes: reportsV2ParseTimeMinutes(timeRange[2]),
                line
            });
        }
        return appointments;
    }

    function reportsV2ResolveRepId(name) {
        const target = String(name || '').trim().toLowerCase();
        const matches = Object.entries(reportsV2Directory)
            .filter(([, user]) => String(user?.name || '').trim().toLowerCase() === target);
        return matches.length === 1 ? matches[0][0] : null;
    }

    function reportsV2RenderApplyResults(result) {
        if (!reportsV2ApplyResults) return;
        const details = [];
        if (result.noJid.length) details.push(`No JID:\n${result.noJid.map(item => `- ${item.line}`).join('\n')}`);
        if (result.notInDay.length) details.push(`JID not in loaded day:\n${result.notInDay.map(item => `- JID:${item.jid} (${item.repName})`).join('\n')}`);
        if (result.unresolved.length) details.push(`Rep name unresolved:\n${result.unresolved.map(item => `- ${item.repName} (JID:${item.jid})`).join('\n')}`);
        if (result.ambiguous.length) details.push(`Ambiguous / needs review:\n${result.ambiguous.map(item => `- JID:${item.jid} (${item.repName})`).join('\n')}`);
        reportsV2ApplyResults.style.display = 'block';
        reportsV2ApplyResults.textContent = [
            `${result.bound} bound`,
            `${result.noJid.length} no-JID lines`,
            `${result.notInDay.length} JID-not-in-day`,
            `${result.unresolved.length} rep-name-unresolved`,
            `${result.ambiguous.length} ambiguous`,
            details.join('\n\n')
        ].filter(Boolean).join('\n');
    }

    function reportsV2ApplySchedule() {
        const parsed = reportsV2ParseSchedule(reportsV2Schedule?.value || '');
        const result = { bound: 0, noJid: [], notInDay: [], unresolved: [], ambiguous: [] };
        for (const appointment of parsed) {
            if (!appointment.jid) {
                result.noJid.push(appointment);
                continue;
            }
            const jobEvents = reportsV2Events.filter(event => String(event?.job_id ?? '') === appointment.jid);
            if (!jobEvents.length) {
                result.notInDay.push(appointment);
                continue;
            }
            let matchedEvent = jobEvents.length === 1 ? jobEvents[0] : null;
            if (!matchedEvent) {
                const timeMatches = jobEvents.filter(event => reportsV2StartOverlapsRange(
                    event,
                    appointment.startMinutes,
                    appointment.endMinutes
                ));
                if (timeMatches.length === 1) matchedEvent = timeMatches[0];
            }
            if (!matchedEvent) {
                result.ambiguous.push(appointment);
                continue;
            }
            const repId = reportsV2ResolveRepId(appointment.repName);
            if (!repId) {
                result.unresolved.push(appointment);
                continue;
            }
            reportsV2Selections[String(matchedEvent.id)] = repId;
            result.bound++;
        }
        reportsV2InvalidatePreflight();
        reportsV2RenderQueue();
        reportsV2RenderApplyResults(result);
    }

    function reportsV2Time(value) {
        const match = String(value || '').match(/\b(\d{2}):(\d{2})/);
        if (!match) return '--:--';
        const hour = Number(match[1]);
        return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
    }

    function reportsV2RepOptions(selected) {
        const entries = Object.entries(reportsV2Directory)
            .sort((a, b) => a[1].name.localeCompare(b[1].name));
        return [
            '<option value="">-- Select REP --</option>',
            ...entries.map(([id, user]) => `<option value="${reportsV2Escape(id)}" ${String(selected) === id ? 'selected' : ''}>${reportsV2Escape(user.name)} (id:${reportsV2Escape(id)})</option>`),
            '<option value="__manual__">Manual id:NNNNN...</option>'
        ].join('');
    }

    function reportsV2RenderQueue() {
        if (!reportsV2Queue) return;
        reportsV2Queue.style.display = reportsV2Events.length ? 'block' : 'none';
        reportsV2Queue.innerHTML = reportsV2Events.map((event, index) => {
            const check = reportsV2StructuralEligibility(event);
            const disabled = !check.eligible;
            return `<div style="margin-bottom: 6px; padding: 8px; border: 1px solid var(--border); border-left: 3px solid ${disabled ? 'var(--text-muted)' : 'var(--primary)'}; border-radius: 6px; opacity: ${disabled ? '0.55' : '1'};">
                <div style="display: flex; justify-content: space-between; gap: 8px;">
                    <strong style="font-size: 0.78rem;">${reportsV2Escape(reportsV2Time(event.start_date_time))}</strong>
                    ${disabled ? `<span style="font-size: 0.68rem; color: var(--text-muted);">${reportsV2Escape(check.reason)}</span>` : ''}
                </div>
                <div style="font-size: 0.8rem; font-weight: 650; overflow-wrap: anywhere;">${reportsV2Escape(event.title || 'Untitled event')}</div>
                <div style="font-size: 0.66rem; color: var(--text-muted);">eventId:${reportsV2Escape(event.id)} · jobId:${reportsV2Escape(event.job_id ?? 'none')}</div>
                <div style="margin: 4px 0; font-size: 0.7rem; color: var(--text-muted);">Attendees: ${reportsV2Escape(reportsV2AttendeeText(event))}</div>
                <select class="reports-v2-rep" data-event-id="${reportsV2Escape(event.id)}" ${disabled ? 'disabled' : ''} style="width: 100%; padding: 5px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--bg); color: var(--text-main);">
                    ${reportsV2RepOptions(reportsV2Selections[String(event.id)] || '')}
                </select>
            </div>`;
        }).join('');

        reportsV2Queue.querySelectorAll('.reports-v2-rep').forEach(select => {
            select.addEventListener('change', async event => {
                const eventId = event.target.dataset.eventId;
                let userId = event.target.value;
                if (userId === '__manual__') {
                    userId = String(prompt('Enter the Roofr user ID') || '').trim();
                    if (!/^\d+$/.test(userId)) userId = '';
                    if (userId && !reportsV2Directory[userId]) {
                        reportsV2Directory[userId] = { name: `id:${userId}` };
                        await reportsV2SaveDirectory();
                    }
                }
                reportsV2Selections[eventId] = userId;
                reportsV2InvalidatePreflight();
                reportsV2RenderQueue();
            });
        });
    }

    async function reportsV2LoadDay() {
        const dateStr = reportsV2Date?.value;
        if (!dateStr) return;
        reportsV2InvalidatePreflight();
        reportsV2SetStatus(`Loading ${dateStr}...`);
        if (reportsV2LoadBtn) reportsV2LoadBtn.disabled = true;
        try {
            const dayEvents = reportsV2ResponseData(await reportsV2Send({ type: 'ROOFR_API_GET_DAY_EVENTS', dateStr }));
            const salesEvents = (Array.isArray(dayEvents) ? dayEvents : []).filter(reportsV2SalesEvent);
            const detailed = [];
            for (const event of salesEvents) {
                try {
                    const detail = await reportsV2ApiAdapter.getEvent(event.id);
                    detailed.push({ ...event, ...detail, job_id: detail?.job_id ?? event.job_id });
                } catch (_) {
                    detailed.push(event);
                }
            }
            reportsV2Events = detailed;
            reportsV2RenderQueue();
            reportsV2SetStatus(`Loaded ${detailed.length} sales events`, 'success');
        } catch (error) {
            reportsV2SetStatus(error.message, 'error');
        } finally {
            if (reportsV2LoadBtn) reportsV2LoadBtn.disabled = false;
        }
    }

    async function reportsV2ScanDirectory() {
        if (reportsV2ScanBtn) reportsV2ScanBtn.disabled = true;
        const startCount = Object.keys(reportsV2Directory).length;
        let detailAttempts = 0;
        let detailsFetched = 0;
        try {
            const center = new Date(`${reportsV2Date?.value || reportsV2PhoenixDate()}T12:00:00`);
            for (let offset = -14; offset <= 14 && detailAttempts < 80; offset++) {
                const date = new Date(center);
                date.setDate(center.getDate() + offset);
                const dateStr = reportsV2PhoenixDate(date);
                reportsV2SetStatus(`Scanning directory: ${dateStr} (${detailAttempts}/80 details)`);
                const events = reportsV2ResponseData(await reportsV2Send({ type: 'ROOFR_API_GET_DAY_EVENTS', dateStr }));
                for (const event of Array.isArray(events) ? events : []) {
                    if (detailAttempts >= 80) break;
                    if (!(event?.attendee_user_ids?.length || event?.attendees?.length)) continue;
                    detailAttempts++;
                    try {
                        await reportsV2ApiAdapter.getEvent(event.id);
                        detailsFetched++;
                    } catch (_) {
                        // Keep the directory sweep moving past isolated read failures.
                    }
                    await new Promise(resolve => setTimeout(resolve, 150));
                }
                await new Promise(resolve => setTimeout(resolve, 150));
            }
            const found = Object.keys(reportsV2Directory).length;
            reportsV2RenderQueue();
            reportsV2SetStatus(`Directory scan complete: ${found} users (${found - startCount} new, ${detailsFetched} details read)`, 'success');
        } catch (error) {
            reportsV2SetStatus(`Directory scan stopped: ${error.message}`, 'error');
        } finally {
            if (reportsV2ScanBtn) reportsV2ScanBtn.disabled = false;
        }
    }

    function reportsV2MakeUnits() {
        return reportsV2Events.map(event => window.RoofrReportsBatch.createWorkUnit(
            event,
            reportsV2Selections[String(event.id)] || null
        ));
    }

    function reportsV2RenderState(state) {
        if (!state || !reportsV2Progress || !reportsV2Tally) return;
        reportsV2Progress.style.display = 'block';
        reportsV2Progress.textContent = state.units.map(unit => {
            const detail = unit.error?.reason || unit.error?.message || '';
            const ownerText = unit.ownerOk === null || unit.ownerOk === undefined ? 'ownerOk:n/a' : `ownerOk:${unit.ownerOk}`;
            return `event:${unit.eventId} job:${unit.jobId || 'none'} -> rep:${unit.repUserId || 'none'} | ${unit.outcome || unit.state} | ${ownerText}${detail ? ` (${detail})` : ''}`;
        }).join('\n');
        const tally = window.RoofrReportsBatch.tally(state.units);
        const ownerOk = (state.units || []).filter(unit => unit.ownerOk === true).length;
        const ownerFailed = (state.units || []).filter(unit => unit.ownerOk === false).length;
        reportsV2Tally.style.display = 'block';
        reportsV2Tally.textContent = [
            `verified_success ${tally.verified_success}`,
            `already_correct ${tally.already_correct}`,
            `dry_run ${tally.dry_run}`,
            `skipped ${tally.skipped}`,
            `failed ${tally.failed}`,
            `needs_review ${tally.needs_review}`,
            `pending ${tally.pending}`,
            `owner_ok ${ownerOk}`,
            `owner_failed ${ownerFailed}`,
            state.stoppedReason ? `stopped: ${state.stoppedReason}` : ''
        ].filter(Boolean).join(' · ');
    }

    function reportsV2Preflight() {
        reportsV2PreflightUnits = reportsV2MakeUnits();
        const planned = reportsV2PreflightUnits.filter(unit => unit.state === 'pending');
        const skipped = reportsV2PreflightUnits.filter(unit => unit.outcome === 'skipped');
        reportsV2PreflightSummary.style.display = 'block';
        reportsV2PreflightSummary.textContent = [
            `Planned writes: ${planned.length}`,
            ...planned.map(unit => `event:${unit.eventId} job:${unit.jobId} -> ${reportsV2Directory[String(unit.repUserId)]?.name || `id:${unit.repUserId}`}`),
            `Skipped: ${skipped.length}`,
            ...skipped.map(unit => `event:${unit.eventId} (${unit.error?.reason || 'unknown'})`)
        ].join('\n');
        reportsV2ExecuteBtn.disabled = false;
    }

    async function reportsV2Run(config) {
        if (reportsV2Running) return;
        reportsV2Running = true;
        [reportsV2ExecuteBtn, reportsV2ResumeBtn, reportsV2RetryFailedBtn].forEach(button => {
            if (button) button.disabled = true;
        });
        const poll = setInterval(async () => {
            try { reportsV2RenderState(await window.RoofrReportsBatch.loadState()); } catch (_) {}
        }, 250);
        try {
            const result = await window.RoofrReportsBatch.execute({ api: reportsV2ApiAdapter, ...config });
            reportsV2RenderState(result.state);
            reportsV2SetStatus(result.state.stoppedReason ? `Stopped: ${result.state.stoppedReason}` : 'Run complete', result.state.stoppedReason ? 'warning' : 'success');
        } catch (error) {
            reportsV2SetStatus(`Run failed: ${error.message}`, 'error');
        } finally {
            clearInterval(poll);
            reportsV2Running = false;
            if (reportsV2ResumeBtn) reportsV2ResumeBtn.disabled = false;
            if (reportsV2RetryFailedBtn) reportsV2RetryFailedBtn.disabled = false;
            if (reportsV2ExecuteBtn) reportsV2ExecuteBtn.disabled = !reportsV2PreflightUnits;
        }
    }

    async function reportsV2RetryFailed() {
        const state = await window.RoofrReportsBatch.loadState();
        const failed = (state?.units || []).filter(unit => unit.outcome === 'failed').map(unit => ({
            ...unit,
            state: 'pending',
            outcome: null,
            error: null
        }));
        if (!failed.length) {
            reportsV2SetStatus('No failed work units to retry', 'warning');
            return;
        }
        const retryState = window.RoofrReportsBatch.makeState(failed, state.config);
        await window.RoofrReportsBatch.saveState(retryState);
        await reportsV2Run({ resume: true });
    }

    async function reportsV2ExportJournal() {
        const json = await window.RoofrReportsBatch.exportJournalJson();
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `roofr-reports-v2-journal-${reportsV2PhoenixDate()}.json`;
        link.click();
        URL.revokeObjectURL(url);
    }

    if (reportsV2Date) reportsV2Date.value = reportsV2PhoenixDate();
    reportsV2LoadDirectory().catch(error => reportsV2SetStatus(error.message, 'error'));
    window.RoofrReportsBatch.loadState().then(reportsV2RenderState).catch(() => {});
    reportsV2LoadBtn?.addEventListener('click', reportsV2LoadDay);
    reportsV2ScanBtn?.addEventListener('click', reportsV2ScanDirectory);
    reportsV2ApplyScheduleBtn?.addEventListener('click', reportsV2ApplySchedule);
    reportsV2PreflightBtn?.addEventListener('click', reportsV2Preflight);
    reportsV2ExecuteBtn?.addEventListener('click', () => reportsV2Run({
        units: reportsV2PreflightUnits,
        dryRun: reportsV2DryRun?.checked !== false,
        maxWrites: reportsV2WriteCap?.value === 'unlimited' ? null : Number(reportsV2WriteCap?.value || 1)
    }));
    reportsV2ResumeBtn?.addEventListener('click', () => reportsV2Run({ resume: true }));
    reportsV2RetryFailedBtn?.addEventListener('click', reportsV2RetryFailed);
    reportsV2ExportBtn?.addEventListener('click', reportsV2ExportJournal);
    reportsV2Date?.addEventListener('change', reportsV2InvalidatePreflight);
    reportsV2DryRun?.addEventListener('change', reportsV2InvalidatePreflight);
    reportsV2WriteCap?.addEventListener('change', reportsV2InvalidatePreflight);

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
        // Verify tab still exists before attempting operations
        const tabExists = async () => {
            try {
                await chrome.tabs.get(tabId);
                return true;
            } catch {
                return false;
            }
        };

        const injectAndRetry = async () => {
            if (!await tabExists()) {
                return { ok: false, error: 'Tab no longer exists' };
            }
            addReportsLog("Injecting content script...");
            try {
                // Clear the flag so the script re-initializes
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => { window.__roofrJobAutomationLoaded = false; }
                });
                // Inject the content script
                await chrome.scripting.executeScript({ target: { tabId }, files: ["roofr-api.js", "reports-batch.js", "content.js"] });
                await new Promise(r => setTimeout(r, 1000)); // Wait longer for script to initialize
                const response = await chrome.tabs.sendMessage(tabId, message);
                return response || { ok: false, error: 'No response after injection' };
            } catch (retryError) {
                const errorMsg = retryError.message || String(retryError);
                if (errorMsg.includes('No tab with id')) {
                    return { ok: false, error: 'Tab was closed' };
                }
                console.error('[Reports] Injection failed:', retryError);
                return { ok: false, error: `Failed to inject script: ${errorMsg}` };
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
    const batchScheduleBody = document.getElementById('batch-schedule-body');
    const batchScheduleSummary = document.getElementById('batch-schedule-summary');
    const toggleBatchScheduleBtn = document.getElementById('toggle-batch-schedule');
    const parseBatchBtn = document.getElementById('parse-batch-schedule');
    const batchParsedJobs = document.getElementById('batch-parsed-jobs');
    const batchJobsList = document.getElementById('batch-jobs-list');
    const runBatchBtn = document.getElementById('run-batch-automation');
    const batchProgress = document.getElementById('batch-progress');
    const batchProgressText = document.getElementById('batch-progress-text');
    const batchProgressBar = document.getElementById('batch-progress-bar');
    const batchLog = document.getElementById('batch-log');
    const batchControlButtons = document.getElementById('batch-control-buttons');
    const stopBatchBtn = document.getElementById('stop-batch-automation');
    const restartBatchBtn = document.getElementById('restart-batch-automation');

    let parsedAppointments = [];
    let batchIsPaused = false;
    let batchIsCancelled = false;
    let batchIsRunning = false;
    let batchBackgroundMode = false;
    let reviewBatchStart = 0;
    const REVIEW_BATCH_SIZE = 8;
    let reviewTabIds = [];
    let reviewTabMap = {}; // Maps appointment index → review tab ID
    let reviewIsRunning = false;
    let reviewIsCancelled = false;
    let executionOpenedTabIds = []; // Track tabs opened during execution to avoid reuse
    let batchPhase = 'idle'; // idle, review, phase1, phase2, phase3, done, cancelled
    let batchLogHistory = [];

    function setBatchScheduleCollapsed(collapsed) {
        if (!batchScheduleBody || !batchScheduleSummary || !toggleBatchScheduleBtn) return;
        if (!collapsed || parsedAppointments.length === 0) {
            batchScheduleBody.style.display = 'block';
            batchScheduleSummary.style.display = 'none';
            toggleBatchScheduleBtn.style.display = parsedAppointments.length ? 'inline-flex' : 'none';
            toggleBatchScheduleBtn.textContent = 'Hide';
            return;
        }

        const approvedCount = parsedAppointments.filter(a => a.approved).length;
        const reps = [...new Set(parsedAppointments.map(a => a.rep).filter(Boolean))];
        batchScheduleSummary.textContent = `${parsedAppointments.length} appointments parsed (${approvedCount} selected)${reps.length ? ` • ${reps.join(', ')}` : ''}`;
        batchScheduleBody.style.display = 'none';
        batchScheduleSummary.style.display = 'block';
        toggleBatchScheduleBtn.style.display = 'inline-flex';
        toggleBatchScheduleBtn.textContent = 'Edit';
    }

    if (toggleBatchScheduleBtn) {
        toggleBatchScheduleBtn.addEventListener('click', () => {
            const isCollapsed = batchScheduleBody?.style.display === 'none';
            setBatchScheduleCollapsed(!isCollapsed);
        });
    }

    // --- Dashboard BroadcastChannel ---
    const batchChannel = new BroadcastChannel('roofr-batch-dashboard');

    function broadcastState() {
        try {
            batchChannel.postMessage({
                type: 'BATCH_FULL_STATE',
                data: {
                    appointments: parsedAppointments.map(a => ({...a})),
                    phase: batchPhase,
                    progress: { current: 0, total: parsedAppointments.filter(a => a.approved).length },
                    reviewBatchStart,
                    reviewBatchSize: REVIEW_BATCH_SIZE,
                    isRunning: batchIsRunning,
                    isPaused: batchIsPaused
                }
            });
        } catch (e) {}
    }

    batchChannel.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'DASHBOARD_CONNECTED') {
            broadcastState();
            // Send log history
            try {
                batchChannel.postMessage({ type: 'BATCH_LOG_HISTORY', logs: batchLogHistory });
            } catch (e) {}
        } else if (msg.type === 'BATCH_TOGGLE_APPROVED') {
            if (parsedAppointments[msg.index]) {
                parsedAppointments[msg.index].approved = msg.approved;
                renderParsedAppointments();
            }
        }
    };

    // Open dashboard button
    const dashboardBtn = document.getElementById('open-batch-dashboard');
    if (dashboardBtn) {
        dashboardBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: chrome.runtime.getURL('batch-dashboard.html') });
        });
    }

    // Load background mode preference
    chrome.storage.sync.get({ batch_background_mode: false }, (result) => {
        batchBackgroundMode = result.batch_background_mode;
        const toggle = document.getElementById('batch-background-mode');
        if (toggle) toggle.checked = batchBackgroundMode;
    });

    // Background mode toggle handler
    const bgModeToggle = document.getElementById('batch-background-mode');
    if (bgModeToggle) {
        bgModeToggle.addEventListener('change', async (e) => {
            batchBackgroundMode = e.target.checked;
            await chrome.storage.sync.set({ batch_background_mode: batchBackgroundMode });
            addBatchLog(batchBackgroundMode ? 'Background mode enabled' : 'Background mode disabled', 'info');
        });
    }

    // Parse schedule text into appointments
    function parseScheduleReport(text) {
        const appointments = [];
        const lines = text.trim().split('\n');

        let currentRep = null;

        for (const line of lines) {
            const trimmedLine = line.replace(/\s*\[JID:\d+\]/g, '').trim();
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
                    status: 'pending',
                    calendarAdded: false,
                    jobCardAdded: false,
                    approved: true
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

        // Broadcast to dashboard
        batchLogHistory.push({ message, logType: type, timestamp });
        try {
            batchChannel.postMessage({ type: 'BATCH_LOG', message, logType: type, timestamp });
        } catch (e) {}
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
        batchLogHistory = [];
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

        const reviewControls = document.getElementById('batch-review-controls');

        if (parsedAppointments.length === 0) {
            batchParsedJobs.style.display = 'none';
            runBatchBtn.style.display = 'none';
            if (reviewControls) reviewControls.style.display = 'none';
            return;
        }

        batchParsedJobs.style.display = 'block';
        runBatchBtn.style.display = 'block';
        if (reviewControls) reviewControls.style.display = 'block';

        // Update review batch label and button states
        updateReviewBatchUI();

        const escapeHtml = (value) => String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        const statusChip = (label, color, bg) => `
            <span style="display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: 4px; font-size: 0.68rem; font-weight: 700; color: ${color}; background: ${bg}; white-space: nowrap;">${label}</span>
        `;

        let html = '';
        let currentRep = null;

        for (let i = 0; i < parsedAppointments.length; i++) {
            const apt = parsedAppointments[i];
            if (apt.rep !== currentRep) {
                if (currentRep !== null) html += '</div>';
                currentRep = apt.rep;
                const repAppointments = parsedAppointments.filter(a => a.rep === currentRep);
                const repApproved = repAppointments.filter(a => a.approved).length;
                html += `<div style="margin-bottom: 8px;">
                    <div style="position: sticky; top: -8px; z-index: 1; display: flex; align-items: center; justify-content: space-between; padding: 6px 4px; background: var(--surface); border-bottom: 1px solid var(--border);">
                        <strong style="color: var(--primary); font-size: 0.83rem;">${escapeHtml(apt.rep)}</strong>
                        <span style="font-size: 0.72rem; color: var(--text-muted);">${repApproved}/${repAppointments.length} selected</span>
                    </div>`;
            }

            const isSkipped = apt.status === 'skipped';
            const rowOpacity = !apt.approved ? '0.54' : '1';
            const rowBg = !apt.approved ? 'transparent' : 'rgba(59, 130, 246, 0.06)';
            const rowBorder = apt.status === 'error' ? 'var(--danger)' : apt.approved ? 'var(--primary)' : 'var(--border)';
            const checkedAttr = apt.approved ? 'checked' : '';
            const chips = [
                statusChip(apt.calendarAdded ? 'Calendar added' : 'Calendar pending', apt.calendarAdded ? 'var(--success)' : 'var(--text-muted)', apt.calendarAdded ? 'rgba(34,197,94,0.12)' : 'var(--surface-hover)'),
                statusChip(apt.reportOrdered ? 'Report ordered' : apt.reportPending ? 'Report review' : 'Report pending', apt.reportOrdered ? 'var(--success)' : apt.reportPending ? 'var(--primary)' : 'var(--text-muted)', apt.reportOrdered ? 'rgba(34,197,94,0.12)' : apt.reportPending ? 'rgba(59,130,246,0.12)' : 'var(--surface-hover)')
            ];
            if (apt.hasLotUnit) chips.push(statusChip('Lot/unit check', 'var(--danger)', 'rgba(239,68,68,0.12)'));
            if (apt.hasAppointmentTimeMismatch) chips.push(statusChip('Time mismatch', 'var(--danger)', 'rgba(239,68,68,0.12)'));
            if (apt.status === 'done') chips.push(statusChip('Done', 'var(--success)', 'rgba(34,197,94,0.12)'));
            if (apt.status === 'error') chips.push(statusChip('Error', 'var(--danger)', 'rgba(239,68,68,0.12)'));
            if (isSkipped) chips.push(statusChip('Skipped', 'var(--text-muted)', 'var(--surface-hover)'));

            html += `<div style="display: grid; grid-template-columns: 22px minmax(68px, 82px) minmax(0, 1fr); gap: 8px; align-items: start; margin: 6px 0; padding: 8px; border: 1px solid var(--border); border-left: 3px solid ${rowBorder}; border-radius: 6px; background: ${rowBg}; opacity: ${rowOpacity};" id="batch-apt-${i}">
                <input type="checkbox" ${checkedAttr} data-apt-idx="${i}" class="review-checkbox" style="margin-top: 2px; cursor: pointer; accent-color: var(--primary);">
                <div style="font-size: 0.75rem; font-weight: 800; color: var(--text-main); line-height: 1.25;">${escapeHtml(apt.startTime)}<br><span style="color: var(--text-muted); font-weight: 700;">${escapeHtml(apt.endTime)}</span></div>
                <div style="min-width: 0;">
                    <div class="batch-open-job" data-apt-idx="${i}" title="Click to open this job card in a new tab" style="font-size: 0.82rem; font-weight: 650; color: var(--primary); cursor: pointer; line-height: 1.25; overflow-wrap: anywhere; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px;">${escapeHtml(apt.address)}</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px;">${chips.join('')}</div>
                </div>
            </div>`;
        }
        if (currentRep !== null) html += '</div>';

        batchJobsList.innerHTML = html;

        // Wire up checkbox handlers
        batchJobsList.querySelectorAll('.review-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.aptIdx);
                parsedAppointments[idx].approved = e.target.checked;
                setBatchScheduleCollapsed(batchScheduleBody?.style.display === 'none');
                // Re-render to update styling
                renderParsedAppointments();
            });
        });

        // One-click: open a row's job card in a new tab
        batchJobsList.querySelectorAll('.batch-open-job').forEach(el => {
            el.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.aptIdx);
                if (!isNaN(idx) && parsedAppointments[idx]) openAppointmentJobCard(parsedAppointments[idx]);
            });
        });

        broadcastState();
    }

    // Update review batch UI (label, button states)
    function updateReviewBatchUI() {
        const openBtn = document.getElementById('open-review-batch');
        if (openBtn) {
            const total = parsedAppointments.length;
            openBtn.textContent = `Open All for Review (${total} jobs)`;
        }
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

            reviewBatchStart = 0;
            reviewTabIds = [];
            reviewTabMap = {};
            renderParsedAppointments();
            setBatchScheduleCollapsed(true);
            addBatchLog(`Parsed ${parsedAppointments.length} appointments`);
        });
    }

    // --- Review Batch Functions ---

    // One-click: open a Review Queue row's Roofr job card in a new tab.
    // Reuses the extension's middle-click opener — the MAIN-world script reads the
    // calendar event's job_id from React fiber and opens the job in a background
    // tab. No event popup, no "Open job" hunt (which is what made it feel clunky).
    async function openAppointmentJobCard(apt) {
        if (!apt || !apt.address) return;
        try {
            const calQueryOpts = { url: "*://app.roofr.com/*/calendar*" };
            if (window.__targetWindowId) calQueryOpts.windowId = window.__targetWindowId;
            const calendarTabs = await chrome.tabs.query(calQueryOpts);
            if (calendarTabs.length === 0) {
                addBatchLog('ERROR: Open the Roofr calendar first', 'error');
                return;
            }
            const calendarTab = calendarTabs[0];
            addBatchLog(`Opening job card for ${apt.address}...`);

            // Simulate a middle-click on the event; the fiber opener handles the rest.
            const res = await sendMessageToTab(calendarTab.id, {
                type: 'OPEN_JOB_VIA_EVENT_CLICK',
                address: apt.address,
                time: apt.startTime
            });
            if (!res || !res.ok) {
                addBatchLog(`Could not open job card for ${apt.address}: ${res?.error || 'event not visible on calendar'}`, 'error');
            }
        } catch (e) {
            addBatchLog(`Open job card failed: ${e.message}`, 'error');
        }
    }

    async function openReviewBatch() {
        const openBtn = document.getElementById('open-review-batch');
        if (openBtn) {
            openBtn.disabled = true;
            openBtn.textContent = 'Opening tabs...';
        }

        reviewIsRunning = true;
        reviewIsCancelled = false;
        batchPhase = 'review';
        broadcastState();

        try {
            // Get the calendar tab
            const calQueryOpts = { url: "*://app.roofr.com/*/calendar*" };
            if (window.__targetWindowId) calQueryOpts.windowId = window.__targetWindowId;
            const calendarTabs = await chrome.tabs.query(calQueryOpts);
            if (calendarTabs.length === 0) {
                addBatchLog('ERROR: Please open the Roofr calendar first', 'error');
                return;
            }

            const calendarTab = calendarTabs[0];

            // Create/get "Review" tab group
            let reviewGroupId = null;
            try {
                reviewGroupId = await chrome.tabs.group({ tabIds: [calendarTab.id] });
                await chrome.tabGroups.update(reviewGroupId, {
                    title: 'Review',
                    color: 'green',
                    collapsed: false
                });
            } catch (groupError) {
                // Calendar may already be in a group
                const calTabInfo = await chrome.tabs.get(calendarTab.id);
                if (calTabInfo.groupId && calTabInfo.groupId !== -1) {
                    reviewGroupId = calTabInfo.groupId;
                    await chrome.tabGroups.update(reviewGroupId, {
                        title: 'Review',
                        color: 'green',
                        collapsed: false
                    });
                }
            }

            let needsReviewGroupId = null;
            async function moveJobTabToNeedsReviewGroup(tabId) {
                try {
                    if (needsReviewGroupId) {
                        try {
                            await chrome.tabs.group({ tabIds: [tabId], groupId: needsReviewGroupId });
                        } catch (e) {
                            needsReviewGroupId = await chrome.tabs.group({ tabIds: [tabId] });
                        }
                    } else {
                        needsReviewGroupId = await chrome.tabs.group({ tabIds: [tabId] });
                    }
                    await chrome.tabGroups.update(needsReviewGroupId, {
                        title: 'Needs Review',
                        color: 'red',
                        collapsed: false
                    });
                    addBatchLog(`Moved job tab ${tabId} to "Needs Review" group`, 'info');
                } catch (e) {
                    addBatchLog(`Could not move job tab ${tabId} to "Needs Review" group: ${e.message}`, 'error');
                }
            }

            const totalJobs = parsedAppointments.length;
            let reviewStagger = 3000; // Start at 3s, increases on 429
            addBatchLog(`Opening all ${totalJobs} jobs for review (staggered ${reviewStagger / 1000}s apart)`);

            for (let i = 0; i < totalJobs; i++) {
                if (reviewIsCancelled) {
                    addBatchLog('Review cancelled', 'info');
                    break;
                }
                const apt = parsedAppointments[i];
                addBatchLog(`Review ${i + 1}: Finding ${apt.address}...`);

                // Stagger tab opens to avoid overwhelming Roofr
                await new Promise(r => setTimeout(r, reviewStagger));
                if (reviewIsCancelled) break;

                // Find and click the calendar event
                const findResult = await sendMessageToTab(calendarTab.id, {
                    type: 'BATCH_FIND_EVENT',
                    address: apt.address,
                    time: apt.startTime
                });

                if (reviewIsCancelled) break;
                if (!findResult || !findResult.ok) {
                    addBatchLog(`Could not find event for ${apt.address}`, 'error');
                    continue;
                }

                // Wait for popup to load
                const popupWait = i === 0 ? 6000 : 4000;
                await new Promise(r => setTimeout(r, popupWait));
                if (reviewIsCancelled) break;

                // Open job — use backgroundMode to get URL without opening a tab
                const openResult = await sendMessageToTab(calendarTab.id, {
                    type: 'BATCH_OPEN_JOB',
                    address: apt.address,
                    backgroundMode: true
                });

                if (!openResult || !openResult.ok) {
                    addBatchLog(`Could not open job for ${apt.address}`, 'error');
                    continue;
                }

                // Track job URL for dashboard
                if (openResult.url) apt.jobUrl = openResult.url;

                let jobTabId = null;

                if (openResult.urlOnly && openResult.url) {
                    // Create the tab ourselves in the background (no focus steal)
                    const newTab = await chrome.tabs.create({
                        url: openResult.url,
                        active: false
                    });
                    jobTabId = newTab.id;
                } else if (openResult.tabId) {
                    jobTabId = openResult.tabId;
                } else {
                    // Fallback: tab was opened by content script, find it
                    await new Promise(r => setTimeout(r, 2000));
                    const jobQueryOpts = { url: "*://app.roofr.com/*/jobs*" };
                    if (window.__targetWindowId) jobQueryOpts.windowId = window.__targetWindowId;
                    const jobTabs = await chrome.tabs.query(jobQueryOpts);
                    const newJobTab = jobTabs.find(t => t.id !== calendarTab.id && !reviewTabIds.includes(t.id));
                    if (newJobTab) {
                        jobTabId = newJobTab.id;
                    }
                }

                if (jobTabId) {
                    // Wait for tab to load, detect 429 rate limiting, and retry
                    let tabReady = false;
                    for (let retryAttempt = 0; retryAttempt < 3; retryAttempt++) {
                        // Wait for tab to finish loading
                        await new Promise((resolve) => {
                            const onUpdated = (updatedId, info) => {
                                if (updatedId === jobTabId && info.status === 'complete') {
                                    chrome.tabs.onUpdated.removeListener(onUpdated);
                                    resolve();
                                }
                            };
                            chrome.tabs.onUpdated.addListener(onUpdated);
                            setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); }, 15000);
                        });

                        // Check if rate-limited
                        try {
                            const tabInfo = await chrome.tabs.get(jobTabId);
                            if (tabInfo.title && tabInfo.title.includes('Too Many Requests')) {
                                const backoffMs = (retryAttempt + 1) * 8000; // 8s, 16s, 24s
                                addBatchLog(`Rate limited (429) on tab ${jobTabId}, waiting ${backoffMs / 1000}s before retry...`, 'error');
                                reviewStagger = Math.min(reviewStagger + 2000, 8000); // Slow down future opens
                                await new Promise(r => setTimeout(r, backoffMs));
                                await chrome.tabs.reload(jobTabId);
                                continue;
                            }
                        } catch (e) { /* tab may have been closed */ }
                        tabReady = true;
                        break;
                    }

                    if (!tabReady) {
                        addBatchLog(`Tab ${jobTabId} still rate-limited after retries, keeping anyway`, 'error');
                    }

                    reviewTabIds.push(jobTabId);
                    reviewTabMap[i] = jobTabId;
                    addBatchLog(`Opened job tab ${jobTabId} for review`, 'success');

                    // Add to Review group
                    if (reviewGroupId) {
                        try {
                            await chrome.tabs.group({ tabIds: [jobTabId], groupId: reviewGroupId });
                        } catch (e) { /* ignore */ }
                    }

                    // --- Scan job card for paint job, lot/unit, time mismatch, report status ---
                    try {
                        const scanResult = await sendMessageToTab(jobTabId, {
                            type: 'SCAN_JOB_CARD',
                            scheduledStartTime: apt.startTime,
                            scheduledEndTime: apt.endTime
                        });

                        if (scanResult && !scanResult.error) {
                            const warningMessages = [];
                            const hasTentativeRep = Boolean(apt.rep);
                            const injectTentativeRepBanner = async () => {
                                if (warningMessages.length || !hasTentativeRep) return;
                                try {
                                    await sendMessageToTab(jobTabId, {
                                        type: 'INJECT_WARNING_BANNER',
                                        message: `TENTATIVE REP — ${apt.rep} is planned for this job.`,
                                        color: '#2563eb',
                                        emoji: '👤'
                                    });
                                } catch (e) { /* ignore */ }
                            };

                            // Paint job — no Roofr report needed
                            if (scanResult.isPaintJob) {
                                addBatchLog(`[${i + 1}] 🎨 PAINT JOB — no Roofr report needed`, 'info');
                                apt.isPaintJob = true;
                            }

                            // Lot/unit warning — inject visual banner on the tab
                            if (scanResult.hasLotUnit) {
                                addBatchLog(`[${i + 1}] ⚠ LOT/UNIT ADDRESS — Roofr may pin the wrong building. Verify the pin is on the correct structure before ordering. Context: "${scanResult.lotUnitContext}"`, 'error');
                                apt.hasLotUnit = true;
                                apt.lotUnitContext = scanResult.lotUnitContext;
                                warningMessages.push('LOT/UNIT ADDRESS — Roofr may pin the wrong building. Verify the pin is on the correct structure before ordering.');
                                await moveJobTabToNeedsReviewGroup(jobTabId);
                            }

                            // Time mismatch warning — notes arrival window differs from scheduled calendar time
                            if (scanResult.hasAppointmentTimeMismatch) {
                                addBatchLog(`[${i + 1}] ⚠ APPOINTMENT TIME DIFFERENT — Notes say ${scanResult.notesArrivalWindow}, but calendar is scheduled ${scanResult.scheduledWindow}. Context: "${scanResult.timeMismatchContext || 'Arrival Window'}"`, 'error');
                                apt.hasAppointmentTimeMismatch = true;
                                apt.notesArrivalWindow = scanResult.notesArrivalWindow;
                                apt.scheduledWindow = scanResult.scheduledWindow;
                                warningMessages.unshift(`APPOINTMENT TIME DIFFERENT — Notes say ${scanResult.notesArrivalWindow}, but calendar is scheduled ${scanResult.scheduledWindow}.`);
                                await moveJobTabToNeedsReviewGroup(jobTabId);
                            }

                            // Inject one red warning banner on the job card page for all warnings found.
                            if (warningMessages.length) {
                                try {
                                    await sendMessageToTab(jobTabId, {
                                        type: 'INJECT_WARNING_BANNER',
                                        message: warningMessages.join('  |  '),
                                        color: '#dc2626',
                                        emoji: '🚨'
                                    });
                                } catch (e) { /* ignore */ }
                            }

                            // Report status
                            if (scanResult.reportStatus === 'processing') {
                                addBatchLog(`[${i + 1}] Report already ordered (Processing)`, 'success');
                                apt.reportOrdered = true;
                                await injectTentativeRepBanner();
                            } else if (scanResult.reportStatus === 'complete') {
                                addBatchLog(`[${i + 1}] Report already complete`, 'success');
                                apt.reportOrdered = true;
                                await injectTentativeRepBanner();
                            } else if (!scanResult.isPaintJob) {
                                // Report needed — click "Roofr report" to navigate to confirm pin page
                                addBatchLog(`[${i + 1}] Opening Roofr report ordering...`);
                                const clickResult = await sendMessageToTab(jobTabId, { type: 'CLICK_ROOFR_REPORT_BUTTON' });
                                if (clickResult?.ok) {
                                    addBatchLog(`[${i + 1}] → Confirm pin page (waiting for you to order)`, 'info');
                                    apt.reportPending = true;
                                    await injectTentativeRepBanner();
                                } else {
                                    addBatchLog(`[${i + 1}] Could not find Roofr report button: ${clickResult?.error || 'unknown'}`, 'error');
                                    await injectTentativeRepBanner();
                                }
                            } else {
                                await injectTentativeRepBanner();
                            }
                        } else {
                            addBatchLog(`[${i + 1}] Scan failed: ${scanResult?.error || 'no response'}`, 'error');
                        }
                    } catch (scanErr) {
                        addBatchLog(`[${i + 1}] Scan error: ${scanErr.message}`, 'error');
                    }
                }

                // Close calendar popup
                try {
                    await sendMessageToTab(calendarTab.id, { type: 'BATCH_CLOSE_POPUP' });
                } catch (e) { /* ignore */ }

                await new Promise(r => setTimeout(r, 1500));
            }

            // Summary
            const paintCount = parsedAppointments.filter(a => a.isPaintJob).length;
            const lotUnitCount = parsedAppointments.filter(a => a.hasLotUnit).length;
            const timeMismatchCount = parsedAppointments.filter(a => a.hasAppointmentTimeMismatch).length;
            const reportPending = parsedAppointments.filter(a => a.reportPending).length;
            const reportDone = parsedAppointments.filter(a => a.reportOrdered).length;
            addBatchLog(`Review batch opened: ${reviewTabIds.length} tabs`, 'success');
            if (paintCount) addBatchLog(`  🎨 ${paintCount} paint job(s) — no report needed`, 'info');
            if (reportDone) addBatchLog(`  ✓ ${reportDone} report(s) already ordered`, 'success');
            if (reportPending) addBatchLog(`  📋 ${reportPending} report(s) waiting for you to order`, 'info');
            if (lotUnitCount) addBatchLog(`  ⚠ ${lotUnitCount} job(s) with LOT/UNIT — verify pin carefully!`, 'error');
            if (timeMismatchCount) addBatchLog(`  ⚠ ${timeMismatchCount} job(s) with notes/calendar time mismatch — verify appointment window!`, 'error');
        } catch (err) {
            addBatchLog(`Review error: ${err.message}`, 'error');
        } finally {
            reviewIsRunning = false;
            batchPhase = 'idle';
            broadcastState();
            if (openBtn) {
                openBtn.disabled = false;
                updateReviewBatchUI();
            }
        }
    }

    async function closeReviewTabs() {
        for (const tabId of reviewTabIds) {
            try {
                await chrome.tabs.remove(tabId);
            } catch (e) { /* tab may already be closed */ }
        }
        if (reviewTabIds.length > 0) {
            addBatchLog(`Closed ${reviewTabIds.length} review tabs`);
        }
        reviewTabIds = [];
        reviewTabMap = {};
    }

    // Wire up review controls
    const openReviewBtn = document.getElementById('open-review-batch');
    if (openReviewBtn) {
        openReviewBtn.addEventListener('click', () => openReviewBatch());
    }

    // Prev/next batch buttons removed — we now open all jobs at once

    const reviewCloseBtn = document.getElementById('review-close-tabs');
    if (reviewCloseBtn) {
        reviewCloseBtn.addEventListener('click', () => closeReviewTabs());
    }

    const reviewSelectAllBtn = document.getElementById('review-select-all');
    if (reviewSelectAllBtn) {
        reviewSelectAllBtn.addEventListener('click', () => {
            for (const apt of parsedAppointments) apt.approved = true;
            renderParsedAppointments();
        });
    }

    const reviewDeselectAllBtn = document.getElementById('review-deselect-all');
    if (reviewDeselectAllBtn) {
        reviewDeselectAllBtn.addEventListener('click', () => {
            for (const apt of parsedAppointments) apt.approved = false;
            renderParsedAppointments();
        });
    }

    // --- End Review Batch Functions ---

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

            // Cancel any running review batch and wait for it to stop
            if (reviewIsRunning) {
                reviewIsCancelled = true;
                addBatchLog('Waiting for review batch to stop...');
                while (reviewIsRunning) {
                    await new Promise(r => setTimeout(r, 200));
                }
            }

            // Don't close review tabs — we'll reuse them during execution
            executionOpenedTabIds = [];

            // Reset state
            batchIsPaused = false;
            batchIsCancelled = false;
            batchIsRunning = true;

            clearBatchLog();

            const approvedCount = parsedAppointments.filter(a => a.approved).length;
            const skippedCount = parsedAppointments.length - approvedCount;
            addBatchLog(`Starting batch automation... (${approvedCount} approved, ${skippedCount} will be skipped)`);
            runBatchBtn.textContent = 'Pause Automation';
            runBatchBtn.style.background = 'var(--warning, #f59e0b)';

            // Show control buttons
            if (batchControlButtons) {
                batchControlButtons.style.display = 'flex';
            }

            // Get the calendar tab in target window only
            const calQueryOpts = { url: "*://app.roofr.com/*/calendar*" };
            if (window.__targetWindowId) calQueryOpts.windowId = window.__targetWindowId;
            const calendarTabs = await chrome.tabs.query(calQueryOpts);
            if (calendarTabs.length === 0) {
                addBatchLog('ERROR: Please open the Roofr calendar first', 'error');
                // Reset button state on error
                batchIsRunning = false;
                runBatchBtn.textContent = 'Execute Approved';
                runBatchBtn.style.background = '';
                runBatchBtn.disabled = false;
                if (batchControlButtons) batchControlButtons.style.display = 'none';
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

            // --- Load CSR list from settings (auto-updates when reps change) ---
            let csrList = [];
            try {
                const csrSettings = await chrome.storage.sync.get(['PEOPLE_CSRS']);
                console.log('[Batch] Raw PEOPLE_CSRS from storage:', JSON.stringify(csrSettings));
                if (csrSettings.PEOPLE_CSRS) {
                    csrList = csrSettings.PEOPLE_CSRS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
                }
            } catch (e) {
                console.warn('[Batch] Could not load CSR list:', e);
            }
            // Fallback if storage is empty — use known CSR list
            // Also try PEOPLE_CSRS with different casing/keys
            if (csrList.length === 0) {
                try {
                    const allSettings = await chrome.storage.sync.get(null);
                    console.log('[Batch] All sync storage keys:', Object.keys(allSettings));
                    // Try to find any key containing CSRS
                    for (const key of Object.keys(allSettings)) {
                        if (key.toUpperCase().includes('CSR') && typeof allSettings[key] === 'string' && allSettings[key].includes(',')) {
                            csrList = allSettings[key].split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
                            addBatchLog(`CSR list found via key "${key}" (${csrList.length} names)`);
                            break;
                        }
                    }
                } catch (e) {}
            }
            if (csrList.length === 0) {
                csrList = [
                    'alex tillotson', 'bronté pisz', 'bronte pisz', 'diva shahpur',
                    'khamilah valles', 'madi meyers', 'nica javier',
                    'travis jones'
                ];
                addBatchLog(`CSR list: using hardcoded fallback (${csrList.length} names)`, 'info');
            } else {
                addBatchLog(`CSR list loaded (${csrList.length}): ${csrList.map(c => c.split(' ')[0]).join(', ')}`);
            }

            // --- Address matching helpers ---
            const normalizeAddress = (addr) => {
                if (!addr) return '';
                // Strip brackets/parens too — Roofr job titles wrap the address like
                // "paint (1310 North Lesueur...)", which otherwise left "(1310" and
                // "85203)" un-parseable and broke street-number matching.
                return addr.toLowerCase().replace(/[,.\-#()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
            };
            const getAddressParts = (addr) => {
                const normalized = normalizeAddress(addr);
                const parts = normalized.split(' ');
                const streetNum = parts.find(p => /^\d+$/.test(p)) || '';
                const streetWords = parts.filter(p =>
                    p.length > 2 && !/^\d+$/.test(p) &&
                    !['az', 'st', 'rd', 'ln', 'dr', 'ave', 'blvd', 'ct', 'cir', 'pl', 'way', 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].includes(p)
                );
                return { streetNum, streetWords };
            };

            // Nickname-aware person-name compare. The schedule/CSR list uses
            // nicknames ("Madi Meyers") but Roofr stores the legal name
            // ("Madison Meyers"), so plain includes() fails to confirm the owner.
            const personNameMatch = (a, b) => {
                if (!a || !b) return false;
                const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
                const A = norm(a), B = norm(b);
                if (A === B || A.includes(B) || B.includes(A)) return true;
                const aw = A.split(/\s+/), bw = B.split(/\s+/);
                const af = aw[0] || '', al = aw[aw.length - 1] || '';
                const bf = bw[0] || '', bl = bw[bw.length - 1] || '';
                const firstOk = !!af && !!bf && (af.startsWith(bf) || bf.startsWith(af));
                const lastOk = !!al && !!bl && (al === bl || al.startsWith(bl) || bl.startsWith(al));
                return firstOk && lastOk;
            };

            // --- Shared helper: set job owner on a tab ---
            async function doSetOwner(tabId, apt, prefix) {
                const maxAttempts = 3;
                let jobOwnerSet = false;
                let addressVerified = false;

                for (let attempt = 1; attempt <= maxAttempts && !jobOwnerSet; attempt++) {
                    try {
                        const jobInfo = await sendMessageToTab(tabId, { type: 'GET_JOB_INFO' });
                        const currentOwner = jobInfo?.info?.jobOwner || '';
                        const jobAddress = jobInfo?.info?.address || '';

                        if (!addressVerified) {
                            const expected = getAddressParts(apt.address);
                            const actual = getAddressParts(jobAddress);
                            const numMatch = expected.streetNum === actual.streetNum;
                            const wordMatch = expected.streetWords.some(w =>
                                actual.streetWords.some(aw => aw.includes(w) || w.includes(aw))
                            );
                            if (numMatch && wordMatch) {
                                addressVerified = true;
                                addBatchLog(`${prefix} Address verified: "${jobAddress}"`, 'success');
                            } else {
                                addBatchLog(`${prefix} Address mismatch! Expected: "${apt.address}", Got: "${jobAddress}"`, 'error');
                                break;
                            }
                        }

                        const repLower = apt.rep.toLowerCase();
                        const ownerLower = currentOwner.toLowerCase();
                        if (ownerLower === repLower || ownerLower.includes(repLower) || repLower.includes(ownerLower)) {
                            addBatchLog(`${prefix} Owner already set to ${currentOwner}`, 'success');
                            jobOwnerSet = true;
                            apt.jobCardAdded = true;
                            break;
                        }

                        // Check if current owner is a non-CSR — don't overwrite
                        if (currentOwner) {
                            // Normalize accents for comparison (Bronté → bronte)
                            const stripAccents = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                            const ownerNorm = stripAccents(ownerLower);
                            const isCsr = csrList.some(csr => {
                                const csrNorm = stripAccents(csr);
                                return ownerNorm.includes(csrNorm) || csrNorm.includes(ownerNorm);
                            });
                            if (!isCsr) {
                                addBatchLog(`${prefix} ⚠ STOP: Owner "${currentOwner}" is NOT a CSR — skipping (manual review needed)`, 'error');
                                apt.ownerSkipped = true;
                                apt.ownerSkipReason = `Non-CSR owner: ${currentOwner}`;
                                break;
                            }
                        }

                        addBatchLog(`${prefix} Attempt ${attempt}: "${currentOwner}" → "${apt.rep}"...`);
                        const result = await sendMessageToTab(tabId, { type: 'SELECT_JOB_OWNER', repName: apt.rep });
                        if (!result?.ok) {
                            addBatchLog(`${prefix} Attempt ${attempt} failed: ${result?.error || 'unknown'}`, 'error');
                            if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 2000));
                            continue;
                        }

                        await new Promise(r => setTimeout(r, 1500));

                        const afterInfo = await sendMessageToTab(tabId, { type: 'GET_JOB_INFO' });
                        const newOwner = afterInfo?.info?.jobOwner || '';
                        const newLower = newOwner.toLowerCase();
                        if (newLower === repLower || newLower.includes(repLower) || repLower.includes(newLower)) {
                            addBatchLog(`${prefix} Owner confirmed: ${newOwner}`, 'success');
                            jobOwnerSet = true;
                            apt.jobCardAdded = true;
                        } else {
                            addBatchLog(`${prefix} Verify failed: "${newOwner}" ≠ "${apt.rep}"`, 'error');
                            if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 2000));
                        }
                    } catch (err) {
                        addBatchLog(`${prefix} Attempt ${attempt} error: ${err.message}`, 'error');
                        if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 2000));
                    }
                }
                if (!jobOwnerSet) {
                    addBatchLog(`${prefix} Warning: Owner not confirmed after ${maxAttempts} attempts`, 'error');
                }
                return jobOwnerSet;
            }

            // --- Shared helper: check report + close tab ---
            async function doReportCheckAndClose(tabId, apt, jobOwnerSet, prefix) {
                try {
                    const finalInfo = await sendMessageToTab(tabId, { type: 'GET_JOB_INFO' });
                    const reportStatus = finalInfo?.info?.reportStatus || '';
                    addBatchLog(`${prefix} Report: ${reportStatus || 'unknown'}`);

                    const closeStatuses = ['pending', 'complete', 'processing'];
                    if (jobOwnerSet && closeStatuses.includes(reportStatus)) {
                        chrome.tabs.remove(tabId).catch(() => {}); // Fire and forget
                        addBatchLog(`${prefix} Tab closed`, 'success');
                    } else if (!jobOwnerSet) {
                        addBatchLog(`${prefix} Keeping tab open (owner not set)`);
                    } else {
                        addBatchLog(`${prefix} Keeping tab open (report: ${reportStatus})`);
                    }
                } catch (e) {
                    addBatchLog(`${prefix} Could not check/close tab: ${e.message}`);
                }
            }

            // --- Active calendar tab (can be swapped if one gets flagged) ---
            let activeCalendarTabId = calendarTab.id;

            // --- Helper: create a fresh calendar tab and wait for events ---
            async function createFreshCalendarTab(reason) {
                let calUrl;
                try {
                    const origInfo = await chrome.tabs.get(calendarTab.id);
                    calUrl = origInfo.url || `https://app.roofr.com/dashboard/team/239329/calendar`;
                } catch (e) {
                    calUrl = `https://app.roofr.com/dashboard/team/239329/calendar`;
                }
                addBatchLog(`Creating fresh calendar tab (${reason})...`);
                const newTab = await chrome.tabs.create({ url: calUrl, active: false });
                if (reportsGroupId) {
                    try { await chrome.tabs.group({ tabIds: [newTab.id], groupId: reportsGroupId }); } catch (e) {}
                }
                // Wait for events to load
                let ready = false;
                for (let attempt = 0; attempt < 20; attempt++) {
                    await new Promise(r => setTimeout(r, 1000));
                    try {
                        const checkResult = await chrome.scripting.executeScript({
                            target: { tabId: newTab.id },
                            func: () => document.querySelectorAll('.rbc-event-content, .rbc-event').length
                        });
                        if ((checkResult?.[0]?.result || 0) > 0) { ready = true; break; }
                    } catch (e) {}
                }
                addBatchLog(`Fresh calendar tab ${newTab.id} ${ready ? 'ready' : 'may not have loaded'}`, ready ? 'success' : 'error');
                activeCalendarTabId = newTab.id;
                return newTab.id;
            }

            async function reloadCalendarTabForNextEdit(tabId, prefix) {
                try {
                    // Capture the viewed week BEFORE reloading. Roofr resets the
                    // calendar to the CURRENT week on reload, which hides future-week
                    // events (e.g. next week's appointments) and loses progress.
                    let restoreDate = null;
                    try {
                        const vis = await sendMessageToTab(tabId, { type: 'GET_VISIBLE_DATES' });
                        const iso = (vis && vis.datesISO) || [];
                        const anchor = iso[Math.floor(iso.length / 2)] || iso[0] || null;
                        if (anchor && /^\d{4}-\d{2}-\d{2}/.test(anchor)) {
                            const [yy, mm, dd] = anchor.slice(0, 10).split('-').map(Number);
                            restoreDate = { year: yy, month: mm, day: dd, iso: anchor.slice(0, 10) };
                        }
                    } catch (e) { /* best effort */ }

                    addBatchLog(`${prefix} Reloading calendar before next edit...`);
                    await chrome.tabs.reload(tabId);

                    await new Promise((resolve) => {
                        const onUpdated = (updatedId, info) => {
                            if (updatedId === tabId && info.status === 'complete') {
                                chrome.tabs.onUpdated.removeListener(onUpdated);
                                resolve();
                            }
                        };
                        chrome.tabs.onUpdated.addListener(onUpdated);
                        setTimeout(() => {
                            chrome.tabs.onUpdated.removeListener(onUpdated);
                            resolve();
                        }, 20000);
                    });

                    try {
                        const teamResult = await sendMessageToTab(tabId, { type: 'SELECT_ALL_TEAM_MEMBERS' });
                        if (teamResult?.clicked) {
                            addBatchLog(`${prefix} Selected all team members`);
                            await new Promise(r => setTimeout(r, 2500));
                        } else if (teamResult?.ok) {
                            addBatchLog(`${prefix} Team members already selected`);
                        }
                    } catch (e) {
                        addBatchLog(`${prefix} Could not confirm team filter: ${e.message}`, 'error');
                    }

                    // Restore the week we were on before the reload, so future-dated
                    // appointments are visible again (the reload reset us to today's week).
                    if (restoreDate) {
                        try {
                            const nav = await sendMessageToTab(tabId, {
                                type: 'CLICK_DATE_IN_PICKER',
                                day: restoreDate.day, month: restoreDate.month, year: restoreDate.year
                            });
                            if (nav && nav.ok) {
                                addBatchLog(`${prefix} Restored week of ${restoreDate.iso}`, 'success');
                                await new Promise(r => setTimeout(r, 1500));
                            } else {
                                addBatchLog(`${prefix} Could not restore week ${restoreDate.iso}: ${nav?.error || 'date picker not found'}`, 'error');
                            }
                        } catch (e) {
                            addBatchLog(`${prefix} Week restore failed: ${e.message}`, 'error');
                        }
                    }

                    let eventCount = 0;
                    for (let attempt = 0; attempt < 30; attempt++) {
                        await new Promise(r => setTimeout(r, 500));
                        try {
                            const result = await chrome.scripting.executeScript({
                                target: { tabId },
                                func: () => document.querySelectorAll('.rbc-event-content, .rbc-event button, button.rbc-event, .rbc-event').length
                            });
                            eventCount = result?.[0]?.result || 0;
                            if (eventCount > 0) break;
                        } catch (e) {}
                    }

                    if (eventCount > 0) {
                        addBatchLog(`${prefix} Calendar ready (${eventCount} event(s) visible)`, 'success');
                        return true;
                    }

                    addBatchLog(`${prefix} Calendar reload did not show events yet`, 'error');
                    return false;
                } catch (e) {
                    addBatchLog(`${prefix} Calendar reload failed: ${e.message}`, 'error');
                    return false;
                }
            }

            // --- Helper: move a calendar tab to "Needs Attention" group ---
            async function moveToNeedsAttention(tabId, label) {
                try {
                    const attentionGroupId = await chrome.tabs.group({ tabIds: [tabId] });
                    await chrome.tabGroups.update(attentionGroupId, {
                        title: `⚠ ${label}`,
                        color: 'red',
                        collapsed: false
                    });
                    addBatchLog(`Moved calendar tab to "⚠ ${label}" group`, 'info');
                } catch (e) {
                    addBatchLog(`Could not move tab to attention group: ${e.message}`, 'error');
                }
            }

            // --- Shared helper: edit calendar event ---
            async function doCalendarEdit(apt, prefix, calTabId) {
                const useTabId = calTabId || activeCalendarTabId;
                try {
                    if (!batchBackgroundMode) {
                        try { await chrome.tabs.update(useTabId, { active: true }); } catch (e) {}
                    }
                    // Close any lingering popup from previous edit before searching
                    try {
                        await sendMessageToTab(useTabId, { type: 'BATCH_CLOSE_POPUP' });
                    } catch (e) {}
                    await new Promise(r => setTimeout(r, 800));

                    const editResult = await sendMessageToTab(useTabId, {
                        type: 'BATCH_EDIT_EVENT',
                        address: apt.address,
                        time: apt.startTime,
                        repName: apt.rep
                    });

                    // Non-CSR invitee — move this calendar tab to Needs Attention, create fresh one
                    if (editResult?.stopAll) {
                        const flagLabel = editResult.inviteeName || 'Review needed';
                        addBatchLog(`${prefix} ⚠ FLAGGED: ${editResult.reason}`, 'error');
                        apt.calendarFlagged = true;

                        // Move the problem calendar tab to Needs Attention
                        await moveToNeedsAttention(useTabId, 'Needs Review');

                        // Create a fresh calendar tab to continue
                        if (useTabId === activeCalendarTabId) {
                            await createFreshCalendarTab(`replacing flagged tab for ${flagLabel}`);
                        }
                        return;
                    }

                    if (!editResult?.ok) {
                        addBatchLog(`${prefix} Calendar edit failed: ${editResult?.error || 'unknown'}`, 'error');
                        await reloadCalendarTabForNextEdit(useTabId, prefix);
                    } else {
                        if (editResult.csrsRemoved > 0) addBatchLog(`${prefix} Removed ${editResult.csrsRemoved} CSR(s)`, 'success');
                        if (editResult.details) addBatchLog(`${prefix} ${editResult.details}`, 'info');
                        if (editResult.skipped) {
                            addBatchLog(`${prefix} Skipped: ${editResult.reason}`, 'info');
                        } else {
                            addBatchLog(`${prefix} Calendar updated`, 'success');
                        }
                        apt.calendarAdded = true;
                        await reloadCalendarTabForNextEdit(useTabId, prefix);
                    }
                } catch (e) {
                    addBatchLog(`${prefix} Calendar error: ${e.message}`, 'error');
                    await reloadCalendarTabForNextEdit(useTabId, prefix);
                }
            }

            // === AUTO-DETECT: Scan open Roofr job tabs and match to appointments ===
            addBatchLog(`Scanning for already-open job tabs...`);
            try {
                const jobQueryOpts = { url: "*://app.roofr.com/*/jobs*" };
                if (window.__targetWindowId) jobQueryOpts.windowId = window.__targetWindowId;
                const openJobTabs = await chrome.tabs.query(jobQueryOpts);
                // Only match tabs in the same tab group as the calendar tab (the batch group)
                const calTabInfo = await chrome.tabs.get(calendarTab.id);
                const batchGroupId = calTabInfo.groupId || -1;
                const unmatchedTabs = openJobTabs.filter(t => {
                    if (t.id === calendarTab.id) return false;
                    // If calendar is in a group, only match tabs in that same group
                    if (batchGroupId !== -1) return t.groupId === batchGroupId;
                    // If no group, match all job tabs
                    return true;
                });
                addBatchLog(`Found ${unmatchedTabs.length} open job tab(s), matching to appointments...`);

                for (const tab of unmatchedTabs) {
                    // Skip tabs that are rate-limited or on report queue
                    if (tab.title?.includes('Too Many Requests')) continue;
                    if (tab.url?.includes('/report/queue')) continue;

                    try {
                        const jobInfo = await sendMessageToTab(tab.id, { type: 'GET_JOB_INFO' });
                        const tabAddress = jobInfo?.info?.address || '';
                        if (!tabAddress) continue;

                        const tabParts = getAddressParts(tabAddress);

                        // Try to match against each unmatched appointment
                        for (let i = 0; i < parsedAppointments.length; i++) {
                            if (reviewTabMap[i]) continue; // Already matched
                            const apt = parsedAppointments[i];
                            const aptParts = getAddressParts(apt.address);

                            const numMatch = aptParts.streetNum && aptParts.streetNum === tabParts.streetNum;
                            const wordMatch = aptParts.streetWords.some(w =>
                                tabParts.streetWords.some(tw => tw.includes(w) || w.includes(tw))
                            );

                            if (numMatch && wordMatch) {
                                reviewTabMap[i] = tab.id;
                                addBatchLog(`  Matched tab ${tab.id} → [${i + 1}] ${tabAddress}`, 'success');
                                break;
                            }
                        }
                    } catch (e) {
                        // Content script not loaded — try injecting and retry once
                        try {
                            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["roofr-api.js", "reports-batch.js", "content.js"] });
                            await new Promise(r => setTimeout(r, 1500));
                            const jobInfo = await sendMessageToTab(tab.id, { type: 'GET_JOB_INFO' });
                            const tabAddress = jobInfo?.info?.address || '';
                            if (!tabAddress) continue;

                            const tabParts = getAddressParts(tabAddress);
                            for (let i = 0; i < parsedAppointments.length; i++) {
                                if (reviewTabMap[i]) continue;
                                const apt = parsedAppointments[i];
                                const aptParts = getAddressParts(apt.address);
                                const numMatch = aptParts.streetNum && aptParts.streetNum === tabParts.streetNum;
                                const wordMatch = aptParts.streetWords.some(w =>
                                    tabParts.streetWords.some(tw => tw.includes(w) || w.includes(tw))
                                );
                                if (numMatch && wordMatch) {
                                    reviewTabMap[i] = tab.id;
                                    addBatchLog(`  Matched tab ${tab.id} → [${i + 1}] ${tabAddress}`, 'success');
                                    break;
                                }
                            }
                        } catch (e2) { /* skip this tab */ }
                    }
                }

                const matchedCount = Object.keys(reviewTabMap).length;
                addBatchLog(`Auto-detected ${matchedCount} open job tab(s) matched to appointments`);
            } catch (e) {
                addBatchLog(`Tab scan error: ${e.message}`, 'error');
            }

            // === CATEGORIZE APPOINTMENTS ===
            const reviewJobs = [];   // Have review tabs open — run in parallel
            const sequentialJobs = []; // Need full sequential flow

            for (let i = 0; i < parsedAppointments.length; i++) {
                const apt = parsedAppointments[i];
                if (!apt.approved) {
                    addBatchLog(`Skipping ${apt.address} (not approved)`, 'info');
                    apt.status = 'skipped';
                    renderParsedAppointments();
                    continue;
                }

                let hasReviewTab = false;
                if (reviewTabMap[i]) {
                    try {
                        await chrome.tabs.get(reviewTabMap[i]);
                        hasReviewTab = true;
                    } catch (e) { /* tab closed */ }
                }

                if (hasReviewTab) {
                    reviewJobs.push({ i, apt, tabId: reviewTabMap[i] });
                } else {
                    sequentialJobs.push({ i, apt });
                }
            }

            addBatchLog(`${reviewJobs.length} reviewed (parallel) + ${sequentialJobs.length} remaining (sequential)`);

            // === PHASE 1: Parallel owner assignments on review tabs (5s stagger) ===
            if (reviewJobs.length > 0 && !batchIsCancelled) {
                batchPhase = 'phase1';
                broadcastState();
                addBatchLog(`\n=== Phase 1: Setting owners in parallel (5s stagger) ===`);

                const ownerPromises = reviewJobs.map((job, batchIdx) => (async () => {
                    // Stagger start by 5s per job
                    if (batchIdx > 0) {
                        await new Promise(r => setTimeout(r, batchIdx * 5000));
                    }
                    if (batchIsCancelled) return;

                    const { i, apt, tabId } = job;
                    const prefix = `[${i + 1}]`;

                    // Grab job URL from the open tab
                    try { const ti = await chrome.tabs.get(tabId); if (ti.url) apt.jobUrl = ti.url; } catch(e) {}

                    updateBatchProgress(i + 1, parsedAppointments.length, `Owner: ${apt.address}`);
                    addBatchLog(`${prefix} ${apt.rep} → ${apt.address}`);

                    // Brief wait for page readiness
                    await new Promise(r => setTimeout(r, 1000));

                    const ownerSet = await doSetOwner(tabId, apt, prefix);
                    job.ownerSet = ownerSet;

                    // Check report + close tab (fire-and-forget close)
                    await doReportCheckAndClose(tabId, apt, ownerSet, prefix);

                    renderParsedAppointments();
                })());

                await Promise.all(ownerPromises);
                addBatchLog(`Phase 1 complete — all owners processed`, 'success');
            }

            // === PHASE 2: Sequential calendar edits on 1 tab (skip failures, retry at end) ===
            if (reviewJobs.length > 0 && !batchIsCancelled) {
                batchPhase = 'phase2';
                broadcastState();
                addBatchLog(`\n=== Phase 2: Updating calendar (${reviewJobs.length} events, 1 tab) ===`);

                const failedCalendarEdits = []; // { job, error } — retry queue

                // --- First pass: process each event sequentially ---
                for (let jobIdx = 0; jobIdx < reviewJobs.length; jobIdx++) {
                    if (batchIsCancelled) break;
                    while (batchIsPaused && !batchIsCancelled) {
                        await new Promise(r => setTimeout(r, 500));
                    }
                    if (batchIsCancelled) break;

                    const job = reviewJobs[jobIdx];
                    const { i, apt } = job;
                    const prefix = `[${i + 1}]`;

                    try {
                        await doCalendarEdit(apt, prefix, activeCalendarTabId);

                        if (apt.calendarFlagged) {
                            apt.status = 'error';
                            addBatchLog(`${prefix} ⚠ Flagged for review`, 'error');
                        } else if (apt.calendarAdded) {
                            apt.status = 'done';
                            addBatchLog(`${prefix} ✓ Done`, 'success');
                        } else {
                            // Edit returned without setting calendarAdded — treat as failure
                            addBatchLog(`${prefix} Calendar edit did not confirm — queued for retry`, 'error');
                            failedCalendarEdits.push({ job, error: 'Edit did not confirm' });
                        }
                        renderParsedAppointments();
                    } catch (e) {
                        addBatchLog(`${prefix} Calendar error: ${e.message} — queued for retry`, 'error');
                        failedCalendarEdits.push({ job, error: e.message });
                        renderParsedAppointments();
                    }
                }

                // --- Retry pass: try failed edits once more ---
                if (failedCalendarEdits.length > 0 && !batchIsCancelled) {
                    addBatchLog(`\n--- Retrying ${failedCalendarEdits.length} failed calendar edit(s) ---`);

                    // Brief pause before retries to let calendar settle
                    await new Promise(r => setTimeout(r, 2000));

                    const stillFailed = [];

                    for (const { job, error: prevError } of failedCalendarEdits) {
                        if (batchIsCancelled) break;
                        while (batchIsPaused && !batchIsCancelled) {
                            await new Promise(r => setTimeout(r, 500));
                        }
                        if (batchIsCancelled) break;

                        const { i, apt } = job;
                        const prefix = `[${i + 1}][retry]`;

                        try {
                            // Reset calendar state on the apt so doCalendarEdit runs fresh
                            apt.calendarAdded = false;
                            apt.calendarFlagged = false;

                            await doCalendarEdit(apt, prefix, activeCalendarTabId);

                            if (apt.calendarFlagged) {
                                apt.status = 'error';
                                stillFailed.push({ job, error: 'Flagged on retry' });
                            } else if (apt.calendarAdded) {
                                apt.status = 'done';
                                addBatchLog(`${prefix} ✓ Retry succeeded`, 'success');
                            } else {
                                stillFailed.push({ job, error: 'Edit did not confirm on retry' });
                            }
                            renderParsedAppointments();
                        } catch (e) {
                            addBatchLog(`${prefix} Retry failed: ${e.message}`, 'error');
                            stillFailed.push({ job, error: e.message });
                            renderParsedAppointments();
                        }
                    }

                    // --- Final report of anything that still failed ---
                    if (stillFailed.length > 0) {
                        addBatchLog(`\n⚠ ${stillFailed.length} calendar edit(s) FAILED after retry:`, 'error');
                        for (const { job, error } of stillFailed) {
                            const { i, apt } = job;
                            addBatchLog(`  [${i + 1}] ${apt.rep} → ${apt.address} — ${error}`, 'error');
                        }
                    }
                }

                const flaggedCount = reviewJobs.filter(j => j.apt.calendarFlagged).length;
                const failedCount = reviewJobs.filter(j => !j.apt.calendarAdded && !j.apt.calendarFlagged && j.apt.approved).length;
                if (flaggedCount > 0) {
                    addBatchLog(`Phase 2 complete — ${flaggedCount} event(s) flagged for review (in red tab groups)`, 'error');
                } else if (failedCount > 0) {
                    addBatchLog(`Phase 2 complete — ${failedCount} event(s) could not be updated`, 'error');
                } else {
                    addBatchLog(`Phase 2 complete — all calendar events updated`, 'success');
                }
            }

            // === PHASE 3: Sequential full flow for non-review items ===
            if (sequentialJobs.length > 0 && !batchIsCancelled) {
                batchPhase = 'phase3';
                broadcastState();
                addBatchLog(`\n=== Phase 3: Processing ${sequentialJobs.length} remaining jobs ===`);

                let pendingCalendarEdit = null;

                for (const job of sequentialJobs) {
                    if (batchIsCancelled) {
                        addBatchLog('Automation cancelled by user', 'error');
                        break;
                    }
                    while (batchIsPaused && !batchIsCancelled) {
                        await new Promise(r => setTimeout(r, 500));
                    }
                    if (batchIsCancelled) break;

                    const { i, apt } = job;
                    const prefix = `[${i + 1}]`;

                    updateBatchProgress(i + 1, parsedAppointments.length, `Processing: ${apt.address}`);
                    addBatchLog(`\n${prefix} ${apt.rep} → ${apt.address}`);

                    try {
                        // Wait for any pending calendar edit (calendar tab is shared)
                        if (pendingCalendarEdit) {
                            addBatchLog('Waiting for previous calendar edit...');
                            try { await pendingCalendarEdit; } catch (e) {}
                            pendingCalendarEdit = null;
                        }

                        // Find event on calendar (use active calendar tab — may have been swapped)
                        if (!batchBackgroundMode) {
                            try { await chrome.tabs.update(activeCalendarTabId, { active: true }); } catch (e) {}
                        }
                        await new Promise(r => setTimeout(r, 500));

                        let findResult = await sendMessageToTab(activeCalendarTabId, {
                            type: 'BATCH_FIND_EVENT',
                            address: apt.address,
                            time: apt.startTime
                        });

                        if (!findResult?.ok) {
                            addBatchLog(`${prefix} Event not ready yet, reloading calendar and retrying...`, 'error');
                            await reloadCalendarTabForNextEdit(activeCalendarTabId, prefix);
                            await new Promise(r => setTimeout(r, 2000));
                            findResult = await sendMessageToTab(activeCalendarTabId, {
                                type: 'BATCH_FIND_EVENT',
                                address: apt.address,
                                time: apt.startTime
                            });
                        }

                        if (!findResult?.ok) throw new Error(findResult?.error || 'Could not find calendar event');
                        addBatchLog(`${prefix} Found event, opening popup...`);

                        await new Promise(r => setTimeout(r, 4000));

                        // Open job tab
                        const openResult = await sendMessageToTab(activeCalendarTabId, {
                            type: 'BATCH_OPEN_JOB',
                            address: apt.address
                        });
                        if (!openResult?.ok) throw new Error(openResult?.error || 'Could not open job');
                        if (openResult?.url) apt.jobUrl = openResult.url;

                        let jobTabId = openResult.tabId;
                        if (!jobTabId || openResult.needsTabLookup) {
                            await new Promise(r => setTimeout(r, 2000));
                            const jobQueryOpts = { url: "*://app.roofr.com/*/jobs*" };
                            if (window.__targetWindowId) jobQueryOpts.windowId = window.__targetWindowId;
                            const jobTabs = await chrome.tabs.query(jobQueryOpts);
                            const knownTabIds = new Set([calendarTab.id, activeCalendarTabId, ...reviewTabIds, ...executionOpenedTabIds]);
                            const recentJobTab = jobTabs.find(t => !knownTabIds.has(t.id));
                            if (recentJobTab) {
                                jobTabId = recentJobTab.id;
                            } else {
                                throw new Error('Could not find the opened job tab');
                            }
                        }

                        executionOpenedTabIds.push(jobTabId);
                        if (reportsGroupId) {
                            try { await chrome.tabs.group({ tabIds: [jobTabId], groupId: reportsGroupId }); } catch (e) {}
                        }

                        // Wait for page load + check for 429 + wait for job data to render
                        for (let retryAttempt = 0; retryAttempt < 3; retryAttempt++) {
                            await new Promise((resolve) => {
                                const onUpdated = (updatedId, info) => {
                                    if (updatedId === jobTabId && info.status === 'complete') {
                                        chrome.tabs.onUpdated.removeListener(onUpdated);
                                        resolve();
                                    }
                                };
                                chrome.tabs.onUpdated.addListener(onUpdated);
                                setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); }, 15000);
                            });
                            try {
                                const tabInfo = await chrome.tabs.get(jobTabId);
                                if (tabInfo.title && tabInfo.title.includes('Too Many Requests')) {
                                    const backoffMs = (retryAttempt + 1) * 8000;
                                    addBatchLog(`${prefix} Rate limited (429), waiting ${backoffMs / 1000}s...`, 'error');
                                    await new Promise(r => setTimeout(r, backoffMs));
                                    await chrome.tabs.reload(jobTabId);
                                    continue;
                                }
                            } catch (e) { /* tab may have closed */ }
                            break;
                        }

                        // Wait for job data to actually render (React loads data async after page shell)
                        let jobDataReady = false;
                        for (let dataAttempt = 0; dataAttempt < 15; dataAttempt++) {
                            await new Promise(r => setTimeout(r, 1000));
                            try {
                                const probe = await sendMessageToTab(jobTabId, { type: 'GET_JOB_INFO' });
                                if (probe?.info?.address) {
                                    jobDataReady = true;
                                    addBatchLog(`${prefix} Job data loaded (${dataAttempt + 1}s)`);
                                    break;
                                }
                            } catch (e) { /* content script may not be ready yet */ }
                        }
                        if (!jobDataReady) {
                            addBatchLog(`${prefix} Job data may not have loaded — proceeding anyway`, 'error');
                        }

                        // Set owner
                        const ownerSet = await doSetOwner(jobTabId, apt, prefix);

                        // Check report
                        let shouldClose = false;
                        try {
                            const finalInfo = await sendMessageToTab(jobTabId, { type: 'GET_JOB_INFO' });
                            const reportStatus = finalInfo?.info?.reportStatus || '';
                            addBatchLog(`${prefix} Report: ${reportStatus || 'unknown'}`);
                            const closeStatuses = ['pending', 'complete', 'processing'];
                            shouldClose = ownerSet && closeStatuses.includes(reportStatus);
                            if (!ownerSet) addBatchLog(`${prefix} Keeping tab open (owner not set)`);
                            else if (!shouldClose) addBatchLog(`${prefix} Keeping tab open (report: ${reportStatus})`);
                        } catch (e) {}

                        // Fire calendar edit in background, close tab in parallel
                        const capturedApt = apt;
                        const capturedTabId = jobTabId;
                        const capturedShouldClose = shouldClose;
                        const capturedPrefix = prefix;

                        pendingCalendarEdit = doCalendarEdit(capturedApt, capturedPrefix);

                        // Close tab simultaneously (fire and forget)
                        if (capturedShouldClose) {
                            chrome.tabs.remove(capturedTabId).then(() => {
                                addBatchLog(`${capturedPrefix} Tab closed`, 'success');
                            }).catch(() => {});
                        }

                        apt.status = 'done';
                        addBatchLog(`${prefix} ✓ Owner set, calendar updating in background`, 'success');

                    } catch (error) {
                        addBatchLog(`${prefix} ERROR: ${error.message}`, 'error');
                        apt.status = 'error';
                        try { await sendMessageToTab(activeCalendarTabId, { type: 'BATCH_CLOSE_POPUP' }); } catch (e) {}
                    }

                    renderParsedAppointments();
                }

                // Wait for final calendar edit
                if (pendingCalendarEdit) {
                    addBatchLog('Waiting for final calendar edit...');
                    try { await pendingCalendarEdit; } catch (e) {}
                }
            }

            batchPhase = batchIsCancelled ? 'cancelled' : 'done';
            broadcastState();

            updateBatchProgress(parsedAppointments.length, parsedAppointments.length,
                batchIsCancelled ? 'Batch cancelled' : 'Batch processing complete!');
            addBatchLog(batchIsCancelled ? '\n=== Batch cancelled ===' : '\n=== Batch processing finished ===',
                batchIsCancelled ? 'error' : 'success');

            // Reset button state
            batchIsRunning = false;
            batchIsPaused = false;
            batchIsCancelled = false;
            runBatchBtn.textContent = 'Execute Approved';
            runBatchBtn.style.background = '';
            runBatchBtn.disabled = false;

            // Hide control buttons
            if (batchControlButtons) {
                batchControlButtons.style.display = 'none';
            }
        });
    }

    // Stop button handler
    if (stopBatchBtn) {
        stopBatchBtn.addEventListener('click', () => {
            if (batchIsRunning) {
                batchIsCancelled = true;
                batchIsPaused = false;
                addBatchLog('Stopping automation...', 'error');
                runBatchBtn.textContent = 'Stopping...';
                runBatchBtn.style.background = 'var(--danger, #ef4444)';
            }
        });
    }

    // Restart button handler
    if (restartBatchBtn) {
        restartBatchBtn.addEventListener('click', async () => {
            if (parsedAppointments.length === 0) {
                alert('No appointments to restart');
                return;
            }

            // If currently running, stop first
            if (batchIsRunning) {
                batchIsCancelled = true;
                batchIsPaused = false;
                addBatchLog('Stopping current run for restart...', 'info');

                // Wait for the current run to stop
                let waitCount = 0;
                while (batchIsRunning && waitCount < 20) {
                    await new Promise(r => setTimeout(r, 500));
                    waitCount++;
                }
            }

            // Reset all appointments to pending
            for (const apt of parsedAppointments) {
                apt.status = 'pending';
                apt.calendarAdded = false;
                apt.jobCardAdded = false;
            }
            renderParsedAppointments();

            addBatchLog('\n=== Restarting automation from beginning ===', 'info');

            // Trigger the run button click to restart
            if (runBatchBtn) {
                runBatchBtn.click();
            }
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
        // Verify tab still exists before attempting operations
        const tabExists = async () => {
            try {
                await chrome.tabs.get(tabId);
                return true;
            } catch {
                return false;
            }
        };

        const injectAndRetry = async () => {
            if (!await tabExists()) {
                return { ok: false, error: 'Tab no longer exists' };
            }
            addBatchLog("Injecting content script...");
            try {
                // Clear the flag so the script re-initializes
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: () => { window.__roofrJobAutomationLoaded = false; }
                });
                // Inject the content script
                await chrome.scripting.executeScript({ target: { tabId }, files: ["roofr-api.js", "reports-batch.js", "content.js"] });
                await new Promise(r => setTimeout(r, 1000)); // Wait for script to initialize
                const response = await chrome.tabs.sendMessage(tabId, message);
                return response || { ok: false, error: 'No response after injection' };
            } catch (retryError) {
                const errorMsg = retryError.message || String(retryError);
                if (errorMsg.includes('No tab with id')) {
                    return { ok: false, error: 'Tab was closed' };
                }
                console.error('[Batch] Injection failed:', retryError);
                return { ok: false, error: `Failed to inject script: ${errorMsg}` };
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
    // CTM (CALLTRACKINGMETRICS) TOGGLE SECTION
    // ========================================

    const ctmToggle = document.getElementById('ctm-toggle');
    const ctmCsrModal = document.getElementById('ctm-csr-modal');
    const ctmCsrSelect = document.getElementById('ctm-csr-select');
    const ctmProductionSelect = document.getElementById('ctm-production-select');
    const ctmMgmtSelect = document.getElementById('ctm-mgmt-select');
    const ctmInsuranceSelect = document.getElementById('ctm-insurance-select');
    const ctmCsrConfirm = document.getElementById('ctm-csr-confirm');
    const ctmCsrCancel = document.getElementById('ctm-csr-cancel');
    const closeCtmCsrModal = document.getElementById('close-ctm-csr-modal');
    const ctmAssignedRepDisplay = document.getElementById('ctm-assigned-rep-display');

    function getAllPeopleNames() {
        return [...new Set([
            ...(PEOPLE_DATA.REPS || []),
            ...(PEOPLE_DATA.CSRS || []),
            ...(PEOPLE_DATA.PRODUCTION || []),
            ...(PEOPLE_DATA.MGMT || []),
            ...(PEOPLE_DATA.INSURANCE || []),
            ...(PEOPLE_DATA.D2D || [])
        ].filter(Boolean))].sort();
    }

    async function initSlotIdentityPicker() {
        if (!slotRepIdentitySelect) return;
        const people = getAllPeopleNames();
        slotRepIdentitySelect.innerHTML = '<option value="">Pick name</option>';
        people.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            slotRepIdentitySelect.appendChild(opt);
        });

        const stored = await chrome.storage.sync.get({
            roofr_rep_identity: null,
            ctm_csr: ''
        });
        const identityName = stored.roofr_rep_identity?.name || stored.ctm_csr || '';
        if (identityName && !people.includes(identityName)) {
            const opt = document.createElement('option');
            opt.value = identityName;
            opt.textContent = identityName;
            slotRepIdentitySelect.appendChild(opt);
        }
        slotRepIdentitySelect.value = identityName;
        currentRepIdentity = normalizeRepIdentityName(identityName);

        slotRepIdentitySelect.addEventListener('change', async () => {
            const name = slotRepIdentitySelect.value;
            currentRepIdentity = normalizeRepIdentityName(name);
            if (name) {
                await chrome.storage.sync.set({ roofr_rep_identity: { name } });
            } else {
                await chrome.storage.sync.remove('roofr_rep_identity');
            }
            renderUIFromState();
        });
    }

    // Populate all CTM dropdowns
    function populateCtmDropdowns() {
        if (ctmCsrSelect) {
            ctmCsrSelect.innerHTML = '<option value="">-- Select CSR --</option>';
            const csrs = PEOPLE_DATA.CSRS || [];
            csrs.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                ctmCsrSelect.appendChild(opt);
            });
        }

        if (ctmProductionSelect) {
            ctmProductionSelect.innerHTML = '<option value="">-- Select Production --</option>';
            const production = PEOPLE_DATA.PRODUCTION || [];
            production.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                ctmProductionSelect.appendChild(opt);
            });
        }

        if (ctmMgmtSelect) {
            ctmMgmtSelect.innerHTML = '<option value="">-- Select Management --</option>';
            const mgmt = PEOPLE_DATA.MGMT || [];
            mgmt.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                ctmMgmtSelect.appendChild(opt);
            });
        }

        if (ctmInsuranceSelect) {
            ctmInsuranceSelect.innerHTML = '<option value="">-- Select Insurance --</option>';
            const insurance = ['Aaron Munz', 'Caite Bonomo'];
            insurance.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                ctmInsuranceSelect.appendChild(opt);
            });
        }
    }

    // Clear other CTM dropdowns when one is selected
    function setupCtmDropdownListeners() {
        if (ctmCsrSelect) {
            ctmCsrSelect.addEventListener('change', () => {
                if (ctmCsrSelect.value) {
                    if (ctmProductionSelect) ctmProductionSelect.value = '';
                    if (ctmMgmtSelect) ctmMgmtSelect.value = '';
                    if (ctmInsuranceSelect) ctmInsuranceSelect.value = '';
                }
            });
        }
        if (ctmProductionSelect) {
            ctmProductionSelect.addEventListener('change', () => {
                if (ctmProductionSelect.value) {
                    if (ctmCsrSelect) ctmCsrSelect.value = '';
                    if (ctmMgmtSelect) ctmMgmtSelect.value = '';
                    if (ctmInsuranceSelect) ctmInsuranceSelect.value = '';
                }
            });
        }
        if (ctmMgmtSelect) {
            ctmMgmtSelect.addEventListener('change', () => {
                if (ctmMgmtSelect.value) {
                    if (ctmCsrSelect) ctmCsrSelect.value = '';
                    if (ctmProductionSelect) ctmProductionSelect.value = '';
                    if (ctmInsuranceSelect) ctmInsuranceSelect.value = '';
                }
            });
        }
        if (ctmInsuranceSelect) {
            ctmInsuranceSelect.addEventListener('change', () => {
                if (ctmInsuranceSelect.value) {
                    if (ctmCsrSelect) ctmCsrSelect.value = '';
                    if (ctmProductionSelect) ctmProductionSelect.value = '';
                    if (ctmMgmtSelect) ctmMgmtSelect.value = '';
                }
            });
        }
    }

    // Get selected person from any CTM dropdown
    function getSelectedCtmCallHandler() {
        if (ctmCsrSelect?.value) return ctmCsrSelect.value;
        if (ctmProductionSelect?.value) return ctmProductionSelect.value;
        if (ctmMgmtSelect?.value) return ctmMgmtSelect.value;
        if (ctmInsuranceSelect?.value) return ctmInsuranceSelect.value;
        return '';
    }

    // Show CTM CSR modal
    function showCtmCsrModal() {
        if (!ctmCsrModal) return;
        populateCtmDropdowns();
        setupCtmDropdownListeners();
        ctmCsrModal.classList.remove('hidden');
    }

    // Hide CTM CSR modal
    function hideCtmCsrModal() {
        if (!ctmCsrModal) return;
        ctmCsrModal.classList.add('hidden');
    }

    // Update CTM assigned rep display
    function updateCtmAssignedRepDisplay(name) {
        if (ctmAssignedRepDisplay) {
            if (name) {
                // Get first name only for display
                const firstName = name.split(' ')[0];
                ctmAssignedRepDisplay.textContent = firstName;
                ctmAssignedRepDisplay.title = `CTM: ${name}`;
            } else {
                ctmAssignedRepDisplay.textContent = '--';
                ctmAssignedRepDisplay.title = 'CTM assigned rep';
            }
        }

        // Update "My CTM Calls" link in the Links dropdown
        const ctmMyCallsLink = document.getElementById('ctm-my-calls-link');
        if (ctmMyCallsLink) {
            const ctmUserId = name && PEOPLE_DATA.CTM_USER_IDS ? PEOPLE_DATA.CTM_USER_IDS[name] : null;
            if (ctmUserId) {
                ctmMyCallsLink.href = `https://app.calltrackingmetrics.com/calls#multi_agents=${ctmUserId}`;
                ctmMyCallsLink.style.display = '';
            } else {
                ctmMyCallsLink.style.display = 'none';
            }
        }
    }

    // Initialize CTM toggle state from storage
    async function initCtmToggle() {
        if (!ctmToggle) return;

        try {
            const result = await chrome.storage.sync.get({
                ctm_enabled: false,
                ctm_csr: '',
                ctm_user: '',
                ctm_display_name: ''
            });
            ctmToggle.checked = result.ctm_enabled;
            const csrName = result.ctm_csr || result.ctm_display_name || result.ctm_user;
            if (result.ctm_enabled && csrName) {
                updateCtmAssignedRepDisplay(csrName);
            } else {
                // Even if CTM toggle is off, show the "My CTM Calls" link if we know who they are
                updateCtmAssignedRepDisplay(csrName || null);
            }
        } catch (e) {
            console.warn('Could not load CTM setting:', e);
            ctmToggle.checked = false;
            updateCtmAssignedRepDisplay(null);
        }
    }

    // Open CTM Calls page (and pin it) - ONLY the exact /calls URL should be pinned
    async function openCtmCallsPage() {
        const CTM_CALLS_URL = 'https://app.calltrackingmetrics.com/calls';

        try {
            // Find all CTM tabs
            const queryOpts = { url: '*://app.calltrackingmetrics.com/*' };
            if (window.__targetWindowId) queryOpts.windowId = window.__targetWindowId;
            const allCtmTabs = await chrome.tabs.query(queryOpts);

            let callsTab = null;

            // Check each CTM tab
            for (const tab of allCtmTabs) {
                // Check if this is the exact /calls URL (no query params, no subpaths)
                const url = new URL(tab.url);
                const isExactCallsUrl = url.pathname === '/calls' && !url.search;

                if (isExactCallsUrl) {
                    // This is the correct calls tab - pin it if not pinned
                    callsTab = tab;
                    if (!tab.pinned) {
                        await chrome.tabs.update(tab.id, { pinned: true });
                        console.log('[Popup] Pinned CTM /calls tab:', tab.id);
                    }
                } else if (tab.pinned) {
                    // This is a different CTM page that's pinned - unpin it
                    await chrome.tabs.update(tab.id, { pinned: false });
                    console.log('[Popup] Unpinned non-/calls CTM tab:', tab.id, tab.url);
                }
            }

            // If no /calls tab exists, create one
            if (!callsTab) {
                const createOpts = { url: CTM_CALLS_URL, active: false, pinned: true };
                if (window.__targetWindowId) createOpts.windowId = window.__targetWindowId;
                const newTab = await chrome.tabs.create(createOpts);
                console.log('[Popup] Created and pinned CTM /calls tab:', newTab.id);
            }
        } catch (err) {
            console.error('Could not open CTM tab:', err);
        }
    }

    // Handle CTM toggle change
    if (ctmToggle) {
        ctmToggle.addEventListener('change', async (e) => {
            const enabled = e.target.checked;

            if (enabled) {
                try {
                    const result = await chrome.storage.sync.get({ ctm_csr: '' });
                    if (!result.ctm_csr) {
                        e.target.checked = false;
                        showCtmCsrModal();
                        return;
                    }

                    await chrome.storage.sync.set({ ctm_enabled: true });
                    console.log('[Popup] CTM auto-search: enabled for', result.ctm_csr);
                    updateCtmAssignedRepDisplay(result.ctm_csr);
                    await openCtmCallsPage();
                } catch (err) {
                    console.error('Could not check/save CTM setting:', err);
                }
            } else {
                try {
                    await chrome.storage.sync.set({ ctm_enabled: false });
                    console.log('[Popup] CTM auto-search: disabled (CSR selection preserved)');
                    updateCtmAssignedRepDisplay(null);
                } catch (err) {
                    console.error('Could not save CTM setting:', err);
                }
            }
        });
    }

    // Handle CTM CSR confirmation
    if (ctmCsrConfirm) {
        ctmCsrConfirm.addEventListener('click', async () => {
            const selectedPerson = getSelectedCtmCallHandler();

            if (!selectedPerson) {
                const dropdowns = [ctmCsrSelect, ctmProductionSelect, ctmMgmtSelect, ctmInsuranceSelect];
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
                await chrome.storage.sync.set({
                    ctm_enabled: true,
                    ctm_csr: selectedPerson
                });
                console.log('[Popup] CTM enabled for:', selectedPerson);

                if (ctmToggle) {
                    ctmToggle.checked = true;
                }

                updateCtmAssignedRepDisplay(selectedPerson);
                hideCtmCsrModal();
                await openCtmCallsPage();
            } catch (err) {
                console.error('Could not save CTM CSR setting:', err);
            }
        });
    }

    // Handle CTM CSR cancel
    if (ctmCsrCancel) {
        ctmCsrCancel.addEventListener('click', () => {
            hideCtmCsrModal();
            if (ctmToggle) {
                ctmToggle.checked = false;
            }
        });
    }

    // Handle CTM modal close button
    if (closeCtmCsrModal) {
        closeCtmCsrModal.addEventListener('click', () => {
            hideCtmCsrModal();
            if (ctmToggle) {
                ctmToggle.checked = false;
            }
        });
    }

    // Close CTM modal on backdrop click
    if (ctmCsrModal) {
        ctmCsrModal.addEventListener('click', (e) => {
            if (e.target === ctmCsrModal) {
                hideCtmCsrModal();
                if (ctmToggle) {
                    ctmToggle.checked = false;
                }
            }
        });
    }

    // Initialize CTM toggle on load
    initCtmToggle();

    // ========================================
    // END CTM TOGGLE SECTION
    // ========================================

    // ========================================
    // TRANSCRIPT AUTO-GRAB STATUS LISTENER
    // ========================================
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'TRANSCRIPT_STATUS') {
            console.log('[Popup] Transcript status:', msg.status, msg.message);
            const statusColors = {
                polling: 'var(--warn)',
                found: 'var(--success)',
                sent: 'var(--success)',
                timeout: 'var(--danger)',
                error: 'var(--danger)'
            };
            if (toast) {
                toast.textContent = msg.message;
                toast.style.background = statusColors[msg.status] || '';
                toast.classList.add('show');
                // Keep polling messages visible longer
                const duration = msg.status === 'polling' ? 25000 : 4000;
                clearTimeout(window.__transcriptToastTimeout);
                window.__transcriptToastTimeout = setTimeout(() => {
                    toast.classList.remove('show');
                    toast.style.background = '';
                }, duration);
            }
        }
    });

    // ========================================
    // PHONE ICON - OPEN CONTACTS FOR ACTIVE CALLS
    // ========================================

    // Fetch active calls from CTM tabs in target window
    async function fetchActiveCalls() {
        const allCalls = [];

        // Query CTM tabs
        try {
            const ctmQueryOpts = { url: '*://app.calltrackingmetrics.com/*' };
            if (window.__targetWindowId) ctmQueryOpts.windowId = window.__targetWindowId;
            console.log('[Popup] Querying CTM tabs with:', JSON.stringify(ctmQueryOpts));
            const ctmTabs = await chrome.tabs.query(ctmQueryOpts);
            console.log('[Popup] Found CTM tabs:', ctmTabs.length, ctmTabs.map(t => ({ id: t.id, url: t.url })));

            // Only query one CTM tab (prefer the most recently active one)
            // Querying multiple tabs causes duplicate/stale counts
            const ctmTab = ctmTabs.find(t => t.active) || ctmTabs[0];
            if (ctmTab) {
                try {
                    console.log('[Popup] Sending GET_CTM_ACTIVE_CALLS to tab', ctmTab.id);
                    const response = await chrome.tabs.sendMessage(ctmTab.id, { type: 'GET_CTM_ACTIVE_CALLS' });
                    console.log('[Popup] CTM response from tab', ctmTab.id, ':', response);
                    if (response?.ok && response.calls) {
                        const ctmCalls = response.calls.map(c => ({ ...c, source: 'ctm' }));
                        allCalls.push(...ctmCalls);
                        console.log('[Popup] Added', ctmCalls.length, 'CTM calls to list');
                    }
                } catch (e) {
                    console.log('[Popup] Could not get CTM calls from tab', ctmTab.id, ':', e.message);
                }
            }
        } catch (e) {
            console.log('[Popup] Error querying CTM tabs:', e);
        }

        // Deduplicate by phone number (multiple tabs may report same calls)
        const seen = new Set();
        const uniqueCalls = allCalls.filter(call => {
            const key = call.phoneNumber;
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        if (uniqueCalls.length !== allCalls.length) {
            console.log('[Popup] Deduplicated calls:', allCalls.length, '->', uniqueCalls.length);
        }

        return uniqueCalls;
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

    // Track current active call phones (updated each poll cycle)
    // Accessible from address search to include phone in notes
    window.__activeCallPhones = [];

    // Poll for active calls and update badge
    async function pollActiveCalls() {
        try {
            const calls = await fetchActiveCalls();
            updateActiveCallsBadge(calls.length);

            // Store active call phones for use by address search
            window.__activeCallPhones = calls.map(c => c.phoneNumber).filter(Boolean);

            // If dropdown is open, update the list too
            if (activeCallsDropdown && activeCallsDropdown.style.display !== 'none') {
                updateActiveCallsList(calls);
            }
        } catch (e) {
            console.log('[Popup] Error polling active calls:', e);
        }
    }

    // Cache of Supabase lookup results: phone -> jobs[]
    const popupPhoneCache = new Map();

    // Update the dropdown list with calls
    function updateActiveCallsList(calls) {
        if (!activeCallsList) return;

        if (calls.length === 0) {
            activeCallsList.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--muted);">No active calls</div>';
            return;
        }

        activeCallsList.innerHTML = calls.map(call => {
            let transferDisplay = '';
            if (call.transferInfo) {
                if (call.transferInfo.transferFrom && call.transferInfo.transferTo) {
                    transferDisplay = `<div style="font-size: 11px; color: #f59e0b; margin-top: 2px; font-style: italic;">
                        Transfer: ${call.transferInfo.transferFrom} → ${call.transferInfo.transferTo}${call.transferInfo.transferTime ? ` @ ${call.transferInfo.transferTime}` : ''}
                    </div>`;
                } else if (call.transferInfo.transferTo) {
                    transferDisplay = `<div style="font-size: 11px; color: #f59e0b; margin-top: 2px; font-style: italic;">
                        Transferred to: ${call.transferInfo.transferTo}
                    </div>`;
                }
            }

            return `
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
                    ${transferDisplay}
                    <div class="roofr-job-links" style="margin-top: 4px;"></div>
                </div>
            `;
        }).join('');

        // Attach hover + click handlers, then check Supabase
        attachCallItemHandlers();
        enrichCallItemsWithSupabase(calls);
    }

    // Attach default hover/click handlers to call items
    function attachCallItemHandlers() {
        activeCallsList.querySelectorAll('.active-call-item').forEach(item => {
            item.addEventListener('mouseenter', () => {
                if (!item.dataset.roofrMatch) item.style.background = 'var(--hover)';
            });
            item.addEventListener('mouseleave', () => {
                if (!item.dataset.roofrMatch) item.style.background = '';
            });
            item.addEventListener('click', async (e) => {
                // If clicking a job link inside the item, don't also open contacts
                if (e.target.closest('.roofr-job-link')) return;

                const phone = item.dataset.phone;
                const formatted = item.dataset.formatted;
                const callerName = item.dataset.caller;

                // If this is a known customer with exactly 1 job, open the job card directly
                const jobUrl = item.dataset.jobUrl;
                if (jobUrl) {
                    hideActiveCallsDropdown();
                    chrome.tabs.create({ url: jobUrl, active: true });
                    return;
                }

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

    // Batch check active call phones against Supabase and apply green styling
    async function enrichCallItemsWithSupabase(calls) {
        if (calls.length === 0) return;

        // Collect phones that need checking
        const phonesToCheck = [];
        for (const call of calls) {
            let norm = (call.phoneNumber || '').replace(/\D/g, '');
            if (norm.length === 11 && norm.startsWith('1')) norm = norm.substring(1);
            if (norm.length === 10 && !popupPhoneCache.has(norm)) {
                phonesToCheck.push(norm);
            }
        }

        // Batch lookup uncached phones
        if (phonesToCheck.length > 0) {
            try {
                const response = await chrome.runtime.sendMessage({
                    type: 'BATCH_PHONE_LOOKUP',
                    phones: [...new Set(phonesToCheck)]
                });
                if (response?.ok && response.matches) {
                    for (const phone of phonesToCheck) {
                        popupPhoneCache.set(phone, response.matches[phone] || []);
                    }
                }
            } catch (err) {
                console.warn('[Popup] Supabase batch lookup error:', err);
            }
        }

        // Apply styling to each call item
        activeCallsList.querySelectorAll('.active-call-item').forEach(item => {
            let norm = (item.dataset.phone || '').replace(/\D/g, '');
            if (norm.length === 11 && norm.startsWith('1')) norm = norm.substring(1);

            const jobs = popupPhoneCache.get(norm);
            if (!jobs || jobs.length === 0) return;

            // Green background for existing customer
            item.style.background = 'rgba(34, 197, 94, 0.15)';
            item.style.borderLeft = '3px solid #22c55e';
            item.dataset.roofrMatch = 'true';

            // If single job, set jobUrl so clicking the whole row opens it
            if (jobs.length === 1) {
                item.dataset.jobUrl = jobs[0].jobUrl;
            }

            // Hover stays green
            item.addEventListener('mouseenter', () => {
                item.style.background = 'rgba(34, 197, 94, 0.25)';
            });
            item.addEventListener('mouseleave', () => {
                item.style.background = 'rgba(34, 197, 94, 0.15)';
            });

            // Render job link(s) inside the item
            const linksContainer = item.querySelector('.roofr-job-links');
            if (linksContainer) {
                linksContainer.innerHTML = jobs.map(job => `
                    <a class="roofr-job-link" href="#" data-url="${job.jobUrl}"
                       style="display: inline-block; font-size: 11px; color: #22c55e; font-weight: 600;
                              margin-right: 8px; text-decoration: none; cursor: pointer;"
                       title="${job.customer} — ${job.address}">
                        ${job.customer}${jobs.length > 1 ? ' →' : ''}
                    </a>
                `).join('');

                linksContainer.querySelectorAll('.roofr-job-link').forEach(link => {
                    link.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        chrome.tabs.create({ url: link.dataset.url, active: true });
                    });
                });
            }
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

            // Reuse the shared rendering function (handles Supabase enrichment too)
            updateActiveCallsList(calls);
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

// ── Auto-Dialer launcher button (appended) ──
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("open-dialer-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "AD_OPEN_WINDOW" }, () => {
      if (chrome.runtime.lastError) {
        console.warn("[Dialer launcher]", chrome.runtime.lastError.message);
      }
    });
  });
});

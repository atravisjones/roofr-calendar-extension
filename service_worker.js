

// service_worker.js

const SEED_DEFAULTS = {
    // No SCRIPT_URL needed for direct API access
    NEXT_SHEET_ID: "1cFFEZNl7wXt40riZHnuZxGc1Zfm5lTlOz0rDCWGZJ0g",
    AVAIL_RANGE_PHX: "I2:Q9",
    AVAIL_RANGE_NORTH: "I18:Q25",
    AVAIL_RANGE_SOUTH: "I10:Q17",

    // People Lists (Comma separated defaults)
    PEOPLE_REPS: "Christian Noren, Connor Hamby, Jonathan Marino, Josh Jewett, Justin Parker, London Smith, Orlando Chavarria, Richard Hadsall, Stephen Chaidez, Tanner Broadbent",
    PEOPLE_MGMT: "Andrew Clark, Anthony Bonomo, Bradley Crohurst, Brenda Ochoa, Yousef Ayad",
    PEOPLE_CSRS: "Bronté Pisz, Diva Shahpur, Layla Fairfield, Madi Meyers, Nica Javier, Travis Jones",
    PEOPLE_PRODUCTION: "Jayda Fairfield, Justin Saiz",

    // =====================
    // APPEARANCE SETTINGS
    // =====================
    theme: "light",
    compact_mode: false,
    show_color_indicators: true,
    show_icons: true,
    animate_transitions: true,

    // =====================
    // INTERFACE SETTINGS
    // =====================
    // Tab visibility defaults
    show_job_sorting: false,
    show_people: true,
    show_clipboard: true,  // Fixed: was false, now matches options.js default
    show_reports: false,   // Hidden by default (onInstalled re-seeds with `if (!current[key])`, so true here re-enabled it on every reload)
    // Interface behavior
    show_dock_note: true,
    default_tab: "scanner",
    show_week_navigation: true,
    show_date_picker: true,
    show_team_selector: true,
    show_refresh_button: true,
    auto_expand_days: false,  // Default to collapsed
    show_tab_badges: true,
    global_panel_mode: true,

    // =====================
    // SCANNER SETTINGS
    // =====================
    scanner_enabled: true,
    auto_scan_on_load: false,
    show_capacity_display: true,
    show_daily_totals: true,
    show_city_chips: true,
    show_region_filter: true,
    show_uncategorized_alerts: true,
    highlight_recommended_slots: true,
    show_out_of_sync_warning: true,
    show_availability_section: true,
    show_booked_count: true,
    show_available_count: true,
    show_overbooked_warning: true,

    // =====================
    // HOME SEARCH SETTINGS
    // =====================
    home_search_enabled: true,
    address_verification_enabled: true,
    show_recent_addresses: true,
    show_address_suggestions: true,
    auto_copy_verified_address: false,
    show_geocode_results: true,
    normalize_addresses: true,
    // Address search actions (Go button)
    search_google_earth: true,
    search_gemini: true,
    search_roofr: true,

    // =====================
    // PHONE SEARCH SETTINGS
    // =====================
    phone_search_enabled: true,
    auto_format_phone: true,
    show_phone_history: true,
    phone_search_auto_open: true,

    // =====================
    // CTM (CALLTRACKINGMETRICS) SETTINGS
    // =====================
    ctm_enabled: false,
    ctm_user: "",
    ctm_display_name: "",
    ctm_auto_search: true,
    ctm_show_notifications: true,
    ctm_show_active_calls: true,
    ctm_auto_open_calls_page: true,
    ctm_group_tabs: true,
    ctm_meet_automute: true,
    ctm_meet_mic_automute: true,
    ctm_meet_chime_pill: true,

    // =====================
    // JOB SORTING SETTINGS
    // =====================
    job_sorting_auto_load: false,
    job_sorting_show_unknown_roof: true,
    job_sorting_show_unknown_stories: true,
    job_sorting_show_residential: true,
    job_sorting_show_commercial: true,
    job_sorting_show_insurance: true,
    job_sorting_remember_filters: true,
    job_sorting_multi_select: true,

    // =====================
    // REPORTS SETTINGS
    // =====================
    reports_enabled: true,
    reports_calendar_enabled: true,
    reports_job_card_enabled: true,
    reports_batch_enabled: true,
    reports_auto_export: false,

    // =====================
    // PEOPLE SETTINGS
    // =====================
    people_show_reps: true,
    people_show_mgmt: true,
    people_show_csrs: true,
    people_show_production: true,
    people_clickable_names: true,
    people_show_counts: true,

    // =====================
    // CLIPBOARD SETTINGS
    // =====================
    clipboard_smart_formatting: true,
    clipboard_auto_format_paste: true,
    clipboard_show_day_copy: true,
    clipboard_show_week_copy: true,
    clipboard_preserve_formatting: true,

    // =====================
    // FIND/SEARCH SETTINGS
    // =====================
    find_enabled: true,
    find_highlight_enabled: true,
    find_case_sensitive: false,
    find_whole_word: false,
    find_regex_enabled: false,
    find_show_counter: true,
    find_show_navigation: true,

    // =====================
    // DATA & CITY SETTINGS
    // =====================
    dynamic_city_learning: true,
    city_whitelist_strict: false,
    show_learned_cities: true,
    auto_categorize_jobs: true
};

const PREFS_KEY = 'roofr_user_prefs';
const ROOFR_DOMAIN = "app.roofr.com";
const ROOFR_CONTACTS_URL = "https://app.roofr.com/dashboard/team/239329/contacts";
const ROOFR_TEAM_ID = "239329";
const ROOFR_API_BASE = "https://app.roofr.com/api";

// Supabase (roofr-search) — public read-only, no auth cookies needed
const SUPABASE_URL = "https://ucfqgkbkxbztxlyniuph.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjZnFna2JreGJ6dHhseW5pdXBoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjI1ODQsImV4cCI6MjA4OTkzODU4NH0.iIRHU4pxcVSMiWAcjtMgUsAVfwRnl90zg4Zkg0Fe4a0";

// CTM (CallTrackingMetrics) Constants
const CTM_URL = "https://app.calltrackingmetrics.com/calls";
const CTM_CALLS_BASE = "https://app.calltrackingmetrics.com";
const CTM_CHECK_ALARM = "ctm_calls_page_check";
const CTM_CHECK_INTERVAL_MINUTES = 10;


// ========================================
// AUTO-UPDATE CONFIGURATION
// ========================================
const UPDATE_CHECK_URL = "https://raw.githubusercontent.com/atravisjones/roofr-calendar-extension/main/update/manifest.json";
const UPDATE_CHECK_ALARM = "update_check_alarm";
const UPDATE_CHECK_INTERVAL_HOURS = 12;
const LAST_UPDATE_CHECK_KEY = "last_update_check";
const DISMISSED_VERSION_KEY = "dismissed_update_version";
const UPDATE_AVAILABLE_KEY = "update_available";

// Get current extension version from manifest
function getCurrentVersion() {
    return chrome.runtime.getManifest().version;
}

// Compare semantic versions: returns 1 if a > b, -1 if a < b, 0 if equal
function compareVersions(a, b) {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const numA = partsA[i] || 0;
        const numB = partsB[i] || 0;
        if (numA > numB) return 1;
        if (numA < numB) return -1;
    }
    return 0;
}

// Check for updates from GitHub
async function checkForUpdates(force = false) {
    try {
        // Check if we recently checked (unless forced)
        if (!force) {
            const data = await chrome.storage.local.get([LAST_UPDATE_CHECK_KEY]);
            const lastCheck = data[LAST_UPDATE_CHECK_KEY] || 0;
            const hoursSinceCheck = (Date.now() - lastCheck) / (1000 * 60 * 60);

            if (hoursSinceCheck < 1) {
                console.log('[Update] Skipping check - checked recently');
                return null;
            }
        }

        // Fetch update manifest from GitHub
        const response = await fetch(UPDATE_CHECK_URL, {
            cache: 'no-store',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const updateInfo = await response.json();
        const currentVersion = getCurrentVersion();

        // Save check timestamp
        await chrome.storage.local.set({
            [LAST_UPDATE_CHECK_KEY]: Date.now()
        });

        // Check if update is available
        if (compareVersions(updateInfo.version, currentVersion) > 0) {
            // Check if user dismissed this specific version
            const dismissedData = await chrome.storage.local.get([DISMISSED_VERSION_KEY]);
            const dismissedVersion = dismissedData[DISMISSED_VERSION_KEY];

            if (dismissedVersion === updateInfo.version && !force) {
                console.log('[Update] Version', updateInfo.version, 'was dismissed');
                return null;
            }

            // Store update info
            const updateData = {
                available: true,
                currentVersion,
                newVersion: updateInfo.version,
                changelog: updateInfo.changelog || [],
                downloadUrl: updateInfo.download_url,
                releaseNotesUrl: updateInfo.release_notes_url,
                checkedAt: Date.now()
            };

            await chrome.storage.local.set({ [UPDATE_AVAILABLE_KEY]: updateData });

            // No badge — the extension auto-updates via the managed update_url,
            // so the orange "!" update indicator is redundant. Clear any stale one.
            await chrome.action.setBadgeText({ text: '' });

            console.log('[Update] New version available:', updateInfo.version);
            return updateData;
        } else {
            // Clear any existing update notification
            await chrome.storage.local.remove([UPDATE_AVAILABLE_KEY]);
            await chrome.action.setBadgeText({ text: '' });

            console.log('[Update] Extension is up to date:', currentVersion);
            return null;
        }
    } catch (error) {
        console.error('[Update] Check failed:', error);
        return null;
    }
}

// Start periodic update checking
async function startUpdateCheckAlarm() {
    try {
        await chrome.alarms.clear(UPDATE_CHECK_ALARM);
        await chrome.alarms.create(UPDATE_CHECK_ALARM, {
            periodInMinutes: UPDATE_CHECK_INTERVAL_HOURS * 60
        });
        console.log('[Update] Started periodic update checks (every', UPDATE_CHECK_INTERVAL_HOURS, 'hours)');
    } catch (e) {
        console.error('[Update] Failed to create alarm:', e);
    }
}

// Dismiss update notification for a specific version
async function dismissUpdateNotification(version) {
    await chrome.storage.local.set({ [DISMISSED_VERSION_KEY]: version });
    await chrome.storage.local.remove([UPDATE_AVAILABLE_KEY]);
    await chrome.action.setBadgeText({ text: '' });
    console.log('[Update] Dismissed notification for version:', version);
}

chrome.runtime.onInstalled.addListener(async () => {
    // 1) Seed defaults if they don't exist
    try {
        const current = await chrome.storage.sync.get(Object.keys(SEED_DEFAULTS));
        const toSet = {};
        for (const key in SEED_DEFAULTS) {
            if (!current[key]) {
                toSet[key] = SEED_DEFAULTS[key];
            }
        }
        if (Object.keys(toSet).length > 0) {
            await chrome.storage.sync.set(toSet);
            console.log("Seeded default settings:", toSet);
        }
    } catch (e) {
        console.warn("Seed defaults error:", e);
    }

    // 2) Configure side panel behavior
    try {
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (e) {
        console.warn("setPanelBehavior failed:", e);
    }

    // 3) Initial Side Panel Configuration
    // We default to global enablement, but user preferences will override this on subsequent updates/messages
    try {
        await chrome.sidePanel.setOptions({
            path: "popup.html",
            enabled: true
        });
    } catch (e) {
        console.warn("setOptions failed:", e);
    }

    // 4) Start update checking
    await startUpdateCheckAlarm();
    // Check for updates after a short delay to not slow down install
    setTimeout(() => checkForUpdates(true), 5000);

    // 5) Re-arm CTM tabs that were ALREADY open. Manifest content scripts only
    // inject on page load, so a fresh install/update leaves a long-lived
    // softphone tab bridge-less (or with an orphaned pre-update bridge whose
    // chrome.runtime is dead) until the rep clicks into it — meanwhile call
    // events silently stop, so Meet auto-mute/chime never fire. Found
    // 2026-07-15: Travis's softphone tab predated his install; "still no pill".
    try {
        const ctmTabs = await chrome.tabs.query({ url: '*://*.calltrackingmetrics.com/*' });
        for (const t of ctmTabs) {
            _lastInjectAt.delete(t.id);
            injectDialerBridge(t.id);
        }
        if (ctmTabs.length) console.log('[AutoDialer-SW] onInstalled: re-armed', ctmTabs.length, 'CTM tab(s)');
    } catch (e) {
        console.warn('onInstalled CTM re-arm failed:', e.message);
    }
});

// Listen for changes in URL to toggle side panel if in "Roofr Only" mode
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!tab.url) return;

    const data = await chrome.storage.local.get(PREFS_KEY);
    const prefs = data[PREFS_KEY] || { globalPanel: true }; // Default to true

    if (!prefs.globalPanel) {
        // Roofr Only Mode
        const isRoofr = tab.url.includes(ROOFR_DOMAIN);
        if (isRoofr) {
            await chrome.sidePanel.setOptions({
                tabId,
                path: 'popup.html',
                enabled: true
            });
        } else {
            // Disable on other tabs
            await chrome.sidePanel.setOptions({
                tabId,
                enabled: false
            });
        }
    }
});

// Listen for preference updates from popup.js and CTM incoming calls
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Open a Roofr URL in a BACKGROUND tab (Roofr "open in new tab" feature, so middle-click /
    // Ctrl+Cmd-click never steals focus). URL is validated to app.roofr.com for safety.
    if (msg.type === "ROOFR_OPEN_BG_TAB" && typeof msg.url === "string" && /^https:\/\/app\.roofr\.com\//.test(msg.url)) {
        const opts = { url: msg.url, active: false };
        if (sender.tab && sender.tab.windowId !== undefined) opts.windowId = sender.tab.windowId;
        chrome.tabs.create(opts);
        return; // fire-and-forget
    }

    // Open a Roofr job-card ATTACHMENT (PDF/image) in a BACKGROUND tab. The raw file URL is an
    // S3 presigned link with content-disposition=attachment baked into the signature, so it
    // force-downloads instead of rendering. For viewable types we open the bundled viewer page
    // (attachment-viewer.html), which fetches the bytes (extension has S3 host permission ->
    // CORS-exempt) and re-serves them inline. Non-viewable types just open the URL (download).
    if (msg.type === "ROOFR_OPEN_ATTACHMENT" && typeof msg.url === "string") {
        let host = "";
        try { host = new URL(msg.url).host; } catch (e) { return; }
        const ALLOWED = ["roofr-storage-private.s3.amazonaws.com", "ik.imagekit.io"];
        if (!ALLOWED.includes(host)) return;
        const ext = (msg.ext || "").toLowerCase();
        const VIEWABLE = ["pdf", "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic", "heif"];
        let target;
        if (VIEWABLE.includes(ext)) {
            target = chrome.runtime.getURL("attachment-viewer.html")
                + "?u=" + encodeURIComponent(msg.url)
                + "&t=" + encodeURIComponent(ext)
                + "&n=" + encodeURIComponent(msg.name || "");
        } else {
            target = msg.url; // not inline-viewable -> let the browser download it (background tab)
        }
        const opts = { url: target, active: false };
        if (sender.tab && sender.tab.windowId !== undefined) opts.windowId = sender.tab.windowId;
        chrome.tabs.create(opts);
        return; // fire-and-forget
    }

    // Open contacts page and search for a specific phone number (triggered from popup UI)
    if (msg.type === "OPEN_CONTACTS_FOR_PHONE") {
        // Pass true to skip enabled check since this is a manual user action
        // Pass caller name for tab group title and windowId for window isolation
        // Use sender's tab windowId if message came from content script, otherwise use msg.windowId
        const windowId = msg.windowId || (sender.tab ? sender.tab.windowId : null);
        handleCtmIncomingCall(msg.phoneNumber, msg.formattedPhone, true, msg.callerName, windowId)
            .then(result => {
                sendResponse({ ok: true, result });
            })
            .catch(err => {
                sendResponse({ ok: false, error: err.message });
            });
        return true; // Async response
    }

    if (msg.type === "UPDATE_PANEL_BEHAVIOR") {
        (async () => {
            const isGlobal = msg.global;

            if (isGlobal) {
                // Enable globally
                await chrome.sidePanel.setOptions({
                    path: "popup.html",
                    enabled: true
                });
            } else {
                // Disable globally first, then enable only for current tab if it matches
                await chrome.sidePanel.setOptions({
                    enabled: false
                });

                // Check current active tabs to re-enable if they are Roofr
                const tabs = await chrome.tabs.query({ url: `*://${ROOFR_DOMAIN}/*` });
                for (const tab of tabs) {
                    if (tab.id) {
                        await chrome.sidePanel.setOptions({
                            tabId: tab.id,
                            path: "popup.html",
                            enabled: true
                        });
                    }
                }
            }
        })();
        return false;
    }

    // =====================================================
    // CTM (CALLTRACKINGMETRICS) MESSAGE HANDLERS
    // =====================================================

    // Handle incoming CTM call
    if (msg.type === "CTM_INCOMING_CALL") {
        const windowId = msg.windowId || (sender.tab ? sender.tab.windowId : null);
        handleCtmIncomingCall(
            msg.phoneNumber,
            msg.formattedPhone,
            false,                          // skipEnabledCheck
            msg.callerName,
            windowId,
            msg.agentName || null,          // agentName
            msg.isAnswered || false,        // isAnswered
            msg.isOutbound || false         // isOutbound — no auto job-card on outbound
        )
            .then(result => {
                console.log('[Service Worker] CTM call handled:', result);
            })
            .catch(err => {
                console.error('[Service Worker] Error handling CTM call:', err);
            });
        return false;
    }

    // Clear tracking for a specific phone number when CTM call ends
    if (msg.type === "CTM_CALL_ENDED") {
        if (msg.phoneNumber) {
            openedCtmCallPhones.delete(msg.phoneNumber);
            console.log('[Service Worker] Cleared CTM tracking for ended call:', msg.phoneNumber);
        }
        return false;
    }

    // Clear all CTM tracking when CTM page loads/refreshes
    if (msg.type === "CTM_PAGE_LOADED") {
        openedCtmCallPhones.clear();
        console.log('[Service Worker] CTM page loaded, cleared all CTM call tracking');
        return false;
    }

    // Batch phone lookup — check which phones exist in Supabase
    if (msg.type === "BATCH_PHONE_LOOKUP") {
        (async () => {
            try {
                const phones = msg.phones || [];
                if (phones.length === 0) {
                    sendResponse({ ok: true, matches: {} });
                    return;
                }

                // Normalize all phones to 10 digits
                const normalized = phones.map(p => {
                    let n = p.replace(/\D/g, '');
                    if (n.length === 11 && n.startsWith('1')) n = n.substring(1);
                    return n.length === 10 ? n : null;
                }).filter(Boolean);

                if (normalized.length === 0) {
                    sendResponse({ ok: true, matches: {} });
                    return;
                }

                // Supabase IN query: phone=in.(num1,num2,num3)
                const inList = normalized.join(',');
                const url = `${SUPABASE_URL}/rest/v1/jobs?phone=in.(${inList})&select=job_id,customer,address,phone&order=created_at.desc`;

                const resp = await fetch(url, {
                    headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Accept': 'application/json'
                    }
                });

                if (!resp.ok) {
                    console.log('[Service Worker] Batch lookup HTTP error:', resp.status);
                    sendResponse({ ok: false, error: `HTTP ${resp.status}` });
                    return;
                }

                const jobs = await resp.json();

                // Group by phone — most recent job first (already ordered by created_at desc)
                const matches = {};
                for (const job of jobs) {
                    if (!job.phone) continue;
                    if (!matches[job.phone]) {
                        matches[job.phone] = [];
                    }
                    matches[job.phone].push({
                        job_id: job.job_id,
                        customer: job.customer || 'Unknown',
                        address: job.address || '',
                        jobUrl: `https://app.roofr.com/dashboard/team/${ROOFR_TEAM_ID}/jobs/details/${job.job_id}`
                    });
                }

                console.log('[Service Worker] Batch lookup:', normalized.length, 'phones →', Object.keys(matches).length, 'matched');
                sendResponse({ ok: true, matches });
            } catch (err) {
                console.error('[Service Worker] Batch lookup error:', err);
                sendResponse({ ok: false, error: err.message });
            }
        })();
        return true; // Async response
    }

    // Open a specific job card directly (from job matches dropdown)
    if (msg.type === "OPEN_JOB_DIRECT") {
        (async () => {
            try {
                const jobUrl = msg.jobUrl;
                const customerName = msg.customerName || 'Unknown';
                const senderWindowId = msg.windowId || (sender.tab ? sender.tab.windowId : null);

                console.log('[Service Worker] Opening job directly:', jobUrl);

                // Find CTM tab to position next to
                const ctmQueryOpts = { url: '*://app.calltrackingmetrics.com/*' };
                if (senderWindowId) ctmQueryOpts.windowId = senderWindowId;
                const ctmTabs = await chrome.tabs.query(ctmQueryOpts);

                let ctmTabIndex = -1;
                let ctmWindowId = null;
                if (ctmTabs.length > 0) {
                    ctmTabIndex = ctmTabs[0].index;
                    ctmWindowId = ctmTabs[0].windowId;
                }

                // Find existing Roofr tab to reuse, or create new
                const roofrQueryOpts = { url: '*://app.roofr.com/*' };
                if (senderWindowId) roofrQueryOpts.windowId = senderWindowId;
                else if (ctmWindowId) roofrQueryOpts.windowId = ctmWindowId;
                const roofrTabs = await chrome.tabs.query(roofrQueryOpts);

                const reusableTab = roofrTabs.find(tab => tab.url && (tab.url.includes('/contacts') || tab.url.includes('/jobs/')));

                let targetTab;
                if (reusableTab) {
                    targetTab = reusableTab;
                    await chrome.tabs.update(targetTab.id, { url: jobUrl, active: true });
                    await chrome.windows.update(targetTab.windowId, { focused: true });
                    if (ctmTabIndex >= 0 && targetTab.index !== ctmTabIndex + 1) {
                        await chrome.tabs.move(targetTab.id, { index: ctmTabIndex + 1 });
                    }
                } else {
                    const createOptions = { url: jobUrl, active: true };
                    if (ctmTabIndex >= 0) createOptions.index = ctmTabIndex + 1;
                    if (senderWindowId) createOptions.windowId = senderWindowId;
                    else if (ctmWindowId) createOptions.windowId = ctmWindowId;
                    targetTab = await chrome.tabs.create(createOptions);
                }

                // Tab group with customer name
                const groupTabsSetting = await chrome.storage.sync.get({ ctm_group_tabs: true });
                if (customerName && groupTabsSetting.ctm_group_tabs !== false) {
                    try {
                        const displayName = getDisplayName(customerName);
                        await waitForTabLoad(targetTab.id);
                        const tabInfo = await chrome.tabs.get(targetTab.id);

                        if (tabInfo.groupId && tabInfo.groupId !== -1) {
                            await chrome.tabGroups.update(tabInfo.groupId, {
                                title: displayName,
                                color: 'cyan'
                            });
                        } else {
                            const groupId = await chrome.tabs.group({ tabIds: [targetTab.id] });
                            await chrome.tabGroups.update(groupId, {
                                title: displayName,
                                color: 'cyan',
                                collapsed: false
                            });
                        }
                    } catch (groupError) {
                        console.warn('[Service Worker] Tab group error:', groupError);
                    }
                }

                console.log('[Service Worker] Job opened:', jobUrl);
            } catch (e) {
                console.error('[Service Worker] Error opening job:', e);
            }
        })();
        return false;
    }

    // Open CTM tab if requested or not already open
    if (msg.type === "OPEN_CTM") {
        (async () => {
            try {
                const queryOpts = { url: '*://app.calltrackingmetrics.com/*' };
                if (msg.windowId) queryOpts.windowId = msg.windowId;
                const ctmTabs = await chrome.tabs.query(queryOpts);
                if (ctmTabs.length > 0) {
                    await chrome.tabs.update(ctmTabs[0].id, { active: true });
                    await chrome.windows.update(ctmTabs[0].windowId, { focused: true });
                    console.log('[Service Worker] Focused existing CTM tab');
                } else {
                    const createOpts = { url: CTM_URL, active: true };
                    if (msg.windowId) createOpts.windowId = msg.windowId;
                    await chrome.tabs.create(createOpts);
                    console.log('[Service Worker] Opened new CTM tab');
                }
            } catch (e) {
                console.error('[Service Worker] Error opening CTM:', e);
            }
        })();
        return false;
    }

    // Check if CTM is enabled
    if (msg.type === "CHECK_CTM_ENABLED") {
        (async () => {
            try {
                const settings = await chrome.storage.sync.get({ ctm_enabled: false });
                sendResponse({ enabled: settings.ctm_enabled });
            } catch (e) {
                sendResponse({ enabled: false });
            }
        })();
        return true;
    }

    // Get CTM settings for content script
    if (msg.type === "GET_CTM_SETTINGS") {
        (async () => {
            try {
                const rawSettings = await chrome.storage.sync.get({
                    ctm_enabled: false,
                    ctm_csr: '',
                    ctm_user: '',
                    ctm_display_name: '',
                    // New CTM settings
                    ctm_auto_search: true,
                    ctm_show_notifications: true,
                    ctm_show_active_calls: true,
                    ctm_group_tabs: true
                });
                const primaryCsr = rawSettings.ctm_csr || rawSettings.ctm_display_name || rawSettings.ctm_user;
                const settings = {
                    ctm_enabled: rawSettings.ctm_enabled,
                    ctm_csr: primaryCsr,
                    ctm_user: rawSettings.ctm_user,
                    ctm_display_name: rawSettings.ctm_display_name,
                    // New CTM settings
                    ctm_auto_search: rawSettings.ctm_auto_search,
                    ctm_show_notifications: rawSettings.ctm_show_notifications,
                    ctm_show_active_calls: rawSettings.ctm_show_active_calls,
                    ctm_group_tabs: rawSettings.ctm_group_tabs
                };
                console.log('[Service Worker] CTM settings:', settings);
                sendResponse({ success: true, settings });
            } catch (e) {
                sendResponse({
                    success: false,
                    settings: { ctm_enabled: false, ctm_csr: '', ctm_user: '', ctm_display_name: '', ctm_auto_search: true, ctm_show_notifications: true, ctm_show_active_calls: true, ctm_group_tabs: true }
                });
            }
        })();
        return true;
    }

    // Set auto scan pending flag in session storage (content scripts can't access storage directly in MV3)
    if (msg.type === "SET_AUTO_SCAN_PENDING") {
        (async () => {
            try {
                await chrome.storage.session.set({ autoScanPending: true, autoScanTimestamp: Date.now() });
                sendResponse({ success: true });
            } catch (e) {
                console.warn('[Service Worker] Error setting autoScanPending:', e);
                sendResponse({ success: false });
            }
        })();
        return true; // Async response
    }

    // ========================================
    // AUTO-UPDATE MESSAGE HANDLERS
    // ========================================

    // Check for updates (manual trigger from UI)
    if (msg.type === "CHECK_FOR_UPDATES") {
        checkForUpdates(true).then(result => {
            sendResponse({ success: true, update: result });
        }).catch(err => {
            sendResponse({ success: false, error: err.message });
        });
        return true; // Async response
    }

    // Get current update status
    if (msg.type === "GET_UPDATE_STATUS") {
        chrome.storage.local.get([UPDATE_AVAILABLE_KEY]).then(data => {
            sendResponse({ update: data[UPDATE_AVAILABLE_KEY] || null });
        });
        return true; // Async response
    }

    // Dismiss update notification
    if (msg.type === "DISMISS_UPDATE") {
        dismissUpdateNotification(msg.version).then(() => {
            sendResponse({ success: true });
        });
        return true; // Async response
    }

    // Get current extension version
    if (msg.type === "GET_EXTENSION_VERSION") {
        sendResponse({ version: getCurrentVersion() });
        return false;
    }
});

// Track which phone numbers have already been opened (prevents duplicate opens)
const openedCtmCallPhones = new Set();   // CTM tracking

// Clear opened calls tracking after 30 minutes (in case of long sessions)
setInterval(() => {
    openedCtmCallPhones.clear();
    console.log('[Service Worker] Cleared opened calls tracking (CTM)');
}, 30 * 60 * 1000);

// Helper function to wait for a tab to finish loading
function waitForTabLoad(tabId, timeout = 10000) {
    return new Promise((resolve) => {
        const listener = (updatedTabId, info) => {
            if (updatedTabId === tabId && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };
        chrome.tabs.onUpdated.addListener(listener);

        // Timeout after specified time
        setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        }, timeout);
    });
}

// ========================================
// CTM INCOMING CALL HANDLER
// ========================================

// Helper to get display name (first name only, unless generic like "Wireless Caller")
function getDisplayName(fullName) {
    if (!fullName) return 'Unknown';
    // Global identity normalization — Madison was migrated to Madi.
    // Catch any upstream/CTM source that still emits "Madison" or "Maddison".
    const normalized = fullName.replace(/\bMad(d)?ison\b/gi, 'Madi');
    const parts = normalized.trim().split(' ');
    // Keep full name for generic names (wireless caller, unknown caller, etc.)
    const lowerName = normalized.toLowerCase();
    if (lowerName.includes('wireless') || lowerName.includes('unknown') ||
        lowerName.includes('caller') || lowerName.includes('private') ||
        lowerName.includes('blocked') || lowerName.includes('anonymous')) {
        return normalized;  // Keep full "Wireless Caller"
    }
    return parts[0];  // Just first name "Andrew"
}

// Helper to update tab group title when call state changes
async function updateCtmTabGroup(phoneNumber, callerName, agentName, isAnswered, targetWindowId) {
    try {
        // Check if tab grouping is enabled
        const groupTabsSetting = await chrome.storage.sync.get({ ctm_group_tabs: true });
        if (groupTabsSetting.ctm_group_tabs === false) {
            console.log('[Service Worker] Tab grouping disabled, skipping update');
            return;
        }

        // Find the Roofr contacts tab
        const roofrQueryOpts = { url: '*://app.roofr.com/*' };
        if (targetWindowId) roofrQueryOpts.windowId = targetWindowId;
        const roofrTabs = await chrome.tabs.query(roofrQueryOpts);

        // Find tabs in groups
        for (const tab of roofrTabs) {
            if (tab.groupId && tab.groupId !== -1) {
                const group = await chrome.tabGroups.get(tab.groupId);
                // Check if this group is for our call (contains caller name)
                const displayName = getDisplayName(callerName);
                if (group.title && callerName && group.title.includes(displayName)) {
                    // Just use caller first name, no agent name needed
                    await chrome.tabGroups.update(tab.groupId, {
                        title: displayName,
                        color: isAnswered ? 'cyan' : 'yellow'
                    });
                    console.log('[Service Worker] Updated tab group to:', displayName);
                    return;
                }
            }
        }
        console.log('[Service Worker] No matching tab group found to update');
    } catch (err) {
        console.warn('[Service Worker] Error updating tab group:', err);
    }
}

// ========================================
// SUPABASE PHONE LOOKUP
// ========================================

// Look up Roofr jobs by phone number using the Supabase database
// No Roofr tab required — queries Supabase directly via REST API
// Returns { found: true, jobs: [...] } or { found: false }
async function lookupJobByPhoneSupabase(phoneNumber) {
    try {
        let searchPhone = phoneNumber.replace(/\D/g, '');
        if (searchPhone.length === 11 && searchPhone.startsWith('1')) {
            searchPhone = searchPhone.substring(1);
        }
        if (searchPhone.length !== 10) {
            console.log('[Supabase] Invalid phone length after normalization:', searchPhone.length);
            return { found: false };
        }

        console.log('[Supabase] Looking up phone:', searchPhone);

        const headers = {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Accept': 'application/json'
        };

        // Query Supabase jobs table — exact match first
        const url = `${SUPABASE_URL}/rest/v1/jobs?phone=eq.${searchPhone}&select=job_id,customer,address,stage,status,value&limit=10&order=created_at.desc`;
        const resp = await fetch(url, { headers });

        let matchedJobs = [];

        if (resp.ok) {
            const jobs = await resp.json();
            if (jobs && jobs.length > 0) {
                matchedJobs = jobs;
            }
        } else {
            console.log('[Supabase] HTTP error on exact match:', resp.status);
        }

        // If no exact match, try partial match (phone stored with formatting)
        if (matchedJobs.length === 0) {
            const likeUrl = `${SUPABASE_URL}/rest/v1/jobs?phone=like.*${searchPhone}*&select=job_id,customer,address,stage,status,value&limit=10&order=created_at.desc`;
            const likeResp = await fetch(likeUrl, { headers });

            if (likeResp.ok) {
                const likeJobs = await likeResp.json();
                if (likeJobs && likeJobs.length > 0) {
                    matchedJobs = likeJobs;
                    console.log('[Supabase] LIKE match found:', likeJobs.length, 'jobs');
                }
            }
        }

        if (matchedJobs.length === 0) {
            console.log('[Supabase] No jobs found for phone:', searchPhone);
            return { found: false };
        }

        // Enrich each job with its Roofr URL
        const enriched = matchedJobs.map(job => ({
            job_id: job.job_id,
            customer: job.customer || 'Unknown',
            address: job.address || '',
            stage: job.stage || '',
            status: job.status || '',
            value: job.value || '',
            jobUrl: `https://app.roofr.com/dashboard/team/${ROOFR_TEAM_ID}/jobs/details/${job.job_id}`
        }));

        console.log('[Supabase] Found', enriched.length, 'job(s) for phone:', searchPhone);
        return {
            found: true,
            jobs: enriched
        };
    } catch (err) {
        console.error('[Supabase] Phone lookup failed:', err.message);
        return { found: false };
    }
}

// Handle incoming CTM calls - opens/focuses Roofr contacts and searches for phone number
async function handleCtmIncomingCall(phoneNumber, formattedPhone, skipEnabledCheck = false, callerName = null, targetWindowId = null, agentName = null, isAnswered = false, isOutbound = false) {
    console.log('[Service Worker] Handling incoming CTM call:', {
        phone: phoneNumber,
        caller: callerName,
        agent: agentName,
        isAnswered: isAnswered,
        isOutbound: isOutbound,
        manual: skipEnabledCheck
    });

    // FIRST: Check if contact is already open in browser (most reliable check)
    // This runs before memory-based checks in case the tracking set was cleared
    if (!skipEnabledCheck && callerName) {
        try {
            const displayName = getDisplayName(callerName);
            const roofrTabs = await chrome.tabs.query({ url: '*://app.roofr.com/*' });

            for (const tab of roofrTabs) {
                if (tab.groupId && tab.groupId !== -1) {
                    try {
                        const group = await chrome.tabGroups.get(tab.groupId);
                        if (group.title && group.title === displayName) {
                            // Contact is already open - just focus the tab
                            console.log('[Service Worker] Contact already open in browser for:', displayName);
                            await chrome.tabs.update(tab.id, { active: true });
                            await chrome.windows.update(tab.windowId, { focused: true });
                            // Make sure phone is tracked
                            openedCtmCallPhones.add(phoneNumber);
                            return { ok: true, reason: 'contact_already_open', tabId: tab.id };
                        }
                    } catch (e) {
                        // Tab group might not exist
                    }
                }
            }
        } catch (e) {
            console.warn('[Service Worker] Error checking for open contact:', e);
        }
    }

    // Check if we've already opened this phone number (memory-based backup)
    const alreadyOpened = openedCtmCallPhones.has(phoneNumber);
    if (!skipEnabledCheck && alreadyOpened) {
        console.log('[Service Worker] Already opened contact for this CTM call (from tracking)');
        // Still update the tab group if call state changed (e.g., answered)
        if (isAnswered && agentName) {
            console.log('[Service Worker] Updating tab group for answered call');
            await updateCtmTabGroup(phoneNumber, callerName, agentName, isAnswered, targetWindowId);
        }

        // Auto-open job card when call is answered by the rep — INBOUND only:
        // on an outbound call the rep chose who to dial and is usually already
        // on the job card; popping another tab mid-call is disruptive.
        if (isAnswered && !isOutbound) {
            try {
                const autoSearchSetting = await chrome.storage.sync.get({ ctm_auto_search: true });
                if (autoSearchSetting.ctm_auto_search) {
                    console.log('[Service Worker] Answered call - looking up phone in Supabase:', phoneNumber);
                    const lookup = await lookupJobByPhoneSupabase(phoneNumber);
                    if (lookup.found && lookup.jobs.length > 0) {
                        const job = lookup.jobs[0];
                        console.log('[Service Worker] Found job - auto-opening:', job.customer, job.jobUrl);

                        const ctmQueryOpts = { url: '*://app.calltrackingmetrics.com/*' };
                        if (targetWindowId) ctmQueryOpts.windowId = targetWindowId;
                        const ctmTabs = await chrome.tabs.query(ctmQueryOpts);

                        const createOpts = { url: job.jobUrl, active: true };
                        if (ctmTabs.length > 0) {
                            createOpts.windowId = ctmTabs[0].windowId;
                            createOpts.index = ctmTabs[0].index + 1;
                        }
                        const newTab = await chrome.tabs.create(createOpts);

                        // Group tabs if enabled
                        const groupSetting = await chrome.storage.sync.get({ ctm_group_tabs: true });
                        if (groupSetting.ctm_group_tabs && ctmTabs.length > 0) {
                            try {
                                const displayName = getDisplayName(callerName);
                                const groupId = await chrome.tabs.group({
                                    tabIds: [ctmTabs[0].id, newTab.id],
                                    ...(ctmTabs[0].windowId ? { createProperties: { windowId: ctmTabs[0].windowId } } : {})
                                });
                                await chrome.tabGroups.update(groupId, {
                                    title: displayName || 'Call',
                                    color: 'cyan',
                                    collapsed: false
                                });
                            } catch (groupErr) {
                                console.warn('[Service Worker] Tab grouping failed:', groupErr);
                            }
                        }

                        return { ok: true, reason: 'job_card_opened', jobId: job.job_id, tabId: newTab.id };
                    } else {
                        console.log('[Service Worker] No job found for phone:', phoneNumber);
                    }
                }
            } catch (lookupErr) {
                console.warn('[Service Worker] Auto-open job card failed:', lookupErr);
            }
        }

        return { ok: true, reason: 'already_opened' };
    }

    // Check if CTM integration is enabled
    if (!skipEnabledCheck) {
        try {
            const settings = await chrome.storage.sync.get({ ctm_enabled: false });
            if (!settings.ctm_enabled) {
                console.log('[Service Worker] CTM integration is disabled, skipping');
                return { ok: false, reason: 'disabled' };
            }
        } catch (e) {
            console.log('[Service Worker] Could not check CTM settings, assuming disabled');
            return { ok: false, reason: 'settings_error' };
        }
    }

    // Mark this phone as opened
    openedCtmCallPhones.add(phoneNumber);

    try {
        // Find the CTM tab to position the Roofr tab next to it
        const ctmQueryOpts = { url: '*://app.calltrackingmetrics.com/*' };
        if (targetWindowId) ctmQueryOpts.windowId = targetWindowId;
        const ctmTabs = await chrome.tabs.query(ctmQueryOpts);

        let ctmTabIndex = -1;
        let ctmWindowId = null;
        if (ctmTabs.length > 0) {
            ctmTabIndex = ctmTabs[0].index;
            ctmWindowId = ctmTabs[0].windowId;
            console.log('[Service Worker] Found CTM tab at index:', ctmTabIndex);
        }

        // Auto-open job card when call is answered and phone is in Supabase —
        // INBOUND only (see comment on the alreadyOpened path above).
        if (isAnswered && !isOutbound) {
            try {
                const autoSearchSetting = await chrome.storage.sync.get({ ctm_auto_search: true });
                if (autoSearchSetting.ctm_auto_search) {
                    console.log('[Service Worker] Answered call - looking up phone in Supabase:', phoneNumber);
                    const lookup = await lookupJobByPhoneSupabase(phoneNumber);
                    if (lookup.found && lookup.jobs.length > 0) {
                        const job = lookup.jobs[0];
                        console.log('[Service Worker] Found job - auto-opening:', job.customer, job.jobUrl);

                        const createOpts = { url: job.jobUrl, active: true };
                        if (ctmWindowId) createOpts.windowId = ctmWindowId;
                        if (ctmTabIndex >= 0) createOpts.index = ctmTabIndex + 1;
                        const newTab = await chrome.tabs.create(createOpts);

                        // Group tabs if enabled
                        const groupSetting = await chrome.storage.sync.get({ ctm_group_tabs: true });
                        if (groupSetting.ctm_group_tabs && ctmTabs.length > 0) {
                            try {
                                const displayName = getDisplayName(callerName);
                                const groupId = await chrome.tabs.group({
                                    tabIds: [ctmTabs[0].id, newTab.id],
                                    ...(ctmWindowId ? { createProperties: { windowId: ctmWindowId } } : {})
                                });
                                await chrome.tabGroups.update(groupId, {
                                    title: displayName || 'Call',
                                    color: 'cyan',
                                    collapsed: false
                                });
                            } catch (groupErr) {
                                console.warn('[Service Worker] Tab grouping failed:', groupErr);
                            }
                        }

                        return { ok: true, reason: 'job_card_opened', jobId: job.job_id, tabId: newTab.id };
                    } else {
                        console.log('[Service Worker] No job found for phone:', phoneNumber);
                    }
                }
            } catch (lookupErr) {
                console.warn('[Service Worker] Auto-open job card failed:', lookupErr);
            }
        }

        console.log('[Service Worker] Call tracked:', phoneNumber);
        return { ok: true, reason: 'tracked' };

    } catch (error) {
        console.error('[Service Worker] CTM Error:', error);
        openedCtmCallPhones.delete(phoneNumber);
        return { ok: false, error: error.message };
    }
}

// Listen for alarm events
chrome.alarms.onAlarm.addListener((alarm) => {
    // Handle update check alarm
    if (alarm.name === UPDATE_CHECK_ALARM) {
        console.log('[Update] Periodic update check triggered');
        checkForUpdates();
    }
});

// Check on startup
chrome.runtime.onStartup.addListener(async () => {
    // Start update checking on browser startup
    await startUpdateCheckAlarm();
    // Check for updates after a delay to not slow startup
    setTimeout(() => checkForUpdates(), 10000);
});

// ========================================
// AUTO-DIALER — message routing + window launch
// ========================================
// Two message channels:
//   dialer.html  ──AD_TO_CTM──▶  SW  ──AUTODIALER_TO_BRIDGE──▶  CTM tab content script
//   CTM tab      ──AUTODIALER_FROM_BRIDGE──▶ SW ──AD_FROM_CTM──▶ dialer.html (broadcast)

const AUTODIALER_WINDOW_KEY = 'autodialer_window_id';

// ── MEET AUTO-MUTE ──────────────────────────────────────────
// While a call is LIVE on the CTM softphone (ctm:start — inbound or outbound,
// dialer open or not), two independent toggles act on every meet.google.com tab:
//   ctm_meet_automute     — tab-mute (silences Meet OUTPUT; you stop hearing them)
//   ctm_meet_mic_automute — clicks Meet's own mic button (the meeting stops
//                           hearing YOU while you're talking to the customer)
// Both restore when the call ends. Per-tab state lives in storage.session so it
// survives SW suspension; only what WE changed gets restored — a tab or mic the
// user muted by hand stays muted.
const MEET_AUTOMUTED_KEY = 'meet_automuted_state';

// Runs INSIDE the Meet tab via chrome.scripting, so the mute shows in Meet's
// own UI (red mic icon). MUST only ever touch the user's OWN toolbar mic
// toggle — 7/8: a loose /microphone/i match clicked a PARTICIPANT's mute
// control and muted a teammate for the whole meeting. Guards:
//   1. anchored label match — the self toggle reads "Turn on/off microphone";
//      participant controls read "Mute <name>" and never match
//   2. skip anything inside the people list or a dialog
//   3. prefer the button carrying Meet's data-is-muted state
//   4. no confident match → do NOTHING (skip the mic mute, never guess)
function _meetSetMicMuted(mute) {
    const SELF_MIC_RE = /^turn (on|off) microphone/i;
    const candidates = [...document.querySelectorAll('[role="button"][aria-label], button[aria-label]')]
        .filter(el => SELF_MIC_RE.test((el.getAttribute('aria-label') || '').trim()))
        .filter(el => !el.closest('[role="list"], [role="listitem"], [role="dialog"]'));
    const btn = candidates.find(el => el.hasAttribute('data-is-muted')) || candidates[0];
    if (!btn) return { found: false, changed: false };
    const dim = btn.getAttribute('data-is-muted');
    const isMuted = (dim === 'true' || dim === 'false')
        ? dim === 'true'
        : /^turn on/i.test((btn.getAttribute('aria-label') || '').trim());
    if (isMuted === mute) return { found: true, changed: false };
    btn.click();
    return { found: true, changed: true };
}

async function meetAutoMute() {
    try {
        const s = await chrome.storage.sync.get({ ctm_meet_automute: true, ctm_meet_mic_automute: true });
        if (s.ctm_meet_automute === false && s.ctm_meet_mic_automute === false) return;
        const tabs = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
        if (tabs.length === 0) return;
        const store = await chrome.storage.session.get([MEET_AUTOMUTED_KEY, MEET_CHIME_KEY, MEET_WHISPER_KEY]);
        // Rep deliberately opened the Meet channel mid-call (chime-in), or a
        // manager whispered their ears open — don't fight either if another ctm
        // event fires while the channel is open. Chime-out and call-end both
        // clear the flags before re-muting.
        if (store[MEET_CHIME_KEY] || store[MEET_WHISPER_KEY]) return;
        const state = store[MEET_AUTOMUTED_KEY] || {};
        for (const tab of tabs) {
            const entry = state[tab.id] || { audio: false, mic: false };
            if (s.ctm_meet_automute !== false && !tab.mutedInfo?.muted) {
                try {
                    await chrome.tabs.update(tab.id, { muted: true });
                    entry.audio = true;
                } catch (_) {}
            }
            if (s.ctm_meet_mic_automute !== false && !entry.mic) {
                try {
                    const [r] = await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        func: _meetSetMicMuted,
                        args: [true],
                    });
                    if (r?.result?.changed) entry.mic = true;
                } catch (_) {}
            }
            if (entry.audio || entry.mic) state[tab.id] = entry;
        }
        if (Object.keys(state).length > 0) {
            await chrome.storage.session.set({ [MEET_AUTOMUTED_KEY]: state });
            await meetShowChimePill(Object.keys(state).map(Number), 'muted');
            console.log('[MeetMute] call live — muted Meet tab(s):', state);
        }
    } catch (e) {
        console.warn('[MeetMute] mute failed:', e.message);
    }
}

async function meetAutoUnmute() {
    try {
        const store = await chrome.storage.session.get(MEET_AUTOMUTED_KEY);
        const state = store[MEET_AUTOMUTED_KEY] || {};
        const ids = Object.keys(state);
        if (ids.length === 0) return;
        await chrome.storage.session.remove([MEET_AUTOMUTED_KEY, MEET_CHIME_KEY, MEET_WHISPER_KEY]);
        for (const idStr of ids) {
            const tabId = Number(idStr);
            if (state[idStr].audio) {
                try { await chrome.tabs.update(tabId, { muted: false }); } catch (_) {}
            }
            if (state[idStr].mic) {
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId },
                        func: _meetSetMicMuted,
                        args: [false],
                    });
                } catch (_) {}
            }
        }
        await meetShowChimePill(ids.map(Number), 'remove');
        console.log('[MeetMute] call ended — restored', ids.length, 'Meet tab(s)');
    } catch (e) {
        console.warn('[MeetMute] unmute failed:', e.message);
    }
}

// ── MEET CHIME-IN ──────────────────────────────────────────
// While auto-muted on a live CTM call, the rep can temporarily reopen the Meet
// channel — mic AND tab audio — to talk with the group, then snap back to
// muted. Triggered by the Alt+Shift+M command or the pill button injected at
// the top of the Meet tab. Chime state lives in storage.session; chime-out
// re-runs meetAutoMute() and call end clears everything via meetAutoUnmute().
const MEET_CHIME_KEY = 'meet_chime_active';
// Manager→rep WHISPER: while a rep is auto-muted on a call, a manager can
// remotely open the rep's EARS — unmute the Meet tab's sound so the rep hears
// the group; the rep's mic stays muted (the Meet never hears the customer
// call). The pill polls /api/meet-whisper via MEET_WHISPER_POLL every few
// seconds during a live call; the rep replies by clicking the pill (full
// chime-in). Cleared with everything else at call end.
const MEET_WHISPER_KEY = 'meet_whisper_active';
// Same internal key the panel uses for roofr-search server-to-server calls.
const ROOFR_SEARCH_INTERNAL_KEY = 'WSDnmjsudtcCEWvb_TKQKcyWS3TXtcjWqfuLMsnmT96XfqZF';

// Runs INSIDE the Meet tab (isolated world, so chrome.runtime messaging works).
// Self-contained: builds/updates/removes the floating status pill, and drives
// the whisper poll — every 4s it asks the SW (MEET_WHISPER_POLL) whether a
// manager wants the rep's ears opened; the SW does the actual fetch/unmute and
// answers with the pill mode to display. The tab hosts the timer because the
// MV3 service worker can't keep one alive across suspensions.
function _meetChimePill(mode, fromName) {
    const ID = '__ctmChimePill';
    let pill = document.getElementById(ID);
    if (mode === 'remove') {
        if (window.__ctmChimePillPoll) { clearInterval(window.__ctmChimePillPoll); window.__ctmChimePillPoll = null; }
        if (pill) pill.remove();
        return;
    }
    if (!pill) {
        pill = document.createElement('div');
        pill.id = ID;
        pill.title = 'Alt+Shift+M also toggles this';
        pill.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);' +
            'z-index:2147483647;display:flex;align-items:center;gap:10px;padding:7px 12px;' +
            'border-radius:24px;font:13px/1.2 "Google Sans",Roboto,Arial,sans-serif;color:#fff;' +
            'box-shadow:0 2px 10px rgba(0,0,0,.45);';
        const label = document.createElement('span');
        label.id = ID + 'Label';
        const btn = document.createElement('button');
        btn.id = ID + 'Btn';
        btn.style.cssText = 'border:0;border-radius:16px;padding:5px 12px;cursor:pointer;' +
            'font:600 12px/1 "Google Sans",Roboto,Arial,sans-serif;background:#8ab4f8;color:#202124;';
        btn.addEventListener('click', () => {
            try { chrome.runtime.sendMessage({ type: 'MEET_CHIME_TOGGLE' }); } catch (_) {}
        });
        pill.appendChild(label);
        pill.appendChild(btn);
        (document.body || document.documentElement).appendChild(pill);
    }
    const label = document.getElementById(ID + 'Label');
    const btn = document.getElementById(ID + 'Btn');
    if (mode === 'live') {
        label.textContent = 'Live in Meet — the group can hear you';
        btn.textContent = 'Re-mute';
        pill.style.background = '#b3261e';
    } else if (mode === 'whisper') {
        label.textContent = `🔊 ${fromName || 'Manager'} is talking to you — you're still muted`;
        btn.textContent = 'Reply';
        pill.style.background = '#1a73e8';
    } else {
        label.textContent = 'Auto-muted — on a CTM call';
        btn.textContent = 'Chime in';
        pill.style.background = '#3c4043';
    }
    if (!window.__ctmChimePillPoll) {
        window.__ctmChimePillPoll = setInterval(() => {
            let p;
            try {
                p = chrome.runtime.sendMessage({ type: 'MEET_WHISPER_POLL' });
            } catch (_) {
                // Extension reloaded out from under us — stop polling; the next
                // call's pill injection brings a fresh timer.
                clearInterval(window.__ctmChimePillPoll);
                window.__ctmChimePillPoll = null;
                return;
            }
            if (p && p.then) p.then((resp) => {
                if (resp && resp.mode) _meetChimePill(resp.mode, resp.from);
            }).catch(() => {});
        }, 4000);
    }
}

async function meetShowChimePill(tabIds, mode) {
    try {
        if (mode !== 'remove') {
            const s = await chrome.storage.sync.get({ ctm_meet_chime_pill: true });
            if (s.ctm_meet_chime_pill === false) return;
        }
        for (const tabId of tabIds) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId },
                    func: _meetChimePill,
                    args: [mode],
                });
            } catch (_) {}
        }
    } catch (e) {
        console.warn('[MeetMute] pill update failed:', e.message);
    }
}

async function meetChimeToggle() {
    try {
        const store = await chrome.storage.session.get([MEET_AUTOMUTED_KEY, MEET_CHIME_KEY]);
        const state = store[MEET_AUTOMUTED_KEY] || {};
        const ids = Object.keys(state).map(Number);
        if (ids.length === 0) return; // no live-call auto-mute in effect — nothing to chime into
        if (!store[MEET_CHIME_KEY]) {
            // Open the channel: unmute BOTH directions on every tab we auto-muted.
            // Deliberate rep action, so this overrides even a hand-muted mic.
            for (const tabId of ids) {
                try { await chrome.tabs.update(tabId, { muted: false }); } catch (_) {}
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId },
                        func: _meetSetMicMuted,
                        args: [false],
                    });
                } catch (_) {}
            }
            await chrome.storage.session.remove(MEET_WHISPER_KEY); // full open supersedes a whisper
            await chrome.storage.session.set({ [MEET_CHIME_KEY]: true });
            await meetShowChimePill(ids, 'live');
            console.log('[MeetMute] chime-in — Meet channel open on', ids.length, 'tab(s)');
        } else {
            // Snap back: clear the flags FIRST so meetAutoMute doesn't skip.
            await chrome.storage.session.remove([MEET_CHIME_KEY, MEET_WHISPER_KEY]);
            await meetAutoMute(); // re-applies per-toggle mutes + shows the 'muted' pill
            console.log('[MeetMute] chime-out — re-muted');
        }
    } catch (e) {
        console.warn('[MeetMute] chime toggle failed:', e.message);
    }
}

async function findCtmTabId(windowId) {
    const queryOpts = { url: '*://app.calltrackingmetrics.com/calls/desk*' };
    if (windowId) queryOpts.windowId = windowId;
    const tabs = await chrome.tabs.query(queryOpts);
    return tabs.length > 0 ? tabs[0].id : null;
}

// Programmatically inject dialer bridge into a CTM tab. We rate-limit per tab
// (max one inject per 3s) instead of one-shot dedup, so we can recover from
// extension reload where the prior bridge instance left stale closures behind.
// The bridge's IIFE handles re-injection by cleaning up its prior listeners.
const _lastInjectAt = new Map();
async function injectDialerBridge(tabId) {
    const now = Date.now();
    const last = _lastInjectAt.get(tabId) || 0;
    if (now - last < 3000) return;
    _lastInjectAt.set(tabId, now);
    try {
        // Isolated world (relay → chrome.runtime) — all frames
        await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ['dialer-bridge.js'],
        });
        // MAIN world (talks to <ctm-phone-embed>) — all frames
        await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ['dialer-bridge-main.js'],
            world: 'MAIN',
        });
        console.log('[AutoDialer-SW] (re-)injected bridges into tab', tabId, '(all frames)');
    } catch (e) {
        console.warn('[AutoDialer-SW] inject failed for tab', tabId, e.message);
        _lastInjectAt.delete(tabId);
    }
}

// Fire on every CTM tab navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;
    if (!tab.url || !/^https:\/\/[^/]*calltrackingmetrics\.com\//.test(tab.url)) return;
    // Clear rate-limit so navigation triggers a fresh inject immediately
    _lastInjectAt.delete(tabId);
    injectDialerBridge(tabId);
});

// Also inject when dialer pings — covers the case where SW restarted and
// onUpdated already fired before this listener registered.
chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs.get(tabId).then(tab => {
        if (tab.url && /calltrackingmetrics\.com/.test(tab.url)) {
            injectDialerBridge(tabId);
        }
    }).catch(() => {});
});

async function openAutoDialerWindow() {
    try {
        const stored = await chrome.storage.session.get(AUTODIALER_WINDOW_KEY);
        const existingId = stored[AUTODIALER_WINDOW_KEY];
        if (existingId) {
            try {
                const win = await chrome.windows.get(existingId);
                if (win) { await chrome.windows.update(existingId, { focused: true }); return; }
            } catch (_) {}
        }
    } catch (_) {}

    const win = await chrome.windows.create({
        url: chrome.runtime.getURL('dialer.html'),
        type: 'popup',
        width: 480,
        height: 760,
    });
    try { await chrome.storage.session.set({ [AUTODIALER_WINDOW_KEY]: win.id }); } catch (_) {}
}

chrome.commands?.onCommand.addListener(async (command) => {
    if (command === 'open-auto-dialer') await openAutoDialerWindow();
    if (command === 'meet-chime-toggle') await meetChimeToggle();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'MEET_CHIME_TOGGLE') {
        // From the pill button on a Meet tab (or anywhere else in the extension).
        meetChimeToggle();
        sendResponse({ ok: true });
        return false;
    }
    if (msg?.type === 'MEET_WHISPER_POLL') {
        // From the pill's 4s timer on a Meet tab during a live call. Checks the
        // server for a pending whisper aimed at this rep; on a hit, opens the
        // rep's EARS only (unmute this Meet tab's sound — mic stays muted) and
        // tells the pill to show who's talking. Responds with the current pill
        // mode either way so the pill self-corrects.
        (async () => {
            try {
                const store = await chrome.storage.session.get([MEET_AUTOMUTED_KEY, MEET_CHIME_KEY, MEET_WHISPER_KEY]);
                const state = store[MEET_AUTOMUTED_KEY] || {};
                if (Object.keys(state).length === 0) { sendResponse({ mode: null }); return; }
                if (store[MEET_CHIME_KEY]) { sendResponse({ mode: 'live' }); return; }
                if (store[MEET_WHISPER_KEY]) {
                    sendResponse({ mode: 'whisper', from: store[MEET_WHISPER_KEY].from });
                    return;
                }
                const s = await chrome.storage.sync.get({ ctm_display_name: '', scanner_name: '' });
                const identity = (s.ctm_display_name || s.scanner_name || '').trim();
                if (!identity) { sendResponse({ mode: 'muted' }); return; }
                const r = await fetch(
                    `https://roofr-search.vercel.app/api/meet-whisper?target=${encodeURIComponent(identity)}`,
                    { cache: 'no-store', headers: { 'X-Internal-Key': ROOFR_SEARCH_INTERNAL_KEY } });
                const j = await r.json().catch(() => null);
                const w = (j?.success && Array.isArray(j.whispers) && j.whispers[0]) || null;
                if (!w) { sendResponse({ mode: 'muted' }); return; }
                const from = w.requested_by || 'Manager';
                const tabId = sender?.tab?.id;
                if (tabId != null) {
                    try { await chrome.tabs.update(tabId, { muted: false }); } catch (_) {}
                }
                await chrome.storage.session.set({ [MEET_WHISPER_KEY]: { from, at: Date.now() } });
                console.log('[MeetMute] whisper from', from, '— opened rep ears on tab', tabId);
                sendResponse({ mode: 'whisper', from });
            } catch (e) {
                sendResponse({ mode: 'muted', error: e.message });
            }
        })();
        return true;
    }
    if (msg?.type === 'AD_TO_CTM') {
        (async () => {
            const tabId = await findCtmTabId(msg.windowId);
            if (!tabId) { sendResponse({ ok: false, error: 'no_ctm_tab' }); return; }
            const payload = msg.payload || {};

            // Post command directly into the page's MAIN world where
            // bridge-main.js listens via window.postMessage. Bypasses the
            // relay (chrome.tabs.sendMessage → content script) which stopped
            // delivering messages reliably.
            try {
                await chrome.scripting.executeScript({
                    target: { tabId },
                    world: 'MAIN',
                    func: (p) => {
                        // Filter CTM call log to show history for this number
                        if (p.type === 'dial' && p.number) {
                            const digits = String(p.number).replace(/\D/g, '').slice(-10);
                            if (digits.length === 10) {
                                const formatted = '(' + digits.slice(0,3) + ') ' + digits.slice(3,6) + '-' + digits.slice(6);
                                location.hash = 'filter=' + formatted;
                            }
                        }
                        window.postMessage({
                            __autoDialerBridge: true,
                            dir: "from-relay",
                            ...p
                        }, "*");
                    },
                    args: [payload],
                });
                sendResponse({ ok: true });
            } catch (e) { sendResponse({ ok: false, error: e.message }); }
        })();
        return true;
    }
    if (msg?.type === 'AUTODIALER_FROM_BRIDGE') {
        // Meet auto-mute rides the same event stream the dialer uses; the
        // bridge forwards these whether or not the dialer window is open.
        // ctm:start = any call goes live (inbound answer OR outbound connect).
        // ctm:connecting = an OUTBOUND dial just started — mute from the first
        // ring, not the answer; without it Meet keeps playing through the whole
        // dial/ring phase (and outbound never muted at all if ctm:start was
        // missed). Inbound RINGING (ctm:incomingCall) deliberately does NOT
        // mute — you're not on the call until you answer.
        if (msg.payload?.type === 'ctm-event') {
            const ev = msg.payload.event;
            if (ev === 'ctm:connecting' || ev === 'ctm:start') {
                meetAutoMute();
            } else if (ev === 'ctm:end-activity' || ev === 'ctm:wrapup_start' || ev === 'ctm:failed') {
                meetAutoUnmute();
            }
        }
        try {
            chrome.runtime.sendMessage({ type: 'AD_FROM_CTM', payload: msg.payload }).catch(() => {});
        } catch (_) {}
        sendResponse({ ok: true });
        return false;
    }
    if (msg?.type === 'AD_PING_CTM') {
        (async () => {
            const tabId = await findCtmTabId(msg.windowId);
            // Do NOT re-inject bridge here — manifest content_scripts handles
            // initial injection. Re-injecting on every 2s poll destroys
            // bridge-main's phoneEmbed reference, causing "no phone embed"
            // errors when a dial command arrives during the reset window.
            sendResponse({ ok: true, ctmTabOpen: !!tabId, tabId });
        })();
        return true;
    }
    if (msg?.type === 'AD_ENSURE_CTM_DESK') {
        (async () => {
            const CTM_DESK_URL = 'https://app.calltrackingmetrics.com/calls/desk';
            const queryOpts = { url: '*://app.calltrackingmetrics.com/calls/desk*' };
            if (msg.windowId) queryOpts.windowId = msg.windowId;
            const deskTabs = await chrome.tabs.query(queryOpts);
            if (deskTabs.length > 0) {
                const tab = deskTabs[0];
                await chrome.tabs.move(tab.id, { index: 0 });
                await chrome.tabs.update(tab.id, { active: false });
                sendResponse({ ok: true, tabId: tab.id, action: 'reused' });
            } else {
                const createOpts = { url: CTM_DESK_URL, active: false, index: 0 };
                if (msg.windowId) createOpts.windowId = msg.windowId;
                const tab = await chrome.tabs.create(createOpts);
                sendResponse({ ok: true, tabId: tab.id, action: 'created' });
            }
        })();
        return true;
    }
    if (msg?.type === 'AD_OPEN_WINDOW') {
        openAutoDialerWindow().then(() => sendResponse({ ok: true }));
        return true;
    }
});

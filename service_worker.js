

// service_worker.js

const SEED_DEFAULTS = {
    // No SCRIPT_URL needed for direct API access
    NEXT_SHEET_ID: "1cFFEZNl7wXt40riZHnuZxGc1Zfm5lTlOz0rDCWGZJ0g",
    AVAIL_RANGE_PHX: "I2:Q9",
    AVAIL_RANGE_NORTH: "I18:Q25",
    AVAIL_RANGE_SOUTH: "I10:Q17",

    // People Lists (Comma separated defaults)
    PEOPLE_REPS: "Ashkan Etemadi, Brandon Cook, Brett Jackson, Brian Griggs, Chandler Duffy, Christian Noren, Cole Ludewig, Joseph Simms, Justin Parker, Kyle Ludewig, London Smith, Nick Williams, Oliver Johnson, Phil Merrell, Richard Hadsall, Ted Pear, William Ludewig, William Yost",
    PEOPLE_MGMT: "Andrew Clark, Anthony Bonomo, Bradley Crohurst, Brenda Ochoa, Yousef Ayad",
    PEOPLE_CSRS: "Bronté Pisz, Diva Shahpur, Layla Fairfield, Madison Meyers, Nica Javier, Raven Pelfrey, Travis Jones",
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
    show_clipboard: false,
    show_reports: false,
    // Interface behavior
    show_dock_note: true,
    default_tab: "scanner",
    show_week_navigation: true,
    show_date_picker: true,
    show_team_selector: true,
    show_refresh_button: true,
    auto_expand_days: true,
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
    // CALLRAIL SETTINGS
    // =====================
    callrail_enabled: false,
    callrail_user: "",
    callrail_display_name: "",
    callrail_auto_search: true,
    callrail_show_notifications: true,
    callrail_show_active_calls: true,
    callrail_auto_open_lead_center: true,
    callrail_group_tabs: true,

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
const CALLRAIL_URL = "https://app.callrail.com/lead-center/a/629065099/agent-tool/dialer/call?company_id=459564228";
const CALLRAIL_LEAD_CENTER_BASE = "https://app.callrail.com/lead-center";
const CALLRAIL_CHECK_ALARM = "callrail_lead_center_check";
const CALLRAIL_CHECK_INTERVAL_MINUTES = 10;

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

            // Set badge to indicate update available
            await chrome.action.setBadgeText({ text: '!' });
            await chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });

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

// Listen for preference updates from popup.js and CallRail incoming calls
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "CALLRAIL_INCOMING_CALL") {
        // Pass caller name for tab group title and windowId for window isolation
        // Use sender's tab windowId if message came from content script, otherwise use msg.windowId
        const windowId = msg.windowId || (sender.tab ? sender.tab.windowId : null);
        handleCallRailIncomingCall(msg.phoneNumber, msg.formattedPhone, false, msg.callerName, windowId)
            .then(result => {
                console.log('[Service Worker] CallRail call handled:', result);
            })
            .catch(err => {
                console.error('[Service Worker] Error handling CallRail call:', err);
            });
        return false; // No response needed
    }

    // Open contacts page and search for a specific phone number (triggered from popup UI)
    if (msg.type === "OPEN_CONTACTS_FOR_PHONE") {
        // Pass true to skip enabled check since this is a manual user action
        // Pass caller name for tab group title and windowId for window isolation
        // Use sender's tab windowId if message came from content script, otherwise use msg.windowId
        const windowId = msg.windowId || (sender.tab ? sender.tab.windowId : null);
        handleCallRailIncomingCall(msg.phoneNumber, msg.formattedPhone, true, msg.callerName, windowId)
            .then(result => {
                sendResponse({ ok: true, result });
            })
            .catch(err => {
                sendResponse({ ok: false, error: err.message });
            });
        return true; // Async response
    }

    // Clear tracking for a specific phone number (called when call ends)
    if (msg.type === "CALLRAIL_CALL_ENDED") {
        if (msg.phoneNumber) {
            openedCallPhones.delete(msg.phoneNumber);
            console.log('[Service Worker] Cleared tracking for ended call:', msg.phoneNumber);
        }
        return false;
    }

    // Clear all tracking when CallRail page loads/refreshes
    // This ensures active calls are re-detected after a page refresh
    if (msg.type === "CALLRAIL_PAGE_LOADED") {
        openedCallPhones.clear();
        console.log('[Service Worker] CallRail page loaded, cleared all call tracking');
        return false;
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

    // Open CallRail tab if requested or not already open (in target window if specified)
    if (msg.type === "OPEN_CALLRAIL") {
        (async () => {
            try {
                // Check if CallRail is already open in target window
                const queryOpts = { url: '*://app.callrail.com/*' };
                if (msg.windowId) queryOpts.windowId = msg.windowId;
                const callrailTabs = await chrome.tabs.query(queryOpts);
                if (callrailTabs.length > 0) {
                    // Focus existing tab
                    await chrome.tabs.update(callrailTabs[0].id, { active: true });
                    await chrome.windows.update(callrailTabs[0].windowId, { focused: true });
                    console.log('[Service Worker] Focused existing CallRail tab');
                } else {
                    // Open new CallRail tab in target window
                    const createOpts = { url: CALLRAIL_URL, active: true };
                    if (msg.windowId) createOpts.windowId = msg.windowId;
                    await chrome.tabs.create(createOpts);
                    console.log('[Service Worker] Opened new CallRail tab');
                }
            } catch (e) {
                console.error('[Service Worker] Error opening CallRail:', e);
            }
        })();
        return false;
    }

    // Check if CallRail is enabled (for content script)
    if (msg.type === "CHECK_CALLRAIL_ENABLED") {
        (async () => {
            try {
                const settings = await chrome.storage.sync.get({ callrail_enabled: false });
                sendResponse({ enabled: settings.callrail_enabled });
            } catch (e) {
                sendResponse({ enabled: false }); // Default to disabled on error
            }
        })();
        return true; // Async response
    }

    // Get CallRail settings for content script (content scripts can't access storage directly in MV3)
    if (msg.type === "GET_CALLRAIL_SETTINGS") {
        (async () => {
            try {
                const rawSettings = await chrome.storage.sync.get({
                    callrail_enabled: false,
                    callrail_csr: '',            // The CSR selected from popup modal "Start Calls"
                    callrail_user: '',           // The CSR from settings page dropdown
                    callrail_display_name: ''    // Optional: name as it appears in CallRail
                });
                // Priority: callrail_csr (popup modal) > callrail_display_name > callrail_user (settings page)
                // The popup modal "Start Calls" saves to callrail_csr
                // The settings page saves to callrail_user
                const primaryCsr = rawSettings.callrail_csr || rawSettings.callrail_display_name || rawSettings.callrail_user;
                const settings = {
                    callrail_enabled: rawSettings.callrail_enabled,
                    callrail_csr: primaryCsr,
                    callrail_user: rawSettings.callrail_user,
                    callrail_display_name: rawSettings.callrail_display_name
                };
                console.log('[Service Worker] CallRail settings:', settings);
                sendResponse({ success: true, settings });
            } catch (e) {
                sendResponse({
                    success: false,
                    settings: { callrail_enabled: false, callrail_csr: '', callrail_user: '', callrail_display_name: '' }
                });
            }
        })();
        return true; // Async response
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
const openedCallPhones = new Set();

// Clear opened calls tracking after 30 minutes (in case of long sessions)
setInterval(() => {
    openedCallPhones.clear();
    console.log('[Service Worker] Cleared opened calls tracking');
}, 30 * 60 * 1000);

// Handle incoming CallRail calls - opens/focuses Roofr contacts and searches for phone number
// skipEnabledCheck: if true, bypass the callrail_enabled setting check AND duplicate tracking (used for manual UI triggers)
// callerName: optional name to use for tab group title
// targetWindowId: optional window ID to constrain all tab operations to a specific browser window
async function handleCallRailIncomingCall(phoneNumber, formattedPhone, skipEnabledCheck = false, callerName = null, targetWindowId = null) {
    console.log('[Service Worker] Handling incoming call:', phoneNumber, 'Caller:', callerName, 'Manual:', skipEnabledCheck, 'WindowId:', targetWindowId);

    // Check if we've already opened this phone number (prevent duplicate opens)
    // Skip this check for manual triggers (skipEnabledCheck=true) - user explicitly wants to open/focus
    if (!skipEnabledCheck && openedCallPhones.has(phoneNumber)) {
        console.log('[Service Worker] Already opened contact for this call, skipping duplicate');
        return { ok: true, reason: 'already_opened' };
    }

    // Check if CallRail integration is enabled (unless bypassed for manual triggers)
    if (!skipEnabledCheck) {
        try {
            const settings = await chrome.storage.sync.get({ callrail_enabled: false });
            if (!settings.callrail_enabled) {
                console.log('[Service Worker] CallRail integration is disabled, skipping');
                return { ok: false, reason: 'disabled' };
            }
        } catch (e) {
            console.log('[Service Worker] Could not check settings, assuming disabled');
            return { ok: false, reason: 'settings_error' };
        }
    }

    // Mark this phone as opened (for automatic detection duplicate prevention)
    openedCallPhones.add(phoneNumber);

    try {
        // Find the CallRail tab to position the Roofr tab next to it (in target window if specified)
        const callrailQueryOpts = { url: '*://app.callrail.com/*' };
        if (targetWindowId) callrailQueryOpts.windowId = targetWindowId;
        const callrailTabs = await chrome.tabs.query(callrailQueryOpts);
        let callrailTabIndex = -1;
        let callrailWindowId = targetWindowId; // Use target window ID if provided
        if (callrailTabs.length > 0) {
            callrailTabIndex = callrailTabs[0].index;
            callrailWindowId = callrailTabs[0].windowId;
            console.log('[Service Worker] Found CallRail tab at index:', callrailTabIndex);
        }

        // Step 1: Look for an existing contacts LIST tab in target window (not a job card or contact detail page)
        // We specifically want tabs that are on the main contacts list view
        const roofrQueryOpts = { url: '*://app.roofr.com/*' };
        if (targetWindowId) roofrQueryOpts.windowId = targetWindowId;
        const roofrTabs = await chrome.tabs.query(roofrQueryOpts);

        let targetTab;

        // Find a tab that's specifically on the contacts LIST (not a detail page or job card)
        // The contacts list URL looks like: /contacts or /contacts?...
        // Contact detail pages have format: /contacts/XXXXX or /contacts/XXXXX?selectedJobId=...
        const contactsListTab = roofrTabs.find(tab => {
            if (!tab.url) return false;
            // Match /contacts at the end, or /contacts? or /contacts/?
            // But NOT /contacts/XXXXX (which is a contact detail page)
            return tab.url.match(/\/contacts\/?(\?|$)/) && !tab.url.match(/\/contacts\/\d+/);
        });

        if (contactsListTab) {
            // Found an existing contacts list tab - reuse it
            targetTab = contactsListTab;
            console.log('[Service Worker] Found existing contacts list tab:', targetTab.id);

            // Move tab next to CallRail if in a different position
            if (callrailTabIndex >= 0 && targetTab.index !== callrailTabIndex + 1) {
                await chrome.tabs.move(targetTab.id, { index: callrailTabIndex + 1 });
                console.log('[Service Worker] Moved tab next to CallRail');
            }

            // Focus the tab and bring window to front
            await chrome.tabs.update(targetTab.id, { active: true });
            await chrome.windows.update(targetTab.windowId, { focused: true });

            // Reload the tab to ensure fresh content and content script is active
            await chrome.tabs.reload(targetTab.id);
            await waitForTabLoad(targetTab.id);
        } else {
            // No contacts list tab found - create a new one in target window
            // IMPORTANT: Do NOT navigate away from existing Roofr tabs (job cards, contact details, etc.)
            // Those tabs should be preserved so users don't lose their work
            console.log('[Service Worker] No contacts list tab found, creating new tab');

            // Create tab next to CallRail if found, otherwise at default position in target window
            const createOptions = {
                url: ROOFR_CONTACTS_URL,
                active: true
            };
            if (callrailTabIndex >= 0) {
                createOptions.index = callrailTabIndex + 1;
            }
            // Use target window ID if provided, otherwise use callrail window
            if (targetWindowId) {
                createOptions.windowId = targetWindowId;
            } else if (callrailWindowId) {
                createOptions.windowId = callrailWindowId;
            }

            targetTab = await chrome.tabs.create(createOptions);
            console.log('[Service Worker] Created new Roofr contacts tab:', targetTab.id);
            await waitForTabLoad(targetTab.id);
        }

        // Step 2: Create or update tab group with customer name
        if (callerName) {
            try {
                const groupTitle = callerName;

                // Check if tab is already in a group
                const tabInfo = await chrome.tabs.get(targetTab.id);

                if (tabInfo.groupId && tabInfo.groupId !== -1) {
                    // Tab is already in a group - update the group title
                    await chrome.tabGroups.update(tabInfo.groupId, {
                        title: groupTitle,
                        color: 'blue'
                    });
                    console.log('[Service Worker] Updated existing tab group title to:', groupTitle);
                } else {
                    // Create a new tab group
                    const groupId = await chrome.tabs.group({ tabIds: [targetTab.id] });
                    await chrome.tabGroups.update(groupId, {
                        title: groupTitle,
                        color: 'blue',
                        collapsed: false
                    });
                    console.log('[Service Worker] Created tab group:', groupTitle);
                }
            } catch (groupError) {
                console.warn('[Service Worker] Could not create/update tab group:', groupError);
            }
        }

        // Step 3: Give the React app and content script time to initialize
        // Wait longer to ensure everything is ready
        await new Promise(r => setTimeout(r, 2500));

        // Step 4: Send message to inject search with retry logic
        const searchPhone = formattedPhone || phoneNumber;
        let lastError = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log('[Service Worker] Attempt', attempt, 'to inject search for:', searchPhone);
                const response = await chrome.tabs.sendMessage(targetTab.id, {
                    type: 'INJECT_CONTACT_SEARCH',
                    phoneNumber: searchPhone
                });
                console.log('[Service Worker] Search injection result:', response);
                return { ok: true, tabId: targetTab.id, response };
            } catch (msgError) {
                lastError = msgError;
                console.warn('[Service Worker] Attempt', attempt, 'failed:', msgError.message);
                if (attempt < 3) {
                    // Wait before retrying
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }

        console.error('[Service Worker] All attempts failed');
        return { ok: false, tabId: targetTab.id, error: lastError?.message || 'Failed after 3 attempts' };

    } catch (error) {
        console.error('[Service Worker] Error:', error);
        // Remove from tracking if there was an error so it can be retried
        openedCallPhones.delete(phoneNumber);
        return { ok: false, error: error.message };
    }
}

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
// CALLRAIL LEAD CENTER MONITORING
// ========================================

// Check if CallRail Lead Center is open and open/pin it if not
async function checkAndOpenCallRailLeadCenter() {
    try {
        // First check if monitoring is enabled
        const settings = await chrome.storage.sync.get({ callrail_enabled: false });
        if (!settings.callrail_enabled) {
            console.log('[Service Worker] CallRail monitoring disabled, skipping check');
            return;
        }

        // Query for all CallRail tabs
        const callrailTabs = await chrome.tabs.query({ url: '*://app.callrail.com/*' });

        // Check if any tab is specifically the lead center
        const leadCenterTab = callrailTabs.find(tab =>
            tab.url && tab.url.startsWith(CALLRAIL_LEAD_CENTER_BASE)
        );

        if (leadCenterTab) {
            console.log('[Service Worker] CallRail Lead Center is already open:', leadCenterTab.id);
            // Ensure it's pinned
            if (!leadCenterTab.pinned) {
                await chrome.tabs.update(leadCenterTab.id, { pinned: true });
                console.log('[Service Worker] Pinned existing Lead Center tab');
            }
        } else {
            // Lead Center is not open - need to open it
            // If there are other CallRail tabs (not lead center), we still need to open lead center
            console.log('[Service Worker] CallRail Lead Center not found, opening...');

            const newTab = await chrome.tabs.create({
                url: CALLRAIL_URL,
                active: false,
                pinned: true
            });
            console.log('[Service Worker] Opened and pinned CallRail Lead Center tab:', newTab.id);
        }
    } catch (e) {
        console.error('[Service Worker] Error checking/opening CallRail Lead Center:', e);
    }
}

// Start the 10-minute monitoring alarm
async function startCallRailLeadCenterMonitoring() {
    try {
        // Clear any existing alarm first
        await chrome.alarms.clear(CALLRAIL_CHECK_ALARM);

        // Create a new repeating alarm
        await chrome.alarms.create(CALLRAIL_CHECK_ALARM, {
            periodInMinutes: CALLRAIL_CHECK_INTERVAL_MINUTES
        });
        console.log('[Service Worker] Started CallRail Lead Center monitoring (every 10 minutes)');

        // Also run an immediate check
        await checkAndOpenCallRailLeadCenter();
    } catch (e) {
        console.error('[Service Worker] Error starting CallRail monitoring:', e);
    }
}

// Stop the monitoring alarm
async function stopCallRailLeadCenterMonitoring() {
    try {
        await chrome.alarms.clear(CALLRAIL_CHECK_ALARM);
        console.log('[Service Worker] Stopped CallRail Lead Center monitoring');
    } catch (e) {
        console.error('[Service Worker] Error stopping CallRail monitoring:', e);
    }
}

// Listen for alarm events
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CALLRAIL_CHECK_ALARM) {
        console.log('[Service Worker] CallRail Lead Center check alarm triggered');
        checkAndOpenCallRailLeadCenter();
    }

    // Handle update check alarm
    if (alarm.name === UPDATE_CHECK_ALARM) {
        console.log('[Update] Periodic update check triggered');
        checkForUpdates();
    }
});

// Listen for storage changes to start/stop monitoring when toggle changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.callrail_enabled) {
        const enabled = changes.callrail_enabled.newValue;
        console.log('[Service Worker] CallRail enabled changed to:', enabled);

        if (enabled) {
            startCallRailLeadCenterMonitoring();
        } else {
            stopCallRailLeadCenterMonitoring();
        }
    }
});

// Check on startup if monitoring should be running
chrome.runtime.onStartup.addListener(async () => {
    try {
        const settings = await chrome.storage.sync.get({ callrail_enabled: false });
        if (settings.callrail_enabled) {
            console.log('[Service Worker] CallRail enabled on startup, starting monitoring');
            startCallRailLeadCenterMonitoring();
        }
    } catch (e) {
        console.error('[Service Worker] Error checking CallRail setting on startup:', e);
    }

    // Start update checking on browser startup
    await startUpdateCheckAlarm();
    // Check for updates after a delay to not slow startup
    setTimeout(() => checkForUpdates(), 10000);
});

// Also check when service worker is activated (handles extension install/update)
(async () => {
    try {
        const settings = await chrome.storage.sync.get({ callrail_enabled: false });
        if (settings.callrail_enabled) {
            console.log('[Service Worker] CallRail enabled, ensuring monitoring is active');
            startCallRailLeadCenterMonitoring();
        }
    } catch (e) {
        console.error('[Service Worker] Error checking CallRail setting on activation:', e);
    }
})();

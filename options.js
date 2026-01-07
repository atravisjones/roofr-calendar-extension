// options.js
// Comprehensive settings storage with categorized toggles.
import { CONFIG, PEOPLE_DATA } from './config.js';
import { THEMES } from './themes.js';

// All settings fields organized by category
const fields = [
  // Text/Select inputs
  "SCRIPT_URL",
  "NEXT_SHEET_ID",
  "AVAIL_RANGE_PHX",
  "AVAIL_RANGE_NORTH",
  "AVAIL_RANGE_SOUTH",
  "PEOPLE_REPS",
  "PEOPLE_MGMT",
  "PEOPLE_CSRS",
  "theme",
  "callrail_user",
  "callrail_display_name",

  // Appearance toggles
  "compact_mode",
  "show_color_indicators",
  "show_icons",
  "animate_transitions",

  // Interface toggles
  "show_job_sorting",
  "show_people",
  "show_clipboard",
  "show_reports",
  "show_dock_note",
  "show_week_navigation",
  "show_date_picker",
  "show_team_selector",
  "show_refresh_button",
  "auto_expand_days",
  "show_tab_badges",
  "global_panel_mode",

  // Scanner toggles
  "scanner_enabled",
  "auto_scan_on_load",
  "show_capacity_display",
  "show_daily_totals",
  "show_city_chips",
  "show_region_filter",
  "show_uncategorized_alerts",
  "highlight_recommended_slots",
  "show_out_of_sync_warning",
  "show_availability_section",
  "show_booked_count",
  "show_available_count",
  "show_overbooked_warning",

  // Home search toggles
  "home_search_enabled",
  "address_verification_enabled",
  "show_recent_addresses",
  "show_address_suggestions",
  "auto_copy_verified_address",
  "show_geocode_results",
  "normalize_addresses",
  // Address search actions
  "search_google_earth",
  "search_gemini",
  "search_roofr",

  // Phone search toggles
  "phone_search_enabled",
  "auto_format_phone",
  "show_phone_history",
  "phone_search_auto_open",

  // CallRail toggles
  "callrail_enabled",
  "callrail_auto_search",
  "callrail_show_notifications",
  "callrail_show_active_calls",
  "callrail_auto_open_lead_center",
  "callrail_group_tabs",

  // Job sorting toggles
  "job_sorting_auto_load",
  "job_sorting_show_unknown_roof",
  "job_sorting_show_unknown_stories",
  "job_sorting_show_residential",
  "job_sorting_show_commercial",
  "job_sorting_show_insurance",
  "job_sorting_remember_filters",
  "job_sorting_multi_select",

  // Reports toggles
  "reports_enabled",
  "reports_calendar_enabled",
  "reports_job_card_enabled",
  "reports_batch_enabled",
  "reports_auto_export",

  // People toggles
  "people_show_reps",
  "people_show_mgmt",
  "people_show_csrs",
  "people_show_production",
  "people_clickable_names",
  "people_show_counts",

  // Clipboard toggles
  "clipboard_smart_formatting",
  "clipboard_auto_format_paste",
  "clipboard_show_day_copy",
  "clipboard_show_week_copy",
  "clipboard_preserve_formatting",

  // Find toggles
  "find_enabled",
  "find_highlight_enabled",
  "find_case_sensitive",
  "find_whole_word",
  "find_regex_enabled",
  "find_show_counter",
  "find_show_navigation",

  // Data toggles
  "dynamic_city_learning",
  "city_whitelist_strict",
  "show_learned_cities",
  "auto_categorize_jobs"
];

const defaults = {
  // Text inputs
  SCRIPT_URL: "",
  NEXT_SHEET_ID: "",
  AVAIL_RANGE_PHX: "B4:H200",
  AVAIL_RANGE_NORTH: "B4:H200",
  AVAIL_RANGE_SOUTH: "B4:H200",
  PEOPLE_REPS: PEOPLE_DATA.REPS.join(", "),
  PEOPLE_MGMT: PEOPLE_DATA.MGMT.join(", "),
  PEOPLE_CSRS: PEOPLE_DATA.CSRS.join(", "),
  theme: "light",
  callrail_user: "",
  callrail_display_name: "",

  // Appearance
  compact_mode: false,
  show_color_indicators: true,
  show_icons: true,
  animate_transitions: true,

  // Interface - Tab visibility
  show_job_sorting: false,
  show_people: true,
  show_clipboard: true,
  show_reports: false,
  // Interface - Navigation
  show_dock_note: true,
  show_week_navigation: true,
  show_date_picker: true,
  show_team_selector: true,
  show_refresh_button: true,
  auto_expand_days: true,
  show_tab_badges: true,
  global_panel_mode: true,

  // Scanner
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

  // Home search
  home_search_enabled: true,
  address_verification_enabled: true,
  show_recent_addresses: true,
  show_address_suggestions: true,
  auto_copy_verified_address: false,
  show_geocode_results: true,
  normalize_addresses: true,
  // Address search actions
  search_google_earth: true,
  search_gemini: true,
  search_roofr: true,

  // Phone search
  phone_search_enabled: true,
  auto_format_phone: true,
  show_phone_history: true,
  phone_search_auto_open: true,

  // CallRail
  callrail_enabled: false,
  callrail_auto_search: true,
  callrail_show_notifications: true,
  callrail_show_active_calls: true,
  callrail_auto_open_lead_center: true,
  callrail_group_tabs: true,

  // Job sorting
  job_sorting_auto_load: false,
  job_sorting_show_unknown_roof: true,
  job_sorting_show_unknown_stories: true,
  job_sorting_show_residential: true,
  job_sorting_show_commercial: true,
  job_sorting_show_insurance: true,
  job_sorting_remember_filters: true,
  job_sorting_multi_select: true,

  // Reports
  reports_enabled: true,
  reports_calendar_enabled: true,
  reports_job_card_enabled: true,
  reports_batch_enabled: true,
  reports_auto_export: false,

  // People
  people_show_reps: true,
  people_show_mgmt: true,
  people_show_csrs: true,
  people_show_production: true,
  people_clickable_names: true,
  people_show_counts: true,

  // Clipboard
  clipboard_smart_formatting: true,
  clipboard_auto_format_paste: true,
  clipboard_show_day_copy: true,
  clipboard_show_week_copy: true,
  clipboard_preserve_formatting: true,

  // Find
  find_enabled: true,
  find_highlight_enabled: true,
  find_case_sensitive: false,
  find_whole_word: false,
  find_regex_enabled: false,
  find_show_counter: true,
  find_show_navigation: true,

  // Data
  dynamic_city_learning: true,
  city_whitelist_strict: false,
  show_learned_cities: true,
  auto_categorize_jobs: true
};

const DYNAMIC_CITIES_KEY = 'roofr_dynamic_cities';
const COLLAPSED_CATEGORIES_KEY = 'roofr_collapsed_categories';

function $(id) {
  return document.getElementById(id);
}

async function load() {
  // Populate CSR dropdown first
  populateCSRDropdown();

  // Load collapsed state for categories
  loadCollapsedCategories();

  chrome.storage.sync.get(defaults, (cfg) => {
    fields.forEach((k) => {
      const el = $(k);
      if (!el) return;

      if (k === 'theme') {
        el.value = cfg[k] || "light";
        applyThemePreview(cfg[k] || "light");
      } else if (k === 'callrail_user') {
        el.value = cfg[k] || "";
      } else if (el.type === 'checkbox') {
        el.checked = cfg[k] !== undefined ? cfg[k] : defaults[k];
      } else {
        el.value = cfg[k] || "";
      }
    });
  });
  await displayRegionsAndCities();
}

function populateCSRDropdown() {
  const dropdown = $("callrail_user");
  if (!dropdown) return;

  // Clear existing options except the first one
  while (dropdown.options.length > 1) {
    dropdown.remove(1);
  }

  // Add CSRs from PEOPLE_DATA
  PEOPLE_DATA.CSRS.forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    dropdown.appendChild(option);
  });
}

// Setup call handler selection dropdowns (for persistent CSR selection)
function setupCallHandlerDropdowns() {
  const csrDropdown = $("callrail_csr_setting");
  const productionDropdown = $("callrail_production_setting");
  const insuranceDropdown = $("callrail_insurance_setting");
  const mgmtDropdown = $("callrail_mgmt_setting");
  const currentHandlerDisplay = $("current_handler_name");

  // Populate CSR dropdown
  if (csrDropdown) {
    PEOPLE_DATA.CSRS.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      csrDropdown.appendChild(option);
    });
  }

  // Populate Production dropdown
  if (productionDropdown) {
    const production = PEOPLE_DATA.PRODUCTION || [];
    production.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      productionDropdown.appendChild(option);
    });
  }

  // Populate Insurance dropdown
  if (insuranceDropdown) {
    const insurance = ['Aaron Munz', 'Caite Bonomo'];
    insurance.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      insuranceDropdown.appendChild(option);
    });
  }

  // Populate Management dropdown
  if (mgmtDropdown) {
    PEOPLE_DATA.MGMT.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      mgmtDropdown.appendChild(option);
    });
  }

  // Load current selection
  chrome.storage.sync.get({ callrail_csr: '' }, (data) => {
    const currentHandler = data.callrail_csr || '';
    if (currentHandler && currentHandlerDisplay) {
      currentHandlerDisplay.textContent = currentHandler;
    }

    // Set the correct dropdown value based on current selection
    if (currentHandler) {
      // Check each category to find where the handler belongs
      if (PEOPLE_DATA.CSRS.includes(currentHandler) && csrDropdown) {
        csrDropdown.value = currentHandler;
      } else if ((PEOPLE_DATA.PRODUCTION || []).includes(currentHandler) && productionDropdown) {
        productionDropdown.value = currentHandler;
      } else if (['Aaron Munz', 'Caite Bonomo'].includes(currentHandler) && insuranceDropdown) {
        insuranceDropdown.value = currentHandler;
      } else if (PEOPLE_DATA.MGMT.includes(currentHandler) && mgmtDropdown) {
        mgmtDropdown.value = currentHandler;
      }
    }
  });

  // Function to update handler and clear other dropdowns
  function updateHandler(selectedDropdown, selectedValue) {
    const dropdowns = [csrDropdown, productionDropdown, insuranceDropdown, mgmtDropdown];

    // Clear other dropdowns
    dropdowns.forEach(dropdown => {
      if (dropdown && dropdown !== selectedDropdown) {
        dropdown.value = '';
      }
    });

    // Save to storage
    chrome.storage.sync.set({ callrail_csr: selectedValue }, () => {
      if (currentHandlerDisplay) {
        currentHandlerDisplay.textContent = selectedValue || 'None selected';
      }
      console.log('[Options] Call handler saved:', selectedValue);
    });
  }

  // Add change listeners to enforce mutual exclusivity
  if (csrDropdown) {
    csrDropdown.addEventListener('change', (e) => updateHandler(csrDropdown, e.target.value));
  }
  if (productionDropdown) {
    productionDropdown.addEventListener('change', (e) => updateHandler(productionDropdown, e.target.value));
  }
  if (insuranceDropdown) {
    insuranceDropdown.addEventListener('change', (e) => updateHandler(insuranceDropdown, e.target.value));
  }
  if (mgmtDropdown) {
    mgmtDropdown.addEventListener('change', (e) => updateHandler(mgmtDropdown, e.target.value));
  }
}

async function displayRegionsAndCities() {
  const data = await chrome.storage.sync.get({ [DYNAMIC_CITIES_KEY]: {} });
  const dynamicCities = data[DYNAMIC_CITIES_KEY] || { PHX: [], NORTH: [], SOUTH: [] };

  const regions = [
    { key: 'PHX', name: 'Greater Phoenix', containerId: 'cities-phx' },
    { key: 'NORTH', name: 'Up North', containerId: 'cities-north' },
    { key: 'SOUTH', name: 'Down South', containerId: 'cities-south' }
  ];

  for (const region of regions) {
    const container = $(region.containerId);
    if (!container) continue;

    const staticSet = CONFIG.REGION_CITY_WHITELISTS[region.key];
    const dynamicList = dynamicCities[region.key] || [];

    const allCities = new Set([...staticSet, ...dynamicList]);
    const sortedCities = Array.from(allCities).sort();

    container.innerHTML = '';
    sortedCities.forEach(city => {
      const pill = document.createElement('span');
      pill.className = 'city-pill';
      pill.textContent = city;
      if (dynamicList.includes(city) && !staticSet.has(city)) {
        pill.classList.add('dynamic');
        pill.title = 'This city was learned automatically.';
      }
      container.appendChild(pill);
    });
  }
}

function applyThemePreview(themeName) {
  const theme = THEMES[themeName];
  if (!theme) return;

  const root = document.documentElement;
  const colors = theme.colors;

  // Main colors
  root.style.setProperty('--bg', colors.bgSecondary);
  root.style.setProperty('--fg', colors.textPrimary);
  root.style.setProperty('--muted', colors.textMuted);
  root.style.setProperty('--border', colors.border);
  root.style.setProperty('--accent', colors.accent);
  root.style.setProperty('--accent-fg', colors.bgPrimary);
  root.style.setProperty('--section-bg', colors.bgPrimary);
  root.style.setProperty('--toggle-active', colors.accent);

  // Additional colors for dark mode support
  root.style.setProperty('--input-bg', colors.bgPrimary);
  root.style.setProperty('--card-bg', colors.bgPrimary);
  root.style.setProperty('--hover-bg', colors.bgTertiary);
  root.style.setProperty('--toggle-bg', colors.border);

  // Status colors
  root.style.setProperty('--success', colors.success);
  root.style.setProperty('--success-bg', colors.successBg);
  root.style.setProperty('--error', colors.error);
  root.style.setProperty('--error-bg', colors.errorBg);
  root.style.setProperty('--error-border', colors.errorBorder);
  root.style.setProperty('--warning', colors.warning);
  root.style.setProperty('--warning-bg', colors.warningBg);

  // Accent variants for gradients and highlights (theme-aware transparency)
  const isDark = themeName === 'dark';
  const accentRgb = isDark ? '96, 165, 250' : '59, 130, 246';
  root.style.setProperty('--accent-very-light', `rgba(${accentRgb}, ${isDark ? 0.15 : 0.05})`);
  root.style.setProperty('--accent-light', `rgba(${accentRgb}, ${isDark ? 0.25 : 0.1})`);
  root.style.setProperty('--accent-ring', `rgba(${accentRgb}, ${isDark ? 0.3 : 0.15})`);

  // Toggle knob - white on light, slightly off-white on dark for visibility
  root.style.setProperty('--toggle-knob', isDark ? '#e2e8f0' : '#ffffff');

  // Shadow color - more visible on dark themes
  root.style.setProperty('--shadow-color', isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.05)');

  // Update body background
  document.body.style.backgroundColor = colors.bgSecondary;
  document.body.style.color = colors.textPrimary;
}

// Debounce helper for auto-save
let saveTimeout = null;
function debouncedSave() {
  // Show saving indicator
  updateSaveIndicator('saving');

  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    save();
  }, 500);
}

function save() {
  const out = {};
  fields.forEach((k) => {
    const el = $(k);
    if (!el) return;

    if (el.type === 'checkbox') {
      out[k] = el.checked;
    } else {
      out[k] = (el.value || "").trim();
    }
  });

  chrome.storage.sync.set(out, () => {
    updateSaveIndicator('saved');
    // Reset to normal after 2 seconds
    setTimeout(() => {
      updateSaveIndicator('idle');
    }, 2000);
  });
}

function updateSaveIndicator(state) {
  const indicator = $("autoSaveIndicator");
  const text = $("autoSaveText");
  if (!indicator || !text) return;

  indicator.classList.remove('saving', 'saved');

  switch (state) {
    case 'saving':
      indicator.classList.add('saving');
      text.textContent = 'Saving...';
      break;
    case 'saved':
      indicator.classList.add('saved');
      text.textContent = 'Saved!';
      break;
    default:
      text.textContent = 'Auto-save enabled';
  }
}

function resetAllSettings() {
  if (!confirm('Are you sure you want to reset ALL settings to their defaults? This cannot be undone.')) {
    return;
  }

  // Reset all fields to defaults
  chrome.storage.sync.set(defaults, () => {
    // Reload the page to reflect changes
    load();
    updateSaveIndicator('saved');
    setTimeout(() => {
      updateSaveIndicator('idle');
    }, 2000);
  });
}

function resetPeopleToDefaults() {
  const repsEl = $("PEOPLE_REPS");
  const mgmtEl = $("PEOPLE_MGMT");
  const csrsEl = $("PEOPLE_CSRS");

  if (repsEl) repsEl.value = PEOPLE_DATA.REPS.join(", ");
  if (mgmtEl) mgmtEl.value = PEOPLE_DATA.MGMT.join(", ");
  if (csrsEl) csrsEl.value = PEOPLE_DATA.CSRS.join(", ");

  const resetBtn = $("resetPeopleBtn");
  if (resetBtn) {
    const originalText = resetBtn.textContent;
    resetBtn.textContent = "Reset!";
    resetBtn.style.backgroundColor = "#16a34a";
    resetBtn.style.color = "#fff";
    setTimeout(() => {
      resetBtn.textContent = originalText;
      resetBtn.style.backgroundColor = "";
      resetBtn.style.color = "";
    }, 1500);
  }
}

// Category collapse/expand functionality
function setupCategoryCollapse() {
  const categories = document.querySelectorAll('.category');

  categories.forEach(category => {
    const header = category.querySelector('.category-header');
    if (!header) return;

    header.addEventListener('click', () => {
      category.classList.toggle('collapsed');
      saveCollapsedCategories();
    });
  });
}

function loadCollapsedCategories() {
  chrome.storage.local.get({ [COLLAPSED_CATEGORIES_KEY]: [] }, (data) => {
    const collapsed = data[COLLAPSED_CATEGORIES_KEY] || [];
    collapsed.forEach(categoryName => {
      const category = document.querySelector(`.category[data-category="${categoryName}"]`);
      if (category) {
        category.classList.add('collapsed');
      }
    });
  });
}

function saveCollapsedCategories() {
  const collapsed = [];
  document.querySelectorAll('.category.collapsed').forEach(category => {
    const name = category.dataset.category;
    if (name) collapsed.push(name);
  });
  chrome.storage.local.set({ [COLLAPSED_CATEGORIES_KEY]: collapsed });
}

// Setup auto-save listeners on all form elements
function setupAutoSave() {
  fields.forEach((k) => {
    const el = $(k);
    if (!el) return;

    if (el.type === 'checkbox') {
      el.addEventListener('change', debouncedSave);
    } else if (el.tagName === 'SELECT') {
      el.addEventListener('change', debouncedSave);
    } else {
      // Text inputs - save on blur or after typing stops
      el.addEventListener('input', debouncedSave);
      el.addEventListener('blur', debouncedSave);
    }
  });
}

// Setup navigation links
function setupNavigation() {
  const navLinks = document.querySelectorAll('.nav-link');
  const categories = document.querySelectorAll('.category');

  // Click handler for nav links
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = link.getAttribute('data-target');
      const target = document.getElementById(targetId);
      if (target) {
        // Account for sticky header height
        const headerHeight = document.querySelector('.sticky-nav')?.offsetHeight || 0;
        const targetPosition = target.getBoundingClientRect().top + window.scrollY - headerHeight - 16;
        window.scrollTo({ top: targetPosition, behavior: 'smooth' });

        // Update active state
        navLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
      }
    });
  });

  // Scroll spy to highlight active section
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        navLinks.forEach(link => {
          link.classList.toggle('active', link.getAttribute('data-target') === id);
        });
      }
    });
  }, {
    rootMargin: '-20% 0px -60% 0px',
    threshold: 0
  });

  categories.forEach(category => {
    if (category.id) {
      observer.observe(category);
    }
  });
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  load();
  setupCategoryCollapse();
  setupAutoSave();
  setupNavigation();
  setupCallHandlerDropdowns();
});

document.getElementById("resetAllBtn")?.addEventListener("click", resetAllSettings);
document.getElementById("resetPeopleBtn")?.addEventListener("click", resetPeopleToDefaults);
document.getElementById("theme")?.addEventListener("change", (e) => {
  applyThemePreview(e.target.value);
});

// ========================================
// AUTO-UPDATE FUNCTIONALITY
// ========================================

let currentUpdateInfo = null;

// Display current extension version
function displayVersion() {
  const versionDisplay = document.getElementById('version-display');
  if (versionDisplay) {
    const version = chrome.runtime.getManifest().version;
    versionDisplay.textContent = `Version ${version}`;
  }
}

// Check and display update if available
async function checkAndDisplayUpdate() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_UPDATE_STATUS' });
    if (response?.update?.available) {
      currentUpdateInfo = response.update;
      displayUpdateBanner(response.update);
    }
  } catch (e) {
    console.warn('[Options] Failed to check update status:', e);
  }
}

// Display the update banner
function displayUpdateBanner(update) {
  const updateCategory = document.getElementById('update-category');
  const versionInfo = document.getElementById('update-version-info');
  const changelogContainer = document.getElementById('update-changelog-container');

  if (!updateCategory) return;

  // Show the category
  updateCategory.style.display = 'block';

  // Update version info
  if (versionInfo) {
    versionInfo.innerHTML = `<strong>Current:</strong> v${update.currentVersion} → <strong>New:</strong> v${update.newVersion}`;
  }

  // Show changelog if available
  if (changelogContainer && update.changelog && update.changelog.length > 0) {
    changelogContainer.innerHTML = `
      <strong style="font-size: 13px;">What's new:</strong>
      <ul style="margin: 8px 0 0 20px; font-size: 13px; color: var(--fg);">
        ${update.changelog.map(item => `<li>${item}</li>`).join('')}
      </ul>
    `;
  }

  // Scroll to the update banner
  updateCategory.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Download button handler
document.getElementById('download-update-btn')?.addEventListener('click', () => {
  if (currentUpdateInfo?.downloadUrl) {
    window.open(currentUpdateInfo.downloadUrl, '_blank');
  }
});

// View release notes button handler
document.getElementById('view-release-btn')?.addEventListener('click', () => {
  if (currentUpdateInfo?.releaseNotesUrl) {
    window.open(currentUpdateInfo.releaseNotesUrl, '_blank');
  }
});

// Dismiss button handler
document.getElementById('dismiss-update-btn')?.addEventListener('click', async () => {
  if (currentUpdateInfo?.newVersion) {
    await chrome.runtime.sendMessage({
      type: 'DISMISS_UPDATE',
      version: currentUpdateInfo.newVersion
    });
    const updateCategory = document.getElementById('update-category');
    if (updateCategory) {
      updateCategory.style.display = 'none';
    }
    currentUpdateInfo = null;
  }
});

// Manual update check button
document.getElementById('check-updates-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('check-updates-btn');
  const originalText = btn.textContent;
  btn.textContent = 'Checking...';
  btn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_FOR_UPDATES' });

    if (response?.update) {
      currentUpdateInfo = response.update;
      displayUpdateBanner(response.update);
      btn.textContent = 'Update Found!';
      btn.style.background = 'var(--success-bg)';
      btn.style.color = 'var(--success)';
    } else {
      btn.textContent = 'Up to Date!';
      btn.style.background = 'var(--success-bg)';
      btn.style.color = 'var(--success)';
    }
  } catch (e) {
    btn.textContent = 'Check Failed';
    btn.style.background = 'var(--error-bg)';
    btn.style.color = 'var(--error)';
  }

  setTimeout(() => {
    btn.textContent = originalText;
    btn.style.background = '';
    btn.style.color = '';
    btn.disabled = false;
  }, 3000);
});

// Initialize update checking on page load
document.addEventListener('DOMContentLoaded', () => {
  displayVersion();
  checkAndDisplayUpdate();
});

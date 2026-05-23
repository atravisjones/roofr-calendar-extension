# Roofr Calendar Scraper

A Chrome extension that scrapes appointments from the Roofr calendar, cross-references availability from Google Sheets, integrates with CallTrackingMetrics for incoming-call handling, and provides batch scheduling automation for Arizona Roofers' CSR team.

Internal team tool. Distributed via self-hosted CRX, not the Chrome Web Store.

## Install

Latest release: [v2.0.6](https://github.com/atravisjones/roofr-calendar-extension/releases/latest)

1. Download `roofr-calendar-scraper.crx` from the release page.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Drag the `.crx` onto the page, accept the install prompt.
5. The extension lives in the side panel (click the puzzle-piece icon → pin "Roofr Calendar Scraper").

Auto-updates work via Chrome's native update mechanism (`update_url` in `manifest.json` points at `updates.xml` in this repo).

## Migrating from v2.0.5 or earlier

The signing key was rotated in v2.0.6 for security reasons, so the extension ID changed (`gkmid...` → `cmlgo...`). Auto-update won't work across the rotation. To migrate:

1. Open `chrome://extensions`.
2. Remove the old "Roofr Calendar Scraper" (ID starts with `gkmid`).
3. Install v2.0.6 fresh via the steps above.

After v2.0.6, future updates work normally.

## Development

```bash
npm install
node scripts/build-crx.cjs   # builds releases/roofr-calendar-scraper.crx
```

The build script uses `extension.pem` for signing. **`extension.pem` must never be committed** — it's gitignored. If `extension.pem` doesn't exist, the script auto-generates one, but a new key produces a new extension ID, which would break every existing install. The current key is backed up off-machine; ask Travis if you need to rebuild.

### Loading unpacked (faster dev loop)

For local iteration, you can load the folder directly without building a CRX:

1. Open `chrome://extensions`.
2. Click **Load unpacked**.
3. Select the extension folder.

Note that unpacked installs get a different extension ID than the released CRX, so they don't participate in the auto-update channel.

## Architecture

- `manifest.json` — MV3 manifest. Side panel + service worker + content scripts on Roofr / CTM / Google Earth.
- `service_worker.js` — Orchestrates tab management, CTM call handling, batch phone lookups against Supabase, periodic update checks.
- `content.js` — Page-injected automation. Scrapes the Roofr calendar (React Big Calendar), drives invitee editing, batch report flows.
- `popup.html` / `popup.js` — The side panel UI. Scanner, batch reports, CTM panel, dock notes, address autocomplete.
- `dialer.html` / `dialer.js` / `dialer-bridge*.js` — Auto-dialer for CTM. Opened via `Alt+Shift+D`.
- `batch-dashboard.html` — Out-of-band batch run dashboard, opened from the Reports tab.
- `config.js` — City/region whitelists, APN service config, recommendation logic.
- `scripts/build-crx.cjs` — Packs the listed extension files into a signed CRX.
- `updates.xml` — Update manifest served via raw.githubusercontent.com; Chrome polls this to find new versions.

## External dependencies (runtime)

The extension talks to: Roofr, CallTrackingMetrics, Google Earth, Gemini, Geoapify (address autocomplete), LocationIQ (address autocomplete), Google Sheets API, US Census Geocoder, Supabase (KPI project), and Arizona Roofers' internal Vercel apps (`roofr-search`, `az-roofers-tech-scheduler`, `speed-to-leads`). All declared in `manifest.json` `host_permissions`.

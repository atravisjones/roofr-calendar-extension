#!/usr/bin/env node
/**
 * Produce a LOCAL, UNSIGNED test build you can load unpacked.
 *
 * Why: the real manifest.json has a `key` that pins the extension ID to the
 * force-installed (Workspace-managed) ID. Chrome refuses to load an unpacked
 * copy with that same ID ("blocked by the administrator"). This script copies
 * the current extension into a sibling folder OUTSIDE the repo and strips the
 * `key`, so it loads under a fresh random ID and you can test the live code.
 *
 *   npm run test:local
 *   -> then chrome://extensions -> Load unpacked -> the printed folder
 *
 * The proxy auth (X-Dialer-Client header) is ID-independent, so county/roof
 * lookups still work from the test build.
 */
const fs = require('fs');
const path = require('path');
const { extensionFiles, extensionDirs } = require('./extension-files.cjs');

const root = path.join(__dirname, '..');
// Lives next to the (7) test folder in "Arizona Roofers Tools" (OUTSIDE the repo —
// never tracked, never deployed). Override with ROOFR_LOCAL_TEST_DIR.
const dest = process.env.ROOFR_LOCAL_TEST_DIR
  || 'C:\\Users\\atrav\\Downloads\\Arizona Roofers Tools\\roofr-calendar-test';

const copyDir = (src, d) => {
  fs.mkdirSync(d, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), t = path.join(d, e.name);
    if (e.isDirectory()) copyDir(s, t); else fs.copyFileSync(s, t);
  }
};

fs.mkdirSync(dest, { recursive: true });

let copied = 0; const missing = [];
for (const f of extensionFiles) {
  const s = path.join(root, f);
  if (fs.existsSync(s)) { fs.copyFileSync(s, path.join(dest, f)); copied++; }
  else missing.push(f);
}
for (const dir of extensionDirs) {
  const s = path.join(root, dir);
  if (fs.existsSync(s)) { copyDir(s, path.join(dest, dir)); copied++; }
  else missing.push(dir + '/');
}

// Strip the `key` so the unpacked build gets a fresh ID (not the blocked managed one).
const mPath = path.join(dest, 'manifest.json');
const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
const hadKey = !!m.key;
delete m.key;
m.name = (m.name || 'Roofr Calendar Scraper') + ' (LOCAL TEST)';
fs.writeFileSync(mPath, JSON.stringify(m, null, 2));

console.log(`\n✅ Local test build ready (${copied} items${missing.length ? ', missing: ' + missing.join(',') : ''}).`);
console.log(`   key stripped: ${hadKey ? 'yes' : 'no key was present'} -> loads under a fresh ID, not the blocked managed one.`);
console.log(`   Load unpacked at chrome://extensions:\n   ${dest}`);

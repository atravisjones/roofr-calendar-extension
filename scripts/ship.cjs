#!/usr/bin/env node
/**
 * One-command release.
 *   npm run ship            -> patch bump (2.1.2 -> 2.1.3)
 *   npm run ship -- minor   -> minor bump (2.1.2 -> 2.2.0)
 *   npm run ship -- major   -> major bump (2.1.2 -> 3.0.0)
 *
 * Bumps the version everywhere (manifest, package.json, updates.xml),
 * commits, tags, and pushes. GitHub Actions then builds + signs the .crx
 * and every managed Chrome auto-updates. You do nothing else.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const type = process.argv[2] || 'patch';
const root = path.join(__dirname, '..');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

// Mirror the freshly-bumped extension into the local unpacked test folder so it always
// matches what was just released. Multiple chats may edit this repo — this keeps the
// test folder honest instead of drifting to a stale/ahead version number.
// Override the location with ROOFR_TEST_DIR; skips silently if the folder isn't present
// (e.g. shipping from another machine).
function syncToTestFolder(version) {
  const { extensionFiles, extensionDirs } = require('./extension-files.cjs');
  const testDir = process.env.ROOFR_TEST_DIR
    || 'C:\\Users\\atrav\\Downloads\\Arizona Roofers Tools\\roofr-calendar-assistant (7)\\roofr-calendar-assistant';
  if (!fs.existsSync(testDir)) {
    console.log(`\n(test folder not found — skipping local sync: ${testDir})`);
    return;
  }
  const copyDir = (src, dest) => {
    fs.mkdirSync(dest, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name), d = path.join(dest, e.name);
      if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
    }
  };
  let copied = 0; const missing = [];
  for (const f of extensionFiles) {
    const s = path.join(root, f);
    if (fs.existsSync(s)) { fs.copyFileSync(s, path.join(testDir, f)); copied++; }
    else missing.push(f);
  }
  for (const dir of extensionDirs) {
    const s = path.join(root, dir);
    if (fs.existsSync(s)) { copyDir(s, path.join(testDir, dir)); copied++; }
    else missing.push(dir + '/');
  }
  console.log(`\n🔄 Synced v${version} to test folder (${copied} items): ${testDir}`);
  if (missing.length) console.log(`   (skipped missing: ${missing.join(', ')})`);
}

// Refuse to ship from a clone whose history contains the signing key.
try {
  const hits = execSync('git log --all --oneline -- extension.pem', { cwd: root }).toString().trim();
  if (hits) {
    console.error('\nABORT: this clone has extension.pem in its git history — pushing could leak the signing key.');
    console.error('Release from the clean clone at C:\\Users\\atrav\\roofr-calendar-extension instead.\n');
    process.exit(1);
  }
} catch (_) { /* git log fine */ }

run('git pull --ff-only');
run(`node scripts/bump-version.cjs ${type}`);
const v = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
run('git add -A');
run(`git commit -m "v${v}"`);
run(`git tag v${v}`);
run('git push');
run('git push --tags');
syncToTestFolder(v);
console.log(`\n✅ Shipped v${v}.`);
console.log('   CI is building + signing now: https://github.com/atravisjones/roofr-calendar-extension/actions');
console.log('   Every managed Chrome auto-updates within a few hours.');

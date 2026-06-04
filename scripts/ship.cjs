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
console.log(`\n✅ Shipped v${v}.`);
console.log('   CI is building + signing now: https://github.com/atravisjones/roofr-calendar-extension/actions');
console.log('   Every managed Chrome auto-updates within a few hours.');

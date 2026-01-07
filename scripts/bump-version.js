#!/usr/bin/env node

/**
 * Version Bump Script
 * Usage: node scripts/bump-version.js [patch|minor|major]
 *
 * Updates version in:
 * - manifest.json
 * - package.json
 * - update/manifest.json
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const bumpType = args[0] || 'patch';

if (!['patch', 'minor', 'major'].includes(bumpType)) {
    console.error('Usage: node scripts/bump-version.js [patch|minor|major]');
    process.exit(1);
}

function bumpVersion(version, type) {
    const parts = version.split('.').map(Number);
    switch (type) {
        case 'major':
            return `${parts[0] + 1}.0.0`;
        case 'minor':
            return `${parts[0]}.${parts[1] + 1}.0`;
        case 'patch':
        default:
            return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
    }
}

const rootDir = path.join(__dirname, '..');

// Read and update manifest.json
const manifestPath = path.join(rootDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const oldVersion = manifest.version;
const newVersion = bumpVersion(oldVersion, bumpType);

manifest.version = newVersion;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Updated manifest.json: ${oldVersion} -> ${newVersion}`);

// Read and update package.json
const packagePath = path.join(rootDir, 'package.json');
if (fs.existsSync(packagePath)) {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    packageJson.version = newVersion;
    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');
    console.log(`Updated package.json: ${newVersion}`);
}

// Read and update update/manifest.json
const updateManifestPath = path.join(rootDir, 'update', 'manifest.json');
if (fs.existsSync(updateManifestPath)) {
    const updateManifest = JSON.parse(fs.readFileSync(updateManifestPath, 'utf8'));
    updateManifest.version = newVersion;
    updateManifest.release_date = new Date().toISOString();

    // Update download URLs with new version
    if (updateManifest.download_url) {
        updateManifest.download_url = updateManifest.download_url.replace(
            /v[\d.]+\/roofr-calendar-scraper-v[\d.]+\.zip/,
            `v${newVersion}/roofr-calendar-scraper-v${newVersion}.zip`
        );
    }
    if (updateManifest.release_notes_url) {
        updateManifest.release_notes_url = updateManifest.release_notes_url.replace(
            /\/v[\d.]+$/,
            `/v${newVersion}`
        );
    }

    fs.writeFileSync(updateManifestPath, JSON.stringify(updateManifest, null, 2) + '\n');
    console.log(`Updated update/manifest.json: ${newVersion}`);
}

console.log('');
console.log(`Version bumped: ${oldVersion} -> ${newVersion}`);
console.log('');
console.log('Next steps:');
console.log('1. Update the changelog in update/manifest.json');
console.log('2. Commit and push changes');
console.log(`3. Create tag: git tag v${newVersion} && git push --tags`);

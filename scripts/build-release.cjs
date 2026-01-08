#!/usr/bin/env node

/**
 * Build Release Script
 * Creates a distributable .zip file of the Chrome extension
 *
 * Usage: node scripts/build-release.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const releaseDir = path.join(rootDir, 'releases');

// Read version from manifest
const manifest = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8')
);
const version = manifest.version;

console.log(`Building release v${version}...`);

// Create releases directory if it doesn't exist
if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
}

// Files to include in the release
const filesToInclude = [
    'manifest.json',
    'service_worker.js',
    'content.js',
    'popup.html',
    'popup.js',
    'options.html',
    'options.js',
    'config.js',
    'themes.js',
    'metadata.json'
];

// Check if archiver is available, if not use built-in zip (Windows) or zip command
let useArchiver = false;
try {
    require.resolve('archiver');
    useArchiver = true;
} catch (e) {
    console.log('archiver not installed, using system zip...');
}

const zipPath = path.join(releaseDir, `roofr-calendar-scraper-v${version}.zip`);

// Remove old zip if exists
if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
}

if (useArchiver) {
    // Use archiver for cross-platform zip creation
    const archiver = require('archiver');
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
        console.log(`Created: ${zipPath}`);
        console.log(`Size: ${(archive.pointer() / 1024).toFixed(2)} KB`);
        printNextSteps(version, zipPath);
    });

    archive.on('error', (err) => { throw err; });
    archive.pipe(output);

    // Add files
    filesToInclude.forEach(file => {
        const filePath = path.join(rootDir, file);
        if (fs.existsSync(filePath)) {
            archive.file(filePath, { name: file });
        } else {
            console.warn(`Warning: ${file} not found, skipping...`);
        }
    });

    archive.finalize();
} else {
    // Fallback: Create a simple file list for manual zipping
    console.log('');
    console.log('Please manually create a zip file with these files:');
    filesToInclude.forEach(file => {
        const filePath = path.join(rootDir, file);
        if (fs.existsSync(filePath)) {
            console.log(`  - ${file}`);
        }
    });
    console.log('');
    console.log(`Save as: ${zipPath}`);

    // Try PowerShell Compress-Archive on Windows
    if (process.platform === 'win32') {
        try {
            const existingFiles = filesToInclude
                .filter(f => fs.existsSync(path.join(rootDir, f)))
                .map(f => `"${path.join(rootDir, f)}"`)
                .join(',');

            const psCommand = `Compress-Archive -Path ${existingFiles} -DestinationPath "${zipPath}" -Force`;
            execSync(`powershell -Command "${psCommand}"`, { stdio: 'inherit' });
            console.log(`Created: ${zipPath}`);
            printNextSteps(version, zipPath);
        } catch (e) {
            console.error('PowerShell zip failed:', e.message);
        }
    }
}

function printNextSteps(version, zipPath) {
    console.log('');
    console.log('Next steps:');
    console.log(`1. Create a GitHub release with tag v${version}`);
    console.log(`2. Upload ${path.basename(zipPath)} to the release`);
    console.log('3. Update the changelog in update/manifest.json');
    console.log('4. Commit and push the update/manifest.json changes');
}

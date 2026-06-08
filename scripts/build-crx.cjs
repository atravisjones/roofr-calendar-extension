const ChromeExtension = require('crx');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rootDir = path.join(__dirname, '..');
const releasesDir = path.join(rootDir, 'releases');
const keyPath = path.join(rootDir, 'extension.pem');

// Files/dirs that make up the extension — single source of truth shared with ship.cjs
// (see scripts/extension-files.cjs) so the local test folder always matches the CRX.
const { extensionFiles, extensionDirs } = require('./extension-files.cjs');

function generatePrivateKey() {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
    });
    return privateKey;
}

function copyDirRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDirRecursive(s, d);
        else fs.copyFileSync(s, d);
    }
}

async function buildCrx() {
    const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
    const version = manifest.version;

    console.log(`Building CRX for v${version}...`);

    if (!fs.existsSync(releasesDir)) {
        fs.mkdirSync(releasesDir, { recursive: true });
    }

    const tempDir = path.join(releasesDir, 'temp-extension');
    if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });

    for (const file of extensionFiles) {
        const srcPath = path.join(rootDir, file);
        const destPath = path.join(tempDir, file);
        if (fs.existsSync(srcPath)) {
            fs.copyFileSync(srcPath, destPath);
        } else {
            console.warn(`Warning: ${file} not found, skipping`);
        }
    }

    for (const dir of extensionDirs) {
        const srcDir = path.join(rootDir, dir);
        if (fs.existsSync(srcDir)) {
            copyDirRecursive(srcDir, path.join(tempDir, dir));
        } else {
            console.warn(`Warning: directory ${dir} not found, skipping`);
        }
    }

    let privateKey;
    if (fs.existsSync(keyPath)) {
        console.log('Using existing private key...');
        privateKey = fs.readFileSync(keyPath);
    } else {
        console.log('Generating new private key...');
        privateKey = generatePrivateKey();
        fs.writeFileSync(keyPath, privateKey);
        console.log(`Private key saved to: ${keyPath}`);
        console.log('\n⚠️  IMPORTANT: Keep extension.pem safe and secret!');
        console.log('   You need the same key to sign future updates.\n');
    }

    const crx = new ChromeExtension({
        codebase: `https://github.com/atravisjones/roofr-calendar-extension/releases/latest/download/roofr-calendar-scraper.crx`,
        privateKey: privateKey
    });

    try {
        await crx.load(tempDir);
        const crxBuffer = await crx.pack();

        const crxPath = path.join(releasesDir, 'roofr-calendar-scraper.crx');
        fs.writeFileSync(crxPath, crxBuffer);
        console.log(`CRX saved to: ${crxPath}`);
        console.log(`\nExtension ID: ${crx.appId}`);

        fs.rmSync(tempDir, { recursive: true });
        return crx.appId;
    } catch (err) {
        console.error('Error building CRX:', err);
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true });
        }
        process.exit(1);
    }
}

buildCrx();

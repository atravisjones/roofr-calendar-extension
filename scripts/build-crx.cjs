const ChromeExtension = require('crx');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rootDir = path.join(__dirname, '..');
const releasesDir = path.join(rootDir, 'releases');
const keyPath = path.join(rootDir, 'extension.pem');

// Files to include in the extension
const extensionFiles = [
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

function generatePrivateKey() {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: {
            type: 'pkcs1',
            format: 'pem'
        },
        publicKeyEncoding: {
            type: 'pkcs1',
            format: 'pem'
        }
    });
    return privateKey;
}

async function buildCrx() {
    // Get version from manifest
    const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
    const version = manifest.version;

    console.log(`Building CRX for v${version}...`);

    // Ensure releases directory exists
    if (!fs.existsSync(releasesDir)) {
        fs.mkdirSync(releasesDir, { recursive: true });
    }

    // Create a temp directory with only the extension files
    const tempDir = path.join(releasesDir, 'temp-extension');
    if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });

    // Copy extension files to temp directory
    for (const file of extensionFiles) {
        const srcPath = path.join(rootDir, file);
        const destPath = path.join(tempDir, file);
        if (fs.existsSync(srcPath)) {
            fs.copyFileSync(srcPath, destPath);
        } else {
            console.warn(`Warning: ${file} not found, skipping`);
        }
    }

    // Load or generate private key
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

        // Save the .crx file
        const crxPath = path.join(releasesDir, 'roofr-calendar-scraper.crx');
        fs.writeFileSync(crxPath, crxBuffer);
        console.log(`CRX saved to: ${crxPath}`);

        // Get extension ID from the crx
        console.log(`\nExtension ID: ${crx.appId}`);
        console.log('\nNext steps:');
        console.log('1. Upload roofr-calendar-scraper.crx to GitHub releases');
        console.log('2. Update updates.xml with the extension ID');
        console.log('3. Deploy Chrome policy to force-install the extension');

        // Clean up temp directory
        fs.rmSync(tempDir, { recursive: true });

        return crx.appId;
    } catch (err) {
        console.error('Error building CRX:', err);
        // Clean up temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true });
        }
        process.exit(1);
    }
}

buildCrx();

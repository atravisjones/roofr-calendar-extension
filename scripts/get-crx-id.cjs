const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Read the private key
const keyPath = path.join(__dirname, '..', 'extension.pem');
const privateKey = fs.readFileSync(keyPath, 'utf8');

// Extract public key from private key
const keyObject = crypto.createPrivateKey(privateKey);
const publicKey = crypto.createPublicKey(keyObject);

// Export as DER format
const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });

// Calculate SHA256 hash
const hash = crypto.createHash('sha256').update(publicKeyDer).digest('hex');

// Convert first 32 hex chars to extension ID format (a-p instead of 0-f)
const idHex = hash.substring(0, 32);
const extensionId = idHex.split('').map(c => {
    const num = parseInt(c, 16);
    return String.fromCharCode('a'.charCodeAt(0) + num);
}).join('');

console.log('Extension ID:', extensionId);

// Single source of truth for which files/dirs make up the unpacked extension.
//
// Used by BOTH:
//   - build-crx.cjs : what gets packed + signed into the distributed CRX
//   - ship.cjs      : what gets mirrored into the local unpacked test folder
//
// Keeping one list means the test folder always matches the released extension.
// When you add a new file the extension loads, add it here (and to manifest.json).
module.exports = {
  extensionFiles: [
    'manifest.json',
    'service_worker.js',
    'content.js',
    'roofr-material-order-newtab.js',
    'popup.html',
    'popup.js',
    'options.html',
    'options.js',
    'config.js',
    'themes.js',
    'metadata.json',
    'batch-dashboard.html',
    'dialer.html',
    'dialer.js',
    'dialer-bridge.js',
    'dialer-bridge-main.js',
    'dialer-sources.js',
    'attachment-viewer.html',
    'attachment-viewer.js'
  ],
  // Directories whose entire contents ship with the extension (e.g. icons/).
  extensionDirs: ['icons']
};

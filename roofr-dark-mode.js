// roofr-dark-mode.js - Inverts Roofr's colors when "Dark Mode on Roofr" is enabled.
// Standalone content script at document_start so the page paints dark without a white flash.
// Toggled live from the side panel Settings via chrome.storage.sync ('roofr_dark_mode').

(function () {
    const STORAGE_KEY = 'roofr_dark_mode';
    const STYLE_ID = 'rda-dark-mode-style';
    const HTML_CLASS = 'rda-dark-mode';

    // html must carry an explicit white background: the root canvas isn't affected
    // by filter, so without it the page would stay white behind inverted content.
    // Filter goes on <html>, not <body> — a filter on body breaks position:fixed.
    const CSS = `
html.${HTML_CLASS} {
    filter: invert(1) hue-rotate(180deg);
    background: #fff;
}
/* Re-invert media so photos, maps, and videos keep their real colors */
html.${HTML_CLASS} :is(img, video, picture, canvas, iframe, embed, object),
html.${HTML_CLASS} [style*="background-image"] {
    filter: invert(1) hue-rotate(180deg);
}
/* Media nested inside a re-inverted background-image element would get
   flipped a third time - cancel the filter there so it stays true-color. */
html.${HTML_CLASS} [style*="background-image"] :is(img, video, picture, canvas) {
    filter: none;
}
`;

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        // head may not exist yet at document_start; documentElement always does
        (document.head || document.documentElement).appendChild(style);
    }

    function setEnabled(on) {
        if (on) {
            ensureStyle();
            document.documentElement.classList.add(HTML_CLASS);
        } else {
            document.documentElement.classList.remove(HTML_CLASS);
        }
    }

    chrome.storage.sync.get(STORAGE_KEY, (result) => {
        setEnabled(!!result[STORAGE_KEY]);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes[STORAGE_KEY]) {
            setEnabled(!!changes[STORAGE_KEY].newValue);
        }
    });
})();

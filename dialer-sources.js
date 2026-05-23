/**
 * Lead-source → CTM outbound tracking-number mapping.
 *
 * Loaded into both dialer.js (to compute the outbound number per lead) and
 * dialer-bridge-main.js (to set it on <ctm-phone-embed> before .call()).
 *
 * Keep `outboundNumber` as +E.164 — that's how the CTM softphone dropdown
 * values are stored. Names are CTM's display labels.
 */
(function (root) {
  const SOURCE_TO_OUTBOUND = {
    "AZROOFCO WEBSITE":              { number: "+16028549605", name: "SEO Website Forms" },
    "AZROOFCO GOOGLE SEARCH ADS":    { number: "+16027045620", name: "Google Search Ads Forms" },
    "Modernize":                     { number: "+16025079882", name: "Modernize" },
    "NCT":                           { number: "+16025079610", name: "NCT Media" },
    "AZROOFCO ANGIS LEADS":          { number: "+16026380471", name: "Angie Ads" },
    "AZROOFCO ANGIS ADS":            { number: "+16026380471", name: "Angie Ads" },
    "GAF":                           { number: "+14805884668", name: "Arizona Roofers Main Line" },
    "":                              { number: "+14805884668", name: "Arizona Roofers Main Line" },
  };

  function lookupOutbound(sourceLabel) {
    const key = (sourceLabel || "").trim();
    return SOURCE_TO_OUTBOUND[key] || null;
  }

  const api = { SOURCE_TO_OUTBOUND, lookupOutbound };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.DialerSources = api;
  }
})(typeof window !== "undefined" ? window : globalThis);

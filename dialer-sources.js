/**
 * Lead-source → CTM outbound tracking-number mapping.
 *
 * Loaded into both dialer.js (to compute the outbound number per lead) and
 * dialer-bridge-main.js (to set it on <ctm-phone-embed> before .call()).
 *
 * Keep `number` as +E.164 — that's how the CTM softphone dropdown values are
 * stored. `name` is CTM's display label.
 *
 * Two label families live here:
 *   - Form Leads sheet source labels (AZROOFCO …, Arizona Roofers WEBSITE …).
 *   - Roofr job `lead_source` labels (Arizona Roofers LSA, AZ Roof Pro GMB, …),
 *     used by the Welcome Calls dialer. Numbers verified against the CTM
 *     account (541914) tracking-number list 2026-06-26.
 *
 * Lookup is normalized (trim + lowercase + collapsed whitespace) so label
 * casing/spacing variants ("AZ Roof PRO GMB" vs "AZ Roof Pro GMB", trailing
 * spaces) all resolve. Sources with no dedicated tracking number (self-gen,
 * door knocking, etc.) fall back to the Arizona Roofers Main Line.
 */
(function (root) {
  const MAIN_LINE = { number: "+14805884668", name: "Arizona Roofers Main Line" };

  const SOURCE_TO_OUTBOUND = {
    // ── Form Leads sheet source labels (existing) ──
    "Arizona Roofers WEBSITE FORMS":       { number: "+16028549605", name: "SEO Website Forms" },
    "Arizona Roofers GOOGLE SEARCH ADS":   { number: "+16027045620", name: "Google Search Ads Forms" },
    "AZROOFCO WEBSITE":                    { number: "+16028549605", name: "SEO Website Forms" },
    "AZROOFCO GOOGLE SEARCH ADS":          { number: "+16027045620", name: "Google Search Ads Forms" },
    "NCT":                                 { number: "+16025079610", name: "NCT Media" },
    "GAF":                                 MAIN_LINE,

    // ── Roofr job lead_source labels (Welcome Calls dialer) ──
    // LSA leads arrive as Google LSA *messages* → call back from the matching LSA Messages line.
    "Arizona Roofers LSA":                 { number: "+16027557576", name: "Arizona Roofers LSA Messages" },
    "AZ Roof Pro LSA":                     { number: "+16026710260", name: "AZ Roof Pro LSA Messages" },
    "Arizona Roofers GMB":                 { number: "+14806138932", name: "Arizona Roofers GMB" },
    "AZ Roof Pro GMB":                     { number: "+14809169444", name: "AZ Roof Pro GMB" },
    "Arizona Roof PRO GMB":                { number: "+14809169444", name: "AZ Roof Pro GMB" },
    "SEO Website Forms":                   { number: "+16028549605", name: "SEO Website Forms" },
    // CTM source "SEO Website Calls - Multi-Organic Search" → Multi-Organic number
    // (verified vs CTM call data 2026-06-26; the old +14805316383 Hard-Set line is dormant).
    "SEO Website Calls":                   { number: "+14807906153", name: "SEO Website Calls (Multi-Organic)" },
    "SEO Website Calls - Multi-Organic Search": { number: "+14807906153", name: "SEO Website Calls (Multi-Organic)" },
    "Google Search Ads Forms":             { number: "+16027045620", name: "Google Search Ads Forms" },
    "Google Search Ads Calls":             { number: "+16024599656", name: "Google Search Ads Calls" },
    "Modernize":                           { number: "+16025079882", name: "Modernize" },
    "NCT Media":                           { number: "+16025079610", name: "NCT Media" },
    "Arizona Roofers Main Line":           MAIN_LINE,

    // ── No dedicated tracking number → Main Line caller ID ──
    "Self Gen":                            MAIN_LINE,
    "Door knocking":                       MAIN_LINE,
    "Town Of Gilbert":                     MAIN_LINE,
    // Generic website leads → the SEO Website Calls (Multi-Organic) line.
    "Website":                             { number: "+14807906153", name: "SEO Website Calls (Multi-Organic)" },
    "":                                    MAIN_LINE,
  };

  // Normalized index so casing/spacing variants resolve to the same entry.
  const norm = (s) => (s || "").toString().trim().toLowerCase().replace(/\s+/g, " ");
  const NORM_INDEX = {};
  for (const k of Object.keys(SOURCE_TO_OUTBOUND)) NORM_INDEX[norm(k)] = SOURCE_TO_OUTBOUND[k];

  function lookupOutbound(sourceLabel) {
    return NORM_INDEX[norm(sourceLabel)] || null;
  }

  const api = { SOURCE_TO_OUTBOUND, lookupOutbound };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.DialerSources = api;
  }
})(typeof window !== "undefined" ? window : globalThis);

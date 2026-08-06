// Phoenix Stacks — route-fit scoring engine (Phase 1: SHADOW MODE).
// Scores every open (day, block, rep) by the marginal drive time of inserting
// the searched lead into that rep's existing day. Fixed time blocks mean the
// drive order is dictated by the clock — no route optimizer needed, just
// constrained cheapest insertion per rep lane.
//
// Shadow mode: popup.js runs this alongside the radius stacker and logs the
// comparison ([route-shadow] in the panel console). Nothing renders from it yet.

import { CONFIG } from './config.js';

/* ========= Distance model =========
   Phoenix is a mile grid — Manhattan (L1) distance matches the street layout
   better than straight-line, and needs no trig. Ranking-quality only; never
   present as a real ETA. */
const LAT_TO_MILES = 69.0;
const LON_TO_MILES = 57.5; // 69 * cos(33.5°)
const AVG_SPEED_MPH = 35.0;

export function driveMinutes(a, b) {
    const dy = Math.abs(Number(a.lat) - Number(b.lat)) * LAT_TO_MILES;
    const dx = Math.abs(Number(a.lng) - Number(b.lng)) * LON_TO_MILES;
    return ((dx + dy) / AVG_SPEED_MPH) * 60.0;
}

function hasPoint(p) {
    const lat = p?.lat, lng = p?.lng;
    if (lat == null || lat === '' || lng == null || lng === '') return false;
    return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
}

/* ========= Rep routing profile (names + home ZIP anchors) =========
   Source: SRA sheet "Appointment Blocks" A19:L49 (skills matrix; Zip Code col H)
   via the tech-scheduler sheets proxy — same path the scanner already uses. */
const SRA_SHEET_ID = '1cFFEZNl7wXt40riZHnuZxGc1Zfm5lTlOz0rDCWGZJ0g';
const SKILLS_RANGE = "'Appointment Blocks'!A19:L49";
const PROFILE_TTL_MS = 12 * 60 * 60 * 1000;

// Centroids for the rep home ZIPs currently on the sheet (~±1 mi is plenty for
// a day-start anchor). Unknown ZIPs simply score without a home anchor.
const AZ_ZIP_CENTROIDS = {
    '85086': { lat: 33.82, lng: -112.11 }, // Anthem
    '85087': { lat: 33.92, lng: -112.13 }, // New River
    '85202': { lat: 33.38, lng: -111.87 }, // Mesa W
    '85206': { lat: 33.40, lng: -111.72 }, // Mesa E
    '85225': { lat: 33.32, lng: -111.83 }, // Chandler
    '85226': { lat: 33.31, lng: -111.93 }, // Chandler W
    '85254': { lat: 33.62, lng: -111.95 }, // Scottsdale/PV
    '85257': { lat: 33.46, lng: -111.91 }, // Scottsdale S
    '85282': { lat: 33.39, lng: -111.93 }, // Tempe
    '85295': { lat: 33.30, lng: -111.74 }, // Gilbert SE
    '85382': { lat: 33.66, lng: -112.20 }, // Peoria
    '85614': { lat: 31.86, lng: -110.99 }, // Green Valley
    '85741': { lat: 32.34, lng: -111.04 }, // Tucson NW
};

let _profileCache = null;
let _profileFetchedAt = 0;

export async function fetchRepRoutingProfile() {
    if (_profileCache && Date.now() - _profileFetchedAt < PROFILE_TTL_MS) return _profileCache;
    const url = `https://az-roofers-tech-scheduler.vercel.app/api/sheets?spreadsheetId=${encodeURIComponent(SRA_SHEET_ID)}&range=${encodeURIComponent(SKILLS_RANGE)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`skills range HTTP ${res.status}`);
    const data = await res.json();
    const rows = data?.values || [];
    const header = (rows[0] || []).map(h => String(h).trim().toLowerCase());
    const zipCol = header.findIndex(h => h.startsWith('zip'));
    const profile = {};
    for (const row of rows.slice(1)) {
        const name = String(row[0] || '').trim();
        if (!name) continue;
        const zip = zipCol >= 0 ? String(row[zipCol] || '').trim().slice(0, 5) : '';
        profile[name.toUpperCase()] = {
            name,
            zip: zip || null,
            home: AZ_ZIP_CENTROIDS[zip] || null,
        };
    }
    _profileCache = profile;
    _profileFetchedAt = Date.now();
    return profile;
}

/* ========= Attendee → rep lane matching ========= */
function attendeeNames(ev) {
    const raw = Array.isArray(ev?.attendees) ? ev.attendees : [];
    return raw.map(a => {
        if (typeof a === 'string') return a;
        return a?.name || a?.resource?.name || '';
    }).map(s => String(s).trim()).filter(Boolean);
}

export function repKeysForEvent(ev, profile) {
    const keys = [];
    for (const n of attendeeNames(ev)) {
        const up = n.toUpperCase();
        if (profile[up]) { keys.push(up); continue; }
        // Loose match: attendee strings sometimes carry extra text around the name.
        for (const key of Object.keys(profile)) {
            if (up.includes(key) || key.includes(up)) { keys.push(key); break; }
        }
    }
    return [...new Set(keys)];
}

/* ========= Scoring ========= */
// Inserted-leg feasibility by how many empty blocks separate the stops, and the
// overall marginal-cost bands. Guardrails, not appointment-length promises.
const LEG_LIMIT_BY_GAP = [35, 50, 65]; // adjacent, 1 empty block, 2+ empty
const MAX_MARGINAL_MIN = 45;
export const QUALITY_BANDS = [
    [15, 'tight'],
    [30, 'reasonable'],
    [45, 'costly'],
];

function qualityOf(marginal) {
    for (const [max, label] of QUALITY_BANDS) if (marginal <= max) return label;
    return 'wasteful';
}

function legLimit(blockGap) {
    return LEG_LIMIT_BY_GAP[Math.min(Math.max(blockGap - 1, 0), LEG_LIMIT_BY_GAP.length - 1)];
}

/**
 * Score all open (day, block) slots for the lead by per-rep cheapest insertion.
 * occupiedKeysFor mirrors popup.js (majority-overlap via CONFIG when present).
 * Returns { candidatesByDay, stats } — candidatesByDay: dateStr -> ranked
 * RouteCandidates (best first).
 */
export function scoreRouteCandidates({ leadPoint, weekDays, allEvents, availability, currentRegion, profile, todayISO }) {
    const occupiedKeysFor = (ev, blocks) => CONFIG.occupiedBlockKeys
        ? CONFIG.occupiedBlockKeys(ev, blocks)
        : blocks.filter(b => {
            const s = Math.max(new Date(ev.start).getTime(), b.start.getTime());
            const e = Math.min(new Date(ev.end).getTime(), b.end.getTime());
            return (e - s) / 60000 >= 15;
        }).map(b => b.key);

    const candidatesByDay = {};
    const stats = { days: 0, blocksScored: 0, repRoute: 0, unassignedEvents: 0, noCoordEvents: 0 };
    const localDayKey = (iso) => (iso ? String(iso).slice(0, 10) : '');

    for (const dateStr of weekDays) {
        if (todayISO && dateStr <= todayISO) continue;
        const dailyEvents = allEvents.filter(e => localDayKey(e.start) === dateStr);
        const totals = CONFIG.computeDailyTotals(dateStr, dailyEvents, availability, currentRegion);
        const blocks = CONFIG.blockWindowForDate(new Date(dateStr + 'T00:00'));
        const keyToIndex = {};
        blocks.forEach((b, i) => { keyToIndex[b.key] = i; });

        // Rep lanes: block index -> stop point, per recognized rep. Commercial
        // events stay in their own pool; unrecognized events can't form a lane.
        const lanes = {};
        for (const ev of dailyEvents) {
            if (CONFIG.isCommercialEvent?.(ev)) continue;
            const reps = repKeysForEvent(ev, profile);
            if (!reps.length) { stats.unassignedEvents++; continue; }
            if (!hasPoint(ev)) stats.noCoordEvents++;
            for (const key of reps) {
                lanes[key] = lanes[key] || {};
                for (const bk of occupiedKeysFor(ev, blocks)) {
                    lanes[key][keyToIndex[bk]] = {
                        point: hasPoint(ev) ? { lat: Number(ev.lat), lng: Number(ev.lng) } : null,
                        title: ev.title,
                    };
                }
            }
        }

        stats.days++;
        const dayCandidates = [];

        for (const b of blocks) {
            const remaining = totals.perBlockRemaining?.[b.key] ?? 0;
            if (remaining <= 0) continue;
            stats.blocksScored++;
            const bIdx = keyToIndex[b.key];
            const insertions = [];

            for (const [repKey, laneStops] of Object.entries(lanes)) {
                if (laneStops[bIdx]) continue; // per-rep double-booking gate
                const stopCount = Object.keys(laneStops).length;
                if (stopCount >= blocks.length) continue; // rep's day is full

                // Nearest earlier/later stops by block order; home anchors the ends.
                const home = profile[repKey]?.home || null;
                let prev = null, prevIdx = -1, next = null, nextIdx = blocks.length;
                for (let i = bIdx - 1; i >= 0; i--) if (laneStops[i]) { prev = laneStops[i]; prevIdx = i; break; }
                for (let i = bIdx + 1; i < blocks.length; i++) if (laneStops[i]) { next = laneStops[i]; nextIdx = i; break; }
                if (!prev && home) { prev = { point: home, title: 'home' }; prevIdx = -1; }
                if (!next && home) { next = { point: home, title: 'home' }; nextIdx = blocks.length; }
                if (!prev && !next) continue; // empty lane, no anchor — nothing to route against
                // A neighbor without coordinates makes the lane unscorable for
                // this block — don't skip over it and pretend the route is known.
                if ((prev && !prev.point) || (next && !next.point)) continue;

                const legs = [];
                let marginal = 0;
                if (prev && next) {
                    const a = driveMinutes(prev.point, leadPoint);
                    const c = driveMinutes(leadPoint, next.point);
                    marginal = Math.max(0, a + c - driveMinutes(prev.point, next.point));
                    legs.push({ min: a, gap: bIdx - prevIdx }, { min: c, gap: nextIdx - bIdx });
                } else if (prev) {
                    marginal = driveMinutes(prev.point, leadPoint);
                    legs.push({ min: marginal, gap: bIdx - prevIdx });
                } else {
                    marginal = driveMinutes(leadPoint, next.point);
                    legs.push({ min: marginal, gap: nextIdx - bIdx });
                }

                const feasible = legs.every(l => l.min <= legLimit(l.gap)) && marginal <= MAX_MARGINAL_MIN;
                if (!feasible) continue;

                insertions.push({
                    repKey,
                    repName: profile[repKey]?.name || repKey,
                    marginalMinutes: Math.round(marginal),
                    worstLegMinutes: Math.round(Math.max(...legs.map(l => l.min))),
                    anchorCount: (prev && prev.title !== 'home' ? 1 : 0) + (next && next.title !== 'home' ? 1 : 0),
                });
            }

            if (insertions.length) {
                insertions.sort((x, y) =>
                    x.marginalMinutes - y.marginalMinutes ||
                    x.worstLegMinutes - y.worstLegMinutes ||
                    y.anchorCount - x.anchorCount ||
                    x.repName.localeCompare(y.repName));
                const best = insertions[0];
                stats.repRoute++;
                dayCandidates.push({
                    dateStr,
                    blockKey: b.key,
                    remaining,
                    basis: 'rep-route',
                    ...best,
                    quality: qualityOf(best.marginalMinutes),
                    reason: `${best.repName}: adds ~${Math.max(5, Math.round(best.marginalMinutes / 5) * 5)} min to their day.`,
                });
            } else {
                dayCandidates.push({
                    dateStr,
                    blockKey: b.key,
                    remaining,
                    basis: 'capacity',
                    marginalMinutes: null,
                    quality: null,
                    reason: `${remaining} open in this slot (no scorable rep route).`,
                });
            }
        }

        dayCandidates.sort((x, y) => {
            const xr = x.basis === 'rep-route' ? 0 : 1, yr = y.basis === 'rep-route' ? 0 : 1;
            if (xr !== yr) return xr - yr;
            if (x.basis === 'rep-route') {
                if (x.marginalMinutes !== y.marginalMinutes) return x.marginalMinutes - y.marginalMinutes;
                if (x.worstLegMinutes !== y.worstLegMinutes) return x.worstLegMinutes - y.worstLegMinutes;
            }
            if ((y.remaining || 0) !== (x.remaining || 0)) return (y.remaining || 0) - (x.remaining || 0);
            return String(x.blockKey).localeCompare(String(y.blockKey));
        });
        candidatesByDay[dateStr] = dayCandidates.slice(0, 3);
    }

    return { candidatesByDay, stats };
}

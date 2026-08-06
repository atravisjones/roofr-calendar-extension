// Service-area checks. Run after touching CONFIG.checkServiceArea or the
// bundled fallback polygons:  node scripts/test-service-area.mjs
import { CONFIG } from '../config.js';

// [label, address, coords|null, expected serviced]
const CASES = [
  // ---- Phoenix, must stay bookable ----
  ['Phoenix',            '4215 N 16th St, Phoenix, AZ 85016',        { lat: 33.4484, lng: -112.0740 }, true],
  ['Surprise',           '15925 W Bell Rd, Surprise, AZ 85374',      { lat: 33.6292, lng: -112.3680 }, true],
  ['Queen Creek',        '22350 S Ellsworth Rd, Queen Creek, AZ',    { lat: 33.2487, lng: -111.6343 }, true],
  ['Anthem',             '3655 W Anthem Way, Anthem, AZ 85086',      { lat: 33.8672, lng: -112.1466 }, true],
  ['Black Canyon City',  '19001 E Jaeger Rd, Black Canyon City, AZ', { lat: 34.0714, lng: -112.1519 }, true],
  ['Wickenburg',         '293 N Tegner St, Wickenburg, AZ 85390',    { lat: 33.9686, lng: -112.7296 }, true],
  ['Casa Grande',        '1100 E Florence Blvd, Casa Grande, AZ',    { lat: 32.8795, lng: -111.7574 }, true],
  ['Gila Bend',          '705 W Pima St, Gila Bend, AZ 85337',       { lat: 32.9476, lng: -112.7163 }, true],
  // Boundary towns Travis named — "east of / west of" means these are IN.
  ['Queen Valley *',     '1 Queen Valley Dr, Queen Valley, AZ',      { lat: 33.3067, lng: -111.2764 }, true],
  ['Tonopah *',          '38900 W Indian School Rd, Tonopah, AZ',    { lat: 33.5064, lng: -112.9410 }, true],

  // ---- North, must stay bookable ----
  ['Prescott',           '201 S Cortez St, Prescott, AZ 86303',      { lat: 34.5400, lng: -112.4685 }, true],
  ['Prescott Valley',    '7501 E Civic Cir, Prescott Valley, AZ',    { lat: 34.6100, lng: -112.3157 }, true],
  ['Chino Valley',       '202 N AZ-89, Chino Valley, AZ 86323',      { lat: 34.7575, lng: -112.4535 }, true],
  ['Cottonwood',         '827 N Main St, Cottonwood, AZ 86326',      { lat: 34.7392, lng: -112.0099 }, true],
  ['Clarkdale',          '39 N 9th St, Clarkdale, AZ 86324',         { lat: 34.7714, lng: -112.0577 }, true],
  ['Congress',           '1050 AZ-89, Congress, AZ 85332',           { lat: 34.1600, lng: -112.8500 }, true],
  ['Cordes Junction',    '11020 E AZ-69, Cordes Junction, AZ',       { lat: 34.3072, lng: -112.1200 }, true],
  ['Jerome',             '600 Clark St, Jerome, AZ 86331',           { lat: 34.7492, lng: -112.1136 }, true],

  // ---- South (Tucson), must stay bookable ----
  ['Tucson',             '5000 E Speedway Blvd, Tucson, AZ 85712',   { lat: 32.2226, lng: -110.9747 }, true],
  ['Marana',             '11555 W Civic Center Dr, Marana, AZ',      { lat: 32.4367, lng: -111.2254 }, true],
  ['Oro Valley',         '11000 N La Canada Dr, Oro Valley, AZ',     { lat: 32.3909, lng: -110.9665 }, true],
  ['Sahuarita',          '375 W Sahuarita Center Way, Sahuarita, AZ',{ lat: 31.9576, lng: -110.9556 }, true],
  ['Oracle',             '1470 W American Ave, Oracle, AZ 85623',    { lat: 32.6103, lng: -110.7715 }, true],
  ['Corona de Tucson',   '16000 S Houghton Rd, Corona de Tucson, AZ',{ lat: 31.9612, lng: -110.7770 }, true],
  ['Green Valley *',     '601 N La Canada Dr, Green Valley, AZ',     { lat: 31.8543, lng: -110.9937 }, true],
  ['Vail *',             '13105 E Colossal Cave Rd, Vail, AZ 85641', { lat: 32.0492, lng: -110.7137 }, true],

  // ---- Outside every shape, must decline ----
  ['Sedona',             '331 Forest Rd, Sedona, AZ 86336',          { lat: 34.8697, lng: -111.7610 }, false],
  ['Camp Verde',         '473 S Main St, Camp Verde, AZ 86322',      { lat: 34.5636, lng: -111.8543 }, false],
  ['Flagstaff',          '211 W Aspen Ave, Flagstaff, AZ 86001',     { lat: 35.1983, lng: -111.6513 }, false],
  ['Payson',             '303 N Beeline Hwy, Payson, AZ 85541',      { lat: 34.2308, lng: -111.3251 }, false],
  ['Kingman',            '310 N 4th St, Kingman, AZ 86401',          { lat: 35.1894, lng: -114.0530 }, false],
  ['Globe (E of QV)',    '150 N Pine St, Globe, AZ 85501',           { lat: 33.3942, lng: -110.7865 }, false],
  ['Superior (E of QV)', '199 N Lobb Ave, Superior, AZ 85173',       { lat: 33.2939, lng: -111.0968 }, false],
  ['Quartzsite (W of T)','465 N Plymouth Ave, Quartzsite, AZ',       { lat: 33.6639, lng: -114.2158 }, false],
  ['Nogales (S of GV)',  '777 N Grand Ave, Nogales, AZ 85621',       { lat: 31.3404, lng: -110.9343 }, false],
  ['Benson (E of Vail)', '120 W 6th St, Benson, AZ 85602',           { lat: 31.9679, lng: -110.2945 }, false],
  ['Sierra Vista',       '2400 E Tacoma St, Sierra Vista, AZ',       { lat: 31.5455, lng: -110.2773 }, false],

  // ---- No coordinates (typed-exact path): city name only ----
  ['NoCoords Sedona',    '331 Forest Rd, Sedona, AZ 86336',          null, false],
  ['NoCoords Flagstaff', '211 W Aspen Ave, Flagstaff, AZ 86001',     null, false],
  ['NoCoords Prescott',  '201 S Cortez St, Prescott, AZ 86303',      null, true],
  // Unknown must stay SILENT rather than guess — a false decline costs a job.
  ['NoCoords unknown',   '1234 Nowhere Ln',                          null, true],
  ['NoCoords Phoenix',   '4215 N 16th St, Phoenix, AZ 85016',        null, true],
  ['Empty',              '',                                          null, true],
];

let fail = 0;
console.log('case'.padEnd(22), 'exp'.padEnd(5), 'got'.padEnd(5), 'reason / area');
console.log('-'.repeat(80));
for (const [label, addr, coords, expected] of CASES) {
  const v = CONFIG.checkServiceArea(addr, coords);
  const ok = v.serviced === expected;
  if (!ok) fail++;
  console.log(
    label.padEnd(22), String(expected).padEnd(5), String(v.serviced).padEnd(5),
    `${v.reason}${v.area ? ' → ' + v.area : ''}${v.edge ? ' (EDGE)' : ''}${v.miles != null ? ' ' + v.miles + 'mi' : ''}`,
    ok ? '' : '   <<<< FAIL'
  );
}

// ---------------------------------------------------------------------------
// Buffer. A hand-drawn boundary is not a survey line, so a point just outside
// must still book — flagged as an edge case, not silently declined.
// ---------------------------------------------------------------------------
console.log('\nbuffer behaviour:');
const justOutside = { lat: 33.3067, lng: -111.19 };   // ~1 mi east of the Phoenix edge
const wayOutside  = { lat: 33.3067, lng: -110.90 };   // ~20 mi east
const b0 = CONFIG.checkServiceArea('', justOutside, { bufferMi: 0 });
const b3 = CONFIG.checkServiceArea('', justOutside, { bufferMi: 3 });
const bw = CONFIG.checkServiceArea('', wayOutside,  { bufferMi: 3 });
console.log(`  1mi out, buffer 0  -> ${b0.serviced ? 'books' : 'declines'} (${b0.reason})`);
console.log(`  1mi out, buffer 3  -> ${b3.serviced ? 'books' : 'declines'} (${b3.reason}${b3.edge ? ', flagged EDGE' : ''})`);
console.log(`  20mi out, buffer 3 -> ${bw.serviced ? 'books' : 'declines'} (${bw.reason})`);
if (b0.serviced) { console.log('  FAIL buffer 0 should decline a point outside the shape'); fail++; }
if (!b3.serviced || !b3.edge) { console.log('  FAIL buffer 3 should book it AND flag it as an edge'); fail++; }
if (bw.serviced) { console.log('  FAIL buffer must not reach 20 miles'); fail++; }

// ---------------------------------------------------------------------------
// Overlap precedence. Inside-any still books; precedence only decides the NAME.
// ---------------------------------------------------------------------------
console.log('\noverlap precedence:');
const overlap = {
  Phoenix: [[34.0, -113.0], [34.0, -111.0], [33.0, -111.0], [33.0, -113.0]],
  North:   [[34.5, -113.0], [34.5, -111.0], [33.5, -111.0], [33.5, -113.0]],
};
const mid = { lat: 33.75, lng: -112.0 };   // sits in BOTH
const pFirst = CONFIG.checkServiceArea('', mid, { polygons: overlap, precedence: ['Phoenix', 'North'] });
const nFirst = CONFIG.checkServiceArea('', mid, { polygons: overlap, precedence: ['North', 'Phoenix'] });
console.log(`  Phoenix first -> ${pFirst.area}`);
console.log(`  North first   -> ${nFirst.area}`);
if (pFirst.area !== 'Phoenix' || nFirst.area !== 'North') { console.log('  FAIL precedence ignored'); fail++; }
if (!pFirst.serviced || !nFirst.serviced) { console.log('  FAIL overlap must still book'); fail++; }

// A disabled area must not book, even though its shape still contains the point.
const off = CONFIG.checkServiceArea('', { lat: 34.54, lng: -112.4685 }, { areaEnabled: { North: false } });
console.log(`\npaused area:\n  North disabled, Prescott -> ${off.serviced ? 'books' : 'declines'} (${off.reason})`);
if (off.serviced) { console.log('  FAIL a paused area must not book'); fail++; }

console.log(fail ? `\n${fail} FAILURE(S)` : `\nAll checks passed (${CASES.length} cases + buffer + precedence + pause).`);
process.exit(fail ? 1 : 0);

import type { RoofrEvent, Region, Availability, BlockKey, ParsedJob } from './types';

// This file contains the static configuration and business logic for the Roofr extension.

export const CONFIG = {
  // The API Key is a constant for the application.
  apiKey: "AIzaSyAUU9vrRIAepLUJedcIrmmfJDyVKjGhINI",

  ranges: {
    phxRange: "I2:Q9",
    southRange: "I10:Q17",
    northRange: "I18:Q25",
  },
  
  titlePrefixes: ["SRA", "SALES REP AVAIL", "REP AVAil"],
  fallbackTabName: "SRA 11/03-11/09",

  ZIP_TO_CITY: {
    "850": "PHOENIX", "85339": "LAVEEN", "85323": "AVONDALE", "85326": "BUCKEYE",
    "85338": "GOODYEAR", "85301": "GLENDALE", "85345": "PEORIA", "85374": "SURPRISE",
    "85201": "MESA", "85224": "CHANDLER", "85233": "GILBERT", "85250": "SCOTTSDALE",
    "85119": "APACHE JUNCTION", "85142": "QUEEN CREEK", "85143": "SAN TAN VALLEY",
    "85122": "CASA GRANDE", "857": "TUCSON", "85641": "VAIL", "85614": "GREEN VALLEY",
    "86301": "PRESCOTT", "86314": "PRESCOTT VALLEY", "86001": "FLAGSTAFF", "85541": "PAYSON",
  } as Record<string, string>,

  CITY_ADJACENCY: {
    PHOENIX: ["TEMPE","SCOTTSDALE","GLENDALE","PARADISE VALLEY","PEORIA","LAVEEN"],
    TEMPE: ["MESA","CHANDLER","PHOENIX","SCOTTSDALE"],
    MESA: ["GILBERT","CHANDLER","APACHE JUNCTION","QUEEN CREEK","TEMPE"],
    CHANDLER: ["GILBERT","TEMPE","MESA","SUN LAKES"],
    GILBERT: ["MESA","CHANDLER","QUEEN CREEK","SAN TAN VALLEY"],
    SCOTTSDALE: ["PHOENIX","PARADISE VALLEY","TEMPE","FOUNTAIN HILLS"],
    TUCSON: ["MARANA","ORO VALLEY","SAHUARITA","VAIL"],
    PRESCOTT: ["PRESCOTT VALLEY","CHINO VALLEY","DEWEY"],
    FLAGSTAFF: ["WILLIAMS","MUNDS PARK"],
    PAYSON: ["STAR VALLEY","PINE","STRAWBERRY"],
  } as Record<string, string[]>,
  
  REGION_CITY_WHITELISTS: {
      PHX: new Set(["PHOENIX","SCOTTSDALE","TEMPE","MESA","CHANDLER","GILBERT","GLENDALE","PEORIA","SURPRISE", "AVONDALE","GOODYEAR","BUCKEYE","QUEEN CREEK","SAN TAN VALLEY","APACHE JUNCTION","FOUNTAIN HILLS", "PARADISE VALLEY","CAVE CREEK","CAREFREE","ANTHEM","EL MIRAGE","YOUNGTOWN","LITCHFIELD PARK", "TOLLESON","WADDELL","SUN CITY","SUN CITY WEST","NEW RIVER","AHWATUKEE","MARICOPA","CASA GRANDE", "FLORENCE","SUN LAKES","GOLD CANYON","QUEEN VALLEY","WITTMANN","WICKENBURG","MORRISTOWN","LAVEEN"]),
      NORTH: new Set(["PRESCOTT","PRESCOTT VALLEY","FLAGSTAFF","PAYSON","SEDONA","COTTONWOOD","CAMP VERDE","CHINO VALLEY", "DEWEY","WILLIAMS","KINGMAN","CLARKDALE","PINE","STRAWBERRY","STAR VALLEY","VILLAGE OF OAK CREEK","MUNDS PARK","MAYER","WINKELMAN","RIO VERDE"]),
      SOUTH: new Set(["TUCSON","SOUTH TUCSON","MARANA","ORO VALLEY","SAHUARITA","GREEN VALLEY","VAIL","NOGALES","RIO RICO", "SADDLEBROOKE","ELOY","ARIZONA CITY","COOLIDGE","VALLEY FARMS","RED ROCK","ORACLE"]),
  },

  // --- Logic Functions ---
  
  blockWindowForDate(date: Date) {
    const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    return [
      { key:"B1" as BlockKey, label:"7:30am-9am", start:new Date(y,m,d,7,30), end:new Date(y,m,d,9,0) },
      { key:"B2" as BlockKey, label:"10am-12pm", start:new Date(y,m,d,10,0), end:new Date(y,m,d,12,0) },
      { key:"B3" as BlockKey, label:"1pm-3pm",  start:new Date(y,m,d,13,0), end:new Date(y,m,d,15,0) },
      { key:"B4" as BlockKey, label:"4pm-6pm",  start:new Date(y,m,d,16,0), end:new Date(y,m,d,18,0) },
    ];
  },

  overlapMinutes(a: { start: string, end: string }, b: { start: Date, end: Date }): number {
    const start = Math.max(new Date(a.start).getTime(), new Date(b.start).getTime());
    const end = Math.min(new Date(a.end).getTime(), new Date(b.end).getTime());
    return end > start ? (end - start) / 60000 : 0;
  },

  findCityInString(text: string): { city: string, region: Region } | null {
    const T = String(text).toUpperCase();
    const regions: Array<Extract<Region, 'PHX' | 'NORTH' | 'SOUTH'>> = ['PHX', 'NORTH', 'SOUTH'];
    for (const regionKey of regions) {
      for (const city of this.REGION_CITY_WHITELISTS[regionKey] || []) {
        if (new RegExp(`\\b${city}\\b`, "i").test(T)) return { city, region: regionKey };
      }
    }
    return null;
  },

  getCityFromEvent(ev: RoofrEvent): string | null {
    const text = [ev.title || "", ev.address || "", ev.notes || ""].join(" ");
    return this.findCityInString(text)?.city || null;
  },

  passesRegion(e: RoofrEvent, regionKey: Region): boolean {
    if (regionKey === "ALL") return true;
    const hit = this.findCityInString([e.title, e.address, e.notes].join(' '));
    // If no city is found, it's "uncategorized" and should show up in all filters.
    if (!hit) return true; 
    return hit.region === regionKey;
  },
  
  getRegionForCity(city: string): Region | null {
      const C = city.toUpperCase();
      if(this.REGION_CITY_WHITELISTS.PHX.has(C)) return 'PHX';
      if(this.REGION_CITY_WHITELISTS.NORTH.has(C)) return 'NORTH';
      if(this.REGION_CITY_WHITELISTS.SOUTH.has(C)) return 'SOUTH';
      return null;
  },
  
  sumMaps(a: Availability | null, b: Availability | null): Availability | null {
    if (!a) return b;
    if (!b) return a;
    const out: Availability = { B1: [], B2: [], B3: [], B4: [] };
    const blockKeys: BlockKey[] = ["B1", "B2", "B3", "B4"];
    for (const k of blockKeys) {
        for (let i = 0; i < 7; i++) {
            out[k][i] = (a[k]?.[i] || 0) + (b[k]?.[i] || 0);
        }
    }
    return out;
  },
  
  getCapacity(regionKey: Region, jsWeekday: number, blockKey: BlockKey, availability: Record<Region, Availability | null>): number | null {
    const map = availability[regionKey];
    if (!map || !map[blockKey]) return null;
    const WEEKDAY_TO_MONFIRST = [6, 0, 1, 2, 3, 4, 5];
    const idx = WEEKDAY_TO_MONFIRST[jsWeekday];
    const v = map[blockKey][idx];
    return Number.isFinite(v) ? v : null;
  },
  
  computeDailyTotals(dateStr: string, eventsForDay: RoofrEvent[], availability: Record<Region, Availability | null>, region: Region) {
    const perBlockBooked: Record<BlockKey, number> = { B1: 0, B2: 0, B3: 0, B4: 0 };
    const d = new Date(`${dateStr}T00:00:00`);
    const blocks = this.blockWindowForDate(d);
    
    for (const ev of eventsForDay) {
      for (const blk of blocks) {
        if (this.overlapMinutes({ start: ev.start, end: ev.end }, blk) >= 15) {
          perBlockBooked[blk.key]++;
        }
      }
    }

    let capacity = 0;
    let booked = 0;
    let dayOver = 0;
    let netAvailable = 0;
    const perBlockRemaining: Record<BlockKey, number | null> = { B1: null, B2: null, B3: null, B4: null };
    const blockKeys: BlockKey[] = ["B1", "B2", "B3", "B4"];

    for (const k of blockKeys) {
      const bookedK = perBlockBooked[k];
      booked += bookedK;
      const capK = this.getCapacity(region, d.getDay(), k, availability);
      perBlockRemaining[k] = capK !== null ? capK - bookedK : null;

      if (capK !== null) {
        capacity += capK;
        const rem = capK - bookedK;
        if(rem > 0) netAvailable += rem;
        if (rem < 0) dayOver += -rem;
      }
    }

    return { booked, capacity, perBlockBooked, perBlockRemaining, dayOver, netAvailable };
  },

  buildCityTally(dateStr: string, eventsForDay: RoofrEvent[]) {
    const perCity = new Map<string, { total: number, perBlock: Record<BlockKey, number> }>();
    const blocks = this.blockWindowForDate(new Date(`${dateStr}T00:00`));
    for (const ev of eventsForDay) {
        const city = this.getCityFromEvent(ev) || "UNCATEGORIZED";
        let rec = perCity.get(city);
        if (!rec) {
            rec = { total: 0, perBlock: { B1: 0, B2: 0, B3: 0, B4: 0 } };
            perCity.set(city, rec);
        }
        for (const blk of blocks) {
            if (this.overlapMinutes({ start: ev.start, end: ev.end }, blk) >= 15) {
                rec.perBlock[blk.key]++;
                rec.total++;
            }
        }
    }
    return perCity;
  },
  
   resolveCityCandidatesFromInput(text: string): string[] {
    const zipMatch = text.match(/\b(\d{5})\b/);
    const zip = zipMatch ? zipMatch[1] : null;
    const fromZipCity = zip ? this.ZIP_TO_CITY[zip] || this.ZIP_TO_CITY[zip.slice(0, 3)] : null;
    
    const fromTextCity = this.findCityInString(text)?.city;
    const primary = (fromTextCity || fromZipCity || '').toUpperCase();
    if (!primary) return [];
    
    const candidates = new Set([primary]);
    const adjacents = this.CITY_ADJACENCY[primary.replace(/\s/g,'_')] || [];
    adjacents.forEach(c => candidates.add(c.toUpperCase()));
    
    return Array.from(candidates);
  },

  // Normalize address for better API matching - expand/standardize abbreviations
  normalizeAddressForAPI(address: string): string {
    let normalized = address;

    const directions: Record<string, string> = {
      '\\bN\\.?\\s': 'North ',
      '\\bS\\.?\\s': 'South ',
      '\\bE\\.?\\s': 'East ',
      '\\bW\\.?\\s': 'West ',
      '\\bNE\\.?\\s': 'Northeast ',
      '\\bNW\\.?\\s': 'Northwest ',
      '\\bSE\\.?\\s': 'Southeast ',
      '\\bSW\\.?\\s': 'Southwest ',
    };

    const streetTypes: Record<string, string> = {
      '\\bSt\\.?\\b': 'Street',
      '\\bAve\\.?\\b': 'Avenue',
      '\\bRd\\.?\\b': 'Road',
      '\\bDr\\.?\\b': 'Drive',
      '\\bBlvd\\.?\\b': 'Boulevard',
      '\\bLn\\.?\\b': 'Lane',
      '\\bCt\\.?\\b': 'Court',
      '\\bPl\\.?\\b': 'Place',
      '\\bCir\\.?\\b': 'Circle',
      '\\bTrl\\.?\\b': 'Trail',
      '\\bPkwy\\.?\\b': 'Parkway',
      '\\bHwy\\.?\\b': 'Highway',
    };

    for (const [abbr, full] of Object.entries(directions)) {
      normalized = normalized.replace(new RegExp(abbr, 'gi'), full);
    }

    for (const [abbr, full] of Object.entries(streetTypes)) {
      normalized = normalized.replace(new RegExp(abbr, 'gi'), full);
    }

    return normalized;
  },

  // Free Address Verification using US Census Bureau Geocoding API (no API key required)
  async verifyAddress(addressString: string): Promise<{
    success: boolean;
    error?: string;
    city?: string;
    state?: string;
    zip?: string;
    region?: Region | null;
    matchedAddress?: string;
    isKnownCity?: boolean;
    coordinates?: { x: number; y: number };
  }> {
    const addressesToTry = [
      addressString.replace(/\s+/g, ' ').trim(),
      this.normalizeAddressForAPI(addressString.replace(/\s+/g, ' ').trim())
    ];

    const uniqueAddresses = [...new Set(addressesToTry)];

    for (const cleanAddress of uniqueAddresses) {
      try {
        const encodedAddress = encodeURIComponent(cleanAddress);
        const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodedAddress}&benchmark=Public_AR_Current&format=json`;

        const response = await fetch(url);
        if (!response.ok) continue;

        const data = await response.json();

        if (data.result?.addressMatches?.length > 0) {
          const match = data.result.addressMatches[0];
          const components = match.addressComponents;

          const city = (components.city || '').toUpperCase();
          const state = (components.state || '').toUpperCase();
          const zip = components.zip || '';
          const matchedAddress = match.matchedAddress || '';

          if (state !== 'AZ') {
            return { success: false, error: `Address is in ${state}, not Arizona`, city, state, zip };
          }

          const region = this.getRegionForCity(city);

          return {
            success: true,
            city,
            state,
            zip,
            region,
            matchedAddress,
            isKnownCity: region !== null,
            coordinates: match.coordinates
          };
        }
      } catch (error) {
        continue;
      }
    }

    return { success: false, error: 'No address match found' };
  },

  // Clean up address string - remove country, extra suffixes, and standardize
  cleanAddressString(address: string): string {
    return address
      .replace(/,?\s*(United States|USA|US|U\.S\.A\.?|U\.S\.?)$/i, '')
      .replace(/\s*-?\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*.*/i, '')
      .replace(/\s*at\s+\d{1,2}:\d{2}\s*(AM|PM)?\s*(MST|PST|EST|CST|MDT|PDT|EDT|CDT)?/i, '')
      .replace(/,\s*,/g, ',')
      .replace(/\s+/g, ' ')
      .trim();
  },

  extractAddressForVerification(event: RoofrEvent): string {
    const title = event.title || '';
    const parts = title.split(' - ');
    const streetSuffixes = /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way|pkwy|parkway|pl|place|cir|circle|trl|trail|hwy|highway|loop)\b/i;

    for (const part of parts) {
      const trimmed = part.trim();
      if (/^\d+\s+/.test(trimmed) && streetSuffixes.test(trimmed)) {
        let address = this.cleanAddressString(trimmed);

        if (!/\b(AZ|Arizona)\b/i.test(address)) {
          const lastComma = address.lastIndexOf(',');
          if (lastComma > 0) {
            address = address + ', AZ';
          } else {
            address = address + ', Arizona';
          }
        }
        return address;
      }
    }

    const addressMatch = title.match(/(\d+\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9\s]+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Blvd|Boulevard|Ln|Lane|Ct|Court|Way|Pkwy|Parkway|Pl|Place|Cir|Circle|Trl|Trail|Hwy|Highway|Loop)\.?(?:[,\s]+[A-Za-z\s]+)?(?:[,\s]+(?:AZ|Arizona))?(?:[,\s]+\d{5})?)/i);

    if (addressMatch) {
      let address = this.cleanAddressString(addressMatch[1]);
      if (!/\b(AZ|Arizona)\b/i.test(address)) {
        address = address + ', AZ';
      }
      return address;
    }

    for (let i = parts.length - 1; i >= 0; i--) {
      const trimmed = parts[i].trim();
      if (/\d/.test(trimmed) && trimmed.length > 10) {
        let address = this.cleanAddressString(trimmed);
        if (!/\b(AZ|Arizona)\b/i.test(address)) {
          address = address + ', AZ';
        }
        return address;
      }
    }

    return this.cleanAddressString(title);
  },

  async verifyAndCategorizeEvent(event: RoofrEvent): Promise<{
    success: boolean;
    city?: string;
    region?: Region | null;
    matchedAddress?: string;
    isNewCity?: boolean;
    suggestedRegion?: Region;
    error?: string;
  }> {
    const addressString = this.extractAddressForVerification(event);
    const result = await this.verifyAddress(addressString);

    if (result.success && result.city) {
      if (result.isKnownCity) {
        return {
          success: true,
          city: result.city,
          region: result.region,
          matchedAddress: result.matchedAddress,
          isNewCity: false
        };
      }
      return {
        success: true,
        city: result.city,
        region: null,
        matchedAddress: result.matchedAddress,
        isNewCity: true,
        suggestedRegion: this.suggestRegionForCity(result.city, result.coordinates)
      };
    }

    return { success: false, error: result.error };
  },

  suggestRegionForCity(city: string, coordinates?: { x: number; y: number }): Region {
    if (!coordinates) return 'PHX';

    const lat = coordinates.y;
    if (lat > 34.2) return 'NORTH';
    if (lat < 32.5) return 'SOUTH';
    return 'PHX';
  },

  parseJobDetails(event: RoofrEvent): ParsedJob {
    const title = (event.title || "").trim();
    const details: ParsedJob = {
        event: event,
        id: `${event.title}|${event.start}`,
        city: 'Unknown',
        address: title,
        hashTags: 0,
        jobType: 'Residential',
        rawTags: [] as string[],
        roofType: 'Unknown',
        roofAge: 'Unknown',
        stories: 'Unknown',
        sqft: 'Unknown',
        day: '',
        time: '',
    };

    let content = title;

    // Split address if possible
    const addressParts = content.split(' - ');
    if (addressParts.length > 1 && addressParts[addressParts.length - 1].match(/\d/)) { // Heuristic: address part has a number
        details.address = addressParts.pop()!.trim();
        content = addressParts.join(' - ').trim();
    }
    
    // Use the robust city finder first
    const cityInfo = this.findCityInString(title);
    if (cityInfo) {
        details.city = cityInfo.city;
    } else {
        const firstWord = (content.split(' ')[0] || '').replace(/,$/, '').toUpperCase();
        if (this.getRegionForCity(firstWord)) {
            details.city = firstWord;
        }
    }
    
    // Hash Tags
    const hashMatch = content.match(/#+/);
    details.hashTags = hashMatch ? hashMatch[0].length : 0;
    
    // Job Type & Raw Tags
    const jobTypesFound = new Set<string>();
    const contentUpper = content.toUpperCase();

    if (contentUpper.includes('COMMERCIAL')) jobTypesFound.add('Commercial');
    if (contentUpper.includes('INSURANCE') || contentUpper.includes('CLAIM')) jobTypesFound.add('Insurance');
    if (contentUpper.includes('HOA')) jobTypesFound.add('HOA');
    if (contentUpper.includes('REAL ESTATE') || contentUpper.includes('REALTOR')) jobTypesFound.add('Real Estate');

    if (jobTypesFound.size > 0) {
        details.rawTags = [...jobTypesFound].sort();
        details.jobType = details.rawTags.join('/'); // a composite string
    } else {
        details.rawTags = [];
        details.jobType = 'Residential';
    }

    // Roof Type (look for multiple keywords)
    const roofTypes = new Set<string>();
    const typeRegex = /\b(Tile|Shingle|Flat|Metal|Foam)\b/ig;
    let typeMatch;
    while ((typeMatch = typeRegex.exec(content)) !== null) {
        roofTypes.add(typeMatch[0].charAt(0).toUpperCase() + typeMatch[0].slice(1).toLowerCase());
    }
    if (roofTypes.size > 0) details.roofType = [...roofTypes].join('/');

    // Roof Age
    const ageMatch = content.match(/(\d{1,2}(?:-\d{1,2})?|\d{1,2}\+)\s?yrs/i) || content.match(/(\d{1,2})\s?yr\b/i);
    if (ageMatch) details.roofAge = ageMatch[1];
    else if (content.match(/Unknown/i)) details.roofAge = "Unknown";

    // Stories
    const storiesMatch = content.match(/(\d)\s?(S|STORY)\b/i);
    if (storiesMatch) details.stories = storiesMatch[1];

    // Square Footage
    const sqftMatch = content.match(/([\d,]+)\s?sq/i);
    if (sqftMatch) details.sqft = sqftMatch[1].replace(/,/g, '');

    // Event time details
    const startDate = new Date(event.start);
    details.day = startDate.toLocaleDateString('en-US', { weekday: 'short' });
    const blocks = this.blockWindowForDate(startDate);
    for (const block of blocks) {
        if (this.overlapMinutes(event, block) >= 15) {
            details.time = block.label;
            break;
        }
    }

    return details;
  }
};

export const PEOPLE_DATA = {
    REPS: ["Ashkan Etemadi", "Brett Jackson", "Chandler Duffy", "Christian Noren", "Cole Ludewig", "Joseph Simms", "Justin Parker", "Kyle Ludewig", "London Smith", "Nick Williams", "Oliver Johnson", "Orlando Chavarria", "Richard Hadsall", "William Ludewig", "William Yost"].sort(),
    MGMT: ["Andrew Clark", "Anthony Bonomo", "Bradley Crohurst", "Brenda Ochoa", "Yousef Ayad"].sort(),
    CSRS: ["Bronté Pisz", "Diva Shahpur", "Madison Meyers", "Nica Javier", "Raven Pelfrey", "Travis Jones"].sort(),
};
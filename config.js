// config.js
// This file contains the static configuration and business logic for the Roofr extension.

export const CONFIG = {
  // The API Key is a constant for the application.
  apiKey: "AIzaSyAUU9vrRIAepLUJedcIrmmfJDyVKjGhINI",

  ranges: {
    phxRange: "I2:Q9",
    southRange: "I10:Q17",
    northRange: "I18:Q25",
  },
  
  titlePrefixes: ["SRA", "SALES REP AVAIL", "REP AVAIL"],
  fallbackTabName: "SRA 11/03-11/09",

  ZIP_TO_CITY: {
    "850": "PHOENIX", "85339": "LAVEEN", "85323": "AVONDALE", "85326": "BUCKEYE",
    "85338": "GOODYEAR", "85301": "GLENDALE", "85345": "PEORIA", "85374": "SURPRISE",
    "85201": "MESA", "85224": "CHANDLER", "85233": "GILBERT", "85250": "SCOTTSDALE",
    "85119": "APACHE JUNCTION", "85142": "QUEEN CREEK", "85143": "SAN TAN VALLEY",
    "85122": "CASA GRANDE", "857": "TUCSON", "85641": "VAIL", "85614": "GREEN VALLEY",
    "86301": "PRESCOTT", "86314": "PRESCOTT VALLEY", "86001": "FLAGSTAFF", "85541": "PAYSON",
  },

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
  },
  
  // Geographically sorted list of cities from West to East for logistical planning.
  CITY_SORT_ORDER: [
    // Far West
    "WICKENBURG", "CONGRESS", "BUCKEYE", "AVONDALE", "GOODYEAR", "LITCHFIELD PARK", "TOLLESON",
    // West Valley
    "SURPRISE", "EL MIRAGE", "YOUNGTOWN", "SUN CITY", "SUN CITY WEST", "PEORIA", "GLENDALE",
    // North West
    "WITTMANN", "MORRISTOWN",
    // Central & South Central
    "LAVEEN", "PHOENIX", "AHWATUKEE",
    // North Phoenix Corridor
    "NEW RIVER", "ANTHEM", "CAVE CREEK", "CAREFREE",
    // East Valley / Scottsdale
    "PARADISE VALLEY", "SCOTTSDALE", "TEMPE", "CHANDLER", "GILBERT", "MESA", "FOUNTAIN HILLS",
    // Far East Valley
    "APACHE JUNCTION", "QUEEN CREEK", "SAN TAN VALLEY", "GOLD CANYON", "QUEEN VALLEY", "GLOBE",
    // South of Metro
    "MARICOPA", "STANFIELD", "CASA GRANDE", "ARIZONA CITY", "ELOY", "COOLIDGE", "FLORENCE",
    // "Up North" Region
    "BLACK CANYON CITY", "DEWEY", "PRESCOTT VALLEY", "PRESCOTT", "CHINO VALLEY", "SEDONA", "COTTONWOOD", "CLARKDALE", "CAMP VERDE", "VILLAGE OF OAK CREEK", "PAYSON", "STAR VALLEY", "PINE", "STRAWBERRY", "FLAGSTAFF", "WILLIAMS", "KINGMAN",
    // "Down South" Region
    "RED ROCK", "ORACLE", "MARANA", "ORO VALLEY", "SADDLEBROOKE", "TUCSON", "SOUTH TUCSON", "SAHUARITA", "GREEN VALLEY", "VAIL", "RIO RICO", "NOGALES"
  ],

  REGION_CITY_WHITELISTS: {
      PHX: new Set(["PHOENIX","SCOTTSDALE","TEMPE","MESA","CHANDLER","GILBERT","GLENDALE","PEORIA","SURPRISE", "AVONDALE","GOODYEAR","BUCKEYE","QUEEN CREEK","SAN TAN VALLEY","APACHE JUNCTION","FOUNTAIN HILLS", "PARADISE VALLEY","CAVE CREEK","CAREFREE","ANTHEM","EL MIRAGE","YOUNGTOWN","LITCHFIELD PARK", "TOLLESON","WADDELL","SUN CITY","SUN CITY WEST","NEW RIVER","AHWATUKEE","MARICOPA","CASA GRANDE", "FLORENCE","SUN LAKES","GOLD CANYON","QUEEN VALLEY","WITTMANN","WICKENBURG","MORRISTOWN","LAVEEN","BLACK CANYON CITY","CONGRESS","STANFIELD","GLOBE"]),
      NORTH: new Set(["PRESCOTT","PRESCOTT VALLEY","FLAGSTAFF","PAYSON","SEDONA","COTTONWOOD","CAMP VERDE","CHINO VALLEY", "DEWEY","WILLIAMS","KINGMAN","CLARKDALE","PINE","STRAWBERRY","STAR VALLEY","VILLAGE OF OAK CREEK","MUNDS PARK","MAYER","WINKELMAN","RIO VERDE"]),
      SOUTH: new Set(["TUCSON","SOUTH TUCSON","MARANA","ORO VALLEY","SAHUARITA","GREEN VALLEY","VAIL","NOGALES","RIO RICO", "SADDLEBROOKE","ELOY","ARIZONA CITY","COOLIDGE","VALLEY FARMS","RED ROCK","ORACLE"]),
  },

  // County ArcGIS services for APN lookup
  COUNTY_APN_SERVICES: {
    MARICOPA: {
      name: "Maricopa County",
      queryUrl: "https://gis.mcassessor.maricopa.gov/arcgis/rest/services/Parcels/MapServer/0/query",
      addressField: "PHYSICAL_ADDRESS",
      apnField: "APN_DASH",
      ownerField: "OWNER_NAME",
      detailUrl: "https://mcassessor.maricopa.gov/mcs/?q=",
      cities: new Set(["PHOENIX","SCOTTSDALE","TEMPE","MESA","CHANDLER","GILBERT","GLENDALE","PEORIA","SURPRISE","AVONDALE","GOODYEAR","BUCKEYE","QUEEN CREEK","APACHE JUNCTION","FOUNTAIN HILLS","PARADISE VALLEY","CAVE CREEK","CAREFREE","ANTHEM","EL MIRAGE","YOUNGTOWN","LITCHFIELD PARK","TOLLESON","WADDELL","SUN CITY","SUN CITY WEST","NEW RIVER","AHWATUKEE","SUN LAKES","GOLD CANYON","QUEEN VALLEY","WITTMANN","WICKENBURG","MORRISTOWN","LAVEEN","CONGRESS","GLOBE"])
    },
    PINAL: {
      name: "Pinal County",
      queryUrl: "https://rogue.casagrandeaz.gov/arcgis/rest/services/Pinal_County/Pinal_County_Assessor_Info/FeatureServer/0/query",
      addressField: "SITEADDRESS",
      apnField: "PARCELID",
      ownerField: "OWNERNME1",
      detailUrl: "https://app1.pinal.gov/Search/Parcel-Details.aspx?parcel_ID=",
      formatApnForUrl: (apn) => apn.replace(/-/g, ''),
      cities: new Set(["MARICOPA","CASA GRANDE","FLORENCE","SAN TAN VALLEY","ARIZONA CITY","ELOY","COOLIDGE","STANFIELD"])
    },
    PIMA: {
      name: "Pima County",
      queryUrl: "https://gisdata.pima.gov/arcgis1/rest/services/GISOpenData/LandRecords/MapServer/12/query",
      addressField: "ADDRESS_OL",
      apnField: "PARCEL",
      ownerField: null, // Owner info not available in this layer
      detailUrl: "https://gis.pima.gov/maps/detail.cfm?parcel=",
      cities: new Set(["TUCSON","SOUTH TUCSON","MARANA","ORO VALLEY","SAHUARITA","GREEN VALLEY","VAIL","SADDLEBROOKE","RED ROCK","ORACLE"])
    },
    GILA: {
      name: "Gila County",
      queryUrl: "https://gis.gilacountyaz.gov/arcgis/rest/services/ParcelService/ParcelService/MapServer/0/query",
      addressField: "ADDRESS",
      apnField: "APN",
      ownerField: "Owner1",
      detailUrl: "https://assessor.gilacountyaz.gov/assessor/taxweb/search.jsp",
      cities: new Set(["PAYSON","GLOBE","PINE","STRAWBERRY","STAR VALLEY"])
    },
    YAVAPAI: {
      name: "Yavapai County",
      queryUrl: "https://gis.yavapaiaz.gov/ArcGIS/rest/services/Property/MapServer/0/query",
      addressField: "SITUS",
      apnField: "APN",
      ownerField: "OWNER",
      detailUrl: "https://gis.yavapaiaz.gov/v4/search.aspx#",
      cities: new Set(["PRESCOTT","PRESCOTT VALLEY","SEDONA","COTTONWOOD","CAMP VERDE","CHINO VALLEY","DEWEY","CLARKDALE","VILLAGE OF OAK CREEK","MAYER"])
    },
    COCONINO: {
      name: "Coconino County",
      queryUrl: "https://webmaps.coconino.az.gov/arcgis/rest/services/ParcelOwnerInfo/MapServer/0/query",
      addressField: "SITUS",
      apnField: "APN",
      ownerField: "OWNER",
      detailUrl: "https://eagleassessor.coconino.az.gov:444/assessor/taxweb/search.jsp",
      cities: new Set(["FLAGSTAFF","WILLIAMS","MUNDS PARK"])
    }
  },

  // Get county service config based on city
  getCountyForCity(city) {
    const upperCity = (city || '').toUpperCase();
    for (const [countyKey, config] of Object.entries(this.COUNTY_APN_SERVICES)) {
      if (config.cities.has(upperCity)) {
        return { key: countyKey, ...config };
      }
    }
    return null;
  },

  // Lookup APN from county ArcGIS service
  async lookupAPN(address, city) {
    const county = this.getCountyForCity(city);
    if (!county) {
      console.log(`[APN Lookup] No county service found for city: ${city}`);
      return { success: false, error: `No APN service available for ${city}` };
    }

    console.log(`[APN Lookup] Searching ${county.name} for: ${address}`);

    try {
      // Extract street address for search (first part before city/state)
      const streetPart = address.split(',')[0].trim().toUpperCase();

      // Build query - search for addresses containing the street
      const whereClause = `${county.addressField} LIKE '%${streetPart.replace(/'/g, "''")}%'`;

      // Include owner field if available
      let outFields = `${county.apnField},${county.addressField}`;
      if (county.ownerField) {
        outFields += `,${county.ownerField}`;
      }

      const params = new URLSearchParams({
        where: whereClause,
        outFields: outFields,
        returnGeometry: 'false',
        f: 'json'
      });

      const url = `${county.queryUrl}?${params.toString()}`;
      console.log(`[APN Lookup] Query URL: ${url}`);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.message || 'Query error');
      }

      if (data.features && data.features.length > 0) {
        const feature = data.features[0];
        const apn = feature.attributes[county.apnField];
        const matchedAddress = feature.attributes[county.addressField];
        const ownerName = county.ownerField ? feature.attributes[county.ownerField] : null;

        // Format URL for county assessor detail page
        let detailUrl = county.detailUrl;
        if (county.formatApnForUrl) {
          detailUrl += county.formatApnForUrl(apn);
        } else {
          detailUrl += apn;
        }

        console.log(`[APN Lookup] Found APN: ${apn}, Owner: ${ownerName || 'N/A'}`);
        return {
          success: true,
          apn: apn,
          owner: ownerName,
          county: county.name,
          matchedAddress: matchedAddress,
          detailUrl: detailUrl
        };
      }

      console.log(`[APN Lookup] No results found`);
      return { success: false, error: 'No parcel found for this address' };

    } catch (error) {
      console.error(`[APN Lookup] Error:`, error);
      return { success: false, error: error.message };
    }
  },

  // --- Logic Functions ---
  
  blockWindowForDate(date) {
    const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    return [
      { key:"B1", label:"7:30am-9am", start:new Date(y,m,d,7,30), end:new Date(y,m,d,9,0) },
      { key:"B2", label:"10am-12pm", start:new Date(y,m,d,10,0), end:new Date(y,m,d,12,0) },
      { key:"B3", label:"1pm-3pm",  start:new Date(y,m,d,13,0), end:new Date(y,m,d,15,0) },
      { key:"B4", label:"4pm-6pm",  start:new Date(y,m,d,16,0), end:new Date(y,m,d,18,0) },
    ];
  },

  overlapMinutes(a, b) {
    const start = Math.max(new Date(a.start).getTime(), new Date(b.start).getTime());
    const end = Math.min(new Date(a.end).getTime(), new Date(b.end).getTime());
    return end > start ? (end - start) / 60000 : 0;
  },

  findCityInString(text) {
    const T = String(text).toUpperCase();
    for (const regionKey of ['PHX', 'NORTH', 'SOUTH']) {
      for (const city of this.REGION_CITY_WHITELISTS[regionKey] || []) {
        if (new RegExp(`\\b${city}\\b`, "i").test(T)) return { city, region: regionKey };
      }
    }
    return null;
  },

  getCityFromEvent(ev) {
    const text = [ev.title || "", ev.address || "", ev.notes || ""].join(" ");
    return this.findCityInString(text)?.city || null;
  },

  passesRegion(e, regionKey) {
    if (regionKey === "ALL") return true;
    const hit = this.findCityInString([e.title, e.address, e.notes].join(' '));
    // If no city is found, it's "uncategorized" and should show up in all filters.
    if (!hit) return true; 
    return hit.region === regionKey;
  },
  
  getRegionForCity(city) {
      const C = city.toUpperCase();
      if(this.REGION_CITY_WHITELISTS.PHX.has(C)) return 'PHX';
      if(this.REGION_CITY_WHITELISTS.NORTH.has(C)) return 'NORTH';
      if(this.REGION_CITY_WHITELISTS.SOUTH.has(C)) return 'SOUTH';
      return null;
  },
  
  sumMaps(a, b) {
    if (!a) return b;
    if (!b) return a;
    const out = { B1: [], B2: [], B3: [], B4: [] };
    const blockKeys = ["B1", "B2", "B3", "B4"];
    for (const k of blockKeys) {
        for (let i = 0; i < 7; i++) {
            out[k][i] = (a[k]?.[i] || 0) + (b[k]?.[i] || 0);
        }
    }
    return out;
  },
  
  getCapacity(regionKey, jsWeekday, blockKey, availability) {
    const map = availability[regionKey];
    if (!map || !map[blockKey]) return null;
    const WEEKDAY_TO_MONFIRST = [6, 0, 1, 2, 3, 4, 5];
    const idx = WEEKDAY_TO_MONFIRST[jsWeekday];
    const v = map[blockKey][idx];
    return Number.isFinite(v) ? v : null;
  },
  
  computeDailyTotals(dateStr, eventsForDay, availability, region) {
    const perBlockBooked = { B1: 0, B2: 0, B3: 0, B4: 0 };
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
    const perBlockRemaining = { B1: null, B2: null, B3: null, B4: null };
    const blockKeys = ["B1", "B2", "B3", "B4"];

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

  buildCityTally(dateStr, eventsForDay) {
    const perCity = new Map();
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
  
   resolveCityCandidatesFromInput(text) {
    const zipMatch = text.match(/\b(\d{5})\b/);
    const zip = zipMatch ? zipMatch[1] : null;
    const fromZipCity = zip ? this.ZIP_TO_CITY[zip] || this.ZIP_TO_CITY[zip.slice(0, 3)] : null;

    const fromTextCity = this.findCityInString(text)?.city;
    let primary = (fromTextCity || fromZipCity || '').toUpperCase();

    // If city not found in whitelist, try to extract from address pattern
    // Pattern: "Street, City, State Zip" or "Street, City, AZ, 12345" (handles comma before zip)
    if (!primary) {
      const addressPattern = /,\s*([A-Za-z\s]+),\s*(?:AZ|Arizona)[,\s]*\d{5}/i;
      const match = text.match(addressPattern);
      if (match && match[1]) {
        primary = match[1].trim().toUpperCase();
      }
    }

    // Still no city? Try simpler pattern: word(s) before state abbreviation
    if (!primary) {
      const simplePattern = /,\s*([A-Za-z\s]+),\s*(?:AZ|Arizona)/i;
      const match = text.match(simplePattern);
      if (match && match[1]) {
        primary = match[1].trim().toUpperCase();
      }
    }

    if (!primary) return [];

    const candidates = new Set([primary]);
    const adjacents = this.CITY_ADJACENCY[primary.replace(/\s/g,'_')] || [];
    adjacents.forEach(c => candidates.add(c.toUpperCase()));

    return Array.from(candidates);
  },

  // Free Address Verification using US Census Bureau Geocoding API (no API key required)
  async verifyAddress(addressString) {
    // Try original address first, then normalized version if that fails
    const addressesToTry = [
      addressString.replace(/\s+/g, ' ').trim(),
      this.normalizeAddressForAPI(addressString.replace(/\s+/g, ' ').trim())
    ];

    // Remove duplicates
    const uniqueAddresses = [...new Set(addressesToTry)];

    for (const cleanAddress of uniqueAddresses) {
      try {
        const encodedAddress = encodeURIComponent(cleanAddress);
        const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodedAddress}&benchmark=Public_AR_Current&format=json`;

        const response = await fetch(url);
        if (!response.ok) continue;

        const data = await response.json();

        if (data.result && data.result.addressMatches && data.result.addressMatches.length > 0) {
          const match = data.result.addressMatches[0];
          const components = match.addressComponents;

          const city = (components.city || '').toUpperCase();
          const state = (components.state || '').toUpperCase();
          const zip = components.zip || '';
          const matchedAddress = match.matchedAddress || '';

          // Only accept Arizona addresses
          if (state !== 'AZ') {
            return {
              success: false,
              error: `Address is in ${state}, not Arizona`,
              city,
              state,
              zip
            };
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
        // Continue to next address variant
        continue;
      }
    }

    return { success: false, error: 'No address match found' };
  },

  // Clean up address string - remove country, extra suffixes, and standardize
  cleanAddressString(address) {
    return address
      // Remove "United States" or "USA" at the end
      .replace(/,?\s*(United States|USA|US|U\.S\.A\.?|U\.S\.?)$/i, '')
      // Remove trailing date/time info
      .replace(/\s*-?\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*.*/i, '')
      .replace(/\s*at\s+\d{1,2}:\d{2}\s*(AM|PM)?\s*(MST|PST|EST|CST|MDT|PDT|EDT|CDT)?/i, '')
      // Clean up multiple commas or spaces
      .replace(/,\s*,/g, ',')
      .replace(/\s+/g, ' ')
      .trim();
  },

  // Extract best address string from event for verification
  extractAddressForVerification(event) {
    const title = event.title || '';

    // Split by " - " to find address segments
    const parts = title.split(' - ');

    // Look for a part that looks like a street address (starts with number, has street suffix)
    const streetSuffixes = /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way|pkwy|parkway|pl|place|cir|circle|trl|trail|hwy|highway|loop)\b/i;

    for (const part of parts) {
      const trimmed = part.trim();
      // Check if it starts with a number and contains a street suffix
      if (/^\d+\s+/.test(trimmed) && streetSuffixes.test(trimmed)) {
        let address = this.cleanAddressString(trimmed);

        // Add Arizona if no state specified
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

    // Fallback: try to find address pattern anywhere in the title
    const addressMatch = title.match(/(\d+\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9\s]+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Blvd|Boulevard|Ln|Lane|Ct|Court|Way|Pkwy|Parkway|Pl|Place|Cir|Circle|Trl|Trail|Hwy|Highway|Loop)\.?(?:[,\s]+[A-Za-z\s]+)?(?:[,\s]+(?:AZ|Arizona))?(?:[,\s]+\d{5})?)/i);

    if (addressMatch) {
      let address = this.cleanAddressString(addressMatch[1]);
      if (!/\b(AZ|Arizona)\b/i.test(address)) {
        address = address + ', AZ';
      }
      return address;
    }

    // Last resort: return the last part that has numbers
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

  // Normalize address for better API matching - expand/standardize abbreviations
  normalizeAddressForAPI(address) {
    let normalized = address;

    // Direction abbreviations (be careful with word boundaries)
    const directions = {
      '\\bN\\.?\\s': 'North ',
      '\\bS\\.?\\s': 'South ',
      '\\bE\\.?\\s': 'East ',
      '\\bW\\.?\\s': 'West ',
      '\\bNE\\.?\\s': 'Northeast ',
      '\\bNW\\.?\\s': 'Northwest ',
      '\\bSE\\.?\\s': 'Southeast ',
      '\\bSW\\.?\\s': 'Southwest ',
    };

    // Street type abbreviations
    const streetTypes = {
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

    // Apply direction expansions
    for (const [abbr, full] of Object.entries(directions)) {
      normalized = normalized.replace(new RegExp(abbr, 'gi'), full);
    }

    // Apply street type expansions
    for (const [abbr, full] of Object.entries(streetTypes)) {
      normalized = normalized.replace(new RegExp(abbr, 'gi'), full);
    }

    return normalized;
  },

  // Verify and categorize an uncategorized event
  async verifyAndCategorizeEvent(event) {
    const addressString = this.extractAddressForVerification(event);
    const result = await this.verifyAddress(addressString);

    if (result.success && result.city) {
      // If city is known, return the region
      if (result.isKnownCity) {
        return {
          success: true,
          city: result.city,
          region: result.region,
          matchedAddress: result.matchedAddress,
          isNewCity: false
        };
      }
      // City not in whitelist but address is valid
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

  // Suggest a region based on coordinates (rough geographic boundaries for Arizona)
  suggestRegionForCity(city, coordinates) {
    if (!coordinates) return 'PHX'; // Default to PHX if no coordinates

    const lat = coordinates.y;
    const lng = coordinates.x;

    // Rough boundaries for Arizona regions:
    // PHX Metro: roughly 33.0-34.0 lat, -113 to -111 lng
    // North: above 34.2 lat
    // South: below 32.5 lat (Tucson area)

    if (lat > 34.2) return 'NORTH';
    if (lat < 32.5) return 'SOUTH';
    return 'PHX';
  },

  parseJobDetails(event) {
    const title = (event.title || "").trim();
    const details = {
        event: event,
        id: `${event.title}|${event.start}`,
        city: 'Unknown',
        address: title,
        hashTags: 0,
        jobType: 'Residential',
        rawTags: [],
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
    if (addressParts.length > 1 && addressParts[addressParts.length - 1].match(/\d/)) {
        details.address = addressParts.pop().trim();
        content = addressParts.join(' - ').trim();
    }
    
    // City
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
    
    // Job Type & Raw Tags (replaces old parenthesis logic)
    const jobTypesFound = new Set();
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

    // Roof Type
    const roofTypes = new Set();
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
    PRODUCTION: ["Jayda Fairfield", "Justin Saiz"].sort(),
};
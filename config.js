// config.js
// This file contains the static configuration and business logic for the Roofr extension.

export const CONFIG = {
  // Deprecated: this key was revoked. Sheets reads now go through the proxy
  // at https://az-roofers-tech-scheduler.vercel.app/api/sheets (service-account auth).
  // Field kept as a non-empty placeholder so legacy `if (!apiKey)` guards still pass.
  apiKey: "DEPRECATED_USE_PROXY",

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

  // Check if a city is adjacent to a target city
  isAdjacentTo(city, targetCity) {
    if (!city || !targetCity) return false;
    const adjacents = this.CITY_ADJACENCY[targetCity.toUpperCase()] || [];
    return adjacents.includes(city.toUpperCase());
  },

  // Get all adjacent cities for a given city
  getAdjacentCities(city) {
    if (!city) return [];
    return this.CITY_ADJACENCY[city.toUpperCase()] || [];
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

  UP_NORTH_TRAVEL_CITIES: new Set([
    "PRESCOTT", "PRESCOTT VALLEY", "CHINO VALLEY", "DEWEY", "MAYER",
    "SEDONA", "COTTONWOOD", "CLARKDALE", "CAMP VERDE", "VILLAGE OF OAK CREEK",
    "PAYSON", "PINE", "STRAWBERRY", "STAR VALLEY"
  ]),

  REQUIRED_NORTH_CITIES: new Set([
    "FLAGSTAFF", "WILLIAMS", "MUNDS PARK", "PARKS",
    "PAGE", "TUBA CITY", "KAYENTA", "FREDONIA",
    "KINGMAN", "WINKELMAN", "RIO VERDE"
  ]),

  REGION_CITY_WHITELISTS: {
      PHX: new Set(["PHOENIX","SCOTTSDALE","TEMPE","MESA","CHANDLER","GILBERT","GLENDALE","PEORIA","SURPRISE", "AVONDALE","GOODYEAR","BUCKEYE","QUEEN CREEK","SAN TAN VALLEY","APACHE JUNCTION","FOUNTAIN HILLS", "PARADISE VALLEY","CAVE CREEK","CAREFREE","ANTHEM","EL MIRAGE","YOUNGTOWN","LITCHFIELD PARK", "TOLLESON","WADDELL","SUN CITY","SUN CITY WEST","NEW RIVER","AHWATUKEE","MARICOPA","CASA GRANDE", "FLORENCE","SUN LAKES","GOLD CANYON","QUEEN VALLEY","WITTMANN","WICKENBURG","MORRISTOWN","LAVEEN","BLACK CANYON CITY","CONGRESS","STANFIELD","GLOBE","PRESCOTT","PRESCOTT VALLEY","CHINO VALLEY","DEWEY","MAYER","SEDONA","COTTONWOOD","CLARKDALE","CAMP VERDE","VILLAGE OF OAK CREEK","PAYSON","PINE","STRAWBERRY","STAR VALLEY"]),
      NORTH: new Set(["FLAGSTAFF","WILLIAMS","MUNDS PARK","PARKS","PAGE","TUBA CITY","KAYENTA","FREDONIA","KINGMAN","WINKELMAN","RIO VERDE"]),
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
      suiteField: "PHYSICAL_SUITE",
      lotField: "LOT_NUM",
      latField: "LATITUDE",
      lngField: "LONGITUDE",
      detailUrl: "https://mcassessor.maricopa.gov/mcs/?q=",
      propertyFields: {
        yearBuilt: "CONST_YEAR",
        sqft: "LIVING_SPACE",
        stories: "FLOOR",
        subdivision: "SUBNAME",
        propertyValue: "FCV_CUR",
        salePrice: "SALE_PRICE",
        saleDate: "SALE_DATE",
        // Added 2026-06-05: absentee-owner + recency signals (Maricopa-only fields)
        mailAddress: "MAIL_ADDRESS",
        mailCity: "MAIL_CITY",
        mailState: "MAIL_STATE",
        legalClass: "LC_CUR",
        deedDate: "DEED_DATE",
        inCareOf: "INCAREOF",
      },
      cities: new Set(["PHOENIX","SCOTTSDALE","TEMPE","MESA","CHANDLER","GILBERT","GLENDALE","PEORIA","SURPRISE","AVONDALE","GOODYEAR","BUCKEYE","QUEEN CREEK","APACHE JUNCTION","FOUNTAIN HILLS","PARADISE VALLEY","CAVE CREEK","CAREFREE","ANTHEM","EL MIRAGE","YOUNGTOWN","LITCHFIELD PARK","TOLLESON","WADDELL","SUN CITY","SUN CITY WEST","NEW RIVER","AHWATUKEE","SUN LAKES","GOLD CANYON","QUEEN VALLEY","WITTMANN","WICKENBURG","MORRISTOWN","LAVEEN","CONGRESS","GLOBE"])
    },
    PINAL: {
      name: "Pinal County",
      queryUrl: "https://rogue.casagrandeaz.gov/arcgis/rest/services/Pinal_County/Pinal_County_Assessor_Info/FeatureServer/0/query",
      addressField: "PSTLADDRESS",
      apnField: "PARCELID",
      ownerField: "OWNERNME1",
      detailUrl: "https://app1.pinal.gov/Search/Parcel-Details.aspx?parcel_ID=",
      formatApnForUrl: (apn) => apn.replace(/-/g, ''),
      propertyFields: {
        yearBuilt: "RESYRBLT",
        sqft: "RESFLRAREA",
        stories: "FLOORCOUNT",
        subdivision: "CNVYNAME",
        propertyValue: "CNTASSDVAL",
        salePrice: "SALEPRICE",
        saleDate: "SALEDATE",
      },
      cities: new Set(["MARICOPA","CASA GRANDE","FLORENCE","SAN TAN VALLEY","ARIZONA CITY","ELOY","COOLIDGE","STANFIELD"])
    },
    PIMA: {
      name: "Pima County",
      queryUrl: "https://gisdata.pima.gov/arcgis1/rest/services/GISOpenData/LandRecords/MapServer/12/query",
      addressField: "ADDRESS_OL",
      apnField: "PARCEL",
      ownerField: null, // Owner info not available in this layer
      detailUrl: "https://gis.pima.gov/maps/detail.cfm?parcel=",
      propertyFields: {
        propertyValue: "FCV",
      },
      cities: new Set(["TUCSON","SOUTH TUCSON","MARANA","ORO VALLEY","SAHUARITA","GREEN VALLEY","VAIL","SADDLEBROOKE","RED ROCK","ORACLE"])
    },
    GILA: {
      name: "Gila County",
      queryUrl: "https://gis.gilacountyaz.gov/arcgis/rest/services/ParcelService/ParcelService/MapServer/0/query",
      addressField: "ADDRESS",
      apnField: "APN",
      ownerField: "Owner1",
      detailUrl: "https://assessor.gilacountyaz.gov/assessor/taxweb/search.jsp",
      // No property detail fields available in this GIS layer
      propertyFields: {},
      cities: new Set(["PAYSON","GLOBE","PINE","STRAWBERRY","STAR VALLEY"])
    },
    YAVAPAI: {
      name: "Yavapai County",
      queryUrl: "https://gis.yavapaiaz.gov/ArcGIS/rest/services/Parcels/MapServer/0/query",
      addressField: "SITUS_ADD_DOR",
      apnField: "PARCEL_ID",
      ownerField: "NAME",
      detailUrl: "https://gis.yavapaiaz.gov/v4/search.aspx#",
      propertyFields: {
        subdivision: "SUBNAME",
      },
      cities: new Set(["PRESCOTT","PRESCOTT VALLEY","SEDONA","COTTONWOOD","CAMP VERDE","CHINO VALLEY","DEWEY","CLARKDALE","VILLAGE OF OAK CREEK","MAYER"])
    },
    COCONINO: {
      name: "Coconino County",
      queryUrl: "https://webmaps.coconino.az.gov/arcgis/rest/services/ParcelOwnerInfo/MapServer/0/query",
      addressField: "SITUS",
      apnField: "APN",
      ownerField: "OWNER",
      detailUrl: "https://gismaps.coconino.az.gov/parcelviewer/?apn=",
      // Server frequently unreachable; no property detail fields confirmed
      propertyFields: {},
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
      let streetPart = address.split(',')[0].trim().toUpperCase();

      // Detect a unit/suite or lot number in the typed address (exact-parcel lock-down)
      let unitToken = null, lotToken = null;
      const _um = address.match(/(?:#\s*|\b(?:unit|apt|apartment|ste|suite|spc|space|bldg|building)\s+)([A-Za-z0-9-]+)/i);
      if (_um) unitToken = _um[1].toUpperCase();
      const _lm = address.match(/\blot\s*#?\s*([0-9]+[A-Za-z]?)\b/i);
      if (_lm) lotToken = _lm[1].toUpperCase();

      // Extract house number and street name start for flexible matching
      // This helps with variations like "Street" vs "ST", "Avenue" vs "AVE"
      const houseNumMatch = streetPart.match(/^(\d+)\s+(.+)/);
      if (houseNumMatch) {
        const houseNum = houseNumMatch[1];
        const streetWords = houseNumMatch[2].split(/\s+/);
        // Match on house# + street NAME only, DROPPING any leading directional.
        // Counties abbreviate directionals inconsistently ("E" vs "EAST") and store
        // abbreviated street types ("ST" not "STREET"), so including the directional
        // breaks the LIKE — e.g. "1392 EAST SARAGOSA" never matches "1392 E SARAGOSA ST".
        // Skipping it matches whether the rep typed "E", "East", or nothing.
        const directions = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'NORTH', 'SOUTH', 'EAST', 'WEST'];
        let idx = 0;
        if (directions.includes(streetWords[0]) && streetWords.length > 1) idx = 1;
        const streetName = streetWords[idx];
        streetPart = houseNum + '%' + streetName;
      }

      // Build query - search for addresses containing the street pattern
      const whereClause = `${county.addressField} LIKE '%${streetPart.replace(/'/g, "''")}%'`;

      // Include owner field and all property data fields
      let outFields = `${county.apnField},${county.addressField}`;
      if (county.ownerField) {
        outFields += `,${county.ownerField}`;
      }
      // Add all property detail fields for this county
      if (county.propertyFields) {
        const extraFields = Object.values(county.propertyFields).join(',');
        outFields += `,${extraFields}`;
      }
      // Geo + unit/lot fields (per-county) for GPS pinning + exact-parcel lock-down
      for (const k of ['suiteField', 'lotField', 'latField', 'lngField']) {
        if (county[k]) outFields += `,${county[k]}`;
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
        let features = data.features;
        const totalMatches = features.length;
        // Lock to the exact unit/lot if the rep specified one in the address
        if (features.length > 1 && unitToken && county.suiteField) {
          const m = features.filter(f => String(f.attributes[county.suiteField] || '').trim().toUpperCase() === unitToken);
          if (m.length) features = m;
        }
        if (features.length > 1 && lotToken && county.lotField) {
          const m = features.filter(f => String(f.attributes[county.lotField] || '').trim().toUpperCase() === lotToken);
          if (m.length) features = m;
        }
        const ambiguous = features.length > 1;
        // Candidate list for the picker when still ambiguous (multiple units, none specified)
        const candidates = ambiguous ? features.slice(0, 25).map(f => ({
          apn: f.attributes[county.apnField],
          address: String(f.attributes[county.addressField] || '').replace(/\s+/g, ' ').trim(),
          suite: county.suiteField ? (String(f.attributes[county.suiteField] || '').trim() || null) : null,
          lot: county.lotField ? (String(f.attributes[county.lotField] || '').trim() || null) : null,
          owner: county.ownerField ? f.attributes[county.ownerField] : null,
          lat: county.latField ? f.attributes[county.latField] : null,
          lng: county.lngField ? f.attributes[county.lngField] : null
        })) : null;
        const feature = features[0];
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

        // Helper: parse a value that may be a number or a formatted string like "   1,446"
        const parseNum = (val) => {
          if (val === null || val === undefined || val === '') return null;
          if (typeof val === 'number') return val;
          const cleaned = String(val).replace(/[,\s$]/g, '');
          const num = Number(cleaned);
          return isNaN(num) ? null : num;
        };

        // Extract property data using the county's field mapping
        const propertyData = {};
        if (county.propertyFields) {
          for (const [key, fieldName] of Object.entries(county.propertyFields)) {
            const val = feature.attributes[fieldName];
            if (val !== null && val !== undefined && val !== '' && val !== 0) {
              propertyData[key] = val;
            }
          }
        }

        // Normalize numeric fields (Maricopa returns some as formatted strings)
        const numericKeys = ['yearBuilt', 'sqft', 'stories', 'propertyValue', 'salePrice'];
        for (const key of numericKeys) {
          if (propertyData[key] !== undefined) {
            const num = parseNum(propertyData[key]);
            if (num !== null) propertyData[key] = num;
          }
        }

        // Format sale date if present (handle both epoch timestamps and date strings)
        if (propertyData.saleDate) {
          if (typeof propertyData.saleDate === 'number') {
            propertyData.saleDate = new Date(propertyData.saleDate).toLocaleDateString('en-US');
          } else if (typeof propertyData.saleDate === 'string' && propertyData.saleDate.includes('-')) {
            // Handle "2021-07-01" format from Pinal
            propertyData.saleDate = new Date(propertyData.saleDate + 'T00:00:00').toLocaleDateString('en-US');
          }
          // Otherwise keep as-is (e.g., "08/01/2010" from Maricopa)
        }

        // Format property value as currency if present
        if (propertyData.propertyValue && typeof propertyData.propertyValue === 'number') {
          propertyData.propertyValueFormatted = '$' + propertyData.propertyValue.toLocaleString();
        }
        if (propertyData.salePrice && typeof propertyData.salePrice === 'number') {
          propertyData.salePriceFormatted = '$' + propertyData.salePrice.toLocaleString();
        }

        // Calculate roof age if year built is available
        if (propertyData.yearBuilt && typeof propertyData.yearBuilt === 'number') {
          const currentYear = new Date().getFullYear();
          propertyData.roofAge = currentYear - propertyData.yearBuilt;
        }

        // Format sqft with commas
        if (propertyData.sqft && typeof propertyData.sqft === 'number') {
          propertyData.sqftFormatted = propertyData.sqft.toLocaleString();
        }

        // --- Added 2026-06-05: deed recency + owner-occupancy / absentee signals (Maricopa) ---
        // Format deed date (Maricopa returns epoch ms or a date string)
        if (propertyData.deedDate) {
          if (typeof propertyData.deedDate === 'number') {
            propertyData.deedDate = new Date(propertyData.deedDate).toLocaleDateString('en-US');
          } else if (typeof propertyData.deedDate === 'string' && propertyData.deedDate.includes('-')) {
            propertyData.deedDate = new Date(propertyData.deedDate + 'T00:00:00').toLocaleDateString('en-US');
          }
        }
        // Legal class: Maricopa class 3 = owner-occupied primary residence; class 4 = rental / non-primary
        if (propertyData.legalClass) {
          const lc = String(propertyData.legalClass).trim();
          if (lc.startsWith('3')) propertyData.ownerType = 'Owner-occupied';
          else if (lc.startsWith('4')) propertyData.ownerType = 'Rental / non-primary';
        }
        // Absentee owner: mailing location differs from the property (out-of-state OR different city)
        {
          const ms = String(propertyData.mailState || '').trim().toUpperCase();
          const mc = String(propertyData.mailCity || '').trim().toUpperCase();
          const prop = String(matchedAddress || '').toUpperCase();
          let absentee = false;
          if (ms && ms !== 'AZ') absentee = true;                      // out of state
          else if (mc && prop && !prop.includes(mc)) absentee = true;  // in-state, different city
          if (absentee) {
            propertyData.absentee = true;
            propertyData.absenteeLocation = [mc, ms].filter(Boolean).join(', ') || ms || mc;
          }
        }

        // --- Added 2026-06-05: residential characteristics (roof type, etc.) via server-side proxy ---
        // Token stays on the server (speed-to-lead env: MARICOPA_ASSESSOR_TOKEN). Maricopa only for now.
        if (county.name === 'Maricopa County') {
          try {
            const pr = await fetch(`https://speed-to-leads.vercel.app/api/maricopa-property?apn=${encodeURIComponent(apn)}`, {
              headers: { 'X-Dialer-Client': 'roofr-extension' }
            });
            if (pr.ok) {
              const pj = await pr.json();
              const r = pj && pj.success ? pj.residential : null;
              if (r) {
                if (r.roofType) propertyData.roofType = r.roofType;
                if (r.qualityGrade) propertyData.qualityGrade = r.qualityGrade;
                if (r.garages) propertyData.garages = r.garages;
                if (r.cooling) propertyData.cooling = r.cooling;
                if (!propertyData.sqftFormatted && r.livableSqft) {
                  const n = Number(r.livableSqft);
                  if (!isNaN(n)) propertyData.sqftFormatted = n.toLocaleString();
                }
              }
            }
          } catch (e) { console.log('[APN Lookup] roof proxy error:', e.message); }
        }

        // Geo + unit/lot onto propertyData (for GPS pinning + display)
        if (county.latField && feature.attributes[county.latField] != null) propertyData.lat = feature.attributes[county.latField];
        if (county.lngField && feature.attributes[county.lngField] != null) propertyData.lng = feature.attributes[county.lngField];
        if (county.suiteField) { const sv = String(feature.attributes[county.suiteField] || '').trim(); if (sv) propertyData.suite = sv; }
        if (county.lotField) { const lv = String(feature.attributes[county.lotField] || '').trim(); if (lv) propertyData.lotNum = lv; }

        console.log(`[APN Lookup] Found APN: ${apn}, Owner: ${ownerName || 'N/A'}, Property data:`, propertyData);
        return {
          success: true,
          apn: apn,
          owner: ownerName,
          county: county.name,
          matchedAddress: matchedAddress,
          detailUrl: detailUrl,
          propertyData: propertyData,
          ambiguous: ambiguous,
          matchCount: totalMatches,
          candidates: candidates
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
  
  // April 6 2026: schedule changes from old blocks to new blocks
  SCHEDULE_CUTOVER: new Date(2026, 3, 6), // months are 0-indexed, so 3 = April

  blockWindowForDate(date) {
    const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    const useNew = date >= this.SCHEDULE_CUTOVER;
    if (useNew) {
      return [
        { key:"B1", label:"8am-10am",  start:new Date(y,m,d,8,0),  end:new Date(y,m,d,10,0) },
        { key:"B2", label:"11am-1pm",  start:new Date(y,m,d,11,0), end:new Date(y,m,d,13,0) },
        { key:"B3", label:"2pm-4pm",   start:new Date(y,m,d,14,0), end:new Date(y,m,d,16,0) },
        { key:"B4", label:"5pm-7pm",   start:new Date(y,m,d,17,0), end:new Date(y,m,d,19,0) },
      ];
    }
    return [
      { key:"B1", label:"7:30am-10am", start:new Date(y,m,d,7,30), end:new Date(y,m,d,10,0) },
      { key:"B2", label:"10am-1pm",    start:new Date(y,m,d,10,0), end:new Date(y,m,d,13,0) },
      { key:"B3", label:"1pm-4pm",     start:new Date(y,m,d,13,0), end:new Date(y,m,d,16,0) },
      { key:"B4", label:"4pm-7pm",     start:new Date(y,m,d,16,0), end:new Date(y,m,d,19,0) },
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
      const C = String(city || "").trim().toUpperCase();
      if(this.REGION_CITY_WHITELISTS.PHX.has(C)) return 'PHX';
      if(this.REGION_CITY_WHITELISTS.NORTH.has(C)) return 'NORTH';
      if(this.REGION_CITY_WHITELISTS.SOUTH.has(C)) return 'SOUTH';
      return null;
  },

  getRequiredRegionForCity(city) {
      const C = String(city || "").trim().toUpperCase();
      if (this.UP_NORTH_TRAVEL_CITIES.has(C)) return 'PHX';
      if (this.REQUIRED_NORTH_CITIES.has(C)) return 'NORTH';
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
      const occupiedKeys = new Set();
      for (const blk of blocks) {
        if (this.overlapMinutes({ start: ev.start, end: ev.end }, blk) >= 15) {
          occupiedKeys.add(blk.key);
        }
      }

      const city = this.getCityFromEvent(ev);
      if ((region === 'PHX' || region === 'ALL') && city && this.UP_NORTH_TRAVEL_CITIES.has(city) && occupiedKeys.size) {
        const primaryIndex = blocks.findIndex(blk => blk.key === occupiedKeys.values().next().value);
        const travelIndex = primaryIndex === blocks.length - 1 ? primaryIndex - 1 : primaryIndex + 1;
        if (travelIndex >= 0) occupiedKeys.add(blocks[travelIndex].key);
      }

      for (const key of occupiedKeys) perBlockBooked[key]++;
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
    const knownRegion = this.getRegionForCity(city);
    if (knownRegion) return knownRegion;
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
    REPS: ["Alex Tillotson", "Christian Noren", "Connor Hamby", "Jonathan Marino", "Josh Jewett", "Justin Parker", "London Smith", "Orlando Chavarria", "Richard Hadsall", "Stephen Chaidez", "Tanner Broadbent"].sort(),
    // Conor Smith, Jayda Fairfield, Raven Pelfrey, Travis Jones are intentional duplicates —
    // they're also Production/CSR but Travis wants them shown under Management too.
    MGMT: ["Andrew Clark", "Anthony Bonomo", "Bradley Crohurst", "Brenda Ochoa", "Conor Smith", "Jayda Fairfield", "Nikolas Pagoulatos", "Raven Pelfrey", "Travis Jones", "Yousef Ayad"].sort(),
    CSRS: ["Bronté Pisz", "Diva Shahpur", "Khamilah Valles", "Madi Meyers", "Mariana Ceballos", "Nica Javier", "Travis Jones"].sort(),

    // PRODUCTION / INSURANCE / D2D are live-synced from the Company Team Roster sheet
    // (Department column) on each People-tab load — see fetchRosterGroups() in popup.js.
    // These arrays are the OFFLINE FALLBACK used if the sheet fetch fails.
    PRODUCTION: ["Austin Huffman", "Brandon Jordan", "Brian Carter", "Carter Grant", "Chandler Duffy", "Conor Smith", "Jayda Fairfield", "Raven Pelfrey", "Robert Mcpherson"].sort(),
    INSURANCE: ["Aaron Munz", "Anthony Espinosa", "Catherine Bonomo", "Khamilah Valles", "Rebekah Fontenot"].sort(),
    D2D: ["Brandon Cook", "Brenda Ochoa", "Carson Anderson", "Dylan Lopez", "Israel Silva", "James Chernek", "James DeCoursey", "Jordan Depue", "Kory Dumone", "Michael Hurff", "Nahum Sandoval", "Tanner Stephens"].sort(),

    // CTM multi_agents user IDs — used to build per-rep CTM calls URLs
    CTM_USER_IDS: {
        "Travis Jones": "USR3C843ED7AB9B4711B0713552F9CF37DB",
        "Diva Shahpur": "USR3C843ED7AB9B471161CFE46CA61534DB",
        "Madi Meyers": "USR3C843ED7AB9B4711F9903DED76AC22FF",
        "Bronté Pisz": "USR3C843ED7AB9B471104E5442C4FF87F90",
        "Alex Tillotson": "USRB5384A8A5D54C211ABA4C4FF265EA00F",
        "Nica Javier": "USRC30FF30726A9F646577F250938765D31",
        "Khamilah Valles": "USRC30FF30726A9F646BB8E4B63EF5677D9",
        "Mariana Ceballos": "USR3BC964E3CA5C4BF656194430839D95D6",
        "Caite": "USR3C843ED7AB9B47118D66E874FF6151FD",
        "Anthony Espinosa": "USRC30FF30726A9F646798C58AF597D98E0",
        "Aaron Munz": "USR3C843ED7AB9B4711D25580F0C1D45997",
        "Raven Pelfrey": "USR3C843ED7AB9B4711C939E32294BA3ECC",
    },
};

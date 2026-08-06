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
      // Repointed 2026-07-20 to the City of Tucson "PropertyHousing / PAREGION" layer
      // (county-wide). The old gisdata.pima.gov LandRecords layer had NO owner, NO
      // coordinates, and NO year built — only FCV. This layer returns owner (ADDRESSEE),
      // LON/LAT (for the Google Earth pin + nearby-jobs + region classification), FCV,
      // and year built. Roof material is NOT available (Pima has no assessor API like
      // Maricopa's), and absentee is skipped here — Pima's SITE_ADDRESS is street-only,
      // so the mail-city-vs-address check would false-positive.
      queryUrl: "https://mapdata.tucsonaz.gov/public/rest/services/PublicMaps/PropertyHousing/MapServer/17/query",
      addressField: "SITE_ADDRESS",
      apnField: "PARCEL",
      ownerField: "ADDRESSEE",
      latField: "LAT",
      lngField: "LON",
      detailUrl: "https://gis.pima.gov/maps/detail.cfm?parcel=",
      propertyFields: {
        yearBuilt: "YearBuilt",
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
      // This helps with variations like "Street" vs "ST", "Avenue" vs "AVE".
      // Also capture what the rep DID type (exact house #, directional, street type,
      // ZIP) so the loose result set can be narrowed back down after the query.
      let qHouseNum = null, qDir = null, qType = null;
      const houseNumMatch = streetPart.match(/^(\d+)\s+(.+)/);
      if (houseNumMatch) {
        const houseNum = houseNumMatch[1];
        const streetWords = houseNumMatch[2].split(/\s+/);
        // Match on house# + street NAME only, DROPPING any leading directional.
        // Counties abbreviate directionals inconsistently ("E" vs "EAST") and store
        // abbreviated street types ("ST" not "STREET"), so including the directional
        // breaks the LIKE — e.g. "1392 EAST SARAGOSA" never matches "1392 E SARAGOSA ST".
        // Skipping it matches whether the rep typed "E", "East", or nothing.
        const DIR_ABBREV = { N:'N', S:'S', E:'E', W:'W', NE:'NE', NW:'NW', SE:'SE', SW:'SW', NORTH:'N', SOUTH:'S', EAST:'E', WEST:'W' };
        let idx = 0;
        if (DIR_ABBREV[streetWords[0]] && streetWords.length > 1) { qDir = DIR_ABBREV[streetWords[0]]; idx = 1; }
        const streetName = streetWords[idx];
        streetPart = houseNum + '%' + streetName;
        qHouseNum = houseNum;
        // Street type the rep typed, normalized to the county's abbreviation.
        // Last type-word wins so "W Parkway Dr" yields DR, not PKWY.
        const TYPE_ABBREV = { AVENUE:'AVE', AVE:'AVE', STREET:'ST', ST:'ST', DRIVE:'DR', DR:'DR', LANE:'LN', LN:'LN', PLACE:'PL', PL:'PL', ROAD:'RD', RD:'RD', BOULEVARD:'BLVD', BLVD:'BLVD', COURT:'CT', CT:'CT', CIRCLE:'CIR', CIR:'CIR', WAY:'WAY', TRAIL:'TRL', TRL:'TRL', PARKWAY:'PKWY', PKWY:'PKWY', TERRACE:'TER', TER:'TER', HIGHWAY:'HWY', HWY:'HWY', LOOP:'LOOP' };
        for (let i = idx + 1; i < streetWords.length; i++) { const t = TYPE_ABBREV[streetWords[i]]; if (t) qType = t; }
      }
      // ZIP if the typed address carries one (last standalone 5-digit group)
      const _zipGroups = address.match(/\b\d{5}\b/g);
      const qZip = _zipGroups ? _zipGroups[_zipGroups.length - 1] : null;

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
        // The loose LIKE ('%6302%37TH%') matches the same house number on DIFFERENT
        // streets — Phoenix numbered streets especially: "6302 N 37th Ave" also pulled
        // "6302 S 37th Ln" and "6302 N 37th Dr", and features[0] was the S 37th Ln
        // parcel ~10 miles away (wrong APN/owner/GPS, Google Earth flew to it).
        // It can even match a longer house number ("16302..." contains "6302").
        // Narrow by what the rep actually typed; each narrowing is skipped if it
        // would wipe out every candidate (county abbreviation quirks stay survivable).
        const _fAddr = (f) => String(f.attributes[county.addressField] || '').toUpperCase();
        const _narrow = (list, pred) => { const kept = list.filter(pred); return kept.length ? kept : list; };
        if (features.length > 1) {
          if (qHouseNum) features = _narrow(features, f => new RegExp('^\\s*' + qHouseNum + '\\s').test(_fAddr(f)));
          if (qDir) features = _narrow(features, f => new RegExp('\\b' + qDir + '\\b').test(_fAddr(f)));
          if (qType) features = _narrow(features, f => new RegExp('\\b' + qType + '\\b').test(_fAddr(f)));
          if (qZip) features = _narrow(features, f => _fAddr(f).indexOf(qZip) !== -1);
        }
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
  // July 14 2026: timeframes gain an hour (8-11, 11-1, 2-5, 5-8). The widened
  // windows are supersets of the old ones, so old-style appts still bucket the
  // same; the cutover just keeps past days labeled with the times that were
  // true then.
  SCHEDULE_CUTOVER_2: new Date(2026, 6, 14), // 6 = July

  // --- Per-week block definitions (storm weeks) ---
  // The SRA sheet normally has 4 appointment blocks per day; storm-template weeks
  // have 5 (8-10 / 10-12 / 1-3 / 3-5 / 5-7). The popup registers each parsed tab's
  // slot labels here, keyed by that sheet-week's MONDAY (YYYY-MM-DD). Only weeks
  // whose slot count differs from 4 are registered: regular 4-slot weeks keep the
  // hand-tuned widened windows in the date-cutover tiers below (sheet labels still
  // say "8am - 10am" while the real booking window is 8-11), so sheet labels must
  // NOT override them.
  WEEK_BLOCK_DEFS: {},

  // "8am - 10am" / "10am - 12pm" / "12:30pm - 3pm" -> {sh,sm,eh,em} or null.
  parseSlotLabel(label) {
    const m = String(label || "").match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (!m) return null;
    const to24 = (h, ap) => (h % 12) + (ap.toLowerCase() === "pm" ? 12 : 0);
    return {
      sh: to24(parseInt(m[1], 10), m[3]), sm: parseInt(m[2] || "0", 10),
      eh: to24(parseInt(m[4], 10), m[6]), em: parseInt(m[5] || "0", 10),
    };
  },

  // Monday (YYYY-MM-DD) of the sheet week (Mon-Sun) containing this local date.
  weekMondayKey(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
    d.setDate(d.getDate() + diff);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },

  // Called by the popup after parsing a weekly tab. labels = slot labels in sheet
  // order (col I). Registers only non-4-slot layouts; see WEEK_BLOCK_DEFS note.
  registerWeekBlocks(mondayKey, labels) {
    if (!mondayKey || !Array.isArray(labels)) return;
    if (labels.length === 4) { delete this.WEEK_BLOCK_DEFS[mondayKey]; return; }
    const defs = [];
    for (let i = 0; i < labels.length; i++) {
      const w = this.parseSlotLabel(labels[i]);
      if (!w) return; // any unparsable label -> keep cutover fallback for safety
      defs.push({ key: `B${i + 1}`, label: String(labels[i]).replace(/\s+/g, ""), ...w });
    }
    this.WEEK_BLOCK_DEFS[mondayKey] = defs;
  },

  blockWindowForDate(date) {
    const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
    const weekDefs = this.WEEK_BLOCK_DEFS[this.weekMondayKey(date)];
    if (weekDefs) {
      return weekDefs.map(def => ({
        key: def.key, label: def.label,
        start: new Date(y, m, d, def.sh, def.sm), end: new Date(y, m, d, def.eh, def.em),
      }));
    }
    if (date >= this.SCHEDULE_CUTOVER_2) {
      return [
        { key:"B1", label:"8am-11am",  start:new Date(y,m,d,8,0),  end:new Date(y,m,d,11,0) },
        { key:"B2", label:"11am-1pm",  start:new Date(y,m,d,11,0), end:new Date(y,m,d,13,0) },
        { key:"B3", label:"2pm-5pm",   start:new Date(y,m,d,14,0), end:new Date(y,m,d,17,0) },
        { key:"B4", label:"5pm-8pm",   start:new Date(y,m,d,17,0), end:new Date(y,m,d,20,0) },
      ];
    }
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

  // Which block(s) an event occupies: MAJORITY overlap (Travis, 2026-07-22).
  // Appointments booked under the old 4-slot windows can straddle two storm
  // blocks (8-11am = 2h in 8-10 + 1h in 10-12) — they should only consume the
  // block(s) holding most of their time. Exact ties count in every tied block
  // (2h + 2h books both). Still requires >=15 min to count at all.
  occupiedBlockKeys(ev, blocks) {
    let max = 0;
    const per = blocks.map(blk => {
      const m = this.overlapMinutes({ start: ev.start, end: ev.end }, blk);
      if (m > max) max = m;
      return m;
    });
    if (max < 15) return [];
    return blocks.filter((_, i) => per[i] === max).map(blk => blk.key);
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

  // GPS-based region bands for Arizona. NORTH above Black Canyon City (~34.07°N),
  // SOUTH below Picacho (~32.64°N), PHX between. Coords beat the city-name whitelists,
  // which mislabel places like Payson/Star Valley (north) as PHX. Verified against
  // booked-appointment coordinates 2026-06-26.
  REGION_LAT_NORTH: 34.07,
  REGION_LAT_SOUTH: 32.64,

  getRegionFromCoords(lat, lng) {
    const la = parseFloat(lat);
    // Missing or out-of-Arizona coords → can't classify (fall back to city name).
    if (!Number.isFinite(la) || la < 31 || la > 37) return null;
    if (la > this.REGION_LAT_NORTH) return 'NORTH';
    if (la < this.REGION_LAT_SOUTH) return 'SOUTH';
    return 'PHX';
  },

  // Region for a calendar event: GPS coordinates first (accurate), city-name whitelist
  // as fallback when coords are absent (the ~7% with no geocode, or DOM-scraped events).
  getRegionForEvent(ev) {
    const byCoords = this.getRegionFromCoords(ev?.lat, ev?.lng);
    if (byCoords) return byCoords;
    return this.findCityInString([ev?.title, ev?.address, ev?.notes].join(' '))?.region || null;
  },

  // Jobs already seen with the server's is_commercial flag, keyed by job id AND
  // normalized title. DOM-scraped events carry no tag data, so without this the
  // Comm view flip-flopped every time a DOM scan replaced the server events
  // (booked -> available -> booked as sources alternated).
  _commercialKeys: new Set(),
  rememberCommercialEvent(ev) {
    if (ev?.jobId != null) this._commercialKeys.add(`j:${ev.jobId}`);
    if (ev?.title) this._commercialKeys.add(`t:${String(ev.title).trim().toUpperCase()}`);
  },
  isCommercialEvent(ev) {
    if (ev?.isCommercial) return true;
    if (/\[\s*commercial\s*\]/i.test(ev?.title || "")) return true; // job names carry "[Commercial]"
    if (ev?.jobId != null && this._commercialKeys.has(`j:${ev.jobId}`)) return true;
    return !!(ev?.title && this._commercialKeys.has(`t:${String(ev.title).trim().toUpperCase()}`));
  },

  passesRegion(e, regionKey) {
    if (regionKey === "ALL") return true;
    // Commercial-tagged jobs (jobs.tags via the server feed) belong to the COMM
    // pool: they show under Comm and are hidden from the geographic regions so
    // they never look like residential bookings.
    if (regionKey === "COMM") return this.isCommercialEvent(e);
    if (this.isCommercialEvent(e)) return false;
    const region = this.getRegionForEvent(e);
    // Neither coords nor a known city → "uncategorized": still shows in all filters (unchanged).
    if (!region) return true;
    return region === regionKey;
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

  // ==========================================================================
  // SERVICE AREA (2026-08-05) — up-north bookings are off except Prescott.
  //
  // This is a POLICY layer and is deliberately separate from the REGION_LAT_*
  // bands above: those drive calendar filtering and rep routing, and moving
  // them would silently reshuffle every region view. Policy changes; geography
  // doesn't. Reversed wholesale by the `service_area_warning` setting.
  // ==========================================================================

  // Sits just ABOVE the 34.07 routing line on purpose. Black Canyon City is at
  // 34.0714 — a hair north of the routing band, but an I-17 job we do service.
  // 34.10 keeps BCC in; the nearest genuinely-northern town (Congress, 34.16)
  // still falls outside.
  SERVICE_AREA_LAT_CUTOFF: 34.10,

  SERVICE_AREA_PRESCOTT: { lat: 34.5400, lng: -112.4685 },
  SERVICE_AREA_RADIUS_MI_DEFAULT: 30,

  // The two driving routes between the Phoenix service area and Prescott, as
  // polylines following I-17/SR-69 and US-60/SR-89. A rep making that drive
  // passes these towns anyway, so a stop along the way is nearly free — and
  // without this the rule produces donut holes: Congress sits 34 mi from
  // Prescott and would be declined even though Wickenburg below it and
  // Yarnell 8 miles above it on the same highway are both serviced.
  SERVICE_AREA_CORRIDORS: [
    // I-17 north out of Anthem, then west on SR-69 into Prescott
    [[33.87, -112.15], [34.07, -112.15], [34.19, -112.15], [34.31, -112.12],
     [34.40, -112.24], [34.53, -112.24], [34.61, -112.32], [34.54, -112.47]],
    // US-60 to Wickenburg, then SR-89 north through Congress and Yarnell
    [[33.97, -112.73], [34.16, -112.85], [34.22, -112.75], [34.28, -112.73],
     [34.42, -112.72], [34.40, -112.55], [34.54, -112.47]],
  ],
  SERVICE_AREA_CORRIDOR_MI_DEFAULT: 12,

  // Serviced regardless of the radius. Required because the ring is measured
  // per-ADDRESS, not per-city: Cottonwood's center is 29.5 mi out but its far
  // edge is ~33, so on the radius alone two houses on the same street would
  // get different answers. Named towns get one consistent answer.
  // Every name here must ALSO be inside the radius, or the two paths disagree
  // and the same address answers differently depending on whether the CSR
  // clicked a suggestion (coords) or typed it (name). test-service-area.mjs
  // asserts that; don't add a name without checking the distance.
  SERVICE_AREA_ALLOWED_NORTH_CITIES: new Set([
    "PRESCOTT", "PRESCOTT VALLEY", "PRESCOTT VLY", "CHINO VALLEY",
    "DEWEY", "DEWEY-HUMBOLDT", "HUMBOLDT", "MAYER", "WILHOIT", "SKULL VALLEY",
    "CLARKDALE", "COTTONWOOD",
    // 23-27 mi out — inside the ring, so the name path has to agree.
    "PAULDEN", "PEEPLES VALLEY", "YARNELL", "JEROME", "CORDES LAKES",
    // On the driving corridors rather than inside the ring.
    "CONGRESS", "CORDES JUNCTION", "SPRING VALLEY", "BUMBLE BEE", "KIRKLAND"
  ]),

  // Known-not-serviced. Only consulted when we have NO coordinates — with
  // coordinates the latitude + ring decide, and this list can't drift out of
  // sync with them.
  SERVICE_AREA_BLOCKED_CITIES: new Set([
    // Verde Valley
    "SEDONA", "VILLAGE OF OAK CREEK", "OAK CREEK", "CAMP VERDE", "RIMROCK",
    "LAKE MONTEZUMA", "CORNVILLE",
    // Rim country
    "PAYSON", "STAR VALLEY", "PINE", "STRAWBERRY", "CHRISTOPHER CREEK",
    // West of the corridors
    "BAGDAD",
    // Northern AZ
    "FLAGSTAFF", "MUNDS PARK", "PARKS", "WILLIAMS",
    "ASH FORK", "SELIGMAN", "PAGE", "TUBA CITY", "KAYENTA", "FREDONIA",
    "WINSLOW", "HOLBROOK", "SHOW LOW", "PINETOP", "LAKESIDE", "SNOWFLAKE",
    "HEBER", "OVERGAARD",
    // West
    "KINGMAN", "BULLHEAD CITY", "LAKE HAVASU CITY"
  ]),

  /**
   * Shortest distance in miles from a point to any of the driving corridors.
   * Projects to a local flat plane first — at Arizona's scale over ~80 miles
   * the error is well under a mile, and this runs on every keystroke-committed
   * address, so it stays cheap.
   */
  serviceAreaCorridorMiles(lat, lng) {
    const MI_PER_DEG_LAT = 69.0;
    const miPerDegLng = 69.172 * Math.cos(lat * Math.PI / 180);
    const px = lng * miPerDegLng, py = lat * MI_PER_DEG_LAT;
    let best = Infinity;

    for (const line of this.SERVICE_AREA_CORRIDORS) {
      for (let i = 0; i < line.length - 1; i++) {
        const ax = line[i][1] * miPerDegLng,     ay = line[i][0] * MI_PER_DEG_LAT;
        const bx = line[i + 1][1] * miPerDegLng, by = line[i + 1][0] * MI_PER_DEG_LAT;
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        // Clamp to the segment so we measure to the road, not its extension.
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        const cx = ax + t * dx, cy = ay + t * dy;
        const d = Math.hypot(px - cx, py - cy);
        if (d < best) best = d;
      }
    }
    return best;
  },

  /** Great-circle distance in miles. */
  serviceAreaMiles(lat, lng, from) {
    const R = 3958.8, rad = (d) => d * Math.PI / 180;
    const dLat = rad(lat - from.lat), dLng = rad(lng - from.lng);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(rad(from.lat)) * Math.cos(rad(lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  },

  // Longest name first so "PRESCOTT VALLEY" is tested before "PRESCOTT" and
  // "VILLAGE OF OAK CREEK" before "OAK CREEK".
  _serviceAreaNames: null,
  serviceAreaCityFromText(text) {
    if (!this._serviceAreaNames) {
      this._serviceAreaNames = [
        ...this.SERVICE_AREA_ALLOWED_NORTH_CITIES,
        ...this.SERVICE_AREA_BLOCKED_CITIES
      ].sort((a, b) => b.length - a.length);
    }
    const T = String(text || "").toUpperCase();
    if (!T) return null;
    for (const name of this._serviceAreaNames) {
      // Escape the hyphen in DEWEY-HUMBOLDT; \b behaves around it correctly.
      if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(T)) return name;
    }
    return null;
  },

  // ==========================================================================
  // POLYGON SERVICE AREA (2026-08-05, second pass)
  //
  // Replaces the latitude cutoff + Prescott ring + corridor polylines with
  // shapes drawn on a map at /service-area.html and stored server-side, so
  // coverage changes without an extension release. The bundled shapes below
  // are the FALLBACK used when the server can't be reached — never let a dead
  // network silently open up the whole state.
  // ==========================================================================
  SERVICE_AREA_POLYGONS: {
    North: [[34.95,-112.65],[34.95,-111.98],[34.35,-111.95],[34.10,-111.95],[34.10,-112.99],[34.45,-112.95]],
    Phoenix: [[34.10,-112.99],[34.10,-111.22],[33.28,-111.22],[33.00,-111.20],[32.70,-111.32],[32.55,-111.55],[32.55,-112.30],[32.85,-112.99]],
    South: [[32.75,-111.45],[32.75,-110.62],[32.05,-110.68],[31.90,-110.70],[31.83,-110.99],[31.83,-111.20],[32.20,-111.45]]
  },
  // Overlap only decides which area gets NAMED — inside any shape still books.
  // Phoenix first because it is the largest crew pool.
  SERVICE_AREA_PRECEDENCE: ['Phoenix', 'North', 'South'],
  SERVICE_AREA_ENABLED_AREAS: { North: true, Phoenix: true, South: true },
  // Grace band OUTSIDE every polygon that still books. A hand-drawn boundary is
  // not a survey line: without this, a house a few hundred feet past it reads
  // exactly like Flagstaff and the CSR reads a decline script to a real job.
  SERVICE_AREA_BUFFER_MI_DEFAULT: 2,

  pointInPolygon(lat, lng, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  },

  /** Shortest distance in miles from a point to a polygon's edge. */
  milesToPolygonEdge(lat, lng, poly) {
    const MI_LAT = 69.0, miLng = 69.172 * Math.cos(lat * Math.PI / 180);
    const px = lng * miLng, py = lat * MI_LAT;
    let best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ax = poly[j][1] * miLng, ay = poly[j][0] * MI_LAT;
      const bx = poly[i][1] * miLng, by = poly[i][0] * MI_LAT;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d < best) best = d;
    }
    return best;
  },

  /**
   * Is this address inside the area we currently book?
   *
   * Returns { serviced, reason, city, area, edge, miles }.
   *   area  — which service area claims it (precedence decides overlaps)
   *   edge  — true when it only qualified via the buffer, i.e. just outside
   *           the drawn line. Still bookable; worth a manager's eye.
   *
   * `serviced` is TRUE whenever we cannot prove otherwise. A false "we don't
   * cover you" turns away a real job; staying quiet costs nothing. Callers
   * must treat an unknown address as serviced.
   */
  checkServiceArea(address, coords, opts) {
    const polys = opts?.polygons || this.SERVICE_AREA_POLYGONS;
    const enabled = opts?.areaEnabled || this.SERVICE_AREA_ENABLED_AREAS;
    const buffer = Number.isFinite(Number(opts?.bufferMi)) && Number(opts.bufferMi) >= 0
      ? Number(opts.bufferMi) : this.SERVICE_AREA_BUFFER_MI_DEFAULT;
    const order = opts?.precedence || this.SERVICE_AREA_PRECEDENCE;
    const city = this.serviceAreaCityFromText(address);

    const lat = parseFloat(coords?.lat), lng = parseFloat(coords?.lng);
    const usable = Number.isFinite(lat) && Number.isFinite(lng) &&
                   lat >= 31 && lat <= 37 && lng >= -115 && lng <= -109;

    if (usable) {
      // Precedence first, then any area not listed in it, so a newly added
      // area still works before anyone updates the order.
      const keys = [...order.filter(k => polys[k]), ...Object.keys(polys).filter(k => !order.includes(k))]
        .filter(k => enabled[k] !== false);

      for (const k of keys) {
        if (this.pointInPolygon(lat, lng, polys[k])) {
          return { serviced: true, reason: 'inside-area', city, area: k, edge: false, miles: null };
        }
      }
      // Nothing contains it — is it close enough to count?
      let nearest = null, nearestMi = Infinity;
      for (const k of keys) {
        const d = this.milesToPolygonEdge(lat, lng, polys[k]);
        if (d < nearestMi) { nearestMi = d; nearest = k; }
      }
      if (nearest !== null && nearestMi <= buffer) {
        return { serviced: true, reason: 'inside-buffer', city, area: nearest, edge: true, nearestArea: nearest, miles: Math.round(nearestMi * 10) / 10 };
      }
      // nearestArea is carried even when declined: it is the key for per-region
      // hold-off wording. A declined address is outside every area, so the
      // nearest one is the only meaningful region to speak about.
      return { serviced: false, reason: 'outside-area', city, area: null, edge: false, nearestArea: nearest, miles: Math.round(nearestMi) };
    }

    // No usable coordinates — name match only, against the explicit list.
    if (city && this.SERVICE_AREA_BLOCKED_CITIES.has(city)) {
      return { serviced: false, reason: 'blocked-city', city, area: null, edge: false, miles: null };
    }
    return { serviced: true, reason: 'unknown', city, area: null, edge: false, miles: null };
  },


  sumMaps(a, b) {
    if (!a) return b;
    if (!b) return a;
    const out = {};
    const blockKeys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => /^B\d+$/.test(k));
    for (const k of blockKeys) { out[k] = [];
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
    const d = new Date(`${dateStr}T00:00:00`);
    const blocks = this.blockWindowForDate(d);
    const perBlockBooked = {};
    for (const blk of blocks) perBlockBooked[blk.key] = 0;

    // Commercial-tagged events consume COMM capacity only; every other region's
    // booked math ignores them (ALL included — its capacity is PHX+NORTH+SOUTH).
    const countedEvents = region === 'COMM'
      ? eventsForDay.filter(ev => this.isCommercialEvent(ev))
      : eventsForDay.filter(ev => !this.isCommercialEvent(ev));

    for (const ev of countedEvents) {
      const occupiedKeys = new Set(this.occupiedBlockKeys(ev, blocks));

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
    const perBlockRemaining = {};
    const blockKeys = blocks.map(blk => blk.key);

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
            rec = { total: 0, perBlock: {} };
            for (const blk of blocks) rec.perBlock[blk.key] = 0;
            perCity.set(city, rec);
        }
        for (const key of this.occupiedBlockKeys(ev, blocks)) {
            rec.perBlock[key]++;
            rec.total++;
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

    // Same latitude bands as event classification: NORTH above Black Canyon City
    // (~34.07°N), SOUTH below Picacho (~32.64°N), PHX between.
    if (lat > this.REGION_LAT_NORTH) return 'NORTH';
    if (lat < this.REGION_LAT_SOUTH) return 'SOUTH';
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
    const occupied = this.occupiedBlockKeys(event, blocks);
    if (occupied.length) {
        details.time = blocks.find(b => b.key === occupied[0]).label;
    }

    return details;
  }
};

export const PEOPLE_DATA = {
    // REPS / CSRS / PRODUCTION / INSURANCE / D2D are live-synced from the Company
    // Team Roster sheet — see syncPeopleDataFromRoster() below. These arrays are the
    // OFFLINE FALLBACK used when the sheet fetch fails.
    REPS: ["Alex Tillotson", "Christian Noren", "Connor Hamby", "Jonathan Marino", "Josh Jewett", "Justin Parker", "London Smith", "Orlando Chavarria", "Richard Hadsall", "Stephen Chaidez", "Tanner Broadbent"].sort(),
    // MGMT is NOT synced — the roster sheet has no management department (Jayda/Raven
    // sit under Production, Niko under Retail Sales, etc.); this list is Travis-curated.
    // Conor Smith, Jayda Fairfield, Raven Pelfrey, Travis Jones are intentional duplicates —
    // they're also Production/CSR but Travis wants them shown under Management too.
    MGMT: ["Andrew Clark", "Anthony Bonomo", "Bradley Crohurst", "Brenda Ochoa", "Conor Smith", "Jayda Fairfield", "Nikolas Pagoulatos", "Raven Pelfrey", "Travis Jones", "Yousef Ayad"].sort(),
    CSRS: ["Bronté Pisz", "Diva Shahpur", "Hadley Duffy", "Hunter Fairfield", "Khamilah Valles", "Madi Meyers", "Mariana Ceballos", "Nica Javier", "Travis Jones"].sort(),

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
        "Hadley Duffy": "USR3BC964E3CA5C4BF6E04EB987189831CD",
        "Hunter Fairfield": "USR3BC964E3CA5C4BF6AA0EF97DD1A60F08",
        "Caite": "USR3C843ED7AB9B47118D66E874FF6151FD",
        "Anthony Espinosa": "USRC30FF30726A9F646798C58AF597D98E0",
        "Aaron Munz": "USR3C843ED7AB9B4711D25580F0C1D45997",
        "Raven Pelfrey": "USR3C843ED7AB9B4711C939E32294BA3ECC",
    },
};

// ===== Company Team Roster live sync =====
// The "Active Roster" tab is a formula-driven live view of the edit tab ("Add To
// Team Roster") filtered to ACTIVE staff only, so bucketing by Department/Title is
// safe. (The sheet was restructured 2026-07: the old "Team Roster" tab no longer
// exists — reading it 400s and the sync silently fell back to the static lists.)
// Reads go through the tech-scheduler sheets proxy (service-account auth stays
// server-side).
export const ROSTER_SHEET_ID = "1XFJHD0IVZ8sJrQ7H2CrqU26a6n-FulPM8ABKc1hrh9o";

// Roster-sheet spellings -> the canonical names every downstream system keys on
// (CTM agent names, CTM_USER_IDS, dialer logging, /api/sheet-dispositions).
// Without these, syncing the sheet would silently break identity matching.
export const ROSTER_NAME_ALIASES = {
    "Madison Meyers": "Madi Meyers",
    "Ervennica Mae Javier": "Nica Javier",
    "Mariana Franco Caballos": "Mariana Ceballos",
    "Mariana Franco Ceballos": "Mariana Ceballos",
    "Niko Pagoulatos": "Nikolas Pagoulatos",
};

// Live-sync PEOPLE_DATA from the roster sheet. Mutates PEOPLE_DATA in place and
// resolves to per-group counts. A group is only overwritten when the sheet returns
// at least one person for it, so a partial/empty read never blanks a list (the
// arrays above remain the offline fallback). Names are intentionally NOT deduped
// across groups — someone can legitimately belong to two teams (e.g. Khamilah
// Valles is both Insurance and a CSR).
// The FETCH is single-flight per page load, but the sheet data is RE-APPLIED to
// PEOPLE_DATA on every call — other code overwrites these lists after the first
// sync (e.g. loadPeopleLists' chrome.storage PEOPLE_* overrides), and a cached
// no-op would let a stale/blank stored list stick. Caching the side effect
// instead of the data is exactly what emptied the CTM dropdowns in v2.1.46.
let rosterFetchPromise = null;
export function syncPeopleDataFromRoster() {
    if (!rosterFetchPromise) {
        rosterFetchPromise = fetchRosterBuckets().catch(e => {
            rosterFetchPromise = null; // allow a retry on the next call
            throw e;
        });
    }
    return rosterFetchPromise.then(buckets => {
        const counts = {};
        for (const key of Object.keys(buckets)) {
            counts[key] = buckets[key].length;
            if (buckets[key].length) PEOPLE_DATA[key] = [...new Set(buckets[key])].sort();
        }
        return counts;
    });
}

async function fetchRosterBuckets() {
    // Active Roster layout: banner + summary rows on top, then a header row
    // (Team | Department | Role / Title | Name | ...), then one row per person.
    // Locate the header instead of hardcoding its row so banner edits don't
    // silently break the sync.
    const range = "'Active Roster'!A1:D300";
    const url = `https://az-roofers-tech-scheduler.vercel.app/api/sheets?spreadsheetId=${encodeURIComponent(ROSTER_SHEET_ID)}&range=${encodeURIComponent(range)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`roster sheet HTTP ${res.status}`);
    const data = await res.json();
    const rows = Array.isArray(data.values) ? data.values : [];

    const DEPT_MAP = { "Production": "PRODUCTION", "Insurance": "INSURANCE", "D2D Sales": "D2D" };
    const buckets = { PRODUCTION: [], INSURANCE: [], D2D: [], CSRS: [], REPS: [] };
    let pastHeader = false;
    for (const row of rows) {
        const dept = (row[1] || "").trim();
        const title = (row[2] || "").trim();
        const rawName = (row[3] || "").trim();
        if (!pastHeader) {
            if (dept === "Department" && rawName === "Name") pastHeader = true;
            continue;
        }
        if (!rawName || !dept) continue;
        const name = ROSTER_NAME_ALIASES[rawName] || rawName;

        const deptKey = DEPT_MAP[dept];
        if (deptKey) buckets[deptKey].push(name);

        // CSRs are matched by TITLE, not department: catches the Lead Center CSRs
        // plus Khamilah (Insurance dept) and Travis ("CSR, Lead Manager").
        if (dept === "Lead Center" || /customer service representative|\bcsr\b/i.test(title)) {
            buckets.CSRS.push(name);
        }

        // Sales reps = Retail Sales department, reps only (managers/trainers excluded).
        if (dept === "Retail Sales" && /sales representative/i.test(title)) {
            buckets.REPS.push(name);
        }
    }

    return buckets;
}

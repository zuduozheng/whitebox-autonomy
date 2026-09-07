/**
 * WBA Beta map — location_lookup seed data.
 *
 * Single source of truth for the `location_lookup` rows proposed in
 * 20260909000000_map_location_lookup.sql. This file is what gets hand-reviewed;
 * build-location-lookup-sql.mjs turns it into the migration's INSERT statement
 * (so the SQL is generated, never hand-retyped, and the two can never drift).
 *
 * SOURCE / METHOD (reliable, reproducible, not live-geocoded):
 *   - country: commonly published approximate geographic centre of the
 *     country's territory (a standard, citable reference point, not derived
 *     from any WBA event).
 *   - region (US states only, in this corpus): the state CAPITAL's
 *     coordinates. Capitals are unambiguous, always inside the state, and a
 *     standard public reference — simpler to verify than a computed areal
 *     centroid, and just as defensible as "a sensible representative point"
 *     per the product principle. The District of Columbia has no separate
 *     "state capital"; its region-level point is the same as its city-level
 *     point (Washington, DC is both).
 *   - city: the city's commonly published/well-known coordinates (city-hall /
 *     downtown reference point, the same kind of figure any atlas or almanac
 *     would give). Approximate by design — see product principle in
 *     docs/architecture.md discussion: these are DISPLAY coordinates, never a
 *     claim about an exact incident location.
 *
 * COVERAGE: every country and region actually used by the live public corpus
 * (2,923 events, see event-location-snapshot.json) is included. Cities are
 * included for every distinct NHTSA city string appearing >= 2 times (66
 * cities, covering 2,771 of 2,832 city-precision NHTSA events = 97.8%) plus
 * every city named by a curated event (Vancouver, Quzhou; Austin/Phoenix/
 * Santa Monica/San Francisco already covered by the NHTSA list). The
 * remaining long tail of one-off NHTSA city strings (61 strings, 61 events —
 * many single-occurrence, several containing an evident typo, e.g. "San
 * Frabcisco", or an implausible city/state pairing, e.g. "Phoenix, CA")
 * deliberately has NO city-level row: per the approved fallback rule, those
 * events resolve one level up, to their (already-covered) state. This is not
 * a gap to chase — it is the fallback rule working as designed. Any of these
 * can be added later by appending one row here; no other code changes.
 */

/** @typedef {{ key: string, level: "country"|"region"|"city", countryCode: string, regionCode?: string, cityName?: string, latitude: number, longitude: number, displayName: string }} LookupRow */

/** @type {LookupRow[]} */
export const COUNTRIES = [
  { level: "country", countryCode: "US", latitude: 39.8283, longitude: -98.5795, displayName: "United States" },
  { level: "country", countryCode: "AU", latitude: -25.2744, longitude: 133.7751, displayName: "Australia" },
  { level: "country", countryCode: "CA", latitude: 56.1304, longitude: -106.3468, displayName: "Canada" },
  { level: "country", countryCode: "CN", latitude: 35.8617, longitude: 104.1954, displayName: "China" },
];

/** US states actually used by the corpus. Point = state capital. */
export const REGIONS = [
  { level: "region", countryCode: "US", regionCode: "AZ", latitude: 33.4484, longitude: -112.0740, displayName: "Arizona, US" },
  { level: "region", countryCode: "US", regionCode: "CA", latitude: 38.5816, longitude: -121.4944, displayName: "California, US" },
  { level: "region", countryCode: "US", regionCode: "TX", latitude: 30.2672, longitude: -97.7431, displayName: "Texas, US" },
  { level: "region", countryCode: "US", regionCode: "NV", latitude: 39.1638, longitude: -119.7674, displayName: "Nevada, US" },
  { level: "region", countryCode: "US", regionCode: "GA", latitude: 33.7490, longitude: -84.3880, displayName: "Georgia, US" },
  { level: "region", countryCode: "US", regionCode: "FL", latitude: 30.4383, longitude: -84.2807, displayName: "Florida, US" },
  { level: "region", countryCode: "US", regionCode: "MI", latitude: 42.7325, longitude: -84.5555, displayName: "Michigan, US" },
  // DC is a federal district, not a state: no separate capital, so its
  // region-level point is identical to its city-level point (see CITIES).
  { level: "region", countryCode: "US", regionCode: "DC", latitude: 38.9072, longitude: -77.0369, displayName: "District of Columbia, US" },
  { level: "region", countryCode: "US", regionCode: "MN", latitude: 44.9537, longitude: -93.0900, displayName: "Minnesota, US" },
  { level: "region", countryCode: "US", regionCode: "TN", latitude: 36.1627, longitude: -86.7816, displayName: "Tennessee, US" },
  { level: "region", countryCode: "US", regionCode: "PA", latitude: 40.2732, longitude: -76.8867, displayName: "Pennsylvania, US" },
  { level: "region", countryCode: "US", regionCode: "CO", latitude: 39.7392, longitude: -104.9903, displayName: "Colorado, US" },
  { level: "region", countryCode: "US", regionCode: "NM", latitude: 35.6870, longitude: -105.9378, displayName: "New Mexico, US" },
  { level: "region", countryCode: "US", regionCode: "WA", latitude: 47.0379, longitude: -122.9007, displayName: "Washington, US" },
  { level: "region", countryCode: "US", regionCode: "IN", latitude: 39.7684, longitude: -86.1581, displayName: "Indiana, US" },
  { level: "region", countryCode: "US", regionCode: "MS", latitude: 32.2988, longitude: -90.1848, displayName: "Mississippi, US" },
  { level: "region", countryCode: "US", regionCode: "AR", latitude: 34.7465, longitude: -92.2896, displayName: "Arkansas, US" },
  { level: "region", countryCode: "US", regionCode: "OH", latitude: 39.9612, longitude: -82.9988, displayName: "Ohio, US" },
  { level: "region", countryCode: "US", regionCode: "RI", latitude: 41.8240, longitude: -71.4128, displayName: "Rhode Island, US" },
  { level: "region", countryCode: "US", regionCode: "OK", latitude: 35.4676, longitude: -97.5164, displayName: "Oklahoma, US" },
  { level: "region", countryCode: "US", regionCode: "WY", latitude: 41.1400, longitude: -104.8202, displayName: "Wyoming, US" },
];

/**
 * Cities. US rows carry a regionCode (three-level key: city|region|country).
 * Non-US rows here have no region token in the source text, so they resolve
 * on a two-level key (city|country) — see resolve.mjs's KEY functions.
 */
export const CITIES = [
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "SAN FRANCISCO", latitude: 37.7749, longitude: -122.4194, displayName: "San Francisco, CA, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "LOS ANGELES", latitude: 34.0522, longitude: -118.2437, displayName: "Los Angeles, CA, US" },
  { level: "city", countryCode: "US", regionCode: "TX", cityName: "AUSTIN", latitude: 30.2672, longitude: -97.7431, displayName: "Austin, TX, US" },
  { level: "city", countryCode: "US", regionCode: "AZ", cityName: "PHOENIX", latitude: 33.4484, longitude: -112.0740, displayName: "Phoenix, AZ, US" },
  { level: "city", countryCode: "US", regionCode: "AZ", cityName: "TEMPE", latitude: 33.4255, longitude: -111.9400, displayName: "Tempe, AZ, US" },
  { level: "city", countryCode: "US", regionCode: "GA", cityName: "ATLANTA", latitude: 33.7490, longitude: -84.3880, displayName: "Atlanta, GA, US" },
  { level: "city", countryCode: "US", regionCode: "NV", cityName: "LAS VEGAS", latitude: 36.1699, longitude: -115.1398, displayName: "Las Vegas, NV, US" },
  { level: "city", countryCode: "US", regionCode: "AZ", cityName: "SCOTTSDALE", latitude: 33.4942, longitude: -111.9261, displayName: "Scottsdale, AZ, US" },
  { level: "city", countryCode: "US", regionCode: "TX", cityName: "DALLAS", latitude: 32.7767, longitude: -96.7970, displayName: "Dallas, TX, US" },
  { level: "city", countryCode: "US", regionCode: "FL", cityName: "MIAMI", latitude: 25.7617, longitude: -80.1918, displayName: "Miami, FL, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "SANTA MONICA", latitude: 34.0195, longitude: -118.4912, displayName: "Santa Monica, CA, US" },
  { level: "city", countryCode: "US", regionCode: "TX", cityName: "HOUSTON", latitude: 29.7604, longitude: -95.3698, displayName: "Houston, TX, US" },
  { level: "city", countryCode: "US", regionCode: "AZ", cityName: "CHANDLER", latitude: 33.3062, longitude: -111.8413, displayName: "Chandler, AZ, US" },
  { level: "city", countryCode: "US", regionCode: "AZ", cityName: "MESA", latitude: 33.4152, longitude: -111.8315, displayName: "Mesa, AZ, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "CULVER CITY", latitude: 34.0211, longitude: -118.3965, displayName: "Culver City, CA, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "MOUNTAIN VIEW", latitude: 37.3861, longitude: -122.0839, displayName: "Mountain View, CA, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "INGLEWOOD", latitude: 33.9617, longitude: -118.3531, displayName: "Inglewood, CA, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "BEVERLY HILLS", latitude: 34.0736, longitude: -118.4004, displayName: "Beverly Hills, CA, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "WEST HOLLYWOOD", latitude: 34.0900, longitude: -118.3617, displayName: "West Hollywood, CA, US" },
  { level: "city", countryCode: "US", regionCode: "NV", cityName: "PARADISE", latitude: 36.0839, longitude: -115.1425, displayName: "Paradise, NV, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "VENICE", latitude: 33.9850, longitude: -118.4695, displayName: "Venice, CA, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "PALO ALTO", latitude: 37.4419, longitude: -122.1430, displayName: "Palo Alto, CA, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "DALY CITY", latitude: 37.6879, longitude: -122.4702, displayName: "Daly City, CA, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "SAN JOSE", latitude: 37.3382, longitude: -121.8863, displayName: "San Jose, CA, US" },
  { level: "city", countryCode: "US", regionCode: "FL", cityName: "ORLANDO", latitude: 28.5383, longitude: -81.3792, displayName: "Orlando, FL, US" },
  { level: "city", countryCode: "US", regionCode: "TX", cityName: "ARLINGTON", latitude: 32.7357, longitude: -97.1081, displayName: "Arlington, TX, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "SOUTH SAN FRANCISCO", latitude: 37.6547, longitude: -122.4077, displayName: "South San Francisco, CA, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "SANTA CLARA", latitude: 37.3541, longitude: -121.9552, displayName: "Santa Clara, CA, US" },
  { level: "city", countryCode: "US", regionCode: "DC", cityName: "WASHINGTON", latitude: 38.9072, longitude: -77.0369, displayName: "Washington, DC, US" },
  { level: "city", countryCode: "US", regionCode: "MI", cityName: "ANN ARBOR", latitude: 42.2808, longitude: -83.7430, displayName: "Ann Arbor, MI, US" },
  { level: "city", countryCode: "US", regionCode: "NV", cityName: "SPRING VALLEY", latitude: 36.1097, longitude: -115.2564, displayName: "Spring Valley, NV, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "SUNNYVALE", latitude: 37.3688, longitude: -122.0363, displayName: "Sunnyvale, CA, US" },
  { level: "city", countryCode: "US", regionCode: "TN", cityName: "NASHVILLE", latitude: 36.1627, longitude: -86.7816, displayName: "Nashville, TN, US" },
  { level: "city", countryCode: "US", regionCode: "AZ", cityName: "PARADISE VALLEY", latitude: 33.5312, longitude: -111.9412, displayName: "Paradise Valley, AZ, US" },
  { level: "city", countryCode: "US", regionCode: "FL", cityName: "JACKSONVILLE", latitude: 30.3322, longitude: -81.6557, displayName: "Jacksonville, FL, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "REDWOOD CITY", latitude: 37.4852, longitude: -122.2364, displayName: "Redwood City, CA, US" },
  { level: "city", countryCode: "US", regionCode: "GA", cityName: "PEACHTREE CORNERS", latitude: 33.9698, longitude: -84.2227, displayName: "Peachtree Corners, GA, US" },
  { level: "city", countryCode: "US", regionCode: "FL", cityName: "MIAMI BEACH", latitude: 25.7907, longitude: -80.1300, displayName: "Miami Beach, FL, US" },
  { level: "city", countryCode: "US", regionCode: "MN", cityName: "GRAND RAPIDS", latitude: 47.2372, longitude: -93.5300, displayName: "Grand Rapids, MN, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "SAN MATEO", latitude: 37.5630, longitude: -122.3255, displayName: "San Mateo, CA, US" },
  { level: "city", countryCode: "US", regionCode: "TX", cityName: "SAN ANTONIO", latitude: 29.4241, longitude: -98.4936, displayName: "San Antonio, TX, US" },
  { level: "city", countryCode: "US", regionCode: "TX", cityName: "ENNIS", latitude: 32.3293, longitude: -96.6252, displayName: "Ennis, TX, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "SAN BRUNO", latitude: 37.6305, longitude: -122.4111, displayName: "San Bruno, CA, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "FREMONT", latitude: 37.5485, longitude: -121.9886, displayName: "Fremont, CA, US" },
  { level: "city", countryCode: "US", regionCode: "TX", cityName: "HUNTSVILLE", latitude: 30.7235, longitude: -95.5508, displayName: "Huntsville, TX, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "BRISBANE", latitude: 37.6838, longitude: -122.3997, displayName: "Brisbane, CA, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "EMERYVILLE", latitude: 37.8313, longitude: -122.2852, displayName: "Emeryville, CA, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "MENLO PARK", latitude: 37.4530, longitude: -122.1817, displayName: "Menlo Park, CA, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "BURLINGAME", latitude: 37.5779, longitude: -122.3484, displayName: "Burlingame, CA, US" },
  { level: "city", countryCode: "US", regionCode: "AZ", cityName: "SUN CITY", latitude: 33.5964, longitude: -112.2716, displayName: "Sun City, AZ, US" },
  { level: "city", countryCode: "US", regionCode: "AZ", cityName: "SACATON", latitude: 33.0834, longitude: -111.7423, displayName: "Sacaton, AZ, US" },
  { level: "city", countryCode: "US", regionCode: "TX", cityName: "STREETMAN", latitude: 31.9793, longitude: -96.3197, displayName: "Streetman, TX, US" },
  { level: "city", countryCode: "US", regionCode: "TX", cityName: "BUFFALO", latitude: 31.4571, longitude: -96.0625, displayName: "Buffalo, TX, US" },
  { level: "city", countryCode: "US", regionCode: "TX", cityName: "ALEDO", latitude: 32.6976, longitude: -97.6011, displayName: "Aledo, TX, US" },
  { level: "city", countryCode: "US", regionCode: "CO", cityName: "GOLDEN", latitude: 39.7555, longitude: -105.2211, displayName: "Golden, CO, US" },
  { level: "city", countryCode: "US", regionCode: "TX", cityName: "CENTERVILLE", latitude: 31.2604, longitude: -95.9536, displayName: "Centerville, TX, US" },
  { level: "city", countryCode: "US", regionCode: "CA", cityName: "MARINA DEL REY", latitude: 33.9802, longitude: -118.4517, displayName: "Marina Del Rey, CA, US" },
  { level: "city", countryCode: "US", regionCode: "IN", cityName: "INDIANAPOLIS", latitude: 39.7684, longitude: -86.1581, displayName: "Indianapolis, IN, US" },
  { level: "city", countryCode: "US", regionCode: "PA", cityName: "PITTSBURGH", latitude: 40.4406, longitude: -79.9959, displayName: "Pittsburgh, PA, US" },
  { level: "city", countryCode: "US", regionCode: "AZ", cityName: "GILBERT", latitude: 33.3528, longitude: -111.7890, displayName: "Gilbert, AZ, US" },
  { level: "city", countryCode: "US", regionCode: "CO", cityName: "DENVER", latitude: 39.7392, longitude: -104.9903, displayName: "Denver, CO, US" },
  { level: "city", countryCode: "US", regionCode: "TX", cityName: "SPRING", latitude: 30.0799, longitude: -95.4172, displayName: "Spring, TX, US" },
  { level: "city", countryCode: "US", regionCode: "AZ", cityName: "GUADALUPE", latitude: 33.3542, longitude: -111.9598, displayName: "Guadalupe, AZ, US" },
  { level: "city", countryCode: "US", regionCode: "DC", cityName: "WASHINGTON DC", latitude: 38.9072, longitude: -77.0369, displayName: "Washington DC, DC, US" },
  { level: "city", countryCode: "US", regionCode: "PA", cityName: "PHILADELPHIA", latitude: 39.9526, longitude: -75.1652, displayName: "Philadelphia, PA, US" },
  { level: "city", countryCode: "US", regionCode: "WA", cityName: "SEATTLE", latitude: 47.6062, longitude: -122.3321, displayName: "Seattle, WA, US" },
  // Non-US cities named by curated events. No region token in the source
  // text, so these key on (city, country) only.
  { level: "city", countryCode: "CA", cityName: "VANCOUVER", latitude: 49.2827, longitude: -123.1207, displayName: "Vancouver, Canada" },
  { level: "city", countryCode: "CN", cityName: "QUZHOU", latitude: 28.9700, longitude: 118.8700, displayName: "Quzhou, China" },
];

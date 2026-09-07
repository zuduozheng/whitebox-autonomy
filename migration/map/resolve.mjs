/**
 * WBA Beta map — location resolution algorithm.
 *
 * Pure functions, no I/O, no database dependency. This is the single
 * implementation of the "city -> region -> country -> unmapped" fallback
 * rule; both the offline verification script (verify-corpus.mjs, run against
 * the real corpus) and the proposed SQL migration
 * (20260909000000_map_location_lookup.sql) implement this exact logic — the
 * SQL in `split_part`/CASE form, this file in JS form for testing and for
 * generating the migration's INSERT statement. Keeping one authoritative
 * description of the algorithm here (rather than only in SQL) is what makes
 * the fallback behaviour independently testable without a live Postgres
 * instance.
 *
 * Two distinct sources, two distinct parse strategies — deliberately NOT
 * unified into one "smart" parser:
 *
 *   - source-derived (NHTSA): location_text is mechanically produced by the
 *     NHTSA normalization pipeline and is ALWAYS "City, ST, US" / "ST, US" /
 *     "US" (see docs/nhtsa-normalization-rulebook.md). A plain comma-split is
 *     100% reliable here — confirmed against the full live corpus (zero
 *     malformed rows out of 2,838 source-derived location rows).
 *
 *   - curated: only 16 distinct (location_text, location_country_code) pairs
 *     exist across all 86 curated events (see event-location-snapshot.json).
 *     Free text varies in shape ("Austin, Texas, USA", "Australia", a bare
 *     road name, one explicitly-hedged guess). Rather than build a generic
 *     parser to guess at 16 known values, each is classified EXPLICITLY below
 *     with a one-line rationale — an auditable table, not an algorithm that
 *     might mis-parse a shape it hasn't seen. This mirrors the project's own
 *     stated policy for the curated dataset: "classify only what existing
 *     evidence supports; do not manufacture precision."
 */

/** Upper-case, trim, collapse internal whitespace. Cosmetic-only normalization
 *  (same category the NHTSA rulebook already allows for auto-resolution) —
 *  never changes what place a string names. */
function norm(s) {
  return s.trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * @param {{level:string, countryCode:string, regionCode?:string, cityName?:string, latitude:number, longitude:number, displayName:string}[]} countries
 * @param {typeof countries} regions
 * @param {typeof countries} cities
 */
export function buildLookupIndex(countries, regions, cities) {
  const countryByCode = new Map();
  for (const row of countries) countryByCode.set(norm(row.countryCode), row);

  const regionByKey = new Map();
  for (const row of regions) {
    regionByKey.set(`${norm(row.regionCode)}|${norm(row.countryCode)}`, row);
  }

  // US cities key on (city, region, country); non-US cities in this corpus
  // never carry a region token in the source text, so they key on
  // (city, country) only.
  const cityByKey3 = new Map();
  const cityByKey2 = new Map();
  for (const row of cities) {
    if (row.regionCode) {
      cityByKey3.set(`${norm(row.cityName)}|${norm(row.regionCode)}|${norm(row.countryCode)}`, row);
    } else {
      cityByKey2.set(`${norm(row.cityName)}|${norm(row.countryCode)}`, row);
    }
  }

  return { countryByCode, regionByKey, cityByKey3, cityByKey2 };
}

/**
 * NHTSA source-derived events: deterministic comma-split, per the rulebook's
 * guaranteed "City, ST, US" / "ST, US" / "US" shape.
 * @returns {{level:"city"|"region"|"country", key:string, latitude:number, longitude:number}|null}
 */
export function resolveSourceDerived(locationText, countryCode, index) {
  if (!locationText) return null;
  const parts = locationText.split(",").map((p) => p.trim()).filter(Boolean);

  if (parts.length === 3) {
    const [city, region, country] = parts;
    const key3 = `${norm(city)}|${norm(region)}|${norm(country)}`;
    const cityRow = index.cityByKey3.get(key3);
    if (cityRow) return { level: "city", key: key3, latitude: cityRow.latitude, longitude: cityRow.longitude };
    const regionKey = `${norm(region)}|${norm(country)}`;
    const regionRow = index.regionByKey.get(regionKey);
    if (regionRow) return { level: "region", key: regionKey, latitude: regionRow.latitude, longitude: regionRow.longitude };
  } else if (parts.length === 2) {
    const [region, country] = parts;
    const regionKey = `${norm(region)}|${norm(country)}`;
    const regionRow = index.regionByKey.get(regionKey);
    if (regionRow) return { level: "region", key: regionKey, latitude: regionRow.latitude, longitude: regionRow.longitude };
  }
  // parts.length === 1 (bare country) falls straight through to the
  // country-level fallback below, as does any unmatched city/region case.
  const countryRow = index.countryByCode.get(norm(countryCode ?? parts[parts.length - 1]));
  if (countryRow) return { level: "country", key: norm(countryRow.countryCode), latitude: countryRow.latitude, longitude: countryRow.longitude };
  return null;
}

/**
 * Explicit, auditable classification of the 16 distinct curated
 * (location_text, location_country_code) combinations in the live corpus.
 * `precision` is the honest location_precision backfill value — what the
 * TEXT supports, independent of whether a map coordinate exists for it.
 * `resolve` is the map-display fallback — coarser than `precision` is
 * allowed to be (e.g. a named road with no plotted coordinate falls back to
 * its country dot), but never null unless the location is genuinely unusable
 * or explicitly uncertain.
 */
export const CURATED_OVERRIDES = [
  {
    locationText: "Austin, Texas, USA", countryCode: "US",
    precision: "city", resolve: { level: "city", key: "AUSTIN|TX|US" },
    rationale: "Named city + state + country, unambiguous.",
  },
  {
    locationText: "Australia", countryCode: "AU",
    precision: "country", resolve: { level: "country", key: "AU" },
    rationale: "Bare country name; text supports no finer level.",
  },
  {
    locationText: null, countryCode: null,
    precision: "unknown", resolve: null,
    rationale: "No location text at all — genuinely unmapped, not a parsing gap.",
  },
  {
    locationText: "Bruce Highway, Australia", countryCode: "AU",
    precision: "road-or-intersection", resolve: { level: "country", key: "AU" },
    rationale:
      "Names a specific road (supports road-or-intersection precision as a " +
      "text fact), but the Bruce Highway runs ~1,700km through Queensland — " +
      "no single coordinate would be defensible, so the map falls back to " +
      "the country dot rather than guessing a point along it.",
  },
  {
    locationText: "Brisbane Inner City Bypass, Australia", countryCode: "AU",
    precision: "road-or-intersection", resolve: { level: "country", key: "AU" },
    rationale:
      "Names a specific road; no city/region lookup row exists for it in " +
      "this Beta pass (see location-lookup-data.mjs coverage note), so it " +
      "falls back to the country dot. Not hand-mapped to Brisbane " +
      "specifically — that would be inferring a city the generic rule " +
      "cannot derive from this text alone.",
  },
  {
    locationText: "University of Queensland, St Lucia, Brisbane, Australia", countryCode: "AU",
    precision: "local-area", resolve: { level: "country", key: "AU" },
    rationale:
      "Names a specific campus/suburb — more specific than city-level text, " +
      "hence local-area precision — but no lookup row exists for it, so the " +
      "map falls back to the country dot.",
  },
  {
    locationText: "GA-575, north of Atlanta, Georgia, USA", countryCode: "US",
    precision: "road-or-intersection", resolve: { level: "region", key: "GA|US" },
    rationale:
      "Names a specific route explicitly NOT in Atlanta (\"north of\" it), so " +
      "it must not resolve to the Atlanta city point. Georgia is named " +
      "explicitly, so it falls back to the (available) Georgia state point.",
  },
  {
    locationText: "Canada", countryCode: "CA",
    precision: "country", resolve: { level: "country", key: "CA" },
    rationale: "Bare country name.",
  },
  {
    locationText: "Reported as probably Thailand; not confirmed", countryCode: null,
    precision: "unknown", resolve: null,
    rationale:
      "Explicitly hedged/unconfirmed by the curator. Per the approved " +
      "product rule, uncertain text like this is never geocoded — stays " +
      "unmapped for curator review, precision stays unknown.",
  },
  {
    locationText: "United States", countryCode: "US",
    precision: "country", resolve: { level: "country", key: "US" },
    rationale: "Bare country name.",
  },
  {
    locationText: "Vancouver, Canada", countryCode: "CA",
    precision: "city", resolve: { level: "city", key: "VANCOUVER|CA" },
    rationale: "Named city + country, unambiguous.",
  },
  {
    locationText: "Quzhou, China", countryCode: "CN",
    precision: "city", resolve: { level: "city", key: "QUZHOU|CN" },
    rationale: "Named city + country, unambiguous.",
  },
  {
    locationText: "Phoenix, Arizona, USA", countryCode: "US",
    precision: "city", resolve: { level: "city", key: "PHOENIX|AZ|US" },
    rationale: "Named city + state + country, unambiguous.",
  },
  {
    locationText: "Austin, Texas", countryCode: "US",
    precision: "city", resolve: { level: "city", key: "AUSTIN|TX|US" },
    rationale: "Named city + state (country from location_country_code column).",
  },
  {
    locationText: "Santa Monica, California, USA", countryCode: "US",
    precision: "city", resolve: { level: "city", key: "SANTA MONICA|CA|US" },
    rationale: "Named city + state + country, unambiguous.",
  },
  {
    locationText: "San Francisco, California, USA", countryCode: "US",
    precision: "city", resolve: { level: "city", key: "SAN FRANCISCO|CA|US" },
    rationale: "Named city + state + country, unambiguous.",
  },
];

function curatedOverrideKey(locationText, countryCode) {
  return `${locationText ?? " NULL"}|${countryCode ?? " NULL"}`;
}

const CURATED_OVERRIDE_INDEX = new Map(
  CURATED_OVERRIDES.map((row) => [curatedOverrideKey(row.locationText, row.countryCode), row]),
);

/** @returns {{precision:string, resolve:{level:string,key:string}|null}} */
export function resolveCurated(locationText, countryCode) {
  const row = CURATED_OVERRIDE_INDEX.get(curatedOverrideKey(locationText, countryCode));
  if (!row) {
    throw new Error(
      `No explicit curated classification for (${JSON.stringify(locationText)}, ${JSON.stringify(countryCode)}). ` +
        "Every distinct curated (location_text, location_country_code) pair in the live " +
        "corpus must have an entry in CURATED_OVERRIDES — add one rather than falling back " +
        "to a generic guess.",
    );
  }
  return { precision: row.precision, resolve: row.resolve };
}

/**
 * Dispatch by origin, then look up coordinates for a `resolve` descriptor.
 * @returns {{level:string, key:string, latitude:number, longitude:number}|null}
 */
export function resolveEvent(event, index) {
  if (event.origin === "curated") {
    const { resolve } = resolveCurated(event.location_text, event.location_country_code);
    if (!resolve) return null;
    return lookupByDescriptor(resolve, index);
  }
  if (event.origin === "source-derived") {
    return resolveSourceDerived(event.location_text, event.location_country_code, index);
  }
  throw new Error(`Unknown origin "${event.origin}" for event "${event.slug}"`);
}

function lookupByDescriptor({ level, key }, index) {
  if (level === "city") {
    const row = index.cityByKey3.get(key) ?? index.cityByKey2.get(key);
    if (!row) throw new Error(`City lookup key "${key}" not found in location_lookup data`);
    return { level, key, latitude: row.latitude, longitude: row.longitude };
  }
  if (level === "region") {
    const row = index.regionByKey.get(key);
    if (!row) throw new Error(`Region lookup key "${key}" not found in location_lookup data`);
    return { level, key, latitude: row.latitude, longitude: row.longitude };
  }
  if (level === "country") {
    const row = index.countryByCode.get(norm(key));
    if (!row) throw new Error(`Country lookup key "${key}" not found in location_lookup data`);
    return { level, key: norm(key), latitude: row.latitude, longitude: row.longitude };
  }
  throw new Error(`Unknown level "${level}"`);
}

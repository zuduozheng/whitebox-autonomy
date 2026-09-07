import { test } from "node:test";
import assert from "node:assert/strict";

import { COUNTRIES, REGIONS, CITIES } from "../location-lookup-data.mjs";
import { buildLookupIndex, resolveSourceDerived, resolveEvent, resolveCurated } from "../resolve.mjs";

const index = buildLookupIndex(COUNTRIES, REGIONS, CITIES);

test("source-derived: resolves to city when the city is in the lookup", () => {
  const result = resolveSourceDerived("Phoenix, AZ, US", "US", index);
  assert.equal(result.level, "city");
  assert.equal(result.latitude, 33.4484);
  assert.equal(result.longitude, -112.0740);
});

test("source-derived: falls back to region when the city is not in the lookup (the actual fallback rule)", () => {
  // A real one-off NHTSA city string with no dedicated lookup row.
  const result = resolveSourceDerived("Kingwood, TX, US", "US", index);
  assert.equal(result.level, "region");
  const texasRegion = REGIONS.find((r) => r.regionCode === "TX");
  assert.equal(result.latitude, texasRegion.latitude);
  assert.equal(result.longitude, texasRegion.longitude);
});

test("source-derived: falls back to country when neither city nor region resolve", () => {
  // An invented region code that exists in no US-state lookup row.
  const result = resolveSourceDerived("Somewhere, ZZ, US", "US", index);
  assert.equal(result.level, "country");
  const us = COUNTRIES.find((c) => c.countryCode === "US");
  assert.equal(result.latitude, us.latitude);
  assert.equal(result.longitude, us.longitude);
});

test("source-derived: a mismatched city/state pair (e.g. a probable data error) does not spuriously match a same-named city in a different state", () => {
  // Real corpus row: "Phoenix, CA, US" — Phoenix, AZ is in the lookup, but
  // keyed on (PHOENIX, AZ, US); this must not match under (PHOENIX, CA, US).
  const result = resolveSourceDerived("Phoenix, CA, US", "US", index);
  assert.equal(result.level, "region", "must fall back to CA region, never the AZ city point");
  const california = REGIONS.find((r) => r.regionCode === "CA");
  assert.equal(result.latitude, california.latitude);
});

test("source-derived: region-precision text (e.g. 'CA, US') resolves directly at region level", () => {
  const result = resolveSourceDerived("CA, US", "US", index);
  assert.equal(result.level, "region");
});

test("source-derived: bare country text resolves at country level", () => {
  const result = resolveSourceDerived("US", "US", index);
  assert.equal(result.level, "country");
});

test("source-derived: null location_text resolves to null (unmapped)", () => {
  assert.equal(resolveSourceDerived(null, "US", index), null);
});

test("curated: the explicitly-uncertain Thailand guess resolves to null and is never geocoded", () => {
  const { precision, resolve } = resolveCurated("Reported as probably Thailand; not confirmed", null);
  assert.equal(resolve, null);
  assert.equal(precision, "unknown");
});

test("curated: no location text resolves to null with precision unknown", () => {
  const { precision, resolve } = resolveCurated(null, null);
  assert.equal(resolve, null);
  assert.equal(precision, "unknown");
});

test("curated: 'Austin, Texas, USA' and NHTSA's 'Austin, TX, US' resolve to the identical shared city point", () => {
  const curated = resolveEvent(
    { origin: "curated", location_text: "Austin, Texas, USA", location_country_code: "US", slug: "c1" },
    index,
  );
  const sourceDerived = resolveEvent(
    { origin: "source-derived", location_text: "Austin, TX, US", location_country_code: "US", slug: "s1" },
    index,
  );
  assert.equal(curated.level, "city");
  assert.deepEqual(curated, sourceDerived, "same city must plot at exactly the same point, regardless of origin");
});

test("curated: a named road spanning a huge area falls back to country, not a guessed point", () => {
  const { precision, resolve } = resolveCurated("Bruce Highway, Australia", "AU");
  assert.equal(precision, "road-or-intersection", "the text does name a specific road");
  assert.equal(resolve.level, "country", "but no defensible single point exists for a 1,700km highway");
});

test("curated: a route explicitly described as NOT in a named city falls back to the state, not that city", () => {
  const { resolve } = resolveCurated("GA-575, north of Atlanta, Georgia, USA", "US");
  assert.equal(resolve.level, "region");
  assert.equal(resolve.key, "GA|US", "must not resolve to the Atlanta city point since the text says north of it");
});

test("curated: bare country name resolves at country level with precision 'country'", () => {
  const { precision, resolve } = resolveCurated("Australia", "AU");
  assert.equal(precision, "country");
  assert.equal(resolve.level, "country");
  assert.equal(resolve.key, "AU");
});

test("resolveCurated throws (does not silently guess) for an unclassified curated value", () => {
  assert.throws(() => resolveCurated("Some new text never seen before", "US"));
});

test("resolveEvent throws for an unrecognized origin rather than silently resolving", () => {
  assert.throws(() =>
    resolveEvent({ origin: "mystery", location_text: "X", location_country_code: "US", slug: "z" }, index),
  );
});

test("every CURATED_OVERRIDES resolve() descriptor that is non-null actually exists in the lookup data", async () => {
  const { CURATED_OVERRIDES } = await import("../resolve.mjs");
  for (const row of CURATED_OVERRIDES) {
    if (!row.resolve) continue;
    // Resolving must not throw — i.e. the key genuinely exists in COUNTRIES/REGIONS/CITIES.
    assert.doesNotThrow(() => resolveEvent(
      { origin: "curated", location_text: row.locationText, location_country_code: row.countryCode, slug: "t" },
      index,
    ));
  }
});

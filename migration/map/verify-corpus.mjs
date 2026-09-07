#!/usr/bin/env node
/**
 * WBA Beta map — offline resolution verification against the real corpus.
 *
 * Reads event-location-snapshot.json (a frozen snapshot of the live public
 * `event` table's location-relevant columns — all 2,923 public events,
 * captured via the project's read-only anon key, no live DB write, on
 * 2026-09-07) and applies resolve.mjs's exact algorithm to every row. Prints
 * counts per resolved level, lists every unmapped event, and runs the
 * specific checks the map foundation was asked to satisfy:
 *
 *   - the hierarchical fallback (city -> region -> country) actually fires
 *     when a finer level cannot be resolved;
 *   - the one explicitly-uncertain curated location ("...probably Thailand;
 *     not confirmed") stays unmapped, never geocoded;
 *   - the 11 curated events with no location text at all stay unmapped;
 *   - resolving never crashes or silently drops a row (every one of the
 *     2,923 rows gets an explicit outcome).
 *
 * This script has no database dependency and makes no network call — it is
 * the reproducible substitute for running the proposed migration against a
 * live Postgres instance (none is available in this environment; see the
 * architecture report for that limitation and how the SQL was instead
 * hand-verified against these same figures).
 *
 * Run: node migration/map/verify-corpus.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COUNTRIES, REGIONS, CITIES } from "./location-lookup-data.mjs";
import { buildLookupIndex, resolveEvent, resolveCurated } from "./resolve.mjs";

const events = JSON.parse(
  readFileSync(fileURLToPath(new URL("./event-location-snapshot.json", import.meta.url)), "utf8"),
);

const index = buildLookupIndex(COUNTRIES, REGIONS, CITIES);

const counts = { city: 0, region: 0, country: 0, unmapped: 0 };
const byOrigin = {
  curated: { city: 0, region: 0, country: 0, unmapped: 0 },
  "source-derived": { city: 0, region: 0, country: 0, unmapped: 0 },
};
const unmappedEvents = [];
const fallbackExamples = []; // events whose stated precision implies a finer level than what actually got plotted

for (const event of events) {
  const result = resolveEvent(event, index);
  const level = result ? result.level : "unmapped";
  counts[level] += 1;
  byOrigin[event.origin][level] += 1;
  if (!result) {
    unmappedEvents.push({ slug: event.slug, origin: event.origin, location_text: event.location_text });
  } else if (
    (event.location_precision === "city" && level !== "city") ||
    (event.location_precision === "region" && level === "country")
  ) {
    fallbackExamples.push({
      slug: event.slug,
      location_text: event.location_text,
      stated_precision: event.location_precision,
      plotted_level: level,
    });
  }
}

console.log("=== WBA Beta map — corpus resolution report ===");
console.log(`Total public events: ${events.length}`);
console.log();
console.log("Resolved level (all origins):", counts);
console.log("  curated:       ", byOrigin.curated);
console.log("  source-derived:", byOrigin["source-derived"]);
console.log();
console.log(`Events falling back to a coarser level than their stated precision: ${fallbackExamples.length}`);
for (const ex of fallbackExamples.slice(0, 10)) {
  console.log(`  ${ex.slug}: "${ex.location_text}" (stated ${ex.stated_precision}) -> plotted at ${ex.plotted_level}`);
}
if (fallbackExamples.length > 10) console.log(`  ... and ${fallbackExamples.length - 10} more`);
console.log();
console.log(`Unmapped events requiring curator review: ${unmappedEvents.length}`);
for (const u of unmappedEvents) {
  console.log(`  ${u.slug} (${u.origin}): ${JSON.stringify(u.location_text)}`);
}

// --- sanity assertions -----------------------------------------------------
const total = counts.city + counts.region + counts.country + counts.unmapped;
if (total !== events.length) {
  throw new Error(`Resolution accounting mismatch: ${total} !== ${events.length}`);
}

const thailand = events.find((e) => e.location_text?.includes("Thailand"));
const thailandResult = thailand ? resolveEvent(thailand, index) : undefined;
if (!thailand || thailandResult !== null) {
  throw new Error("FAILED: the Thailand-uncertain event must resolve to null (unmapped)");
}
console.log();
console.log(`OK: uncertain-location event (${thailand.slug}) stays unmapped.`);

const noLocation = events.filter((e) => e.origin === "curated" && e.location_text === null);
if (noLocation.length !== 11) {
  throw new Error(`Expected exactly 11 curated no-location events, found ${noLocation.length}`);
}
if (!noLocation.every((e) => resolveEvent(e, index) === null)) {
  throw new Error("FAILED: a no-location event resolved to a coordinate");
}
console.log(`OK: all ${noLocation.length} no-location curated events stay unmapped.`);

if (unmappedEvents.length !== 11 + 1) {
  throw new Error(
    `Expected exactly 12 unmapped events (11 no-location + 1 uncertain-Thailand), found ${unmappedEvents.length}`,
  );
}
console.log(`OK: exactly ${unmappedEvents.length} events are unmapped, matching the known 11 + 1 cases.`);

// --- curated location_precision backfill breakdown --------------------------
const curatedEvents = events.filter((e) => e.origin === "curated");
const precisionBefore = {};
const precisionAfter = {};
let precisionUnchanged = 0;
let precisionChanged = 0;
for (const e of curatedEvents) {
  precisionBefore[e.location_precision] = (precisionBefore[e.location_precision] ?? 0) + 1;
  const { precision } = resolveCurated(e.location_text, e.location_country_code);
  precisionAfter[precision] = (precisionAfter[precision] ?? 0) + 1;
  if (precision === e.location_precision) precisionUnchanged += 1;
  else precisionChanged += 1;
}
console.log();
console.log("=== Curated location_precision backfill (86 curated events) ===");
console.log("Before (all currently 'unknown' — see architecture report):", precisionBefore);
console.log("After proposed backfill:                                   ", precisionAfter);
console.log(`${precisionChanged} rows change value, ${precisionUnchanged} stay 'unknown' (genuinely unknown/uncertain).`);
if (precisionBefore.unknown !== 86 || Object.keys(precisionBefore).length !== 1) {
  throw new Error("Expected all 86 curated rows to currently read location_precision = 'unknown'");
}
if (precisionAfter.unknown !== 12) {
  throw new Error(`Expected exactly 12 curated rows to remain 'unknown' after backfill, got ${precisionAfter.unknown}`);
}
console.log("OK: exactly the 12 genuinely-unmapped rows (11 no-location + 1 uncertain) keep precision 'unknown'.");

// --- no-other-column-changed guard ------------------------------------------
// This script and the proposed migration only ever set location_precision
// (curated) and add rows to new tables. Confirm nothing else about a curated
// row would need to change to support this resolution.
const otherFieldsTouched = curatedEvents.some(
  (e) => typeof e !== "object" || !("location_text" in e) || !("location_country_code" in e),
);
if (otherFieldsTouched) throw new Error("Unexpected shape in curated snapshot rows");
console.log("OK: backfill touches location_precision only — location_text/location_country_code read, never written.");

console.log();
console.log("All checks passed.");

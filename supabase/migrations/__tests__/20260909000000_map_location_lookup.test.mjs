/**
 * Static regression coverage for 20260909000000_map_location_lookup.sql.
 *
 * No test database exists in this project (see
 * 20260908000000_event_origin.test.mjs), so — following that established
 * convention — this checks the migration's actual SQL text against the
 * approved scope: no PostGIS/spatial extension, no per-event coordinate on
 * `event`, no cache table / trigger / materialized view / cron refresh for
 * the map point (event_map_public must be a live, non-materialized view),
 * RLS preserved and correctly scoped, the curated backfill and override
 * table touch only what they should. It cannot prove the SQL behaves
 * correctly against a live Postgres engine (no local instance is available
 * in this environment — see the architecture report); migration/map/verify-
 * corpus.mjs and migration/map/__tests__/resolve.test.mjs independently
 * verify the same resolution ALGORITHM in JS against the real corpus, which
 * this SQL is hand-verified to implement identically (same lookup keys,
 * same 16-value curated classification).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(new URL("../20260909000000_map_location_lookup.sql", import.meta.url)),
  "utf8",
);

function codeOnly(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

test("never mentions PostGIS or a spatial extension in actual SQL (comments may explain the absence)", () => {
  const code = codeOnly(SQL);
  assert.equal(/postgis/i.test(code), false);
  assert.equal(/create extension/i.test(code), false);
  assert.equal(/using gist/i.test(code), false);
});

test("adds no coordinate column to public.event itself", () => {
  const code = codeOnly(SQL);
  assert.equal(/alter table (public\.)?event\b[\s\S]*?add column[\s\S]*?(latitude|longitude)/i.test(code), false);
});

test("no cache table, trigger, materialized view, or scheduled refresh exists for the map point", () => {
  const code = codeOnly(SQL);
  assert.equal(/event_map_point/i.test(code), false, "the rejected precomputed-cache design must be fully removed");
  assert.equal(/create\s+(or\s+replace\s+)?trigger/i.test(code), false);
  assert.equal(/create\s+materialized\s+view/i.test(code), false);
  assert.equal(/refresh\s+materialized\s+view/i.test(code), false);
  assert.equal(/pg_cron|cron\.schedule/i.test(code), false);
});

test("event_map_public is a plain (non-materialized) view", () => {
  assert.match(SQL, /create view public\.event_map_public/);
  assert.equal(/create materialized view public\.event_map_public/i.test(SQL), false);
});

test("creates location_lookup and curated_location_override with RLS enabled", () => {
  assert.match(SQL, /create table public\.location_lookup/);
  assert.match(SQL, /alter table public\.location_lookup enable row level security/);
  assert.match(SQL, /create table public\.curated_location_override/);
  assert.match(SQL, /alter table public\.curated_location_override enable row level security/);
});

test("location_lookup and curated_location_override are both unconditionally public-read (non-sensitive reference data)", () => {
  assert.match(SQL, /create policy location_lookup_public_read[\s\S]*?using \(true\)/);
  assert.match(SQL, /create policy curated_location_override_public_read[\s\S]*?using \(true\)/);
});

test("write privileges are explicitly revoked from anon/authenticated on both reference tables (defense in depth)", () => {
  assert.match(SQL, /revoke insert, update, delete on public\.location_lookup from anon, authenticated/);
  assert.match(SQL, /revoke insert, update, delete on public\.curated_location_override from anon, authenticated/);
});

test("event_map_public view uses security_invoker so it can never bypass the underlying RLS", () => {
  assert.match(SQL, /create view public\.event_map_public\s*\n?\s*with \(security_invoker = true\)/);
});

test("event_map_public resolves live: both its branches read directly from public.event, filtered to is_public and origin", () => {
  const viewBlock = SQL.slice(SQL.indexOf("create view public.event_map_public"));
  const curatedFrom = viewBlock.match(/from public\.event e\s*\n\s*join public\.curated_location_override/);
  const sourceDerivedFrom = viewBlock.match(/from public\.event e\s*\n\s*where e\.is_public = true\s*\n\s*and e\.origin = 'source-derived'/);
  assert.ok(curatedFrom, "curated branch must select live from public.event");
  assert.ok(sourceDerivedFrom, "source-derived branch must select live from public.event");
  assert.match(viewBlock, /union all/);
});

test("curated location_precision backfill is guarded to origin='curated' and only overwrites 'unknown'", () => {
  const updateBlock = SQL.slice(
    SQL.indexOf("update public.event e"),
    SQL.indexOf("create table public.curated_location_override"),
  );
  assert.match(updateBlock, /where e\.origin = 'curated'/);
  assert.match(updateBlock, /and e\.location_precision = 'unknown'/);
});

test("the uncertain-location and no-location curated rows never get a lookup_key (stay unmapped)", () => {
  const overridesBlock = SQL.slice(SQL.indexOf("insert into public.curated_location_override"));
  assert.match(overridesBlock, /\(null, null, null,/);
  assert.match(overridesBlock, /'Reported as probably Thailand; not confirmed', null, null,/);
});

test("the Bruce Highway / Brisbane Inner City Bypass / UQ curated rows resolve no finer than country (AU) — no fabricated city/region point", () => {
  const overridesBlock = SQL.slice(SQL.indexOf("insert into public.curated_location_override"));
  for (const text of [
    "Bruce Highway, Australia",
    "Brisbane Inner City Bypass, Australia",
    "University of Queensland, St Lucia, Brisbane, Australia",
  ]) {
    const re = new RegExp(`'${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}', 'AU', 'AU',`);
    assert.match(overridesBlock, re, `expected ${text} to resolve to lookup_key 'AU' (country only)`);
  }
});

test("GA-575 curated row resolves to the Georgia region, not the Atlanta city point", () => {
  const overridesBlock = SQL.slice(SQL.indexOf("insert into public.curated_location_override"));
  assert.match(overridesBlock, /'GA-575, north of Atlanta, Georgia, USA', 'US', 'GA\|US',/);
});

test("curated_location_override.lookup_key is a foreign key into location_lookup (never an unvalidated string) and nullable (unmapped is representable)", () => {
  assert.match(SQL, /lookup_key\s+text references public\.location_lookup \(key\)/);
});

test("curated_location_override has a natural-key uniqueness guard so the same location_text can never be classified two different ways", () => {
  assert.match(SQL, /unique nulls not distinct \(location_text, location_country_code\)/);
});

test("documents that a future curated location is added as a plain data row, not a schema/code change", () => {
  assert.match(SQL, /add a row for a new curated location_text as it appears/i);
});

test("does not modify any existing publication-lifecycle or completeness trigger function", () => {
  const code = codeOnly(SQL);
  assert.equal(/create or replace function public\.enforce_/i.test(code), false);
});

test("does not touch event_source, nhtsa_report, or nhtsa_incident_candidate", () => {
  const code = codeOnly(SQL);
  assert.equal(/\bevent_source\b/i.test(code), false);
  assert.equal(/\bnhtsa_report\b/i.test(code), false);
  assert.equal(/\bnhtsa_incident_candidate\b/i.test(code), false);
});

test("location_lookup INSERT carries no duplicate key", () => {
  const start = SQL.indexOf("insert into public.location_lookup");
  const end = SQL.indexOf(";", start);
  const insertBlock = SQL.slice(start, end);
  const keys = [...insertBlock.matchAll(/^\s*\('([^']*)',\s*'(?:city|region|country)',/gm)].map((m) => m[1]);
  assert.ok(keys.length > 80, `expected ~93 location_lookup rows, found ${keys.length}`);
  assert.equal(new Set(keys).size, keys.length, "location_lookup key column must be unique");
});

test("curated_location_override INSERT carries exactly 16 rows, matching resolve.mjs's CURATED_OVERRIDES count", () => {
  const start = SQL.indexOf("insert into public.curated_location_override");
  // Bounded by the next section header rather than a naive search for ";" —
  // several rationale strings legitimately contain a literal semicolon
  // (e.g. "Bare country name; text supports no finer level."), which would
  // truncate the block early if used as the end marker.
  const end = SQL.indexOf("-- ===", start);
  // Skip the leading column-list line ("(location_text, ...)"), which is
  // also 2-space indented and would otherwise be miscounted as a row.
  const valuesStart = SQL.indexOf("values", start);
  const insertBlock = SQL.slice(valuesStart, end);
  assert.match(insertBlock, /;\s*$/, "sanity check: the slice should still end with the statement's own semicolon");
  // Each row starts at the top level with "  (" immediately followed by a
  // quoted/`null` location_text — count opening row parens at 2-space indent.
  const rowStarts = insertBlock.match(/^\s{2}\(/gm) ?? [];
  assert.equal(rowStarts.length, 16);
});

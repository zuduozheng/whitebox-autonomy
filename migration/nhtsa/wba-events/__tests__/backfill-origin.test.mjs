/**
 * Static regression coverage for backfill-origin.sql / rollback-origin.sql.
 *
 * These artifacts are hand-written, not generated, and are never executed by
 * this test suite (no test database exists) — so correctness here means
 * verifying, by reading the actual SQL text, that the artifact's shape still
 * matches every explicit safety requirement it was designed against: the
 * authoritative linked_event_id join (never a slug pattern), and that it
 * never touches is_public or nhtsa_incident_candidate.status. Mirrors the
 * text-based regression style already used in
 * build-promotion-sql.test.mjs (findPlaceholderMismatches).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../", import.meta.url));
const BACKFILL_SQL = readFileSync(DIR + "backfill-origin.sql", "utf8");
const ROLLBACK_SQL = readFileSync(DIR + "rollback-origin.sql", "utf8");

/**
 * The actual dangerous shape is a real SQL predicate: "slug like" followed by
 * a quoted pattern literal (e.g. "slug like 'nhtsa-%'"). Both files'
 * explanatory comments legitimately say "slug LIKE pattern" in prose (with no
 * following quote), which a bare "slug like" substring check would
 * false-positive on — requiring the trailing quote distinguishes an actual
 * predicate from a comment describing why one isn't used.
 */
const SLUG_LIKE_PREDICATE_RE = /\bslug\s+like\s+'/i;

for (const [name, sql] of [
  ["backfill-origin.sql", BACKFILL_SQL],
  ["rollback-origin.sql", ROLLBACK_SQL],
]) {
  test(`${name}: never uses a slug LIKE pattern as a predicate`, () => {
    assert.equal(SLUG_LIKE_PREDICATE_RE.test(sql), false);
  });

  test(`${name}: uses the authoritative linked_event_id join`, () => {
    assert.match(sql, /c\.linked_event_id\s*=\s*e\.id/);
  });

  test(`${name}: never writes is_public`, () => {
    assert.equal(/\bset\s+is_public\b/i.test(sql), false);
  });

  test(`${name}: never issues a write statement against nhtsa_incident_candidate`, () => {
    assert.equal(/\b(update|insert into|delete from)\s+public\.nhtsa_incident_candidate\b/i.test(sql), false);
  });

  test(`${name}: asserts candidate.status stays 'pending' as a postcondition`, () => {
    assert.match(sql, /status is distinct from 'pending'/);
  });

  test(`${name}: wraps in begin/commit`, () => {
    assert.match(sql, /^begin;/m);
    assert.match(sql, /^commit;/m);
  });
}

test("backfill-origin.sql: the only column it sets on public.event is origin", () => {
  const updateMatch = BACKFILL_SQL.match(/update public\.event e\s+set\s+([\s\S]*?)\s+from/i);
  assert.ok(updateMatch, "expected an UPDATE public.event ... SET ... FROM statement");
  assert.equal(updateMatch[1].trim(), "origin = 'source-derived'");
});

test("rollback-origin.sql: the only column it sets on public.event is origin", () => {
  const updateMatch = ROLLBACK_SQL.match(/update public\.event e\s+set\s+([\s\S]*?)\s+from/i);
  assert.ok(updateMatch, "expected an UPDATE public.event ... SET ... FROM statement");
  assert.equal(updateMatch[1].trim(), "origin = 'curated'");
});

test("backfill-origin.sql: asserts exact set equality between source-derived events and linked candidates", () => {
  assert.match(BACKFILL_SQL, /except/i);
  assert.match(BACKFILL_SQL, /not linked from any candidate/);
  assert.match(BACKFILL_SQL, /were not reclassified to source-derived/);
});

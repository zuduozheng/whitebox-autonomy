/**
 * Static regression coverage for 20260908000000_event_origin.sql.
 *
 * No test database exists in this project (confirmed by the complete absence
 * of any prior test against supabase/migrations/*.sql), so this verifies the
 * migration's actual SQL text against the frozen architecture's exact
 * requirements — the same text-based regression style already used for
 * migration/nhtsa/wba-events/build-promotion-sql.mjs's generated SQL and for
 * backfill-origin.sql/rollback-origin.sql. It cannot prove the trigger
 * behaves correctly against a live Postgres engine; it proves the shape the
 * reviewer approved is the shape actually committed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(new URL("../20260908000000_event_origin.sql", import.meta.url)),
  "utf8",
);

test("adds origin as NOT NULL DEFAULT 'curated' with exactly the two frozen values", () => {
  assert.match(SQL, /add column origin text not null default 'curated'/);
  assert.match(SQL, /check \(origin in \('curated', 'source-derived'\)\)/);
});

test("does not touch review_status's own CHECK constraint or add a value to it", () => {
  // The frozen architecture is explicit: origin and review_status are
  // independent columns; 'source-derived' must never become a review_status
  // value.
  assert.equal(/add constraint event_review_status_check/i.test(SQL), false);
  assert.equal(/review_status in \([^)]*'source-derived'/i.test(SQL), false);
});

test("does not redefine enforce_public_event_has_source or enforce_event_publication_lifecycle", () => {
  assert.equal(
    /create or replace function public\.enforce_public_event_has_source/i.test(SQL),
    false,
  );
  assert.equal(
    /create or replace function public\.enforce_event_publication_lifecycle/i.test(SQL),
    false,
  );
});

test("never references nhtsa_incident_candidate in actual SQL (candidate.status is untouched by this migration)", () => {
  // The header comments name nhtsa_incident_candidate in prose (explaining
  // why this migration doesn't touch it) — strip full-line comments first so
  // only real SQL statements are checked.
  const codeOnly = SQL
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.equal(/nhtsa_incident_candidate/i.test(codeOnly), false);
});

test("modifies no existing row: no INSERT/UPDATE/DELETE against public.event", () => {
  assert.equal(/\b(update|insert into|delete from)\s+public\.event\b/i.test(SQL), false);
});

test("enforce_public_event_is_complete requires title/developer_or_operator/event_type/valence unconditionally", () => {
  const unconditional = SQL.match(
    /if new\.is_public is true then\s+if\s+([\s\S]*?)\s+then\s+raise exception/,
  );
  assert.ok(unconditional, "expected the unconditional completeness check");
  for (const field of ["new.title is null", "new.developer_or_operator is null", "new.event_type is null", "new.valence is null"]) {
    assert.ok(unconditional[1].includes(field), `expected unconditional check to include "${field}"`);
  }
});

test("summary/review_status/observed_facts are required only inside the origin='curated' branch", () => {
  const curatedBranchIndex = SQL.indexOf("if new.origin = 'curated' then");
  assert.notEqual(curatedBranchIndex, -1, "expected an if new.origin = 'curated' then branch");

  // Each of these three checks must appear exactly once in the whole file —
  // inside that branch, never as a second, unconditional copy elsewhere.
  for (const [label, pattern] of [
    ["summary is null", /new\.summary is null/g],
    ["review_status is null", /new\.review_status is null/g],
    ["observed_facts cardinality", /cardinality\(new\.observed_facts\) = 0/g],
  ]) {
    const matches = [...SQL.matchAll(pattern)];
    assert.equal(matches.length, 1, `expected exactly one "${label}" check, found ${matches.length}`);
    assert.ok(
      matches[0].index > curatedBranchIndex,
      `expected the "${label}" check to appear inside the origin='curated' branch`,
    );
  }
});

test("does not require observed_facts/summary/review_status for a source-derived event", () => {
  // The curated-only branch must close (an "end if") before the outer "end
  // if" that closes the whole is_public block — i.e. the three extra checks
  // are scoped, not simply appended unconditionally.
  const curatedBranch = SQL.slice(SQL.indexOf("if new.origin = 'curated' then"));
  const firstEndIf = curatedBranch.indexOf("end if;");
  assert.notEqual(firstEndIf, -1);
  const closedBranch = curatedBranch.slice(0, firstEndIf);
  assert.ok(closedBranch.includes("cardinality(new.observed_facts) = 0"));
});

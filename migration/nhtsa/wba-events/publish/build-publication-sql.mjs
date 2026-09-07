/**
 * NHTSA source-derived publication generator.
 *
 * Unlike the original private promotion (whose input was the frozen,
 * already-approved dry-run JSONL — a deterministic build artifact with no
 * live-database dependency), publication necessarily transforms rows that
 * already exist in the database, so its input is a read-only PRODUCTION
 * EXPORT (production-export-query.sql's output) rather than a committed
 * corpus file. Every exported record is re-verified live, inside the
 * generated SQL's own precondition block, at apply time — this generator's
 * job is to decide WHICH events are eligible and WHAT title each gets, never
 * to assert that a stale snapshot is still true.
 *
 * Pipeline: loadProductionExport -> evaluateAllRecords -> partitionEligibility
 * -> buildTitledEligibleSet -> { renderPublicationSql, renderRollbackSql,
 * buildExceptionReport }.
 *
 * Run: node migration/nhtsa/wba-events/publish/build-publication-sql.mjs --emit
 * Writes: publish.sql, rollback-publish.sql, exception-report.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { sqlText, sqlUuid } from "../../sql-literals.mjs";
import { generateTitle } from "./title.mjs";
import { evaluatePublicationPreconditions, findMultiplyLinkedEvents } from "./preconditions.mjs";

const DIR = fileURLToPath(new URL("./", import.meta.url));
const EXPORT_PATH = DIR + "production-export.json";
const PUBLISH_SQL_PATH = DIR + "publish.sql";
const ROLLBACK_SQL_PATH = DIR + "rollback-publish.sql";
const EXCEPTION_REPORT_PATH = DIR + "exception-report.json";

export function loadProductionExport(path = EXPORT_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Per-record precondition evaluation plus the one batch-level check
 * (multiply-linked event) folded in, so every record ends up with a single,
 * complete failure list.
 */
export function evaluateAllRecords(records) {
  const multiplyLinked = findMultiplyLinkedEvents(records);
  return records.map((record) => {
    const { eligible, failures } = evaluatePublicationPreconditions(record);
    const extra = multiplyLinked.has(record.linkedEventId)
      ? [
          `event is linked by ${multiplyLinked.get(record.linkedEventId).length} candidates, expected exactly 1`,
        ]
      : [];
    const allFailures = [...failures, ...extra];
    return { record, eligible: eligible && extra.length === 0, failures: allFailures };
  });
}

export function partitionEligibility(evaluated) {
  const eligible = [];
  const exceptions = [];
  for (const item of evaluated) {
    if (item.eligible) eligible.push(item.record);
    else exceptions.push({ record: item.record, failures: item.failures });
  }
  return { eligible, exceptions };
}

/** Pure: generates the deterministic title for every eligible record. */
export function buildTitledEligibleSet(eligibleRecords) {
  return eligibleRecords.map((record) => ({ record, title: generateTitle(record.event) }));
}

/**
 * Not an error — event.slug is the unique identifier, not title. Reported
 * for transparency only; no artificial disambiguation is introduced.
 */
export function findDuplicateTitles(titled) {
  const byTitle = new Map();
  for (const { title, record } of titled) {
    const list = byTitle.get(title) ?? [];
    list.push(record.candidateId);
    byTitle.set(title, list);
  }
  const duplicates = new Map();
  for (const [title, candidateIds] of byTitle) {
    if (candidateIds.length > 1) duplicates.set(title, candidateIds);
  }
  return duplicates;
}

/** Deterministically ordered (by candidateId) so the artifact is stable across regenerations. */
export function buildExceptionReport(exceptions) {
  return exceptions
    .map(({ record, failures }) => ({
      candidateId: record.candidateId,
      sameIncidentId: record.sameIncidentId ?? null,
      linkedEventId: record.linkedEventId,
      slug: record.event?.slug ?? null,
      failures,
    }))
    .sort((a, b) => (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0));
}

/**
 * Every column on public.event EXCEPT: id/slug (the join key — slug is
 * still included in the comparison itself, just not part of the join), title
 * and is_public (the two intentional changes), and the three DB-owned
 * columns no application write can suppress: updated_at
 * (event_set_updated_at fires unconditionally on every UPDATE),
 * first_published_at (event_enforce_publication_lifecycle stamps it,
 * permanently, the instant is_public first becomes true — see
 * FIRST_PUBLISHED_AT design note in this directory's README.md), and
 * created_at (never changes on UPDATE regardless). created_by/updated_by ARE
 * included: set_audit_fields() returns NEW unchanged whenever auth.uid() is
 * null (true for this trusted native-connection session), so a trusted
 * publish leaves both exactly as they were.
 */
export const UNCHANGED_COLUMNS = [
  "slug",
  "summary",
  "occurred_on",
  "occurred_on_precision",
  "location_text",
  "location_country_code",
  "location_precision",
  "developer_or_operator",
  "system_name",
  "automation_status",
  "system_version",
  "system_version_knowledge",
  "event_type",
  "valence",
  "observed_facts",
  "unknowns",
  "interpretation",
  "causation_status",
  "causation_note",
  "review_status",
  "record_updated",
  "created_by",
  "updated_by",
  "scenario_tags",
  "origin",
];

function renderPreconditionBlock(titled) {
  const idList = titled.map(({ record }) => `    (${sqlUuid(record.linkedEventId)})`).join(",\n");
  return `do $$
declare
  v_eligible_now int;
  v_linked_pending int;
begin
  select count(*) into v_eligible_now
  from public.event e
  join (values
${idList}
  ) as t(id) on t.id = e.id
  where e.is_public = false
    and e.origin = 'source-derived'
    and e.title is null
    and e.summary is null
    and e.review_status is null
    and cardinality(e.observed_facts) = 0
    and e.developer_or_operator is not null
    and e.event_type is not null
    and e.valence is not null
    and exists (select 1 from public.event_source s where s.event_id = e.id);
  if v_eligible_now != ${titled.length} then
    raise exception 'precondition failed: expected % events to currently satisfy every publication precondition, found % — production state has drifted since this artifact was generated; regenerate before applying',
      ${titled.length}, v_eligible_now;
  end if;

  select count(*) into v_linked_pending
  from public.nhtsa_incident_candidate c
  join (values
${idList}
  ) as t(id) on t.id = c.linked_event_id
  where c.status = 'pending';
  if v_linked_pending != ${titled.length} then
    raise exception 'precondition failed: expected % of these events linked from exactly one pending candidate, found %',
      ${titled.length}, v_linked_pending;
  end if;
end;
$$;`;
}

function renderSnapshotTable(titled) {
  const idList = titled.map(({ record }) => `  (${sqlUuid(record.linkedEventId)})`).join(",\n");
  return `create temporary table pg_temp.pre_publish_snapshot
  on commit drop
as
select ${UNCHANGED_COLUMNS.join(", ")}, id
from public.event
where id in (
${idList}
);`;
}

function renderUpdate(titled) {
  const rows = titled
    .map(({ record, title }) => {
      const label = record.event.slug ?? record.candidateId;
      return `    -- ${label} / candidate ${record.candidateId}\n    (${sqlUuid(record.linkedEventId)}, ${sqlText(title)})`;
    })
    .join(",\n");
  return `update public.event e
set title = v.title,
    is_public = true
from (values
${rows}
) as v(id, title)
where e.id = v.id;`;
}

function renderPostconditionBlock(titled) {
  const diffChecks = UNCHANGED_COLUMNS.map(
    (col) => `       or e.${col} is distinct from p.${col}`,
  ).join("\n");
  return `do $$
declare
  v_public_count int;
  v_title_mismatch int;
  v_unexpected_change int;
begin
  select count(*) into v_public_count from public.event e
  join pg_temp.pre_publish_snapshot p on p.id = e.id
  where e.is_public = true;
  if v_public_count != ${titled.length} then
    raise exception 'postcondition failed: expected % events now public, found %', ${titled.length}, v_public_count;
  end if;

  select count(*) into v_title_mismatch from public.event e
  where e.id in (select id from pg_temp.pre_publish_snapshot) and e.title is null;
  if v_title_mismatch != 0 then
    raise exception 'postcondition failed: % published event(s) still have a null title', v_title_mismatch;
  end if;

  select count(*) into v_unexpected_change
  from public.event e
  join pg_temp.pre_publish_snapshot p on p.id = e.id
  where false
${diffChecks};
  if v_unexpected_change != 0 then
    raise exception 'postcondition failed: % event(s) had a field OTHER than title/is_public change — this publication must touch nothing else',
      v_unexpected_change;
  end if;
end;
$$;`;
}

/**
 * Full publish.sql text: one atomic transaction, precondition (re-verified
 * LIVE, never trusting the export snapshot) -> pre-update column snapshot ->
 * the one UPDATE -> postcondition (including an exhaustive "nothing else
 * changed" diff against the snapshot) -> commit. Aborts on any unexpected
 * state; no per-event manual loop, no curator intervention point.
 */
export function renderPublicationSql(titled) {
  return `-- White Box Autonomy — NHTSA source-derived publication (production-write artifact).
--
-- GENERATED FILE. Source of truth: migration/nhtsa/wba-events/publish/
-- production-export.json (a live production snapshot, NOT a committed
-- corpus — re-export immediately before regenerating this file), transformed
-- by build-publication-sql.mjs. Do not hand-edit. Regenerate with:
--
--     node migration/nhtsa/wba-events/publish/build-publication-sql.mjs --emit
--
-- WHAT THIS DOES
--   Publishes exactly ${titled.length} NHTSA source-derived events: sets a
--   deterministically generated title and is_public = true. Nothing else on
--   these rows changes (re-proven below against a live snapshot taken
--   immediately before the UPDATE, not merely asserted). The authoritative
--   target set is nhtsa_incident_candidate.linked_event_id -> event.id —
--   never a slug pattern. Runs as ONE transaction: either every listed event
--   publishes, or nothing commits. nhtsa_incident_candidate.status is never
--   referenced or modified anywhere in this file.
--
-- DB-OWNED COLUMNS THIS INTENTIONALLY DOES NOT SUPPRESS
--   updated_at changes on every row (event_set_updated_at fires
--   unconditionally on UPDATE). first_published_at is stamped, permanently,
--   the moment is_public first becomes true
--   (enforce_event_publication_lifecycle) — this is BY DESIGN and cannot be
--   undone even by unpublishing later; see rollback-publish.sql's own header
--   for what that means for recovery.
--
-- HOW TO APPLY (native psql over the same connection already proven for
-- promote.sql / backfill-origin.sql):
--
--     psql -v ON_ERROR_STOP=1 -f migration/nhtsa/wba-events/publish/publish.sql
--
-- Do NOT run this until it has been reviewed and independently authorized,
-- and NEVER as a committed publish-then-unpublish rehearsal — a live
-- rehearsal of this exact file must be a BEGIN...ROLLBACK-only transaction,
-- because first_published_at cannot be un-stamped once committed.
--
-- Rollback: migration/nhtsa/wba-events/publish/rollback-publish.sql
-- (generated alongside this file, scoped to the exact same event ids —
-- never a LIKE pattern; a recovery artifact, not a rehearsal mechanism).
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- PRECONDITION ASSERTIONS — re-verified against LIVE state, never trusting
-- the production-export.json snapshot this file was generated from.
-- ---------------------------------------------------------------------------
${renderPreconditionBlock(titled)}

-- ---------------------------------------------------------------------------
-- Snapshot every column this publication must NOT change, so the
-- postcondition below can prove it rather than merely assert it.
-- ---------------------------------------------------------------------------
${renderSnapshotTable(titled)}

-- ---------------------------------------------------------------------------
-- THE UPDATE — title + is_public only, for exactly the authoritative set.
-- ---------------------------------------------------------------------------
${renderUpdate(titled)}

-- ---------------------------------------------------------------------------
-- POSTCONDITION ASSERTIONS
-- ---------------------------------------------------------------------------
${renderPostconditionBlock(titled)}

commit;
`;
}

/**
 * Rollback (recovery artifact, not a rehearsal mechanism — see this file's
 * own header and FIRST_PUBLISHED_AT above). Reverts is_public and title for
 * exactly the same event id list generated here — never a slug pattern.
 * Explicitly does NOT and cannot revert first_published_at: the publication-
 * lifecycle trigger freezes it permanently the instant is_public first
 * becomes true, by design, and this rollback does not attempt to bypass or
 * rewrite that frozen semantics.
 */
export function renderRollbackSql(titled) {
  const idList = titled.map(({ record }) => `  (${sqlUuid(record.linkedEventId)})`).join(",\n");
  return `-- White Box Autonomy — NHTSA source-derived publication ROLLBACK (recovery artifact).
--
-- GENERATED FILE, paired with publish.sql. NOT a rehearsal mechanism: a live
-- rehearsal of publish.sql must be a BEGIN...ROLLBACK-only transaction that
-- never commits. This file exists ONLY for emergency use AFTER publish.sql
-- has already committed and a concrete problem requires unpublishing.
--
-- WHAT THIS DOES
--   Sets is_public = false and title = null for exactly the ${titled.length}
--   event ids publish.sql targeted — the same explicit id list, never a slug
--   pattern. Restores every other field to its pre-publication value
--   trivially, because publish.sql never touched any other field (proven by
--   its own postcondition, not merely assumed here).
--
-- WHAT THIS CANNOT DO
--   first_published_at is NOT reverted and CANNOT be: once
--   enforce_event_publication_lifecycle stamps it (the moment is_public
--   first became true), it is frozen forever for ordinary and trusted
--   writes alike, by design (supabase/migrations/20260831003000_event_
--   publication_lifecycle.sql). After this rollback, an affected event is
--   private again with a null title, exactly as before publish.sql ran,
--   EXCEPT that first_published_at remains permanently populated —
--   historically true (it WAS published), and intentionally not erasable.
--   This rollback does not attempt to bypass or rewrite that semantics.
--
-- HOW TO APPLY:
--
--     psql -v ON_ERROR_STOP=1 -f migration/nhtsa/wba-events/publish/rollback-publish.sql
--
-- Do NOT run unless a concrete problem requires reverting this publication.
-- ---------------------------------------------------------------------------

begin;

update public.event e
set is_public = false,
    title = null
from (values
${idList}
) as v(id)
where e.id = v.id;

do $$
declare
  v_still_public int;
begin
  select count(*) into v_still_public
  from public.event e
  join (values
${idList}
  ) as t(id) on t.id = e.id
  where e.is_public = true;
  if v_still_public != 0 then
    raise exception 'postcondition failed: % event(s) still public after rollback', v_still_public;
  end if;
end;
$$;

commit;
`;
}

function main() {
  const records = loadProductionExport();
  const evaluated = evaluateAllRecords(records);
  const { eligible, exceptions } = partitionEligibility(evaluated);
  const titled = buildTitledEligibleSet(eligible);
  const duplicates = findDuplicateTitles(titled);
  const exceptionReport = buildExceptionReport(exceptions);

  console.log(`Loaded ${records.length} linked candidate/event records.`);
  console.log(`Eligible for publication: ${titled.length}`);
  console.log(`Exceptions: ${exceptionReport.length}`);
  console.log(`Duplicate generated titles: ${duplicates.size}`);

  if (process.argv.includes("--emit")) {
    writeFileSync(PUBLISH_SQL_PATH, renderPublicationSql(titled));
    writeFileSync(ROLLBACK_SQL_PATH, renderRollbackSql(titled));
    writeFileSync(EXCEPTION_REPORT_PATH, JSON.stringify(exceptionReport, null, 2) + "\n");
    console.log(`Wrote ${PUBLISH_SQL_PATH}`);
    console.log(`Wrote ${ROLLBACK_SQL_PATH}`);
    console.log(`Wrote ${EXCEPTION_REPORT_PATH}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

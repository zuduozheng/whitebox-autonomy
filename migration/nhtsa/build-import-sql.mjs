/**
 * NHTSA SGO ADS — production-write SQL artifact generator.
 *
 * Run:
 *   node migration/nhtsa/build-import-sql.mjs           # dry-run (default):
 *                                                        #   validates counts,
 *                                                        #   writes nothing.
 *   node migration/nhtsa/build-import-sql.mjs --emit     # writes
 *                                                        #   migration/nhtsa/import.sql
 *
 * WHAT THIS DOES
 *   Runs the SAME approved pipeline as migration/nhtsa/import.mjs
 *   (migration/nhtsa/pipeline.mjs — unchanged, shared, single source of
 *   truth) and turns its output into one reviewable SQL file. This script
 *   never connects to any database and never executes anything — it only
 *   writes a local .sql file. Applying that file is a separate, later,
 *   explicitly-approved step (see the header of the generated file for the
 *   exact command), exactly mirroring migration/legacy/build-import.mjs's
 *   build -> review -> apply pattern.
 *
 * EXPECTED COUNTS (from the approved dry run; checked before writing)
 *   3223 nhtsa_report rows, 2843 nhtsa_incident_candidate rows
 *   (2831 grouped by Same Incident ID + 12 NULL-Same-Incident-ID singletons).
 *   A mismatch aborts with no file written — see EXPECT below.
 *
 * See the generated file's own header comment for the full idempotency /
 * preservation design (report upsert, grouped-candidate reuse via the
 * partial unique index, singleton reuse anchored on the report's own
 * incident_candidate_id, and which candidate fields are frozen once a
 * curator has acted).
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runPipeline } from "./pipeline.mjs";
import { sqlText, sqlInt, sqlJsonb, sqlTextArray } from "./sql-literals.mjs";

const OUT_PATH = fileURLToPath(new URL("./import.sql", import.meta.url));

const EXPECT = {
  totalReports: 3223,
  historicalLatest: 1899,
  currentLatest: 1324,
  totalCandidates: 2843,
  grouped: 2831,
  singletons: 12,
};

// ---------------------------------------------------------------------------
// nhtsa_report — Step 1.
// ---------------------------------------------------------------------------

const REPORT_VALUE_COLUMNS = [
  "reporting_generation", "report_id", "report_version", "same_incident_id",
  "reporting_entity", "developer_or_operator", "incident_date",
  "incident_date_precision", "report_submission_date", "city", "state",
  "country_code", "automation_engagement_text",
  "crash_interaction_counterpart_text", "subject_vehicle_precrash_movement_text",
  "other_actor_precrash_movement_text", "injury_outcome_text", "narrative",
  "raw_row", "retrieved_on",
];

// Columns compared for the "content changed at the same version" no-op guard.
// Excludes reporting_generation/report_id (the conflict key — always equal
// inside a DO UPDATE, so comparing them is dead weight), report_version
// (handled by its own >/= branches), and retrieved_on (always "today", so it
// would never agree across two different run dates and would defeat the
// no-op guard for genuinely unchanged data).
const REPORT_CONTENT_GUARD_COLUMNS = REPORT_VALUE_COLUMNS.filter(
  (c) => !["reporting_generation", "report_id", "report_version", "retrieved_on"].includes(c),
);

function reportValuesRow(r) {
  const cells = [
    sqlText(r.reporting_generation),
    sqlText(r.report_id),
    sqlInt(r.report_version),
    sqlText(r.same_incident_id),
    sqlText(r.reporting_entity),
    sqlText(r.developer_or_operator),
    sqlText(r.incident_date), // cast to date in the outer SELECT
    sqlText(r.incident_date_precision),
    sqlText(r.report_submission_date), // cast to date in the outer SELECT
    sqlText(r.city),
    sqlText(r.state),
    sqlText(r.country_code),
    sqlText(r.automation_engagement_text),
    sqlText(r.crash_interaction_counterpart_text),
    sqlText(r.subject_vehicle_precrash_movement_text),
    sqlText(r.other_actor_precrash_movement_text),
    sqlText(r.injury_outcome_text),
    sqlText(r.narrative),
    sqlJsonb(r.raw_row),
    sqlText(r.retrieved_on), // cast to date in the outer SELECT
  ];
  return `  (${cells.join(", ")})`;
}

function buildReportUpsertSql(reports) {
  const valuesRows = reports.map(reportValuesRow).join(",\n");

  const selectList = REPORT_VALUE_COLUMNS.map((c) => {
    if (c === "report_version") return `  v.${c}::integer`;
    if (c === "incident_date" || c === "report_submission_date" || c === "retrieved_on") {
      return `  v.${c}::date`;
    }
    if (c === "raw_row") return `  v.${c}::jsonb`;
    return `  v.${c}`;
  }).join(",\n");

  const updateSet = REPORT_VALUE_COLUMNS
    // report_id / reporting_generation are the conflict key, never in SET.
    .filter((c) => c !== "report_id" && c !== "reporting_generation")
    .map((c) => `    ${c} = excluded.${c}`)
    .join(",\n");

  const contentGuard = REPORT_CONTENT_GUARD_COLUMNS
    .map((c) => `nhtsa_report.${c} is distinct from excluded.${c}`)
    .join("\n      or ");

  return `-- ---------------------------------------------------------------------------
-- Step 1 of 4 — nhtsa_report: upsert every latest-version report.
--
-- Conflict target: the table's existing UNIQUE (reporting_generation,
-- report_id) constraint (not partial — a plain named-constraint-style
-- inference works here). incident_candidate_id is NEVER in the SET list, so
-- an existing report -> candidate link always survives this step untouched.
--
-- Update guard: never regress a newer stored report_version to an older
-- incoming one; when the incoming version is newer, always write; when the
-- version is unchanged, write only if mapped content actually differs
-- (retrieved_on excluded from that comparison — it is today's date and would
-- otherwise never match on a later rerun of otherwise-identical data).
-- ---------------------------------------------------------------------------
insert into public.nhtsa_report (
${REPORT_VALUE_COLUMNS.map((c) => `  ${c}`).join(",\n")}
)
select
${selectList}
from (values
${valuesRows}
) as v(${REPORT_VALUE_COLUMNS.join(", ")})
on conflict (reporting_generation, report_id) do update set
${updateSet}
where
  excluded.report_version > nhtsa_report.report_version
  or (
    excluded.report_version = nhtsa_report.report_version
    and (
      ${contentGuard}
    )
  );
`;
}

// ---------------------------------------------------------------------------
// nhtsa_incident_candidate — Step 2 (grouped, non-null Same Incident ID).
// ---------------------------------------------------------------------------

// Mechanical fields refreshed on conflict, ONLY while the candidate is still
// 'pending' (see the generated file's header for why). Deliberately excludes
// system_or_vehicle_text / roadway_scenario_context / environmental_conditions
// (always NULL from this importer — including them in SET would blank out
// any value a curator later filled in) and every curator/AI-owned field
// (proposed_*, dedup_status, possible_duplicate_event_id, status,
// curator_note, linked_event_id, reviewed_by, reviewed_at).
const CANDIDATE_MECHANICAL_REFRESH_COLUMNS = [
  "developer_or_operator", "automation_engagement_text", "incident_date",
  "incident_date_precision", "city", "state", "country_code",
  "crash_interaction_counterpart", "subject_vehicle_precrash_movement",
  "other_actor_precrash_movement", "injury_outcome_text", "narrative",
];

const CANDIDATE_INSERT_COLUMNS = [
  "same_incident_id", "developer_or_operator", "system_or_vehicle_text",
  "automation_engagement_text", "incident_date", "incident_date_precision",
  "city", "state", "country_code", "roadway_scenario_context",
  "environmental_conditions", "crash_interaction_counterpart",
  "subject_vehicle_precrash_movement", "other_actor_precrash_movement",
  "injury_outcome_text", "narrative", "proposed_observed_facts",
  "proposed_scenario_tags", "proposed_interpretation", "proposed_uncertainties",
  "dedup_status", "possible_duplicate_event_id", "status", "curator_note",
  "linked_event_id", "reviewed_by", "reviewed_at",
];

function candidateValuesRow(c) {
  const cells = [
    sqlText(c.same_incident_id),
    sqlText(c.developer_or_operator),
    sqlText(c.system_or_vehicle_text),
    sqlText(c.automation_engagement_text),
    sqlText(c.incident_date),
    sqlText(c.incident_date_precision),
    sqlText(c.city),
    sqlText(c.state),
    sqlText(c.country_code),
    sqlText(c.roadway_scenario_context),
    sqlText(c.environmental_conditions),
    sqlText(c.crash_interaction_counterpart),
    sqlText(c.subject_vehicle_precrash_movement),
    sqlText(c.other_actor_precrash_movement),
    sqlText(c.injury_outcome_text),
    sqlText(c.narrative),
    sqlTextArray(c.proposed_observed_facts),
    sqlTextArray(c.proposed_scenario_tags),
    sqlText(c.proposed_interpretation),
    sqlTextArray(c.proposed_uncertainties),
    sqlText(c.dedup_status),
    sqlText(c.possible_duplicate_event_id), // uuid via text; cast in outer SELECT
    sqlText(c.status),
    sqlText(c.curator_note),
    sqlText(c.linked_event_id), // uuid via text; cast in outer SELECT
    sqlText(c.reviewed_by), // uuid via text; cast in outer SELECT
    sqlText(c.reviewed_at),
  ];
  return `  (${cells.join(", ")})`;
}

function buildGroupedCandidateUpsertSql(grouped) {
  const valuesRows = grouped.map(candidateValuesRow).join(",\n");

  // proposed_observed_facts / proposed_scenario_tags / proposed_uncertainties
  // are not re-cast here: sqlTextArray() already embeds ::text[] on the
  // literal, so the VALUES column is already text[]-typed.
  const selectList = CANDIDATE_INSERT_COLUMNS.map((c) => {
    if (c === "incident_date") return `  v.${c}::date`;
    if (["possible_duplicate_event_id", "linked_event_id", "reviewed_by"].includes(c)) {
      return `  v.${c}::uuid`;
    }
    if (c === "reviewed_at") return `  v.${c}::timestamptz`;
    return `  v.${c}`;
  }).join(",\n");

  const updateSet = CANDIDATE_MECHANICAL_REFRESH_COLUMNS
    .map((c) => `    ${c} = excluded.${c}`)
    .join(",\n");

  const distinctGuard = CANDIDATE_MECHANICAL_REFRESH_COLUMNS
    .map((c) => `nhtsa_incident_candidate.${c} is distinct from excluded.${c}`)
    .join("\n    or ");

  return `-- ---------------------------------------------------------------------------
-- Step 2 of 4 — nhtsa_incident_candidate: upsert candidates grouped by a
-- genuine (non-null) Same Incident ID.
--
-- Conflict target: "on conflict (same_incident_id) where same_incident_id is
-- not null" infers the existing PARTIAL unique index
-- nhtsa_incident_candidate_same_incident_id_unique (created WHERE
-- same_incident_id IS NOT NULL). Postgres requires the ON CONFLICT clause's
-- own WHERE predicate to match an index's predicate for arbiter inference;
-- "ON CONFLICT ON CONSTRAINT" is not usable here because a partial unique
-- index has no associated named table constraint, only the index itself.
-- Every row in this statement has a non-null same_incident_id by
-- construction, so the predicate always holds for these inserts.
--
-- Update guard: mechanical fields refresh ONLY while status = 'pending' —
-- once a curator has moved a candidate off 'pending', this importer freezes
-- its summary fields rather than silently rewriting a record a human has
-- already acted on (the full, ever-growing source detail remains visible via
-- the candidate's linked nhtsa_report rows regardless). curator/AI-owned
-- fields (proposed_*, dedup_status, possible_duplicate_event_id, status,
-- curator_note, linked_event_id, reviewed_by, reviewed_at) are never in the
-- SET list at all, so they survive a rerun unconditionally, including while
-- still 'pending'. curator_note is written ONLY on first insert (capturing
-- this run's disagreement audit, if any); because it is absent from SET, a
-- later human-written curator_note is never overwritten by a rerun.
-- ---------------------------------------------------------------------------
insert into public.nhtsa_incident_candidate (
${CANDIDATE_INSERT_COLUMNS.map((c) => `  ${c}`).join(",\n")}
)
select
${selectList}
from (values
${valuesRows}
) as v(${CANDIDATE_INSERT_COLUMNS.join(", ")})
on conflict (same_incident_id) where same_incident_id is not null
do update set
${updateSet}
where
  nhtsa_incident_candidate.status = 'pending'
  and (
    ${distinctGuard}
  );
`;
}

function buildGroupedLinkSql() {
  return `-- ---------------------------------------------------------------------------
-- Step 3 of 4 — link every report with a non-null Same Incident ID to its
-- candidate. Re-derived from the current table state (not just this run's
-- rows), so it is self-healing on rerun and never links a report to more
-- than one candidate (same_incident_id -> exactly one candidate row, by the
-- partial unique index Step 2 upserts against).
-- ---------------------------------------------------------------------------
update public.nhtsa_report r
set incident_candidate_id = c.id
from public.nhtsa_incident_candidate c
where r.same_incident_id = c.same_incident_id
  and c.same_incident_id is not null
  and r.incident_candidate_id is distinct from c.id;
`;
}

// ---------------------------------------------------------------------------
// nhtsa_incident_candidate — Step 4 (singletons, NULL Same Incident ID).
// ---------------------------------------------------------------------------

function singletonInsertColumnsAndValues(c) {
  const cols = CANDIDATE_INSERT_COLUMNS;
  // sqlTextArray() already embeds its own ::text[] cast on the literal, so
  // array columns are not repeated here (avoids a redundant double cast).
  const casts = {
    incident_date: "::date",
    possible_duplicate_event_id: "::uuid",
    linked_event_id: "::uuid",
    reviewed_by: "::uuid",
    reviewed_at: "::timestamptz",
  };
  const values = {
    same_incident_id: sqlText(null),
    developer_or_operator: sqlText(c.developer_or_operator),
    system_or_vehicle_text: sqlText(c.system_or_vehicle_text),
    automation_engagement_text: sqlText(c.automation_engagement_text),
    incident_date: sqlText(c.incident_date),
    incident_date_precision: sqlText(c.incident_date_precision),
    city: sqlText(c.city),
    state: sqlText(c.state),
    country_code: sqlText(c.country_code),
    roadway_scenario_context: sqlText(c.roadway_scenario_context),
    environmental_conditions: sqlText(c.environmental_conditions),
    crash_interaction_counterpart: sqlText(c.crash_interaction_counterpart),
    subject_vehicle_precrash_movement: sqlText(c.subject_vehicle_precrash_movement),
    other_actor_precrash_movement: sqlText(c.other_actor_precrash_movement),
    injury_outcome_text: sqlText(c.injury_outcome_text),
    narrative: sqlText(c.narrative),
    proposed_observed_facts: sqlTextArray(c.proposed_observed_facts),
    proposed_scenario_tags: sqlTextArray(c.proposed_scenario_tags),
    proposed_interpretation: sqlText(c.proposed_interpretation),
    proposed_uncertainties: sqlTextArray(c.proposed_uncertainties),
    dedup_status: sqlText(c.dedup_status),
    possible_duplicate_event_id: sqlText(c.possible_duplicate_event_id),
    status: sqlText(c.status),
    curator_note: sqlText(c.curator_note),
    linked_event_id: sqlText(c.linked_event_id),
    reviewed_by: sqlText(c.reviewed_by),
    reviewed_at: sqlText(c.reviewed_at),
  };
  const selectList = cols.map((col) => `${values[col]}${casts[col] ?? ""}`);
  return { cols, selectList };
}

function buildSingletonSql(singleton, index, total) {
  const [{ reporting_generation, report_id }] = singleton._contributingReportKeys;
  const gen = sqlText(reporting_generation);
  const rid = sqlText(report_id);
  const { cols, selectList } = singletonInsertColumnsAndValues(singleton);

  const refreshSet = CANDIDATE_MECHANICAL_REFRESH_COLUMNS
    .map((c) => `    ${c} = ${sqlTextOrCast(singleton, c)}`)
    .join(",\n");
  const refreshGuard = CANDIDATE_MECHANICAL_REFRESH_COLUMNS
    .map((c) => `c.${c} is distinct from ${sqlTextOrCast(singleton, c)}`)
    .join("\n    or ");

  const createAndLink = `-- Singleton ${index + 1}/${total} — report ${reporting_generation}/${report_id} (no Same Incident ID).
-- Idempotency anchor: this report's OWN incident_candidate_id, not a value
-- derived from the (absent) Same Incident ID. If the report is not yet
-- linked to any candidate, create exactly one NULL-same_incident_id
-- candidate and link it; if it is already linked (from a prior run), this
-- INSERT's WHERE NOT EXISTS is false, so it inserts nothing and the UPDATE
-- below is a no-op — no second singleton candidate is ever created.
with new_candidate as (
  insert into public.nhtsa_incident_candidate (
${cols.map((c) => `    ${c}`).join(",\n")}
  )
  select
${selectList.map((v) => `    ${v}`).join(",\n")}
  where not exists (
    select 1 from public.nhtsa_report
    where reporting_generation = ${gen} and report_id = ${rid}
      and incident_candidate_id is not null
  )
  returning id
)
update public.nhtsa_report
set incident_candidate_id = (select id from new_candidate)
where reporting_generation = ${gen} and report_id = ${rid}
  and incident_candidate_id is null
  and exists (select 1 from new_candidate);
`;

  const refresh = `-- Refresh ${reporting_generation}/${report_id}'s already-linked singleton
-- candidate, mechanical fields only, only while still 'pending' (same policy
-- as the grouped-candidate update in Step 2).
update public.nhtsa_incident_candidate c
set
${refreshSet}
from public.nhtsa_report r
where r.reporting_generation = ${gen} and r.report_id = ${rid}
  and r.incident_candidate_id = c.id
  and c.status = 'pending'
  and (
    ${refreshGuard}
  );
`;

  return createAndLink + "\n" + refresh;
}

function sqlTextOrCast(candidate, column) {
  const v = candidate[column];
  if (column === "incident_date") return `${sqlText(v)}::date`;
  return sqlText(v);
}

// ---------------------------------------------------------------------------
// Assembly + validation.
// ---------------------------------------------------------------------------

function assertCounts(pipeline) {
  const problems = [];
  const push = (label, actual, expected) => {
    if (actual !== expected) problems.push(`${label}: expected ${expected}, got ${actual}`);
  };
  push("total latest-version reports", pipeline.allReports.length, EXPECT.totalReports);
  push(
    "historical latest-version reports",
    pipeline.perGeneration.historical?.latestVersionCount,
    EXPECT.historicalLatest,
  );
  push(
    "current latest-version reports",
    pipeline.perGeneration.current?.latestVersionCount,
    EXPECT.currentLatest,
  );
  push("grouped candidates", pipeline.grouped.length, EXPECT.grouped);
  push("singleton candidates", pipeline.singletonCandidates.length, EXPECT.singletons);
  push(
    "total candidates",
    pipeline.grouped.length + pipeline.singletonCandidates.length,
    EXPECT.totalCandidates,
  );
  return problems;
}

function buildSql(pipeline) {
  const singletonBlocks = pipeline.singletonCandidates
    .map((c, i) => buildSingletonSql(c, i, pipeline.singletonCandidates.length))
    .join("\n");

  return `-- White Box Autonomy — NHTSA SGO ADS staging import (production-write artifact).
--
-- GENERATED FILE. Source of truth: the CSVs listed in migration/nhtsa/pipeline.mjs,
-- transformed by the reviewed, unchanged pipeline in migration/nhtsa/mapping.mjs.
-- Regenerate with:
--
--     node migration/nhtsa/build-import-sql.mjs --emit
--
-- Do not hand-edit. Re-running the generator against the same two CSV files
-- reproduces byte-identical output (no timestamps embedded except
-- retrieved_on, which is the generator's run date — see below).
--
-- WHAT THIS DOES
--   Populates public.nhtsa_report (3223 rows: 1899 historical + 1324 current
--   latest-version reports) and public.nhtsa_incident_candidate (2843 rows:
--   2831 grouped by a genuine Same Incident ID + 12 NULL-Same-Incident-ID
--   singletons), and links every report to its candidate via
--   nhtsa_report.incident_candidate_id. Nothing else. No event, event_source,
--   or publication-related table is read or written. No promotion, no
--   curator UI, no AI normalization.
--
-- HOW TO RUN IT (against the linked hosted project — CLI login token via the
-- Management API; no database password or service-role key), same mechanism
-- as migration/legacy/import.sql:
--
--     npx supabase db query --linked --file migration/nhtsa/import.sql
--
-- Do NOT run this until it has been reviewed and its counts independently
-- checked against the approved dry run (node migration/nhtsa/import.mjs).
--
-- retrieved_on for every report row in THIS generated file: ${pipeline.retrievedOn}
-- (the date this file was generated — regenerating on a later date changes
-- only this stamp for genuinely new/updated reports, per Step 1's no-op
-- guard below; it never touches an unchanged report's stored retrieved_on).
--
-- ---------------------------------------------------------------------------
-- IDEMPOTENCY / PRESERVATION DESIGN
-- ---------------------------------------------------------------------------
--
-- nhtsa_report (Step 1): upsert on the table's existing UNIQUE
-- (reporting_generation, report_id). incident_candidate_id is never in the
-- SET list — an existing candidate link always survives. A stored
-- report_version is never regressed to an older incoming one; when the
-- version is unchanged, the row is untouched unless mapped content actually
-- differs (a true no-op on an unchanged rerun).
--
-- nhtsa_incident_candidate, grouped by a genuine Same Incident ID (Step 2):
-- upserts against the existing PARTIAL unique index
-- nhtsa_incident_candidate_same_incident_id_unique via
-- "on conflict (same_incident_id) where same_incident_id is not null" — the
-- documented Postgres pattern for inferring a partial unique index as the
-- arbiter ("ON CONFLICT ON CONSTRAINT" cannot be used here: a partial unique
-- index has no associated named constraint). Mechanical fields (developer_or_
-- operator, automation_engagement_text, incident_date/_precision, city,
-- state, country_code, crash_interaction_counterpart, subject_vehicle_
-- precrash_movement, other_actor_precrash_movement, injury_outcome_text,
-- narrative) refresh on conflict ONLY while status = 'pending' — once a
-- curator has moved a candidate off 'pending', this importer freezes its
-- summary so a later NHTSA update can never silently rewrite a record a
-- human has already acted on (the full source history remains visible via
-- the candidate's linked nhtsa_report rows either way). system_or_vehicle_
-- text / roadway_scenario_context / environmental_conditions are NEVER
-- written by an UPDATE (this importer has no source data for them; including
-- them in SET would blank out a value a curator entered later) — only
-- carried as NULL at first insert. Every curator/AI-owned field (proposed_*,
-- dedup_status, possible_duplicate_event_id, status, curator_note,
-- linked_event_id, reviewed_by, reviewed_at) is absent from the UPDATE SET
-- entirely, so it survives a rerun unconditionally.
--
-- curator_note specifically: written ONLY at first insert, carrying this
-- run's mechanical disagreement audit for that candidate (or NULL if its
-- contributing reports agreed on everything). Because curator_note is never
-- in the UPDATE SET list, a later human-written curator_note can never be
-- overwritten by a rerun. Trade-off, accepted deliberately: if a candidate
-- gains a NEW contributing report on a later rerun and that introduces a
-- disagreement that did not exist at first insert, this design does not
-- retroactively append it to curator_note (doing so risks clobbering
-- human-added text with no safe merge rule). That disagreement is still
-- fully visible to a curator via the candidate's own linked nhtsa_report
-- rows and their raw_row content — nothing is lost, just not auto-appended
-- to a human-editable field.
--
-- nhtsa_incident_candidate, singletons with NULL Same Incident ID (Step 4):
-- there is no unique index to conflict against for a NULL key (and Postgres
-- never treats two NULLs as equal), so idempotency is anchored on the
-- CONTRIBUTING REPORT's own incident_candidate_id instead: if that report is
-- already linked to a candidate, this step only refreshes that candidate
-- (same 'pending'-only mechanical-refresh rule as Step 2) and creates
-- nothing; if unlinked, it inserts exactly one new candidate and links it.
-- Implemented as one paired statement per singleton report (12 pairs here)
-- rather than a single multi-row INSERT ... RETURNING, because Postgres does
-- not guarantee RETURNING row order matches a multi-row INSERT ... SELECT's
-- source order — relying on that would risk linking a report to the WRONG
-- newly-created candidate. No identifier is fabricated; ids are the table's
-- own gen_random_uuid() default.
--
-- Step 3 (grouped-candidate linking) and each singleton's link update are
-- re-derived from the CURRENT table state, not just this run's rows, so they
-- are self-healing on rerun and can never leave a report linked to more than
-- one candidate.
-- ---------------------------------------------------------------------------

begin;

${buildReportUpsertSql(pipeline.allReports)}
${buildGroupedCandidateUpsertSql(pipeline.grouped)}
${buildGroupedLinkSql()}
-- ---------------------------------------------------------------------------
-- Step 4 of 4 — singleton candidates (NULL Same Incident ID), ${pipeline.singletonCandidates.length} report(s).
-- One paired (insert-if-needed-and-link / refresh-if-already-linked)
-- statement block per report — see the header above for why this is not a
-- single multi-row INSERT.
-- ---------------------------------------------------------------------------
${singletonBlocks}
commit;
`;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const emit = args.has("--emit");

  const pipeline = runPipeline();
  const problems = assertCounts(pipeline);

  if (problems.length > 0) {
    console.error("COUNT MISMATCH — refusing to generate SQL. Investigate before proceeding:");
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }

  console.log(`Counts confirmed: ${pipeline.allReports.length} reports, ${pipeline.grouped.length + pipeline.singletonCandidates.length} candidates (${pipeline.grouped.length} grouped + ${pipeline.singletonCandidates.length} singleton).`);

  const sql = buildSql(pipeline);
  console.log(`Generated SQL length: ${sql.length.toLocaleString()} bytes.`);

  if (!emit) {
    console.log("DRY RUN — no file written. Re-run with --emit to write migration/nhtsa/import.sql.");
    return;
  }

  writeFileSync(OUT_PATH, sql);
  console.log(`WROTE: ${OUT_PATH}`);
  console.log("Review the file. Do NOT apply it to production or rehearsal without separate explicit approval.");
}

main();

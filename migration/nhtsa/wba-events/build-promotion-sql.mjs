/**
 * NHTSA -> WBA event promotion — production-write SQL artifact generator.
 *
 * Run:
 *   node migration/nhtsa/wba-events/build-promotion-sql.mjs           # dry-run (default): validates counts, writes nothing
 *   node migration/nhtsa/wba-events/build-promotion-sql.mjs --emit    # writes promote.sql and rollback.sql
 *
 * WHAT THIS DOES
 *   Reads a wba-events-dry-run.jsonl produced by generate-dry-run.mjs (WBA's
 *   own production run covered 2,843 records) and turns it into ONE
 *   reviewable SQL file (promote.sql) implementing the whole promotion as a
 *   SINGLE atomic transaction, plus a companion rollback.sql scoped to
 *   exactly the rows that transaction would create. This script never
 *   connects to any database and never executes anything.
 *
 * WHY A LOCAL pg_temp FUNCTION, NOT 2,843 REPEATED DO BLOCKS
 *   Every candidate needs the identical resolve -> classify-state -> act
 *   sequence. Defining that sequence ONCE as a session-scoped
 *   `pg_temp.promote_nhtsa_candidate(...)` function, then invoking it once
 *   per candidate with named parameters, keeps the ~2,843-row artifact
 *   reviewable (the logic is read once; each of the 2,843 lines after it is
 *   just its own data) instead of repeating the same ~40 lines of PL/pgSQL
 *   2,843 times. `pg_temp` functions are session-scoped and vanish
 *   automatically at the end of the `db query --file` session — no manual
 *   DROP FUNCTION is required, and because CREATE FUNCTION is ordinary DDL
 *   in Postgres, it is fully covered by the surrounding BEGIN/COMMIT like
 *   every other statement in this file.
 *
 * STATE CLASSIFICATION (per candidate, inside the function):
 *   STATE A - already promoted AND coherent (linked_event_id set, the linked
 *     event exists with the expected slug and is_public=false, and it has
 *     exactly the expected regulatory-record source set) -> no-op.
 *   STATE B - clean/unpromoted (linked_event_id is null, no event with the
 *     expected slug exists yet, none of the expected external_record_ids are
 *     already attached anywhere) -> create event + sources + link.
 *   STATE C - anything else -> RAISE EXCEPTION, aborting the WHOLE
 *     transaction. No automatic repair is ever attempted.
 *
 * CANDIDATE RESOLUTION
 *   Grouped candidates resolve by `same_incident_id` (unique by the
 *   database's own partial unique index). Singleton candidates
 *   (same_incident_id IS NULL) resolve via their sole contributing report's
 *   `(reporting_generation, report_id)` -> `nhtsa_report.incident_candidate_id`
 *   (report_id is unique only within one generation, hence both parameters).
 *   The function asserts EXACTLY ONE match for every candidate — zero or
 *   more than one both abort the transaction.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { sqlText, sqlDate, sqlTextArray, sqlJsonb } from "../sql-literals.mjs";

export const CANONICAL_NHTSA_URL = "https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting";
export const EXPECTED_CANDIDATE_COUNT = 2843;
export const EXPECTED_REPORT_COUNT = 3223;

const DIR = fileURLToPath(new URL("./", import.meta.url));
const DRY_RUN_PATH = DIR + "wba-events-dry-run.jsonl";
const PROMOTE_SQL_PATH = DIR + "promote.sql";
const ROLLBACK_SQL_PATH = DIR + "rollback.sql";
const REHEARSAL_SQL_PATH = DIR + "rehearse-promotion.sql";
const REHEARSAL_POSTCONDITION_SQL_PATH = DIR + "rehearse-promotion-postcondition.sql";

export function loadDryRunRecords(path = DRY_RUN_PATH) {
  const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

/** Split "generation:report_id" on the FIRST colon only, exactly reversing
 * how map-candidate-to-event.mjs's mapReportToEventSource() built it — safe
 * even if a report_id itself ever contained a colon. */
function splitExternalRecordId(externalRecordId) {
  const idx = externalRecordId.indexOf(":");
  return { generation: externalRecordId.slice(0, idx), reportId: externalRecordId.slice(idx + 1) };
}

/**
 * Total expected regulatory-record sources across the whole batch — used by
 * the postcondition assertions.
 */
export function totalExpectedSourceCount(records) {
  return records.reduce((n, r) => n + r.eventSources.length, 0);
}

// ---------------------------------------------------------------------------
// SQL fragment builders — each independently unit-testable.
// ---------------------------------------------------------------------------

export function renderPreconditionBlock() {
  return `-- ---------------------------------------------------------------------------
-- PRECONDITION ASSERTIONS
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.nhtsa_incident_candidate) != ${EXPECTED_CANDIDATE_COUNT} then
    raise exception 'precondition failed: expected % nhtsa_incident_candidate rows, found %',
      ${EXPECTED_CANDIDATE_COUNT}, (select count(*) from public.nhtsa_incident_candidate);
  end if;
  if (select count(*) from public.nhtsa_report) != ${EXPECTED_REPORT_COUNT} then
    raise exception 'precondition failed: expected % nhtsa_report rows, found %',
      ${EXPECTED_REPORT_COUNT}, (select count(*) from public.nhtsa_report);
  end if;
end;
$$;
`;
}

/**
 * The single reusable resolve -> classify -> act function, defined once as
 * `pg_temp.promote_nhtsa_candidate`. Session-scoped: no explicit DROP
 * FUNCTION is needed or included.
 */
export function renderFunctionDefinition() {
  return `-- ---------------------------------------------------------------------------
-- Reusable per-candidate promotion function (session-scoped, pg_temp).
-- ---------------------------------------------------------------------------
create function pg_temp.promote_nhtsa_candidate(
  p_same_incident_id text,
  p_singleton_generation text,
  p_singleton_report_id text,
  p_slug text,
  p_occurred_on date,
  p_occurred_on_precision text,
  p_location_text text,
  p_location_country_code text,
  p_location_precision text,
  p_developer_or_operator text,
  p_automation_status text,
  p_event_type text,
  p_valence text,
  p_observed_facts text[],
  p_unknowns text[],
  p_causation_status text,
  p_causation_note text,
  p_scenario_tags text[],
  p_record_updated date,
  p_sources jsonb
) returns void
language plpgsql
as $fn$
declare
  v_candidate_id uuid;
  v_match_count int;
  v_linked_event_id uuid;
  v_expected_source_count int := jsonb_array_length(p_sources);
  v_expected_external_ids text[];
  v_actual_source_count int;
  v_missing_ids text[];
  v_event_id uuid;
  v_candidate_label text := coalesce(p_same_incident_id, p_singleton_generation || ':' || p_singleton_report_id);
begin
  -- Resolve the real nhtsa_incident_candidate row. Exactly one match required.
  -- Two-step by design (count, then assert, then fetch): the invariant being
  -- checked is "exactly one row exists", not "take the maximum id" — a
  -- combined count(*)+max(id) query is also invalid PostgreSQL for a
  -- uuid column (no built-in max(uuid) aggregate exists), confirmed by a
  -- production rehearsal execution error.
  if p_same_incident_id is not null then
    select count(*) into v_match_count
      from public.nhtsa_incident_candidate
      where same_incident_id = p_same_incident_id;
    if v_match_count <> 1 then
      raise exception 'candidate resolution failed for %: % matches (expected exactly 1)', v_candidate_label, v_match_count;
    end if;
    select id into v_candidate_id
      from public.nhtsa_incident_candidate
      where same_incident_id = p_same_incident_id
      limit 1;
  else
    select count(*) into v_match_count
      from public.nhtsa_report
      where reporting_generation = p_singleton_generation
        and report_id = p_singleton_report_id;
    if v_match_count <> 1 then
      raise exception 'candidate resolution failed for %: % matches (expected exactly 1)', v_candidate_label, v_match_count;
    end if;
    select incident_candidate_id into v_candidate_id
      from public.nhtsa_report
      where reporting_generation = p_singleton_generation
        and report_id = p_singleton_report_id
      limit 1;
    if v_candidate_id is null then
      raise exception 'candidate resolution failed for %: matched report has no incident_candidate_id', v_candidate_label;
    end if;
  end if;

  select array_agg(elem->>'external_record_id') into v_expected_external_ids
    from jsonb_array_elements(p_sources) elem;

  select linked_event_id into v_linked_event_id
    from public.nhtsa_incident_candidate where id = v_candidate_id;

  if v_linked_event_id is null then
    -- STATE B expected: clean/unpromoted. Verify no conflicting residue exists.
    if exists (select 1 from public.event where slug = p_slug) then
      raise exception 'inconsistent state (candidate %, STATE C): linked_event_id is null but slug % already exists', v_candidate_label, p_slug;
    end if;
    if exists (select 1 from public.event_source where external_record_id = any(v_expected_external_ids)) then
      raise exception 'inconsistent state (candidate %, STATE C): an expected external_record_id is already attached elsewhere', v_candidate_label;
    end if;

    insert into public.event (
      slug, title, summary, occurred_on, occurred_on_precision, location_text, location_country_code,
      developer_or_operator, system_name, automation_status, system_version, system_version_knowledge,
      event_type, valence, observed_facts, unknowns, interpretation, causation_status, causation_note,
      review_status, location_precision, scenario_tags, record_updated, is_public
    ) values (
      p_slug, null, null, p_occurred_on, p_occurred_on_precision, p_location_text, p_location_country_code,
      p_developer_or_operator, null, p_automation_status, null, 'unknown',
      p_event_type, p_valence, p_observed_facts, p_unknowns, null, p_causation_status, p_causation_note,
      null, p_location_precision, p_scenario_tags, p_record_updated, false
    ) returning id into v_event_id;

    insert into public.event_source (
      event_id, url, source_type, external_record_id, publisher, label,
      published_on, published_on_precision, retrieved_on, note
    )
    select
      v_event_id,
      elem->>'url',
      elem->>'source_type',
      elem->>'external_record_id',
      elem->>'publisher',
      elem->>'label',
      nullif(elem->>'published_on', '')::date,
      elem->>'published_on_precision',
      nullif(elem->>'retrieved_on', '')::date,
      elem->>'note'
    from jsonb_array_elements(p_sources) elem;

    update public.nhtsa_incident_candidate set linked_event_id = v_event_id where id = v_candidate_id;

  else
    -- STATE A expected: already promoted and coherent. Verify, never repair.
    if not exists (
      select 1 from public.event where id = v_linked_event_id and slug = p_slug and is_public = false
    ) then
      raise exception 'inconsistent state (candidate %, STATE C): linked event % does not match expected slug/private state', v_candidate_label, v_linked_event_id;
    end if;

    select count(*) into v_actual_source_count
      from public.event_source
      where event_id = v_linked_event_id and source_type = 'regulatory-record';
    if v_actual_source_count != v_expected_source_count then
      raise exception 'inconsistent state (candidate %, STATE C): expected % regulatory-record sources, found %', v_candidate_label, v_expected_source_count, v_actual_source_count;
    end if;

    select array_agg(x) into v_missing_ids
      from unnest(v_expected_external_ids) x
      where x not in (select external_record_id from public.event_source where event_id = v_linked_event_id);
    if v_missing_ids is not null then
      raise exception 'inconsistent state (candidate %, STATE C): missing expected external_record_id(s): %', v_candidate_label, v_missing_ids;
    end if;
    -- Coherent no-op: nothing to do.
  end if;
end;
$fn$;
`;
}

/** One `select pg_temp.promote_nhtsa_candidate(...)` call for one dry-run record. */
export function renderCandidateCall(record, canonicalUrl) {
  const { event, eventSources, sameIncidentId } = record;
  let singletonGeneration = "null";
  let singletonReportId = "null";
  const sameIncidentIdLiteral = sameIncidentId === null ? "null" : sqlText(sameIncidentId);
  if (sameIncidentId === null) {
    const { generation, reportId } = splitExternalRecordId(eventSources[0].external_record_id);
    singletonGeneration = sqlText(generation);
    singletonReportId = sqlText(reportId);
  }

  const sourcesJson = eventSources.map((s) => ({ ...s, url: canonicalUrl }));

  return `select pg_temp.promote_nhtsa_candidate(
  p_same_incident_id := ${sameIncidentIdLiteral},
  p_singleton_generation := ${singletonGeneration},
  p_singleton_report_id := ${singletonReportId},
  p_slug := ${sqlText(event.slug)},
  p_occurred_on := ${sqlDate(event.occurred_on)},
  p_occurred_on_precision := ${sqlText(event.occurred_on_precision)},
  p_location_text := ${sqlText(event.location_text)},
  p_location_country_code := ${sqlText(event.location_country_code)},
  p_location_precision := ${sqlText(event.location_precision)},
  p_developer_or_operator := ${sqlText(event.developer_or_operator)},
  p_automation_status := ${sqlText(event.automation_status)},
  p_event_type := ${sqlText(event.event_type)},
  p_valence := ${sqlText(event.valence)},
  p_observed_facts := ${sqlTextArray(event.observed_facts)},
  p_unknowns := ${sqlTextArray(event.unknowns)},
  p_causation_status := ${sqlText(event.causation_status)},
  p_causation_note := ${sqlText(event.causation_note)},
  p_scenario_tags := ${sqlTextArray(event.scenario_tags)},
  p_record_updated := ${sqlDate(event.record_updated)},
  p_sources := ${sqlJsonb(sourcesJson)}
);`;
}

export function renderPostconditionBlock(records, canonicalUrl) {
  const expectedEventCount = records.length;
  const expectedSourceCount = totalExpectedSourceCount(records);
  return `-- ---------------------------------------------------------------------------
-- POSTCONDITION ASSERTIONS
-- ---------------------------------------------------------------------------
do $$
declare
  v_linked_count int;
  v_slug_count int;
  v_source_count int;
begin
  select count(*) into v_linked_count from public.nhtsa_incident_candidate where linked_event_id is not null;
  if v_linked_count != ${expectedEventCount} then
    raise exception 'postcondition failed: expected % linked candidates, found %', ${expectedEventCount}, v_linked_count;
  end if;

  select count(*) into v_slug_count from public.event where slug like 'nhtsa-%';
  if v_slug_count != ${expectedEventCount} then
    -- Literal '%' in "nhtsa-%%" is escaped for RAISE's own format-string
    -- parser (which treats every unescaped '%' as a positional placeholder,
    -- distinct from the ORDINARY SQL LIKE PATTERN 'nhtsa-%' just above,
    -- which is untouched) — found by a production rehearsal execution error.
    raise exception 'postcondition failed: expected % nhtsa-%% event slugs, found %', ${expectedEventCount}, v_slug_count;
  end if;

  select count(*) into v_source_count from public.event_source where source_type = 'regulatory-record';
  if v_source_count != ${expectedSourceCount} then
    raise exception 'postcondition failed: expected % regulatory-record sources, found %', ${expectedSourceCount}, v_source_count;
  end if;

  if exists (select 1 from public.event where slug like 'nhtsa-%' and is_public = true) then
    raise exception 'postcondition failed: at least one nhtsa-%% event is public';
  end if;

  if exists (select 1 from public.event_source where source_type = 'regulatory-record' and external_record_id is null) then
    raise exception 'postcondition failed: at least one regulatory-record source has a null external_record_id';
  end if;

  if exists (select 1 from public.event_source where source_type = 'regulatory-record' and url is distinct from ${sqlText(canonicalUrl)}) then
    raise exception 'postcondition failed: at least one regulatory-record source does not use the approved canonical NHTSA URL';
  end if;

  if exists (
    select 1 from public.nhtsa_incident_candidate c
    where c.linked_event_id is not null
      and not exists (select 1 from public.event e where e.id = c.linked_event_id)
  ) then
    raise exception 'postcondition failed: at least one candidate linked_event_id points to a missing event';
  end if;

  if exists (
    select linked_event_id from public.nhtsa_incident_candidate
    where linked_event_id is not null
    group by linked_event_id having count(*) > 1
  ) then
    raise exception 'postcondition failed: at least one event is linked from more than one candidate';
  end if;
end;
$$;
`;
}

export function buildPromotionSql(records, canonicalUrl = CANONICAL_NHTSA_URL) {
  const header = `-- White Box Autonomy — NHTSA -> WBA event promotion (production-write artifact).
--
-- GENERATED FILE. Source of truth: the wba-events-dry-run.jsonl produced by
-- migration/nhtsa/wba-events/generate-dry-run.mjs, transformed by
-- migration/nhtsa/wba-events/build-promotion-sql.mjs. Do not hand-edit.
-- Regenerate with:
--
--     node migration/nhtsa/wba-events/build-promotion-sql.mjs --emit
--
-- WHAT THIS DOES
--   Promotes all ${records.length} normalized NHTSA candidates into private
--   (is_public = false) public.event rows, one event_source row per
--   contributing NHTSA report (${totalExpectedSourceCount(records)} total),
--   and links each public.nhtsa_incident_candidate.linked_event_id. Every
--   row it can touch is identified by natural/deterministic keys resolved
--   INSIDE this SQL, not by UUIDs baked in ahead of time. Runs as ONE
--   transaction: either all ${records.length} candidates end up promoted, or
--   nothing commits. nhtsa_incident_candidate.status is never modified.
--
-- HOW TO APPLY (against the linked hosted project — CLI login token via the
-- Management API; no database password or service-role key), same mechanism
-- as migration/nhtsa/import.sql:
--
--     npx supabase db query --linked --file migration/nhtsa/wba-events/promote.sql
--
-- Do NOT run this until it has been reviewed and rehearsed locally.
--
-- Canonical NHTSA source URL used for every event_source row:
--   ${canonicalUrl}
--
-- Rollback: migration/nhtsa/wba-events/rollback.sql (generated alongside
-- this file, scoped to the exact ${records.length} deterministic slugs
-- below — never a LIKE pattern).
-- ---------------------------------------------------------------------------

begin;

${renderPreconditionBlock(records)}
${renderFunctionDefinition()}
-- ---------------------------------------------------------------------------
-- ${records.length} promotion calls, one per normalized NHTSA candidate.
-- ---------------------------------------------------------------------------
${records.map((r) => renderCandidateCall(r, canonicalUrl)).join("\n")}

${renderPostconditionBlock(records, canonicalUrl)}
commit;
`;
  return header;
}

export function buildRollbackSql(records) {
  const slugs = records.map((r) => r.event.slug);
  const slugList = slugs.map(sqlText).join(",\n  ");
  return `-- White Box Autonomy — NHTSA -> WBA event promotion ROLLBACK (production-write artifact).
--
-- GENERATED FILE. Scoped to EXACTLY the ${records.length} deterministic event
-- slugs promote.sql could have created — never a 'nhtsa-%' LIKE pattern, so
-- this cannot touch any event this specific import did not itself create,
-- even if some other future feature also happens to use an 'nhtsa-' slug
-- prefix. Regenerate alongside promote.sql:
--
--     node migration/nhtsa/wba-events/build-promotion-sql.mjs --emit
--
-- WHAT THIS DOES
--   Deletes exactly the event rows below. event_source rows cascade
--   automatically (event_source.event_id references event(id) on delete
--   cascade). nhtsa_incident_candidate.linked_event_id for any candidate
--   pointing at one of these events is set back to NULL automatically
--   (nhtsa_incident_candidate.linked_event_id references event(id) on
--   delete set null) — no separate UPDATE statement is needed or included.
--   nhtsa_incident_candidate.status is never touched (this import never set
--   it, so there is nothing to restore). Runs as one transaction with a
--   postcondition assertion that all ${records.length} are gone and no
--   dangling links remain.
--
-- HOW TO APPLY:
--
--     npx supabase db query --linked --file migration/nhtsa/wba-events/rollback.sql
--
-- Do NOT run unless a promotion actually needs to be reverted.
-- ---------------------------------------------------------------------------

begin;

delete from public.event where slug in (
  ${slugList}
);

do $$
declare
  v_remaining_events int;
  v_dangling_links int;
begin
  select count(*) into v_remaining_events from public.event where slug in (
    ${slugList}
  );
  if v_remaining_events != 0 then
    raise exception 'rollback postcondition failed: % of the % expected events still exist', v_remaining_events, ${records.length};
  end if;

  select count(*) into v_dangling_links
    from public.nhtsa_incident_candidate c
    where c.linked_event_id is not null
      and not exists (select 1 from public.event e where e.id = c.linked_event_id);
  if v_dangling_links != 0 then
    raise exception 'rollback postcondition failed: % candidate(s) have a dangling linked_event_id', v_dangling_links;
  end if;
end;
$$;

commit;
`;
}

// ---------------------------------------------------------------------------
// Rehearsal artifact — a tiny, ROLLBACK-only transaction exercising the
// SAME pg_temp.promote_nhtsa_candidate function/logic that promote.sql uses,
// against a small, named subset of real candidates. Never commits.
// ---------------------------------------------------------------------------

/** Resolve one record's real-candidate lookup as a scalar SQL subquery —
 * the exact same resolution shape used inside the function itself, reused
 * here (not reimplemented differently) so the baseline/verification
 * assertions check the same row the function would act on. */
function candidateLookupExpr(record) {
  if (record.sameIncidentId !== null) {
    return `(select id from public.nhtsa_incident_candidate where same_incident_id = ${sqlText(record.sameIncidentId)})`;
  }
  const [generation, reportId] = (() => {
    const ext = record.eventSources[0].external_record_id;
    const idx = ext.indexOf(":");
    return [ext.slice(0, idx), ext.slice(idx + 1)];
  })();
  return `(select incident_candidate_id from public.nhtsa_report where reporting_generation = ${sqlText(generation)} and report_id = ${sqlText(reportId)})`;
}

export function renderRehearsalBaselineBlock(records) {
  const perCandidate = records
    .map((r, i) => {
      const label = `rehearsal candidate ${i + 1} (${r.sameIncidentId ?? "singleton:" + r.eventSources[0].external_record_id})`;
      const lookup = candidateLookupExpr(r);
      const externalIds = r.eventSources.map((s) => sqlText(s.external_record_id)).join(", ");
      return `  -- ${label}
  select id, status, linked_event_id into v_candidate_id, v_status_before, v_linked_before
    from public.nhtsa_incident_candidate where id = ${lookup};
  if v_candidate_id is null then
    raise exception 'rehearsal baseline failed: % did not resolve to exactly one real candidate', ${sqlText(label)};
  end if;
  if v_linked_before is not null then
    raise exception 'rehearsal baseline failed: % is not clean — linked_event_id already set to %', ${sqlText(label)}, v_linked_before;
  end if;
  if exists (select 1 from public.event where slug = ${sqlText(r.event.slug)}) then
    raise exception 'rehearsal baseline failed: % — an event with slug % already exists', ${sqlText(label)}, ${sqlText(r.event.slug)};
  end if;
  if exists (select 1 from public.event_source where external_record_id in (${externalIds})) then
    raise exception 'rehearsal baseline failed: % — a conflicting external_record_id already exists', ${sqlText(label)};
  end if;
  insert into pg_temp.rehearsal_status_before (candidate_id, status_before) values (v_candidate_id, v_status_before);`;
    })
    .join("\n\n");

  return `-- ---------------------------------------------------------------------------
-- REHEARSAL BASELINE ASSERTIONS (3 named candidates only)
-- ---------------------------------------------------------------------------
create temporary table pg_temp.rehearsal_status_before (candidate_id uuid primary key, status_before text);

do $$
declare
  v_candidate_id uuid;
  v_status_before text;
  v_linked_before uuid;
begin
${perCandidate}
end;
$$;
`;
}

export function renderRehearsalVerificationBlock(records, canonicalUrl) {
  const perCandidate = records
    .map((r, i) => {
      const label = `rehearsal candidate ${i + 1} (${r.sameIncidentId ?? "singleton:" + r.eventSources[0].external_record_id})`;
      const lookup = candidateLookupExpr(r);
      const expectedSourceCount = r.eventSources.length;
      const externalIds = r.eventSources.map((s) => sqlText(s.external_record_id)).join(", ");
      return `  -- ${label}
  select linked_event_id into v_linked_after from public.nhtsa_incident_candidate where id = ${lookup};
  if v_linked_after is null then
    raise exception 'rehearsal verification failed: % — linked_event_id was not populated', ${sqlText(label)};
  end if;
  if not exists (select 1 from public.event where id = v_linked_after and slug = ${sqlText(r.event.slug)} and is_public = false) then
    raise exception 'rehearsal verification failed: % — linked event does not match expected slug/private state', ${sqlText(label)};
  end if;
  select count(*) into v_source_count from public.event_source
    where event_id = v_linked_after and source_type = 'regulatory-record';
  if v_source_count != ${expectedSourceCount} then
    raise exception 'rehearsal verification failed: % — expected % regulatory-record sources, found %', ${sqlText(label)}, ${expectedSourceCount}, v_source_count;
  end if;
  if exists (
    select 1 from unnest(array[${externalIds}]) x
    where x not in (select external_record_id from public.event_source where event_id = v_linked_after)
  ) then
    raise exception 'rehearsal verification failed: % — missing expected external_record_id(s)', ${sqlText(label)};
  end if;
  if exists (
    select 1 from public.event_source where event_id = v_linked_after and url is distinct from ${sqlText(canonicalUrl)}
  ) then
    raise exception 'rehearsal verification failed: % — a source does not use the canonical NHTSA URL', ${sqlText(label)};
  end if;
  select status into v_status_after from public.nhtsa_incident_candidate where id = ${lookup};
  select status_before into v_status_before from pg_temp.rehearsal_status_before where candidate_id = ${lookup};
  if v_status_after is distinct from v_status_before then
    raise exception 'rehearsal verification failed: % — candidate.status changed from % to %', ${sqlText(label)}, v_status_before, v_status_after;
  end if;`;
    })
    .join("\n\n");

  return `-- ---------------------------------------------------------------------------
-- REHEARSAL VERIFICATION ASSERTIONS (still inside the transaction)
-- ---------------------------------------------------------------------------
do $$
declare
  v_linked_after uuid;
  v_source_count int;
  v_status_before text;
  v_status_after text;
begin
${perCandidate}
end;
$$;

-- Aggregate check: exactly 3 events / 3 candidates linked as a result of this rehearsal.
do $$
declare
  v_event_count int;
begin
  select count(*) into v_event_count from public.event where slug in (${records.map((r) => sqlText(r.event.slug)).join(", ")});
  if v_event_count != ${records.length} then
    raise exception 'rehearsal verification failed: expected % rehearsal events, found %', ${records.length}, v_event_count;
  end if;
end;
$$;

-- Diagnostic summary (visible in the query tool's output before ROLLBACK undoes everything).
select
  c.same_incident_id,
  e.slug,
  e.is_public,
  e.location_precision,
  e.event_type,
  e.valence,
  e.automation_status,
  e.causation_status,
  (select count(*) from public.event_source s where s.event_id = e.id and s.source_type = 'regulatory-record') as regulatory_record_source_count,
  c.status as candidate_status
from public.nhtsa_incident_candidate c
join public.event e on e.id = c.linked_event_id
where e.slug in (${records.map((r) => sqlText(r.event.slug)).join(", ")})
order by e.slug;
`;
}

/**
 * The three rehearsal candidates, fixed and documented — not a fresh
 * semantic review, just identifying which already-known mechanical shape
 * each one exercises:
 *   1. 69dbcb440688427 — ordinary grouped candidate, ONE contributing report
 *      (already used in the prior mapping-fidelity spot check).
 *   2. d9ef2eb5a3957bb — grouped candidate with TWO contributing reports
 *      (the GM/Cruise duplicate-filer case; already used in the prior
 *      mapping-fidelity spot check and extensively documented from the
 *      stress test).
 *   3. historical:33175-9303 — a SINGLETON candidate (same_incident_id IS
 *      NULL). No singleton exists anywhere in the 96 previously
 *      mapping-fidelity-reviewed cases (confirmed by direct check), so this
 *      one is selected purely mechanically: the first singleton encountered
 *      in wba-events-dry-run.jsonl's own file order. Not semantically
 *      re-reviewed.
 */
export const REHEARSAL_SAME_INCIDENT_IDS = ["69dbcb440688427", "d9ef2eb5a3957bb"];
export const REHEARSAL_SINGLETON_EXTERNAL_RECORD_ID = "historical:33175-9303";

export function selectRehearsalRecords(records) {
  const selected = [];
  for (const id of REHEARSAL_SAME_INCIDENT_IDS) {
    const r = records.find((rec) => rec.sameIncidentId === id);
    if (!r) throw new Error(`rehearsal selection failed: same_incident_id ${id} not found in dry-run records`);
    selected.push(r);
  }
  const singleton = records.find(
    (rec) => rec.sameIncidentId === null && rec.eventSources[0].external_record_id === REHEARSAL_SINGLETON_EXTERNAL_RECORD_ID,
  );
  if (!singleton) throw new Error(`rehearsal selection failed: singleton ${REHEARSAL_SINGLETON_EXTERNAL_RECORD_ID} not found in dry-run records`);
  selected.push(singleton);
  return selected;
}

export function buildRehearsalSql(records, canonicalUrl = CANONICAL_NHTSA_URL) {
  return `-- White Box Autonomy — NHTSA -> WBA event promotion REHEARSAL (execution/compatibility test).
--
-- GENERATED FILE. Reuses the EXACT SAME pg_temp.promote_nhtsa_candidate
-- function body that promote.sql defines (see renderFunctionDefinition() in
-- build-promotion-sql.mjs — this is not an independently rewritten copy of
-- the promotion logic). Regenerate with:
--
--     node migration/nhtsa/wba-events/build-promotion-sql.mjs --rehearsal --emit
--
-- WHAT THIS DOES
--   Promotes EXACTLY ${records.length} named, already-clean candidates inside
--   ONE transaction that ALWAYS ENDS IN ROLLBACK — this is an
--   execution/compatibility test of the PL/pgSQL itself, never a real write.
--   Rehearsal candidates:
${records.map((r, i) => `--     ${i + 1}. ${r.sameIncidentId ?? "singleton:" + r.eventSources[0].external_record_id} (slug ${r.event.slug}, ${r.eventSources.length} source(s))`).join("\n")}
--
-- HOW TO APPLY (read-only in effect — ends in ROLLBACK):
--
--     npx supabase db query --linked --file migration/nhtsa/wba-events/rehearse-promotion.sql
--
-- If PostgreSQL reports any error at all, the whole rehearsal aborts and
-- rolls back automatically; nothing needs to be undone by hand.
-- ---------------------------------------------------------------------------

begin;

${renderRehearsalBaselineBlock(records)}
${renderFunctionDefinition()}
-- ---------------------------------------------------------------------------
-- ${records.length} rehearsal promotion calls.
-- ---------------------------------------------------------------------------
${records.map((r) => renderCandidateCall(r, canonicalUrl)).join("\n")}

${renderRehearsalVerificationBlock(records, canonicalUrl)}
rollback;
`;
}

/**
 * Coverage-gap fix: `buildRehearsalSql()` above validates the shared
 * function/candidate-resolution logic using its OWN
 * `renderRehearsalVerificationBlock()` — never the real
 * `renderPostconditionBlock()` promote.sql actually uses. That gap is
 * exactly why a `RAISE` format-string bug isolated to
 * `renderPostconditionBlock()` (the escaped-'%' fix above) was invisible to
 * the first rehearsal. This second rehearsal closes that gap by calling
 * `renderPostconditionBlock()` DIRECTLY, unmodified — not an independently
 * rewritten copy — adapted to this small batch simply by passing it the same
 * 3-record array (`expectedEventCount`/`expectedSourceCount` are derived
 * from `records.length`/`totalExpectedSourceCount(records)` exactly as they
 * are for the real 2,843-candidate run).
 */
export function buildPostconditionRehearsalSql(records, canonicalUrl = CANONICAL_NHTSA_URL) {
  return `-- White Box Autonomy — NHTSA -> WBA event promotion POSTCONDITION REHEARSAL.
--
-- GENERATED FILE. Reuses the EXACT SAME pg_temp.promote_nhtsa_candidate
-- function body AND the EXACT SAME renderPostconditionBlock() logic that
-- promote.sql itself uses (build-promotion-sql.mjs) — neither is an
-- independently rewritten copy. Purpose: exercise the real postcondition
-- block's RAISE statements against a real PostgreSQL compiler/executor,
-- which the first rehearsal (rehearse-promotion.sql, using its own separate
-- per-candidate verification block) never did. Regenerate with:
--
--     node migration/nhtsa/wba-events/build-promotion-sql.mjs --rehearsal-postcondition --emit
--
-- WHAT THIS DOES
--   Promotes EXACTLY ${records.length} named, already-clean candidates, then runs
--   promote.sql's OWN postcondition block (adapted only by expected-count
--   substitution, not rewritten) inside ONE transaction that ALWAYS ENDS IN
--   ROLLBACK. Rehearsal candidates:
${records.map((r, i) => `--     ${i + 1}. ${r.sameIncidentId ?? "singleton:" + r.eventSources[0].external_record_id} (slug ${r.event.slug}, ${r.eventSources.length} source(s))`).join("\n")}
--
-- HOW TO APPLY (read-only in effect — ends in ROLLBACK):
--
--     npx supabase db query --linked --file migration/nhtsa/wba-events/rehearse-promotion-postcondition.sql
--
-- If PostgreSQL reports any error at all, the whole rehearsal aborts and
-- rolls back automatically; nothing needs to be undone by hand.
-- ---------------------------------------------------------------------------

begin;

${renderRehearsalBaselineBlock(records)}
${renderFunctionDefinition()}
-- ---------------------------------------------------------------------------
-- ${records.length} rehearsal promotion calls.
-- ---------------------------------------------------------------------------
${records.map((r) => renderCandidateCall(r, canonicalUrl)).join("\n")}

${renderPostconditionBlock(records, canonicalUrl)}
rollback;
`;
}

function main() {
  const emit = process.argv.includes("--emit");
  const rehearsalOnly = process.argv.includes("--rehearsal");
  const rehearsalPostconditionOnly = process.argv.includes("--rehearsal-postcondition");
  const records = loadDryRunRecords();

  if (records.length !== EXPECTED_CANDIDATE_COUNT) {
    console.error(`ABORT: expected ${EXPECTED_CANDIDATE_COUNT} dry-run records, found ${records.length}.`);
    process.exitCode = 1;
    return;
  }
  const sourceCount = totalExpectedSourceCount(records);
  if (sourceCount !== EXPECTED_REPORT_COUNT) {
    console.error(`ABORT: expected ${EXPECTED_REPORT_COUNT} total event_source rows, found ${sourceCount}.`);
    process.exitCode = 1;
    return;
  }

  if (rehearsalPostconditionOnly) {
    const rehearsalRecords = selectRehearsalRecords(records);
    const sql = buildPostconditionRehearsalSql(rehearsalRecords);
    console.log(`Postcondition rehearsal: ${rehearsalRecords.length} candidates (${rehearsalRecords.map((r) => r.event.slug).join(", ")}).`);
    if (emit) {
      writeFileSync(REHEARSAL_POSTCONDITION_SQL_PATH, sql);
      console.log(`Wrote ${REHEARSAL_POSTCONDITION_SQL_PATH}`);
    } else {
      console.log("Dry run only. Pass --rehearsal-postcondition --emit to write rehearse-promotion-postcondition.sql.");
    }
    return;
  }

  if (rehearsalOnly) {
    const rehearsalRecords = selectRehearsalRecords(records);
    const rehearsalSql = buildRehearsalSql(rehearsalRecords);
    console.log(`Rehearsal: ${rehearsalRecords.length} candidates (${rehearsalRecords.map((r) => r.event.slug).join(", ")}).`);
    if (emit) {
      writeFileSync(REHEARSAL_SQL_PATH, rehearsalSql);
      console.log(`Wrote ${REHEARSAL_SQL_PATH}`);
    } else {
      console.log("Dry run only. Pass --rehearsal --emit to write rehearse-promotion.sql.");
    }
    return;
  }

  const promoteSql = buildPromotionSql(records);
  const rollbackSql = buildRollbackSql(records);

  console.log(`${records.length} candidates, ${sourceCount} sources. Generated SQL is ${(promoteSql.length / 1024).toFixed(0)} KiB (promote) / ${(rollbackSql.length / 1024).toFixed(0)} KiB (rollback).`);

  if (emit) {
    writeFileSync(PROMOTE_SQL_PATH, promoteSql);
    writeFileSync(ROLLBACK_SQL_PATH, rollbackSql);
    console.log(`Wrote ${PROMOTE_SQL_PATH}`);
    console.log(`Wrote ${ROLLBACK_SQL_PATH}`);
  } else {
    console.log("Dry run only (counts validated). Pass --emit to write promote.sql / rollback.sql.");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

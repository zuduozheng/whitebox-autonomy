-- White Box Autonomy — NHTSA -> WBA event promotion POSTCONDITION REHEARSAL.
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
--   Promotes EXACTLY 3 named, already-clean candidates, then runs
--   promote.sql's OWN postcondition block (adapted only by expected-count
--   substitution, not rewritten) inside ONE transaction that ALWAYS ENDS IN
--   ROLLBACK. Rehearsal candidates:
--     1. 69dbcb440688427 (slug nhtsa-e897f33e, 1 source(s))
--     2. d9ef2eb5a3957bb (slug nhtsa-2156118b, 2 source(s))
--     3. singleton:historical:33175-9303 (slug nhtsa-228aeadf, 1 source(s))
--
-- HOW TO APPLY (read-only in effect — ends in ROLLBACK):
--
--     npx supabase db query --linked --file migration/nhtsa/wba-events/rehearse-promotion-postcondition.sql
--
-- If PostgreSQL reports any error at all, the whole rehearsal aborts and
-- rolls back automatically; nothing needs to be undone by hand.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- REHEARSAL BASELINE ASSERTIONS (3 named candidates only)
-- ---------------------------------------------------------------------------
create temporary table pg_temp.rehearsal_status_before (candidate_id uuid primary key, status_before text);

do $$
declare
  v_candidate_id uuid;
  v_status_before text;
  v_linked_before uuid;
begin
  -- rehearsal candidate 1 (69dbcb440688427)
  select id, status, linked_event_id into v_candidate_id, v_status_before, v_linked_before
    from public.nhtsa_incident_candidate where id = (select id from public.nhtsa_incident_candidate where same_incident_id = '69dbcb440688427');
  if v_candidate_id is null then
    raise exception 'rehearsal baseline failed: % did not resolve to exactly one real candidate', 'rehearsal candidate 1 (69dbcb440688427)';
  end if;
  if v_linked_before is not null then
    raise exception 'rehearsal baseline failed: % is not clean — linked_event_id already set to %', 'rehearsal candidate 1 (69dbcb440688427)', v_linked_before;
  end if;
  if exists (select 1 from public.event where slug = 'nhtsa-e897f33e') then
    raise exception 'rehearsal baseline failed: % — an event with slug % already exists', 'rehearsal candidate 1 (69dbcb440688427)', 'nhtsa-e897f33e';
  end if;
  if exists (select 1 from public.event_source where external_record_id in ('historical:30610-9726')) then
    raise exception 'rehearsal baseline failed: % — a conflicting external_record_id already exists', 'rehearsal candidate 1 (69dbcb440688427)';
  end if;
  insert into pg_temp.rehearsal_status_before (candidate_id, status_before) values (v_candidate_id, v_status_before);

  -- rehearsal candidate 2 (d9ef2eb5a3957bb)
  select id, status, linked_event_id into v_candidate_id, v_status_before, v_linked_before
    from public.nhtsa_incident_candidate where id = (select id from public.nhtsa_incident_candidate where same_incident_id = 'd9ef2eb5a3957bb');
  if v_candidate_id is null then
    raise exception 'rehearsal baseline failed: % did not resolve to exactly one real candidate', 'rehearsal candidate 2 (d9ef2eb5a3957bb)';
  end if;
  if v_linked_before is not null then
    raise exception 'rehearsal baseline failed: % is not clean — linked_event_id already set to %', 'rehearsal candidate 2 (d9ef2eb5a3957bb)', v_linked_before;
  end if;
  if exists (select 1 from public.event where slug = 'nhtsa-2156118b') then
    raise exception 'rehearsal baseline failed: % — an event with slug % already exists', 'rehearsal candidate 2 (d9ef2eb5a3957bb)', 'nhtsa-2156118b';
  end if;
  if exists (select 1 from public.event_source where external_record_id in ('historical:540-5940', 'historical:30412-5782')) then
    raise exception 'rehearsal baseline failed: % — a conflicting external_record_id already exists', 'rehearsal candidate 2 (d9ef2eb5a3957bb)';
  end if;
  insert into pg_temp.rehearsal_status_before (candidate_id, status_before) values (v_candidate_id, v_status_before);

  -- rehearsal candidate 3 (singleton:historical:33175-9303)
  select id, status, linked_event_id into v_candidate_id, v_status_before, v_linked_before
    from public.nhtsa_incident_candidate where id = (select incident_candidate_id from public.nhtsa_report where reporting_generation = 'historical' and report_id = '33175-9303');
  if v_candidate_id is null then
    raise exception 'rehearsal baseline failed: % did not resolve to exactly one real candidate', 'rehearsal candidate 3 (singleton:historical:33175-9303)';
  end if;
  if v_linked_before is not null then
    raise exception 'rehearsal baseline failed: % is not clean — linked_event_id already set to %', 'rehearsal candidate 3 (singleton:historical:33175-9303)', v_linked_before;
  end if;
  if exists (select 1 from public.event where slug = 'nhtsa-228aeadf') then
    raise exception 'rehearsal baseline failed: % — an event with slug % already exists', 'rehearsal candidate 3 (singleton:historical:33175-9303)', 'nhtsa-228aeadf';
  end if;
  if exists (select 1 from public.event_source where external_record_id in ('historical:33175-9303')) then
    raise exception 'rehearsal baseline failed: % — a conflicting external_record_id already exists', 'rehearsal candidate 3 (singleton:historical:33175-9303)';
  end if;
  insert into pg_temp.rehearsal_status_before (candidate_id, status_before) values (v_candidate_id, v_status_before);
end;
$$;

-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3 rehearsal promotion calls.
-- ---------------------------------------------------------------------------
select pg_temp.promote_nhtsa_candidate(
  p_same_incident_id := '69dbcb440688427',
  p_singleton_generation := null,
  p_singleton_report_id := null,
  p_slug := 'nhtsa-e897f33e',
  p_occurred_on := '2025-01-01'::date,
  p_occurred_on_precision := 'month',
  p_location_text := 'Paradise, NV, US',
  p_location_country_code := 'US',
  p_location_precision := 'city',
  p_developer_or_operator := 'Zoox',
  p_automation_status := 'driving-automation-not-engaged',
  p_event_type := 'collision',
  p_valence := 'neutral-or-unclear',
  p_observed_facts := array[]::text[],
  p_unknowns := array[]::text[],
  p_causation_status := 'undetermined',
  p_causation_note := 'No structured or narrative evidence directly supports a more specific causation category; conservative default applied per Normalization Rulebook v1.',
  p_scenario_tags := array['autonomy-disengaged-before-impact'],
  p_record_updated := '2026-09-06'::date,
  p_sources := '[{"url":"https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting","source_type":"regulatory-record","external_record_id":"historical:30610-9726","publisher":"Zoox, Inc.","label":"NHTSA SGO report 30610-9726 (v1)","published_on":"2025-01-01","published_on_precision":"month","retrieved_on":"2026-09-06","note":null}]'::jsonb
);
select pg_temp.promote_nhtsa_candidate(
  p_same_incident_id := 'd9ef2eb5a3957bb',
  p_singleton_generation := null,
  p_singleton_report_id := null,
  p_slug := 'nhtsa-2156118b',
  p_occurred_on := '2023-06-01'::date,
  p_occurred_on_precision := 'month',
  p_location_text := 'San Francisco, CA, US',
  p_location_country_code := 'US',
  p_location_precision := 'city',
  p_developer_or_operator := 'Cruise LLC',
  p_automation_status := 'unknown',
  p_event_type := 'collision',
  p_valence := 'neutral-or-unclear',
  p_observed_facts := array[]::text[],
  p_unknowns := array['Contributing reports disagree on injury outcome text (Unknown / No Injuries Reported) — left unresolved for curator review.'],
  p_causation_status := 'undetermined',
  p_causation_note := 'No structured or narrative evidence directly supports a more specific causation category; conservative default applied per Normalization Rulebook v1.',
  p_scenario_tags := array[]::text[],
  p_record_updated := '2026-09-06'::date,
  p_sources := '[{"url":"https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting","source_type":"regulatory-record","external_record_id":"historical:540-5940","publisher":"General Motors, LLC","label":"NHTSA SGO report 540-5940 (v1)","published_on":"2023-07-01","published_on_precision":"month","retrieved_on":"2026-09-06","note":null},{"url":"https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting","source_type":"regulatory-record","external_record_id":"historical:30412-5782","publisher":"Cruise LLC","label":"NHTSA SGO report 30412-5782 (v1)","published_on":"2023-07-01","published_on_precision":"month","retrieved_on":"2026-09-06","note":null}]'::jsonb
);
select pg_temp.promote_nhtsa_candidate(
  p_same_incident_id := null,
  p_singleton_generation := 'historical',
  p_singleton_report_id := '33175-9303',
  p_slug := 'nhtsa-228aeadf',
  p_occurred_on := '2024-06-01'::date,
  p_occurred_on_precision := 'month',
  p_location_text := 'Austin, TX, US',
  p_location_country_code := 'US',
  p_location_precision := 'city',
  p_developer_or_operator := 'VWGoA- ADMT',
  p_automation_status := 'unknown',
  p_event_type := 'collision',
  p_valence := 'neutral-or-unclear',
  p_observed_facts := array[]::text[],
  p_unknowns := array[]::text[],
  p_causation_status := 'undetermined',
  p_causation_note := 'No structured or narrative evidence directly supports a more specific causation category; conservative default applied per Normalization Rulebook v1.',
  p_scenario_tags := array[]::text[],
  p_record_updated := '2026-09-06'::date,
  p_sources := '[{"url":"https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting","source_type":"regulatory-record","external_record_id":"historical:33175-9303","publisher":"Mobileye Vision Technologies","label":"NHTSA SGO report 33175-9303 (v1)","published_on":"2024-12-01","published_on_precision":"month","retrieved_on":"2026-09-06","note":null}]'::jsonb
);

-- ---------------------------------------------------------------------------
-- POSTCONDITION ASSERTIONS
-- ---------------------------------------------------------------------------
do $$
declare
  v_linked_count int;
  v_slug_count int;
  v_source_count int;
begin
  select count(*) into v_linked_count from public.nhtsa_incident_candidate where linked_event_id is not null;
  if v_linked_count != 3 then
    raise exception 'postcondition failed: expected % linked candidates, found %', 3, v_linked_count;
  end if;

  select count(*) into v_slug_count from public.event where slug like 'nhtsa-%';
  if v_slug_count != 3 then
    -- Literal '%' in "nhtsa-%%" is escaped for RAISE's own format-string
    -- parser (which treats every unescaped '%' as a positional placeholder,
    -- distinct from the ORDINARY SQL LIKE PATTERN 'nhtsa-%' just above,
    -- which is untouched) — found by a production rehearsal execution error.
    raise exception 'postcondition failed: expected % nhtsa-%% event slugs, found %', 3, v_slug_count;
  end if;

  select count(*) into v_source_count from public.event_source where source_type = 'regulatory-record';
  if v_source_count != 4 then
    raise exception 'postcondition failed: expected % regulatory-record sources, found %', 4, v_source_count;
  end if;

  if exists (select 1 from public.event where slug like 'nhtsa-%' and is_public = true) then
    raise exception 'postcondition failed: at least one nhtsa-%% event is public';
  end if;

  if exists (select 1 from public.event_source where source_type = 'regulatory-record' and external_record_id is null) then
    raise exception 'postcondition failed: at least one regulatory-record source has a null external_record_id';
  end if;

  if exists (select 1 from public.event_source where source_type = 'regulatory-record' and url is distinct from 'https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting') then
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

rollback;

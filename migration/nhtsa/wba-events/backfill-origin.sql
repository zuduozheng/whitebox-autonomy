-- White Box Autonomy — NHTSA event.origin backfill (production-write artifact).
--
-- HAND-WRITTEN, not generated: unlike promote.sql (2843 distinct per-candidate
-- calls, one reviewable SQL line per candidate), this is a single deterministic
-- UPDATE joined through one already-authoritative linkage, so a Node generator
-- would add indirection without adding safety or reviewability. Kept as a
-- plain reviewed .sql artifact under migration/nhtsa/wba-events/ (the same
-- location as promote.sql/rollback.sql), NOT under supabase/migrations/,
-- because it is a deliberate DATA change to already-existing rows — every
-- migration in supabase/migrations/ to date has been schema-only and
-- explicitly documents that it modifies no row (see e.g.
-- 20260901000000_public_event_requires_source.sql, 20260906000000_event_
-- location_precision_and_scenario_tags.sql). Bundling a real data
-- reclassification into a schema migration would break that established
-- discipline; running it as its own separately-reviewed, separately-executed
-- artifact — exactly like promote.sql was — keeps schema changes and data
-- changes cleanly apart.
--
-- PREREQUISITE: 20260908000000_event_origin.sql must already be applied (adds
-- event.origin). This artifact does not add or alter any column or
-- constraint.
--
-- WHAT THIS DOES
--   Sets origin = 'source-derived' on every public.event row already linked
--   from public.nhtsa_incident_candidate.linked_event_id — the SAME
--   authoritative linkage promote.sql itself established, and the only
--   linkage this artifact trusts. It does NOT use a slug LIKE pattern as the
--   write predicate (a slug prefix is a naming convention, not an
--   authoritative identifier, and this project's own discipline has
--   consistently preferred exact joins over pattern matches for anything
--   that isn't purely a verification aid — see promote.sql's own postcondition
--   comments). Runs as ONE transaction: either every linked event is
--   reclassified, or nothing commits.
--
-- WHAT THIS DOES NOT DO
--   Touches ONLY public.event.origin. Does not read, write, or reference
--   public.event.is_public anywhere, and does not reference
--   public.nhtsa_incident_candidate.status anywhere — both are asserted
--   unchanged by the postcondition block below, and verified independently
--   by migration/nhtsa/wba-events/__tests__/backfill-origin.test.mjs via
--   static analysis of this file's own text. No event outside the linked set
--   is touched: the UPDATE's FROM/JOIN is the sole selection criterion, and
--   the postcondition block below asserts the resulting source-derived set is
--   EXACTLY the linked set — not merely the same size as it.
--
-- HOW TO APPLY (native psql over the same connection already proven for
-- promote.sql — NOT the Management API, which cannot accept a file this
-- shape without issue either, though this file is small enough that either
-- transport would likely work; using the same proven path avoids
-- reintroducing a question already settled):
--
--     psql -v ON_ERROR_STOP=1 -f migration/nhtsa/wba-events/backfill-origin.sql
--
-- Do NOT run this until it has been reviewed and independently authorized.
--
-- Rollback: migration/nhtsa/wba-events/rollback-origin.sql (generated
-- alongside this file, reverses origin back to 'curated' for the exact same
-- linked_event_id-joined set — never a LIKE pattern, same discipline).
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- PRECONDITION ASSERTIONS
-- ---------------------------------------------------------------------------
do $$
declare
  v_candidate_count int;
  v_linked_count int;
  v_dangling_count int;
begin
  select count(*) into v_candidate_count from public.nhtsa_incident_candidate;
  if v_candidate_count != 2843 then
    raise exception 'precondition failed: expected % nhtsa_incident_candidate rows, found %',
      2843, v_candidate_count;
  end if;

  select count(*) into v_linked_count
  from public.nhtsa_incident_candidate
  where linked_event_id is not null;
  if v_linked_count != 2843 then
    raise exception 'precondition failed: expected % linked nhtsa_incident_candidate rows, found %',
      2843, v_linked_count;
  end if;

  select count(*) into v_dangling_count
  from public.nhtsa_incident_candidate c
  where c.linked_event_id is not null
    and not exists (select 1 from public.event e where e.id = c.linked_event_id);
  if v_dangling_count != 0 then
    raise exception 'precondition failed: % linked_event_id value(s) do not resolve to an existing event',
      v_dangling_count;
  end if;

  -- Defense in depth: every linked event must still be private going into
  -- this artifact. Origin reclassification is independent of publication,
  -- but a private baseline is the only state this artifact has been reviewed
  -- against.
  if exists (
    select 1
    from public.nhtsa_incident_candidate c
    join public.event e on e.id = c.linked_event_id
    where e.is_public is true
  ) then
    raise exception 'precondition failed: at least one linked event is already public';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- THE UPDATE — the one authoritative join. No slug predicate anywhere.
-- ---------------------------------------------------------------------------
update public.event e
set origin = 'source-derived'
from public.nhtsa_incident_candidate c
where c.linked_event_id = e.id;

-- ---------------------------------------------------------------------------
-- POSTCONDITION ASSERTIONS
-- ---------------------------------------------------------------------------
do $$
declare
  v_source_derived_count int;
  v_linked_count int;
  v_mismatched_count int;
  v_still_private_count int;
  v_candidate_status_count int;
begin
  select count(*) into v_source_derived_count from public.event where origin = 'source-derived';
  select count(*) into v_linked_count
  from public.nhtsa_incident_candidate
  where linked_event_id is not null;

  if v_source_derived_count != 2843 then
    raise exception 'postcondition failed: expected % source-derived events, found %',
      2843, v_source_derived_count;
  end if;
  if v_source_derived_count != v_linked_count then
    raise exception 'postcondition failed: source-derived count % does not match linked candidate count %',
      v_source_derived_count, v_linked_count;
  end if;

  -- Set equality, not just a count match: every source-derived event must be
  -- IN the linked set, and every linked event must BE source-derived — rules
  -- out a same-size but wrong set.
  select count(*) into v_mismatched_count
  from (
    select id from public.event where origin = 'source-derived'
    except
    select linked_event_id from public.nhtsa_incident_candidate where linked_event_id is not null
  ) unexpected;
  if v_mismatched_count != 0 then
    raise exception 'postcondition failed: % event(s) marked source-derived are not linked from any candidate',
      v_mismatched_count;
  end if;

  select count(*) into v_mismatched_count
  from (
    select linked_event_id from public.nhtsa_incident_candidate where linked_event_id is not null
    except
    select id from public.event where origin = 'source-derived'
  ) missed;
  if v_mismatched_count != 0 then
    raise exception 'postcondition failed: % linked event(s) were not reclassified to source-derived',
      v_mismatched_count;
  end if;

  -- is_public must remain exactly as it was: untouched by this artifact.
  select count(*) into v_still_private_count
  from public.nhtsa_incident_candidate c
  join public.event e on e.id = c.linked_event_id
  where e.is_public is true;
  if v_still_private_count != 0 then
    raise exception 'postcondition failed: % linked event(s) became public — is_public must remain untouched by this artifact',
      v_still_private_count;
  end if;

  -- candidate.status must remain exactly 'pending' for every linked
  -- candidate: this artifact makes no curator-acceptance decision.
  select count(*) into v_candidate_status_count
  from public.nhtsa_incident_candidate
  where linked_event_id is not null
    and status is distinct from 'pending';
  if v_candidate_status_count != 0 then
    raise exception 'postcondition failed: % linked candidate(s) have status other than pending — this artifact must never change candidate.status',
      v_candidate_status_count;
  end if;
end;
$$;

commit;

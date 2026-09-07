-- White Box Autonomy — NHTSA event.origin backfill ROLLBACK (production-write artifact).
--
-- HAND-WRITTEN, paired with backfill-origin.sql. Reverts origin back to
-- 'curated' for exactly the same public.nhtsa_incident_candidate.linked_event_id
-- join used forward — never a slug LIKE pattern, same discipline as
-- backfill-origin.sql and as promote.sql/rollback.sql before it. Unlike
-- rollback.sql (which deletes rows promote.sql created), this rollback only
-- reverts one column on rows that already existed before backfill-origin.sql
-- ran; no row is inserted or deleted by either direction.
--
-- WHAT THIS DOES NOT DO
--   Touches ONLY public.event.origin. Never references is_public or
--   nhtsa_incident_candidate.status, exactly like backfill-origin.sql.
--
-- HOW TO APPLY:
--
--     psql -v ON_ERROR_STOP=1 -f migration/nhtsa/wba-events/rollback-origin.sql
--
-- Do NOT run unless the origin backfill actually needs to be reverted.
-- ---------------------------------------------------------------------------

begin;

update public.event e
set origin = 'curated'
from public.nhtsa_incident_candidate c
where c.linked_event_id = e.id
  and e.origin = 'source-derived';

do $$
declare
  v_remaining_source_derived int;
  v_still_private_count int;
  v_candidate_status_count int;
begin
  select count(*) into v_remaining_source_derived
  from public.nhtsa_incident_candidate c
  join public.event e on e.id = c.linked_event_id
  where e.origin = 'source-derived';
  if v_remaining_source_derived != 0 then
    raise exception 'postcondition failed: % linked event(s) still marked source-derived after rollback',
      v_remaining_source_derived;
  end if;

  select count(*) into v_still_private_count
  from public.nhtsa_incident_candidate c
  join public.event e on e.id = c.linked_event_id
  where e.is_public is true;
  if v_still_private_count != 0 then
    raise exception 'postcondition failed: % linked event(s) are public — this rollback must never touch is_public',
      v_still_private_count;
  end if;

  select count(*) into v_candidate_status_count
  from public.nhtsa_incident_candidate
  where linked_event_id is not null
    and status is distinct from 'pending';
  if v_candidate_status_count != 0 then
    raise exception 'postcondition failed: % linked candidate(s) have status other than pending — this rollback must never change candidate.status',
      v_candidate_status_count;
  end if;
end;
$$;

commit;

-- Make `unknowns` optional for publication — forward-only follow-up to
-- 20260903000000_submission_to_draft_conversion.sql (already applied to
-- production; not edited here or ever, per this project's migration
-- discipline).
--
-- RATIONALE
--   `unknowns` records specific facts the available evidence does NOT
--   establish — see its own column comment in 20260829235332_observatory_
--   core.sql ("Specific facts the sources do NOT establish. Never inferred
--   fill.") and the curator form's hint text, unchanged by this migration:
--   "Specific facts the sources do NOT establish. Never inferred."
--
--   Requiring at least one such statement before an event can be public was
--   inherited unexamined from `observed_facts` when the publish-time
--   completeness check was introduced in 20260903000000. In practice it means
--   a curator would sometimes have to WRITE AN UNKNOWN THAT ISN'T ONE just to
--   satisfy the database — the opposite of "never inferred". A genuinely
--   well-evidenced event can legitimately have nothing left unestablished.
--
-- WHAT CHANGES
--   Only `public.enforce_public_event_is_complete()` (redefined below via
--   CREATE OR REPLACE): the `cardinality(new.unknowns) = 0` arm is removed
--   from its completeness check. Every other arm — title, summary,
--   developer/operator, event type, valence, review status, and
--   `cardinality(new.observed_facts) = 0` — is UNCHANGED. `observed_facts`
--   remains mandatory: it is what the record affirmatively documents, and is
--   not equivalent to `unknowns` either scientifically or in this schema.
--
-- WHAT DOES NOT CHANGE
--   No table, column, or CHECK constraint: `unknowns` was already declared
--   `not null default '{}'` with only a no-null-elements CHECK
--   (`event_unknowns_check`) — 20260903000000 already relaxed the column
--   itself to permit an empty array (for private drafts); this migration
--   only relaxes the separate publish-time trigger check, which is where the
--   "at least one" requirement actually lived. `enforce_public_event_has_
--   source`, `enforce_event_publication_lifecycle`, every RLS policy and
--   grant, `approve_submission_and_create_draft`, and all `event_submission`
--   objects are untouched. No existing row is modified — this migration
--   contains no UPDATE/DELETE/INSERT, only a function redefinition.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_public_event_is_complete()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.is_public is true then
    if new.title is null
       or new.summary is null
       or new.developer_or_operator is null
       or new.event_type is null
       or new.valence is null
       or new.review_status is null
       or cardinality(new.observed_facts) = 0
    then
      raise exception
        'event %: a public event must be complete — title, summary, developer/operator, event type, valence, review status and at least one observed fact are all required while is_public = true',
        new.slug
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- CREATE OR REPLACE FUNCTION still carries a CREATE FUNCTION command tag, so
-- the platform grant-on-create event trigger fires again (documented in
-- 20260831001000 / 20260831002000) — re-strip it, matching every other
-- redefinition in this codebase.
revoke execute on function public.enforce_public_event_is_complete() from public;
revoke execute on function public.enforce_public_event_is_complete() from anon;
revoke execute on function public.enforce_public_event_is_complete() from authenticated;

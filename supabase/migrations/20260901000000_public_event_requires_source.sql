-- Public-event source invariant — Migration 4.
--
-- INVARIANT (UNCONDITIONAL — holds for every caller, including migrations, the
-- seed step and service_role):
--
--     A public event ALWAYS has at least one source.
--
-- This is a fundamental data-integrity invariant, in the same class as the
-- NOT NULL / CHECK / FOREIGN KEY constraints in 20260829235332 — not an
-- editorial-workflow rule. There is no context in which a public zero-source
-- event is correct:
--   * project principle: every event carries traceable source provenance; a
--     public event with no source is a published claim with no evidence;
--   * src/lib/events/supabase-source.ts raises on a zero-source event, so such a
--     row breaks the live site regardless of how it was created.
-- Unlike the slug / first_published_at rules in 20260831003000 — which retain a
-- trusted-context override for sanctioned historical corrections — no caller is
-- exempted here.
--
-- Two BEFORE row triggers:
--
--   1. public.event  BEFORE INSERT OR UPDATE
--        INSERT: is_public must not be true. Events are always born private;
--                publication is a later UPDATE. enforce_event_publication_
--                lifecycle() already says this for authenticated writes; this
--                trigger extends it to trusted contexts so the seed and every
--                migration use the one checked publication path. That function
--                is left unchanged; its trusted direct-public-INSERT
--                convenience branch (documented there as "convenience only,
--                never a guarantee") is simply no longer reachable.
--        UPDATE: an is_public  not-true -> true  transition (first publication
--                OR re-publication) requires >= 1 event_source row.
--
--   2. public.event_source  BEFORE DELETE OR UPDATE OF event_id
--        The event losing the source (OLD.event_id) may not be left public with
--        zero sources. Covers DELETE and re-parenting.
--        Cascade-safe: during ON DELETE CASCADE from an event deletion the
--        parent event row is already invisible to this trigger (a transaction
--        does not see its own just-deleted rows), so the guard is skipped and
--        the cascade completes.
--
-- Concurrency: the event_source trigger takes SELECT ... FOR UPDATE on the
-- parent event, so concurrent last-source removals and a concurrent publish
-- serialise on that row. The event trigger needs no explicit lock (its UPDATE
-- already locks the event row). The publish path holds only the event-row lock
-- and needs nothing the delete path holds, so the two cannot deadlock.
--
-- Firing order on public.event: this trigger's name sorts before
-- event_enforce_publication_lifecycle and before event_set_*. Immaterial: on a
-- rejected INSERT both raise SQLSTATE 23514; on UPDATE the two triggers write
-- disjoint columns.
--
-- Errors: ERRCODE = 'check_violation' (SQLSTATE 23514), matching
-- enforce_event_publication_lifecycle().
--
-- Out of scope / unchanged: RLS policies, table grants,
-- enforce_event_publication_lifecycle() and its trigger, first_published_at /
-- slug-lock behaviour, the audit triggers, is_curator(), user_profile, all
-- application code. No schema change. No existing object altered, renamed or
-- dropped. This migration modifies no row. supabase/seed.sql is updated in the
-- same change set (editorial data; never run by `supabase db push`).

-- ---------------------------------------------------------------------------
-- 1. event: born private; publish only with >= 1 source.
-- ---------------------------------------------------------------------------
create function public.enforce_public_event_has_source()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_public is true then
      raise exception
        'event %: events are created private; publish with a later update once a source is attached',
        new.slug
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE: guard only the  not-true -> true  transition.
  if new.is_public is true and old.is_public is not true then
    if not exists (
      select 1 from public.event_source where event_id = old.id
    ) then
      raise exception
        'event %: cannot be made public with no sources; attach at least one source first',
        old.slug
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_public_event_has_source() from public;
revoke execute on function public.enforce_public_event_has_source() from anon;
revoke execute on function public.enforce_public_event_has_source() from authenticated;

create trigger event_enforce_public_has_source
  before insert or update on public.event
  for each row execute function public.enforce_public_event_has_source();

-- ---------------------------------------------------------------------------
-- 2. event_source: never strand a public event with zero sources.
-- ---------------------------------------------------------------------------
create function public.enforce_event_source_not_last()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  parent_is_public boolean;
begin
  -- Re-parenting only matters when event_id actually changes.
  if tg_op = 'UPDATE' and new.event_id is not distinct from old.event_id then
    return new;
  end if;

  -- Lock the (old) parent so concurrent last-source removals and a concurrent
  -- publish serialise here. During ON DELETE CASCADE the parent row is already
  -- gone from this transaction's view, so this finds nothing and the guard is
  -- skipped.
  select e.is_public into parent_is_public
  from public.event e
  where e.id = old.event_id
  for update;

  if parent_is_public is true
     and not exists (
       select 1 from public.event_source s
       where s.event_id = old.event_id
         and s.id <> old.id
     )
  then
    raise exception
      'event_source %: cannot remove the last source of public event %; unpublish the event or attach another source first',
      old.id, old.event_id
      using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function public.enforce_event_source_not_last() from public;
revoke execute on function public.enforce_event_source_not_last() from anon;
revoke execute on function public.enforce_event_source_not_last() from authenticated;

create trigger event_source_enforce_not_last
  before delete or update of event_id on public.event_source
  for each row execute function public.enforce_event_source_not_last();

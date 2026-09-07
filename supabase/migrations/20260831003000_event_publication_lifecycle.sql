-- Publication lifecycle guard for public.event — Migration 3.
--
-- Purpose: protect the historical identity of a published event.
--   * The moment an event first becomes public, the DATABASE stamps
--     first_published_at with the current transaction time. The client never
--     chooses or supplies that value.
--   * Once first_published_at has ever been set, both first_published_at and
--     the citable `slug` are frozen forever — through unpublish and any later
--     republish, regardless of current visibility.
--   * A single UPDATE may not both publish an event for the first time and
--     rename it. This rule is UNIVERSAL: it also binds trusted
--     auth.uid() IS NULL contexts (the check sits outside `if enforced`).
--
-- Enforced by ONE BEFORE INSERT OR UPDATE row trigger on public.event.
--
-- Identity-scoped enforcement (no bypass flag, GUC or column):
--   * auth.uid() IS NOT NULL  -> an ordinary authenticated application/curator
--     request. `anon` has no write access to public.event at all, so this is
--     the only way an end user reaches a write. Every rule below applies, in
--     full and without exception.
--   * auth.uid() IS NULL      -> a privileged non-request context: a SQL
--     migration, the seed step, or service_role maintenance. These already
--     bypass RLS and can run arbitrary DDL/DML, and the application is
--     forbidden from holding service-role credentials. They are NOT blocked by
--     the immutability checks, the draft-timestamp check, or the direct-public
--     INSERT rejection, so a future *reviewed* migration can still perform a
--     sanctioned historical correction — including deliberately changing,
--     clearing, or setting a historical first_published_at that an ordinary
--     application request never could. The ONE rule they remain bound by is the
--     first-publish-plus-rename rejection above: such a migration renames the
--     never-published draft in one UPDATE, then publishes it in a second.
--
-- Net guarantee: ordinary authenticated application/curator writes strictly
-- enforce every publication-lifecycle invariant here. Trusted auth.uid() IS
-- NULL maintenance contexts deliberately retain the ability to override
-- historical publication metadata for sanctioned corrections; this migration
-- makes no claim to the contrary. As a convenience only (never a guarantee),
-- on a trusted direct-public INSERT or a trusted first-publication UPDATE the
-- trigger supplies pg_catalog.now() when first_published_at was not explicitly
-- given; an explicit value from a trusted context is left untouched.
--
-- Direct-public INSERT is rejected for application writes: a new event is
-- always created as a draft and first publication happens through a later
-- UPDATE. That keeps one canonical publication path — one place stamps
-- first_published_at, one place forbids rename-at-publication.
--
-- Out of scope / unchanged: curator RLS policies, table grants, event_source,
-- the audit triggers, public.is_curator(), user_profile. No existing trigger
-- is renamed. This migration modifies no existing row.

-- ---------------------------------------------------------------------------
-- Trigger function.
--
-- PL/pgSQL, SECURITY INVOKER, empty search_path, schema-qualified references
-- (pg_catalog.now(), auth.uid()). TG_OP is a PL/pgSQL trigger variable and is
-- unaffected by search_path. `is_public` is read as `IS TRUE` / `IS NOT TRUE`
-- so a transient NULL (BEFORE triggers run before the NOT NULL check) is
-- treated as "not public" rather than erroring.
-- ---------------------------------------------------------------------------
create function public.enforce_event_publication_lifecycle()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  -- True for ordinary application / curator writes.
  enforced boolean := auth.uid() is not null;
begin
  -- ===================== INSERT =====================
  if tg_op = 'INSERT' then
    if enforced then
      -- Application writes: drafts only. Publish later via UPDATE.
      if new.is_public is true then
        raise exception
          'event %: new events must be inserted as drafts (is_public = false); publish through a later update',
          new.slug
          using errcode = 'check_violation';
      end if;
      if new.first_published_at is not null then
        raise exception
          'event %: first_published_at cannot be set on insert; the database stamps it at first publication',
          new.slug
          using errcode = 'check_violation';
      end if;
    else
      -- Trusted non-request write (migration / seed / service_role): a row may
      -- be inserted already public. Convenience only: supply pg_catalog.now()
      -- when first_published_at was not given; an explicit value is respected.
      if new.is_public is true and new.first_published_at is null then
        new.first_published_at := pg_catalog.now();
      end if;
    end if;

    return new;
  end if;

  -- ===================== UPDATE =====================

  if old.first_published_at is null then
    -- The event has never been published.

    if new.is_public is true then
      -- This UPDATE is the first publication transition.

      -- Rule (UNIVERSAL — deliberately outside `if enforced`, so it also binds
      -- trusted auth.uid() IS NULL writes): first publication may not also
      -- rename the event. A trusted migration needing both does the rename in
      -- one UPDATE and the publication in a second.
      if new.slug is distinct from old.slug then
        raise exception
          'event %: an update may not both publish the event for the first time and change its slug; do these in separate steps',
          old.slug
          using errcode = 'check_violation';
      end if;

      if enforced then
        -- The client must not choose the timestamp: it must arrive NULL.
        if new.first_published_at is not null then
          raise exception
            'event %: first_published_at is assigned by the database at first publication; do not supply a value',
            old.slug
            using errcode = 'check_violation';
        end if;
        new.first_published_at := pg_catalog.now();
      else
        -- Trusted context: honour an explicit historical timestamp if given,
        -- otherwise stamp the current time.
        if new.first_published_at is null then
          new.first_published_at := pg_catalog.now();
        end if;
      end if;

    else
      -- Still a draft after this UPDATE. A never-published draft may change its
      -- slug freely (no slug check here). It must not carry a
      -- first_published_at value.
      if enforced and new.first_published_at is not null then
        raise exception
          'event %: first_published_at must stay NULL until the event is published',
          old.slug
          using errcode = 'check_violation';
      end if;
    end if;

    return new;
  end if;

  -- old.first_published_at IS NOT NULL: the event has been public at least
  -- once. For ordinary authenticated writes its historical identity is frozen,
  -- whatever the current or new value of is_public (this covers unpublish and
  -- any later republish). A trusted auth.uid() IS NULL context is intentionally
  -- NOT frozen here, so a reviewed migration can still correct history.
  if enforced then
    if new.slug is distinct from old.slug then
      raise exception
        'event %: the slug of an event that has been published is immutable',
        old.slug
        using errcode = 'check_violation';
    end if;
    if new.first_published_at is distinct from old.first_published_at then
      raise exception
        'event %: first_published_at is immutable once set (attempted change from % to %)',
        old.slug, old.first_published_at, new.first_published_at
        using errcode = 'check_violation';
    end if;
  end if;

  -- Republish (is_public false -> true again) intentionally leaves
  -- first_published_at at its original value.

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Least privilege. This Supabase project auto-grants EXECUTE on new public
-- functions to anon, authenticated and service_role. A trigger function needs
-- no direct EXECUTE grant to fire, so strip every grant except service_role's.
-- ---------------------------------------------------------------------------
revoke execute on function public.enforce_event_publication_lifecycle() from public;
revoke execute on function public.enforce_event_publication_lifecycle() from anon;
revoke execute on function public.enforce_event_publication_lifecycle() from authenticated;

-- ---------------------------------------------------------------------------
-- Trigger. Fires alongside the existing BEFORE-row triggers
-- event_set_audit_fields and event_set_updated_at.
--
-- Execution order is immaterial to correctness: the three triggers write
-- disjoint columns (this one: slug / is_public / first_published_at; audit:
-- created_by / updated_by; updated_at: updated_at) and this function derives
-- every decision from auth.uid() and slug / is_public / first_published_at
-- only — none of which the other two triggers touch. The name is nonetheless
-- chosen to sort before event_set_* (alphabetical BEFORE-trigger order) so a
-- rejected write aborts before the other triggers do their work. No existing
-- trigger is renamed.
-- ---------------------------------------------------------------------------
create trigger event_enforce_publication_lifecycle
  before insert or update on public.event
  for each row execute function public.enforce_event_publication_lifecycle();

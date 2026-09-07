-- Curator audit / write layer — Migration 2.
--
-- Purpose: give the single curator (as defined by Migration 1's `user_profile`
-- + `public.is_curator()`) the ability to SELECT drafts and to INSERT / UPDATE
-- Observatory records, while the database itself stamps and protects the audit
-- identity so a client can never forge it. Public read behaviour is unchanged:
-- `anon` and non-curator `authenticated` users still see only `is_public = true`
-- events and their sources, and still cannot write.
--
-- Deliberately NOT in this migration (these belong to Migration 3):
--   * no immutability enforcement for published `slug`;
--   * no guard on the is_public false -> true transition;
--   * no protection of `first_published_at` against later changes;
--   * no publication guard triggers;
--   * no admin UI, no Auth users, no `user_profile` rows, no Auth settings,
--     no application code, no changes to seed.sql.
--
-- `public.is_curator()` is used as-is and is not modified here.

-- ===========================================================================
-- A. Audit columns
--
-- created_by / updated_by record which Auth user created and last changed a
-- row. They are nullable: existing seed rows and any future service-role /
-- migration writes legitimately have no Auth identity. ON DELETE SET NULL keeps
-- the Observatory record intact if the referenced Auth user is later removed —
-- the record must outlive the account that touched it.
--
-- first_published_at is the timestamp a row first became public. It is only
-- populated here (backfill in section B); Migration 3 will make it immutable.
-- ===========================================================================
alter table public.event
  add column created_by         uuid references auth.users (id) on delete set null,
  add column updated_by         uuid references auth.users (id) on delete set null,
  add column first_published_at timestamptz;

alter table public.event_source
  add column created_by uuid references auth.users (id) on delete set null,
  add column updated_by uuid references auth.users (id) on delete set null;

-- ===========================================================================
-- B. Publication default and existing rows
--
-- New events must be drafts unless a curator deliberately publishes them, so
-- the column default flips from true to false. Existing rows keep their current
-- is_public value untouched (all 9 are public and stay public).
--
-- Backfill first_published_at for rows that are already public, using the
-- curator-controlled editorial date `record_updated` (a plain `date`) anchored
-- at midnight UTC so the result does not depend on the session time zone. This
-- is the only defensible timestamp already in the record; no publication time
-- is invented from any external source. Rows that are not public are left NULL.
-- ===========================================================================
alter table public.event
  alter column is_public set default false;

update public.event
   set first_published_at = (record_updated::timestamp at time zone 'UTC')
 where is_public = true
   and first_published_at is null;

-- ===========================================================================
-- C. Database-controlled audit behaviour
--
-- One trigger function, reused by BEFORE INSERT OR UPDATE row triggers on both
-- tables (both have created_by / updated_by). It only ever writes those two
-- columns.
--
--   auth.uid() IS NOT NULL  (a signed-in end user, e.g. a curator):
--     INSERT -> created_by and updated_by are both forced to auth.uid();
--     UPDATE -> created_by is restored from OLD (submitted value ignored),
--               updated_by is forced to auth.uid().
--     The client therefore cannot forge audit identity.
--
--   auth.uid() IS NULL  (migrations, service_role workflows, the seed step):
--     the row's created_by / updated_by are left exactly as supplied, so
--     service processes and existing seed data keep NULL audit identities.
--
-- Hardened definition: SECURITY INVOKER (no privilege elevation), explicit
-- empty search_path, schema-qualified references. TG_OP is a PL/pgSQL trigger
-- variable and is unaffected by search_path.
-- ===========================================================================
create function public.set_audit_fields()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := actor;
    new.updated_by := actor;
  elsif tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.updated_by := actor;
  end if;

  return new;
end;
$$;

-- This Supabase project runs a platform ddl_command_end event trigger that, on
-- CREATE FUNCTION, grants EXECUTE directly to anon, authenticated and
-- service_role (the same behaviour documented in the is_curator() follow-up).
-- A trigger function needs no direct EXECUTE grant to fire, so strip every
-- grant except service_role's.
revoke execute on function public.set_audit_fields() from public;
revoke execute on function public.set_audit_fields() from anon;
revoke execute on function public.set_audit_fields() from authenticated;

create trigger event_set_audit_fields
  before insert or update on public.event
  for each row execute function public.set_audit_fields();

create trigger event_source_set_audit_fields
  before insert or update on public.event_source
  for each row execute function public.set_audit_fields();

-- ===========================================================================
-- D. Curator RLS access
--
-- The existing public SELECT policies (event_public_read,
-- event_source_public_read) are left in place. PostgreSQL OR-combines
-- permissive policies, so the policies below only ADD capability for a verified
-- curator and never widen anon or non-curator access.
--
-- public.is_curator() returns false for anon and for a signed-in user with no
-- curator/admin row in user_profile, so such a user gains nothing here. It is
-- wrapped in (select ...) so the planner evaluates it once per statement,
-- matching the pattern used in Migration 1.
--
-- event: curators may SELECT every row (incl. drafts), INSERT and UPDATE.
-- There is deliberately no curator DELETE policy — curators cannot delete
-- events.
-- ===========================================================================
create policy event_curator_read
  on public.event
  for select
  to authenticated
  using ((select public.is_curator()));

create policy event_curator_insert
  on public.event
  for insert
  to authenticated
  with check ((select public.is_curator()));

create policy event_curator_update
  on public.event
  for update
  to authenticated
  using ((select public.is_curator()))
  with check ((select public.is_curator()));

-- event_source: curators may SELECT (sources of drafts as well as public
-- events), INSERT, UPDATE and DELETE.
create policy event_source_curator_read
  on public.event_source
  for select
  to authenticated
  using ((select public.is_curator()));

create policy event_source_curator_insert
  on public.event_source
  for insert
  to authenticated
  with check ((select public.is_curator()));

create policy event_source_curator_update
  on public.event_source
  for update
  to authenticated
  using ((select public.is_curator()))
  with check ((select public.is_curator()));

create policy event_source_curator_delete
  on public.event_source
  for delete
  to authenticated
  using ((select public.is_curator()));

-- ===========================================================================
-- E. Table grants
--
-- RLS is necessary but not sufficient: the role also needs the table-level DML
-- privilege. Grant only what the policies above require. anon DML privileges
-- are untouched (still revoked from Migration 0). service_role is untouched
-- (bypasses RLS by design). RLS is neither weakened nor disabled.
--
--   event:        authenticated already has SELECT; add INSERT, UPDATE only
--                 (NO DELETE — matches the absent curator DELETE policy).
--   event_source: authenticated already has SELECT; add INSERT, UPDATE, DELETE.
-- ===========================================================================
grant insert, update on table public.event to authenticated;
grant insert, update, delete on table public.event_source to authenticated;

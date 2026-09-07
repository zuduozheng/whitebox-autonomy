-- Curator identity and authorization model — Migration 1.
--
-- Purpose: introduce WHO may curate, without granting any write access yet.
-- This migration adds one table (`user_profile`) mapping a Supabase Auth
-- identity to a role, a self-read RLS policy, and a read-only helper function
-- `is_curator()` that a LATER migration will use in write policies on `event`
-- and `event_source`. Nothing here lets any end user write to the Observatory.
--
-- Deliberately NOT in this migration:
--   * no changes to `event` / `event_source` (schema, RLS policies, or grants);
--   * no curator INSERT / UPDATE / DELETE policy anywhere;
--   * no curator Auth user and no `user_profile` row (added later, out of band,
--     as service_role);
--   * no application code, no @supabase/ssr, no hosted Auth settings changes.
--
-- Net new capability after this migration: an authenticated user can SELECT
-- their own `user_profile` row (none exist until one is inserted later). `anon`
-- gains nothing.

-- ---------------------------------------------------------------------------
-- user_profile — maps auth.users.id to an Observatory role.
--
-- One row per internal user; for the MVP there will be exactly one, for the
-- single curator. Written only by trusted server-side contexts (a later manual
-- insert as service_role, or a future admin screen), never by end users, so the
-- table gets a SELECT policy only.
-- ---------------------------------------------------------------------------
create table public.user_profile (
  -- PK is the Supabase Auth user id. Deleting the auth user deletes the profile.
  user_id     uuid primary key
                references auth.users (id) on delete cascade,

  -- Authorization role. 'curator' covers the MVP; 'admin' is reserved for a
  -- later user-management capability. No other values permitted.
  role        text not null default 'curator'
                check (role in ('curator', 'admin')),

  -- Optional display name; if present it must be non-blank (mirrors the
  -- non-empty-text checks used throughout the core schema).
  full_name   text
                check (full_name is null or length(trim(full_name)) > 0),

  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row-Level Security.
--
--   anon           -> no policy and no table privilege: sees nothing.
--   authenticated  -> may SELECT only its own row (user_id = auth.uid()).
--   service_role   -> bypasses RLS by design (used for the later manual insert).
--
-- There is intentionally no INSERT / UPDATE / DELETE policy, so no end user can
-- create a profile or change a role — i.e. nobody can grant themselves access.
-- ---------------------------------------------------------------------------
alter table public.user_profile enable row level security;

-- Strip Supabase's default table privileges for the API roles, then grant back
-- exactly the one the app needs: authenticated SELECT (still row-filtered by the
-- policy below). Keeps the privilege layer aligned with the RLS intent and
-- guarantees `anon` has no access even before RLS is consulted.
revoke all privileges on table public.user_profile from anon, authenticated;
grant select on table public.user_profile to authenticated;

create policy user_profile_self_read
  on public.user_profile
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- is_curator() — reusable authorization predicate for later write policies.
--
-- SQL, STABLE, SECURITY INVOKER: runs with the caller's own privileges and RLS
-- context, so it can never observe more than the caller could. `search_path`
-- is emptied, so every referenced object is schema-qualified. Returns true when
-- the current user has a curator/admin profile row; false otherwise — including
-- for `anon` and for an authenticated user with no profile row (auth.uid() then
-- matches nothing). Never returns NULL.
-- ---------------------------------------------------------------------------
create function public.is_curator()
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profile up
    where up.user_id = (select auth.uid())
      and up.role in ('curator', 'admin')
  );
$$;

-- Least privilege: `anon` never needs this authorization helper. Only signed-in
-- users evaluate it, via the curator RLS policies added in a later migration.
revoke execute on function public.is_curator() from public;
grant execute on function public.is_curator() to authenticated;

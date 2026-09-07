-- Public event submission intake — Beta Slice 1 (database layer only).
--
-- PURPOSE
--   A public visitor can propose a candidate autonomous-driving event for
--   curator consideration. This migration adds ONE isolated table,
--   `public.event_submission`, that acts purely as a private review inbox.
--
--   It is deliberately NOT connected to `public.event` / `public.event_source`:
--   no foreign key, no shared trigger, no shared policy. A submission NEVER
--   becomes an Observatory event automatically or programmatically. The only
--   path from a submission to a public event is a curator manually authoring a
--   new event through the existing admin workflow. There is no accept->draft
--   bridge in this slice.
--
-- WHAT THIS MIGRATION DOES NOT TOUCH
--   `event`, `event_source`, `user_profile`, `public.is_curator()`,
--   `public.set_audit_fields()`, `public.enforce_event_publication_lifecycle()`,
--   `public.enforce_public_event_has_source()`,
--   `public.enforce_event_source_not_last()`, or any of their triggers,
--   policies or grants. The publication lifecycle is unchanged. No rate-limit
--   table. No IP address is stored or hashed. No service-role dependency: the
--   application inserts with the publishable / anon key under the RLS policy
--   below.
--
-- TRUST BOUNDARY
--   anon           -> may INSERT one row, which the intake trigger forces to a
--                     clean `pending` state with no review metadata. Cannot
--                     SELECT, UPDATE or DELETE — not even its own row.
--   authenticated  -> SELECT and UPDATE only when public.is_curator() is true.
--                     No INSERT grant (the public form always submits as anon
--                     via a cookie-less client) and no DELETE for anyone.
--   service_role   -> bypasses RLS by design; unused by the application.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table public.event_submission (
  id                      uuid primary key default gen_random_uuid(),

  -- The single most important input: a link to the evidence / video showing
  -- the specific event. Same shape rule as event_source.url; length-bounded.
  evidence_url            text not null
                            check (evidence_url ~ '^https?://')
                            check (length(evidence_url) <= 2048),

  -- Optional free-text context from the submitter. Non-blank if present,
  -- length-bounded. Never treated as evidence; a curator re-authors everything.
  what_happened           text
                            check (what_happened is null or
                                   (length(trim(what_happened)) > 0
                                    and length(what_happened) <= 4000)),
  developer_or_operator   text
                            check (developer_or_operator is null or
                                   (length(trim(developer_or_operator)) > 0
                                    and length(developer_or_operator) <= 200)),
  location_text           text
                            check (location_text is null or
                                   (length(trim(location_text)) > 0
                                    and length(location_text) <= 500)),

  -- Optional, exact calendar date only. No precision column and no inference:
  -- an unknown date stays NULL.
  event_date              date,

  additional_urls         text
                            check (additional_urls is null or
                                   (length(trim(additional_urls)) > 0
                                    and length(additional_urls) <= 4000)),

  -- Optional, curator-only visibility (see RLS). Minimal sanity shape; used
  -- solely for follow-up on ambiguous submissions, never shown publicly.
  submitter_email         text
                            check (submitter_email is null or
                                   (submitter_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
                                    and length(submitter_email) <= 320)),

  -- Review state. Every row is created 'pending' — enforced by BOTH the intake
  -- trigger and the anon INSERT policy. A curator moves it forward.
  status                  text not null default 'pending'
                            check (status in ('pending', 'accepted', 'rejected', 'spam')),

  -- Curator-only review fields. An anonymous INSERT can never populate these:
  -- the BEFORE INSERT branch of the trigger below nulls them unconditionally.
  curator_note            text
                            check (curator_note is null or
                                   (length(trim(curator_note)) > 0
                                    and length(curator_note) <= 4000)),
  reviewed_by             uuid references auth.users (id) on delete set null,
  reviewed_at             timestamptz,

  -- A review stamp only exists once the row has left 'pending'.
  constraint event_submission_review_stamp_requires_decision
    check (reviewed_at is null or status <> 'pending'),

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Curator inbox query: filter by status, newest first.
create index event_submission_status_created_idx
  on public.event_submission (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Trigger function: intake normalisation + review stamping.
--
-- ONE function, fired BEFORE INSERT OR UPDATE. SECURITY INVOKER, empty
-- search_path, schema-qualified references (auth.uid(), pg_catalog.now()).
-- TG_OP is a PL/pgSQL trigger variable and is unaffected by search_path.
--
-- reviewed_by and reviewed_at are ENTIRELY system-managed on both INSERT and
-- UPDATE: the value a client supplies for either column is always discarded.
-- There is no trusted-context branch — the ordinary application / RLS path is
-- the only path that matters and it gets the simplest strong invariant.
-- ---------------------------------------------------------------------------
create function public.manage_event_submission_review_fields()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Intake normaliser. Unconditional: a new submission is always a fresh
    -- pending intake with no review metadata and database-owned timestamps.
    -- An anonymous insert cannot set status or any curator-only column,
    -- whatever the client sends.
    new.status       := 'pending';
    new.curator_note := null;
    new.reviewed_by  := null;
    new.reviewed_at  := null;
    new.created_at   := pg_catalog.now();
    new.updated_at   := pg_catalog.now();
    return new;
  end if;

  -- UPDATE. The curator may change status and curator_note. reviewed_by /
  -- reviewed_at are set here from auth.uid() / now() and can never be forged
  -- by the client:
  --   * status changes away from 'pending' -> stamp reviewed_by = auth.uid(),
  --                                           reviewed_at = now();
  --   * status changes back to 'pending'   -> clear both;
  --   * status unchanged                   -> freeze OLD.reviewed_by /
  --                                           OLD.reviewed_at, ignoring
  --                                           whatever the client supplied.
  -- (Any non-pending -> different non-pending change re-stamps, so the pair
  -- always reflects the most recent decision.)
  if new.status is distinct from old.status then
    if new.status = 'pending' then
      new.reviewed_by := null;
      new.reviewed_at := null;
    else
      new.reviewed_by := auth.uid();
      new.reviewed_at := pg_catalog.now();
    end if;
  else
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;

  return new;
end;
$$;

-- This project runs a platform ddl_command_end event trigger that, on CREATE
-- FUNCTION, grants EXECUTE directly to anon, authenticated and service_role
-- (documented in 20260831001000 / 20260831002000). A trigger function needs no
-- direct EXECUTE grant to fire, so strip every grant except service_role's.
revoke execute on function public.manage_event_submission_review_fields() from public;
revoke execute on function public.manage_event_submission_review_fields() from anon;
revoke execute on function public.manage_event_submission_review_fields() from authenticated;

create trigger event_submission_manage_review_fields
  before insert or update on public.event_submission
  for each row execute function public.manage_event_submission_review_fields();

-- Keep updated_at honest on every row UPDATE. Reuses the generic
-- public.set_updated_at() created in 20260829235332 — that function is NOT
-- modified here; only a new trigger on the new table references it. On INSERT
-- the column default and the intake branch above already set updated_at.
create trigger event_submission_set_updated_at
  before update on public.event_submission
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security.
--
--   RLS is enabled from creation and is never disabled.
--
--   Default table privileges for the API roles are stripped, then re-granted
--   as the minimum each policy needs:
--     anon          -> INSERT only.
--     authenticated -> SELECT + UPDATE, both gated by is_curator(). No INSERT.
--   No DELETE privilege is granted to anon or authenticated, and no DELETE
--   policy exists, so neither can ever delete a submission in Beta.
-- ---------------------------------------------------------------------------
alter table public.event_submission enable row level security;

revoke all privileges on table public.event_submission from anon, authenticated;

grant insert on table public.event_submission to anon;
grant select, update on table public.event_submission to authenticated;

-- INSERT: any anonymous visitor may lodge a submission, but only as a
-- 'pending' row. INSERT has no pre-existing row, so there is no USING clause;
-- WITH CHECK gates the NEW row. The intake trigger already forces
-- status = 'pending' and nulls every curator-only column; this predicate is
-- the RLS-level assertion of the same headline invariant and still blocks a
-- non-pending insert if the trigger is ever removed. It grants no visibility:
-- with no SELECT policy for anon, a submitter cannot read back the row it just
-- created (the app inserts with Prefer: return=minimal).
create policy event_submission_anon_insert
  on public.event_submission
  for insert
  to anon
  with check (status = 'pending');

-- SELECT: curators only. anon has no SELECT policy at all.
create policy event_submission_curator_select
  on public.event_submission
  for select
  to authenticated
  using ((select public.is_curator()));

-- UPDATE: curators only, on both the visible row and the resulting row.
create policy event_submission_curator_update
  on public.event_submission
  for update
  to authenticated
  using ((select public.is_curator()))
  with check ((select public.is_curator()));

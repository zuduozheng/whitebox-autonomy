-- Submission -> private draft event conversion — Beta Slice 4.
--
-- PURPOSE
--   Let a curator turn a reviewed public submission into a pre-populated
--   PRIVATE draft `event`, through one atomic, idempotent database function,
--   instead of re-typing the submission's information by hand. This is the
--   only bridge from `event_submission` to `event` / `event_source`; there is
--   still no automatic or implicit path — a curator must call the function
--   deliberately, and its result is always private.
--
-- WHAT THIS MIGRATION DOES
--   A. Relaxes exactly the `event` columns that have no legitimate "not yet
--      decided" value (no default, every option a real substantive claim), so
--      a PRIVATE draft can be genuinely incomplete instead of carrying an
--      invented placeholder classification or fact. Every relaxed constraint
--      is reinstated, verbatim, in (B) — a PUBLIC event's guarantees are
--      completely unchanged.
--   B. A new trigger, sibling to `enforce_public_event_has_source`
--      (20260901000000), enforcing that `is_public = true` always implies a
--      complete row — on every INSERT and UPDATE, not only the private ->
--      public transition, so an already-public event can never be edited
--      down into an incomplete one either.
--   C. `event_submission.linked_event_id`, tying a submission to at most one
--      event (a unique index enforces the reverse), plus a one-line addition
--      to the existing intake trigger so an anonymous INSERT can never forge
--      this column, matching how it already protects `status` /
--      `curator_note` / `reviewed_by` / `reviewed_at`.
--   D. `public.approve_submission_and_create_draft(uuid)` — a single
--      SECURITY INVOKER function that locks the submission row, creates the
--      private draft plus its first source, links the submission and marks
--      it accepted, all inside the one transaction Supabase's RPC call
--      already wraps around the whole function body. Idempotent: a
--      submission already linked returns its existing event id and creates
--      nothing.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   No SECURITY DEFINER anywhere and no service-role dependency: the new
--   function runs under RLS as the calling curator, exactly like every
--   existing write path (createDraftEvent / createEventSource / the
--   submission review update). No automatic publication: the created event
--   is always `is_public = false`, enforced independently by the existing
--   `enforce_event_publication_lifecycle` / `enforce_public_event_has_source`
--   triggers, both untouched here. No review_status is set or implied by
--   conversion — it is left NULL, a deliberate future curator choice, exactly
--   as its column comment in the base migration already requires. No
--   source-type inference from the evidence URL. `event_source`, its unique
--   `(event_id, url)` constraint, and every existing RLS policy or grant on
--   `event` / `event_source` / `event_submission` are unchanged.

-- ---------------------------------------------------------------------------
-- A. Allow a PRIVATE draft to be genuinely incomplete.
--
-- title / summary / developer_or_operator / event_type / valence /
-- review_status: dropping NOT NULL is sufficient on its own. Each of these
-- columns' existing CHECK constraint is a plain boolean expression over the
-- column (non-blank text, or "value in (...)"), and per the SQL standard a
-- CHECK constraint is satisfied whenever its expression evaluates to NULL,
-- not only TRUE — e.g. `length(trim(title)) > 0` with `title` NULL evaluates
-- to NULL and therefore already passes. No CHECK is touched for these six
-- columns; only NOT NULL is removed.
-- ---------------------------------------------------------------------------
alter table public.event
  alter column title                 drop not null,
  alter column summary                drop not null,
  alter column developer_or_operator drop not null,
  alter column event_type            drop not null,
  alter column valence                drop not null,
  alter column review_status         drop not null;

-- observed_facts / unknowns must instead allow an EMPTY array (not NULL) to
-- represent "no facts recorded yet" — the array itself stays NOT NULL so
-- application code can keep treating it as always-an-array. Their existing
-- CHECK requires `cardinality(...) >= 1`, which a truly empty array fails
-- outright (a real FALSE, not NULL), so NOT NULL alone cannot help here and
-- the CHECK itself must change.
--
-- Named directly, not looked up: 20260829235332_observatory_core.sql defines
-- exactly one CHECK clause on each of these two columns —
--   observed_facts text[] not null check (cardinality(observed_facts) >= 1
--     and array_position(observed_facts, null) is null),
--   unknowns text[] not null check (cardinality(unknowns) >= 1
--     and array_position(unknowns, null) is null),
-- — written unnamed, so Postgres applied its documented default naming rule
-- for an unnamed column CHECK constraint: "<table>_<column>_check". No other
-- constraint of either name exists anywhere in the schema (verified against
-- every migration under supabase/migrations/), so there is no ambiguity to
-- resolve at migration-apply time. Auditable by reading this file next to
-- that one; if the name is ever wrong, DROP CONSTRAINT simply fails with
-- "constraint ... does not exist" rather than silently touching a different
-- constraint — unlike a dynamic catalog lookup without STRICT, which could
-- have silently picked an arbitrary match had more than one CHECK ever
-- existed on either column.
-- ---------------------------------------------------------------------------
alter table public.event
  drop constraint event_observed_facts_check,
  drop constraint event_unknowns_check;

alter table public.event
  add constraint event_observed_facts_check
    check (array_position(observed_facts, null) is null),
  add constraint event_unknowns_check
    check (array_position(unknowns, null) is null),
  alter column observed_facts set default '{}',
  alter column unknowns set default '{}';

-- ---------------------------------------------------------------------------
-- B. `is_public = true` always implies a complete row — a PERMANENT
--    invariant, not just a gate on the moment an event becomes public. A
--    PRIVATE draft may now be incomplete; a PUBLIC event's guarantees are at
--    least as strong as before this migration, and now additionally cover
--    every later edit, not only the first publish.
--
--    Deliberately NOT transition-gated (no `and old.is_public is not true`):
--    the condition is simply `if new.is_public is true then <require
--    complete>`, so it re-checks on every INSERT and, critically, on every
--    UPDATE to an event that is already public — including one that leaves
--    is_public unchanged at true. Without this, a curator editing a public
--    event and clearing e.g. its title, while never touching is_public
--    itself, would silently strand a live public record in an incomplete
--    state; NOT NULL would have caught that before this migration, and this
--    trigger is what keeps catching it now that NOT NULL alone cannot.
--
--    Sibling to enforce_public_event_has_source (20260901000000): same
--    conventions (SECURITY INVOKER, empty search_path, checked SQLSTATE).
--    That trigger's own INSERT branch already rejects `is_public = true`
--    unconditionally for every caller, including trusted/migration contexts
--    (see its header comment); this trigger's INSERT branch is additional
--    defense in depth for the same case, not the only thing preventing it.
--
--    Firing order relative to the other BEFORE INSERT/UPDATE triggers on
--    public.event is immaterial to correctness, exactly as documented in
--    20260831003000: a rejected write aborts with the same SQLSTATE
--    regardless of which trigger raises first, and no two of these triggers
--    write columns the others read.
-- ---------------------------------------------------------------------------
create function public.enforce_public_event_is_complete()
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
       or cardinality(new.unknowns) = 0
    then
      raise exception
        'event %: a public event must be complete — title, summary, developer/operator, event type, valence, review status, at least one observed fact and at least one unknown are all required while is_public = true',
        new.slug
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- This project runs a platform ddl_command_end event trigger that, on CREATE
-- FUNCTION, grants EXECUTE directly to anon, authenticated and service_role
-- (documented in 20260831001000 / 20260831002000). A trigger function needs
-- no direct EXECUTE grant to fire, so strip every grant except service_role's.
revoke execute on function public.enforce_public_event_is_complete() from public;
revoke execute on function public.enforce_public_event_is_complete() from anon;
revoke execute on function public.enforce_public_event_is_complete() from authenticated;

create trigger event_enforce_is_complete
  before insert or update on public.event
  for each row execute function public.enforce_public_event_is_complete();

-- ---------------------------------------------------------------------------
-- C. event_submission.linked_event_id — the one link from a submission to the
--    private draft event a curator created from it.
--
--    Nullable: most submissions never become a draft. The FK direction is
--    deliberately submission -> event, not event -> submission: an event
--    authored from scratch (the ordinary "New event" path) has no submission
--    at all, so `event` itself is completely untouched by this section.
--    `on delete set null` matches the existing convention for created_by /
--    updated_by: the submission record must outlive whatever it references.
-- ---------------------------------------------------------------------------
alter table public.event_submission
  add column linked_event_id uuid references public.event (id) on delete set null;

-- At most one submission may ever point at a given event. Postgres unique
-- constraints treat every NULL as distinct from every other NULL, so any
-- number of not-yet-converted (NULL) submissions coexist freely; only a
-- non-null value must be unique.
alter table public.event_submission
  add constraint event_submission_linked_event_id_unique unique (linked_event_id);

-- Redefine the existing intake trigger function (20260902000000) to also
-- normalise the new column. Without this, `anon`'s INSERT grant on the whole
-- table would let a crafted submission claim `linked_event_id` for an
-- arbitrary existing event on arrival — the same forgery risk the function
-- already closes for status / curator_note / reviewed_by / reviewed_at. Only
-- the INSERT branch changes; the UPDATE branch (curator-only, under
-- event_submission_curator_update) is untouched, so a curator can still set
-- it via the normal UPDATE path — which is exactly what section D's
-- function does, using the same RLS-authorised statement as any other
-- curator write.
create or replace function public.manage_event_submission_review_fields()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Intake normaliser. Unconditional: a new submission is always a fresh
    -- pending intake with no review metadata and database-owned timestamps.
    -- An anonymous insert cannot set status, linked_event_id, or any other
    -- curator-only column, whatever the client sends.
    new.status         := 'pending';
    new.curator_note   := null;
    new.reviewed_by    := null;
    new.reviewed_at    := null;
    new.linked_event_id := null;
    new.created_at     := pg_catalog.now();
    new.updated_at     := pg_catalog.now();
    return new;
  end if;

  -- UPDATE. The curator may change status and curator_note (and, via the
  -- narrow conversion function in section D, linked_event_id). reviewed_by /
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

-- CREATE OR REPLACE FUNCTION still carries a CREATE FUNCTION command tag, so
-- the platform grant-on-create event trigger fires again — re-strip it.
revoke execute on function public.manage_event_submission_review_fields() from public;
revoke execute on function public.manage_event_submission_review_fields() from anon;
revoke execute on function public.manage_event_submission_review_fields() from authenticated;

-- ---------------------------------------------------------------------------
-- D. approve_submission_and_create_draft — the one bridge from a reviewed
--    submission to a private draft event, as a single atomic, idempotent
--    operation.
--
-- SECURITY INVOKER (never DEFINER): every statement below runs as the
-- calling curator under their own RLS context, exactly as if they had
-- issued each statement directly through the application's existing
-- request-scoped client. A SECURITY DEFINER function would run as its
-- owner — typically a privileged role for which RLS policies scoped
-- `to authenticated` may not even apply, i.e. a hidden RLS bypass no
-- different in kind from a service-role client. Using SECURITY INVOKER
-- instead means this function grants no access beyond what the four
-- existing RLS policies it relies on already grant:
--   event_submission_curator_select / event_submission_curator_update,
--   event_curator_insert, event_source_curator_insert.
--
-- Concurrency / idempotency: `select ... for update` takes a row lock on the
-- submission. A second concurrent (or simply repeated) call for the same
-- submission blocks at that line until the first call's transaction commits
-- or rolls back, then re-reads the row under the lock and finds
-- linked_event_id already set — so it returns the existing event id and
-- creates nothing. Because the whole function body runs as one transaction,
-- any failure after the draft/source inserts (e.g. an unexpected
-- constraint violation) rolls both of them back automatically — there is no
-- multi-request window in which a half-created or orphaned draft can be
-- observed by another caller.
--
-- No invented content: every column the curator has not yet decided
-- (title, summary, event_type, valence, review_status, observed_facts,
-- unknowns) is left NULL / empty, per sections A/B above — never a
-- fabricated placeholder. review_status in particular is left NULL: this
-- function makes no verification claim and does not imply review has
-- happened. developer_or_operator, location_text and occurred_on are
-- copied from the submission as-is — unreviewed submitter input carried
-- into the draft for the curator to check, not asserted as fact. The event
-- is created via a plain INSERT with no is_public column supplied, so it is
-- born private under exactly the triggers that already govern the manual
-- "New event" form — nothing here can publish anything. The evidence URL
-- becomes the first event_source with source_type = 'other': the
-- submission captures no source-type judgement, and 'other' is the
-- schema's existing least-specific value — inferring a more specific type
-- from the URL is deliberately not done.
-- ---------------------------------------------------------------------------
create function public.approve_submission_and_create_draft(p_submission_id uuid)
  returns uuid
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_submission public.event_submission%rowtype;
  v_event_id   uuid;
begin
  if not public.is_curator() then
    raise exception 'only a curator may approve a submission'
      using errcode = '42501';
  end if;

  -- Row lock: serialises concurrent/repeated calls for the same submission on
  -- this one row. RLS-gated by event_submission_curator_select, same as any
  -- other curator read of this table.
  select * into v_submission
  from public.event_submission
  where id = p_submission_id
  for update;

  if not found then
    raise exception 'submission % not found', p_submission_id
      using errcode = 'no_data_found';
  end if;

  -- Idempotent: already converted, by an earlier call or by whichever
  -- concurrent call reached this point first. Return the existing draft
  -- rather than creating a second one.
  if v_submission.linked_event_id is not null then
    return v_submission.linked_event_id;
  end if;

  -- Private draft, pre-populated only with what the submission actually
  -- carries plus non-substantive bookkeeping (slug, record_updated). RLS-
  -- gated by event_curator_insert, same policy the "New event" form uses.
  insert into public.event (
    slug, developer_or_operator, location_text,
    occurred_on, occurred_on_precision,
    record_updated
  ) values (
    'draft-' || pg_catalog.left(pg_catalog.md5(p_submission_id::text), 8),
    v_submission.developer_or_operator,
    v_submission.location_text,
    v_submission.event_date,
    case when v_submission.event_date is null then 'unknown' else 'day' end,
    pg_catalog.now()::date
  )
  returning id into v_event_id;

  -- First source = the submission's evidence URL. RLS-gated by
  -- event_source_curator_insert, same policy the "Add source" form uses.
  insert into public.event_source (event_id, url, source_type)
  values (v_event_id, v_submission.evidence_url, 'other');

  -- Link + accept in the same transaction as the two inserts above. RLS-
  -- gated by event_submission_curator_update, same policy the ordinary
  -- review form uses.
  update public.event_submission
  set linked_event_id = v_event_id,
      status = 'accepted'
  where id = p_submission_id;

  return v_event_id;
end;
$$;

-- Least privilege, following the exact is_curator() precedent
-- (20260831000000 / 20260831001000): strip the platform's automatic grant to
-- `public` and `anon`, leave only `authenticated` able to call this at all.
-- is_curator() (checked above) plus the RLS policies on every statement
-- inside the function are the actual authorization boundary; this grant is
-- the outer gate that keeps `anon` from reaching the function in the first
-- place.
revoke execute on function public.approve_submission_and_create_draft(uuid) from public;
revoke execute on function public.approve_submission_and_create_draft(uuid) from anon;
grant execute on function public.approve_submission_and_create_draft(uuid) to authenticated;

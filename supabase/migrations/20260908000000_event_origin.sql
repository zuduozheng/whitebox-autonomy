-- event.origin — Beta 1.1 Phase 3, Migration A.
--
-- PURPOSE
--   Separate two dimensions that `review_status` alone had been asked to carry:
--     * origin        — HOW a WBA event record was created (a fact, fixed at
--                        creation time, never a curator judgement).
--     * review_status — the incident-level review/editorial standing of the
--                        record (a curator's judgement, optional, can change
--                        at any time, independent of how the record began).
--
--   This was anticipated, but not built, by the previously-approved target
--   architecture: docs/data-model.md lists `origin` as a distinct `event`
--   field alongside `review_status`, and
--   20260907000000_nhtsa_report_and_incident_candidate.sql's header explicitly
--   named "No event.origin ... all explicitly deferred, per the approved
--   architecture" as out of scope for that migration. This migration is that
--   deferred piece, resumed now because NHTSA gives WBA its first event kind
--   whose assurance model is a validated deterministic pipeline transformation
--   rather than individual curator review — a case `review_status`'s three
--   existing values (all curator judgements about one incident) cannot
--   honestly describe.
--
--   Two allowed values only, matching current, concrete need — no
--   community-submission origin model is designed here (explicitly deferred):
--     'curated'         — the existing model: a curator authored or
--                         individually reviewed this record before it could
--                         become public. Every event in production today is
--                         'curated' by construction (the column default) and
--                         this migration does not reclassify any of them.
--     'source-derived'  — created by a validated, deterministic transformation
--                         of one or more identified regulatory source records,
--                         without incident-by-incident curator review. Does
--                         NOT mean "unverified" or "lower quality" — it means
--                         a different, non-editorial assurance process. A
--                         source-derived event MAY later also acquire a real,
--                         non-null review_status if a curator genuinely
--                         reviews it individually; origin does not change when
--                         that happens, because it still describes how the
--                         record was originally created, not its current
--                         standing.
--
-- WHAT THIS MIGRATION DOES
--   A. Adds `event.origin text not null default 'curated'`, CHECK-constrained
--      to the two values above. A `NOT NULL DEFAULT` addition to an existing
--      column is a fast, metadata-only operation in modern Postgres — the
--      same reasoning already used for `location_precision` / `scenario_tags`
--      in 20260906000000 — so every existing row (currently ~88 public
--      events, all hand-curated, plus the 2,843 private NHTSA-derived events
--      already promoted per 20260907000000) receives exactly the value that
--      is already true of it TODAY: this migration inserts, updates, or
--      reclassifies no row. The 2,843 NHTSA events remain 'curated' after
--      this migration — reclassifying them to 'source-derived' is a
--      deliberate, separate DATA change, kept out of this schema migration on
--      purpose (see migration/nhtsa/wba-events/backfill-origin.sql, run
--      separately, later, only once independently authorized).
--
--   B. Redefines `enforce_public_event_is_complete()` (originally
--      20260903000000, redefined 20260904000000) to apply the origin-specific
--      completeness rule below. The four fields required unconditionally
--      (title, developer_or_operator, event_type, valence) are UNCHANGED. For
--      `origin = 'curated'` the additional requirements — summary,
--      review_status, at least one observed fact — are reproduced BYTE FOR
--      BYTE relative to the trigger's current body: since every row in
--      production is 'curated' today, this migration changes the actual
--      enforced behaviour for zero existing row. For `origin =
--      'source-derived'` those three additional requirements do not apply;
--      `enforce_public_event_has_source` (>=1 source, unconditional) is
--      untouched and still applies to every origin.
--
-- WHAT THIS MIGRATION DOES NOT DO / DOES NOT TOUCH
--   `enforce_public_event_has_source` and `enforce_event_publication_lifecycle`
--   are both untouched — neither references `summary`, `review_status`,
--   `observed_facts`, or `origin`, and nothing about the source-count or
--   slug/first_published_at rules changes for any origin. `review_status`'s
--   CHECK constraint and its three existing values are untouched: this
--   migration does not add 'source-derived' (or any value) to review_status —
--   origin and review_status are deliberately independent columns, per the
--   frozen architecture decision. No row is inserted, updated, or deleted by
--   this migration. No RLS policy or grant changes: the new column falls
--   under the existing curator write / public read policies on `event`
--   automatically, exactly like `location_precision` / `scenario_tags`
--   before it. `nhtsa_incident_candidate.status` is not referenced anywhere
--   in this migration and is not affected by it.
-- ---------------------------------------------------------------------------

alter table public.event
  add column origin text not null default 'curated'
    check (origin in ('curated', 'source-derived'));

-- ---------------------------------------------------------------------------
-- Publication completeness, origin-aware.
--
-- The CHECK this replaces is named 20260903000000_submission_to_draft_
-- conversion.sql / 20260904000000_unknowns_optional_for_publication.sql's
-- `public.enforce_public_event_is_complete()` — redefined here via CREATE OR
-- REPLACE, same convention as 20260904000000 used to redefine it in turn: the
-- trigger `event_enforce_is_complete` already points at this function by
-- name, so it needs no ALTER/DROP/CREATE of its own.
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
       or new.developer_or_operator is null
       or new.event_type is null
       or new.valence is null
    then
      raise exception
        'event %: a public event must have title, developer/operator, event type and valence',
        new.slug
        using errcode = 'check_violation';
    end if;

    if new.origin = 'curated' then
      if new.summary is null
         or new.review_status is null
         or cardinality(new.observed_facts) = 0
      then
        raise exception
          'event %: a curated public event must additionally have summary, review status and at least one observed fact',
          new.slug
          using errcode = 'check_violation';
      end if;
    end if;
    -- origin = 'source-derived': summary and review_status may be null, and
    -- observed_facts may be empty — the record's structured/classified
    -- fields and its regulatory-record source(s) carry the evidence instead
    -- of curator-written prose. review_status may still become non-null
    -- later if a curator genuinely reviews the record individually; that is
    -- unconditionally allowed here (this trigger only ever requires fields,
    -- it never forbids one being set).
  end if;

  return new;
end;
$$;

-- This project runs a platform ddl_command_end event trigger that, on CREATE
-- FUNCTION, grants EXECUTE directly to anon, authenticated and service_role
-- (documented in 20260831001000 / 20260831002000). A trigger function needs
-- no direct EXECUTE grant to fire, so strip every grant except service_role's
-- — same as every other redefinition of this function.
revoke execute on function public.enforce_public_event_is_complete() from public;
revoke execute on function public.enforce_public_event_is_complete() from anon;
revoke execute on function public.enforce_public_event_is_complete() from authenticated;

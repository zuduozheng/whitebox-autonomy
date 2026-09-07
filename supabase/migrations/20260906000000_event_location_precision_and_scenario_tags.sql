-- event: location_precision + scenario_tags — Beta 1.1 Phase 2, Migration B.
--
-- PURPOSE
--   Two additive event columns from the approved NHTSA SGO ingestion
--   architecture, reviewed and applied separately from event_source's
--   regulatory-record support (Migration A,
--   20260905000000_event_source_regulatory_record.sql — committed and
--   pushed, not yet applied to production). This migration touches only
--   `event`; it creates no table, no function, no trigger, and does not
--   modify event_source, event_submission, or anything Migration A added.
--
--   location_precision: an honest, explicit statement of how precisely an
--   event's location is known, so a city-level or coarser location can never
--   be presented as if it were exact. This is the same (value, precision)
--   discipline already established for occurred_on / published_on — except
--   here the paired "value" already exists: location_text /
--   location_country_code (20260829235332_observatory_core.sql) are
--   UNCHANGED by this migration and remain the free-text location. No
--   latitude/longitude, no PostGIS — both explicitly out of scope for this
--   phase, per the approved architecture.
--
--   scenario_tags: a lightweight, optional, curator/AI-assignable set of
--   scenario descriptors (e.g. "pedestrian-interaction"), deliberately a
--   free array with NO database-enforced vocabulary. The eventual taxonomy
--   is meant to emerge from real NHTSA narratives and existing video/X
--   events, not be designed upfront. Mirrors the existing observed_facts /
--   unknowns array pattern: `text[] not null`, only a no-null-elements
--   check, no cardinality requirement.
--
-- PUBLICATION COMPLETENESS IS UNCHANGED
--   Neither column is referenced by
--   public.enforce_public_event_is_complete()
--   (20260904000000_unknowns_optional_for_publication.sql), by
--   public.enforce_public_event_has_source()
--   (20260901000000_public_event_requires_source.sql), or by
--   public.enforce_event_publication_lifecycle()
--   (20260831003000_event_publication_lifecycle.sql). This migration does
--   not touch any of those three functions or their triggers. A public
--   event's required-field set is byte-for-byte identical after this
--   migration to before it. `location_precision = 'unknown'` and
--   `scenario_tags = '{}'` are legitimate PERMANENT states for a public
--   event, not merely a private-draft allowance — an event may stay
--   'unknown' precision or carry zero scenario tags forever, exactly as
--   `unknowns` may already stay empty forever after
--   20260904000000_unknowns_optional_for_publication.sql.
--
-- BACKWARD COMPATIBILITY
--   Both columns are NOT NULL with a constant DEFAULT, so this single DDL
--   change applies the default to every existing row (currently ~88 events,
--   all public) — a fast, metadata-only operation for a constant default on
--   both a scalar and an array column in modern Postgres; no table rewrite,
--   no row-by-row backfill, no existing row's meaning changes. No existing
--   application code selects, inserts, or updates either column: every read
--   path (src/lib/events/supabase-source.ts's EVENT_SELECT,
--   src/lib/admin/events.ts's DETAIL_COLUMNS / LIST_COLUMNS) and every write
--   path (src/lib/admin/event-form.ts's writeInputToColumns,
--   supabase/migrations/20260903000000's approve_submission_and_create_draft)
--   uses an explicit column list that does not name either column, so this
--   migration has zero effect on any current query or write until a later,
--   separately reviewed slice deliberately wires them in.
--
-- OUT OF SCOPE / UNCHANGED
--   No event.origin, no coordinates, no PostGIS (all explicitly deferred).
--   No RLS or grant change — new columns fall under the existing curator
--   write / public read policies on `event` automatically; the public read
--   policy is row-scoped by is_public, not column-scoped, so these columns
--   become as publicly readable as any other event column the moment
--   application code chooses to select them, but nothing in this migration
--   does so yet. No admin form, no public page, no TypeScript type, no
--   nhtsa_report / nhtsa_incident_candidate table — all deliberately
--   deferred to separate, reviewed slices.
-- ---------------------------------------------------------------------------

alter table public.event
  add column location_precision text not null default 'unknown'
    check (location_precision in (
      'exact-point',
      'road-or-intersection',
      'local-area',
      'city',
      'region',
      'country',
      'unknown'));

alter table public.event
  add column scenario_tags text[] not null default '{}'
    check (array_position(scenario_tags, null) is null);

-- event_source: NHTSA regulatory-record support — Beta 1.1 Phase 2, Migration A.
--
-- PURPOSE
--   Prepare event_source to carry NHTSA Standing General Order (SGO)
--   regulatory records as evidence, without weakening its existing per-event
--   URL-uniqueness protection for ordinary sources (video, news, X posts).
--   This migration ONLY touches event_source; it creates no new table, no
--   new function, and no new trigger. The nhtsa_report / nhtsa_incident_
--   candidate staging tables and the event-level columns (location_precision,
--   scenario_tags) are deliberately deferred to later, separately-reviewed
--   migrations — this is Migration A of that sequence, and the only one
--   applied by this change.
--
-- WHY THE EXISTING unique (event_id, url) CONSTRAINT NEEDS REVISING
--   NHTSA does not expose a stable public per-incident or per-report URL for
--   its SGO dataset (confirmed). Every NHTSA-derived event_source therefore
--   cites the SAME official NHTSA SGO dataset URL, unchanged and unmodified —
--   no synthetic per-record fragment is appended; the URL is never
--   manipulated to satisfy a database constraint. Multiple regulatory
--   records can legitimately end up attached to one event (for example, two
--   independently filed NHTSA "Same Incident ID" records later judged by a
--   curator to describe one real-world event), which would violate the
--   original blanket unique (event_id, url) constraint. That constraint was
--   designed for a world where a URL identifies one evidence item; for this
--   one source type, it does not.
--
-- THE FIX
--   Replace the single constraint with two PARTIAL unique indexes, split on
--   whether external_record_id is present:
--     * external_record_id IS NULL      -> ordinary sources; unique on
--       (event_id, url) — exactly the original protection, and its effect on
--       every row that exists today is unchanged (this column is new and
--       starts NULL on every existing row).
--     * external_record_id IS NOT NULL  -> regulatory-record sources; unique
--       on (event_id, external_record_id) instead, so the shared NHTSA URL
--       may repeat across an event's sources, while the same regulatory
--       record (identified by its Same Incident ID) can never be attached to
--       one event twice.
--   A companion CHECK requires every source_type = 'regulatory-record' row to
--   carry an external_record_id, so a regulatory source can never fall
--   through to the URL-based branch by omission and collide unexpectedly
--   with another regulatory source that happens to share the same constant
--   NHTSA URL.
--
-- OUT OF SCOPE / UNCHANGED
--   RLS policies and grants on event_source are untouched — new columns fall
--   under the existing curator-gated policies automatically, and anon's
--   privileges (none) are unaffected. No existing row's url, source_type, or
--   any other column is modified. No other table, trigger, or function is
--   touched.

-- ---------------------------------------------------------------------------
-- 1. New column: external_record_id.
-- ---------------------------------------------------------------------------
alter table public.event_source
  add column external_record_id text
    check (external_record_id is null or length(trim(external_record_id)) > 0);

-- ---------------------------------------------------------------------------
-- 2. Extend source_type with 'regulatory-record': a structured regulator
--    incident-dataset record (e.g. an NHTSA SGO entry), distinct from
--    'official-report' (a narrative investigative document such as an NTSB
--    report). Only this one new value is added; every existing value and
--    every existing row is unaffected. The constraint's default name is
--    confirmed against its unnamed definition in
--    20260829235332_observatory_core.sql
--    ("source_type text not null check (source_type in (...))").
-- ---------------------------------------------------------------------------
alter table public.event_source
  drop constraint event_source_source_type_check;

alter table public.event_source
  add constraint event_source_source_type_check
    check (source_type in (
      'x-post','youtube-video','news-article','official-report','other',
      'regulatory-record'));

-- A regulatory-record source must always carry its external identifier — see
-- "THE FIX" above for why this matters to the uniqueness design, not only to
-- data completeness.
alter table public.event_source
  add constraint event_source_regulatory_record_has_external_id
    check (source_type <> 'regulatory-record' or external_record_id is not null);

-- ---------------------------------------------------------------------------
-- 3. Replace the blanket per-event URL uniqueness with the two partial
--    indexes described above. The constraint being dropped is unnamed in its
--    original definition ("unique (event_id, url)" in
--    20260829235332_observatory_core.sql); event_source_event_id_url_key is
--    Postgres's standard default name for an unnamed multi-column UNIQUE
--    table constraint ("<table>_<col1>_<col2>_key").
-- ---------------------------------------------------------------------------
alter table public.event_source
  drop constraint event_source_event_id_url_key;

create unique index event_source_url_unique_per_event
  on public.event_source (event_id, url)
  where external_record_id is null;

create unique index event_source_external_record_id_unique_per_event
  on public.event_source (event_id, external_record_id)
  where external_record_id is not null;

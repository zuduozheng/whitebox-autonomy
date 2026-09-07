-- NHTSA SGO staging tables — Beta 1.1 Phase 2, Migration C.
--
-- PURPOSE
--   Two private, curator-only staging tables that hold NHTSA Standing
--   General Order (SGO) ADS data on its way toward becoming WBA events,
--   without ever mirroring NHTSA's 100+ raw fields into the WBA event
--   ontology:
--
--     nhtsa_report            one row per NHTSA report (latest known
--                              Report Version per Report ID) — "what one
--                              regulatory filing said".
--     nhtsa_incident_candidate one row per consolidated real-world incident
--                              candidate (grouped by NHTSA's Same Incident
--                              ID where present) — "our current working
--                              understanding of one incident, pending
--                              curator review".
--
--   This mirrors, one layer earlier, the existing event / event_source
--   split: a real-world thing (candidate / event) is distinct from the
--   evidence artifacts describing it (report / source), and a candidate's
--   workflow/status fields live on the "real-world thing" row, never
--   duplicated across its contributing reports.
--
--   This migration creates ONLY these two tables, their own RLS, indexes and
--   constraints, and two `set_updated_at` triggers reusing the existing
--   shared function. Nothing about NHTSA data is imported, consolidated, or
--   normalized here — these tables are created empty.
--
-- WHAT THIS MIGRATION DOES NOT TOUCH
--   `event`, `event_source`, `event_submission`, `user_profile`, and every
--   function/trigger/policy/grant belonging to any of them
--   (`public.is_curator()`, `public.set_audit_fields()`,
--   `public.enforce_event_publication_lifecycle()`,
--   `public.enforce_public_event_has_source()`,
--   `public.enforce_public_event_is_complete()`,
--   `public.enforce_event_source_not_last()`,
--   `public.manage_event_submission_review_fields()`,
--   `public.approve_submission_and_create_draft()`) are all unchanged. No
--   `event.origin`, no `event_source.regulatory_dataset`, no coordinates, no
--   PostGIS — all explicitly deferred, per the approved architecture. No
--   promotion/attach function, no admin UI, no importer, no AI normalization
--   — all deliberately out of scope for this migration.
--
-- TRUST BOUNDARY
--   Unlike `event_submission`, there is no public/anonymous actor anywhere
--   in this pipeline: NHTSA data enters WBA only through a curator-run
--   ingestion step (not built here), never through a public form. So, unlike
--   `event_submission`'s anon-INSERT policy, these two tables grant `anon`
--   nothing at all — no policy, no table privilege.
--     anon           -> no access whatsoever.
--     authenticated  -> SELECT, INSERT and UPDATE, all gated by
--                       public.is_curator(). No DELETE policy or privilege
--                       for anyone, matching event_submission's discipline.
--     service_role   -> bypasses RLS by design; unused by the application.
--
-- ORDER
--   nhtsa_incident_candidate is created first because nhtsa_report.
--   incident_candidate_id references it — a single forward reference, no
--   circular dependency, so no ALTER TABLE ADD COLUMN is needed afterward.
--
-- DESIGN NOTES ON SPECIFIC COLUMNS
--   same_incident_id (both tables): genuinely nullable on both. NHTSA's own
--   grouping key is not always present (12 of 2,295 historical rows,
--   confirmed by direct CSV inspection); WBA never fabricates one. A
--   candidate for such a report is a legitimate singleton with
--   same_incident_id = NULL — its identity is its own uuid `id`, nothing
--   more is needed. Uniqueness on nhtsa_incident_candidate.same_incident_id
--   is therefore a PARTIAL unique index, `WHERE same_incident_id IS NOT
--   NULL` — the identical idiom already used for
--   event_source.external_record_id
--   (20260905000000_event_source_regulatory_record.sql), reused rather than
--   reinvented. Singleton-candidate idempotency on repeated import needs no
--   further mechanism here: it rides on nhtsa_report's own
--   UNIQUE (reporting_generation, report_id) key plus its nullable,
--   set-once incident_candidate_id — a report already pointing at a
--   candidate (singleton or not) is simply left alone by a later import run.
--
--   nhtsa_incident_candidate.linked_event_id is DELIBERATELY NOT unique,
--   unlike event_submission.linked_event_id. More than one NHTSA candidate
--   can legitimately resolve to the same WBA event — for example, two
--   separately-filed Same Incident ID groups that a curator later judges to
--   describe one real-world incident both end up pointing at the one event
--   they were attached to. Do not "fix" this into a unique constraint.
--
--   automation_engagement_text (nhtsa_report only): for HISTORICAL rows this
--   must be left NULL by the (not-yet-built) importer. NHTSA's historical
--   "Automation System Engaged?" field was confirmed, by direct CSV
--   inspection, to record system TYPE (ADS / ADAS / Unknown) rather than
--   engagement STATE, so mapping it here would misrepresent what the source
--   says. For CURRENT rows, NHTSA's "Engagement Status" field (Verified
--   Engaged / Verified Not Engaged / Unknown - see Narrative / Alleged
--   Engaged) is the valid structured source and is the intended mapping.
--   Later narrative-based engagement inference for historical records
--   belongs to the calibration / AI-assisted normalization stage, writing
--   into nhtsa_incident_candidate.automation_engagement_text — never into
--   this report-level column. This is an importer-rule note, not something
--   the schema itself can enforce; recorded here as a column-adjacent
--   comment, matching this project's existing convention of documenting
--   field semantics in migration prose rather than introducing a new
--   `COMMENT ON COLUMN` mechanism this codebase has not used before.
--
--   report_submission_date (nhtsa_report only): NHTSA reports this at month
--   precision only in both generations (confirmed: 100% "MON-YYYY", zero
--   exceptions across 3,660 real rows) — a structural fact about this one
--   source, not a per-record variable, so unlike incident_date it has no
--   paired *_precision column. When populated, store the first day of the
--   reported month (YYYY-MM-01), the same month-precision convention already
--   used for occurred_on / published_on elsewhere in this schema.
--
--   raw_row: the complete row as received, for audit and reprocessing. This
--   is the ONLY place any of NHTSA's 100+ raw fields live; every other
--   column on nhtsa_report is a deliberately small, WBA-relevant subset.
--
--   country_code (both tables): hardcoded to 'US' by default — neither NHTSA
--   generation carries a country field, and this source is US-only for this
--   phase (California ingestion is explicitly out of scope).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- nhtsa_incident_candidate
-- ---------------------------------------------------------------------------
create table public.nhtsa_incident_candidate (
  id                                  uuid primary key default gen_random_uuid(),

  -- NHTSA's own grouping key — see "DESIGN NOTES" above. Never fabricated.
  same_incident_id                    text
                                        check (same_incident_id is null or length(trim(same_incident_id)) > 0),

  developer_or_operator               text
                                        check (developer_or_operator is null or length(trim(developer_or_operator)) > 0),
  system_or_vehicle_text              text
                                        check (system_or_vehicle_text is null or length(trim(system_or_vehicle_text)) > 0),
  automation_engagement_text          text
                                        check (automation_engagement_text is null or length(trim(automation_engagement_text)) > 0),

  incident_date                       date,
  incident_date_precision             text not null default 'unknown'
                                        check (incident_date_precision in ('day', 'month', 'year', 'unknown')),
  constraint nhtsa_incident_candidate_incident_date_matches_precision
    check ((incident_date is null) = (incident_date_precision = 'unknown')),

  city                                text check (city is null or length(trim(city)) > 0),
  state                               text check (state is null or length(trim(state)) > 0),
  country_code                        text not null default 'US' check (country_code ~ '^[A-Z]{2}$'),

  roadway_scenario_context            text
                                        check (roadway_scenario_context is null or length(trim(roadway_scenario_context)) > 0),
  environmental_conditions            text
                                        check (environmental_conditions is null or length(trim(environmental_conditions)) > 0),
  crash_interaction_counterpart       text
                                        check (crash_interaction_counterpart is null or length(trim(crash_interaction_counterpart)) > 0),
  subject_vehicle_precrash_movement   text
                                        check (subject_vehicle_precrash_movement is null or length(trim(subject_vehicle_precrash_movement)) > 0),
  other_actor_precrash_movement       text
                                        check (other_actor_precrash_movement is null or length(trim(other_actor_precrash_movement)) > 0),
  injury_outcome_text                 text
                                        check (injury_outcome_text is null or length(trim(injury_outcome_text)) > 0),
  narrative                           text check (narrative is null or length(trim(narrative)) > 0),

  -- AI-proposed draft content, pending curator edit — never required, never
  -- copied verbatim into a WBA event without a curator step. Mirrors the
  -- observed_facts / unknowns array pattern already used on `event`.
  proposed_observed_facts             text[] not null default '{}'
                                        check (array_position(proposed_observed_facts, null) is null),
  proposed_scenario_tags              text[] not null default '{}'
                                        check (array_position(proposed_scenario_tags, null) is null),
  proposed_interpretation             text
                                        check (proposed_interpretation is null or length(trim(proposed_interpretation)) > 0),
  proposed_uncertainties              text[] not null default '{}'
                                        check (array_position(proposed_uncertainties, null) is null),

  dedup_status                        text not null default 'unreviewed'
                                        check (dedup_status in ('unreviewed', 'no-duplicate-found', 'possible-duplicate', 'confirmed-duplicate')),
  possible_duplicate_event_id         uuid references public.event (id) on delete set null,

  status                              text not null default 'pending'
                                        check (status in ('pending', 'accepted', 'rejected', 'invalid-record')),
  curator_note                        text check (curator_note is null or length(trim(curator_note)) > 0),

  -- Deliberately NOT unique — see "DESIGN NOTES" above.
  linked_event_id                     uuid references public.event (id) on delete set null,

  reviewed_by                         uuid references auth.users (id) on delete set null,
  reviewed_at                         timestamptz,

  -- A review stamp only exists once the row has left 'pending' — same
  -- invariant as event_submission_review_stamp_requires_decision
  -- (20260902000000_public_event_submission.sql).
  constraint nhtsa_incident_candidate_review_stamp_requires_decision
    check (reviewed_at is null or status <> 'pending'),

  created_at                          timestamptz not null default now(),
  updated_at                          timestamptz not null default now()
);

-- Uniqueness for a genuine NHTSA Same Incident ID; NULL (singleton) rows are
-- unrestricted in number, matching Postgres's ordinary NULL-is-distinct
-- semantics reinforced explicitly here via the partial WHERE clause.
create unique index nhtsa_incident_candidate_same_incident_id_unique
  on public.nhtsa_incident_candidate (same_incident_id)
  where same_incident_id is not null;

-- Curator queue query: filter by status, newest first — same shape as
-- event_submission_status_created_idx.
create index nhtsa_incident_candidate_status_created_idx
  on public.nhtsa_incident_candidate (status, created_at desc);

-- Reverse-lookup indexes for the two event FKs, matching the
-- event_source_event_id_idx precedent (20260829235332_observatory_core.sql).
create index nhtsa_incident_candidate_linked_event_id_idx
  on public.nhtsa_incident_candidate (linked_event_id);
create index nhtsa_incident_candidate_possible_duplicate_event_id_idx
  on public.nhtsa_incident_candidate (possible_duplicate_event_id);

create trigger nhtsa_incident_candidate_set_updated_at
  before update on public.nhtsa_incident_candidate
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- nhtsa_report
-- ---------------------------------------------------------------------------
create table public.nhtsa_report (
  id                                     uuid primary key default gen_random_uuid(),

  reporting_generation                   text not null
                                            check (reporting_generation in ('historical', 'current')),
  report_id                              text not null check (length(trim(report_id)) > 0),
  report_version                         integer not null check (report_version > 0),

  -- NHTSA's own grouping key — see "DESIGN NOTES" above. Never fabricated.
  same_incident_id                       text
                                            check (same_incident_id is null or length(trim(same_incident_id)) > 0),

  reporting_entity                       text not null check (length(trim(reporting_entity)) > 0),
  developer_or_operator                  text
                                            check (developer_or_operator is null or length(trim(developer_or_operator)) > 0),

  incident_date                          date,
  incident_date_precision                text not null default 'unknown'
                                            check (incident_date_precision in ('day', 'month', 'year', 'unknown')),
  constraint nhtsa_report_incident_date_matches_precision
    check ((incident_date is null) = (incident_date_precision = 'unknown')),

  -- Month precision only for this source — see "DESIGN NOTES" above; no
  -- paired precision column by design.
  report_submission_date                 date,

  city                                    text check (city is null or length(trim(city)) > 0),
  state                                   text check (state is null or length(trim(state)) > 0),
  country_code                            text not null default 'US' check (country_code ~ '^[A-Z]{2}$'),

  -- Historical: leave NULL — see "DESIGN NOTES" above on
  -- automation_engagement_text; do not map NHTSA's historical "Automation
  -- System Engaged?" field here. Current: map from NHTSA's "Engagement
  -- Status" field.
  automation_engagement_text             text
                                            check (automation_engagement_text is null or length(trim(automation_engagement_text)) > 0),

  crash_interaction_counterpart_text     text
                                            check (crash_interaction_counterpart_text is null or length(trim(crash_interaction_counterpart_text)) > 0),
  subject_vehicle_precrash_movement_text text
                                            check (subject_vehicle_precrash_movement_text is null or length(trim(subject_vehicle_precrash_movement_text)) > 0),
  other_actor_precrash_movement_text     text
                                            check (other_actor_precrash_movement_text is null or length(trim(other_actor_precrash_movement_text)) > 0),
  injury_outcome_text                    text
                                            check (injury_outcome_text is null or length(trim(injury_outcome_text)) > 0),
  narrative                              text check (narrative is null or length(trim(narrative)) > 0),

  -- The complete row as received. See "DESIGN NOTES" above — the only place
  -- any of NHTSA's 100+ raw fields live.
  raw_row                                jsonb not null check (jsonb_typeof(raw_row) = 'object'),

  retrieved_on                           date not null,

  incident_candidate_id                  uuid references public.nhtsa_incident_candidate (id) on delete set null,

  created_at                             timestamptz not null default now(),
  updated_at                             timestamptz not null default now(),

  -- Idempotency key: a re-import of the same report updates this row in
  -- place (by report_version) rather than creating a duplicate. See
  -- "DESIGN NOTES" above on singleton-candidate idempotency, which relies on
  -- this constraint plus incident_candidate_id.
  unique (reporting_generation, report_id)
);

-- Grouping-query support: "which reports share this Same Incident ID" during
-- consolidation. Not unique — many reports legitimately share one value, and
-- NULL rows (singletons) are simply not matched by an equality lookup here.
create index nhtsa_report_same_incident_id_idx
  on public.nhtsa_report (same_incident_id);

-- Reverse-lookup: "which reports were grouped into this candidate" — matches
-- the event_source_event_id_idx precedent.
create index nhtsa_report_incident_candidate_id_idx
  on public.nhtsa_report (incident_candidate_id);

create trigger nhtsa_report_set_updated_at
  before update on public.nhtsa_report
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security — see "TRUST BOUNDARY" above.
--
-- RLS is enabled from creation and is never disabled. `anon` receives no
-- policy and no table privilege on either table — there is no public actor
-- in this pipeline. `authenticated` receives SELECT, INSERT and UPDATE, all
-- gated by public.is_curator(), matching the exact policy shape already
-- used for `event` (event_curator_read / event_curator_insert /
-- event_curator_update, 20260831002000_curator_write_layer.sql). No DELETE
-- privilege or policy for anyone.
-- ---------------------------------------------------------------------------
alter table public.nhtsa_incident_candidate enable row level security;
alter table public.nhtsa_report enable row level security;

revoke all privileges on table public.nhtsa_incident_candidate from anon, authenticated;
revoke all privileges on table public.nhtsa_report from anon, authenticated;

grant select, insert, update on table public.nhtsa_incident_candidate to authenticated;
grant select, insert, update on table public.nhtsa_report to authenticated;

create policy nhtsa_incident_candidate_curator_select
  on public.nhtsa_incident_candidate
  for select
  to authenticated
  using ((select public.is_curator()));

create policy nhtsa_incident_candidate_curator_insert
  on public.nhtsa_incident_candidate
  for insert
  to authenticated
  with check ((select public.is_curator()));

create policy nhtsa_incident_candidate_curator_update
  on public.nhtsa_incident_candidate
  for update
  to authenticated
  using ((select public.is_curator()))
  with check ((select public.is_curator()));

create policy nhtsa_report_curator_select
  on public.nhtsa_report
  for select
  to authenticated
  using ((select public.is_curator()));

create policy nhtsa_report_curator_insert
  on public.nhtsa_report
  for insert
  to authenticated
  with check ((select public.is_curator()));

create policy nhtsa_report_curator_update
  on public.nhtsa_report
  for update
  to authenticated
  using ((select public.is_curator()))
  with check ((select public.is_curator()));

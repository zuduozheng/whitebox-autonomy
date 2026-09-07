-- Observatory core schema — MVP.
--
-- Purpose: hold exactly what the nine hand-authored Observatory events and their
-- source links currently contain (see src/lib/events/types.ts and
-- src/lib/events/data/seed.ts), so the local file source can later be replaced
-- by a Supabase-backed source behind the same repository contract.
--
-- This is deliberately NOT the long-term ~22-table model in docs/data-model.md.
-- It introduces two tables only: `event` and `event_source`. No `claim`,
-- `evidence`, `publisher`, `actor`, `ads_platform`/`ads_version`, `location`,
-- `taxonomy`/`taxonomy_term`, `revision`, `user_profile`, or any discovery /
-- submission table. Those stay the approved target and are additive later.
--
-- Scientific distinctions are preserved as separate, independently-settable
-- columns: automation status, event type, valence/outcome, causation status and
-- review status. Unknown information stays NULL / 'unknown' and is never
-- inferred (enforced by CHECK constraints below).
--
-- Controlled vocabularies are `text` + CHECK, with values byte-identical to the
-- TypeScript string-union literals, so mapping needs no translation layer. When
-- the `taxonomy_term` model is actually built, these become FK columns in a
-- separate migration.
--
-- This migration does not seed data and does not touch application code.

-- ---------------------------------------------------------------------------
-- Shared: keep `updated_at` honest on every row update.
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- event — the real-world occurrence; the stable, citable anchor.
-- ---------------------------------------------------------------------------
create table event (
  id                        uuid primary key default gen_random_uuid(),

  -- Public, citable identifier. Immutable once published (not trigger-enforced
  -- in the MVP). `id` is internal and never exposed.
  slug                      text not null unique
                              check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  title                     text not null check (length(trim(title)) > 0),
  summary                   text not null check (length(trim(summary)) > 0),

  -- Partial date: a real date pinned to the period start, plus its precision.
  -- 'unknown' precision <=> NULL date. Coarser precisions store YYYY-01-01 /
  -- YYYY-MM-01, matching partialDateSortKey() in src/lib/events/format.ts.
  occurred_on               date,
  occurred_on_precision     text not null default 'unknown'
                              check (occurred_on_precision in ('day','month','year','unknown')),
  constraint occurred_on_matches_precision
    check ((occurred_on is null) = (occurred_on_precision = 'unknown')),

  -- Location as described by sources. No `location` table, no PostGIS yet; a
  -- geometry column is added in the map step.
  location_text             text check (location_text is null or length(trim(location_text)) > 0),
  location_country_code     text check (location_country_code ~ '^[A-Z]{2}$'),

  -- Free text, as named by sources; never auto-canonicalised.
  developer_or_operator     text not null check (length(trim(developer_or_operator)) > 0),
  system_name               text check (system_name is null or length(trim(system_name)) > 0),

  -- Whether the driving-automation feature was engaged. Independent of causation.
  automation_status         text not null default 'unknown' check (automation_status in (
                              'driving-automation-engaged-confirmed',
                              'driving-automation-engaged-reported',
                              'driving-automation-status-uncertain',
                              'driving-automation-not-engaged',
                              'unknown')),

  -- A version string exists only when its knowledge level is stated/approximate.
  system_version            text check (system_version is null or length(trim(system_version)) > 0),
  system_version_knowledge  text not null default 'unknown'
                              check (system_version_knowledge in ('stated','approximate','unknown')),
  constraint system_version_needs_knowledge
    check (system_version is null or system_version_knowledge <> 'unknown'),

  event_type                text not null check (event_type in (
                              'collision',
                              'near-miss-or-safety-critical',
                              'unexpected-or-inappropriate-behaviour',
                              'unnecessary-stop-braking-or-hesitation',
                              'traffic-rule-or-infrastructure-interpretation',
                              'vulnerable-road-user-interaction',
                              'emergency-vehicle-interaction',
                              'traffic-disruption-or-obstruction',
                              'successful-challenging-interaction',
                              'other')),

  -- Outcome/valence. Deliberately NOT cross-constrained with event_type.
  valence                   text not null check (valence in (
                              'failure-or-challenging',
                              'successful-handling',
                              'neutral-or-unclear')),

  -- Ordered lists rendered directly by the event page. `cardinality` (not
  -- `array_length`) so an empty array is rejected rather than yielding NULL.
  observed_facts            text[] not null
                              check (cardinality(observed_facts) >= 1
                                     and array_position(observed_facts, null) is null),
  unknowns                  text[] not null
                              check (cardinality(unknowns) >= 1
                                     and array_position(unknowns, null) is null),

  interpretation            text check (interpretation is null or length(trim(interpretation)) > 0),

  -- Involvement is never by itself a cause; stays 'undetermined' unless a source
  -- supports more, with the supporting reasoning in causation_note.
  causation_status          text not null default 'undetermined' check (causation_status in (
                              'undetermined',
                              'automation-system-contributed',
                              'other-party-contributed',
                              'shared-or-multiple-factors',
                              'not-applicable')),
  causation_note            text check (causation_note is null or length(trim(causation_note)) > 0),

  -- Standing of the record. No default: it must be a deliberate choice.
  review_status             text not null check (review_status in (
                              'curator-reviewed','verified','disputed')),

  -- Editorial "last reviewed or changed" date, curator-controlled. Distinct from
  -- the row's `updated_at` system timestamp below.
  record_updated            date not null,

  -- Public visibility gate for RLS. All current records are public.
  is_public                 boolean not null default true,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create trigger event_set_updated_at
  before update on event
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- event_source — sources for one event. The sources are the evidence.
--
-- MVP simplification: a source belongs to one event via a direct FK. The
-- long-term model has a standalone `source` reused across events through an
-- `evidence` associative object (which also carries stance). Naming this table
-- `event_source` keeps the `source` name free for that later split.
-- ---------------------------------------------------------------------------
create table event_source (
  id                      uuid primary key default gen_random_uuid(),
  event_id                uuid not null references event (id) on delete cascade,

  url                     text not null check (url ~ '^https?://'),
  source_type             text not null check (source_type in (
                            'x-post','youtube-video','news-article','official-report','other')),
  publisher               text check (publisher is null or length(trim(publisher)) > 0),
  label                   text check (label is null or length(trim(label)) > 0),

  published_on            date,
  published_on_precision  text not null default 'unknown'
                            check (published_on_precision in ('day','month','year','unknown')),
  constraint published_on_matches_precision
    check ((published_on is null) = (published_on_precision = 'unknown')),

  retrieved_on            date,
  note                    text check (note is null or length(trim(note)) > 0),

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- Guard against adding the same link twice to one event. Display order is
  -- insertion order (created_at, id); a `position` column can be added if manual
  -- reordering is ever needed.
  unique (event_id, url)
);

create trigger event_source_set_updated_at
  before update on event_source
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Indexes: the FK lookup the event page needs, plus the known query axes that
-- filtering/sorting in src/lib/events/repository.ts can move onto later.
-- ---------------------------------------------------------------------------
create index event_source_event_id_idx on event_source (event_id);
create index event_event_type_idx      on event (event_type);
create index event_valence_idx         on event (valence);
create index event_occurred_on_idx     on event (occurred_on);

-- ---------------------------------------------------------------------------
-- Row-Level Security: public read, server-only write.
--
--   anon           -> the website's public reads
--   authenticated  -> a signed-in curator (none exist yet)
--   service_role   -> trusted server-side code (migrations, future /admin
--                     Server Actions, the seed step); bypasses RLS by design
--
-- RLS is enabled and never disabled. Public SELECT is restricted to
-- is_public = true. No INSERT/UPDATE/DELETE policy is created, so anon and
-- authenticated cannot write at all; the only writer is service_role. When
-- Supabase Auth + a `user_profile` role table are introduced, a later migration
-- adds role-gated `authenticated` write policies.
-- ---------------------------------------------------------------------------
alter table event        enable row level security;
alter table event_source enable row level security;

grant select on event, event_source to anon, authenticated;

-- Defense in depth: RLS already blocks writes (no permissive write policy), but
-- Supabase's default privileges grant write access to these roles on new tables
-- in `public`. Revoke it so table privileges match the server-only-write intent.
revoke insert, update, delete on event, event_source from anon, authenticated;

create policy event_public_read
  on event
  for select
  to anon, authenticated
  using (is_public = true);

-- Sources are visible only for events that are themselves public.
create policy event_source_public_read
  on event_source
  for select
  to anon, authenticated
  using (exists (
    select 1 from event e
    where e.id = event_source.event_id
      and e.is_public = true
  ));

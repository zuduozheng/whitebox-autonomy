-- WBA Beta map — location/geography foundation. Data + schema only; no /map
-- page, no PostGIS, no spatial index, no per-event coordinate on `event`
-- itself, no automated/live geocoding, no trigger, no materialized view, no
-- scheduled/cron refresh. Approved scope: see the architecture report this
-- migration implements.
--
-- WHAT THIS ADDS
--   location_lookup            a small (93-row) reference table of
--                      representative DISPLAY coordinates for every country,
--                      US state, and city actually named by the current
--                      public corpus. Never a claim about an exact incident
--                      location — see migration/map/location-lookup-data.mjs
--                      for the source/method of every coordinate (state
--                      capitals, commonly published country/city reference
--                      points).
--   curated_location_override  a small (16-row) reference table classifying
--                      every distinct curated-event location_text this
--                      migration currently knows about — see section C.
--   event_map_public   a read-only VIEW (not a table, not materialized) that
--                      resolves each public event's representative point
--                      LIVE, at query time, directly from `event` +
--                      location_lookup + curated_location_override. It has
--                      no stored state of its own: every SELECT against it
--                      re-reads current `event` rows, so a newly added
--                      event, an edited location_text, or a newly added
--                      location_lookup row is reflected on the very next
--                      query — automatically, with no trigger, no rebuild
--                      script, and no manual step for anyone to remember.
--                      See "Why a live view, not a cache table" below.
--   event.location_precision  backfilled for the 86 curated events (all of
--                      which currently read 'unknown' — see architecture
--                      report finding #3) to what their EXISTING location_text
--                      actually supports. NHTSA source-derived events are
--                      untouched: the normalization rulebook already sets
--                      this field correctly for all 2,837 of them. This is a
--                      one-time correction of a pre-existing data-quality
--                      gap in a real, mutable fact column — NOT a derived
--                      map cache, and not subject to the staleness concern
--                      below (a future curated event's precision is set by
--                      whatever writes it, same as any other column).
--
-- WHY A LIVE VIEW, NOT A CACHE TABLE
--   An earlier draft of this migration precomputed each event's point once
--   into a table (event_map_point) at migration time. That was rejected on
--   review: a precomputed table has no mechanism to notice a new event, an
--   edited location_text, or a newly added location_lookup row after the
--   migration runs, and adding one (a trigger replicating the whole
--   resolution algorithm, or a script someone has to remember to re-run)
--   trades simplicity for a synchronization problem this project does not
--   need at ~3,000 events. A plain (non-materialized) view has no such gap
--   by construction: it always computes its answer from whatever `event` /
--   location_lookup / curated_location_override contain right now.
--
-- ALGORITHM (city -> region -> country -> unmapped fallback)
--   Implemented twice, deliberately: once here in SQL (event_map_public's
--   view definition, section D) and once in JS (migration/map/resolve.mjs,
--   used to test the algorithm against the real corpus with no live
--   Postgres instance available in this environment — see
--   migration/map/verify-corpus.mjs and its test suite). The two are
--   hand-verified to agree; the JS run's exact counts are quoted in the
--   architecture report as this view's expected output.
--
--   - source-derived (NHTSA): location_text is mechanically "City, ST, US" /
--     "ST, US" / "US" (docs/nhtsa-normalization-rulebook.md). A deterministic
--     split_part parse tries the city lookup key first, then region, then
--     country — whichever exists. Confirmed against the live corpus: zero
--     malformed rows out of 2,838.
--   - curated (86 events, only 16 distinct (location_text,
--     location_country_code) pairs exist): explicitly classified in
--     curated_location_override (section C), matching
--     migration/map/resolve.mjs's CURATED_OVERRIDES table exactly. Not a
--     generic parser — with only 16 known values, an auditable per-value
--     table is simpler and safer than pattern-matching free text that might
--     mis-parse a future shape. A future curated event with a location_text
--     not yet in curated_location_override simply resolves to no row in the
--     view (safely unmapped) until a row is added for it — a plain INSERT,
--     not a new migration or code change — never a silent guess.
--
-- EXPLICITLY OUT OF SCOPE (per approved architecture; see report)
--   No PostGIS, no spatial extension, no GiST/spatial index — a plain query
--   over a few-thousand-row table joined to two small (<=100-row) reference
--   tables is trivial for Postgres at this scale; reconsider only if the
--   corpus grows by orders of magnitude. No coordinate is ever added to
--   `event` itself. No automated geocoding pipeline: every coordinate here
--   is a one-time, hand-reviewed reference value, not a live API call. No
--   trigger, no materialized view, no cron/scheduled refresh — the live view
--   needs none of them.
--
-- NOT APPLIED YET. Prepared and verified locally (see architecture report);
-- requires review before being pushed to any database, local or production.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- A. location_lookup
-- ===========================================================================
create table public.location_lookup (
  key           text primary key,
  level         text not null check (level in ('city', 'region', 'country')),
  country_code  text not null check (country_code ~ '^[A-Z]{2}$'),
  region_code   text,
  city_name     text,
  latitude      double precision not null check (latitude between -90 and 90),
  longitude     double precision not null check (longitude between -180 and 180),
  display_name  text not null check (length(trim(display_name)) > 0),
  created_at    timestamptz not null default now(),
  -- A country row carries neither region nor city; a region row carries a
  -- region_code but no city; a city row always carries a city_name (a US
  -- city also carries region_code, a non-US city in this corpus does not —
  -- see location-lookup-data.mjs).
  constraint location_lookup_level_shape check (
    (level = 'country' and region_code is null and city_name is null) or
    (level = 'region'  and region_code is not null and city_name is null) or
    (level = 'city'    and city_name is not null)
  )
);

comment on table public.location_lookup is
  'Representative DISPLAY coordinates for the map — country/region/city reference points, not incident-specific geocoding. See migration/map/location-lookup-data.mjs for source/method.';

-- Non-sensitive reference data (place names + coordinates only, no event
-- content): public read, server-only write, same posture as every other
-- table in this project.
alter table public.location_lookup enable row level security;

create policy location_lookup_public_read
  on public.location_lookup
  for select
  to anon, authenticated
  using (true);

grant select on public.location_lookup to anon, authenticated;
revoke insert, update, delete on public.location_lookup from anon, authenticated;

-- Generated by migration/map/build-location-lookup-sql.mjs from
-- migration/map/location-lookup-data.mjs. Do not hand-edit these VALUES —
-- edit the data file and regenerate, so the SQL and the JS-tested data can
-- never drift apart.
insert into public.location_lookup
  (key, level, country_code, region_code, city_name, latitude, longitude, display_name)
values
  ('US', 'country', 'US', null, null, 39.8283, -98.5795, 'United States'),
  ('AU', 'country', 'AU', null, null, -25.2744, 133.7751, 'Australia'),
  ('CA', 'country', 'CA', null, null, 56.1304, -106.3468, 'Canada'),
  ('CN', 'country', 'CN', null, null, 35.8617, 104.1954, 'China'),
  ('AZ|US', 'region', 'US', 'AZ', null, 33.4484, -112.074, 'Arizona, US'),
  ('CA|US', 'region', 'US', 'CA', null, 38.5816, -121.4944, 'California, US'),
  ('TX|US', 'region', 'US', 'TX', null, 30.2672, -97.7431, 'Texas, US'),
  ('NV|US', 'region', 'US', 'NV', null, 39.1638, -119.7674, 'Nevada, US'),
  ('GA|US', 'region', 'US', 'GA', null, 33.749, -84.388, 'Georgia, US'),
  ('FL|US', 'region', 'US', 'FL', null, 30.4383, -84.2807, 'Florida, US'),
  ('MI|US', 'region', 'US', 'MI', null, 42.7325, -84.5555, 'Michigan, US'),
  ('DC|US', 'region', 'US', 'DC', null, 38.9072, -77.0369, 'District of Columbia, US'),
  ('MN|US', 'region', 'US', 'MN', null, 44.9537, -93.09, 'Minnesota, US'),
  ('TN|US', 'region', 'US', 'TN', null, 36.1627, -86.7816, 'Tennessee, US'),
  ('PA|US', 'region', 'US', 'PA', null, 40.2732, -76.8867, 'Pennsylvania, US'),
  ('CO|US', 'region', 'US', 'CO', null, 39.7392, -104.9903, 'Colorado, US'),
  ('NM|US', 'region', 'US', 'NM', null, 35.687, -105.9378, 'New Mexico, US'),
  ('WA|US', 'region', 'US', 'WA', null, 47.0379, -122.9007, 'Washington, US'),
  ('IN|US', 'region', 'US', 'IN', null, 39.7684, -86.1581, 'Indiana, US'),
  ('MS|US', 'region', 'US', 'MS', null, 32.2988, -90.1848, 'Mississippi, US'),
  ('AR|US', 'region', 'US', 'AR', null, 34.7465, -92.2896, 'Arkansas, US'),
  ('OH|US', 'region', 'US', 'OH', null, 39.9612, -82.9988, 'Ohio, US'),
  ('RI|US', 'region', 'US', 'RI', null, 41.824, -71.4128, 'Rhode Island, US'),
  ('OK|US', 'region', 'US', 'OK', null, 35.4676, -97.5164, 'Oklahoma, US'),
  ('WY|US', 'region', 'US', 'WY', null, 41.14, -104.8202, 'Wyoming, US'),
  ('SAN FRANCISCO|CA|US', 'city', 'US', 'CA', 'SAN FRANCISCO', 37.7749, -122.4194, 'San Francisco, CA, US'),
  ('LOS ANGELES|CA|US', 'city', 'US', 'CA', 'LOS ANGELES', 34.0522, -118.2437, 'Los Angeles, CA, US'),
  ('AUSTIN|TX|US', 'city', 'US', 'TX', 'AUSTIN', 30.2672, -97.7431, 'Austin, TX, US'),
  ('PHOENIX|AZ|US', 'city', 'US', 'AZ', 'PHOENIX', 33.4484, -112.074, 'Phoenix, AZ, US'),
  ('TEMPE|AZ|US', 'city', 'US', 'AZ', 'TEMPE', 33.4255, -111.94, 'Tempe, AZ, US'),
  ('ATLANTA|GA|US', 'city', 'US', 'GA', 'ATLANTA', 33.749, -84.388, 'Atlanta, GA, US'),
  ('LAS VEGAS|NV|US', 'city', 'US', 'NV', 'LAS VEGAS', 36.1699, -115.1398, 'Las Vegas, NV, US'),
  ('SCOTTSDALE|AZ|US', 'city', 'US', 'AZ', 'SCOTTSDALE', 33.4942, -111.9261, 'Scottsdale, AZ, US'),
  ('DALLAS|TX|US', 'city', 'US', 'TX', 'DALLAS', 32.7767, -96.797, 'Dallas, TX, US'),
  ('MIAMI|FL|US', 'city', 'US', 'FL', 'MIAMI', 25.7617, -80.1918, 'Miami, FL, US'),
  ('SANTA MONICA|CA|US', 'city', 'US', 'CA', 'SANTA MONICA', 34.0195, -118.4912, 'Santa Monica, CA, US'),
  ('HOUSTON|TX|US', 'city', 'US', 'TX', 'HOUSTON', 29.7604, -95.3698, 'Houston, TX, US'),
  ('CHANDLER|AZ|US', 'city', 'US', 'AZ', 'CHANDLER', 33.3062, -111.8413, 'Chandler, AZ, US'),
  ('MESA|AZ|US', 'city', 'US', 'AZ', 'MESA', 33.4152, -111.8315, 'Mesa, AZ, US'),
  ('CULVER CITY|CA|US', 'city', 'US', 'CA', 'CULVER CITY', 34.0211, -118.3965, 'Culver City, CA, US'),
  ('MOUNTAIN VIEW|CA|US', 'city', 'US', 'CA', 'MOUNTAIN VIEW', 37.3861, -122.0839, 'Mountain View, CA, US'),
  ('INGLEWOOD|CA|US', 'city', 'US', 'CA', 'INGLEWOOD', 33.9617, -118.3531, 'Inglewood, CA, US'),
  ('BEVERLY HILLS|CA|US', 'city', 'US', 'CA', 'BEVERLY HILLS', 34.0736, -118.4004, 'Beverly Hills, CA, US'),
  ('WEST HOLLYWOOD|CA|US', 'city', 'US', 'CA', 'WEST HOLLYWOOD', 34.09, -118.3617, 'West Hollywood, CA, US'),
  ('PARADISE|NV|US', 'city', 'US', 'NV', 'PARADISE', 36.0839, -115.1425, 'Paradise, NV, US'),
  ('VENICE|CA|US', 'city', 'US', 'CA', 'VENICE', 33.985, -118.4695, 'Venice, CA, US'),
  ('PALO ALTO|CA|US', 'city', 'US', 'CA', 'PALO ALTO', 37.4419, -122.143, 'Palo Alto, CA, US'),
  ('DALY CITY|CA|US', 'city', 'US', 'CA', 'DALY CITY', 37.6879, -122.4702, 'Daly City, CA, US'),
  ('SAN JOSE|CA|US', 'city', 'US', 'CA', 'SAN JOSE', 37.3382, -121.8863, 'San Jose, CA, US'),
  ('ORLANDO|FL|US', 'city', 'US', 'FL', 'ORLANDO', 28.5383, -81.3792, 'Orlando, FL, US'),
  ('ARLINGTON|TX|US', 'city', 'US', 'TX', 'ARLINGTON', 32.7357, -97.1081, 'Arlington, TX, US'),
  ('SOUTH SAN FRANCISCO|CA|US', 'city', 'US', 'CA', 'SOUTH SAN FRANCISCO', 37.6547, -122.4077, 'South San Francisco, CA, US'),
  ('SANTA CLARA|CA|US', 'city', 'US', 'CA', 'SANTA CLARA', 37.3541, -121.9552, 'Santa Clara, CA, US'),
  ('WASHINGTON|DC|US', 'city', 'US', 'DC', 'WASHINGTON', 38.9072, -77.0369, 'Washington, DC, US'),
  ('ANN ARBOR|MI|US', 'city', 'US', 'MI', 'ANN ARBOR', 42.2808, -83.743, 'Ann Arbor, MI, US'),
  ('SPRING VALLEY|NV|US', 'city', 'US', 'NV', 'SPRING VALLEY', 36.1097, -115.2564, 'Spring Valley, NV, US'),
  ('SUNNYVALE|CA|US', 'city', 'US', 'CA', 'SUNNYVALE', 37.3688, -122.0363, 'Sunnyvale, CA, US'),
  ('NASHVILLE|TN|US', 'city', 'US', 'TN', 'NASHVILLE', 36.1627, -86.7816, 'Nashville, TN, US'),
  ('PARADISE VALLEY|AZ|US', 'city', 'US', 'AZ', 'PARADISE VALLEY', 33.5312, -111.9412, 'Paradise Valley, AZ, US'),
  ('JACKSONVILLE|FL|US', 'city', 'US', 'FL', 'JACKSONVILLE', 30.3322, -81.6557, 'Jacksonville, FL, US'),
  ('REDWOOD CITY|CA|US', 'city', 'US', 'CA', 'REDWOOD CITY', 37.4852, -122.2364, 'Redwood City, CA, US'),
  ('PEACHTREE CORNERS|GA|US', 'city', 'US', 'GA', 'PEACHTREE CORNERS', 33.9698, -84.2227, 'Peachtree Corners, GA, US'),
  ('MIAMI BEACH|FL|US', 'city', 'US', 'FL', 'MIAMI BEACH', 25.7907, -80.13, 'Miami Beach, FL, US'),
  ('GRAND RAPIDS|MN|US', 'city', 'US', 'MN', 'GRAND RAPIDS', 47.2372, -93.53, 'Grand Rapids, MN, US'),
  ('SAN MATEO|CA|US', 'city', 'US', 'CA', 'SAN MATEO', 37.563, -122.3255, 'San Mateo, CA, US'),
  ('SAN ANTONIO|TX|US', 'city', 'US', 'TX', 'SAN ANTONIO', 29.4241, -98.4936, 'San Antonio, TX, US'),
  ('ENNIS|TX|US', 'city', 'US', 'TX', 'ENNIS', 32.3293, -96.6252, 'Ennis, TX, US'),
  ('SAN BRUNO|CA|US', 'city', 'US', 'CA', 'SAN BRUNO', 37.6305, -122.4111, 'San Bruno, CA, US'),
  ('FREMONT|CA|US', 'city', 'US', 'CA', 'FREMONT', 37.5485, -121.9886, 'Fremont, CA, US'),
  ('HUNTSVILLE|TX|US', 'city', 'US', 'TX', 'HUNTSVILLE', 30.7235, -95.5508, 'Huntsville, TX, US'),
  ('BRISBANE|CA|US', 'city', 'US', 'CA', 'BRISBANE', 37.6838, -122.3997, 'Brisbane, CA, US'),
  ('EMERYVILLE|CA|US', 'city', 'US', 'CA', 'EMERYVILLE', 37.8313, -122.2852, 'Emeryville, CA, US'),
  ('MENLO PARK|CA|US', 'city', 'US', 'CA', 'MENLO PARK', 37.453, -122.1817, 'Menlo Park, CA, US'),
  ('BURLINGAME|CA|US', 'city', 'US', 'CA', 'BURLINGAME', 37.5779, -122.3484, 'Burlingame, CA, US'),
  ('SUN CITY|AZ|US', 'city', 'US', 'AZ', 'SUN CITY', 33.5964, -112.2716, 'Sun City, AZ, US'),
  ('SACATON|AZ|US', 'city', 'US', 'AZ', 'SACATON', 33.0834, -111.7423, 'Sacaton, AZ, US'),
  ('STREETMAN|TX|US', 'city', 'US', 'TX', 'STREETMAN', 31.9793, -96.3197, 'Streetman, TX, US'),
  ('BUFFALO|TX|US', 'city', 'US', 'TX', 'BUFFALO', 31.4571, -96.0625, 'Buffalo, TX, US'),
  ('ALEDO|TX|US', 'city', 'US', 'TX', 'ALEDO', 32.6976, -97.6011, 'Aledo, TX, US'),
  ('GOLDEN|CO|US', 'city', 'US', 'CO', 'GOLDEN', 39.7555, -105.2211, 'Golden, CO, US'),
  ('CENTERVILLE|TX|US', 'city', 'US', 'TX', 'CENTERVILLE', 31.2604, -95.9536, 'Centerville, TX, US'),
  ('MARINA DEL REY|CA|US', 'city', 'US', 'CA', 'MARINA DEL REY', 33.9802, -118.4517, 'Marina Del Rey, CA, US'),
  ('INDIANAPOLIS|IN|US', 'city', 'US', 'IN', 'INDIANAPOLIS', 39.7684, -86.1581, 'Indianapolis, IN, US'),
  ('PITTSBURGH|PA|US', 'city', 'US', 'PA', 'PITTSBURGH', 40.4406, -79.9959, 'Pittsburgh, PA, US'),
  ('GILBERT|AZ|US', 'city', 'US', 'AZ', 'GILBERT', 33.3528, -111.789, 'Gilbert, AZ, US'),
  ('DENVER|CO|US', 'city', 'US', 'CO', 'DENVER', 39.7392, -104.9903, 'Denver, CO, US'),
  ('SPRING|TX|US', 'city', 'US', 'TX', 'SPRING', 30.0799, -95.4172, 'Spring, TX, US'),
  ('GUADALUPE|AZ|US', 'city', 'US', 'AZ', 'GUADALUPE', 33.3542, -111.9598, 'Guadalupe, AZ, US'),
  ('WASHINGTON DC|DC|US', 'city', 'US', 'DC', 'WASHINGTON DC', 38.9072, -77.0369, 'Washington DC, DC, US'),
  ('PHILADELPHIA|PA|US', 'city', 'US', 'PA', 'PHILADELPHIA', 39.9526, -75.1652, 'Philadelphia, PA, US'),
  ('SEATTLE|WA|US', 'city', 'US', 'WA', 'SEATTLE', 47.6062, -122.3321, 'Seattle, WA, US'),
  ('VANCOUVER|CA', 'city', 'CA', null, 'VANCOUVER', 49.2827, -123.1207, 'Vancouver, Canada'),
  ('QUZHOU|CN', 'city', 'CN', null, 'QUZHOU', 28.97, 118.87, 'Quzhou, China');

-- ===========================================================================
-- B. Backfill event.location_precision for curated events
--
-- All 86 curated events currently read location_precision = 'unknown' — the
-- column was added later (20260906000000) with a blanket default and never
-- backfilled for this cohort, even though 75 of the 86 already carry a
-- usable location_text. This sets each of the 16 distinct existing
-- (location_text, location_country_code) pairs to what that text actually
-- supports — never finer. Matches migration/map/resolve.mjs's
-- CURATED_OVERRIDES table exactly (see its per-row rationale comments); keep
-- the two in sync if either is ever revisited.
--
-- Idempotent and scoped: only touches origin = 'curated' rows that still
-- read 'unknown', and sets nothing else. A curator who has since manually
-- set a different precision is left untouched.
-- ===========================================================================
with curated_precision (location_text, location_country_code, precision) as (
  values
    ('Austin, Texas, USA', 'US', 'city'),
    ('Australia', 'AU', 'country'),
    (null, null, 'unknown'),
    ('Bruce Highway, Australia', 'AU', 'road-or-intersection'),
    ('Brisbane Inner City Bypass, Australia', 'AU', 'road-or-intersection'),
    ('University of Queensland, St Lucia, Brisbane, Australia', 'AU', 'local-area'),
    ('GA-575, north of Atlanta, Georgia, USA', 'US', 'road-or-intersection'),
    ('Canada', 'CA', 'country'),
    ('Reported as probably Thailand; not confirmed', null, 'unknown'),
    ('United States', 'US', 'country'),
    ('Vancouver, Canada', 'CA', 'city'),
    ('Quzhou, China', 'CN', 'city'),
    ('Phoenix, Arizona, USA', 'US', 'city'),
    ('Austin, Texas', 'US', 'city'),
    ('Santa Monica, California, USA', 'US', 'city'),
    ('San Francisco, California, USA', 'US', 'city')
)
update public.event e
set location_precision = cp.precision
from curated_precision cp
where e.origin = 'curated'
  and e.location_text is not distinct from cp.location_text
  and e.location_country_code is not distinct from cp.location_country_code
  and e.location_precision = 'unknown';

-- ===========================================================================
-- C. curated_location_override
--
-- The explicit, auditable classification of every distinct curated-event
-- (location_text, location_country_code) pair this migration currently
-- knows about — 16 rows, matching migration/map/resolve.mjs's
-- CURATED_OVERRIDES exactly (see its per-row rationale comments; keep the
-- two in sync if either is revisited). A null lookup_key (the 11 no-location
-- events, and the one explicitly-uncertain "probably Thailand; not
-- confirmed" guess) means "known to be unmappable" — event_map_public's
-- join against this table naturally produces no row for those events
-- (SQL null never equals null), so they stay unmapped.
--
-- Plain reference data, not a cache: adding a row here for some FUTURE
-- curated event's new location_text is a normal data change (an INSERT),
-- and event_map_public picks it up on the next query with no other action —
-- same as adding a new location_lookup row. What this table does NOT do is
-- eliminate the need for that INSERT: a curated event's free-text location
-- can only be resolved once a curator/reviewer has explicitly classified
-- that exact text (see the architecture discussion on why curated locations
-- are hand-classified rather than parsed). A new curated event whose
-- location_text already exactly matches an existing row here (e.g. another
-- "Austin, Texas, USA") resolves immediately with no action at all.
-- ===========================================================================
create table public.curated_location_override (
  location_text         text,
  location_country_code text,
  lookup_key            text references public.location_lookup (key),
  rationale             text not null check (length(trim(rationale)) > 0),
  constraint curated_location_override_natural_key
    unique nulls not distinct (location_text, location_country_code)
);

comment on table public.curated_location_override is
  'Explicit classification of each distinct curated-event location_text seen so far. lookup_key null = known-unmappable (e.g. no location text, or an explicitly uncertain guess) — never geocoded. Read live by event_map_public; add a row for a new curated location_text as it appears.';

alter table public.curated_location_override enable row level security;

create policy curated_location_override_public_read
  on public.curated_location_override
  for select
  to anon, authenticated
  using (true);

grant select on public.curated_location_override to anon, authenticated;
revoke insert, update, delete on public.curated_location_override from anon, authenticated;

insert into public.curated_location_override
  (location_text, location_country_code, lookup_key, rationale)
values
  ('Austin, Texas, USA', 'US', 'AUSTIN|TX|US',
    'Named city + state + country, unambiguous.'),
  ('Australia', 'AU', 'AU',
    'Bare country name; text supports no finer level.'),
  (null, null, null,
    'No location text at all -- genuinely unmapped, not a parsing gap.'),
  ('Bruce Highway, Australia', 'AU', 'AU',
    'Names a specific road, but it runs ~1,700km through Queensland -- no ' ||
    'single coordinate would be defensible, so this falls back to the ' ||
    'country dot rather than guessing a point along it.'),
  ('Brisbane Inner City Bypass, Australia', 'AU', 'AU',
    'Names a specific road; no city/region lookup row exists for it in ' ||
    'this Beta pass, so it falls back to the country dot. Not hand-mapped ' ||
    'to Brisbane specifically -- that would be inferring a city this text ' ||
    'does not itself establish.'),
  ('University of Queensland, St Lucia, Brisbane, Australia', 'AU', 'AU',
    'Names a specific campus/suburb, but no lookup row exists for it, so ' ||
    'it falls back to the country dot.'),
  ('GA-575, north of Atlanta, Georgia, USA', 'US', 'GA|US',
    'Names a route explicitly NOT in Atlanta ("north of" it), so it must ' ||
    'not resolve to the Atlanta city point. Georgia is named explicitly, ' ||
    'so it falls back to the Georgia state point.'),
  ('Canada', 'CA', 'CA',
    'Bare country name.'),
  ('Reported as probably Thailand; not confirmed', null, null,
    'Explicitly hedged/unconfirmed by the curator. Uncertain text like ' ||
    'this is never geocoded -- stays unmapped for curator review.'),
  ('United States', 'US', 'US',
    'Bare country name.'),
  ('Vancouver, Canada', 'CA', 'VANCOUVER|CA',
    'Named city + country, unambiguous.'),
  ('Quzhou, China', 'CN', 'QUZHOU|CN',
    'Named city + country, unambiguous.'),
  ('Phoenix, Arizona, USA', 'US', 'PHOENIX|AZ|US',
    'Named city + state + country, unambiguous.'),
  ('Austin, Texas', 'US', 'AUSTIN|TX|US',
    'Named city + state (country from location_country_code column).'),
  ('Santa Monica, California, USA', 'US', 'SANTA MONICA|CA|US',
    'Named city + state + country, unambiguous.'),
  ('San Francisco, California, USA', 'US', 'SAN FRANCISCO|CA|US',
    'Named city + state + country, unambiguous.');

-- ===========================================================================
-- D. event_map_public — live-resolving view. No table backs this; every
-- SELECT recomputes the answer from current data, so a new event, an edited
-- location_text, or a newly added location_lookup /
-- curated_location_override row is reflected on the very next query.
--
-- security_invoker = true (Postgres 15+): the view runs with the QUERYING
-- role's own privileges/RLS, not its owner's — required so this view can
-- never become a way to see a private draft's approximate location. The
-- explicit `where e.is_public = true` in each branch below is
-- defense-in-depth on top of that: RLS on `event` already independently
-- restricts anon/authenticated to is_public rows, matching this project's
-- established practice of layering an explicit guard even where RLS alone
-- would already be sufficient (e.g. the write-grant revokes above).
--
-- Two branches, UNION ALL, matching resolve.mjs's dispatch-by-origin design
-- exactly (never a single parser trying to handle both shapes):
--
--   - curated: joined against curated_location_override on the event's
--     exact (location_text, location_country_code); a null lookup_key there
--     produces no row here (unmapped), by plain SQL null semantics — no
--     special-case WHERE needed.
--   - source-derived: the same deterministic split_part parse used by the
--     earlier draft's event_map_point population, now evaluated live
--     instead of precomputed. city -> region -> country via COALESCE over
--     three LEFT JOINs into location_lookup; a row appears only if at least
--     one of the three resolves (the final WHERE), which given the current
--     corpus's location_lookup coverage is true for all 2,837 source-derived
--     events (see architecture report) but is not assumed here.
-- ===========================================================================
create view public.event_map_public
  with (security_invoker = true)
as
select
  e.slug,
  e.event_type,
  e.valence,
  e.developer_or_operator,
  ll.latitude,
  ll.longitude,
  ll.level as resolved_level
from public.event e
join public.curated_location_override co
  on e.location_text is not distinct from co.location_text
  and e.location_country_code is not distinct from co.location_country_code
join public.location_lookup ll on ll.key = co.lookup_key
where e.is_public = true
  and e.origin = 'curated'

union all

select
  p.slug,
  p.event_type,
  p.valence,
  p.developer_or_operator,
  coalesce(city.latitude, region.latitude, country.latitude) as latitude,
  coalesce(city.longitude, region.longitude, country.longitude) as longitude,
  coalesce(city.level, region.level, country.level) as resolved_level
from (
  select
    e.slug,
    e.event_type,
    e.valence,
    e.developer_or_operator,
    upper(e.location_country_code) as country_code,
    case
      when e.location_text like '%,%,%' then upper(trim(split_part(e.location_text, ',', 1)))
      else null
    end as city_token,
    case
      when e.location_text like '%,%,%' then upper(trim(split_part(e.location_text, ',', 2)))
      when e.location_text like '%,%' then upper(trim(split_part(e.location_text, ',', 1)))
      else null
    end as region_token
  from public.event e
  where e.is_public = true
    and e.origin = 'source-derived'
    and e.location_text is not null
) p
left join public.location_lookup city
  on city.level = 'city'
  and p.city_token is not null and p.region_token is not null
  and city.key = p.city_token || '|' || p.region_token || '|' || p.country_code
left join public.location_lookup region
  on region.level = 'region'
  and p.region_token is not null
  and region.key = p.region_token || '|' || p.country_code
left join public.location_lookup country
  on country.level = 'country'
  and country.key = p.country_code
where coalesce(city.latitude, region.latitude, country.latitude) is not null;

grant select on public.event_map_public to anon, authenticated;

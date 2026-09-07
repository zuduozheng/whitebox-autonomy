-- Read-only production export for the NHTSA publication generator.
--
-- Produces one JSON array, one record per public.nhtsa_incident_candidate row
-- currently linked to an event (the authoritative set —
-- linked_event_id -> event.id — never a slug pattern). This is the
-- deterministic INPUT the publication generator (build-publication-sql.mjs)
-- evaluates preconditions and generates titles against: unlike the original
-- private promotion (whose input was the frozen, already-approved dry-run
-- JSONL), publication necessarily operates on the CURRENT live state of
-- already-existing rows, so this query — not a committed corpus file — is
-- the source of truth for one generator run. Re-run it immediately before
-- generating publish.sql so the generator never acts on stale state.
--
-- Run (same connection already proven throughout this project):
--   psql -v ON_ERROR_STOP=1 -t -A \
--     -f migration/nhtsa/wba-events/publish/production-export-query.sql \
--     -o migration/nhtsa/wba-events/publish/production-export.json
--
-- Read-only. Writes nothing. Not committed to the repository (a live
-- snapshot, not a deterministic build artifact) — see
-- migration/nhtsa/wba-events/publish/README.md.

select json_agg(
  json_build_object(
    'candidateId', c.id,
    'sameIncidentId', c.same_incident_id,
    'candidateStatus', c.status,
    'linkedEventId', c.linked_event_id,
    'event', json_build_object(
      'id', e.id,
      'slug', e.slug,
      'origin', e.origin,
      'is_public', e.is_public,
      'title', e.title,
      'summary', e.summary,
      'review_status', e.review_status,
      'observed_facts', e.observed_facts,
      'developer_or_operator', e.developer_or_operator,
      'system_name', e.system_name,
      'event_type', e.event_type,
      'valence', e.valence,
      'automation_status', e.automation_status,
      'causation_status', e.causation_status,
      'causation_note', e.causation_note,
      'unknowns', e.unknowns,
      'scenario_tags', e.scenario_tags,
      'location_text', e.location_text,
      'location_country_code', e.location_country_code,
      'location_precision', e.location_precision,
      'occurred_on', e.occurred_on,
      'occurred_on_precision', e.occurred_on_precision,
      'record_updated', e.record_updated
    ),
    'sources', (
      select coalesce(json_agg(
        json_build_object(
          'source_type', s.source_type,
          'external_record_id', s.external_record_id,
          'url', s.url
        )
        order by s.external_record_id
      ), '[]'::json)
      from public.event_source s where s.event_id = e.id
    )
  ) order by c.id
)
from public.nhtsa_incident_candidate c
join public.event e on e.id = c.linked_event_id;

/**
 * Publication-eligibility preconditions for one NHTSA source-derived event
 * record, exactly as frozen by the reviewed architecture. Pure, per-record
 * evaluation — a batch-level check (an event linked from more than one
 * candidate) is layered on separately in build-publication-sql.mjs, since it
 * cannot be decided by looking at a single record in isolation.
 *
 * Never coerces or fills a missing value: a record either passes every
 * check or is excluded from this batch and reported as an exception,
 * verbatim.
 */
import { EVENT_TYPE_LABELS } from "./title.mjs";

/**
 * `record` is one entry of production-export-query.sql's output:
 * { candidateId, sameIncidentId, candidateStatus, linkedEventId, event, sources }.
 *
 * Returns { eligible: boolean, failures: string[] } — `failures` is always
 * factual and mechanical (field name + actual value), never an
 * interpretation of the underlying incident.
 */
export function evaluatePublicationPreconditions(record) {
  const failures = [];
  const { event, sources, candidateStatus, linkedEventId } = record;

  if (!linkedEventId) {
    failures.push("candidate.linked_event_id is null");
  }
  if (!event) {
    failures.push("linked event does not exist");
    return { eligible: false, failures };
  }

  if (event.origin !== "source-derived") {
    failures.push(`event.origin is "${event.origin}", expected "source-derived"`);
  }
  if (event.is_public !== false) {
    failures.push(`event.is_public is ${JSON.stringify(event.is_public)}, expected false`);
  }
  if (event.title !== null) {
    failures.push("event.title is not null");
  }
  if (event.summary !== null) {
    failures.push("event.summary is not null");
  }
  if (event.review_status !== null) {
    failures.push("event.review_status is not null");
  }
  if (!Array.isArray(event.observed_facts) || event.observed_facts.length !== 0) {
    failures.push("event.observed_facts is not empty");
  }
  if (!event.developer_or_operator) {
    failures.push("event.developer_or_operator is null");
  }
  if (!event.event_type) {
    failures.push("event.event_type is null");
  } else if (EVENT_TYPE_LABELS[event.event_type] === undefined) {
    failures.push(`event.event_type "${event.event_type}" is not in the known label set`);
  }
  if (!event.valence) {
    failures.push("event.valence is null");
  }

  if (!Array.isArray(sources) || sources.length === 0) {
    failures.push("no event_source rows exist");
  } else {
    const hasNullExternalId = sources.some(
      (s) => s.source_type === "regulatory-record" && !s.external_record_id,
    );
    if (hasNullExternalId) {
      failures.push("at least one regulatory-record source has a null external_record_id");
    }
  }

  if (candidateStatus !== "pending") {
    failures.push(`candidate.status is "${candidateStatus}", expected "pending"`);
  }

  return { eligible: failures.length === 0, failures };
}

/**
 * Batch-level check: an event linked from more than one candidate cannot be
 * decided per-record. Returns a Map<linkedEventId, candidateId[]> containing
 * only event ids linked by 2+ candidates — empty when every linked event has
 * exactly one candidate (the expected, schema-encouraged case).
 */
export function findMultiplyLinkedEvents(records) {
  const byEventId = new Map();
  for (const record of records) {
    if (!record.linkedEventId) continue;
    const list = byEventId.get(record.linkedEventId) ?? [];
    list.push(record.candidateId);
    byEventId.set(record.linkedEventId, list);
  }
  const multiplyLinked = new Map();
  for (const [eventId, candidateIds] of byEventId) {
    if (candidateIds.length > 1) multiplyLinked.set(eventId, candidateIds);
  }
  return multiplyLinked;
}

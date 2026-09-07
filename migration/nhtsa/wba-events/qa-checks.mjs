/**
 * Full-corpus structural QA for the private WBA event dry run.
 *
 * Every check here is STRUCTURAL/FAITHFULNESS integrity — enum membership,
 * required-null invariants, uniqueness, date validity, exact carry-forward
 * of already-computed values. None of it is a semantic-quality metric
 * ("classification accuracy" and the like are explicitly out of scope, per
 * instruction).
 */

import { ONTOLOGY } from "../normalization/validate.mjs";

/**
 * QA-local mirror of `validate.mjs` rule 3's forbidden set
 * (`FORBIDDEN_LOCATION_PRECISION_FROM_NHTSA_ONLY`, not exported by the
 * frozen file). This is a defense-in-depth re-check of an invariant the
 * frozen pipeline already enforces before any candidate reaches this
 * generator (every candidate here already passed `validateDraft()`) — not a
 * new ontology definition; `ONTOLOGY.location_precision` itself is reused
 * directly, below, for plain enum-membership checks.
 */
const LOCATION_PRECISION_FORBIDDEN_FOR_NHTSA = new Set(["exact-point", "road-or-intersection", "local-area"]);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EXTERNAL_RECORD_ID_RE = /^(historical|current):.+$/;

const EVENT_OWNED_BY_DB = ["id", "created_at", "updated_at", "created_by", "updated_by", "first_published_at"];
const SOURCE_OWNED_BY_DB = ["id", "event_id", "created_at", "updated_at", "created_by", "updated_by"];

function isValidDatePrecisionPair(dateValue, precision, unknownValue = "unknown") {
  if (precision === unknownValue) return dateValue === null;
  if (dateValue === null) return false;
  return ISO_DATE_RE.test(dateValue);
}

/**
 * Run every structural check across the full generated corpus. Returns
 * `{ summary, problemRecords }` — `summary` is written verbatim to
 * wba-events-dry-run-qa-summary.json; `problemRecords` are appended to
 * wba-events-dry-run-problems.jsonl by the caller.
 *
 * `wbaRecords` — the array of `{candidateId, sameIncidentId, event,
 * eventSources, _normalizedUnknowns}` records already written to the JSONL
 * (the caller attaches `_normalizedUnknowns` — the exact `unknowns` array
 * normalization computed for this candidate, BEFORE mapping — before
 * calling this; see generate-dry-run.mjs). Whether that array's CONTENT is
 * policy-correct (i.e., whether normalization was right to include or omit
 * a given disagreement) is validateDraft() rule 8's job, already checked
 * for every candidate reaching this function — this QA layer only checks
 * that the MAPPING step preserved it faithfully, via a direct equality
 * check, not a second implementation of buildUnknowns()'s own skip policy.
 */
export function runFullCorpusQa({ totalCandidatesProcessed, wbaRecords, validationFailureCount }) {
  const problemRecords = [];
  const flag = (candidateId, sameIncidentId, reason) => problemRecords.push({ candidateId, sameIncidentId, reason });

  const seenCandidateIds = new Set();
  const seenSlugs = new Set();
  let duplicateCandidateIds = 0;
  let duplicateSlugs = 0;
  let eventsWithZeroSources = 0;
  let eventsWithDuplicateExternalRecordId = 0;
  let malformedExternalRecordId = 0;
  let invalidEnumCount = 0;
  let publicEventCount = 0; // must stay 0
  let disallowedLocationPrecisionCount = 0;
  let malformedOccurredOnPairing = 0;
  let malformedPublishedOnPairing = 0;
  let nonNullCuratorFieldCount = 0; // title/summary/interpretation/review_status
  let nonEmptyObservedFactsCount = 0;
  let nonNullSystemFieldCount = 0; // system_name/system_version, or system_version_knowledge != 'unknown'
  let dbOwnedFieldPresentCount = 0;
  let unknownsNotExactCarryForwardCount = 0;
  let nullSourceUrlCount = 0; // expected/acceptable in this dry run — counted, never a failure

  for (const record of wbaRecords) {
    const { candidateId, sameIncidentId, event, eventSources } = record;

    if (seenCandidateIds.has(candidateId)) {
      duplicateCandidateIds++;
      flag(candidateId, sameIncidentId, "duplicate candidateId across the generated batch");
    }
    seenCandidateIds.add(candidateId);

    if (seenSlugs.has(event.slug)) {
      duplicateSlugs++;
      flag(candidateId, sameIncidentId, `duplicate event.slug "${event.slug}"`);
    }
    seenSlugs.add(event.slug);

    if (event.is_public !== false) {
      publicEventCount++;
      flag(candidateId, sameIncidentId, "event.is_public is not false");
    }

    if (!ONTOLOGY.event_type.includes(event.event_type)) {
      invalidEnumCount++;
      flag(candidateId, sameIncidentId, `event_type "${event.event_type}" not in ONTOLOGY.event_type`);
    }
    if (!ONTOLOGY.valence.includes(event.valence)) {
      invalidEnumCount++;
      flag(candidateId, sameIncidentId, `valence "${event.valence}" not in ONTOLOGY.valence`);
    }
    if (!ONTOLOGY.automation_status.includes(event.automation_status)) {
      invalidEnumCount++;
      flag(candidateId, sameIncidentId, `automation_status "${event.automation_status}" not in ONTOLOGY.automation_status`);
    }
    if (!ONTOLOGY.causation_status.includes(event.causation_status)) {
      invalidEnumCount++;
      flag(candidateId, sameIncidentId, `causation_status "${event.causation_status}" not in ONTOLOGY.causation_status`);
    }
    if (!ONTOLOGY.location_precision.includes(event.location_precision)) {
      invalidEnumCount++;
      flag(candidateId, sameIncidentId, `location_precision "${event.location_precision}" not in ONTOLOGY.location_precision`);
    }
    if (LOCATION_PRECISION_FORBIDDEN_FOR_NHTSA.has(event.location_precision)) {
      disallowedLocationPrecisionCount++;
      flag(candidateId, sameIncidentId, `location_precision "${event.location_precision}" exceeds what NHTSA-only data supports`);
    }

    if (!isValidDatePrecisionPair(event.occurred_on, event.occurred_on_precision)) {
      malformedOccurredOnPairing++;
      flag(candidateId, sameIncidentId, "occurred_on/occurred_on_precision pairing invalid or malformed date");
    }

    if (event.title !== null || event.summary !== null || event.interpretation !== null || event.review_status !== null) {
      nonNullCuratorFieldCount++;
      flag(candidateId, sameIncidentId, "a curator-only field (title/summary/interpretation/review_status) is non-null");
    }
    if (!Array.isArray(event.observed_facts) || event.observed_facts.length !== 0) {
      nonEmptyObservedFactsCount++;
      flag(candidateId, sameIncidentId, "observed_facts is not an empty array");
    }
    if (event.system_name !== null || event.system_version !== null || event.system_version_knowledge !== "unknown") {
      nonNullSystemFieldCount++;
      flag(candidateId, sameIncidentId, "system_name/system_version/system_version_knowledge populated without evidence");
    }
    for (const key of EVENT_OWNED_BY_DB) {
      if (Object.prototype.hasOwnProperty.call(event, key)) {
        dbOwnedFieldPresentCount++;
        flag(candidateId, sameIncidentId, `event object carries DB-owned field "${key}"`);
      }
    }

    // Faithful carry-forward check, not a normalization-policy check:
    // validateDraft() rule 8 already verified (before this record ever
    // reached this generator) that `_normalizedUnknowns` correctly reflects
    // every disagreement/inconsistency normalization detected. This only
    // confirms the MAPPING step didn't drop, reorder, or alter that array.
    if (JSON.stringify(event.unknowns) !== JSON.stringify(record._normalizedUnknowns)) {
      unknownsNotExactCarryForwardCount++;
      flag(candidateId, sameIncidentId, "event.unknowns is not an exact carry-forward of the normalized draft's unknowns array");
    }

    if (!Array.isArray(eventSources) || eventSources.length === 0) {
      eventsWithZeroSources++;
      flag(candidateId, sameIncidentId, "eventSources is empty");
    }
    const externalIds = new Set();
    for (const source of eventSources ?? []) {
      if (source.url === null) nullSourceUrlCount++; // expected in this dry run
      if (!EXTERNAL_RECORD_ID_RE.test(source.external_record_id ?? "")) {
        malformedExternalRecordId++;
        flag(candidateId, sameIncidentId, `malformed external_record_id "${source.external_record_id}"`);
      }
      if (externalIds.has(source.external_record_id)) {
        eventsWithDuplicateExternalRecordId++;
        flag(candidateId, sameIncidentId, `duplicate external_record_id "${source.external_record_id}" within one event`);
      }
      externalIds.add(source.external_record_id);

      if (!isValidDatePrecisionPair(source.published_on, source.published_on_precision)) {
        malformedPublishedOnPairing++;
        flag(candidateId, sameIncidentId, "published_on/published_on_precision pairing invalid or malformed date");
      }
      if (source.retrieved_on !== null && !ISO_DATE_RE.test(source.retrieved_on)) {
        malformedPublishedOnPairing++;
        flag(candidateId, sameIncidentId, `malformed retrieved_on "${source.retrieved_on}"`);
      }
      if (source.source_type !== "regulatory-record") {
        invalidEnumCount++;
        flag(candidateId, sameIncidentId, `event_source.source_type "${source.source_type}" is not "regulatory-record"`);
      }
      for (const key of SOURCE_OWNED_BY_DB) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          dbOwnedFieldPresentCount++;
          flag(candidateId, sameIncidentId, `event_source object carries DB-owned field "${key}"`);
        }
      }
    }
  }

  const summary = {
    totalCandidatesProcessed,
    eventObjectsGenerated: wbaRecords.length,
    validationFailureCount,
    checks: {
      exactlyOneEventPerCandidate: wbaRecords.length + validationFailureCount === totalCandidatesProcessed,
      noDuplicateCandidateIds: duplicateCandidateIds === 0,
      noDuplicateSlugs: duplicateSlugs === 0,
      allEventsPrivate: publicEventCount === 0,
      allEnumsValid: invalidEnumCount === 0,
      locationPrecisionNeverExceedsCity: disallowedLocationPrecisionCount === 0,
      occurredOnPairingValid: malformedOccurredOnPairing === 0,
      publishedOnPairingValid: malformedPublishedOnPairing === 0,
      curatorFieldsRemainNull: nonNullCuratorFieldCount === 0,
      observedFactsRemainEmpty: nonEmptyObservedFactsCount === 0,
      systemFieldsRemainUnset: nonNullSystemFieldCount === 0,
      noDbOwnedFieldsGenerated: dbOwnedFieldPresentCount === 0,
      everySourceHasExternalRecordId: malformedExternalRecordId === 0,
      noDuplicateExternalRecordIdWithinEvent: eventsWithDuplicateExternalRecordId === 0,
      everyEventHasAtLeastOneSource: eventsWithZeroSources === 0,
      unknownsExactCarryForward: unknownsNotExactCarryForwardCount === 0,
      frozenValidateDraftReportedZeroViolations: validationFailureCount === 0,
    },
    counts: {
      duplicateCandidateIds,
      duplicateSlugs,
      publicEventCount,
      invalidEnumCount,
      disallowedLocationPrecisionCount,
      malformedOccurredOnPairing,
      malformedPublishedOnPairing,
      nonNullCuratorFieldCount,
      nonEmptyObservedFactsCount,
      nonNullSystemFieldCount,
      dbOwnedFieldPresentCount,
      malformedExternalRecordId,
      eventsWithDuplicateExternalRecordId,
      eventsWithZeroSources,
      unknownsNotExactCarryForwardCount,
      nullSourceUrlCount,
    },
    productionBlockers: [
      {
        blocker: "canonical NHTSA source URL required before database insertion",
        detail:
          `${nullSourceUrlCount} event_source object(s) carry url=null in this private dry-run artifact. ` +
          `The production event_source.url column is NOT NULL and requires "^https?://". ` +
          "This is an unresolved, explicitly deferred production decision (no URL has been approved) — " +
          "NOT a dry-run generation failure. It must be resolved before any production insertion.",
        blocksProduction: true,
        blocksDryRun: false,
      },
    ],
  };

  return { summary, problemRecords };
}

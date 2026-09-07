/**
 * Focused unit tests for the pure NHTSA-candidate -> WBA-event mapping.
 * Run with: node --test migration/nhtsa/wba-events/__tests__
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mapCandidateToEvent,
  mapReportToEventSource,
  mapCandidateToWbaRecords,
  candidateIdentityKey,
  slugFor,
  formatLocationText,
  resolvedDeveloperOrOperator,
  GENERATION_BATCH_DATE,
  NHTSA_SOURCE_URL_UNRESOLVED,
} from "../map-candidate-to-event.mjs";

function candidate(overrides = {}) {
  return {
    same_incident_id: "abc123",
    developer_or_operator: "Waymo LLC",
    city: "Phoenix",
    state: "AZ",
    country_code: "US",
    incident_date: "2025-03-01",
    incident_date_precision: "month",
    _contributingReportKeys: [{ reporting_generation: "historical", report_id: "30270-1" }],
    ...overrides,
  };
}

function report(overrides = {}) {
  return {
    reporting_generation: "historical",
    report_id: "30270-1",
    report_version: 1,
    reporting_entity: "Waymo LLC",
    report_submission_date: "2025-04-01",
    retrieved_on: "2026-09-06",
    ...overrides,
  };
}

function classification(overrides = {}) {
  return {
    event_type: { value: "collision", tier: "CLASSIFICATION", justification: "j-event", confidence: "well-supported" },
    valence: { value: "neutral-or-unclear", tier: "CLASSIFICATION", justification: "j-valence", confidence: "contested" },
    automation_status: { value: "driving-automation-engaged-confirmed", tier: "CLASSIFICATION", justification: "j-auto", confidence: "well-supported" },
    causation_status: { value: "undetermined", tier: "CLASSIFICATION", justification: "No structured or narrative evidence directly supports a more specific causation category; conservative default applied per Normalization Rulebook v1.", confidence: "contested" },
    scenario_tags: { value: ["struck-from-behind"], tier: "CLASSIFICATION", justification: "j-tags", confidence: "well-supported" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// slug / candidateIdentityKey — deterministic, no randomness
// ---------------------------------------------------------------------------

test("candidateIdentityKey uses same_incident_id when present", () => {
  assert.equal(candidateIdentityKey(candidate()), "same-incident:abc123");
});

test("candidateIdentityKey falls back to the singleton's own report key when same_incident_id is null", () => {
  const c = candidate({ same_incident_id: null, _contributingReportKeys: [{ reporting_generation: "current", report_id: "9999" }] });
  assert.equal(candidateIdentityKey(c), "singleton:current:9999");
});

test("slugFor is deterministic: same candidate identity always produces the same slug", () => {
  const c = candidate();
  assert.equal(slugFor(c), slugFor(candidate()));
  assert.match(slugFor(c), /^nhtsa-[0-9a-f]{8}$/);
});

test("slugFor differs for different candidates", () => {
  const a = slugFor(candidate({ same_incident_id: "aaa" }));
  const b = slugFor(candidate({ same_incident_id: "bbb" }));
  assert.notEqual(a, b);
});

// ---------------------------------------------------------------------------
// location formatting / precision carry-forward
// ---------------------------------------------------------------------------

test("formatLocationText joins city, state, country_code deterministically, no name expansion", () => {
  const text = formatLocationText(candidate(), []);
  assert.equal(text, "Phoenix, AZ, US");
});

test("formatLocationText prefers the cosmetically-resolved city_canonical atom when present", () => {
  const atoms = [{ tier: "DERIVED", field: "city_canonical", value: "San Francisco" }];
  const text = formatLocationText(candidate({ city: "San Fransisco" }), atoms);
  assert.equal(text, "San Francisco, AZ, US");
});

test("formatLocationText returns null when no structured location field is present", () => {
  const text = formatLocationText(candidate({ city: null, state: null, country_code: null }), []);
  assert.equal(text, null);
});

test("mapCandidateToEvent carries forward location_precision exactly from the frozen pipeline's atom, never inventing one", () => {
  const atoms = [{ tier: "DERIVED", field: "location_precision", value: "region" }];
  const event = mapCandidateToEvent(candidate({ city: null }), atoms, classification(), []);
  assert.equal(event.location_precision, "region");
});

test("mapCandidateToEvent defaults location_precision to 'unknown' when no atom exists", () => {
  const event = mapCandidateToEvent(candidate(), [], classification(), []);
  assert.equal(event.location_precision, "unknown");
});

// ---------------------------------------------------------------------------
// developer_or_operator canonicalization reuse
// ---------------------------------------------------------------------------

test("resolvedDeveloperOrOperator prefers the alias table's canonical value when present", () => {
  const atoms = [{ tier: "DERIVED", field: "developer_or_operator_canonical", value: "Kodiak Robotics, Inc" }];
  assert.equal(resolvedDeveloperOrOperator(candidate({ developer_or_operator: null }), atoms), "Kodiak Robotics, Inc");
});

test("resolvedDeveloperOrOperator falls back to the candidate's own field with no atom", () => {
  assert.equal(resolvedDeveloperOrOperator(candidate(), []), "Waymo LLC");
});

// ---------------------------------------------------------------------------
// curator-only fields stay null; private status; no invented prose
// ---------------------------------------------------------------------------

test("title, summary, interpretation, review_status, system_name, system_version are all null", () => {
  const event = mapCandidateToEvent(candidate(), [], classification(), []);
  assert.equal(event.title, null);
  assert.equal(event.summary, null);
  assert.equal(event.interpretation, null);
  assert.equal(event.review_status, null);
  assert.equal(event.system_name, null);
  assert.equal(event.system_version, null);
  assert.equal(event.system_version_knowledge, "unknown");
});

test("observed_facts is always an empty array", () => {
  const event = mapCandidateToEvent(candidate(), [], classification(), []);
  assert.deepEqual(event.observed_facts, []);
});

test("is_public is always false", () => {
  const event = mapCandidateToEvent(candidate(), [], classification(), []);
  assert.equal(event.is_public, false);
});

test("record_updated is the fixed batch constant, not a runtime date", () => {
  const event = mapCandidateToEvent(candidate(), [], classification(), []);
  assert.equal(event.record_updated, GENERATION_BATCH_DATE);
});

test("no DB-owned field (id/created_at/updated_at/created_by/updated_by/first_published_at) is present on the generated event", () => {
  const event = mapCandidateToEvent(candidate(), [], classification(), []);
  for (const key of ["id", "created_at", "updated_at", "created_by", "updated_by", "first_published_at"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(event, key), false, `unexpected key "${key}"`);
  }
});

// ---------------------------------------------------------------------------
// classification / unknowns / causation_note exact carry-forward
// ---------------------------------------------------------------------------

test("event_type/valence/automation_status/causation_status/scenario_tags are exact carry-forwards of the frozen classification", () => {
  const c = classification();
  const event = mapCandidateToEvent(candidate(), [], c, []);
  assert.equal(event.event_type, c.event_type.value);
  assert.equal(event.valence, c.valence.value);
  assert.equal(event.automation_status, c.automation_status.value);
  assert.equal(event.causation_status, c.causation_status.value);
  assert.deepEqual(event.scenario_tags, c.scenario_tags.value);
});

test("scenario_tags falls back to an empty array when classify.mjs returns UNSUPPORTED (value: null)", () => {
  const c = classification({ scenario_tags: { value: null, tier: "UNSUPPORTED", justification: "none matched", confidence: null } });
  const event = mapCandidateToEvent(candidate(), [], c, []);
  assert.deepEqual(event.scenario_tags, []);
});

test("unknowns is an exact, order-preserving carry-forward of the normalized draft's unknowns array", () => {
  const unknowns = ["Contributing reports disagree on city (Phoenix / Pheonix) — left unresolved for curator review."];
  const event = mapCandidateToEvent(candidate(), [], classification(), unknowns);
  assert.deepEqual(event.unknowns, unknowns);
});

test("unknowns is a copy, not the same array reference (mutation safety)", () => {
  const unknowns = ["x"];
  const event = mapCandidateToEvent(candidate(), [], classification(), unknowns);
  event.unknowns.push("y");
  assert.deepEqual(unknowns, ["x"]);
});

test("causation_note carries the classification's own justification VERBATIM, including for 'undetermined'", () => {
  const c = classification();
  const event = mapCandidateToEvent(candidate(), [], c, []);
  assert.equal(event.causation_status, "undetermined");
  assert.equal(event.causation_note, c.causation_status.justification);
  assert.ok(event.causation_note.length > 0);
});

test("causation_note carries the justification verbatim for a non-undetermined causation_status too", () => {
  const c = classification({
    causation_status: { value: "other-party-contributed", tier: "CLASSIFICATION", justification: "Narrative directly states the other party disregarded a traffic control.", confidence: "well-supported" },
  });
  const event = mapCandidateToEvent(candidate(), [], c, []);
  assert.equal(event.causation_note, c.causation_status.justification);
});

// ---------------------------------------------------------------------------
// event_source: one per contributing report, external_record_id namespacing,
// null dry-run URL, deterministic labels, no DB-owned fields
// ---------------------------------------------------------------------------

test("mapReportToEventSource sets url to null in the dry run, source_type to regulatory-record", () => {
  const source = mapReportToEventSource(report());
  assert.equal(source.url, NHTSA_SOURCE_URL_UNRESOLVED);
  assert.equal(source.url, null);
  assert.equal(source.source_type, "regulatory-record");
});

test("external_record_id is namespaced by reporting_generation to avoid cross-generation collisions", () => {
  const historical = mapReportToEventSource(report({ reporting_generation: "historical", report_id: "42" }));
  const current = mapReportToEventSource(report({ reporting_generation: "current", report_id: "42" }));
  assert.equal(historical.external_record_id, "historical:42");
  assert.equal(current.external_record_id, "current:42");
  assert.notEqual(historical.external_record_id, current.external_record_id);
});

test("label is a deterministic, factual string only — no curator prose", () => {
  const source = mapReportToEventSource(report({ report_id: "30270-1", report_version: 3 }));
  assert.equal(source.label, "NHTSA SGO report 30270-1 (v3)");
});

test("publisher maps from reporting_entity; note stays null", () => {
  const source = mapReportToEventSource(report({ reporting_entity: "Kodiak Robotics, Inc" }));
  assert.equal(source.publisher, "Kodiak Robotics, Inc");
  assert.equal(source.note, null);
});

test("published_on/published_on_precision pairing follows the month-only convention documented on nhtsa_report", () => {
  const withDate = mapReportToEventSource(report({ report_submission_date: "2025-04-01" }));
  assert.equal(withDate.published_on, "2025-04-01");
  assert.equal(withDate.published_on_precision, "month");

  const withoutDate = mapReportToEventSource(report({ report_submission_date: null }));
  assert.equal(withoutDate.published_on, null);
  assert.equal(withoutDate.published_on_precision, "unknown");
});

test("retrieved_on carries the pipeline's own retrieval metadata", () => {
  const source = mapReportToEventSource(report({ retrieved_on: "2026-09-06" }));
  assert.equal(source.retrieved_on, "2026-09-06");
});

test("no DB-owned field (id/event_id/created_at/updated_at/created_by/updated_by) is present on the generated source", () => {
  const source = mapReportToEventSource(report());
  for (const key of ["id", "event_id", "created_at", "updated_at", "created_by", "updated_by"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(source, key), false, `unexpected key "${key}"`);
  }
});

// ---------------------------------------------------------------------------
// Full record assembly: one event + N sources, multi-report candidates
// ---------------------------------------------------------------------------

test("mapCandidateToWbaRecords produces exactly one event and one source for a single-report candidate", () => {
  const c = candidate();
  const reports = [report()];
  const record = mapCandidateToWbaRecords({ candidate: c, reports, atoms: [], classification: classification(), unknowns: [] });
  assert.equal(record.candidateId, "same-incident:abc123");
  assert.equal(record.sameIncidentId, "abc123");
  assert.ok(record.event);
  assert.equal(record.eventSources.length, 1);
});

test("mapCandidateToWbaRecords produces one event_source PER contributing report for a multi-report candidate (never flattened to one)", () => {
  const c = candidate({
    _contributingReportKeys: [
      { reporting_generation: "historical", report_id: "30270-1" },
      { reporting_generation: "historical", report_id: "30270-2" },
      { reporting_generation: "current", report_id: "99" },
    ],
  });
  const reports = [
    report({ report_id: "30270-1", reporting_entity: "Waymo LLC" }),
    report({ report_id: "30270-2", reporting_entity: "GM LLC" }),
    report({ reporting_generation: "current", report_id: "99", reporting_entity: "Waymo LLC" }),
  ];
  const record = mapCandidateToWbaRecords({ candidate: c, reports, atoms: [], classification: classification(), unknowns: [] });
  assert.equal(record.eventSources.length, 3);
  const externalIds = record.eventSources.map((s) => s.external_record_id);
  assert.deepEqual(externalIds, ["historical:30270-1", "historical:30270-2", "current:99"]);
  assert.equal(new Set(externalIds).size, 3); // no collision
  // Distinct reporting entities are preserved individually, not merged.
  assert.deepEqual(record.eventSources.map((s) => s.publisher), ["Waymo LLC", "GM LLC", "Waymo LLC"]);
});

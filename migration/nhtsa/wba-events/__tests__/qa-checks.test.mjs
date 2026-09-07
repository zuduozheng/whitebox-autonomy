/**
 * Focused unit tests for the full-corpus structural QA checks.
 * Run with: node --test migration/nhtsa/wba-events/__tests__
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { runFullCorpusQa } from "../qa-checks.mjs";

function goodRecord(overrides = {}) {
  return {
    candidateId: "same-incident:abc",
    sameIncidentId: "abc",
    _normalizedUnknowns: [],
    event: {
      slug: "nhtsa-aaaaaaaa",
      title: null,
      summary: null,
      occurred_on: "2025-03-01",
      occurred_on_precision: "month",
      location_text: "Phoenix, AZ, US",
      location_country_code: "US",
      location_precision: "city",
      developer_or_operator: "Waymo LLC",
      system_name: null,
      automation_status: "driving-automation-engaged-confirmed",
      system_version: null,
      system_version_knowledge: "unknown",
      event_type: "collision",
      valence: "neutral-or-unclear",
      observed_facts: [],
      unknowns: [],
      interpretation: null,
      causation_status: "undetermined",
      causation_note: "conservative default applied",
      scenario_tags: [],
      review_status: null,
      record_updated: "2026-09-06",
      is_public: false,
    },
    eventSources: [
      {
        url: null,
        source_type: "regulatory-record",
        external_record_id: "historical:30270-1",
        publisher: "Waymo LLC",
        label: "NHTSA SGO report 30270-1 (v1)",
        published_on: "2025-04-01",
        published_on_precision: "month",
        retrieved_on: "2026-09-06",
        note: null,
      },
    ],
    ...overrides,
  };
}

test("a fully-clean batch reports every check as true", () => {
  const { summary, problemRecords } = runFullCorpusQa({
    totalCandidatesProcessed: 1,
    wbaRecords: [goodRecord()],
    validationFailureCount: 0,
  });
  assert.equal(problemRecords.length, 0);
  for (const [check, ok] of Object.entries(summary.checks)) {
    assert.equal(ok, true, `expected check "${check}" to pass`);
  }
});

test("detects a duplicate slug across the batch", () => {
  const a = goodRecord({ candidateId: "same-incident:a", sameIncidentId: "a" });
  const b = goodRecord({ candidateId: "same-incident:b", sameIncidentId: "b" });
  b.event = { ...b.event, slug: a.event.slug };
  const { summary, problemRecords } = runFullCorpusQa({ totalCandidatesProcessed: 2, wbaRecords: [a, b], validationFailureCount: 0 });
  assert.equal(summary.checks.noDuplicateSlugs, false);
  assert.equal(summary.counts.duplicateSlugs, 1);
  assert.ok(problemRecords.some((p) => p.reason.includes("duplicate event.slug")));
});

test("detects an invalid enum value", () => {
  const bad = goodRecord();
  bad.event = { ...bad.event, event_type: "not-a-real-type" };
  const { summary } = runFullCorpusQa({ totalCandidatesProcessed: 1, wbaRecords: [bad], validationFailureCount: 0 });
  assert.equal(summary.checks.allEnumsValid, false);
  assert.equal(summary.counts.invalidEnumCount, 1);
});

test("detects a location_precision that exceeds what NHTSA-only data supports", () => {
  const bad = goodRecord();
  bad.event = { ...bad.event, location_precision: "exact-point" };
  const { summary } = runFullCorpusQa({ totalCandidatesProcessed: 1, wbaRecords: [bad], validationFailureCount: 0 });
  assert.equal(summary.checks.locationPrecisionNeverExceedsCity, false);
  assert.equal(summary.counts.disallowedLocationPrecisionCount, 1);
});

test("detects an event that is accidentally public", () => {
  const bad = goodRecord();
  bad.event = { ...bad.event, is_public: true };
  const { summary } = runFullCorpusQa({ totalCandidatesProcessed: 1, wbaRecords: [bad], validationFailureCount: 0 });
  assert.equal(summary.checks.allEventsPrivate, false);
  assert.equal(summary.counts.publicEventCount, 1);
});

test("detects a non-null curator-only field (title)", () => {
  const bad = goodRecord();
  bad.event = { ...bad.event, title: "A curator wrote this" };
  const { summary } = runFullCorpusQa({ totalCandidatesProcessed: 1, wbaRecords: [bad], validationFailureCount: 0 });
  assert.equal(summary.checks.curatorFieldsRemainNull, false);
});

test("detects a non-empty observed_facts array", () => {
  const bad = goodRecord();
  bad.event = { ...bad.event, observed_facts: ["invented fact"] };
  const { summary } = runFullCorpusQa({ totalCandidatesProcessed: 1, wbaRecords: [bad], validationFailureCount: 0 });
  assert.equal(summary.checks.observedFactsRemainEmpty, false);
});

test("detects a DB-owned field accidentally present on the event object", () => {
  const bad = goodRecord();
  bad.event = { ...bad.event, id: "should-not-be-here" };
  const { summary } = runFullCorpusQa({ totalCandidatesProcessed: 1, wbaRecords: [bad], validationFailureCount: 0 });
  assert.equal(summary.checks.noDbOwnedFieldsGenerated, false);
});

test("detects a duplicate external_record_id within one event's sources", () => {
  const bad = goodRecord();
  bad.eventSources = [bad.eventSources[0], { ...bad.eventSources[0] }];
  const { summary } = runFullCorpusQa({ totalCandidatesProcessed: 1, wbaRecords: [bad], validationFailureCount: 0 });
  assert.equal(summary.checks.noDuplicateExternalRecordIdWithinEvent, false);
});

test("detects an event with zero sources", () => {
  const bad = goodRecord({ eventSources: [] });
  const { summary } = runFullCorpusQa({ totalCandidatesProcessed: 1, wbaRecords: [bad], validationFailureCount: 0 });
  assert.equal(summary.checks.everyEventHasAtLeastOneSource, false);
});

test("flags event.unknowns when it does not exactly carry forward the normalized draft's unknowns array (mapping-level check, not a policy re-check)", () => {
  const bad = goodRecord({ _normalizedUnknowns: ["Contributing reports disagree on X — left unresolved for curator review."] });
  // event.unknowns left as [] (goodRecord's default) — mapping dropped it.
  const { summary, problemRecords } = runFullCorpusQa({ totalCandidatesProcessed: 1, wbaRecords: [bad], validationFailureCount: 0 });
  assert.equal(summary.checks.unknownsExactCarryForward, false);
  assert.equal(summary.counts.unknownsNotExactCarryForwardCount, 1);
  assert.ok(problemRecords.some((p) => p.reason.includes("not an exact carry-forward")));
});

test("passes when event.unknowns exactly matches the normalized draft's unknowns array, whatever its content", () => {
  const unknowns = ["Contributing reports disagree on X — left unresolved for curator review."];
  const ok = goodRecord({ _normalizedUnknowns: unknowns });
  ok.event = { ...ok.event, unknowns };
  const { summary } = runFullCorpusQa({ totalCandidatesProcessed: 1, wbaRecords: [ok], validationFailureCount: 0 });
  assert.equal(summary.checks.unknownsExactCarryForward, true);
});

test("passes when both are correctly empty (no disagreement was ever detected — nothing for the mapper to carry forward)", () => {
  const ok = goodRecord({ _normalizedUnknowns: [] });
  const { summary } = runFullCorpusQa({ totalCandidatesProcessed: 1, wbaRecords: [ok], validationFailureCount: 0 });
  assert.equal(summary.checks.unknownsExactCarryForward, true);
});

test("null event_source.url is counted but never treated as a failure — reported as a production blocker instead", () => {
  const { summary } = runFullCorpusQa({ totalCandidatesProcessed: 1, wbaRecords: [goodRecord()], validationFailureCount: 0 });
  assert.equal(summary.counts.nullSourceUrlCount, 1);
  assert.equal(summary.productionBlockers[0].blocksDryRun, false);
  assert.equal(summary.productionBlockers[0].blocksProduction, true);
  assert.match(summary.productionBlockers[0].blocker, /canonical NHTSA source URL/);
});

test("validateDraft rejections are counted separately and do not, by themselves, fail the structural checks meant for successfully-mapped records", () => {
  const { summary } = runFullCorpusQa({ totalCandidatesProcessed: 5, wbaRecords: [goodRecord()], validationFailureCount: 4 });
  assert.equal(summary.checks.exactlyOneEventPerCandidate, true); // 1 mapped + 4 rejected = 5
  assert.equal(summary.checks.frozenValidateDraftReportedZeroViolations, false);
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluatePublicationPreconditions, findMultiplyLinkedEvents } from "../preconditions.mjs";

function validRecord(overrides = {}) {
  return {
    candidateId: "candidate-1",
    sameIncidentId: "same-incident-1",
    candidateStatus: "pending",
    linkedEventId: "event-1",
    event: {
      id: "event-1",
      slug: "nhtsa-abc123",
      origin: "source-derived",
      is_public: false,
      title: null,
      summary: null,
      review_status: null,
      observed_facts: [],
      developer_or_operator: "Waymo LLC",
      event_type: "collision",
      valence: "neutral-or-unclear",
    },
    sources: [{ source_type: "regulatory-record", external_record_id: "historical:1-2" }],
    ...overrides,
  };
}

test("a fully valid record is eligible with zero failures", () => {
  const { eligible, failures } = evaluatePublicationPreconditions(validRecord());
  assert.equal(eligible, true);
  assert.deepEqual(failures, []);
});

test("rejects when developer_or_operator is null — never fills a placeholder", () => {
  const record = validRecord({ event: { ...validRecord().event, developer_or_operator: null } });
  const { eligible, failures } = evaluatePublicationPreconditions(record);
  assert.equal(eligible, false);
  assert.ok(failures.some((f) => f.includes("developer_or_operator is null")));
});

test("rejects when event.origin is not source-derived", () => {
  const record = validRecord({ event: { ...validRecord().event, origin: "curated" } });
  const { eligible, failures } = evaluatePublicationPreconditions(record);
  assert.equal(eligible, false);
  assert.ok(failures.some((f) => f.includes('origin is "curated"')));
});

test("rejects when event.is_public is already true", () => {
  const record = validRecord({ event: { ...validRecord().event, is_public: true } });
  const { eligible } = evaluatePublicationPreconditions(record);
  assert.equal(eligible, false);
});

test("rejects when title is already non-null", () => {
  const record = validRecord({ event: { ...validRecord().event, title: "Already titled" } });
  const { eligible, failures } = evaluatePublicationPreconditions(record);
  assert.equal(eligible, false);
  assert.ok(failures.some((f) => f.includes("title is not null")));
});

test("rejects when summary is non-null", () => {
  const record = validRecord({ event: { ...validRecord().event, summary: "unexpected" } });
  const { eligible } = evaluatePublicationPreconditions(record);
  assert.equal(eligible, false);
});

test("rejects when review_status is non-null", () => {
  const record = validRecord({ event: { ...validRecord().event, review_status: "curator-reviewed" } });
  const { eligible } = evaluatePublicationPreconditions(record);
  assert.equal(eligible, false);
});

test("rejects when observed_facts is non-empty", () => {
  const record = validRecord({ event: { ...validRecord().event, observed_facts: ["a fact"] } });
  const { eligible, failures } = evaluatePublicationPreconditions(record);
  assert.equal(eligible, false);
  assert.ok(failures.some((f) => f.includes("observed_facts is not empty")));
});

test("rejects when event_type is null", () => {
  const record = validRecord({ event: { ...validRecord().event, event_type: null } });
  const { eligible } = evaluatePublicationPreconditions(record);
  assert.equal(eligible, false);
});

test("rejects an event_type outside the known label set", () => {
  const record = validRecord({ event: { ...validRecord().event, event_type: "not-a-real-type" } });
  const { eligible, failures } = evaluatePublicationPreconditions(record);
  assert.equal(eligible, false);
  assert.ok(failures.some((f) => f.includes("not in the known label set")));
});

test("rejects when valence is null", () => {
  const record = validRecord({ event: { ...validRecord().event, valence: null } });
  const { eligible } = evaluatePublicationPreconditions(record);
  assert.equal(eligible, false);
});

test("rejects when zero event_source rows exist", () => {
  const record = validRecord({ sources: [] });
  const { eligible, failures } = evaluatePublicationPreconditions(record);
  assert.equal(eligible, false);
  assert.ok(failures.some((f) => f.includes("no event_source rows exist")));
});

test("rejects when a regulatory-record source has a null external_record_id", () => {
  const record = validRecord({
    sources: [{ source_type: "regulatory-record", external_record_id: null }],
  });
  const { eligible, failures } = evaluatePublicationPreconditions(record);
  assert.equal(eligible, false);
  assert.ok(failures.some((f) => f.includes("null external_record_id")));
});

test("rejects when candidate.status is not pending", () => {
  const record = validRecord({ candidateStatus: "accepted" });
  const { eligible, failures } = evaluatePublicationPreconditions(record);
  assert.equal(eligible, false);
  assert.ok(failures.some((f) => f.includes('status is "accepted"')));
});

test("rejects when linked_event_id is null", () => {
  const record = validRecord({ linkedEventId: null });
  const { eligible, failures } = evaluatePublicationPreconditions(record);
  assert.equal(eligible, false);
  assert.ok(failures.some((f) => f.includes("linked_event_id is null")));
});

test("accumulates every failing check at once (not just the first)", () => {
  const record = validRecord({
    candidateStatus: "accepted",
    event: { ...validRecord().event, developer_or_operator: null, title: "x" },
  });
  const { failures } = evaluatePublicationPreconditions(record);
  assert.ok(failures.length >= 3);
});

test("findMultiplyLinkedEvents: empty map when every event has exactly one candidate", () => {
  const records = [validRecord({ candidateId: "c1", linkedEventId: "e1" }), validRecord({ candidateId: "c2", linkedEventId: "e2" })];
  assert.equal(findMultiplyLinkedEvents(records).size, 0);
});

test("findMultiplyLinkedEvents: flags an event linked by more than one candidate", () => {
  const records = [
    validRecord({ candidateId: "c1", linkedEventId: "e1" }),
    validRecord({ candidateId: "c2", linkedEventId: "e1" }),
  ];
  const result = findMultiplyLinkedEvents(records);
  assert.equal(result.size, 1);
  assert.deepEqual(result.get("e1"), ["c1", "c2"]);
});

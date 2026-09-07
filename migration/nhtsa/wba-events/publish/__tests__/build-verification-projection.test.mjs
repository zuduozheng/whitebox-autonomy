import { test } from "node:test";
import assert from "node:assert/strict";

import { buildTitledEligibleSet } from "../build-publication-sql.mjs";
import {
  projectRecord,
  buildVerificationProjection,
  serializeProjection,
  hashProjection,
} from "../build-verification-projection.mjs";

function fixtureRecord(overrides = {}) {
  return {
    candidateId: "candidate-1",
    sameIncidentId: "same-incident-1",
    linkedEventId: "11111111-1111-1111-1111-111111111111",
    event: {
      id: "11111111-1111-1111-1111-111111111111",
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
      location_text: null,
      occurred_on: null,
      occurred_on_precision: "unknown",
    },
    sources: [{ source_type: "regulatory-record", external_record_id: "historical:1-2" }],
    ...overrides,
  };
}

test("projectRecord carries exactly the canonical field set", () => {
  const titled = buildTitledEligibleSet([fixtureRecord()]);
  const projected = projectRecord(titled[0]);
  assert.deepEqual(Object.keys(projected).sort(), [
    "candidateId",
    "developer_or_operator",
    "event_type",
    "eventId",
    "is_public",
    "observed_facts",
    "origin",
    "review_status",
    "slug",
    "sourceCount",
    "summary",
    "title",
    "valence",
  ].sort());
});

test("projectRecord reflects the EXPECTED post-publish state, not the pre-publish state", () => {
  const titled = buildTitledEligibleSet([fixtureRecord()]);
  const projected = projectRecord(titled[0]);
  assert.equal(projected.is_public, true); // expected AFTER publish, not the current `false`
  assert.equal(projected.title, "Waymo LLC Collision"); // the generated title, not null
  assert.equal(projected.summary, null); // still null — never manufactured
  assert.equal(projected.review_status, null);
  assert.deepEqual(projected.observed_facts, []);
});

test("projectRecord never includes a DB-owned or non-deterministic field", () => {
  const titled = buildTitledEligibleSet([fixtureRecord()]);
  const projected = projectRecord(titled[0]);
  for (const forbidden of ["created_at", "updated_at", "first_published_at", "created_by", "updated_by"]) {
    assert.equal(forbidden in projected, false);
  }
});

test("buildVerificationProjection sorts deterministically by slug, independent of input order", () => {
  const a = fixtureRecord({ candidateId: "c1", linkedEventId: "e1", event: { ...fixtureRecord().event, id: "e1", slug: "nhtsa-b" } });
  const b = fixtureRecord({ candidateId: "c2", linkedEventId: "e2", event: { ...fixtureRecord().event, id: "e2", slug: "nhtsa-a" } });
  const titledForward = buildTitledEligibleSet([a, b]);
  const titledReversed = buildTitledEligibleSet([b, a]);
  const p1 = buildVerificationProjection(titledForward);
  const p2 = buildVerificationProjection(titledReversed);
  assert.deepEqual(p1.map((r) => r.slug), ["nhtsa-a", "nhtsa-b"]);
  assert.deepEqual(p2.map((r) => r.slug), ["nhtsa-a", "nhtsa-b"]);
  assert.deepEqual(p1, p2);
});

test("hashProjection is deterministic and stable across repeated calls", () => {
  const titled = buildTitledEligibleSet([fixtureRecord()]);
  const projection = buildVerificationProjection(titled);
  const h1 = hashProjection(projection);
  const h2 = hashProjection(buildVerificationProjection(buildTitledEligibleSet([fixtureRecord()])));
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test("hashProjection changes if any projected field differs", () => {
  const titled1 = buildTitledEligibleSet([fixtureRecord()]);
  const titled2 = buildTitledEligibleSet([
    fixtureRecord({ event: { ...fixtureRecord().event, developer_or_operator: "Cruise LLC" } }),
  ]);
  const h1 = hashProjection(buildVerificationProjection(titled1));
  const h2 = hashProjection(buildVerificationProjection(titled2));
  assert.notEqual(h1, h2);
});

test("serializeProjection round-trips through JSON without loss", () => {
  const titled = buildTitledEligibleSet([fixtureRecord()]);
  const projection = buildVerificationProjection(titled);
  const roundTripped = JSON.parse(serializeProjection(projection));
  assert.deepEqual(roundTripped, projection);
});

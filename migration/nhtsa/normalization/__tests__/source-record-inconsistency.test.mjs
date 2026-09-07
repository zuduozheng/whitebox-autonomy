/**
 * Focused regression tests for the Step 6 source-record-inconsistency signal
 * (targeted adversarial stress test cases 77ba86fa433a2c4 and
 * aeb0ef282584e35).
 *
 * Run with: node --test migration/nhtsa/normalization/__tests__
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { extractEvidence } from "../evidence.mjs";

function report(overrides) {
  return {
    reporting_generation: "historical",
    report_id: "r",
    report_version: 1,
    same_incident_id: "inc-1",
    reporting_entity: "Test",
    developer_or_operator: "Waymo LLC",
    incident_date: "2025-03-01",
    incident_date_precision: "month",
    city: "Los Angeles",
    state: "CA",
    country_code: "US",
    automation_engagement_text: null,
    crash_interaction_counterpart_text: null,
    subject_vehicle_precrash_movement_text: null,
    other_actor_precrash_movement_text: null,
    injury_outcome_text: "No Injuries Reported",
    narrative: "placeholder narrative with enough length to pass.",
    ...overrides,
  };
}

function candidateFromReports(reports) {
  // Mirrors mapping.mjs's consolidateField behavior closely enough for this
  // unit test: null when reports disagree on a field.
  function consolidated(field) {
    const values = new Set(reports.map((r) => r[field]).filter((v) => v != null));
    return values.size === 1 ? [...values][0] : null;
  }
  return {
    same_incident_id: "inc-1",
    developer_or_operator: consolidated("developer_or_operator"),
    city: consolidated("city"),
    state: consolidated("state"),
    country_code: "US",
    crash_interaction_counterpart: consolidated("crash_interaction_counterpart_text"),
    subject_vehicle_precrash_movement: consolidated("subject_vehicle_precrash_movement_text"),
    other_actor_precrash_movement: consolidated("other_actor_precrash_movement_text"),
    injury_outcome_text: consolidated("injury_outcome_text"),
    automation_engagement_text: consolidated("automation_engagement_text"),
    incident_date: reports[0].incident_date,
    incident_date_precision: reports[0].incident_date_precision,
    narrative: reports[0].narrative,
    curator_note: null,
  };
}

test("case 77ba86fa433a2c4 shape: 3-way event-shape disagreement (counterpart + both movements) is flagged", () => {
  const r1 = report({
    report_id: "a",
    crash_interaction_counterpart_text: "SUV",
    subject_vehicle_precrash_movement_text: "Parked",
    other_actor_precrash_movement_text: "Proceeding Straight",
  });
  const r2 = report({
    report_id: "b",
    crash_interaction_counterpart_text: "Passenger Car",
    subject_vehicle_precrash_movement_text: "Proceeding Straight",
    other_actor_precrash_movement_text: "Traveling Wrong Way",
  });
  const candidate = candidateFromReports([r1, r2]);
  const { sourceRecordInconsistency, atoms } = extractEvidence(candidate, [r1, r2]);
  assert.equal(sourceRecordInconsistency.flagged, true);
  assert.equal(sourceRecordInconsistency.fields.length, 3);
  const flagAtom = atoms.find((a) => a.field === "source_record_inconsistency");
  assert.ok(flagAtom, "expected a source_record_inconsistency atom");
});

test("case aeb0ef282584e35 shape: 2-way event-shape disagreement (counterpart + subject movement) is flagged", () => {
  const r1 = report({
    report_id: "a",
    crash_interaction_counterpart_text: "Other Fixed Object",
    subject_vehicle_precrash_movement_text: "Changing Lanes",
  });
  const r2 = report({
    report_id: "b",
    crash_interaction_counterpart_text: "Pole / Tree",
    subject_vehicle_precrash_movement_text: "Unknown",
  });
  const candidate = candidateFromReports([r1, r2]);
  const { sourceRecordInconsistency } = extractEvidence(candidate, [r1, r2]);
  assert.equal(sourceRecordInconsistency.flagged, true);
  assert.equal(sourceRecordInconsistency.fields.length, 2);
});

test("negative control: a single disagreeing event-shape field is NOT flagged (routine disagreement, not source-record inconsistency)", () => {
  const r1 = report({ report_id: "a", crash_interaction_counterpart_text: "Pickup Truck", subject_vehicle_precrash_movement_text: "Proceeding Straight", other_actor_precrash_movement_text: "Proceeding Straight" });
  const r2 = report({ report_id: "b", crash_interaction_counterpart_text: "Heavy Truck", subject_vehicle_precrash_movement_text: "Proceeding Straight", other_actor_precrash_movement_text: "Proceeding Straight" });
  const candidate = candidateFromReports([r1, r2]);
  const { sourceRecordInconsistency } = extractEvidence(candidate, [r1, r2]);
  assert.equal(sourceRecordInconsistency.flagged, false);
});

test("negative control: non-event-shape disagreements (developer, city, injury) alone are NOT flagged", () => {
  const r1 = report({ report_id: "a", developer_or_operator: "Waymo LLC", city: "San Drancisco", injury_outcome_text: "Minor" });
  const r2 = report({ report_id: "b", developer_or_operator: "Waymo LLC.", city: "San Francisco", injury_outcome_text: "No Injuries Reported" });
  const candidate = candidateFromReports([r1, r2]);
  const { sourceRecordInconsistency } = extractEvidence(candidate, [r1, r2]);
  assert.equal(sourceRecordInconsistency.flagged, false);
});

test("does not claim NHTSA grouping is wrong or choose a side: flag carries only field names, no resolution", () => {
  const r1 = report({ report_id: "a", crash_interaction_counterpart_text: "SUV", subject_vehicle_precrash_movement_text: "Parked" });
  const r2 = report({ report_id: "b", crash_interaction_counterpart_text: "Passenger Car", subject_vehicle_precrash_movement_text: "Proceeding Straight" });
  const candidate = candidateFromReports([r1, r2]);
  const { sourceRecordInconsistency } = extractEvidence(candidate, [r1, r2]);
  assert.deepEqual(new Set(sourceRecordInconsistency.fields), new Set(["crash_interaction_counterpart", "subject_vehicle_precrash_movement"]));
  // No "resolved"/"chosen"/"correct" field anywhere in the returned shape.
  assert.equal("resolvedField" in sourceRecordInconsistency, false);
  assert.equal("chosenReport" in sourceRecordInconsistency, false);
});

test("all per-field disagreements are still individually preserved alongside the new combined flag (purely additive)", () => {
  const r1 = report({ report_id: "a", crash_interaction_counterpart_text: "SUV", subject_vehicle_precrash_movement_text: "Parked", other_actor_precrash_movement_text: "Proceeding Straight" });
  const r2 = report({ report_id: "b", crash_interaction_counterpart_text: "Passenger Car", subject_vehicle_precrash_movement_text: "Proceeding Straight", other_actor_precrash_movement_text: "Traveling Wrong Way" });
  const candidate = candidateFromReports([r1, r2]);
  const { disagreements } = extractEvidence(candidate, [r1, r2]);
  assert.equal(disagreements.length, 3);
});

test("NEUTRALIZED WORDING (independent review, round 2): the surfaced atom text must not assert that the inconsistency means multiple physical events occurred", () => {
  const r1 = report({ report_id: "a", crash_interaction_counterpart_text: "SUV", subject_vehicle_precrash_movement_text: "Parked", other_actor_precrash_movement_text: "Proceeding Straight" });
  const r2 = report({ report_id: "b", crash_interaction_counterpart_text: "Passenger Car", subject_vehicle_precrash_movement_text: "Proceeding Straight", other_actor_precrash_movement_text: "Traveling Wrong Way" });
  const candidate = candidateFromReports([r1, r2]);
  const { atoms } = extractEvidence(candidate, [r1, r2]);
  const flagAtom = atoms.find((a) => a.field === "source_record_inconsistency");
  assert.ok(flagAtom);
  // Must NOT assert/suggest multiple events as the takeaway...
  assert.doesNotMatch(flagAtom.text, /may indicate more than one/i);
  assert.doesNotMatch(flagAtom.text, /suggests? (more than one|multiple) (physical )?event/i);
  // ...must explicitly state WBA takes no position on event count or which
  // description is correct.
  assert.match(flagAtom.text, /without determining which description is correct/i);
  assert.match(flagAtom.text, /one or multiple physical events/i);
});

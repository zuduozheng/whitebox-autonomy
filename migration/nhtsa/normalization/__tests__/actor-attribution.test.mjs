/**
 * Focused regression tests for the Step 2 fix (Tesla teleoperator
 * event_type/valence vs. causation_status internal contradiction, stress
 * test case 8578fbc6ef74c60) and the new independent validate.mjs backstop
 * (rule 25).
 *
 * Run with: node --test migration/nhtsa/normalization/__tests__
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { extractEvidence } from "../evidence.mjs";
import { classify } from "../classify.mjs";
import { validateDraft } from "../validate.mjs";

const TESLA_NARRATIVE =
  "The Tesla ADS was stopped on the right side of the street. Safety monitor requested support to assist with the Tesla ADS not proceeding forward. The teleoperator took over vehicle control and gradually increased vehicle speed and turned the Tesla ADS left toward the left side of the street. The Tesla vehicle was driven up the curb and made contact with a metal fence. The safety monitor was present and no passengers were inside the vehicle.";

function teslaReport() {
  return {
    reporting_generation: "current",
    report_id: "tesla-1",
    report_version: 1,
    same_incident_id: null,
    reporting_entity: "Tesla Inc",
    developer_or_operator: "Tesla Inc",
    incident_date: "2026-03-01",
    incident_date_precision: "month",
    city: "Austin",
    state: "TX",
    country_code: "US",
    automation_engagement_text: "Verified Engaged",
    crash_interaction_counterpart_text: "Other Fixed Object",
    subject_vehicle_precrash_movement_text: "Other, see Narrative",
    other_actor_precrash_movement_text: null,
    injury_outcome_text: "Minor W/O Hospitalization",
    narrative: TESLA_NARRATIVE,
    raw_row: {},
    retrieved_on: "2026-03-01",
  };
}

function teslaCandidate(r) {
  return {
    same_incident_id: null,
    developer_or_operator: r.developer_or_operator,
    city: r.city,
    state: r.state,
    country_code: "US",
    crash_interaction_counterpart: r.crash_interaction_counterpart_text,
    subject_vehicle_precrash_movement: r.subject_vehicle_precrash_movement_text,
    other_actor_precrash_movement: r.other_actor_precrash_movement_text,
    injury_outcome_text: r.injury_outcome_text,
    automation_engagement_text: r.automation_engagement_text,
    incident_date: r.incident_date,
    incident_date_precision: r.incident_date_precision,
    narrative: r.narrative,
    curator_note: null,
  };
}

function classifyTesla() {
  const r = teslaReport();
  const c = teslaCandidate(r);
  const { atoms, disagreements } = extractEvidence(c, [r]);
  const classification = classify(atoms, disagreements);
  return { atoms, disagreements, classification };
}

test("reproduced case: causation_status is (still) conservative given human control took over first", () => {
  const { classification } = classifyTesla();
  assert.equal(classification.causation_status.value, "undetermined");
});

test("fix: event_type justification no longer attributes the maneuver to automation when a human/teleoperator took control first", () => {
  const { classification } = classifyTesla();
  assert.doesNotMatch(classification.event_type.justification, /automated system'?s own maneuver/i);
  // event_type VALUE is intentionally unchanged — this is a justification-text
  // fix, not an ontology change (per Step 9 constraint against broad changes).
  assert.equal(classification.event_type.value, "unexpected-or-inappropriate-behaviour");
});

test("fix: valence justification no longer attributes the maneuver to 'the automated maneuver' when a human/teleoperator took control first", () => {
  const { classification } = classifyTesla();
  assert.doesNotMatch(classification.valence.justification, /the automated maneuver resulted/i);
  assert.equal(classification.valence.value, "failure-or-challenging");
});

test("fix: event_type/valence now point to causation_status for actor attribution", () => {
  const { classification } = classifyTesla();
  assert.match(classification.event_type.justification, /causation_status/i);
  assert.match(classification.valence.justification, /causation_status/i);
});

test("no regression: the ordinary case-#15 pattern (no human-control evidence) still attributes the maneuver to automation", () => {
  const r = teslaReport();
  r.narrative =
    "The Waymo AV entered the parking lot in autonomous mode and the Waymo AVs undercarriage then made contact with a speed bump (the AV did not contact any vehicle or other road user). At the time of the contact, the Waymo AVs Level 4 ADS was engaged in autonomous mode.";
  r.crash_interaction_counterpart_text = "Other, see Narrative";
  const c = teslaCandidate(r);
  const { atoms, disagreements } = extractEvidence(c, [r]);
  const classification = classify(atoms, disagreements);
  assert.match(classification.event_type.justification, /automated system'?s own maneuver/i);
  assert.match(classification.valence.justification, /the automated maneuver resulted/i);
});

test("validation passes cleanly on the fixed Tesla draft (no rule-25 violation)", () => {
  const { atoms, disagreements, classification } = classifyTesla();
  const draft = {
    candidateId: "test",
    atoms,
    disagreements,
    classification,
    locationPrecision: "city",
    unknowns: [],
  };
  const result = validateDraft(draft);
  assert.equal(result.violations.some((v) => v.rule === "25"), false);
});

test("independent backstop (rule 25) fires if a justification artificially reintroduces the contradiction", () => {
  const { atoms, disagreements, classification } = classifyTesla();
  // Simulate a future regression: some other code path reintroduces the
  // automation-attribution phrase even though human-control evidence exists.
  const regressed = {
    ...classification,
    event_type: {
      ...classification.event_type,
      justification: "Single-vehicle contact with static infrastructure during the automated system's own maneuver.",
    },
  };
  const draft = {
    candidateId: "test",
    atoms,
    disagreements,
    classification: regressed,
    locationPrecision: "city",
    unknowns: [],
  };
  const result = validateDraft(draft);
  assert.ok(result.violations.some((v) => v.rule === "25"), "expected the independent backstop to catch the reintroduced contradiction");
});

test("independent backstop (rule 25) does not false-positive when there is no human-control evidence", () => {
  const r = teslaReport();
  r.narrative =
    "The Waymo AV entered the parking lot in autonomous mode and the Waymo AVs undercarriage then made contact with a speed bump (the AV did not contact any vehicle or other road user). At the time of the contact, the Waymo AVs Level 4 ADS was engaged in autonomous mode.";
  r.crash_interaction_counterpart_text = "Other, see Narrative";
  const c = teslaCandidate(r);
  const { atoms, disagreements } = extractEvidence(c, [r]);
  const classification = classify(atoms, disagreements);
  const draft = { candidateId: "test", atoms, disagreements, classification, locationPrecision: "city", unknowns: [] };
  const result = validateDraft(draft);
  assert.equal(result.violations.some((v) => v.rule === "25"), false);
});

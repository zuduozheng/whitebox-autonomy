/**
 * Focused regression tests for the REVISED narrative-engagement resolution
 * (independent review, round 2): dual engagement/disengagement cues within
 * one narrative must be resolved by which cue is stated LAST in that
 * narrative's own text, never by a fixed precedence between the
 * ENGAGED_PATTERNS / NOT_ENGAGED_PATTERNS lists.
 *
 * This supersedes the review concern that a prior version of this fix
 * checked NOT_ENGAGED_PATTERNS before ENGAGED_PATTERNS unconditionally,
 * which would have silently mis-resolved scenario B below.
 *
 * Run with: node --test migration/nhtsa/normalization/__tests__
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { extractEvidence } from "../evidence.mjs";

function report(overrides = {}) {
  return {
    reporting_generation: "historical",
    report_id: "test-1",
    report_version: 1,
    same_incident_id: null,
    reporting_entity: "Test Entity",
    developer_or_operator: "Test Developer",
    incident_date: "2025-01-01",
    incident_date_precision: "month",
    city: "Test City",
    state: "CA",
    country_code: "US",
    automation_engagement_text: null,
    crash_interaction_counterpart_text: null,
    subject_vehicle_precrash_movement_text: null,
    other_actor_precrash_movement_text: null,
    injury_outcome_text: "No Injuries Reported",
    narrative: "",
    raw_row: {},
    retrieved_on: "2025-02-01",
    ...overrides,
  };
}

function candidateFrom(r) {
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

function engagementValue(narrative) {
  const r = report({ narrative });
  const c = candidateFrom(r);
  const { atoms } = extractEvidence(c, [r]);
  const atom = atoms.find((a) => a.field === "automation_engagement_narrative");
  return atom ? atom.value : null;
}

test("A: engaged -> disengaged -> manual/conventional mode -> contact resolves to not-engaged (real Mercedes case fcbf7f3b607c02b)", () => {
  const narrative =
    "The Mercedes-Benz vehicle was driven in conventional mode when the driver engaged L3 ADS for a few seconds. The driver then disengaged L3 ADS and continued to drive in conventional mode. The vehicle was manually braked to a stop adjacent to vehicles parked in the parking lot. While the Mercedes-Benz vehicle was stopped, the Chevrolet Camaro reversed out of its parking space and contacted the Mercedes-Benz vehicle.";
  assert.equal(engagementValue(narrative), "not-engaged");
});

test("B: disengaged -> re-engaged -> collision while autonomous resolves to engaged (NOT resolved by list order)", () => {
  const narrative =
    "The ADS was not engaged while the driver completed a lane check. The driver then re-engaged the system, and the Waymo AV was traveling in autonomous mode when the collision occurred.";
  assert.equal(engagementValue(narrative), "engaged");
});

test("C: engagement cue only resolves to engaged", () => {
  const narrative = "At the time of the impact, the Waymo AV's Level 4 ADS was engaged in autonomous mode.";
  assert.equal(engagementValue(narrative), "engaged");
});

test("D: disengagement cue only resolves to not-engaged", () => {
  const narrative = "At the time of the impact, the Waymo AV's Level 4 ADS was not engaged and a test driver was operating the Waymo AV in manual mode.";
  assert.equal(engagementValue(narrative), "not-engaged");
});

test("neither cue present yields no narrative engagement conclusion (null, not a guess)", () => {
  const narrative = "A collision occurred between the subject vehicle and a passenger car at an intersection.";
  assert.equal(engagementValue(narrative), null);
});

test("resolution is NOT determined by pattern-list order: scenario A and scenario B produce opposite conclusions despite both containing an ENGAGED cue and a NOT_ENGAGED cue", () => {
  const scenarioA = engagementValue(
    "The driver engaged L3 ADS for a few seconds. The driver then disengaged L3 ADS and continued to drive in conventional mode.",
  );
  const scenarioB = engagementValue(
    "The ADS was not engaged while the driver completed a lane check. The driver then re-engaged the system, and the vehicle was traveling in autonomous mode when the collision occurred.",
  );
  assert.equal(scenarioA, "not-engaged");
  assert.equal(scenarioB, "engaged");
  assert.notEqual(scenarioA, scenarioB, "a fixed list-order precedence would have forced both to the same value; position-based resolution correctly does not");
});

test("automation contribution remains a separate concept from engagement-at-impact: not-engaged does not by itself imply or preclude causation attribution", () => {
  // Same narrative as scenario A: automation was engaged earlier, disengaged
  // before contact. causation_status is driven by movement/contact-mechanism
  // atoms, not by automation_engagement_narrative — confirm the two remain
  // independently derived.
  const narrative =
    "The Mercedes-Benz vehicle was driven in conventional mode when the driver engaged L3 ADS for a few seconds. The driver then disengaged L3 ADS and continued to drive in conventional mode. The vehicle was manually braked to a stop. While the Mercedes-Benz vehicle was stopped, the Chevrolet Camaro reversed out of its parking space and contacted the Mercedes-Benz vehicle at the right rear door.";
  const r = report({ narrative, crash_interaction_counterpart_text: "Passenger Car", subject_vehicle_precrash_movement_text: "Stopped", other_actor_precrash_movement_text: "Backing" });
  const c = candidateFrom(r);
  const { atoms } = extractEvidence(c, [r]);
  const engagement = atoms.find((a) => a.field === "automation_engagement_narrative");
  assert.equal(engagement.value, "not-engaged");
  // No human-took-control-first or automation-action-before-handoff atom is
  // fabricated merely because engagement resolved to "not-engaged" — those
  // remain governed entirely by their own, separate patterns.
  assert.equal(atoms.some((a) => a.field === "human_took_control_before_contact_narrative"), false);
  assert.equal(atoms.some((a) => a.field === "automation_action_before_handoff_narrative"), false);
});

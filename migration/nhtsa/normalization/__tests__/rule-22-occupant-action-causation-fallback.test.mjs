/**
 * Focused regression tests for the Rule-22 investigation's approved
 * exception to the frozen normalization checkpoint: a narrow, actor-neutral
 * contradiction guard in classify.mjs that downgrades causation_status from
 * "other-party-contributed" to "undetermined" whenever
 * subject_occupant_action_narrative evidence is also present — since
 * REAR_END_PATTERNS/traffic-violation/lane-intrusion patterns have no
 * actor-type check and can match a door's contact just as readily as a
 * vehicle's.
 *
 * Uses the real, unmodified NHTSA narrative text for all 5 confirmed
 * Rule-22 candidates (verbatim from the frozen 2,843-candidate corpus, as
 * captured during the investigation), plus no-regression checks against
 * already-reviewed cases from the Category A faithfulness pass.
 *
 * Run with: node --test migration/nhtsa/normalization/__tests__
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { extractEvidence } from "../evidence.mjs";
import { classify } from "../classify.mjs";

function report(overrides) {
  return {
    reporting_generation: "historical",
    report_id: "r1",
    report_version: 1,
    same_incident_id: null,
    reporting_entity: "Waymo LLC",
    developer_or_operator: "Waymo LLC",
    incident_date: "2025-01-01",
    incident_date_precision: "month",
    city: "San Francisco",
    state: "CA",
    country_code: "US",
    automation_engagement_text: null,
    crash_interaction_counterpart_text: "SUV",
    subject_vehicle_precrash_movement_text: "Proceeding Straight",
    other_actor_precrash_movement_text: "Parked",
    injury_outcome_text: "No Injuries Reported",
    narrative: "",
    raw_row: {},
    retrieved_on: "2025-01-01",
    ...overrides,
  };
}

function candidateFrom(r) {
  return {
    same_incident_id: r.same_incident_id,
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

function classifyNarrative(narrative, overrides = {}) {
  const r = report({ narrative, ...overrides });
  const c = candidateFrom(r);
  const { atoms, disagreements } = extractEvidence(c, [r]);
  return { atoms, classification: classify(atoms, disagreements) };
}

const EXPECTED_JUSTIFICATION =
  "Narrative contains both a contact-mechanism pattern and an occupant/door-action pattern; this pipeline does not determine which actor's door is described, so no confident single-actor causation category is supported. Conservative default applied.";

function assertFallbackApplied(result) {
  assert.equal(result.classification.causation_status.value, "undetermined");
  assert.equal(result.classification.causation_status.confidence, "contested");
  assert.equal(result.classification.causation_status.justification, EXPECTED_JUSTIFICATION);
  // Actor-neutral: must NOT assert whose occupant/door it is, in either direction.
  assert.doesNotMatch(result.classification.causation_status.justification, /subject-vehicle occupant/i);
  assert.doesNotMatch(result.classification.causation_status.justification, /other party'?s occupant/i);
}

test("d62b1a61bfcc776: parked SUV's own passenger's door contacting the AV no longer asserts other-party-contributed", () => {
  const narrative =
    'On May [XXX], 2025 at 3:11 PM PT a Waymo Autonomous Vehicle ("Waymo AV") operating in San Francisco, California was in a collision involving an SUV on [XXX] near [XXX]. \nThe Waymo AV was stopped facing south in the leftmost lane on [XXX] for a queue of traffic at a red light at the intersection with [XXX]. While the Waymo AV remained stopped, an SUV traveling southbound on [XXX] along the curb parked adjacent to the Waymo AV. As the Waymo AV proceeded forward for the green light, the passenger of the parked SUV opened the rear passenger side door and the rear passenger side door made contact with the rear driver side of the Waymo AV. At the time of the impact, the Waymo AV\'s Level 4 ADS was engaged in autonomous mode. The Waymo AV sustained damage.';
  const result = classifyNarrative(narrative);
  assert.ok(result.atoms.some((a) => a.field === "subject_occupant_action_narrative" && a.value === true));
  assertFallbackApplied(result);
});

test("736fb36f9e489e1: subject's own passenger opens a door, a shuttle bus then strikes the stopped AV", () => {
  const narrative =
    "On May [XXX], 2026 at 12:02 PM PT a Waymo Autonomous Vehicle (\"Waymo AV\") operating in San Francisco, California was in a collision involving a bus on [XXX] near [XXX].\nThe Waymo AV was traveling northbound on [XXX] and slowing for a queue of traffic for a red light at the intersection with [XXX] when the Waymo AV passenger opened the rear right door, causing the Waymo AV to stop in-lane and activate its hazard lights for passenger dropoff. While the Waymo AV was stopped, a shuttle bus traveling southbound on [XXX] approached the Waymo AV from the front and slowed to a stop momentarily. The shuttle bus proceeded forward to pass the Waymo AV to the left, between the Waymo AV and a fire truck that was stopped facing north partially in the bike lane and in-lane on southbound [XXX], and the left side of the shuttle bus made contact with the rear left side of the Waymo AV. At the time of the impact, the Waymo AV's Level 4 ADS was engaged in autonomous mode. The Waymo AV sustained damage.";
  const result = classifyNarrative(narrative, { crash_interaction_counterpart_text: "Bus", subject_vehicle_precrash_movement_text: "Parked", other_actor_precrash_movement_text: "Passing" });
  assert.ok(result.atoms.some((a) => a.field === "subject_occupant_action_narrative" && a.value === true));
  assertFallbackApplied(result);
});

test("e5e7fbb48fed3ea: adjacent stopped SUV's own passenger's door contacting the AV", () => {
  const narrative =
    "On October [XXX], 2025 at 11:57 PM MT a Waymo Autonomous Vehicle (\"Waymo AV\") operating in Tempe, Arizona was in a collision involving a SUV on [XXX] at [XXX]. \nThe Waymo AV was stopped facing east in the fourth to the right lane on [XXX] in a queue of traffic for a red light at the intersection with [XXX]. An SUV was stopped facing east in the adjacent designated left turn lane to the left of the Waymo AV. As the light turned green and the Waymo AV began to proceed forward, a passenger in the SUV opened the front right side door, and the open front right side door of the SUV made contact with the rear left side of the Waymo AV. At the time of the impact, the Waymo AV's Level 4 ADS was engaged in autonomous mode. The Waymo AV sustained damage.";
  const result = classifyNarrative(narrative, { other_actor_precrash_movement_text: "Stopped" });
  assert.ok(result.atoms.some((a) => a.field === "subject_occupant_action_narrative" && a.value === true));
  assertFallbackApplied(result);
});

test("d6ba83005d45c1c: passengers entering an adjacent stopped SUV open its door into the AV", () => {
  const narrative =
    "On September [XXX], 2025 at 8:16 PM PT a Waymo Autonomous Vehicle (\"Waymo AV\") operating in San Francisco, California was in a collision involving an SUV on [XXX] at [XXX]. \nThe Waymo AV was traveling westbound in the middle of three lanes on [XXX] and came to a stop for a red light at the intersection with [XXX]. An SUV was stopped facing west in the left lane with its hazard lights activated. While the Waymo AV remained stopped, passengers entering the stationary SUV opened the rear right side door. The traffic light then turned green and the Waymo AV remained stopped for the passenger of the SUV standing to the left of the Waymo AV. Once the passengers entered the SUV, the Waymo AV proceeded forward, and the opened rear right door made contact with the rear left side of the Waymo AV. At the time of the impact, the Waymo AV's Level 4 ADS was engaged in autonomous mode. Both vehicles sustained damage.";
  const result = classifyNarrative(narrative, { other_actor_precrash_movement_text: "Stopped" });
  assert.ok(result.atoms.some((a) => a.field === "subject_occupant_action_narrative" && a.value === true));
  assertFallbackApplied(result);
});

test("d255c89929a41d5: subject's own passenger opens a door, a passing bus strikes it", () => {
  const narrative =
    "On June [XXX], 2025 at 6:48 PM PT a Waymo Autonomous Vehicle (\"Waymo AV\") operating in San Francisco, California was in a collision involving a bus on [XXX] at [XXX]. \nThe Waymo AV was parked facing south in the right lane on [XXX] at the intersection at [XXX] for a passenger drop-off with hazard lights activated. A bus was traveling southbound on [XXX] in the left adjacent lane. As the bus proceeded forward past the Waymo AV on the left, a Waymo AV passenger opened the rear driver side door and the front passenger side of the bus made contact with the rear driver side door of the Waymo AV. Three of the four passengers inside the Waymo AV were not belted at the time of impact. At the time of the impact, the Waymo AV's Level 4 ADS was engaged in autonomous mode. Both vehicles sustained damage.";
  const result = classifyNarrative(narrative, { crash_interaction_counterpart_text: "Bus", subject_vehicle_precrash_movement_text: "Parked", other_actor_precrash_movement_text: "Proceeding Straight" });
  assert.ok(result.atoms.some((a) => a.field === "subject_occupant_action_narrative" && a.value === true));
  assertFallbackApplied(result);
});

// ---------------------------------------------------------------------------
// No-regression: already-reviewed cases must be unaffected.
// ---------------------------------------------------------------------------

test("no regression (da37ed084b7182d-shaped positive control): occupant-action-only narrative (no competing rear-end/violation/lane-intrusion match) still resolves via the original subject-occupant-action branch, unchanged wording", () => {
  const narrative =
    "The Waymo AV was parked in-lane facing south on [XXX] for a passenger drop-off. A passenger opened the rear passenger side door and was exiting the Waymo AV when an SUV reversed out of a driveway and the rear of the SUV made contact with the open rear passenger side door of the Waymo AV. At the time of the impact, the Waymo AV's Level 4 ADS was engaged in autonomous mode.";
  const result = classifyNarrative(narrative, { subject_vehicle_precrash_movement_text: "Parked" });
  assert.equal(result.classification.causation_status.value, "undetermined");
  assert.match(result.classification.causation_status.justification, /subject-vehicle occupant's own action/i);
  assert.notEqual(result.classification.causation_status.justification, EXPECTED_JUSTIFICATION);
});

test("no regression: an ordinary rear-end with NO occupant-action evidence still resolves confidently to other-party-contributed", () => {
  const narrative =
    "The Waymo AV was stopped at a stop sign when a pick-up truck approached the Waymo AV from behind and made contact with the rear of the Waymo AV. At the time of the impact, the Waymo AV's Level 4 ADS was engaged in autonomous mode.";
  const result = classifyNarrative(narrative);
  assert.equal(result.classification.causation_status.value, "other-party-contributed");
  assert.equal(result.classification.causation_status.confidence, "well-supported");
});

test("no regression: an ordinary traffic-violation narrative with NO occupant-action evidence still resolves confidently", () => {
  const narrative =
    "The Waymo AV was proceeding through a green light when a passenger vehicle ran the red light and struck the front of the Waymo AV. At the time of the impact, the Waymo AV's Level 4 ADS was engaged in autonomous mode.";
  const result = classifyNarrative(narrative);
  assert.equal(result.classification.causation_status.value, "other-party-contributed");
  assert.equal(result.classification.causation_status.confidence, "well-supported");
});

test("no regression: the disputed-field confidence downgrade still applies independently of the new occupant-action guard", () => {
  const narrative =
    "The Waymo AV was stopped at a stop sign when a pick-up truck approached the Waymo AV from behind and made contact with the rear of the Waymo AV. At the time of the impact, the Waymo AV's Level 4 ADS was engaged in autonomous mode.";
  const r1 = report({ narrative, subject_vehicle_precrash_movement_text: "Stopped" });
  const r2 = report({ narrative, subject_vehicle_precrash_movement_text: "Proceeding Straight", report_id: "r2" });
  const c = candidateFrom(report({ narrative, subject_vehicle_precrash_movement_text: null }));
  const { atoms, disagreements } = extractEvidence(c, [r1, r2]);
  const result = classify(atoms, disagreements);
  assert.equal(result.causation_status.value, "other-party-contributed");
  assert.equal(result.causation_status.confidence, "contested");
  assert.match(result.causation_status.justification, /downgraded: a field this classification relies on is itself disputed/i);
});

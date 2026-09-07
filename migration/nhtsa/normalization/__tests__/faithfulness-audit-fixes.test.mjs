/**
 * Focused regression tests for the four Category A faithfulness fixes from
 * the Final Faithfulness Audit:
 *   A1 - multi-actor/chain-reaction causation must not be confidently
 *        attributed to a single actor (7bf2bd79eaff634, 1988e25397f633d).
 *   A2 - explicit "no contact occurred" source language must prevent
 *        event_type=collision (8c56b788577d262, e030f01d2992e85).
 *   A3 - "took/assumed control" must not be asserted as before-contact when
 *        the source explicitly places it after contact (c397f44794adc7e,
 *        plus 276c44175c4e6fa/b42deb39142d807/4ce5e32b26da9ff found via
 *        full-corpus scan to share the identical phrasing).
 *   A4 - occupant/door action must not be attributed to the subject vehicle
 *        when the source attributes it to another vehicle (6e5234c59081cf5).
 *
 * Real, unmodified NHTSA narrative text (verbatim from the frozen
 * scale-up-eval fixtures) is used throughout, per the audit's own citations
 * — not synthetic paraphrase — so these tests exercise exactly the evidence
 * that motivated each fix.
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
    reporting_entity: "Test",
    developer_or_operator: "Waymo LLC",
    incident_date: "2025-01-01",
    incident_date_precision: "month",
    city: "Phoenix",
    state: "AZ",
    country_code: "US",
    automation_engagement_text: null,
    crash_interaction_counterpart_text: "Other, see Narrative",
    subject_vehicle_precrash_movement_text: "Other, see Narrative",
    other_actor_precrash_movement_text: "Other, see Narrative",
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
  return { atoms, disagreements, classification: classify(atoms, disagreements) };
}

// ---------------------------------------------------------------------------
// A1 - multi-actor / chain-reaction causation
// ---------------------------------------------------------------------------

const CAT_PILEUP_NARRATIVE =
  "The Waymo AV was traveling southbound in the leftmost lane, proceeding through a green light at the intersection. As the Waymo AV exited the intersection, a cat crossed the street, and began to enter the Waymo AV's lane of travel. As the Waymo AV braked, the front of the Waymo AV made contact with the cat, which subsequently ran away, and the Waymo AV came to a stop. The front of an SUV traveling directly behind the Waymo AV then made contact with the right rear of the stationary Waymo AV. A passenger car then braked to a stop behind the Waymo and to the left of the SUV. A second passenger car then made contact with the SUV and the first passenger car. At the time of the impact, the Waymo AV's Level 4 ADS was engaged in autonomous mode.";

const FIVE_VEHICLE_PILEUP_NARRATIVE =
  "The Waymo AV was stopped in autonomous mode facing south at a red light as the lead vehicle when an SUV traveling northbound in an oncoming traffic lane ran the red light. As the oncoming SUV entered the intersection, it made contact with a passenger car traveling east. The oncoming SUV continued through the intersection and swerved to narrowly miss a pedestrian before making contact with the front of the Waymo AV and the front driver side of a stationary pickup truck to the right of the Waymo AV. The impact from the oncoming SUV caused the Waymo AV to contact another SUV that was also stationary to the left of the Waymo AV. At the time of the impact, the Waymo AV's Level 4 ADS was not engaged and a test driver was operating the Waymo AV in manual mode.";

test("A1 (7bf2bd79eaff634-shaped): cat-then-4-vehicle-pileup narrative no longer confidently attributes causation to the cat's lane entry", () => {
  const { atoms, classification } = classifyNarrative(CAT_PILEUP_NARRATIVE);
  assert.ok(atoms.some((a) => a.field === "multi_actor_chain_reaction_narrative" && a.value === true));
  assert.equal(classification.causation_status.value, "undetermined");
  assert.equal(classification.causation_status.confidence, "contested");
  assert.doesNotMatch(classification.causation_status.justification, /lane of travel/i);
});

test("A1 (1988e25397f633d-shaped): 5-vehicle pileup narrative no longer confidently attributes causation via the red-light pattern alone", () => {
  const { atoms, classification } = classifyNarrative(FIVE_VEHICLE_PILEUP_NARRATIVE);
  assert.ok(atoms.some((a) => a.field === "multi_actor_chain_reaction_narrative" && a.value === true));
  assert.equal(classification.causation_status.value, "undetermined");
  assert.equal(classification.causation_status.confidence, "contested");
});

test("A1 no-regression: a genuine single-other-party rear-end (2 contact mentions) still resolves confidently", () => {
  const narrative =
    "The Waymo AV was traveling eastbound and stopped at a stop sign when a pick-up truck approached from behind and made contact with the rear of the Waymo AV. The Waymo AV test driver then took manual control and the pick-up truck made contact with the rear of the Waymo AV again. The Waymo AV sustained damage.";
  const { atoms, classification } = classifyNarrative(narrative);
  assert.equal(atoms.some((a) => a.field === "multi_actor_chain_reaction_narrative"), false);
  assert.equal(classification.causation_status.value, "other-party-contributed");
  assert.equal(classification.causation_status.confidence, "well-supported");
});

test("A1 no-regression: an ordinary single-contact narrative is unaffected", () => {
  const narrative =
    "The Waymo AV was stopped at a red light when a passenger vehicle ran the red light and struck the front of the Waymo AV. At the time of the impact, the Waymo AV's Level 4 ADS was engaged in autonomous mode.";
  const { atoms, classification } = classifyNarrative(narrative);
  assert.equal(atoms.some((a) => a.field === "multi_actor_chain_reaction_narrative"), false);
  assert.equal(classification.causation_status.value, "other-party-contributed");
});

// ---------------------------------------------------------------------------
// A2 - explicit no-contact contradiction
// ---------------------------------------------------------------------------

const NO_DATA_KNOWLEDGE_NARRATIVE =
  "The Waymo AV was in autonomous mode and preparing to enter southbound traffic as a passenger vehicle approached from behind. A pickup truck was traveling next to the passenger vehicle. As the passenger vehicle approached the Waymo AV from behind, the passenger vehicle entered the adjacent lane occupied by the pickup truck and maneuvered around the Waymo AV. The pickup truck proceeded without stopping. Transdev has no data or knowledge of any contact between any of the three vehicles. There was no contact or collision between the Waymo AV and any other vehicle. However, the driver and passenger in the passenger vehicle have subsequently alleged injuries.";

const MADE_NO_CONTACT_NARRATIVE =
  "The subject vehicle was traveling on the highway having recently passed a pickup truck (vehicle #2) towing a trailer. A large piece of road debris caused vehicle #2 to slow and veer onto the shoulder. The VO steered the subject vehicle into the left lane to pass the debris. An ambulance (vehicle #3) was traveling in the left lane to the rear of the subject vehicle. The subject vehicle made no contact with vehicle #2 or vehicle #3.";

test("A2 (8c56b788577d262-shaped): explicit 'no data or knowledge of any contact' / 'no contact or collision' narrative does not classify as collision", () => {
  const { atoms, classification } = classifyNarrative(NO_DATA_KNOWLEDGE_NARRATIVE);
  assert.ok(atoms.some((a) => a.field === "no_contact_occurred_narrative" && a.value === true));
  assert.equal(classification.event_type.value, "other");
  assert.notEqual(classification.event_type.value, "collision");
  assert.doesNotMatch(classification.event_type.justification, /^Default classification/);
});

test("A2 (e030f01d2992e85-shaped): explicit 'made no contact with' narrative does not classify as collision, and near-miss is not inferred either", () => {
  const { atoms, classification } = classifyNarrative(MADE_NO_CONTACT_NARRATIVE);
  assert.ok(atoms.some((a) => a.field === "no_contact_occurred_narrative" && a.value === true));
  assert.equal(classification.event_type.value, "other");
  assert.notEqual(classification.event_type.value, "near-miss-or-safety-critical");
});

test("A2 no-regression: an ordinary collision narrative (no no-contact language) still defaults to collision", () => {
  const narrative =
    "The Waymo AV was traveling southbound when a passenger vehicle changed lanes and struck the front of the Waymo AV. At the time of the impact, the Waymo AV's Level 4 ADS was engaged in autonomous mode.";
  const { atoms, classification } = classifyNarrative(narrative);
  assert.equal(atoms.some((a) => a.field === "no_contact_occurred_narrative"), false);
  assert.equal(classification.event_type.value, "collision");
});

// ---------------------------------------------------------------------------
// A3 - human-control timing (before vs. after contact)
// ---------------------------------------------------------------------------

const MOTIONAL_CYCLIST_NARRATIVE =
  "The AV was traveling westbound and was making a left turn onto southbound traffic at a green light. A group of cyclists ignored the red light signal and began traveling southbound towards the AV. Once the AV perceived the cyclists ignoring the red light signal, it braked and came to a stop. One cyclist made contact with the stopped AV but did not fall, stop, or sustain any injury. Following the contact, the safety driver assumed control of the vehicle and safely pulled over to the side of the road to initiate Motional's incident response protocol.";

test("A3 (c397f44794adc7e): 'Following the contact, the safety driver assumed control' is NOT asserted as before-contact", () => {
  const { atoms } = classifyNarrative(MOTIONAL_CYCLIST_NARRATIVE);
  assert.equal(atoms.some((a) => a.field === "human_took_control_before_contact_narrative"), false);
  assert.ok(atoms.some((a) => a.field === "human_took_control_timing_unknown_narrative" && a.value === true));
});

test("A3 (276c44175c4e6fa-shaped): 'Following the impact, the safety driver assumed control' is NOT asserted as before-contact", () => {
  const narrative =
    "While in the right-turn lane, the AV was slowing to stop at a yield sign for cross traffic, and a Cadillac SUV rear-ended the AV at approximately 1-5 MPH. Following the impact, the safety driver assumed control of the vehicle and pulled safely over to exchange information.";
  const { atoms, classification } = classifyNarrative(narrative);
  assert.equal(atoms.some((a) => a.field === "human_took_control_before_contact_narrative"), false);
  assert.ok(atoms.some((a) => a.field === "human_took_control_timing_unknown_narrative" && a.value === true));
  // Causation still resolves via the independent rear-end pattern, unaffected.
  assert.equal(classification.causation_status.value, "other-party-contributed");
});

test("A3 no-regression: a genuinely pre-contact handoff (no post-contact marker) still asserts before-contact", () => {
  const narrative =
    "The Waymo AV was traveling northbound. The Waymo AV test driver took manual control of the vehicle and attempted a lane change. The Waymo AVs undercarriage then made contact with a speed bump (the AV did not contact any vehicle or other road user).";
  const { atoms } = classifyNarrative(narrative, { crash_interaction_counterpart_text: "Other, see Narrative" });
  assert.ok(atoms.some((a) => a.field === "human_took_control_before_contact_narrative" && a.value === true));
  assert.equal(atoms.some((a) => a.field === "human_took_control_timing_unknown_narrative"), false);
});

test("A3 no-regression: the round-2 hardening's confirmed positive control (pre-contact curb handoff shape) is unaffected", () => {
  const narrative =
    "The Motional AV was traveling in autonomous mode approaching a curb. The safety driver took control of the vehicle and brought it off the curb. No further contact was reported.";
  const { atoms } = classifyNarrative(narrative);
  assert.ok(atoms.some((a) => a.field === "human_took_control_before_contact_narrative" && a.value === true));
  assert.equal(atoms.some((a) => a.field === "human_took_control_timing_unknown_narrative"), false);
});

// ---------------------------------------------------------------------------
// A4 - occupant/door actor ownership
// ---------------------------------------------------------------------------

const OTHER_AV_DOOR_NARRATIVE =
  'The Waymo AV was traveling northbound when it slowed to a stop in-lane to yield to a second Waymo AV parked facing north near the east curb and partially in-lane with its hazard lights activated ("Parked Waymo AV"). After stopping momentarily, the Waymo AV proceeded forward to pass the Parked Waymo AV on the left and a passenger in the Parked Waymo AV opened the rear left door of the Parked Waymo AV. The front right side of the Waymo AV made contact with the open rear left door of the Parked Waymo AV. At the time of the impact, the Waymo AV\'s Level 4 ADS was engaged in autonomous mode.';

test("A4 (6e5234c59081cf5): occupant/door action explicitly attributed to the OTHER (parked) AV is not asserted as a subject-vehicle occupant action", () => {
  const { atoms, classification } = classifyNarrative(OTHER_AV_DOOR_NARRATIVE);
  assert.equal(atoms.some((a) => a.field === "subject_occupant_action_narrative"), false);
  assert.doesNotMatch(classification.causation_status.justification, /subject-vehicle occupant's own action/i);
});

test("A4 no-regression (da37ed084b7182d-shaped positive control): a genuine subject-vehicle occupant door-opening is still recognized", () => {
  const narrative =
    "The Waymo AV was parked in-lane facing south for a passenger drop-off. A passenger opened the rear passenger side door and was exiting the Waymo AV when an SUV reversed out of a driveway and the rear of the SUV made contact with the open rear passenger side door of the Waymo AV. At the time of the impact, the Waymo AV's Level 4 ADS was engaged in autonomous mode.";
  const { atoms, classification } = classifyNarrative(narrative);
  assert.ok(atoms.some((a) => a.field === "subject_occupant_action_narrative" && a.value === true));
  assert.equal(classification.causation_status.value, "undetermined");
  assert.match(classification.causation_status.justification, /subject-vehicle occupant's own action/i);
});

test("A4 no-regression (9fc806cd1d491d5-shaped positive control): a subject-vehicle occupant exiting through their own door is still recognized", () => {
  const narrative =
    "The Waymo AV was travelling westbound. While the Waymo AV was in motion, a passenger seated in the rear right of the Waymo AV removed their seatbelt and opened the right rear passenger side door. The Waymo AV detected the opened door and began to slow in-lane. While the Waymo AV was slowing, the passenger exited the vehicle through the open door and the rear right tire of the Waymo AV made contact with the Waymo AV passenger. At the time of the impact, the Waymo AV's Level 4 ADS was engaged in autonomous mode.";
  const { atoms } = classifyNarrative(narrative);
  assert.ok(atoms.some((a) => a.field === "subject_occupant_action_narrative" && a.value === true));
});

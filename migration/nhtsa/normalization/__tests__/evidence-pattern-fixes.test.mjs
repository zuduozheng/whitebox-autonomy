/**
 * Focused regression tests for the Step 4 pattern fixes, one per demonstrated
 * stress-test gap. Each test reproduces the exact failing narrative from the
 * stress-test fixture (not a paraphrase) and checks only the specific atom
 * the fix targets.
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
    report_submission_date: "2025-02-01",
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

function candidateFrom(report_, overrides = {}) {
  return {
    same_incident_id: null,
    developer_or_operator: report_.developer_or_operator,
    city: report_.city,
    state: report_.state,
    country_code: "US",
    crash_interaction_counterpart: report_.crash_interaction_counterpart_text,
    subject_vehicle_precrash_movement: report_.subject_vehicle_precrash_movement_text,
    other_actor_precrash_movement: report_.other_actor_precrash_movement_text,
    injury_outcome_text: report_.injury_outcome_text,
    automation_engagement_text: report_.automation_engagement_text,
    incident_date: report_.incident_date,
    incident_date_precision: report_.incident_date_precision,
    narrative: report_.narrative,
    curator_note: null,
    ...overrides,
  };
}

function findAtom(atoms, field) {
  return atoms.find((a) => a.field === field);
}

test("gap 1: bare 'contact with the pavement' now triggers the single-vehicle-infrastructure pattern (case 27528ff2c99e583)", () => {
  const narrative =
    "On October 21, 2022 at 8:27 AM PST a Waymo Autonomous Vehicle (\"Waymo AV\") operating in San Francisco, California made contact with the pavement on a steep hill. The Waymo AV was on a steep hill, turning, when the Waymo AV's undercarriage made contact with the pavement (the AV did not contact any vehicle or road user). At the time of the impact, the Waymo AV's Level 4 ADS was engaged in autonomous mode.";
  const r = report({ narrative, crash_interaction_counterpart_text: "Other, see Narrative" });
  const c = candidateFrom(r);
  const { atoms } = extractEvidence(c, [r]);
  assert.ok(findAtom(atoms, "single_vehicle_infrastructure_contact_narrative"), "expected the infrastructure-contact atom to fire");
});

test("gap 1: 'speed bump' now triggers the single-vehicle-infrastructure pattern (case 374f676fee2c3db)", () => {
  const narrative =
    "On May 1, 2023 at 5:54 PM PT a Waymo Autonomous Vehicle (Waymo AV) operating in Phoenix, Arizona made contact with an asphalt speed bump in a parking lot. The Waymo AVs undercarriage then made contact with a speed bump (the AV did not contact any vehicle or other road user). At the time of the contact, the Waymo AVs Level 4 ADS was engaged in autonomous mode.";
  const r = report({ narrative, crash_interaction_counterpart_text: "Other, see Narrative" });
  const c = candidateFrom(r);
  const { atoms } = extractEvidence(c, [r]);
  assert.ok(findAtom(atoms, "single_vehicle_infrastructure_contact_narrative"), "expected the infrastructure-contact atom to fire");
});

test("gap 1 negative control unaffected: bare 'pavement' with a concrete other party still does NOT fire (no over-broadening)", () => {
  const narrative =
    "A pickup truck struck the stationary Waymo AV while both were on the pavement near the intersection.";
  const r = report({ narrative, crash_interaction_counterpart_text: "Pickup Truck" });
  const c = candidateFrom(r);
  const { atoms } = extractEvidence(c, [r]);
  assert.equal(findAtom(atoms, "single_vehicle_infrastructure_contact_narrative"), undefined);
});

test("gap 2: 'made physical contact with the rear... of the AV' now matches the rear-end pattern (case 0229e852164543d)", () => {
  const narrative =
    "The AV perceived debris as a road obstruction, causing the AV to brake. An SUV taxi was following the AV and made physical contact with the rear of the AV.";
  const r = report({ narrative });
  const c = candidateFrom(r);
  const { atoms } = extractEvidence(c, [r]);
  const mech = findAtom(atoms, "contact_mechanism_narrative");
  assert.ok(mech && mech.value === "other-party-rear-ended-subject");
});

test("gap 2 negative control unaffected: direction guard still holds (subject striking another object's rear does not fire)", () => {
  const narrative = "The Waymo AV made physical contact with the rear of a parked trailer while changing lanes.";
  const r = report({ narrative });
  const c = candidateFrom(r);
  const { atoms } = extractEvidence(c, [r]);
  assert.equal(findAtom(atoms, "contact_mechanism_narrative"), undefined);
});

test("gap 3: 'engaged L3 ADS ... disengaged L3 ADS ... manually braked' now classifies as not-engaged, not silently 'unknown' (case fcbf7f3b607c02b)", () => {
  const narrative =
    "The Mercedes-Benz vehicle was driven in conventional mode when the driver engaged L3 ADS for a few seconds. The driver then disengaged L3 ADS and continued to drive in conventional mode. The vehicle was manually braked to a stop.";
  const r = report({ narrative });
  const c = candidateFrom(r);
  const { atoms } = extractEvidence(c, [r]);
  const engagement = findAtom(atoms, "automation_engagement_narrative");
  assert.ok(engagement, "expected an automation_engagement_narrative atom");
  assert.equal(engagement.value, "not-engaged", "a narrative describing engagement followed by an explicit disengagement should report the state nearer to contact (not-engaged), not the earlier, superseded engaged state");
});

test("gap 3 positive path unaffected: an engagement with NO later disengagement still reports 'engaged' (no regression)", () => {
  const narrative = "The driver engaged L3 ADS and the vehicle proceeded in autonomous mode when the collision occurred.";
  const r = report({ narrative });
  const c = candidateFrom(r);
  const { atoms } = extractEvidence(c, [r]);
  const engagement = findAtom(atoms, "automation_engagement_narrative");
  assert.ok(engagement);
  assert.equal(engagement.value, "engaged");
});

test("gap 4: 'opened the right rear passenger side door' now matches the occupant-action pattern (cases 9b6219cb373795e / 9fc806cd1d491d5)", () => {
  const narrative =
    "While the AV was in motion, the two passengers seated in the rear of the Waymo AV removed their seatbelts and opened the right rear passenger side door. The Waymo AV detected the opened door and began to slow in lane.";
  const r = report({ narrative, crash_interaction_counterpart_text: "Non-Motorist: Pedestrian" });
  const c = candidateFrom(r);
  const { atoms } = extractEvidence(c, [r]);
  assert.ok(findAtom(atoms, "subject_occupant_action_narrative"), "expected the occupant-action atom to fire");
});

test("gap 4 positive control unaffected: the original, unmodified phrasing still matches (case da37ed084b7182d)", () => {
  const narrative = "A passenger opened the rear passenger side door and was exiting the Waymo AV when an SUV reversed out of a driveway.";
  const r = report({ narrative, crash_interaction_counterpart_text: "SUV" });
  const c = candidateFrom(r);
  const { atoms } = extractEvidence(c, [r]);
  assert.ok(findAtom(atoms, "subject_occupant_action_narrative"));
});

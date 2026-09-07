/**
 * Focused regression tests for the Step 3 representativeNarrative fix
 * (targeted adversarial stress test, cases d9ef2eb5a3957bb and
 * 34e9268c40d9f69 — GM/Cruise duplicate filings). Exercised through the
 * public consolidateCandidate() API (representativeNarrative itself is a
 * private helper), using the real narrative text from the stress-test
 * fixture, not a paraphrase.
 *
 * Run with: node --test migration/nhtsa/normalization/__tests__
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { consolidateCandidate } from "../../mapping.mjs";

function baseReport(overrides) {
  return {
    reporting_generation: "historical",
    report_id: "r1",
    report_version: 1,
    same_incident_id: "test-incident",
    reporting_entity: "Test Entity",
    developer_or_operator: "Cruise LLC",
    incident_date: "2023-07-01",
    incident_date_precision: "month",
    city: "San Francisco",
    state: "CA",
    country_code: "US",
    automation_engagement_text: null,
    crash_interaction_counterpart_text: "Other, see Narrative",
    subject_vehicle_precrash_movement_text: "Proceeding Straight",
    other_actor_precrash_movement_text: "Stopped",
    injury_outcome_text: "No Injuries Reported",
    narrative: "",
    ...overrides,
  };
}

const GM_BOILERPLATE =
  "On July 14, 2023, GM Cruise Holdings LLC (\"Cruise\") filed an Incident Report (the \"Report\") under the Second Amended Standing General Order 2021-01, dated April 5, 2023 (the \"Order\"). General Motors LLC (GM) manufactured the Cruise-operated motor vehicle involved in the incident summarized in the Incident Report. Because GM is also a Reporting Entity under the Order, GM is submitting a duplicate of the redacted public copy of the Report. GM has selected \"Unknown\" in the \"ADS version\" and \"ODD time\" fields solely to avoid a second submission of nonpublic Cruise CBI GM is in possession of Cruise's responses to these fields, and incorporates Cruise's responses into this submission by reference. GM's submission is based on facts supplied to GM by Cruise. GM has not investigated the alleged incident and currently believes, based on a reasonable inquiry, that it has no independent knowledge of the facts in the Report. (Reference file: 30412-5782-1)";

const CRUISE_SUBSTANTIVE =
  "A Cruise autonomous vehicle (\"Cruise AV\"), operating in driverless autonomous mode, was traveling eastbound on X between Y and Z. The Cruise AV approached a motorized articulating boom lift (\"ABL\"), which was stopped in the Cruise AV's lane of travel. As the Cruise AV began to maneuver around and to the left of the ABL, the Cruise AV made contact with the arm of the ABL, which was elevated above the roadway. This caused damage to the Cruise AV's roof Lidar assembly. There were no reported injuries.";

test("requirement 1: substantive event narrative outranks longer administrative boilerplate (synthetic, unambiguous case)", () => {
  const gmReport = baseReport({ report_id: "gm-1", reporting_entity: "General Motors LLC", narrative: GM_BOILERPLATE });
  const cruiseReport = baseReport({ report_id: "cruise-1", narrative: CRUISE_SUBSTANTIVE });
  assert.ok(GM_BOILERPLATE.length > CRUISE_SUBSTANTIVE.length, "sanity check: boilerplate really is the longer text");
  const candidate = consolidateCandidate([gmReport, cruiseReport], "test-incident");
  assert.equal(candidate.narrative, CRUISE_SUBSTANTIVE);
});

test("requirement 2: the actual reproduced GM/Cruise stress-test case (d9ef2eb5a3957bb, boom-lift) is fixed", () => {
  const gmReport = baseReport({
    report_id: "540-5940",
    reporting_entity: "General Motors LLC",
    injury_outcome_text: "Unknown",
    narrative: GM_BOILERPLATE,
  });
  const cruiseReport = baseReport({
    report_id: "30412-5782",
    injury_outcome_text: "No Injuries Reported",
    narrative: CRUISE_SUBSTANTIVE,
  });
  const candidate = consolidateCandidate([gmReport, cruiseReport], "test-incident");
  assert.equal(candidate.narrative, CRUISE_SUBSTANTIVE, "the substantive Cruise account, not GM's boilerplate, must be selected");
});

test("requirement 2b: the second reproduced GM/Cruise case (34e9268c40d9f69, pothole) is fixed", () => {
  const gmBoilerplatePothole = GM_BOILERPLATE.replace("30412-5782-1", "30412-5624-1").replace("July 14, 2023", "May 26, 2023");
  const cruisePothole =
    "A Cruise autonomous vehicle (\"Cruise AV\"), operating in driverless autonomous mode, was traveling eastbound on X between Y and Z. As the Cruise AV approached the intersection with W, the Cruise AV traveled over a pothole, which blew out the front driver side tire and caused the Cruise AV to veer into the adjacent parking lane. Shortly thereafter, the Cruise AV made contact with a parked Subaru Impreza, causing damage. Police and Emergency Medical Services were called and the Cruise AV was towed from the scene.";
  const gmReport = baseReport({ report_id: "540-5639", reporting_entity: "General Motors LLC", city: "San Drancisco", narrative: gmBoilerplatePothole });
  const cruiseReport = baseReport({ report_id: "30412-5624", city: "San Francisco", narrative: cruisePothole });
  const candidate = consolidateCandidate([gmReport, cruiseReport], "test-incident");
  assert.equal(candidate.narrative, cruisePothole);
});

test("requirement 3: narrative selection does not erase a materially conflicting disagreement — structured-field disagreement is preserved regardless of which narrative wins", () => {
  const gmReport = baseReport({ report_id: "540-5940", reporting_entity: "General Motors LLC", injury_outcome_text: "Unknown", narrative: GM_BOILERPLATE });
  const cruiseReport = baseReport({ report_id: "30412-5782", injury_outcome_text: "No Injuries Reported", narrative: CRUISE_SUBSTANTIVE });
  const candidate = consolidateCandidate([gmReport, cruiseReport], "test-incident");
  // The two reports disagree on injury_outcome_text regardless of which
  // narrative was picked as representative — narrative selection and
  // disagreement detection are independent mechanisms, and fixing the
  // former must not silently resolve or hide the latter.
  assert.equal(candidate.injury_outcome_text, null);
  const disagreement = candidate._disagreements.find((d) => d.field === "injury_outcome_text");
  assert.ok(disagreement, "the injury disagreement must still be recorded even though a definite representative narrative was chosen");
  assert.deepEqual(new Set(disagreement.values), new Set(["Unknown", "No Injuries Reported"]));
});

test("no regression: near-duplicate narratives with equal evidence-bearing score still tie-break by length, then generation/report_id (unchanged prior behavior)", () => {
  const shortText = "On November 1, 2021 a Waymo Autonomous Vehicle was in a collision. The Waymo AV was stopped at a stop sign when a passenger vehicle made contact with the rear bumper.";
  const longText = shortText + " Other than updating the weather field, the content of this report is unchanged from the initial report.";
  const r1 = baseReport({ report_id: "a-1", narrative: shortText });
  const r2 = baseReport({ report_id: "a-2", narrative: longText });
  const candidate = consolidateCandidate([r1, r2], "test-incident");
  assert.equal(candidate.narrative, longText, "equal-score near-duplicates should still resolve by length, as before this fix");
});

/**
 * Evidence extraction — Stage 1 of the NHTSA -> WBA normalization pipeline.
 *
 * Reads a consolidated nhtsa_incident_candidate plus its contributing
 * nhtsa_report rows and produces a flat list of EVIDENCE / DERIVED atoms.
 * This is the ONLY stage allowed to read raw narrative text. Everything
 * downstream (classification) consumes only the atom list produced here —
 * never the original report objects — so a classifier can never "helpfully"
 * pull in narrative detail it wasn't handed as evidence.
 *
 * Provenance tiers (see docs/nhtsa-normalization-rulebook.md):
 *   EVIDENCE  — a verbatim/closely-paraphrased statement from a specific
 *               report or the consolidated candidate, with a source pointer.
 *   DERIVED   — a deterministic, judgment-free transformation of one or more
 *               EVIDENCE atoms (date formatting, location_precision choice,
 *               cosmetic alias/typo resolution).
 * (CLASSIFICATION and UNSUPPORTED are produced by classify.mjs, not here.)
 */

import { resolveDeveloperAlias } from "./alias-table.mjs";
import { resolveCosmeticOrApprovedVariant } from "./cosmetic-resolution.mjs";

/** Phrases that extractively establish automation engagement from narrative
 * prose — used only for historical-generation reports, whose structured
 * automation_engagement_text is always null by design (the field records
 * system TYPE, not engagement STATE, for that generation). Current-generation
 * reports use the structured field directly and never need this fallback. */
const ENGAGED_PATTERNS = [
  /level\s+4\s+ads\s+was\s+engaged/i,
  /ads\s+was\s+engaged\s+in\s+autonomous\s+mode/i,
  /traveling\s+in\s+autonomous\s+mode/i,
  /operating\s+in\s+autonomous\s+mode/i,
  // ADDED (stress test case fcbf7f3b607c02b): consumer L2/L3 ADAS narratives
  // use "engaged L3 ADS" rather than the commercial-fleet "Level 4 ADS was
  // engaged" / "autonomous mode" phrasing the four patterns above were
  // tuned to. Narrow, level-agnostic addition — same phrase shape, not a
  // new vocabulary category. The negative lookbehind is required: without
  // it, this pattern also matches as a bare substring of "disengaged L3
  // ADS" (since "engaged" is literally contained inside "disengaged"),
  // which would wrongly register an ENGAGED cue at the exact position of a
  // NOT-ENGAGED statement — caught by the new position-based dual-cue tests
  // added alongside the round-2 independent-review fix.
  /(?<!dis)engaged\s+l\d+\s+ads\b/i,
];
const NOT_ENGAGED_PATTERNS = [
  /ads\s+was\s+not\s+engaged/i,
  /in\s+manual\s+mode/i,
  /took\s+manual\s+control/i,
  /disengaged\s+autonom(y|ous)/i,
  /disengaged\s+from\s+autonomy/i,
  // ADDED (stress test case fcbf7f3b607c02b): the disengage-side counterpart
  // to the "engaged L3 ADS" addition above ("disengaged L3 ADS").
  /disengaged\s+l\d+\s+ads\b/i,
];

/**
 * Hedge phrases that must be preserved (not resolved into an unqualified
 * claim) when they appear in narrative text — feeds validation rule 9.
 *
 * SCOPED BY TOPIC (revised after out-of-sample review found a bare
 * /alleged/i trigger conflating unrelated things): a bare word like
 * "alleged" appears in this corpus in at least three unrelated senses —
 * "the passenger alleged a minor injury" (about injury, not mechanism), "GM
 * has not investigated the alleged incident" (fixed legal boilerplate
 * appearing in every GM/Cruise duplicate filing, not case-specific content),
 * and genuine event-mechanics uncertainty ("may have made contact", "is not
 * clear"). Downstream code (classify.mjs) must only treat 'mechanism'/'other'
 * topic hedges as relevant to causation — never 'injury' or 'administrative'.
 */
const HEDGE_PATTERN_GROUPS = {
  mechanism: [/\bmay have\b/i, /\bis not clear\b/i, /\bbecame aware\b.*\breview\b/i],
  injury: [/alleged\s+(a\s+)?(minor|serious|moderate|no)?\s*injur\w*/i],
  administrative: [/investigated the alleged incident/i],
  other: [/\breportedly\b/i],
};

/** Narrative phrasing indicating the OTHER party struck the SUBJECT
 * vehicle's rear — extracted here so the classification stage never has to
 * re-read narrative to recover this mechanic when the structured movement
 * field is unavailable due to a report-to-report disagreement. Direction
 * matters: these patterns require the rear referenced to belong to the AV
 * itself (e.g. "rear of the Waymo AV", "rear driver side of the AV") or use
 * the inherently subject-as-victim passive "rear-ended" — NOT a bare "made
 * contact with the rear" / "struck the rear", which also matches the
 * opposite direction (the subject vehicle striking some OTHER object's
 * rear, as in a lane-change contact with a passing trailer). An earlier,
 * direction-agnostic version of this pattern produced exactly that false
 * positive during pilot validation; fixed here. */
const REAR_END_PATTERNS = [
  /struck the rear of the (\w+ )?av\b/i,
  // ADDED (stress test case 0229e852164543d): tolerate one optional
  // adjective between "made" and "contact" ("made physical contact with the
  // rear... of the AV") — narrow, single-word gap, mirroring the same kind
  // of tolerance already used elsewhere in this file (e.g.
  // SUBJECT_OCCUPANT_ACTION_PATTERNS), not a broad rewrite of the pattern.
  /made\s+(\w+\s+)?contact with the rear[a-z ]{0,20}of the (\w+ )?av\b/i,
  /\brear-ended\b/i,
];

/** FAITHFULNESS FIX A1 (final faithfulness audit, findings 7bf2bd79eaff634 /
 * 1988e25397f633d): a narrow, high-precision signal that a narrative
 * describes MORE THAN ONE distinct contact event — a chain-reaction/
 * multi-actor sequence, not a simple two-party crash. This is deliberately a
 * COUNT of contact-verb phrases, not an attempt to identify or reason about
 * the actors involved (no multi-agent causal reasoning is attempted). Used
 * only to SUPPRESS a confident single-actor causation attribution in
 * classify.mjs — it never itself asserts who was responsible. Threshold of 3
 * was chosen empirically: both confirmed misattribution cases contain
 * exactly 3 distinct contact-verb phrases (one per link in the chain),
 * while every other narrative checked in the existing 26+150+15-candidate
 * corpus with a single, already-correct "other-party-contributed"
 * classification contains at most 2 (a single other party can be described
 * as contacting the subject twice, e.g. an aggressive repeated-contact
 * pursuit, without that being a multi-actor chain reaction — confirmed
 * empirically against case afac5d277fdfeb9, which stays under this
 * threshold in its actual representative narrative). */
const CONTACT_EVENT_VERB_PATTERN = /\b(made|making)\s+contact\s+with\b|\bcollided\s+with\b|\bstruck\b|\brear-ended\b|\bto\s+contact\b/gi;
const MULTI_ACTOR_CHAIN_REACTION_THRESHOLD = 3;

function countContactEventPhrases(narrative) {
  const matches = narrative.match(CONTACT_EVENT_VERB_PATTERN);
  return matches ? matches.length : 0;
}

/** FAITHFULNESS FIX A2 (final faithfulness audit, findings 8c56b788577d262 /
 * e030f01d2992e85): explicit, unambiguous source language stating that no
 * contact/collision occurred at all — checked so classify.mjs can refuse to
 * default to event_type=collision when the source itself directly denies a
 * collision took place. Narrow and high-precision by design: each pattern
 * requires an explicit "no contact"/"no data or knowledge of any contact"
 * construction, not merely the absence of contact-mechanism evidence
 * elsewhere (silence is not evidence of "no contact"; only an explicit
 * source statement is). */
const NO_CONTACT_OCCURRED_PATTERNS = [
  /\b(made\s+)?no\s+contact\s+(or\s+collision\s+)?(between|with)\b/i,
  /\bno\s+data\s+or\s+knowledge\s+of\s+any\s+contact\b/i,
];

/** Bounded sentence-splitting helper shared by the A3/A4 faithfulness fixes
 * below. Deliberately narrow: splits on sentence-ending punctuation only, no
 * clause-level parsing, no cross-sentence coreference — used only to keep a
 * proximity check from reaching across unrelated sentences elsewhere in a
 * long, multi-paragraph narrative. Not a general chronology/discourse
 * parser. */
function splitIntoSentences(text) {
  return text.split(/(?<=[.!?])\s+/);
}

/** Narrative phrasing indicating the emergency vehicle's emergency function
 * was behaviorally active/relevant (not merely present as a vehicle type) —
 * required by the tightened emergency-vehicle-interaction policy. */
const ACTIVE_EMERGENCY_RESPONSE_PATTERNS = [
  /lights? and sirens?/i,
  /emergency lights/i,
  /responding to/i,
  /yielding (for|to) (the |an )?emergency/i,
  /emergency response/i,
  /in pursuit/i,
];

/** Narrative phrasing supporting a completed, controlled response to a
 * hazard (detected -> responded -> reached a stopped/controlled state)
 * BEFORE any subsequent third-party contact — required evidence for
 * successful-handling, per the approved policy that an attempted-but-
 * incomplete response does not qualify. */
const SUCCESSFUL_HANDLING_PATTERNS = [
  /braked.*(came to a stop|stopped)/i,
];
const CONTACT_WITH_STOPPED_VEHICLE_PATTERNS = [
  /contact with the stopped/i,
];

/** The two structurally distinct patterns explicitly resolved by policy:
 * (a) the subject vehicle braked/reacted to a hazard and was never itself
 *     struck, while two OTHER vehicles collided as a consequence;
 * (b) a single-vehicle, no-other-party contact with static infrastructure. */
// Deliberately two separate, independently-required signals rather than one
// rigid phrase: NHTSA narratives phrase "the AV was not damaged" many ways
// ("did not sustain damage", "...but the Waymo AV did not", etc.), so this
// requires "did not" AND "sustained damage" to both appear, rather than
// matching one exact contiguous phrase (a bug found and fixed during pilot
// validation — see docs/nhtsa-normalization-rulebook.md pilot notes).
const AV_NOT_DAMAGED_PATTERNS = [/\bdid not\b/i];
const DAMAGE_MENTIONED_PATTERNS = [/sustained damage/i];
const TWO_OTHER_VEHICLES_PATTERNS = [
  /passenger vehicle.*passenger vehicle/i,
  /striking vehicle/i,
];
// REVISED after out-of-sample review: "curb" alone matched purely incidental
// location mentions ("parked at the curb", "reversing near the curb") in
// four otherwise-ordinary two-party collisions, producing a false
// single-vehicle-infrastructure classification each time (with a fabricated
// automation-contributed causation claim on top). Word-boundary anchoring
// (already fixed once, for the "gate"-inside-"investigated" bug) was not
// sufficient — the real fix is not a better keyword list but an
// actor/relationship check: this infrastructure pattern must now be GATED
// on evidence.mjs's caller checking that crash_interaction_counterpart is
// NOT a concrete other-vehicle/person type (see the counterpart gate in
// extractNarrativePatternAtoms below) AND that no competing "other vehicle
// contacted the subject" phrasing exists in the same narrative. The noun
// list is modestly widened (manhole cover, raised pavement, utility access
// cover, planter, fence, pothole) based on a genuine single-vehicle case
// ("raised pavement"/"utility access cover") that the original list missed
// — this is a bounded, natural category (static roadway/parking
// infrastructure), not a per-case word added to chase one narrative's exact
// phrasing.
// FURTHER REVISED after the targeted adversarial stress test (cases
// 27528ff2c99e583, 374f676fee2c3db): plain "pavement" and "speed bump" —
// common NHTSA phrasings for an undercarriage-contact, no-other-party event
// ("the Waymo AVs undercarriage made contact with the pavement" / "...with a
// speed bump") — were absent from the noun list, so two textbook instances
// of this exact case-#15 pattern (both explicitly stating "the AV did not
// contact any vehicle or other road user") fell through to the generic
// default classification instead. "speed bump" is added to the noun list;
// bare "pavement" is deliberately NOT added there (too generic a word to
// gate on alone — it appears in many ordinary two-party narratives without
// implying a no-other-party event), so a second, narrower phrase requiring
// "contact with (the) pavement" is added instead, which is what both
// reproduced cases actually say. This is the same bounded, evidence-grounded
// widening the noun list has already received twice before — not a general
// keyword expansion.
const SINGLE_VEHICLE_INFRASTRUCTURE_PATTERNS = [
  /\b(spikes|curb|pole|gate|manhole cover|raised pavement|utility (access )?cover|planter|fence|pothole|speed bump)\b/i,
  /\bcontact with (the )?pavement\b/i,
];

/** Negative guard for the infrastructure pattern above: if the narrative
 * describes another vehicle TYPE as the actor making contact with the
 * subject, this is an ordinary two-party collision that happens to mention
 * infrastructure incidentally (e.g. "parked at the curb ... a pickup truck
 * ... made contact with ... the Waymo AV") — not a single-vehicle event. */
const OTHER_VEHICLE_CONTACTED_SUBJECT_PATTERNS = [
  /\b(pickup truck|passenger car|passenger vehicle|suv|van|bus|truck|car|motorcycle)\b[^.]{0,100}\b(made contact with|struck|collided with|reversed[^.]{0,20}into)\b[^.]{0,60}\b(stationary|parked|stopped)?\s*(\w+\s+)?(av|ads|vehicle)\b/i,
];

/** Second, independent negative-guard shape for the same infrastructure
 * pattern: a PERSON (not a vehicle) described as actively producing or
 * moving the object that ends up in contact with the subject vehicle (e.g.
 * "a pedestrian pushing a line of shopping carts ... made contact with the
 * shopping carts"). Found during out-of-sample review: the infrastructure
 * pattern's "curb" keyword matched a purely incidental location mention in a
 * pedestrian-caused event, since the vehicle-only guard above does not cover
 * non-vehicle actors. This is a general actor/relationship check — ANY
 * object a person is described actively moving is covered — not an
 * enumeration of specific objects (deliberately not special-cased to
 * "shopping cart"). */
const OTHER_PERSON_ACTOR_MOVING_OBJECT_PATTERNS = [
  /\b(pedestrian|person|individual|cyclist|bicyclist)\b[^.]{0,150}\b(pushing|carrying|moving|dragging|holding|walking\s+(with|alongside))\b/i,
];

/** Combined actor/relationship guard used by the single-vehicle-infrastructure
 * pattern: true when the narrative describes ANY external actor — vehicle or
 * person — as responsible for the object/contact, meaning this is not
 * actually a no-other-party event regardless of what infrastructure noun
 * happens to appear. */
function narrativeIndicatesOtherActorPresent(narrative) {
  return matchesAny(narrative, OTHER_VEHICLE_CONTACTED_SUBJECT_PATTERNS) ||
    matchesAny(narrative, OTHER_PERSON_ACTOR_MOVING_OBJECT_PATTERNS);
}

/** Other party disregarded a traffic control (red light/signal/stop sign) —
 * a generalizable, independently-reusable causation signal, not narrowly
 * tied to one narrative's exact wording. Includes "against a red light"
 * phrasing (a distinct but equally common NHTSA phrasing of the same
 * violation, found during out-of-sample review). */
const OTHER_PARTY_TRAFFIC_VIOLATION_PATTERNS = [
  /disregard(ed)? (a |the )?red (\w+\s+)?(light|signal)/i,
  /ran (a |the )?red (\w+\s+)?(light|signal)/i,
  /ignored (a |the )?red (\w+\s+)?(light|signal)/i,
  /entered? (the )?intersection against (a |the )?red (\w+\s+)?(light|signal)/i,
  /against (a |the )?red (\w+\s+)?(light|signal)/i,
];

/** The OTHER party explicitly crossing/changing/entering into the SUBJECT
 * vehicle's own lane/path — a reusable causation signal added after
 * out-of-sample review found several clear cases of this exact reported
 * mechanic going unrecognized. Anchored on "[subject]'s lane of travel" —
 * Waymo's own standard SGO reporting phrase used across many narratives, not
 * one case's specific wording — and requires the OTHER party (not the
 * subject) be the one crossing/entering, per the explicit "actor direction
 * must be clear" requirement. Deliberately does NOT fire on vaguer
 * lane-change language that doesn't name whose lane was entered. */
const OTHER_PARTY_LANE_INTRUSION_PATTERNS = [
  /cross(ed)?\s+(the\s+)?(double\s+yellow|center\s+line|dashed\s+(white\s+)?lane\s+line)[^.]{0,60}(enter(ed|ing)?|into)\s+(the\s+)?(\w+\s+)?(av|ads|vehicle)'?s?\s+lane/i,
  /enter(ed|ing)?\s+(the\s+)?(\w+\s+)?(av|ads|vehicle)'?s?\s+lane\s+of\s+travel/i,
];

/** The AUTOMATED system itself is described as initiating/attempting a
 * maneuver, with a human/teleoperator takeover mentioned LATER in the same
 * clause — the narrow, explicit evidence required (per the revised
 * automation-contribution policy) before causation may be attributed to
 * automation when it was not confirmed engaged at the moment of contact.
 * Deliberately does not fire on "operator disengaged and then drove/turned"
 * (human action first) — only on "the system/ADS [did something], then
 * [handoff]" (automation action first). */
const AUTOMATION_ACTION_BEFORE_HANDOFF_PATTERNS = [
  /\b(the\s+)?(ads|automat\w+(?:\s+driving)?\s+system|automation)\b[^.]{0,100}\b(initiat\w*|attempt\w*|began|begun|started|executing|performing)\b[^.]{0,150}\b(disengag\w*|took (manual )?control|took over|driver (took|assumed)|manual mode)\b/i,
];

/** A human (teleoperator/safety driver/operator) is described as taking
 * control BEFORE the specific maneuver/action that produced the reported
 * contact — distinct from the general "was automation engaged" question.
 * This lets automation_status correctly reflect the structured/overall
 * engagement report while causation_status is separately gated on who was
 * actually in control at the moment that mattered (see Normalization
 * Rulebook v1's ontology-limitation note on this exact scenario).
 *
 * KNOWN DETERMINISTIC LIMITATION (documented, not fixed, per independent
 * review): these patterns match "assumed control" / "took over" phrasing
 * ANYWHERE in the narrative, with no awareness of whether that control
 * transfer happened BEFORE the reported contact (as the field name claims)
 * or AFTER it — e.g. a safety driver "assuming control" to pull over and
 * begin an incident-response protocol once the vehicle has already come to
 * a safe stop following contact. Confirmed example in this corpus: case
 * c397f44794adc7e (Motional), whose narrative states the automated system
 * braked appropriately for red-light-running cyclists, came to a complete
 * stop, was then contacted by one cyclist, and only "following the contact"
 * did the safety driver assume control to relocate the vehicle — a
 * post-contact recovery action, not a pre-contact handoff. In that
 * particular case the mislabeling was inert (causation resolved via a
 * different rule before this atom was consulted), but the field name is
 * broader than what the regex can actually establish.
 *
 * FAITHFULNESS FIX A3 (final faithfulness audit, confirmed cases
 * c397f44794adc7e, 276c44175c4e6fa, b42deb39142d807, 4ce5e32b26da9ff — all
 * four independently confirmed via full-corpus scan to share the identical
 * "Following the contact/impact, the safety driver assumed control" shape):
 * a narrow, SENTENCE-BOUNDED check below (see
 * `controlAssumptionMarkedPostContact`) now catches the specific, explicit
 * case where the narrative's OWN "following/after the contact/impact"
 * phrasing appears before the control-assumption phrase in the same
 * sentence — that is not a general chronology engine (it establishes
 * nothing about timing beyond what the source itself explicitly states in
 * that one, narrow construction), so this comment's underlying point still
 * stands for every other phrasing of temporal sequence. When this narrow
 * marker is found, `human_took_control_before_contact_narrative` is NOT
 * emitted — instead a neutral `human_took_control_timing_unknown_narrative`
 * atom preserves the fact that a human/teleoperator took control at some
 * point, without asserting a before-contact relationship the source does
 * not (or does not clearly) support. */
const HUMAN_TOOK_CONTROL_BEFORE_CONTACT_PATTERNS = [
  /teleoperator (took over|took control|assumed control)/i,
  /(safety (driver|monitor)|driver|operator) (took over|took (manual )?control|assumed control)/i,
];

/** Explicit "following/after the contact/impact/collision" marker — see Fix
 * A3 above. Narrow and literal: only this specific construction suppresses
 * the before-contact assertion; it does not attempt to infer timing from any
 * other phrasing. */
const POST_CONTACT_CONTROL_TIMING_MARKER_PATTERN = /\b(following|after)\s+(the\s+)?(contact|impact|collision)\b/i;

/** True when, within the SAME sentence as the matched control-assumption
 * text, an explicit post-contact marker appears BEFORE it — meaning the
 * narrative's own words place the handoff after contact, not before. */
function controlAssumptionMarkedPostContact(narrative, controlMatchText) {
  const sentence = splitIntoSentences(narrative).find((s) => s.includes(controlMatchText));
  if (!sentence) return false;
  const markerMatch = sentence.match(POST_CONTACT_CONTROL_TIMING_MARKER_PATTERN);
  if (!markerMatch) return false;
  const controlIndex = sentence.indexOf(controlMatchText);
  return controlIndex === -1 || markerMatch.index < controlIndex;
}

/** An occupant/passenger action (not the other party's driving behavior, not
 * the automated system) is described as material to the contact — e.g.
 * opening a door into a passing vehicle's path. When present, a purely
 * movement-based rule ("subject stopped/parked + other party moving") must
 * not blindly attribute the contact to the other party.
 *
 * Both patterns allow a short gap ([^.]{0,N}, never crossing a sentence
 * boundary) rather than requiring an exact contiguous phrase — found during
 * out-of-sample review to miss natural variants like "... in the Waymo AV
 * THEN opened the rear DRIVER SIDE door" (an adverb before "opened", and a
 * side/position descriptor between "rear"/"front" and "door") that an exact
 * "opened the" / "(left|right) door" match does not cover. This widens the
 * gap tolerance only — it does not add new actor or action vocabulary. */
const SUBJECT_OCCUPANT_ACTION_PATTERNS = [
  /passenger[s]?\s+(in|of)\s+the\s+(\w+\s+)?(av|ads|vehicle)\b[^.]{0,20}\bopened\s+the\b/i,
  // WIDENED (stress test cases 9b6219cb373795e, 9fc806cd1d491d5): tolerate
  // one optional side/position descriptor between "the" and "rear"/"front"
  // ("opened the RIGHT rear passenger side door") — the previous version
  // required "the" to be immediately followed by "rear"/"front", which a
  // single inserted word ("right") broke even though a near-identical
  // phrasing without that word ("opened the rear passenger side door", case
  // da37ed084b7182d) already matched. Same single-word gap tolerance already
  // used by this pattern's sibling above, not new actor/action vocabulary.
  /\bopened\s+the\s+(\w+\s+)?(rear|front)\b[^.]{0,30}\bdoor\b/i,
];

/** FAITHFULNESS FIX A4 (final faithfulness audit, confirmed case
 * 6e5234c59081cf5): neither pattern above checks WHOSE vehicle the
 * door/occupant belongs to — "opened the rear left door" matches identically
 * whether it is the subject vehicle's own door or another vehicle's. Case
 * 6e5234c59081cf5's narrative explicitly names a distinct "Parked Waymo AV"
 * and attributes both the passenger and the door to it, not to the subject
 * ("the Waymo AV"). This guard checks the SAME SENTENCE as the matched
 * occupant-action text for an explicit "parked/other/second/another
 * AV/vehicle" qualifier — narrow and literal, not a general
 * actor-relationship parser — and suppresses the atom when found, per the
 * required behavior: only assert subject-vehicle occupant action when
 * source evidence sufficiently supports subject-vehicle ownership. */
const OTHER_VEHICLE_OCCUPANT_QUALIFIER_PATTERN = /\b(parked|other|second|another)\s+(\w+\s+)?(av|ads|vehicle)\b/i;

function occupantActionAttributedToOtherVehicle(narrative, matchText) {
  const sentence = splitIntoSentences(narrative).find((s) => s.includes(matchText));
  return OTHER_VEHICLE_OCCUPANT_QUALIFIER_PATTERN.test(sentence ?? narrative);
}

function atom({ tier, field, value, sourceType, sourcePointer, text, rule }) {
  return { tier, field, value, sourceType, sourcePointer, text, rule };
}

function sourcePointerFor(report) {
  return { reportingGeneration: report.reporting_generation, reportId: report.report_id };
}

/** First match, in pattern-list order — the ORIGINAL, unchanged lookup used
 * whenever only one direction (engaged-only or not-engaged-only) is present
 * in a narrative, so the quoted evidence text for the common case is
 * byte-for-byte identical to the pre-existing behavior. Returns null if no
 * pattern in the list matches. */
function firstMatch(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

/** LATEST match position, across every pattern in `patterns`, within `text`
 * — used ONLY to decide WHICH DIRECTION (engaged vs. not-engaged) is the
 * more recently stated fact when a narrative contains cues from BOTH lists.
 * Never used to choose which text to quote (see firstMatch above) — only to
 * compare the two directions' positions against each other. Returns -1 if
 * no pattern in the list matches. */
function latestMatchIndex(text, patterns) {
  let index = -1;
  for (const re of patterns) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m;
    while ((m = global.exec(text)) !== null) {
      if (m.index > index) index = m.index;
      if (m.index === global.lastIndex) global.lastIndex++; // guard against zero-length matches
    }
  }
  return index;
}

/** Extractive scan of one report's narrative for engagement language.
 *
 * "not-engaged" is a positive factual claim in its own right, not merely a
 * "more conservative" fallback from "engaged" — a narrative that mentions
 * BOTH an engagement and a disengagement cue must not be resolved by a
 * fixed precedence between the two pattern lists (REVISED after independent
 * review: an earlier version of this fix checked NOT_ENGAGED_PATTERNS before
 * ENGAGED_PATTERNS unconditionally, which would incorrectly report
 * "not-engaged" even for a narrative describing disengaged -> re-engaged ->
 * collision while autonomous, since a disengagement phrase appearing
 * anywhere would always win regardless of what happened afterward).
 *
 * Instead: when a narrative contains cues from only one list, that list's
 * FIRST match (in list order — exactly the original, pre-existing behavior)
 * is used directly, so the common single-direction case is byte-for-byte
 * unchanged. Only when a narrative contains cues from BOTH lists is a
 * choice between directions needed — resolved narrowly by which DIRECTION's
 * latest match is stated LAST in the narrative's own text (see
 * latestMatchIndex above), never by which pattern LIST is checked first.
 * NHTSA narratives are chronological prose, so the more-recently-stated
 * direction corresponds to the state nearest the reported contact — this is
 * a per-narrative, evidence-grounded comparison of actual match positions,
 * not a global rule, and it is used ONLY to pick the winning direction, not
 * to pick which specific phrase gets quoted (that is always each
 * direction's own first-in-list-order match, per firstMatch). If the two
 * directions' latest positions somehow fall at the exact same index (not
 * observed in this corpus; guarded defensively), no chronology can be
 * established deterministically, and this function returns no conclusion
 * (null) rather than inventing one.
 *
 * This never changes what causation_status/automation contribution mean —
 * automation engagement at the moment of contact and automation
 * CONTRIBUTION to the event remain separate concepts, handled by entirely
 * separate atoms and rules (human_took_control_before_contact_narrative /
 * automation_action_before_handoff_narrative, consumed only by
 * classifyCausation) that this function does not touch. */
function extractNarrativeEngagement(report) {
  const text = report.narrative ?? "";
  const engagedText = firstMatch(text, ENGAGED_PATTERNS);
  const notEngagedText = firstMatch(text, NOT_ENGAGED_PATTERNS);
  const hasEngaged = engagedText !== null;
  const hasNotEngaged = notEngagedText !== null;

  if (hasEngaged && !hasNotEngaged) {
    return atom({
      tier: "EVIDENCE",
      field: "automation_engagement_narrative",
      value: "engaged",
      sourceType: "narrative",
      sourcePointer: sourcePointerFor(report),
      text: engagedText,
    });
  }
  if (hasNotEngaged && !hasEngaged) {
    return atom({
      tier: "EVIDENCE",
      field: "automation_engagement_narrative",
      value: "not-engaged",
      sourceType: "narrative",
      sourcePointer: sourcePointerFor(report),
      text: notEngagedText,
    });
  }
  if (hasEngaged && hasNotEngaged) {
    const engagedIndex = latestMatchIndex(text, ENGAGED_PATTERNS);
    const notEngagedIndex = latestMatchIndex(text, NOT_ENGAGED_PATTERNS);
    if (notEngagedIndex > engagedIndex) {
      return atom({
        tier: "EVIDENCE",
        field: "automation_engagement_narrative",
        value: "not-engaged",
        sourceType: "narrative",
        sourcePointer: sourcePointerFor(report),
        text: notEngagedText,
      });
    }
    if (engagedIndex > notEngagedIndex) {
      return atom({
        tier: "EVIDENCE",
        field: "automation_engagement_narrative",
        value: "engaged",
        sourceType: "narrative",
        sourcePointer: sourcePointerFor(report),
        text: engagedText,
      });
    }
    return null; // cannot establish chronology deterministically — no conclusion, not a guess.
  }
  return null;
}

/** Expand a raw [start, end) slice outward to the nearest whitespace on each
 * side, so a fixed-offset context window never cuts a word in half — the
 * cause of a garbled, mid-word-truncated justification string found during
 * out-of-sample review. */
function trimToWordBoundary(text, start, end) {
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  while (end < text.length && !/\s/.test(text[end])) end++;
  return text.slice(start, end).trim();
}

/** Extractive scan of narrative for hedge language, preserved verbatim and
 * tagged with WHICH topic it hedges (see HEDGE_PATTERN_GROUPS above) so
 * downstream classification never applies an injury- or boilerplate-scoped
 * hedge to an unrelated question like causation mechanics. */
function extractHedges(report) {
  const text = report.narrative ?? "";
  const hedges = [];
  for (const [topic, patterns] of Object.entries(HEDGE_PATTERN_GROUPS)) {
    for (const re of patterns) {
      const m = text.match(re);
      if (!m) continue;
      const idx = m.index ?? 0;
      const start = Math.max(0, idx - 60);
      const end = Math.min(text.length, idx + m[0].length + 60);
      hedges.push(
        atom({
          tier: "EVIDENCE",
          field: "narrative_hedge",
          value: { topic, phrase: m[0] },
          sourceType: "narrative",
          sourcePointer: sourcePointerFor(report),
          text: trimToWordBoundary(text, start, end),
        }),
      );
      break; // one match per topic group is enough evidence that it applies
    }
  }
  return hedges;
}

function matchesAny(text, patterns) {
  return patterns.some((re) => re.test(text));
}

/** Concrete other-vehicle/person counterpart values — when the consolidated
 * candidate's crash_interaction_counterpart is one of these (or effectively
 * any value other than a null/"Other"-style placeholder), the record already
 * identifies a specific other party, so the single-vehicle-infrastructure
 * pattern must not fire regardless of what incidental words appear in the
 * narrative. This is the actor/relationship check requested after
 * out-of-sample review — using the mechanically-consolidated structured
 * field rather than a longer narrative keyword list. */
function counterpartIndicatesNoOtherParty(counterpart) {
  return counterpart === null || counterpart === undefined ||
    counterpart === "Other, see Narrative" || counterpart === "Other Fixed Object";
}

/** Scan the candidate's representative narrative for the structural/
 * mechanism patterns above. Returns zero or more EVIDENCE atoms, each
 * pointing at the narrative text that triggered it. `counterpart` is the
 * consolidated candidate's crash_interaction_counterpart, used to gate the
 * single-vehicle-infrastructure pattern (see counterpartIndicatesNoOtherParty
 * above). */
function extractNarrativePatternAtoms(narrative, sourcePointer, counterpart) {
  if (!narrative) return [];
  const atoms = [];
  const push = (field, value, re) => {
    const m = narrative.match(re);
    atoms.push(
      atom({
        tier: "EVIDENCE",
        field,
        value,
        sourceType: "narrative",
        sourcePointer,
        text: m ? m[0] : narrative.slice(0, 80),
      }),
    );
  };

  // FAITHFULNESS FIX A1: emit a DERIVED signal (not itself a causation claim)
  // when the narrative contains 3+ distinct contact-verb phrases — see
  // countContactEventPhrases / CONTACT_EVENT_VERB_PATTERN above. classify.mjs
  // uses this to withhold a confident single-actor causation attribution,
  // never to reconstruct which actor did what.
  const contactEventCount = countContactEventPhrases(narrative);
  if (contactEventCount >= MULTI_ACTOR_CHAIN_REACTION_THRESHOLD) {
    atoms.push(
      atom({
        tier: "DERIVED",
        field: "multi_actor_chain_reaction_narrative",
        value: true,
        sourceType: "rule",
        sourcePointer,
        text: `Narrative contains ${contactEventCount} distinct contact-event phrases (made/making contact with, collided with, struck, rear-ended, or "to contact"). This may reflect a genuine multi-actor/chain-reaction sequence, or repeated restatement of the same contact across report-update sections — this signal is a count only and does not distinguish the two.`,
        rule: "multi-actor-chain-reaction-detector",
      }),
    );
  }

  // FAITHFULNESS FIX A2: explicit source denial of any contact/collision —
  // see NO_CONTACT_OCCURRED_PATTERNS above. classify.mjs uses this to refuse
  // an event_type=collision default; it does not itself choose a replacement
  // category.
  for (const re of NO_CONTACT_OCCURRED_PATTERNS) {
    if (re.test(narrative)) {
      push("no_contact_occurred_narrative", true, re);
      break;
    }
  }

  for (const re of REAR_END_PATTERNS) {
    if (re.test(narrative)) {
      push("contact_mechanism_narrative", "other-party-rear-ended-subject", re);
      break;
    }
  }
  for (const re of ACTIVE_EMERGENCY_RESPONSE_PATTERNS) {
    if (re.test(narrative)) {
      push("active_emergency_response_narrative", true, re);
      break;
    }
  }
  if (
    matchesAny(narrative, SUCCESSFUL_HANDLING_PATTERNS) &&
    matchesAny(narrative, CONTACT_WITH_STOPPED_VEHICLE_PATTERNS)
  ) {
    push("successful_handling_pattern_narrative", true, SUCCESSFUL_HANDLING_PATTERNS[0]);
  }
  if (
    matchesAny(narrative, AV_NOT_DAMAGED_PATTERNS) &&
    matchesAny(narrative, DAMAGE_MENTIONED_PATTERNS) &&
    matchesAny(narrative, TWO_OTHER_VEHICLES_PATTERNS)
  ) {
    push("av_not_struck_third_party_collision_narrative", true, DAMAGE_MENTIONED_PATTERNS[0]);
  }
  const matchedInfrastructurePattern = SINGLE_VEHICLE_INFRASTRUCTURE_PATTERNS.find((re) => re.test(narrative));
  if (
    matchedInfrastructurePattern &&
    counterpartIndicatesNoOtherParty(counterpart) &&
    !narrativeIndicatesOtherActorPresent(narrative)
  ) {
    // Use whichever pattern in the list actually matched (not always the
    // first) so the atom's provenance text reflects the real matched
    // evidence — previously always re-tested pattern [0], which could
    // silently fall back to a generic slice when a LATER list entry was the
    // actual match (now two entries wide instead of one).
    push("single_vehicle_infrastructure_contact_narrative", true, matchedInfrastructurePattern);
  }
  for (const re of OTHER_PARTY_TRAFFIC_VIOLATION_PATTERNS) {
    if (re.test(narrative)) {
      push("other_party_traffic_violation_narrative", true, re);
      break;
    }
  }
  for (const re of OTHER_PARTY_LANE_INTRUSION_PATTERNS) {
    if (re.test(narrative)) {
      push("other_party_lane_intrusion_narrative", true, re);
      break;
    }
  }
  for (const re of AUTOMATION_ACTION_BEFORE_HANDOFF_PATTERNS) {
    if (re.test(narrative)) {
      push("automation_action_before_handoff_narrative", true, re);
      break;
    }
  }
  for (const re of HUMAN_TOOK_CONTROL_BEFORE_CONTACT_PATTERNS) {
    const m = narrative.match(re);
    if (m) {
      // FAITHFULNESS FIX A3: never assert "before contact" when the
      // narrative's own words place the handoff after contact — see
      // controlAssumptionMarkedPostContact above. The underlying fact (a
      // human/teleoperator took control at some point) is still preserved,
      // under a neutral field name that makes no before/after claim.
      if (controlAssumptionMarkedPostContact(narrative, m[0])) {
        push("human_took_control_timing_unknown_narrative", true, re);
      } else {
        push("human_took_control_before_contact_narrative", true, re);
      }
      break;
    }
  }
  for (const re of SUBJECT_OCCUPANT_ACTION_PATTERNS) {
    const m = narrative.match(re);
    if (m) {
      // FAITHFULNESS FIX A4: only assert a subject-vehicle-occupant action
      // when the source does not explicitly attribute the door/occupant to
      // another vehicle — see occupantActionAttributedToOtherVehicle above.
      // When ownership is attributed elsewhere, emit nothing here rather
      // than a wrong-actor assertion; causation_status's existing generic
      // fallback already stays conservative in that case.
      if (!occupantActionAttributedToOtherVehicle(narrative, m[0])) {
        push("subject_occupant_action_narrative", true, re);
      }
      break;
    }
  }

  return atoms;
}

/** One EVIDENCE atom per structured field, per contributing report. */
function extractStructuredFieldAtoms(report) {
  const pointer = sourcePointerFor(report);
  const fields = [
    "reporting_entity",
    "developer_or_operator",
    "crash_interaction_counterpart_text",
    "subject_vehicle_precrash_movement_text",
    "other_actor_precrash_movement_text",
    "injury_outcome_text",
    "automation_engagement_text",
    "city",
    "state",
    "incident_date",
    "incident_date_precision",
  ];
  const atoms = [];
  for (const field of fields) {
    const value = report[field];
    if (value === null || value === undefined) continue;
    atoms.push(
      atom({ tier: "EVIDENCE", field, value, sourceType: "structured", sourcePointer: pointer, text: String(value) }),
    );
  }
  return atoms;
}

/** Detect a substantive disagreement: the candidate's consolidated field is
 * null/absent while >=2 contributing reports carry distinct non-null values
 * for the corresponding field. Mirrors the mechanical importer's own
 * disagreement rule exactly (see migration/nhtsa/mapping.mjs
 * consolidateField) rather than re-deriving a different notion of conflict. */
function detectDisagreements(candidate, reports) {
  const checks = [
    { candidateField: "developer_or_operator", reportField: "developer_or_operator" },
    { candidateField: "city", reportField: "city" },
    { candidateField: "crash_interaction_counterpart", reportField: "crash_interaction_counterpart_text" },
    { candidateField: "subject_vehicle_precrash_movement", reportField: "subject_vehicle_precrash_movement_text" },
    { candidateField: "other_actor_precrash_movement", reportField: "other_actor_precrash_movement_text" },
    { candidateField: "injury_outcome_text", reportField: "injury_outcome_text" },
  ];
  const disagreements = [];
  for (const { candidateField, reportField } of checks) {
    if (candidate[candidateField] !== null && candidate[candidateField] !== undefined) continue;
    const values = new Set(
      reports.map((r) => r[reportField]).filter((v) => v !== null && v !== undefined),
    );
    if (values.size > 1) {
      disagreements.push({ field: candidateField, values: [...values] });
    }
  }
  return disagreements;
}

/** The three structured fields that jointly describe "what physically
 * happened" in a crash. Used only by detectSourceRecordInconsistency below
 * to recognize a materially stronger signal than one disagreeing field. */
const EVENT_SHAPE_FIELDS = [
  "crash_interaction_counterpart",
  "subject_vehicle_precrash_movement",
  "other_actor_precrash_movement",
];

/**
 * Conservative, deterministic "source-record inconsistency" signal — added
 * after the targeted adversarial stress test found two cases
 * (77ba86fa433a2c4, aeb0ef282584e35) where contributing reports grouped
 * under one NHTSA Same Incident ID disagreed not on a single field (routine,
 * and already fully handled by detectDisagreements/`unknowns` above) but on
 * TWO OR MORE of the three fields that jointly describe the event's
 * physical shape — counterpart, subject movement, and other-party movement —
 * simultaneously. One disagreeing field is ordinary. Two or more at once is
 * a qualitatively different, stronger signal, worth surfacing explicitly
 * rather than folding unremarked into the ordinary per-field disagreement
 * list — WITHOUT characterizing what the inconsistency means. Per
 * independent review: this detector must not surface as, or be read as, a
 * claim that the contributing reports describe more than one physical
 * event. It is neutral about that question — it says only that the
 * descriptions are materially inconsistent, not why, and not what that
 * implies about how many real-world events occurred.
 *
 * This function does NOT decide that NHTSA's Same Incident ID grouping is
 * wrong, does NOT split the candidate into multiple events, does NOT decide
 * whether the grouping represents one physical event or several, and does
 * NOT choose which contributing report is correct — NHTSA's Same Incident
 * ID remains the operational grouping unit. It only flags, conservatively,
 * that this particular combination of disagreements is strong enough to
 * warrant explicit surfacing rather than being folded unremarked into the
 * ordinary per-field disagreement list.
 *
 * KNOWN, DELIBERATE LIMITATION: this is a structured-field-only signal. It
 * cannot detect the OTHER pattern found in the same stress test
 * (aeb0ef282584e35's Pony.ai/Hyundai case), where contributing reports'
 * NARRATIVES describe materially different mechanisms while every
 * structured field this importer checks happens to agree. Reliably
 * detecting that would require semantically comparing narrative content
 * across reports, which this pass deliberately does not attempt (see
 * stress-test-report.md finding 1, and this hardening pass's review
 * package). That gap is left explicit here rather than papered over with a
 * brittle universal heuristic.
 */
function detectSourceRecordInconsistency(disagreements) {
  const disagreeingEventShapeFields = disagreements
    .map((d) => d.field)
    .filter((field) => EVENT_SHAPE_FIELDS.includes(field));
  if (disagreeingEventShapeFields.length < 2) {
    return { flagged: false, fields: [] };
  }
  return { flagged: true, fields: disagreeingEventShapeFields };
}

/**
 * Build the full evidence-atom list for one candidate + its reports.
 * Returns { atoms, disagreements, sourceRecordInconsistency }.
 */
export function extractEvidence(candidate, reports) {
  const atoms = [];

  // Candidate-level consolidated EVIDENCE (already mechanically agreed, or
  // the single value for a singleton/1-report group).
  const candidateFields = [
    "developer_or_operator",
    "city",
    "state",
    "crash_interaction_counterpart",
    "subject_vehicle_precrash_movement",
    "other_actor_precrash_movement",
    "injury_outcome_text",
    "automation_engagement_text",
    "incident_date",
    "incident_date_precision",
  ];
  for (const field of candidateFields) {
    const value = candidate[field];
    if (value === null || value === undefined) continue;
    atoms.push(
      atom({
        tier: "EVIDENCE",
        field: `candidate.${field}`,
        value,
        sourceType: reports.length > 1 ? "consolidated" : "structured",
        sourcePointer: reports.length > 1 ? "consolidated" : sourcePointerFor(reports[0]),
        text: String(value),
      }),
    );
  }
  if (candidate.narrative) {
    atoms.push(
      atom({
        tier: "EVIDENCE",
        field: "candidate.narrative",
        value: candidate.narrative,
        sourceType: "narrative",
        sourcePointer: reports.length > 1 ? "consolidated" : sourcePointerFor(reports[0]),
        text: candidate.narrative,
      }),
    );
  }

  atoms.push(
    ...extractNarrativePatternAtoms(
      candidate.narrative,
      reports.length > 1 ? "consolidated" : sourcePointerFor(reports[0]),
      candidate.crash_interaction_counterpart,
    ),
  );

  // Per-report structured atoms (kept even when they duplicate the
  // consolidated value, so disagreements remain individually traceable).
  for (const report of reports) {
    atoms.push(...extractStructuredFieldAtoms(report));
    const engagement = extractNarrativeEngagement(report);
    if (engagement) atoms.push(engagement);
    atoms.push(...extractHedges(report));
  }

  const disagreements = detectDisagreements(candidate, reports);

  // DERIVED: source-record inconsistency (see detectSourceRecordInconsistency
  // above). Purely additive: never removes or overrides any per-field
  // disagreement atom/entry, only adds an explicit, separate signal when the
  // combination of disagreements is materially stronger than any one of them
  // alone.
  const sourceRecordInconsistency = detectSourceRecordInconsistency(disagreements);
  if (sourceRecordInconsistency.flagged) {
    atoms.push(
      atom({
        tier: "DERIVED",
        field: "source_record_inconsistency",
        value: sourceRecordInconsistency.fields,
        sourceType: "rule",
        sourcePointer: "consolidated",
        text: `Contributing reports grouped under this NHTSA Same Incident ID contain materially inconsistent descriptions across ${sourceRecordInconsistency.fields.length} event-shape fields (${sourceRecordInconsistency.fields.join(", ")}). WBA preserves this source-record inconsistency without determining which description is correct or whether the source grouping represents one or multiple physical events.`,
        rule: "source-record-inconsistency-multi-field",
      }),
    );
  }

  // DERIVED: developer/operator alias resolution (small, deliberately
  // conservative table — see alias-table.mjs). Only relevant when the
  // candidate field is null because contributing reports disagreed.
  const developerDisagreement = disagreements.find((d) => d.field === "developer_or_operator");
  const aliasResult = resolveDeveloperAlias(
    candidate.developer_or_operator,
    developerDisagreement?.values ?? [],
  );
  if (aliasResult.resolved) {
    atoms.push(
      atom({
        tier: "DERIVED",
        field: "developer_or_operator_canonical",
        value: aliasResult.canonical,
        sourceType: "rule",
        sourcePointer: "consolidated",
        text: `"${candidate.developer_or_operator}" -> "${aliasResult.canonical}" (${aliasResult.reason})`,
        rule: "developer-alias-table",
      }),
    );
  }

  // DERIVED: cosmetic/typo resolution for `city` (general policy, not the
  // conservative developer-specific alias table — see cosmetic-resolution.mjs).
  const cityDisagreement = disagreements.find((d) => d.field === "city");
  const cityResolution = resolveCosmeticOrApprovedVariant(cityDisagreement?.values ?? []);
  let resolvedCity = candidate.city;
  if (cityResolution.resolved) {
    resolvedCity = cityResolution.canonical;
    atoms.push(
      atom({
        tier: "DERIVED",
        field: "city_canonical",
        value: cityResolution.canonical,
        sourceType: "rule",
        sourcePointer: "consolidated",
        text: `${cityDisagreement.values.join(" / ")} -> "${cityResolution.canonical}" (${cityResolution.reason})`,
        rule: "cosmetic-or-approved-mapping-resolution",
      }),
    );
  }

  // DERIVED: location precision from which geography fields are populated
  // (using the cosmetically-resolved city where applicable). Never
  // exact-point/road-or-intersection/local-area from NHTSA-only, redacted-
  // street data (validation rule 3 also enforces this as a backstop).
  let locationPrecision = "unknown";
  if (resolvedCity) locationPrecision = "city";
  else if (candidate.state) locationPrecision = "region";
  else if (candidate.country_code) locationPrecision = "country";
  atoms.push(
    atom({
      tier: "DERIVED",
      field: "location_precision",
      value: locationPrecision,
      sourceType: "rule",
      sourcePointer: "consolidated",
      text: `derived from presence of city=${resolvedCity ?? "null"}, state=${candidate.state ?? "null"}, country_code=${candidate.country_code ?? "null"}`,
      rule: "location-precision-ladder",
    }),
  );

  return { atoms, disagreements, sourceRecordInconsistency };
}

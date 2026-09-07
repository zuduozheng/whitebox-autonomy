/**
 * Ontology classification — Stage 2 of the NHTSA -> WBA normalization
 * pipeline.
 *
 * IMPORTANT ARCHITECTURAL BOUNDARY: this module receives ONLY the
 * evidence-atom array (and the disagreement list) produced by evidence.mjs.
 * It never receives the raw candidate or report objects, and must never read
 * narrative text directly — any fact this stage needs from narrative prose
 * must already exist as an EVIDENCE atom. This is enforced by the function
 * signature, not just by convention.
 *
 * PILOT IMPLEMENTATION NOTE: docs/discovery-pipeline.md's approved long-term
 * design calls for "one structured LLM call per item" at this stage. This
 * codebase has no AI/LLM integration anywhere (no API key, no client
 * library) — wiring one up is a separate, explicit, future decision (per
 * CLAUDE.md, external services are explained before they're wired up). For
 * THIS pilot, classification is implemented as an explicit, auditable rule
 * engine that encodes the approved Normalization Rulebook v1 decisions. Two
 * of the rules below (the AV-not-struck-third-party-collision pattern and
 * the single-vehicle-infrastructure pattern) are narrow, narrative-pattern
 * heuristics tuned to the two known calibration cases that need them (#14,
 * #15) — flagged explicitly in the pilot report as a known limitation that a
 * real model call would need to generalize, not a hidden shortcut.
 *
 * Every CLASSIFICATION-tier field carries { value, tier, justification,
 * confidence: 'well-supported' | 'contested' }. Every field with no
 * supporting evidence is tier UNSUPPORTED and left unpopulated (null),
 * per Normalization Rulebook v1 / hard validation rules.
 */

function findAtoms(atoms, field) {
  return atoms.filter((a) => a.field === field);
}
function findAtom(atoms, field) {
  return atoms.find((a) => a.field === field);
}
function hasAtom(atoms, field, value) {
  return atoms.some((a) => a.field === field && (value === undefined || a.value === value));
}

function classification(value, justification, confidence) {
  return { value, tier: "CLASSIFICATION", justification, confidence };
}
function unsupported(justification) {
  return { value: null, tier: "UNSUPPORTED", justification, confidence: null };
}

// ---------------------------------------------------------------------------
// automation_status
// ---------------------------------------------------------------------------

const ENGAGEMENT_TEXT_MAP = {
  "Verified Engaged": "driving-automation-engaged-confirmed",
  "Verified Not Engaged": "driving-automation-not-engaged",
  "Alleged Engaged": "driving-automation-engaged-reported",
  "Unknown - see Narrative": "driving-automation-status-uncertain",
};

function classifyAutomationStatus(atoms) {
  // Prefer the structured field (current-generation reports carry it
  // authoritatively) over narrative inference — validation rule 11.
  const structured = findAtom(atoms, "candidate.automation_engagement_text")
    ?? findAtoms(atoms, "automation_engagement_text")[0];
  if (structured && ENGAGEMENT_TEXT_MAP[structured.value]) {
    return classification(
      ENGAGEMENT_TEXT_MAP[structured.value],
      `Structured Engagement Status field states "${structured.value}".`,
      "well-supported",
    );
  }

  // Historical-generation fallback: the structured field is null by design
  // for that generation, so engagement must be read from narrative — the
  // narrative scan already happened in evidence extraction (validation
  // rule 10); this stage only consumes its result.
  const narrativeAtoms = findAtoms(atoms, "automation_engagement_narrative");
  const distinctValues = new Set(narrativeAtoms.map((a) => a.value));
  if (distinctValues.size === 1) {
    const [value] = distinctValues;
    const mapped = value === "engaged"
      ? "driving-automation-engaged-confirmed"
      : "driving-automation-not-engaged";
    return classification(
      mapped,
      `Narrative states: "${narrativeAtoms[0].text}" (historical-generation report; structured field unavailable by design).`,
      "well-supported",
    );
  }
  if (distinctValues.size > 1) {
    return classification(
      "driving-automation-status-uncertain",
      "Contributing reports' narratives disagree on engagement state.",
      "contested",
    );
  }

  return classification(
    "unknown",
    "No structured Engagement Status and no narrative statement of engagement found in any contributing report.",
    "well-supported",
  );
}

// ---------------------------------------------------------------------------
// causation_status
// ---------------------------------------------------------------------------

/** If a disagreement exists on a field the causation classification relied
 * on, the result can never be more than 'contested' — the underlying
 * movement/counterpart evidence itself is disputed, so confidence in a
 * derived causation category cannot be well-supported regardless of which
 * rule fired. */
function downgradeIfRelevantFieldDisputed(result, disagreements) {
  const relevantFields = [
    "subject_vehicle_precrash_movement",
    "other_actor_precrash_movement",
    "crash_interaction_counterpart",
  ];
  const disputed = disagreements.some((d) => relevantFields.includes(d.field));
  if (disputed && result.confidence === "well-supported") {
    return {
      ...result,
      confidence: "contested",
      justification: `${result.justification} (downgraded: a field this classification relies on is itself disputed among contributing reports.)`,
    };
  }
  return result;
}

/**
 * Whether the evidence supports attributing causal CONTRIBUTION to the
 * automated system — a distinct question from whether automation was
 * ENGAGED AT THE MOMENT OF CONTACT (see docs/nhtsa-normalization-rulebook.md,
 * "Automation engagement vs. automation contribution"). Automation may
 * contribute to an event even after it was disengaged (e.g. it initiates an
 * inappropriate maneuver, a safety driver takes over, and a collision
 * follows as a consequence) — so contribution must never be inferred merely
 * from automation having been engaged at some point, NOR merely from the
 * subject vehicle's bare involvement. It requires either:
 *   (a) automation confirmed/reported engaged AND no evidence that a human
 *       took control before the specific event-producing maneuver, or
 *   (b) explicit narrative evidence of a PRIOR automated maneuver linked to
 *       a subsequent handoff/event (automation_action_before_handoff_narrative).
 */
function automationContributionSupported(atoms, automationStatus) {
  const engagedAtSomePoint = automationStatus.value === "driving-automation-engaged-confirmed" ||
    automationStatus.value === "driving-automation-engaged-reported";
  const priorManeuverEvidence = hasAtom(atoms, "automation_action_before_handoff_narrative", true);
  const humanTookControlFirst = hasAtom(atoms, "human_took_control_before_contact_narrative", true);

  if (engagedAtSomePoint && !humanTookControlFirst) {
    // Ordinary case: automation reported engaged, nothing suggests a human
    // took over before the specific contact-producing maneuver.
    return true;
  }
  // Either automation was not confirmed engaged, or the narrative reveals a
  // human/teleoperator took control before the event-producing maneuver even
  // though the structured field reports engagement overall (see the
  // rulebook's ontology-limitation note) — either way, contribution now
  // requires explicit prior-maneuver evidence, not an inference from bare
  // involvement.
  return priorManeuverEvidence;
}

/**
 * FAITHFULNESS FIX (Rule-22 investigation, confirmed cases d62b1a61bfcc776,
 * 736fb36f9e489e1, e5e7fbb48fed3ea, d6ba83005d45c1c, d255c89929a41d5 —
 * explicitly approved exception to the frozen normalization checkpoint):
 * `REAR_END_PATTERNS`/`OTHER_PARTY_TRAFFIC_VIOLATION_PATTERNS`/
 * `OTHER_PARTY_LANE_INTRUSION_PATTERNS` have no actor-type check — a phrase
 * like "the open door made contact with the rear... of the AV" matches the
 * same shape as "the pickup truck made contact with the rear of the AV",
 * so `other-party-contributed` can be asserted "well-supported" in the same
 * draft that ALSO carries `subject_occupant_action_narrative` evidence of a
 * competing, undetermined-actor door/occupant mechanism. This guard is
 * intentionally branch-order-independent (it inspects only the FINAL raw
 * result, not which branch produced it) and intentionally does NOT assert
 * which vehicle's occupant/door is described — in 3 of the 5 confirmed
 * cases the door belongs to the OTHER party, not the subject, so reusing
 * the existing subject_occupant_action_narrative branch's own
 * subject-presuming justification text here would itself be a wrong-actor
 * assertion. This does not add any new lexical pattern, does not reason
 * about which vehicle owns the door, and does not touch
 * event_type/valence/automation_status.
 */
function downgradeIfOccupantActionConflicts(result, atoms) {
  if (result.value === "other-party-contributed" && hasAtom(atoms, "subject_occupant_action_narrative", true)) {
    return classification(
      "undetermined",
      "Narrative contains both a contact-mechanism pattern and an occupant/door-action pattern; this pipeline does not determine which actor's door is described, so no confident single-actor causation category is supported. Conservative default applied.",
      "contested",
    );
  }
  return result;
}

function classifyCausation(atoms, automationStatus, disagreements) {
  const disputeAdjusted = downgradeIfRelevantFieldDisputed(classifyCausationRaw(atoms, automationStatus), disagreements);
  return downgradeIfOccupantActionConflicts(disputeAdjusted, atoms);
}

function classifyCausationRaw(atoms, automationStatus) {
  if (hasAtom(atoms, "av_not_struck_third_party_collision_narrative", true)) {
    return classification(
      "undetermined",
      "The subject vehicle braked for a hazard and was not itself struck; two other vehicles collided as a consequence. Temporal precedence of the subject's braking does not establish it as the cause (Normalization Rulebook v1, case #14 policy).",
      "well-supported",
    );
  }
  // FAITHFULNESS FIX A1 (final faithfulness audit): a narrative describing
  // more than one distinct contact event (a chain-reaction/multi-actor
  // sequence — see evidence.mjs's multi_actor_chain_reaction_narrative)
  // must not let any of the single-actor branches below confidently pin
  // causation on whichever one actor's action happened to match a pattern.
  // This does not reconstruct the causal chain — it only withholds a
  // confident single-actor attribution the evidence does not actually
  // establish for the whole sequence.
  if (hasAtom(atoms, "multi_actor_chain_reaction_narrative", true)) {
    return classification(
      "undetermined",
      "Narrative contains multiple distinct contact-event phrases, which may reflect a multi-actor/chain-reaction sequence or repeated restatement of the same contact across report-update sections; either way, no single-actor causation category can be confidently attributed without further confirmation this pipeline does not attempt. Conservative default applied.",
      "contested",
    );
  }
  if (hasAtom(atoms, "single_vehicle_infrastructure_contact_narrative", true)) {
    if (automationContributionSupported(atoms, automationStatus)) {
      return classification(
        "automation-system-contributed",
        "No other party was involved; the automated maneuver itself produced the contact with static infrastructure. This records that the automated maneuver contributed — it does not assert a specific mechanism (no perception/planning-failure claim) (Normalization Rulebook v1, case #15 policy).",
        "well-supported",
      );
    }
    return classification(
      "undetermined",
      "No other party was involved, but automation was not confirmed engaged at the moment of contact (or a human/teleoperator is described as having taken control first) and no evidence links a prior automated maneuver to the event. Asserting automation contribution from bare subject-vehicle involvement alone would not be supported — see the rulebook's automation-engagement-vs-contribution distinction.",
      "contested",
    );
  }

  const counterpart = findAtom(atoms, "candidate.crash_interaction_counterpart")?.value;
  if (counterpart === "Animal") {
    return classification(
      "undetermined",
      "Counterpart is an animal; the automation-vs-other-party causation framework does not have a clean category for a wildlife-entry event.",
      "well-supported",
    );
  }

  if (hasAtom(atoms, "contact_mechanism_narrative", "other-party-rear-ended-subject")) {
    return classification(
      "other-party-contributed",
      "Narrative/structured evidence directly supports the other party striking the subject vehicle from behind, independent of the subject's own automation state.",
      "well-supported",
    );
  }

  if (hasAtom(atoms, "other_party_traffic_violation_narrative", true)) {
    return classification(
      "other-party-contributed",
      "Narrative directly states the other party disregarded a traffic control (red light/signal) that the subject vehicle had right of way under.",
      "well-supported",
    );
  }

  if (hasAtom(atoms, "other_party_lane_intrusion_narrative", true)) {
    return classification(
      "other-party-contributed",
      "Narrative directly states the other party crossed/entered into the subject vehicle's own lane of travel.",
      "well-supported",
    );
  }

  if (hasAtom(atoms, "subject_occupant_action_narrative", true)) {
    return classification(
      "undetermined",
      "Narrative indicates a subject-vehicle occupant's own action (e.g. opening a door) was material to the contact — a movement-based rule attributing this to the other party's motion alone would not be supported.",
      "contested",
    );
  }

  const subjectMovement = findAtom(atoms, "candidate.subject_vehicle_precrash_movement")?.value;
  const otherMovement = findAtom(atoms, "candidate.other_actor_precrash_movement")?.value;
  if ((subjectMovement === "Stopped" || subjectMovement === "Parked") && otherMovement) {
    return classification(
      "other-party-contributed",
      `Subject vehicle was ${subjectMovement.toLowerCase()}; the other party was in motion (${otherMovement}) at the time of contact.`,
      "well-supported",
    );
  }

  const activeManeuvers = ["Changing Lanes", "Making Left Turn", "Making Right Turn", "Backing"];
  if (
    subjectMovement && activeManeuvers.includes(subjectMovement) &&
    automationStatus.value === "driving-automation-not-engaged"
  ) {
    return classification(
      "undetermined",
      `Subject vehicle was ${subjectMovement.toLowerCase()} under manual control (automation not engaged). Existing causation vocabulary has no category for "subject vehicle's own human driver" distinct from automation vs. other-party — left conservative pending a rulebook decision (see Normalization Rulebook v1 §6, open question 1).`,
      "contested",
    );
  }

  // Only mechanism/other-topic hedges are relevant to causation uncertainty —
  // an injury-topic or administrative-boilerplate hedge says nothing about
  // event mechanics and must not be cited here (a bare /alleged/i match once
  // did exactly that; fixed after out-of-sample review).
  const relevantHedges = atoms.filter(
    (a) => a.field === "narrative_hedge" && (a.value?.topic === "mechanism" || a.value?.topic === "other"),
  );
  if (relevantHedges.length > 0) {
    return classification(
      "undetermined",
      `Source itself expresses uncertainty about the event mechanics ("${relevantHedges[0].text}"); no confident causation category is supportable.`,
      "contested",
    );
  }

  return classification(
    "undetermined",
    "No structured or narrative evidence directly supports a more specific causation category; conservative default applied per Normalization Rulebook v1.",
    "contested",
  );
}

// ---------------------------------------------------------------------------
// event_type
// ---------------------------------------------------------------------------

const VRU_PATTERN = /^Non-Motorist/i;

function classifyEventType(atoms) {
  if (hasAtom(atoms, "av_not_struck_third_party_collision_narrative", true)) {
    return classification(
      "traffic-disruption-or-obstruction",
      "The subject vehicle's braking for a hazard was the reported trigger for a collision between two other vehicles; the subject itself was not struck (Normalization Rulebook v1, case #14 policy).",
      "well-supported",
    );
  }
  if (hasAtom(atoms, "single_vehicle_infrastructure_contact_narrative", true)) {
    // FIXED (targeted adversarial stress test, case 8578fbc6ef74c60 — Tesla
    // teleoperator/fence): this branch previously attributed the maneuver
    // to "the automated system's own maneuver" unconditionally, even when
    // the SAME draft's causation_status (via the independent
    // human_took_control_before_contact_narrative check below) correctly
    // showed a human/teleoperator had taken control first — an internally
    // contradictory record where two fields implied two different actors.
    // event_type does not need to know WHO was in control to correctly
    // describe WHAT happened (single-vehicle contact with static
    // infrastructure, no other party) — actor attribution belongs to
    // causation_status alone. This does not infer automation responsibility
    // merely because the subject vehicle is an AV.
    if (hasAtom(atoms, "human_took_control_before_contact_narrative", true)) {
      return classification(
        "unexpected-or-inappropriate-behaviour",
        "Single-vehicle contact with static infrastructure, no other party involved; contributing evidence indicates a human (safety monitor/teleoperator/driver) had taken control before the contact-producing action — see causation_status for actor attribution (Normalization Rulebook v1, case #15 policy).",
        "well-supported",
      );
    }
    return classification(
      "unexpected-or-inappropriate-behaviour",
      "Single-vehicle contact with static infrastructure during the automated system's own maneuver, no other party involved (Normalization Rulebook v1, case #15 policy).",
      "well-supported",
    );
  }

  const counterpart = findAtom(atoms, "candidate.crash_interaction_counterpart")?.value;
  if (counterpart === "Animal") {
    return classification(
      "other",
      "Animal-strike events have no dedicated event_type; using 'other' per Normalization Rulebook v1 policy, with detail carried in scenario_tags.",
      "well-supported",
    );
  }
  if (counterpart && VRU_PATTERN.test(counterpart)) {
    return classification(
      "vulnerable-road-user-interaction",
      `Crash-interaction counterpart is "${counterpart}".`,
      "well-supported",
    );
  }
  if (counterpart === "First Responder Vehicle") {
    if (hasAtom(atoms, "active_emergency_response_narrative", true)) {
      return classification(
        "emergency-vehicle-interaction",
        "Counterpart is a first-responder vehicle AND the narrative describes active emergency-response behavior (tightened policy: vehicle type alone is insufficient).",
        "well-supported",
      );
    }
    // FAITHFULNESS FIX A2 (final faithfulness audit): explicit source denial
    // of any contact/collision must not be overridden by the generic
    // first-responder-without-active-response default below.
    if (hasAtom(atoms, "no_contact_occurred_narrative", true)) {
      return classification(
        "other",
        "Source narrative explicitly and unambiguously states no contact/collision occurred; \"collision\" would misrepresent the source. Counterpart is a first-responder vehicle without described active emergency-response behavior, but no other existing event_type rule is independently supported, so the safest generic category is used.",
        "well-supported",
      );
    }
    return classification(
      "collision",
      "Counterpart is a first-responder vehicle, but no active emergency-response behavior (lights/sirens/pursuit/yielding) is described — per the tightened policy, vehicle type alone does not qualify as emergency-vehicle-interaction.",
      "well-supported",
    );
  }

  // FAITHFULNESS FIX A2 (final faithfulness audit, confirmed cases
  // 8c56b788577d262, e030f01d2992e85): explicit, unambiguous source language
  // stating that no contact/collision occurred must prevent the generic
  // "collision" default below. This does not infer near-miss-or-
  // safety-critical or any other more specific category merely from the
  // absence of contact — per policy, the safest existing generic category
  // ("other") is used unless a more specific rule is independently
  // supported (none of the branches above this point matched, by
  // construction, since we have already reached the final fallback).
  if (hasAtom(atoms, "no_contact_occurred_narrative", true)) {
    return classification(
      "other",
      "Source narrative explicitly and unambiguously states no contact/collision occurred; \"collision\" would misrepresent the source. No other existing event_type rule is independently supported by the available evidence, so the safest generic category is used.",
      "well-supported",
    );
  }

  return classification(
    "collision",
    "Default classification for a reported NHTSA SGO crash with no more specific category triggered.",
    "well-supported",
  );
}

// ---------------------------------------------------------------------------
// valence
// ---------------------------------------------------------------------------

function classifyValence(atoms) {
  if (hasAtom(atoms, "av_not_struck_third_party_collision_narrative", true)) {
    return classification(
      "neutral-or-unclear",
      "The subject vehicle's own action (braking for a hazard) is not itself evidence of failure or success; the collision was between other parties (Normalization Rulebook v1, case #14 policy).",
      "well-supported",
    );
  }
  if (hasAtom(atoms, "single_vehicle_infrastructure_contact_narrative", true)) {
    // FIXED (targeted adversarial stress test, case 8578fbc6ef74c60): same
    // actor-attribution issue as classifyEventType above. The outcome
    // (self-inflicted contact with infrastructure) is challenging for the
    // deployment regardless of which actor was driving at the moment of
    // contact — valence describes the character of the outcome, not who
    // caused it — so the enum value is unchanged; only the justification's
    // implicit actor claim is removed when a human is known to have taken
    // control first.
    if (hasAtom(atoms, "human_took_control_before_contact_narrative", true)) {
      return classification(
        "failure-or-challenging",
        "Single-vehicle contact with static infrastructure is a challenging outcome for the deployment regardless of which actor was in control at the moment of contact; contributing evidence indicates a human had taken control before the maneuver that produced it — see causation_status for actor attribution.",
        "well-supported",
      );
    }
    return classification(
      "failure-or-challenging",
      "The automated maneuver resulted in self-inflicted contact with infrastructure (Normalization Rulebook v1, case #15 policy).",
      "well-supported",
    );
  }
  const counterpart = findAtom(atoms, "candidate.crash_interaction_counterpart")?.value;
  if (counterpart === "Animal") {
    return classification(
      "neutral-or-unclear",
      "Animal-strike events default to neutral-or-unclear; an attempted avoidance maneuver does not by itself establish successful-handling if contact still occurred (Normalization Rulebook v1 policy).",
      "well-supported",
    );
  }
  if (hasAtom(atoms, "successful_handling_pattern_narrative", true)) {
    return classification(
      "successful-handling",
      "Narrative supports a completed sequence: hazard detected, vehicle braked and reached a controlled stop, and any subsequent contact occurred only after that safe state was reached.",
      "well-supported",
    );
  }
  return classification(
    "neutral-or-unclear",
    "No evidence of either a completed successful-handling sequence or an automation failure distinct from being a passive party to the event.",
    "contested",
  );
}

// ---------------------------------------------------------------------------
// scenario_tags
// ---------------------------------------------------------------------------

function classifyScenarioTags(atoms, eventType) {
  const tags = [];
  const justifications = [];

  if (hasAtom(atoms, "av_not_struck_third_party_collision_narrative", true)) {
    tags.push("debris-avoidance-braking", "third-party-chain-collision", "av-not-physically-involved");
    justifications.push("case #14 structural pattern");
  }
  if (hasAtom(atoms, "single_vehicle_infrastructure_contact_narrative", true)) {
    tags.push("single-vehicle-infrastructure-contact", "parking-lot-maneuver", "no-other-party");
    justifications.push("case #15 structural pattern");
  }
  const counterpart = findAtom(atoms, "candidate.crash_interaction_counterpart")?.value;
  if (counterpart === "Animal") {
    tags.push("animal-strike");
    if (hasAtom(atoms, "successful_handling_pattern_narrative") || /steer|reduced (vehicle )?speed|braked/i.test(
      findAtom(atoms, "candidate.narrative")?.value ?? "",
    )) {
      tags.push("attempted-avoidance-maneuver");
    }
  }
  if (eventType.value === "vulnerable-road-user-interaction") {
    if (/Cyclist/i.test(counterpart ?? "")) tags.push("cyclist-interaction");
    if (/Pedestrian/i.test(counterpart ?? "")) tags.push("pedestrian-interaction");
  }
  if (counterpart === "First Responder Vehicle" && eventType.value === "collision") {
    tags.push("police-vehicle");
  }
  if (hasAtom(atoms, "contact_mechanism_narrative", "other-party-rear-ended-subject")) {
    tags.push("struck-from-behind");
  }
  const automationNarrative = findAtoms(atoms, "automation_engagement_narrative");
  const structuredEngagement = findAtom(atoms, "candidate.automation_engagement_text");
  if (
    automationNarrative.some((a) => a.value === "not-engaged") ||
    structuredEngagement?.value === "Verified Not Engaged"
  ) {
    tags.push("autonomy-disengaged-before-impact");
  }

  if (tags.length === 0) {
    return unsupported("No scenario-tag pattern in this pilot's rule set matched the available evidence.");
  }
  return classification(
    [...new Set(tags)],
    `Derived from matched evidence patterns (${justifications.join("; ") || "structured field combination"}).`,
    "well-supported",
  );
}

// ---------------------------------------------------------------------------

/**
 * Classify one candidate from its evidence atoms + disagreement list.
 * Returns { event_type, valence, automation_status, causation_status,
 * scenario_tags }, each a { value, tier, justification, confidence } record.
 */
export function classify(atoms, disagreements) {
  const automation_status = classifyAutomationStatus(atoms);
  const causation_status = classifyCausation(atoms, automation_status, disagreements);
  const event_type = classifyEventType(atoms);
  const valence = classifyValence(atoms);
  const scenario_tags = classifyScenarioTags(atoms, event_type);

  return { event_type, valence, automation_status, causation_status, scenario_tags };
}

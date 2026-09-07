/**
 * Deterministic validation — Stage 3 of the NHTSA -> WBA normalization
 * pipeline. Implements the hard rules from Normalization Rulebook v1 as
 * real, executable predicates (not prompt instructions). A draft failing
 * any rule is rejected before it would ever reach a curator queue.
 *
 * Rule numbers below match docs/nhtsa-normalization-rulebook.md.
 */

// Ontology values copied verbatim from src/lib/events/types.ts and the
// event table's check constraint (supabase/migrations/20260829235332_
// observatory_core.sql) — the single source of truth this file checks
// against. If the ontology ever changes, this list must be updated from
// those two places, never guessed.
export const ONTOLOGY = {
  event_type: [
    "collision",
    "near-miss-or-safety-critical",
    "unexpected-or-inappropriate-behaviour",
    "unnecessary-stop-braking-or-hesitation",
    "traffic-rule-or-infrastructure-interpretation",
    "vulnerable-road-user-interaction",
    "emergency-vehicle-interaction",
    "traffic-disruption-or-obstruction",
    "successful-challenging-interaction",
    "other",
  ],
  valence: ["failure-or-challenging", "successful-handling", "neutral-or-unclear"],
  automation_status: [
    "driving-automation-engaged-confirmed",
    "driving-automation-engaged-reported",
    "driving-automation-status-uncertain",
    "driving-automation-not-engaged",
    "unknown",
  ],
  causation_status: [
    "undetermined",
    "automation-system-contributed",
    "other-party-contributed",
    "shared-or-multiple-factors",
    "not-applicable",
  ],
  location_precision: [
    "exact-point",
    "road-or-intersection",
    "local-area",
    "city",
    "region",
    "country",
    "unknown",
  ],
};

const FORBIDDEN_LOCATION_PRECISION_FROM_NHTSA_ONLY = new Set(["exact-point", "road-or-intersection", "local-area"]);
const MECHANISM_INFERENCE_PATTERN = /perceiv|planning failure|failed to detect|sensor fault|misjudg/i;

function fail(rule, message) {
  return { rule, message };
}

/**
 * Validate one assembled draft.
 *
 * `draft` shape (see run-pilot.mjs):
 *   { candidateId, atoms, disagreements, classification: {event_type,
 *     valence, automation_status, causation_status, scenario_tags},
 *     locationPrecision, developerCanonical, unknowns: string[] }
 */
export function validateDraft(draft) {
  const violations = [];
  const { classification, atoms, disagreements, locationPrecision, unknowns } = draft;

  // Rules 1-2: every enum value must exist in the real ontology; no
  // invented values under any circumstance.
  for (const field of ["event_type", "valence", "automation_status", "causation_status"]) {
    const value = classification[field]?.value;
    if (value !== null && value !== undefined && !ONTOLOGY[field].includes(value)) {
      violations.push(fail(`1-2:${field}`, `"${value}" is not a member of the actual ${field} ontology.`));
    }
  }
  if (locationPrecision && !ONTOLOGY.location_precision.includes(locationPrecision)) {
    violations.push(fail("1-2:location_precision", `"${locationPrecision}" is not a member of the actual location_precision ontology.`));
  }

  // Rule 3: never exact-point/road-or-intersection/local-area from
  // redacted NHTSA-only geography.
  if (FORBIDDEN_LOCATION_PRECISION_FROM_NHTSA_ONLY.has(locationPrecision)) {
    violations.push(fail("3", `location_precision "${locationPrecision}" is not supportable from NHTSA-only redacted location text.`));
  }

  // Rule 4: this pilot never populates system_version/system_name; assert
  // that structurally (the draft object must not carry either key at all).
  if ("system_version" in draft || "system_name" in draft) {
    violations.push(fail("4", "Draft must not populate system_version/system_name — no evidence source for either exists in this pipeline."));
  }

  // Rules 5-7: no causal mechanism inferred from outcome/sequence alone;
  // automation-system-contributed must not smuggle in an unsupported "why".
  if (classification.causation_status?.value === "automation-system-contributed") {
    if (MECHANISM_INFERENCE_PATTERN.test(classification.causation_status.justification ?? "")) {
      violations.push(fail("7", "causation_status justification asserts an unsupported mechanism (perception/planning failure) — mechanism must remain unknown."));
    }
  }

  // Rule 8: a substantive disagreement (the mechanical importer already
  // left the field null) must not disappear silently — it must be present
  // in `unknowns`, UNLESS it was safely, deterministically resolved (e.g.
  // the developer/operator alias table collapsing a cosmetic variant).
  for (const d of disagreements) {
    if (d.field === "developer_or_operator" && draft.developerCanonical) {
      continue; // cosmetically resolved — not a silent disappearance.
    }
    if (d.field === "city" && draft.cityCanonical) {
      continue; // cosmetically resolved — not a silent disappearance.
    }
    const mentioned = unknowns.some((u) => u.toLowerCase().includes(d.field.replace(/_/g, " ")));
    if (!mentioned) {
      violations.push(fail("8", `Disagreement on "${d.field}" (${d.values.join(" / ")}) is not represented in unknowns.`));
    }
  }

  // Rule 9: every hedge extracted from narrative must be preserved
  // (present) in the evidence-atom list carried forward with the draft.
  const hedgeAtoms = atoms.filter((a) => a.field === "narrative_hedge");
  for (const h of hedgeAtoms) {
    if (!atoms.includes(h)) {
      violations.push(fail("9", `Hedge "${h.value?.phrase}" was extracted but is missing from the draft's carried-forward evidence.`));
    }
  }

  // Rule 10: automation_status for a historical-generation candidate must
  // not default to "unknown" if narrative engagement evidence was actually
  // available — that would mean the classifier ignored available evidence.
  const narrativeEngagementAtoms = atoms.filter((a) => a.field === "automation_engagement_narrative");
  if (narrativeEngagementAtoms.length > 0 && classification.automation_status?.value === "unknown") {
    violations.push(fail("10", "Narrative engagement evidence was extracted but automation_status was classified as unknown — evidence was not used."));
  }

  // Rule 11: current-generation structured Engagement Status must be
  // preferred over narrative inference when both exist.
  const structuredEngagement = atoms.find((a) => a.field === "candidate.automation_engagement_text");
  if (structuredEngagement && !/Structured Engagement Status/.test(classification.automation_status?.justification ?? "")) {
    violations.push(fail("11", "A structured Engagement Status value was present but the classification justification does not cite it as the basis."));
  }

  // Rule 12/13: this pipeline must never touch publication or event_source
  // fields — structural guarantee, not just a runtime check.
  const forbiddenKeys = ["is_public", "first_published_at", "event_source", "reviewStatus"];
  for (const key of forbiddenKeys) {
    if (key in draft) {
      violations.push(fail("12-13", `Draft must never carry a "${key}" field — this pipeline produces private, curator-owned drafts only.`));
    }
  }

  // Rule 20 (added after out-of-sample review): automation-system-contributed
  // requires either automation confirmed/reported engaged with no evidence a
  // human took control first, OR explicit evidence of a prior automated
  // maneuver linked to the event. AUTOMATION ENGAGEMENT AT CONTACT and
  // AUTOMATION CONTRIBUTION TO THE EVENT SEQUENCE are distinct questions —
  // see docs/nhtsa-normalization-rulebook.md. This is an independent
  // backstop check, not a re-trust of classify.mjs's own reasoning.
  if (classification.causation_status?.value === "automation-system-contributed") {
    const engagedAtSomePoint = ["driving-automation-engaged-confirmed", "driving-automation-engaged-reported"]
      .includes(classification.automation_status?.value);
    const priorManeuverEvidence = atoms.some(
      (a) => a.field === "automation_action_before_handoff_narrative" && a.value === true,
    );
    const humanTookControlFirst = atoms.some(
      (a) => a.field === "human_took_control_before_contact_narrative" && a.value === true,
    );
    const supported = (engagedAtSomePoint && !humanTookControlFirst) || priorManeuverEvidence;
    if (!supported) {
      violations.push(fail(
        "20",
        "causation_status = automation-system-contributed is not supported: automation was not confirmed engaged at contact (or a human/teleoperator is described as taking control first), and no evidence links a prior automated maneuver to the event.",
      ));
    }
  }

  // Rule 21: a structural classification citing the single-vehicle-
  // infrastructure pattern must not fire when the record already identifies
  // a concrete other party — incidental keyword co-occurrence is not an
  // actor relationship.
  const citesInfrastructurePattern = ["event_type", "valence"].some((f) =>
    /case #15 policy/i.test(classification[f]?.justification ?? ""),
  );
  if (citesInfrastructurePattern) {
    const counterpart = atoms.find((a) => a.field === "candidate.crash_interaction_counterpart")?.value;
    const noOtherParty = counterpart === undefined || counterpart === "Other, see Narrative" ||
      counterpart === "Other Fixed Object";
    if (!noOtherParty) {
      violations.push(fail(
        "21",
        `Single-vehicle-infrastructure classification fired but crash_interaction_counterpart ("${counterpart}") identifies a concrete other party.`,
      ));
    }
  }

  // Rule 22: causation must not attribute other-party-contributed when
  // subject-occupant-action evidence (e.g. a passenger opening a door) is
  // present in the same draft — that evidence directly competes with a
  // movement-based other-party attribution.
  if (classification.causation_status?.value === "other-party-contributed") {
    const occupantAction = atoms.some(
      (a) => a.field === "subject_occupant_action_narrative" && a.value === true,
    );
    if (occupantAction) {
      violations.push(fail(
        "22",
        "causation_status = other-party-contributed conflicts with subject-occupant-action evidence (e.g. a passenger opening a door) present in the same draft.",
      ));
    }
  }

  // Rule 23: a causation justification quoting hedge text must not be
  // quoting an injury- or administrative-topic hedge — those do not speak
  // to causation mechanics (a bare /alleged/i match once produced exactly
  // this kind of topic-mismatched, misleading justification).
  const causationJustification = classification.causation_status?.justification ?? "";
  for (const h of hedgeAtoms) {
    if (
      h.value?.phrase && h.text && causationJustification.includes(h.text) &&
      (h.value.topic === "injury" || h.value.topic === "administrative")
    ) {
      violations.push(fail(
        "23",
        `causation_status justification cites a ${h.value.topic}-topic hedge ("${h.value.phrase}"), which does not speak to causation mechanics.`,
      ));
    }
  }

  // Rule 24 (added after the targeted adversarial stress test, cases
  // 77ba86fa433a2c4 / aeb0ef282584e35): when evidence extraction has
  // flagged a "source-record inconsistency" — two or more of the three
  // event-shape fields (crash_interaction_counterpart,
  // subject_vehicle_precrash_movement, other_actor_precrash_movement)
  // disagreeing simultaneously among contributing reports, a materially
  // stronger signal than one disputed field — that signal must itself be
  // visible in `unknowns`, not merely represented as several ordinary,
  // individually-unremarkable field disagreements. The check below only
  // requires the neutral phrase "source-record inconsistency" — per
  // independent review, the surfaced wording itself must NOT assert that
  // the inconsistency means the grouping represents multiple physical
  // events (see evidence.mjs's detectSourceRecordInconsistency and the atom
  // text it produces), so this rule does not check for or require any such
  // phrase either.
  const sourceRecordInconsistencyAtom = atoms.find((a) => a.field === "source_record_inconsistency");
  if (sourceRecordInconsistencyAtom) {
    const mentioned = unknowns.some((u) => /source.record inconsistency/i.test(u));
    if (!mentioned) {
      violations.push(fail(
        "24",
        "Source-record inconsistency (>=2 event-shape fields disagreeing simultaneously among contributing reports) was detected but is not represented in unknowns.",
      ));
    }
  }

  // Rule 25 (added after the targeted adversarial stress test, case
  // 8578fbc6ef74c60 — Tesla teleoperator/fence): an INDEPENDENT backstop
  // against incompatible actor attribution across fields, not a
  // re-execution of classify.mjs's own single-vehicle-infrastructure rule.
  // It cross-checks the event_type/valence justification TEXT against the
  // ATOMS using its own, separate pattern, so it keeps catching this class
  // of contradiction even if a future classify.mjs change reintroduces it
  // through different code: no field's justification may attribute a
  // maneuver to automation "on its own" while the same draft's evidence
  // independently shows a human/teleoperator took control before contact.
  const AUTOMATION_OWN_MANEUVER_ATTRIBUTION_PATTERN =
    /automat\w+[^.]{0,40}(own|itself|its own)\s+maneuver|automated maneuver/i;
  const humanTookControlFirst = atoms.some(
    (a) => a.field === "human_took_control_before_contact_narrative" && a.value === true,
  );
  if (humanTookControlFirst) {
    for (const field of ["event_type", "valence"]) {
      const justification = classification[field]?.justification ?? "";
      if (AUTOMATION_OWN_MANEUVER_ATTRIBUTION_PATTERN.test(justification)) {
        violations.push(fail(
          "25",
          `${field} justification attributes the maneuver to automation ("${justification}") while evidence independently shows a human/teleoperator took control before contact — incompatible actor attribution across fields.`,
        ));
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

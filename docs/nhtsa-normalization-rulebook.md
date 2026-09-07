# NHTSA → WBA Normalization Rulebook v1

Status: **approved.** Governs the mechanical → interpretive normalization of
`nhtsa_incident_candidate` records toward eventual WBA `event` drafts. A
first pilot implementation exists (`migration/nhtsa/normalization/`),
validated against the 15 calibration cases plus two independently-sampled
30-candidate out-of-sample batches (75 candidates total) — see "Pilot
implementation notes" at the end of this document. No automatic promotion or
publication exists; this rulebook governs draft generation only.

## Ontology — use the existing values exactly

Enum values below are copied verbatim from `src/lib/events/types.ts` and the
`event` table's check constraint
(`supabase/migrations/20260829235332_observatory_core.sql`). If the ontology
ever changes, update this list from those two sources — never from memory.

```
event_type:         collision | near-miss-or-safety-critical |
                     unexpected-or-inappropriate-behaviour |
                     unnecessary-stop-braking-or-hesitation |
                     traffic-rule-or-infrastructure-interpretation |
                     vulnerable-road-user-interaction |
                     emergency-vehicle-interaction |
                     traffic-disruption-or-obstruction |
                     successful-challenging-interaction | other

valence:             failure-or-challenging | successful-handling |
                     neutral-or-unclear

automation_status:   driving-automation-engaged-confirmed |
                     driving-automation-engaged-reported |
                     driving-automation-status-uncertain |
                     driving-automation-not-engaged | unknown

causation_status:    undetermined | automation-system-contributed |
                     other-party-contributed | shared-or-multiple-factors |
                     not-applicable

location_precision:  exact-point | road-or-intersection | local-area |
                     city | region | country | unknown
```

No value outside these lists may ever be produced by this pipeline, under
any circumstance, at any stage.

## Pipeline stages

```
NHTSA reports (raw CSV)
   │  [mechanical importer — built, tested, in production]
   ▼
mechanical consolidation  →  nhtsa_report, nhtsa_incident_candidate
   │
   ▼
evidence extraction        — pull discrete, attributable evidence atoms from
   │                          structured fields AND narrative text
   ▼
conservative ontology classification — map evidence atoms onto WBA's fixed
   │                                     enums, each with a justification
   ▼
deterministic validation   — hard rules reject/flag before curator review
   │
   ▼
curator review             — accept / edit / reject per field
   ▼
WBA event (private draft → curator-controlled publication, unchanged)
```

**Architectural boundary**: the classification stage consumes ONLY the
evidence-atom list produced by extraction. It never re-reads or
re-interprets raw narrative text. Any fact classification needs from
narrative prose must already exist as an evidence atom.

### A. SOURCE EVIDENCE
What the NHTSA record actually says — structured coded fields and narrative
prose, taken as-is, always attributable to a specific report or the
consolidated candidate.

### B. DERIVED FACTS
Deterministic, judgment-free transformations: date formatting,
`location_precision` selection, cosmetic/typo alias resolution.

### C. INTERPRETIVE CLASSIFICATION
Judgment-dependent mapping onto `event_type`, `valence`, `causation_status`,
`scenario_tags`. **AI must never convert an interpretive classification into
a claim the source itself made.**

## Provenance / confidence semantics

Two axes:

**Tier** (what kind of statement this is):

| Tier | Meaning |
|---|---|
| `EVIDENCE` | Verbatim/close paraphrase from a specific report or the consolidated candidate, with a source pointer. |
| `DERIVED` | Deterministic, judgment-free transformation of EVIDENCE atoms (date formatting, alias resolution). |
| `CLASSIFICATION` | Judgment-based mapping onto a fixed WBA enum — always carries a justification string. |
| `UNSUPPORTED` | No evidence exists; the field is left unpopulated. Never a populated guess. |

**Confidence** (for `CLASSIFICATION` only): `well-supported` (evidence
directly and unambiguously implies the value) vs. `contested` (a defensible
reading exists, but a different classifier could reasonably land elsewhere).
`contested` values are always routed to curator review even when a value is
proposed.

## Approved policy decisions

| Situation | Rule |
|---|---|
| Automation disengaged at impact | `automation_status = driving-automation-not-engaged`. Causation is a **separate dimension** — never auto-set `not-applicable` merely because automation was off. Evaluate causation from the reported mechanics regardless of automation state (e.g. a manually-driven vehicle rear-ended while stopped can still be `other-party-contributed`). |
| Subject vehicle actively maneuvering under manual control, mechanism doesn't cleanly implicate the other party | Keep `causation_status = undetermined`. **Do not extend the causation ontology** to add a "human-driver-of-subject" category — this is a known, accepted vocabulary gap (see Open Questions). |
| Animal interactions | `event_type = other`. No new enum value. Detail via `scenario_tags` (`animal-strike`, `attempted-avoidance-maneuver`). |
| Emergency-vehicle interaction | **Tightened**: the emergency nature of the vehicle must be *behaviorally relevant* to the event (active response, lights/sirens, yielding behavior, emergency-scene interaction). Merely being a police/ambulance/fire vehicle is insufficient — classify as `collision` instead, with an optional descriptive tag such as `police-vehicle`. |
| AV not physically struck, but its behavior precedes a third-party collision | `event_type = traffic-disruption-or-obstruction`, `valence = neutral-or-unclear`, `causation_status = undetermined`. Temporal precedence ≠ causation. |
| Single-vehicle infrastructure incident, structural shape | `event_type = unexpected-or-inappropriate-behaviour`, `valence = failure-or-challenging` when the record identifies no concrete other party (see the actor-relationship gate below) and infrastructure contact is described. |
| Single-vehicle infrastructure incident, causation | `causation_status = automation-system-contributed` **only when automation contribution is actually supported** — see "Automation engagement vs. automation contribution" below. Otherwise `undetermined`. The *mechanism* (perception/planning failure) is never asserted either way, only that the automated maneuver was involved when it is asserted. |
| Infrastructure-contact detection | Gated on an **actor/relationship** signal, not keyword presence: the consolidated `crash_interaction_counterpart` must be null/`Other, see Narrative`/`Other Fixed Object` (i.e. the record itself identifies no concrete other vehicle/person), AND the narrative must not separately describe another external actor — a vehicle type contacting the subject, **or a person (pedestrian/individual/cyclist) described as actively moving the object involved** — as responsible for the contact. A keyword list alone (even word-boundary-anchored) was found during out-of-sample review to false-positive on purely incidental infrastructure mentions ("parked at the curb") in both ordinary two-party vehicle collisions (batch #1) and pedestrian-caused contacts (batch #2, a pedestrian pushing shopping carts). The guard is a general actor/relationship principle — any object a person is described moving is covered — not an enumeration of specific objects. |
| Attempted avoidance, contact still occurs | `valence = neutral-or-unclear`. The avoidance action itself goes in `observed_facts`/`scenario_tags`, not into the valence. |
| Successful handling | Requires evidence the vehicle **completed** the relevant maneuver safely (detected → responded → reached a controlled/stopped state) before any subsequent contact — not merely that it attempted a response. |
| Stopped/parked subject, other party in motion | May support `other-party-contributed`, but **only after checking for subject-side evidence that competes with it** — e.g. a subject-vehicle occupant's own action (opening a door) that is what actually produced the contact. When such evidence exists, do not attribute to the other party's motion alone; use `undetermined`. The underlying concept is general — a subject-vehicle occupant performs an action that materially participates in the contact — so the extraction pattern tolerates natural phrasing gaps (an adverb before the verb, a side/position descriptor between "rear/front" and "door") rather than requiring one exact sentence; it is not, and should not become, an exhaustive enumeration of every possible occupant-action sentence. |
| Other party crosses/enters the subject's lane | May support `other-party-contributed`, but only where the reported direction of the intrusion is explicit and unambiguous (the OTHER party is clearly the one crossing into the SUBJECT's lane/path) — never inferred from vague lane-change language. |
| Developer/operator alias normalization | Keep the table **deliberately small**: only collapse variants whose equivalence is unambiguous (e.g. "Waymo LLC." → "Waymo LLC" — punctuation/spacing only, same words). **Never** collapse a variant that adds/removes a word (e.g. "Motional AD Inc." → "Motional") without explicit separate approval — that may be a genuine distinct legal entity. |
| Source disagreements | Classify as **safe** (case/punctuation/whitespace-only, or an explicitly pre-approved canonical mapping), or **substantive** (any other spelling difference, or a movement/injury/counterpart conflict). Only the safe category may be deterministically auto-resolved. Edit distance alone is never treated as sufficient evidence of which spelling is correct — a typo can add a character as easily as omit one — so an unmapped spelling difference is always preserved in `unknowns`, never guessed. |
| `observed_facts` | Short, atomic, source-attributed ("The NHTSA record reports...", "Waymo states..."). Not one bullet per database column. |
| Source hedges | A hedge may appear in `observed_facts` as a reported hedge, and the underlying unresolved question may separately appear in `unknowns` — not duplication. **Hedges must be scoped by topic** (injury / contact-mechanism / legal-administrative-boilerplate / other event-specific) — a hedge qualifies only the proposition it actually modifies. An injury-topic hedge ("the passenger alleged a minor injury") or administrative-boilerplate hedge ("has not investigated the alleged incident" — a fixed phrase in every GM/Cruise duplicate filing) must never be used to justify uncertainty about *causation mechanics*, a different topic entirely. |
| Location | `city` when city/state known; `region` for state-only; `country` for country-only; `unknown` if insufficient. Never `exact-point`/`road-or-intersection` from NHTSA's redacted street text. |
| Causation default | `undetermined` unless evidence supports another value. Temporal sequence is not causation. No fault inference. `other-party-contributed` is available when reported mechanics directly support it, independent of the subject's own automation state. |

### Automation engagement vs. automation contribution

Two distinct questions, both real, neither reducible to the other:

- **Automation engagement at contact** — was the automated driving system operating at the precise moment contact occurred? This is what `automation_status` records.
- **Automation contribution to the event sequence** — did the automated system's behavior play a causal role in how the event unfolded, even if a human had since taken over? This is one input to `causation_status`.

Automation may contribute to an event even after it was disengaged — e.g. the ADS initiates an inappropriate maneuver, a safety driver disengages/takes over, and a collision follows as a consequence of the preceding ADS maneuver. Conversely, automation may be reported engaged for a trip overall while a human (a safety driver or a **teleoperator**) is described as having taken control specifically before the maneuver that produced the reported contact — automation being "engaged" in the coarse, trip-level sense does not mean it was in control at the moment that mattered.

**Rule**: `causation_status = automation-system-contributed` requires one of:
1. `automation_status` confirms/reports engagement (`driving-automation-engaged-confirmed` / `-engaged-reported`) **and** no evidence exists that a human/teleoperator took control before the specific event-producing maneuver; or
2. Explicit narrative evidence links a **prior automated maneuver** to a subsequent handoff/event (the automated system is described as initiating/attempting something, with a disengagement/takeover described afterward).

Never infer automation contribution merely from the subject vehicle's bare involvement, and never merely because automation was engaged *at some point* in the trip. When neither condition holds, `causation_status` is downgraded to `undetermined` — this is a downgrade, not a rejection, consistent with the existing pipeline architecture (classification defaults conservatively; validation is a backstop, not the primary mechanism).

**Ontology/provenance limitation (not resolved by a schema change, per instruction — flagged instead)**: `automation_status` is a single snapshot value per candidate. It cannot itself represent "engaged for most of the trip, but a teleoperator took over before the final maneuver" as a temporal sequence. The pipeline does not attempt to force this distinction into `automation_status` (which continues to report the structured/overall engagement value verbatim, per the existing preference for structured data) — instead, the *separate* teleoperator/takeover evidence is tracked purely as an input to `causation_status`'s contribution test above. This is a genuine expressiveness gap worth knowing about if the ontology is ever revisited, but does not require a change now.

## Hard validation rules (implemented as code, not prompt text)

See `migration/nhtsa/normalization/validate.mjs` for the executable form.

1–2. Every enum value must be a literal member of the ontology above; no invented values or shorthand forms.
3. `location_precision` may never be `exact-point`/`road-or-intersection`/`local-area` from NHTSA-only redacted geography.
4. `system_version`/`system_name` may never be populated without explicit source support (this pipeline currently has no evidence source for either — a draft carrying either key is rejected outright).
5–7. No causal mechanism from outcome/sequence alone; `automation-system-contributed` must never smuggle in an unstated *why* (perception/planning failure).
8. A substantive report-to-report disagreement must appear in `unknowns` unless deterministically, safely resolved (cosmetic/typo).
9. Narrative hedges must be preserved, not flattened into unqualified claims.
10. `automation_status` for historical-generation reports must consider narrative text (the structured field is null by design for that generation).
11. Current-generation structured Engagement Status must be preferred over narrative inference when present.
12–13. No publication-lifecycle fields, no `event_source` writes — private drafts only.
20. `automation-system-contributed` requires either confirmed/reported engagement with no evidence a human took control first, or explicit prior-automated-maneuver evidence — an independent backstop for the "automation engagement vs. contribution" distinction above (not a re-trust of the classifier's own reasoning).
21. A single-vehicle-infrastructure structural classification must not co-occur with a concrete (non-null, non-"Other") `crash_interaction_counterpart` — the actor-relationship gate, checked again at validation.
22. `other-party-contributed` must not co-occur with subject-occupant-action evidence (e.g. a passenger opening a door) in the same draft.
23. A causation justification may not quote an injury- or administrative-topic hedge — those do not speak to causation mechanics.
(Numbering follows the rulebook draft this pipeline was built against; rules 14–19 were reserved but not needed — see `validate.mjs` for the exact, current, complete list.)

## Pilot implementation notes

A first pilot (`migration/nhtsa/normalization/`) implements this rulebook as
real code and validates it against the 15 known calibration candidates
(fixture: `calibration-fixture.json`, frozen from production, no live DB
read at run time). Key implementation facts:

- **Classification is a deterministic rule engine, not a live model call.**
  The project's long-term design (`docs/discovery-pipeline.md`) specifies
  "one structured LLM call per item" for this stage. This codebase has no
  AI/LLM integration anywhere yet; wiring one up is a distinct future
  decision requiring its own review (external services must be explained
  before they're wired up, per `CLAUDE.md`). The pilot's rule engine encodes
  this rulebook's decisions explicitly and auditably as a stand-in.
- Two classification rules are narrow, narrative-pattern heuristics scoped
  to the two structurally unusual calibration cases that need them (AV not
  struck / third-party collision; single-vehicle infrastructure contact).
  These are explicitly flagged as needing generalization (or a real model)
  before any run beyond the known 15 cases.
- All 15 calibration cases pass with zero hard-validation violations after
  fixing several genuine bugs found during pilot validation (an unanchored
  regex substring match, an overly rigid phrase match, a direction-agnostic
  rear-end pattern, and a missing cosmetic-resolution path for the `city`
  field) — see the pilot report for detail.
- An initial version of `cosmetic-resolution.mjs` additionally used an
  edit-distance heuristic (preferring the longer string) to auto-resolve
  plain spelling differences. This was found to be unsound — a typo can add
  a character as easily as omit one — and was replaced with the conservative
  policy in this document: only case/punctuation/whitespace differences or
  an explicitly pre-approved canonical mapping are auto-resolved; any other
  spelling difference is preserved for curator/AI review.

### First out-of-sample batch (30 unseen candidates) — findings and fixes

A systematically-sampled, content-blind batch of 30 previously-unseen
candidates (excluded from the 15-case calibration set) surfaced several real
generalization failures not visible in the calibration set, all since fixed:

1. **The single-vehicle-infrastructure keyword list false-positived on
   ordinary two-party collisions** that merely mentioned "curb" as an
   incidental location descriptor ("parked at the curb"), fabricating an
   `automation-system-contributed` causation claim on top. Fixed by gating
   the pattern on the consolidated `crash_interaction_counterpart` (must
   indicate no concrete other party) plus a negative guard for narrative
   describing another vehicle contacting the subject — an actor/relationship
   check, not a longer keyword list (see the policy table above). The same
   fix, applied to a wider infrastructure-noun list, also caught a genuine
   single-vehicle case ("raised pavement"/"utility access cover") the
   original list had missed.
2. **`automation-system-contributed` was asserted with no automation-
   contribution evidence** whenever the structural pattern fired, regardless
   of whether automation was ever confirmed engaged — see "Automation
   engagement vs. automation contribution" above and validation rule 20.
3. **The stopped/parked + other-party-moving rule misattributed causation**
   in a case where a subject-vehicle occupant's own action (opening a door)
   was the actual reported mechanism. Fixed with a competing-evidence check
   (validation rule 22).
4. **A whole class of other-party-caused contacts went unrecognized**
   (other party explicitly crossing/entering the subject's lane) and
   defaulted to the safe-but-imprecise `undetermined`. Added a reusable
   lane-intrusion pattern, anchored on Waymo's own standard "entered the
   [subject]'s lane of travel" reporting phrase (a structural template, not
   one case's wording) — plus a companion generalization of the existing
   red-light-violation pattern to also match "against a red traffic light"
   phrasing.
5. **A bare `/alleged/i` hedge trigger conflated three unrelated things**:
   injury claims, GM/Cruise's fixed legal-boilerplate sentence ("has not
   investigated the alleged incident"), and genuine event-mechanics
   uncertainty — producing misleading (and once, word-truncated/garbled)
   causation justifications. Fixed by scoping every hedge to a topic
   (injury / mechanism / administrative / other) at extraction time, so
   causation reasoning only ever consults mechanism/other-topic hedges
   (validation rule 23).
6. **A teleoperator-takeover case** showed the structured Engagement Status
   field ("Verified Engaged") can be correct for a trip overall while a
   narrative-described teleoperator took control specifically before the
   contact-producing maneuver. Resolved without touching `automation_status`
   (still trusts the structured field, per rule 11) by tracking the
   takeover as a separate, causation-only signal — see the dedicated
   ontology-limitation note above.

All fixes were validated by (a) re-running the 15-case calibration fixture
(all 15 unchanged) and (b) re-running the *same* 30-candidate development
fixture as a regression check — **not** a new out-of-sample test, since the
fixture and its known answers had already informed the fixes. A second,
independently-sampled unseen batch is the next required step before scaling
further.

### Second out-of-sample batch (30 unseen candidates, independently sampled) — findings and fixes

A second, differently-sampled batch of 30 previously-unseen candidates
(disjoint from both the 15-case calibration set and the first 30-candidate
batch) tested whether the batch-#1 fixes above generalized, or only patched
the exact cases they were built against. Result: substantially fewer
unsupported/aggressive errors than batch #1 (2 of 30, down from 8 of 30), and
**neither of batch #1's original bug shapes recurred in its original form**.
What did recur is the same two underlying bug *concepts*, in narrower corners
that the batch-#1 fix's specific pattern wording did not reach:

1. **The actor/relationship guard for single-vehicle-infrastructure contact
   covered vehicle-type actors only, not non-vehicle actors.** A pedestrian
   pushing a line of shopping carts into the AV's path, with "curb" mentioned
   only as an incidental location descriptor, reproduced the exact false
   `automation-system-contributed` claim the batch-#1 fix was built to
   prevent — just with a person instead of a vehicle as the competing actor.
   **Fixed**: the negative guard now also matches a person-type actor
   (pedestrian/individual/cyclist/bicyclist) described as actively producing
   or moving an object (pushing/carrying/moving/dragging/holding/walking
   with) — a second, independent actor/relationship signal alongside the
   existing vehicle-contact signal, not a "shopping cart" special case.
2. **The subject-occupant-action pattern matched only the one exact phrasing
   seen in batch #1** ("passenger ... opened the [rear/front] [left/right]
   door"). A batch-#2 case used the natural variant "a passenger in the
   Waymo AV **then** opened the rear **driver side** door" — an adverb before
   the verb, and a side/position descriptor between "rear" and "door" — which
   the exact-phrase pattern did not match, so the occupant-action evidence
   was missed and the movement-based rule incorrectly attributed the contact
   to the other party. **Fixed**: both occupant-action patterns now tolerate
   a short (non-sentence-crossing) gap in those two positions, rather than
   requiring an exact contiguous phrase.

Both fixes are scoped narrowly to what these two regression cases actually
demonstrated (widening an existing gap tolerance; adding one independent
actor-type check) — not a general expansion of pattern coverage. Several
other batch-#2 observations were deliberately **left unfixed** and are
recorded here rather than chased immediately:

- Automation engagement/disengagement narrative phrasing has more natural
  variants than the current patterns cover (e.g. "took the vehicle out of
  autonomy", "the driver disengaged the ADS") — always fails safely to
  `automation_status = unknown` rather than asserting a wrong value, but is
  imprecise. Not fixed this round.
- The "AV not physically struck, adjacent to a collision" case-#14-shape
  pattern has phrasing variants ("adjacent to a collision") not yet
  recognized — falls safely to `undetermined`. Not fixed this round.
- Debris/object-strike events (a basketball, previously a hay bale and a
  utility cable) have no clean `event_type` home and default to `collision`
  — a stable, low-severity, known ambiguity. Not fixed this round.
- Lane-crossing/lane-change phrasing has more variants than
  `OTHER_PARTY_LANE_INTRUSION_PATTERNS` covers. Not fixed this round.
- Report-to-report disagreement handling remains completely untested
  out-of-sample: zero of the 60 combined batch-#1/batch-#2 candidates carried
  a substantive disagreement. A future targeted test should deliberately
  include disagreement cases rather than rely on further random sampling.

Regression after the two fixes: all 15 calibration cases, the frozen batch-#1
30, and the frozen batch-#2 30 were re-run — zero hard-validation violations
across all 75, no previously-clean case regressed, and both corrected cases
(the pedestrian/shopping-cart case and the "driver side door" case) now
produce a conservative `undetermined` rather than an unsupported claim.

### Architectural note: pattern rules are guardrails, not an open-ended interpretation engine

Two out-of-sample pilots in a row surfaced real generalization gaps whose
root cause is the same each time: a deterministic lexical/pattern rule,
built and verified against the phrasing of the cases known at the time,
does not automatically cover every natural way the same underlying concept
can be phrased. Widening gap tolerances and adding independent
actor-relationship signals (as done above) is a legitimate, bounded
response when a specific regression case demonstrates a specific gap. It is
not, however, a strategy that converges: chasing every remaining phrasing
variant (automation engagement/disengagement language, infrastructure/object
synonyms, debris event types, "adjacent to a collision" wording, lane-change
phrasing) by enumeration would turn the evidence extractor into an
ever-growing collection of brittle lexical patches, with no principled
stopping point and a growing risk that a new patch narrows or interacts
badly with an existing one.

Deterministic pattern rules remain the right tool for **high-confidence,
recurring structural signals** — a fixed reporting-template phrase, a
structured field lookup, a small closed vocabulary. They are the wrong tool
for **open-ended semantic interpretation** of freeform narrative prose,
which is what several of the remaining gaps above actually require. The
evidence from these two unseen pilots — which specific concepts
generalized cleanly (topic-scoped hedges, lane-intrusion, traffic
violations) versus which needed narrow follow-up patches versus which
remain open — is exactly the input needed to decide where a future
structured AI/LLM extraction or classification stage (the long-term design
in `docs/discovery-pipeline.md`) should replace pattern enumeration, rather
than extending it further. **No AI provider is chosen or integrated by this
document or this pilot** — this is a scoping note for a future, separately
approved decision, not an implementation.

## Open questions (not blocking, tracked for a future decision)

1. Causation vocabulary has no category for "subject vehicle's own human
   driver, automation off, initiated the contact" distinct from
   `automation-system-contributed` / `other-party-contributed` — currently
   defaults to `undetermined` per explicit policy above.
2. Alias-table seeding is currently empty of pre-approved entries beyond the
   general punctuation-fold rule; genuine legal-entity variants (e.g.
   "Motional" vs. "Motional AD Inc.") need a deliberate, separately-reviewed
   decision before any normalization, not an algorithm.
3. `scenario_tags` vocabulary remains emergent, not fixed — the pilot's tag
   set covers only patterns observed in the calibration and first
   development batches, not the full corpus.
4. `automation_status` cannot represent a within-event handoff (engaged
   earlier, human/teleoperator in control at the moment of contact) as a
   single snapshot value — see "Automation engagement vs. automation
   contribution" above. Not resolved by a schema change in this task;
   flagged for a future decision if this pattern turns out to be common at
   scale.
5. Several narrative-phrasing gaps identified in the second out-of-sample
   batch were deliberately left unfixed rather than chased by further
   pattern enumeration — see "Second out-of-sample batch" above and the
   architectural note on pattern rules as guardrails. These are candidate
   inputs to a future AI/LLM extraction-stage decision, not open bugs to
   patch indefinitely.
6. Disagreement handling (cosmetic resolution, `unknowns` preservation) has
   not been exercised by either out-of-sample batch — zero of 60 combined
   candidates carried a substantive report-to-report disagreement. A future
   targeted test should deliberately include disagreement cases.

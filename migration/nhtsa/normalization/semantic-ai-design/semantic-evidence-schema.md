# Semantic Evidence Schema

Design only — no field below is implemented. Every field name here is provisional and would be
finalized only once a real provider's output is inspected against the guardrails in
`deterministic-guardrails.md`.

## Design principle

Every semantic proposition is a **grounded claim about what a specific source report says**, not a
free-floating fact and not a classification. The schema is deliberately closed: every `value` comes
from a small, per-category enum fixed in this document, never open free text. If the true answer
isn't one of the enum members, the correct output is `supportStatus: "unknown"` and `value: null` —
never a new, invented label. This mirrors the existing deterministic architecture's own discipline
(`alias-table.mjs`'s comment: "never invent a canonical value") extended to the semantic layer.

## Starting from 15 candidate fields, collapsed to the smallest schema that covers the demonstrated gaps

The task's 15 candidate fields were reviewed against `scale-up-eval/observations.md`'s 11 findings.
Four of them (1–4: engagement at the event moment, engagement earlier, control transitions, actor
controlling the vehicle) are really one underlying structure — **an ordered timeline of who was
controlling the vehicle and whether automation was engaged, anchored to coarse temporal markers
relative to the contact**. Splitting them into four separate propositions would force the same
narrative sentence to be re-extracted four times and would make chronology (finding D:
engaged→disengaged→re-engaged; finding J: post- vs. pre-contact takeover) *harder* to check, not
easier, since consistency across four separate fields would itself need reconciling. They are
collapsed into one `control_timeline` evidence type below. Field 15 (cross-report semantic
disagreement) is not a separate extraction at all — it is a *derived comparison* across the other
categories' per-report items (see "Cross-report disagreement" below), not something the model
proposes directly. Everything else (5–14) maps to one evidence type each. Net: **10 evidence
types**, not 15.

## Common envelope

Every semantic evidence item, regardless of type, has this shape:

```
SemanticEvidenceItem {
  itemId:            string          // stable within one interpretation run, e.g. "sem-003"
  type:               EvidenceType    // one of the 10 types below
  supportStatus:      "supported" | "unsupported" | "conflicting" | "unknown"
  value:              <closed enum for `type`> | null   // null unless supportStatus == "supported" or "conflicting"
  conflictingValues:  [{ value: <enum>, reportId: string, span: Span }] | null  // populated only when supportStatus == "conflicting"; >=2 entries from >=2 distinct reportIds
  citations:          Span[]         // required, non-empty, when supportStatus is "supported" or "conflicting"
  confidence:         "high" | "medium" | "low" | null   // see caveat below — advisory only, never load-bearing
  explanation:        string | null  // short (<= 240 chars); required when supportStatus == "unsupported" or "unknown" AND the field was a plausible candidate (i.e., the model considered and rejected it) — omitted when the category simply doesn't apply
}

Span {
  reportId: string     // must be one of the candidate's actual contributing report IDs
  quote:    string     // a verbatim (or redaction-preserving) substring of that report's narrative
}
```

**Confidence caveat**: `confidence` is explicitly advisory, never used by any guardrail or
downstream classification rule as a threshold. Self-reported LLM confidence is not a calibrated
probability and must not be treated as one (see `open-questions.md`). Its only sanctioned use is as
a tie-break hint for human reviewers scanning many items.

## The 10 evidence types

### 1. `control_timeline` (collapses candidate fields 1–4)
An ORDERED list of control-state entries, not a single value:
```
value: [
  { actor: "automation" | "human-operator-onboard" | "remote-teleoperator" | "unknown",
    engagementState: "engaged" | "not-engaged" | "attempted-and-failed" | "not-stated",
    anchor: "sequence-start" | "before-contact" | "at-contact" | "after-contact" | "unordered" }
  , ...
]
```
`anchor` is a coarse, source-grounded ordering marker (never a timestamp unless the source gives
one) — it is exactly the mechanism that lets a downstream consumer check "was a human in control
`before-contact`" (finding J, post- vs. pre-contact takeover) or "does the timeline show
`engaged` then `not-engaged` then `engaged` again" (finding D) without the schema needing bespoke
fields for each scenario. Each entry independently carries its own citation.

### 2. `contact_occurrence`
```
value: "contact-occurred" | "no-contact" | "disputed"
```
Directly targets findings B (explicit no-contact language) — this is the evidence type a downstream
rule uses to catch `event_type=collision` co-occurring with `no-contact` (see
`deterministic-guardrails.md`).

### 3. `contact_mechanism`
```
value: "rear-end" | "lane-intrusion" | "infrastructure-contact" | "occupant-action-own-vehicle" |
       "occupant-action-other-vehicle" | "multi-contact-chain" | "other-described" | "not-described"
```
`occupant-action-own-vehicle` vs. `-other-vehicle` directly targets finding 6 (the deterministic
occupant-door pattern's actor-misattribution) — the schema forces the model to commit to *whose*
vehicle, not just that a door-opening occurred. `multi-contact-chain` directly targets finding A
(chain-reaction/multi-vehicle causation) as a distinguishable value rather than silently defaulting
to whichever single contact a deterministic pattern happens to match.

### 4. `actor_relationship`
Per distinct actor mentioned (list, not singleton):
```
value: [{ role: "external-vehicle" | "external-vru" | "own-vehicle-occupant" |
                "other-vehicle-occupant" | "environmental-object" | "animal" | "emergency-vehicle",
          describedAction: string (<=120 chars, quoted-or-closely-paraphrased, not free interpretation) }]
```
This is the one place a short descriptive string is allowed, and it is deliberately constrained to
restating what the source says a given actor did, not why, not with what intent, and not whether
they were at fault.

### 5. `traffic_rule_infrastructure_context`
```
value: { violationDescribed: boolean,
         violationType: "red-light" | "stop-sign" | "wrong-way" | "lane-line" | "other-traffic-control" | null,
         infrastructureInvolved: boolean }
```
Directly targets finding F (traffic-rule violations in varied wording, explicitly including stop
signs, which the deterministic pattern has zero coverage for).

### 6. `subject_vehicle_action` / 7. `other_actor_action`
Same shape, two instances:
```
value: "braked" | "swerved-or-maneuvered" | "stopped" | "proceeded" | "reversed" |
       "accelerated" | "none-described"
```
Deliberately a small closed taxonomy of physical actions only — no judgment words ("failed to
yield," "recklessly") are permitted values.

### 8. `causal_contribution_evidence`
The highest-risk type (see `output-contract.md` Part D and `classification-interface` guidance).
```
value: "automation-contributed" | "other-party-contributed" | "subject-human-driver-contributed" |
       "shared-or-multiple-factors" | "environmental-hazard" | "undetermined"
```
**Hard rule, enforced by a guardrail, not by prompt wording alone**: an item of this type with
`value: "automation-contributed"` must cite evidence *of contribution* (e.g., a described automated
maneuver, or a root-cause disclosure item — see type 9) — it may NOT be derived solely from a
`control_timeline` entry showing `engaged`. Engagement and contribution are different types for
exactly this reason; see `architecture.md` and `deterministic-guardrails.md` invariant 8.

### 9. `root_cause_disclosure`
```
value: "software-defect-disclosed" | "hardware-failure-disclosed" | "procedural-failure-disclosed" | "none-disclosed"
```
Targets findings G and H directly (May Mobility lidar-latency; Beep/Navya controller failure). This
is deliberately scoped to *disclosure* — did the source itself say this — never to the model's own
diagnosis of what went wrong.

### 10. `successful_avoidance_evidence`
```
value: "full-stop-then-contact" | "in-motion-avoidance" | "completed-avoidance-no-contact" | "not-applicable"
```
`in-motion-avoidance` directly targets finding 3 (Ghost Autonomy — successful deceleration that
avoids the front hazard without reaching a full stop, current pattern requires a full stop).
`completed-avoidance-no-contact` is the natural evidentiary basis for `contact_occurrence:
no-contact` plus a positive, not merely absent, valence signal.

### Hedge/uncertainty — folded into `supportStatus`/`explanation`, not a separate type
Candidate field 14 (uncertainty/hedging) is not a distinct evidence type: every existing hedge
concept (mechanism doubt, injury-only hedge, administrative boilerplate, "reportedly") is already
exactly what `supportStatus: "unsupported"` plus a short `explanation` exists to represent. Adding a
14th, separate "hedge" type would just duplicate that mechanism under a different name.

### Cross-report disagreement — a derived comparison, not a model output
Candidate field 15 is computed by the evaluation harness (or, eventually, a deterministic
post-processing step), not asserted by the model: for any evidence type where two or more
contributing reports independently produce items with different `value`s, the pair is flagged as
`conflicting` mechanically, exactly as `supportStatus: "conflicting"` already models it. This keeps
"is this a genuine cross-report conflict" a deterministic, auditable computation rather than
something the model could get wrong by asserting or missing it — directly targets finding K.

## Worked (synthetic, non-benchmark) example

Given a synthetic narrative sentence *"The safety driver assumed control after the truck came to a
stop; no contact was made with the debris."* — deliberately not drawn from the 96-case benchmark, to
avoid contaminating later evaluation (see `provider-neutral-prompt.md` and `open-questions.md`):

```json
{
  "itemId": "sem-001",
  "type": "control_timeline",
  "supportStatus": "supported",
  "value": [{ "actor": "human-operator-onboard", "engagementState": "not-engaged",
              "anchor": "after-contact", "reportId": "R1" }],
  "citations": [{ "reportId": "R1", "quote": "the safety driver assumed control after the truck came to a stop" }],
  "confidence": "high",
  "explanation": null
},
{
  "itemId": "sem-002",
  "type": "contact_occurrence",
  "supportStatus": "supported",
  "value": "no-contact",
  "citations": [{ "reportId": "R1", "quote": "no contact was made with the debris" }],
  "confidence": "high",
  "explanation": null
}
```
Note the takeover is explicitly anchored `after-contact` — this is the exact shape that lets a
guardrail (Part 6) distinguish this from a *pre-contact* handoff, which is the specific ambiguity
`evidence.mjs`'s `HUMAN_TOOK_CONTROL_BEFORE_CONTACT_PATTERNS` was found (in the round-2 hardening
review) to conflate.

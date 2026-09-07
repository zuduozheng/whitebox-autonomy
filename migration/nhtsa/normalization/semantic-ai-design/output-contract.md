# Semantic AI Output Contract

Design only. Defines the strict machine-readable shape any provider's output must conform to
before it is allowed anywhere near the rest of the pipeline (even in shadow mode, malformed output
is discarded, not repaired or reinterpreted).

## The four tiers, and where this contract sits

| Tier | Who asserts it | Governed by |
|---|---|---|
| A. SOURCE EVIDENCE | The NHTSA report itself (raw text/fields) | Nothing — it is the ground truth input |
| B. DERIVED FACT | Deterministic rules (`evidence.mjs`) | Existing, unchanged code |
| **C. SEMANTIC INTERPRETATION** | **The semantic provider** | **This document** |
| D. ONTOLOGY CLASSIFICATION | `classify.mjs` | Existing, unchanged code (this phase); `classification-interface` rules in `output-contract.md` §5 for a *later* phase |

This contract governs tier C only. A tier-C item is a claim about what tier-A evidence supports —
it must always resolve to exactly one of four support states, and it must never itself be, or be
mistaken for, a tier-D classification. The model is never asked for `event_type`, `valence`,
`automation_status`, or `causation_status` — see `architecture.md`'s "Why atoms, not
classifications."

## §1 — The four support states (mandatory, exhaustive, mutually exclusive)

```
supportStatus: "supported" | "unsupported" | "conflicting" | "unknown"
```

- **supported** — the evidence type applies, a single value is well-grounded in one or more
  citations that agree, no contributing report contradicts it.
- **unsupported** — the evidence type was considered, no report contains grounding for any value in
  its enum — this is a valid, expected, common answer, not a failure.
- **conflicting** — two or more contributing reports independently support different values;
  `conflictingValues` must be populated with >=2 entries from >=2 distinct report IDs; top-level
  `value` stays `null`.
- **unknown** — insufficient evidence to tell whether the type even applies (distinct from
  `unsupported`: `unsupported` means "I looked, and no report says this"; `unknown` means "I cannot
  tell from what's given whether this even applies" — e.g., a report is truncated or too heavily
  redacted to know). Providers unable to make this distinction reliably may collapse `unknown` into
  `unsupported`; the contract keeps them separate so a future evaluation can measure whether a
  given provider draws a meaningful line between the two.

**The model must never be forced to choose a value when evidence does not support one.** There is
no default, no "best guess," and no schema-required non-null value anywhere in this contract. A
response consisting entirely of `unsupported`/`unknown` items is a valid, complete response.

## §2 — Structural requirements (checked mechanically, before any semantic use)

1. Response is a single JSON object: `{ candidateId, providerMeta, items: SemanticEvidenceItem[] }`.
2. `providerMeta = { provider: string, model: string, promptVersion: string, ranAt: ISO8601 }` —
   every item is attributable to exactly one provider/model/prompt version for later comparison
   across providers (see `provider-abstraction.md`).
3. Every `items[i].type` is one of the 10 types in `semantic-evidence-schema.md` — no other type
   name is accepted.
4. Every `items[i].value` (when non-null) is a member of that type's closed enum — free text in an
   enum position is a contract violation, not a value to coerce.
5. `citations` is non-empty whenever `supportStatus` is `supported` or `conflicting`, empty or
   absent otherwise.
6. Every `citations[j].reportId` must equal one of the report IDs actually given to the model for
   this candidate (checked against the same `contributingReports` list `evidence.mjs` already
   builds) — a citation to a report ID that does not exist for this candidate is a contract
   violation.
7. Every `citations[j].quote` must be found, as a substring (redaction placeholders like `[XXX]`
   compared literally, not filled in), inside that specific report's narrative text — not merely
   inside *some* report's text.
8. At most one item per `type` per response may have `supportStatus: "supported"` OR
   `"conflicting"` for `control_timeline`'s single-actor-at-a-time invariant does not apply the same
   way as scalar types — `control_timeline`'s `value` is itself an ordered list and is exempt from
   the "at most one" cardinality rule; every other type follows it. This prevents an implicit way to
   smuggle in multiple competing "confident" answers for one scalar field without going through the
   explicit `conflicting` state.
9. No item may reference a fifth "field" beyond the 10 defined types (no ad hoc extension fields).

A response failing any of 1–9 is treated as **fully unsupported for the affected item(s)** by a
mechanical backstop — never repaired, retried with a "fix your JSON" follow-up, or partially
trusted. See `deterministic-guardrails.md` invariant 12.

## §3 — What the model is explicitly forbidden from doing

- Assign fault, blame, or legal responsibility in any `explanation` field (see
  `provider-neutral-prompt.md`).
- Infer a value from outside knowledge of the developer, vehicle, or a real-world incident it may
  recognize from training data — every item must be traceable only to the report text given in this
  call.
- Treat "X happened, then Y happened" as evidence for `causal_contribution_evidence` by itself —
  temporal sequence is not causation (explicitly required framing in `provider-neutral-prompt.md`);
  a `causal_contribution_evidence` item must cite language that itself describes a causal or
  contributory relationship, not merely restate the `control_timeline`/action items' ordering.
- Silently pick one side of a cross-report disagreement — any type where reports disagree must
  produce `supportStatus: "conflicting"`, never a single confidently-supported value that happens to
  match one report.
- Propose `location_precision` or any geography value at all — this evidence type does not exist in
  the schema; there is nothing for the model to fill in even if asked.

## §4 — Minimal response shape (illustrative, not exhaustive — see `semantic-evidence-schema.md` for full enums)

```json
{
  "candidateId": "…",
  "providerMeta": { "provider": "…", "model": "…", "promptVersion": "v0", "ranAt": "…" },
  "items": [
    { "itemId": "sem-001", "type": "contact_occurrence", "supportStatus": "unknown",
      "value": null, "citations": [], "confidence": null,
      "explanation": "Only report is a duplicate-filing notice with no narrative of the event itself." }
  ]
}
```

## §5 — How tier-C output may (eventually, not in this phase) reach tier D

Not built in this design phase — recorded here so the contract's boundary with
`classify.mjs` is explicit rather than assumed. A later phase would:
1. Convert accepted (guardrail-passed) tier-C items into SEMANTIC-tier atoms, using the exact same
   `atom({ tier, field, value, sourceType, sourcePointer, text })` shape `evidence.mjs` already uses
   for EVIDENCE/DERIVED atoms — no parallel atom format.
2. Hand the combined EVIDENCE + DERIVED + SEMANTIC atom list to `classify.mjs` only for the fields
   explicitly enabled per the classification interface below — most fields, especially
   `causation_status`, would remain deterministic-only until shadow-mode evidence justifies
   otherwise.
3. Run every existing `validate.mjs` rule plus the new guardrails in `deterministic-guardrails.md`
   before anything reaches a curator queue.
No part of step 1–3 is implemented by this design task.

## §6 — The classification interface: which ontology fields may ever consume tier-C evidence

This is the direct answer to "design how semantic evidence would feed the existing WBA ontology."
It is a *permission table*, not a mechanism — even a field marked "may use semantic evidence" only
does so through the atom+`classify.mjs`+`validate.mjs` path in §5, gated by the guardrails in
`deterministic-guardrails.md`, and only in a later phase, never in this shadow-mode design.

| Field | Status | Rationale |
|---|---|---|
| `location_precision` | **Stays fully deterministic. No semantic evidence type exists for it at all** (see `semantic-evidence-schema.md`). | Geography must be exactly as precise as the structured source data supports — the scale-up found 0 false-precision cases across 150 candidates specifically because this is deterministic; an LLM has no way to *know* a redacted street address is more precise than "city," only to guess, which is the one failure mode this field cannot tolerate. |
| `automation_status` | **May use semantic evidence, narrowly**: only the `control_timeline` type, and only to fill a gap where deterministic `ENGAGED_PATTERNS`/`NOT_ENGAGED_PATTERNS` found nothing (i.e., additive when deterministic is silent, never overriding a deterministic result that already fired). This is the field the scale-up's finding 4 (vocabulary generalization) most directly targets, and it is a state-at-a-moment question a `control_timeline` entry answers directly. | Still requires: the guardrail that a `control_timeline` entry alone can never, by itself, produce a `causal_contribution_evidence` inference (engagement ≠ contribution, enforced structurally, not just by convention — see `deterministic-guardrails.md` invariant 8). |
| `event_type` | **May use semantic evidence for exactly one narrow purpose**: `contact_occurrence: no-contact` (supported) blocking the generic collision default (finding B) and routing toward `near-miss-or-safety-critical` or a curator flag instead. **No other semantic evidence type may influence `event_type`.** | `event_type` mostly reflects the *kind* of counterpart/scenario, which the deterministic structured `crash_interaction_counterpart` field already names reliably (VRU, animal, first-responder) — the one confirmed gap (no-contact) is narrow and worth closing; broader semantic-driven event-type changes are not justified by the scale-up evidence. |
| `valence` | **May use semantic evidence for exactly one narrow purpose, mirrored from finding 3**: `successful_avoidance_evidence: in-motion-avoidance` (supported) extending the existing `successful-handling` trigger beyond "reached a full stop." Nothing else. | Same reasoning as `event_type` — one confirmed, narrow, well-evidenced gap, not a general license to let the model characterize outcomes. |
| **`causation_status`** | **Requires curator/policy review before ANY semantic evidence is allowed to influence it, even in a later phase.** In shadow mode (this phase), semantic evidence about causation is compared against human review but never proposed to a live draft under any circumstance. | This is the field the scale-up identified as highest-risk (findings 1, 6, 7, 9, 10 all concern it), the field with the confirmed misattribution case (the cat/pileup), and the field where "engagement ≠ contribution" is easiest to blur. Even `causal_contribution_evidence: automation-contributed` items that pass every guardrail should land as an explicit **flag for curator attention**, not an automatic classification change — see `curator-boundary.md`. |

**Automation engagement at impact and automation contribution remain separate concepts across this
entire table**: `control_timeline` (engagement/who's driving, a state question) never, by itself,
satisfies the evidentiary bar for `causal_contribution_evidence` (a causal-role question) — this is
enforced as a citation-independence rule (§3, `deterministic-guardrails.md` invariant 8), not left
to prompt wording alone, precisely because the round-2 hardening pass already showed a
deterministic version of this exact conflation was possible even with careful, reviewed code.

### §6.1 — Semantic causal evidence is not the same thing as a causation classification

The `causation_status` row above gates a *classification value*. It does not, and must not be read
to, prohibit the semantic layer from extracting evidence-grounded propositions that bear on
causation — those are a different, permitted thing, provided they stay propositions rather than
becoming a verdict. Concretely, the semantic layer **may** propose items such as:

- the report explicitly attributes a behavior to a software defect (`root_cause_disclosure:
  software-defect-disclosed`);
- a human override occurred before the collision-producing action (`control_timeline` entry with
  `actor: human`/`teleoperator`, `anchor: before-contact`);
- an initial impact was followed by one or more subsequent contacts (`contact_mechanism:
  multi-contact-chain`);
- the source explicitly attributes a system behavior to hardware failure (`root_cause_disclosure:
  hardware-failure-disclosed`).

Each such item retains its own `supportStatus`, citation, and (advisory) confidence, exactly like
any other evidence type — it is evaluated, stored, and compared against human review the same way.
What it may **never** do, in this phase or any later one without a separate curator/policy decision,
is automatically resolve into a non-`undetermined` `causation_status` value. The permission-table row
above already forbids semantic evidence from *reaching* `causation_status` through the `classify.mjs`
path; this subsection exists so that prohibition is not misread as also forbidding the *extraction*
of the underlying evidence. Extraction is encouraged (it is exactly what
`benchmark-plan.md`'s Part 4 capabilities G, H, I, J, K test); auto-conversion to a final causation
verdict is what remains categorically off-limits. The only place a proposition like the four above
can lead is a **curator flag** (`curator-boundary.md` condition 2), never a written classification.

# Semantic-AI Shadow-Mode Evaluation — Architecture

Design only. No provider integrated, no API called, no existing implementation file touched.
Checkpoints referenced: deterministic hardening baseline `7e3a607`, limited scale-up evidence
`aa0d3f6`.

## DESIGN REVIEW SUMMARY (read this first)

- **Proposed semantic-layer responsibility**: propose additional, evidence-grounded *atoms*
  (SEMANTIC tier) alongside the existing EVIDENCE/DERIVED atoms — never propose a final
  classification, never write a WBA event, never run outside shadow mode in this phase.
- **What stays deterministic**: mechanical consolidation, structured-field disagreement detection,
  source-record inconsistency, `location_precision`, all existing regex-based EVIDENCE/DERIVED
  extraction (unchanged, kept as a parallel, always-on signal), the final assembly of
  `classification` from atoms, and every existing validation rule.
- **What moves to semantic interpretation**: recognizing evidence *the deterministic patterns
  cannot phrase-match* — engagement/control chronology under arbitrary phrasing, explicit
  no-contact language, multi-actor/chain-reaction structure, self-disclosed root-cause narratives,
  actor-relationship disambiguation (whose occupant, whose lane) — always as additional atoms, not
  replacement classifications.
- **What remains curator/policy territory**: every open ontology question the scale-up already
  surfaced (own-passenger-as-VRU, causation vocabulary for VRU strikes, whether
  `shared-or-multiple-factors` gets a real trigger, environmental-hazard causation) — semantic
  evidence makes these cases *visible with better grounding*, it does not resolve them.
- **Main risks**: (1) false certainty — an LLM confidently resolving something the deterministic
  layer correctly left unknown; (2) prompt/benchmark leakage — tuning against the same 96 cases used
  to score it; (3) provider-specific quirks masquerading as "semantic capability"; (4) scope creep
  from evidence-proposer into classifier.
- **Unresolved decisions**: see `open-questions.md` — provider choice, confidence-field
  meaningfulness, redaction-placeholder handling, data-governance sign-off for sending NHTSA text to
  a third party, long-term coexistence of deterministic patterns after semantic evidence proves
  reliable.
- **Recommended smallest first experiment** *(revised per independent design review — supersedes the
  original "40 clean-case controls alone" recommendation)*: run one provider, shadow-mode only,
  against a **40-case pilot drawn from the existing 96-case benchmark**: 20 challenge cases from the
  56-case review-queue plus 20 clean controls from the 40-case clean sample. The pilot must test
  **semantic recovery and semantic regression simultaneously** — the challenge cases probe whether
  semantic evidence recovers what the deterministic patterns cannot phrase-match, while the clean
  controls are negative controls confirming semantic interpretation does not introduce new,
  unsupported claims on cases the deterministic pipeline already handled correctly. In this first
  experiment the two evidence mechanisms run **side by side, never in place of one another**:
  existing deterministic EVIDENCE/DERIVED atoms (`evidence.mjs`, unchanged) plus semantic-AI proposed
  SEMANTIC-tier atoms, kept separately provenance-labelled at all times (`providerMeta`,
  `output-contract.md` §2.2) so agreement, addition, contradiction, omission, and unsupported
  additions can each be evaluated on their own terms. See `benchmark-plan.md` Part 5 for the exact
  40 candidate IDs and selection rule, and `evaluation-metrics.md`.

## Pipeline (target, this design's place in it)

```
raw NHTSA reports (2 fixed CSVs, unchanged)
        v
mechanical consolidation           [mapping.mjs — unchanged]
        v
deterministic evidence extraction  [evidence.mjs — unchanged; tiers EVIDENCE, DERIVED]
        v
   +---------------------------+
   | semantic evidence         |   <-- THIS DESIGN. New tier: SEMANTIC.
   | interpretation (shadow)   |       Reads candidate + reports (same input evidence.mjs gets).
   +---------------------------+       Writes ONLY to a separate shadow-output file in this phase.
        v (design intent for a LATER phase, not built now)
deterministic classification       [classify.mjs — unchanged in this phase; a later phase would
                                     extend it to also read SEMANTIC-tier atoms, gated per
                                     classification-interface.md's per-field rules]
        v
deterministic validation /         [validate.mjs — unchanged in this phase; a later phase adds
contradiction checks                new guardrail rules, see deterministic-guardrails.md]
        v
private draft
        v
curator-controlled publication
```

In **this** phase (shadow mode), the semantic layer is a side-branch: it consumes the same
`{candidate, reports}` input the existing pipeline already freezes into fixtures, produces a
`SemanticEvidenceBundle` (see `semantic-evidence-schema.md`), and that bundle is compared offline
against (a) the deterministic-only result and (b) the existing human review recorded in
`scale-up-eval/observations.md`, `review-material-queue.md`, and `review-material-clean-sample.md`.
Nothing produced by the semantic layer reaches `classify.mjs`, `validate.mjs`, or any curator queue
in this phase — there is no "shadow write path" into the real system at all yet, only an
evaluation harness that runs alongside it.

## Why atoms, not classifications

The existing architecture already has exactly the right seam for this: `evidence.mjs` produces a
flat, typed atom list; `classify.mjs` is a pure function from atoms to classifications; `classify.mjs`
never reads raw narrative text itself (`classify.mjs`'s own header comment states this as an
enforced boundary). A semantic layer that also just produces atoms — tagged with a new tier so
they're always distinguishable from regex-derived ones — fits this seam exactly, and inherits every
existing guarantee for free: `classify.mjs` still can't be fooled into reading text it wasn't
handed as evidence, `validate.mjs` still runs as the last deterministic gate, and nothing about the
existing deterministic path changes if the semantic layer is disabled, errors, or is not yet
trusted for a given field.

This is also why the design explicitly rejects the alternative of having the model output
`event_type`/`valence`/`automation_status`/`causation_status` directly: that would bypass the one
seam that has, so far, kept every classification in this project traceable to a specific evidence
atom with a specific source pointer. See `classification-interface` guidance in
`output-contract.md` Part D and `deterministic-guardrails.md`.

## Provenance tiers (extends the existing EVIDENCE/DERIVED/CLASSIFICATION/UNSUPPORTED scheme)

| Tier | Produced by | Reads | Example |
|---|---|---|---|
| EVIDENCE | `evidence.mjs` (unchanged) | raw report fields/narrative | `automation_engagement_narrative = engaged, "Level 4 ADS was engaged"` |
| DERIVED | `evidence.mjs` (unchanged) | other atoms, deterministic rules | `location_precision = city` |
| **SEMANTIC** (new) | semantic layer (this design) | raw report fields/narrative, SAME input as EVIDENCE | `control_timeline: [{actor: automation, anchor: before-contact}, {actor: human-operator, anchor: at-contact}], supportStatus: supported, reportId: ..., span: "..."` |
| CLASSIFICATION | `classify.mjs` (unchanged this phase) | EVIDENCE + DERIVED (+ later, gated, SEMANTIC) | `causation_status = other-party-contributed` |
| UNSUPPORTED | `classify.mjs` (unchanged) | absence of qualifying atoms | `scenario_tags = null` |

A SEMANTIC atom is evidentially the same *kind* of thing as an EVIDENCE atom (grounded in source
text, carries a source pointer) — it is tiered separately only so that every downstream consumer,
every test, and every curator view can always tell "a deterministic pattern found this" from "a
model proposed this," permanently, even after (if ever) a field is allowed to consume SEMANTIC
atoms in classification.

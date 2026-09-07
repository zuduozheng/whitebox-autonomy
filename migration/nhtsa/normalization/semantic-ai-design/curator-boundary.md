# Human Review / Curator Boundary

Design only. Defines the *rules* a future non-shadow integration would use to route semantic
proposals to curator review — not built, not wired to any actual curator queue. In this design
phase (shadow mode), no proposal is routed anywhere; the same conditions below are instead used as
the basis for how a human evaluator reads the comparison output described in
`evaluation-metrics.md`.

## The governing principle (stated once, applies to every rule below)

**The curator's role is to verify that a record faithfully represents the source evidence and its
uncertainty — not to determine unknowable ground truth.** A routing rule that implicitly asks a
curator "was the AV really at fault here?" is the wrong kind of rule; a routing rule that asks
"does this record correctly show that the sources disagree, or correctly show that we don't know?"
is the right kind. Every condition below is phrased to ask the second kind of question.

## Conditions that route a semantic proposal to curator review

1. **Source-report semantic conflict.** Any evidence type where two or more contributing reports
   produce genuinely different values (`supportStatus: conflicting`) — the curator's job is to
   confirm the record shows both sides, not to pick one.
2. **Any non-`undetermined` causation proposal at all.** Per `output-contract.md` §6,
   `causation_status` does not consume semantic evidence automatically in this phase or the next —
   *any* `causal_contribution_evidence` item that is `supported` and non-generic is a mandatory
   curator flag, regardless of how confident or well-cited it looks. This is deliberately more
   conservative than any other field's routing rule, because causation is the field the scale-up
   evaluation identified as highest-risk.
3. **Low-confidence or ambiguous actor chronology.** Any `control_timeline` with an `anchor` of
   `"unordered"`, or with entries from different reports that disagree on ordering — the curator's
   job is to confirm the record does not assert a specific pre-/post-contact sequence the sources
   don't actually establish (this is precisely the failure mode `deterministic-guardrails.md` G7 is
   designed to prevent from ever reaching a curator un-flagged in the first place).
4. **Ontology/policy ambiguity already on record.** Any case whose semantic evidence lands in a
   category `scale-up-eval/observations.md` already identifies as an open ontology question — the
   "subject vehicle's own human driver" gap (finding 10), environmental-hazard causation
   (finding 9), or the unreachable `shared-or-multiple-factors` value (finding 1/12) — routes to
   curator/rulebook attention explicitly labeled as a **known open policy question**, not as a case
   needing a one-off individual judgment call. The curator should never be asked to silently
   improvise a new de facto policy one case at a time.
5. **The own-passenger/VRU issue specifically.** Per the round-2 hardening pass's explicit
   instruction, this ontology question was deliberately left unresolved and must stay visible as
   such — any semantic evidence touching a case shaped like `9b6219cb373795e`/`9fc806cd1d491d5`
   (an occupant injured exiting through a self-opened door, currently filed as
   `vulnerable-road-user-interaction`) routes to curator review with an explicit note that this is
   the known, still-open question, not a new finding to re-litigate each time.
6. **Multiple plausible physical-event interpretations.** Any case where `contact_mechanism:
   multi-contact-chain` is supported, or where a `sourceRecordInconsistency` flag (existing
   deterministic mechanism) co-occurs with semantic evidence — the curator's job is to confirm the
   record preserves the possibility of more than one physical event or more than one causal
   contributor, exactly as the existing deterministic source-record-inconsistency wording already
   requires ("without determining which description is correct or whether the source grouping
   represents one or multiple physical events").
7. **Semantic/deterministic contradiction.** Any case where a guardrail in
   `deterministic-guardrails.md` actually fires (G5–G10) — by definition, these represent the
   semantic layer and the deterministic layer disagreeing, or the semantic layer attempting
   something the guardrails were built to prevent. These should never be silently dropped even
   though the guardrail already prevented harm — a repeatedly-firing guardrail on a given provider
   is itself information (about that provider, or about a genuine edge case the guardrail's design
   didn't anticipate) that a curator or maintainer should see, not just a discarded item.
8. **Explicit "no contact" evidence.** Per `deterministic-guardrails.md` G6, this always routes to
   curator attention regardless of what `event_type` currently shows — the curator confirms whether
   the record should describe a near-miss/no-contact event rather than a collision.

## What does NOT route to curator review

To keep this boundary meaningful rather than routing everything, the following stay purely
evaluation-internal (never a live routing condition, in this shadow-mode phase or any later one):

- Any `unsupported`/`unknown` item where the deterministic result already independently reached the
  same conservative answer — no new information, no new flag.
- Low `confidence` scores alone (per `semantic-evidence-schema.md`'s caveat, self-reported
  confidence is advisory only and must never itself trigger or suppress a routing decision).
- Disagreement between two *evaluation* metrics (e.g., a provider's precision looking weaker on one
  evidence type than another) — that is a provider-quality signal for `evaluation-metrics.md`, not
  a per-case curator concern.

## Shadow-mode-specific note

None of the above is wired to an actual curator queue in this phase — there is no live draft for a
curator to see, because the semantic layer produces no output that reaches a draft at all (per
`architecture.md`). The list above is the specification a *later* integration phase would implement,
and it doubles, right now, as the checklist a human evaluator uses when reading
`evaluation-metrics.md`'s comparison output: for each of the 96 benchmark cases, "would this case
have hit one of these 8 conditions, and if so, does the semantic evidence actually help a curator
verify faithfulness — or does it just add noise?" is the qualitative question this design intends
the first real evaluation run to answer.

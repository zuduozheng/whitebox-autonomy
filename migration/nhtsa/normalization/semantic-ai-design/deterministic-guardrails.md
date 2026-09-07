# Deterministic AI Guardrails

Design only. None of the invariants below are implemented. They are written in the same numbered,
"rule N" style `validate.mjs` already uses (currently rules 1–25) so that, if ever built, they would
extend that file's existing convention rather than create a second, parallel validation system —
but no file is modified by this task.

**General principle governing all of these**: prefer checks that are true regardless of *which*
specific finding motivated them — a check tied to one benchmark case's exact wording is exactly the
brittleness pattern the scale-up evaluation already showed the deterministic patterns suffer from
(observations.md finding 5). Every invariant below is stated as a general property the OUTPUT must
have, never as "does the text contain phrase X."

## Structural invariants (reject malformed output before it is trusted at all)

**G1 — Cited source pointer must exist.** Every `citations[].reportId` must be one of the
candidate's actual contributing report IDs (the same list `evidence.mjs` already builds from
`_contributingReportKeys`). A citation to a nonexistent report ID invalidates that item entirely —
downgrade to `unsupported`, do not attempt to guess which report was meant.

**G2 — Claimed evidence span must belong to the cited report.** The quoted text must be found,
verbatim (redaction placeholders compared literally), inside *that specific* report's narrative —
not merely somewhere in the candidate's consolidated narrative or another report in the same group.
This catches a model conflating two contributing reports' content, which is a real risk precisely
because multi-report candidates are the ones most likely to be sent to a semantic layer in the
first place (they are over-represented in the review-queue by construction, per criterion 8).

**G3 — Classification/value enum must be valid.** Every `value` must be a literal member of that
evidence type's closed enum (`semantic-evidence-schema.md`). No coercion, no fuzzy matching to the
"closest" enum member — an invalid value invalidates the item.

**G4 — `conflicting` requires genuine plurality.** A `supportStatus: conflicting` item must carry
>=2 `conflictingValues` entries from >=2 distinct report IDs with genuinely different values — a
single-report item or two entries with the same value cannot claim `conflicting`.

## Evidentiary-integrity invariants (prevent the model from "resolving" what determinism correctly left open)

**G5 — A deterministic source conflict cannot be silently collapsed.** If `evidence.mjs`'s existing
`disagreements` or `sourceRecordInconsistency` already flags a field as disputed among contributing
reports, no semantic item touching a related evidence type may assert `supported` with a single
confident value covering that same underlying disagreement — it must itself report `conflicting` (or
explicitly explain, via a separate item, why the semantic reading is orthogonal to the structured
disagreement, e.g. resolving a *different* fact than the one the structured fields disagree on).

**G6 — Explicit no-contact evidence is incompatible with an unqualified collision classification.**
If a `contact_occurrence: no-contact` item passes G1–G4 with `supportStatus: supported`, that
candidate must not proceed to the private draft with an unexamined `event_type: collision` — this
must at minimum surface as a hard flag for curator attention (see `curator-boundary.md`), and in any
future phase where `event_type` may consume semantic evidence at all (`output-contract.md` §6), this
is the one specific, narrow case authorized to redirect it.

**G7 — Human-control-before-contact evidence is incompatible with an "automation's own maneuver"
classification.** This generalizes the round-2 hardening pass's rule 25 (an *independent*
cross-check, not a re-execution of whatever rule produced the classification) to also run against
semantic `control_timeline` evidence, not only the deterministic `human_took_control_before_contact_narrative`
atom: if any evidence (deterministic OR semantic) shows a human/teleoperator actor with
`anchor: before-contact`, no field's justification — deterministic or semantic-influenced — may
attribute the maneuver to automation acting "on its own." This is a case where the deterministic
guardrail is deliberately widened to cover a second evidence source feeding the same downstream
risk, rather than writing a second, separate rule.

**G8 — Automation engagement and automation contribution remain logically independent.** A
`causal_contribution_evidence: automation-contributed` item must cite grounding evidence of its own
(a described automated maneuver, or a `root_cause_disclosure` item) — a `control_timeline` entry
showing `engagementState: engaged` is never, by itself, sufficient citation for a contribution claim.
Enforced structurally (the item's own citations must not be *identical* to another item's citations
used solely to establish engagement) — not left to prompt instruction alone, because the round-2
hardening review found that even carefully-reviewed deterministic code had conflated exactly these
two concepts once already.

**G9 — No increase in location precision beyond source evidence.** Since the semantic schema has no
geography evidence type at all (`semantic-evidence-schema.md`), this invariant is enforced by
absence rather than by checking a value — any response containing a geography-shaped field of any
kind is a contract violation (`output-contract.md` §2.9), full stop, regardless of what it says.

**G10 — Unsupported causation must fall back to `undetermined`, never to a guessed specific value.**
Any `causal_contribution_evidence` item that is `unsupported` or `unknown` must not be used to
justify any causation value other than what the deterministic layer would already produce absent
semantic evidence. Combined with §6's current blanket policy (no semantic evidence reaches
`causation_status` at all in this phase), this invariant is presently redundant with policy — it is
recorded now so it is already in force on day one of any future phase where that policy changes.

**G11 — Semantic AI cannot override or delete raw source facts.** The semantic layer never has
write access to any EVIDENCE or DERIVED atom, the raw report objects, or the mechanically
consolidated candidate fields — architecturally enforced by the atom-tier separation in
`architecture.md`, not merely a policy statement. A SEMANTIC-tier atom can only ever be *added*
alongside existing atoms, never substituted for one.

**G12 — Malformed or guardrail-failing items are dropped, not repaired.** Any item failing G1–G4 is
discarded and logged as a contract violation for that provider/run (feeding
`evaluation-metrics.md`'s precision metrics) — never "fixed up," never re-prompted for
correction within the same evaluation pass, and never partially trusted (e.g., keeping the `value`
while discarding a bad citation). A provider with a high malformed-item rate is a signal about that
provider, not something to route around silently.

**G13 — Internal self-consistency.** Two items of the same `type`, from the same interpretation
run, both `supported`, both citing the *same* report, must not assert different values — that is
the model contradicting itself within one response, a distinct failure from a genuine cross-report
conflict (G4/G5), and should be scored and reported separately (a provider-reliability signal, not
a source-evidence signal).

**G14 — Bounded item count per type per candidate.** A response proposing an implausibly large
number of `supported` items for a single evidence type on one candidate (e.g., more than one
`root_cause_disclosure` item, more than a small fixed number of `actor_relationship` entries) is
flagged for review rather than accepted at face value — this discourages a provider from hedging by
enumerating many low-confidence alternatives to inflate apparent recall, which would corrupt the
precision metrics in `evaluation-metrics.md`.

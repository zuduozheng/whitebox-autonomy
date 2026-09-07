# Open Questions

Genuinely unresolved decisions this design deliberately leaves open rather than answering
unilaterally — most require either a real (even if small) provider run to gather evidence, or a
policy/resourcing decision outside this design task's scope.

## 1. Provider choice and the tension with "provider-neutral"

The prompt (`provider-neutral-prompt.md`) and schema are designed to not favor any one vendor, but
some unavoidable tension remains: different providers vary in how reliably they follow a strict
JSON contract, support structured-output/schema enforcement natively, and respond to "say unknown"
instructions rather than confabulating. Choosing a first provider to pilot is itself a decision this
design does not make. Recommendation for whoever makes it: pick based on which provider's *native*
structured-output guarantees make `output-contract.md` §2's structural checks pass most often on a
handful of trial cases — not on general capability reputation, cost, or convenience — since a
provider that frequently fails structural validation (`deterministic-guardrails.md` G12) is
unusable for this design regardless of how good its judgment is when it does conform.

## 2. Is self-reported confidence meaningful at all?

`semantic-evidence-schema.md`'s `confidence` field is explicitly advisory because LLM self-reported
confidence is not a calibrated probability. Open question: is it worth including at all, given it
cannot be load-bearing anywhere in this design? Arguments for keeping it: it costs nothing to
request, and it may still correlate usefully enough with the overclaiming rate
(`evaluation-metrics.md`) to be worth measuring *as a provider-behavior signal* even if never
trusted as ground truth. Arguments for dropping it: including a field that looks authoritative but
isn't risks a future maintainer treating it as more meaningful than it is. Not resolved here —
recommend keeping it in the schema but explicitly measuring, in the first real evaluation run,
whether `confidence: low` items actually have a higher overclaiming/unsupported-claim rate than
`confidence: high` items; if there is no measurable correlation, drop the field in the next schema
revision rather than carrying a field that gives false reassurance.

## 3. Redaction-placeholder handling

NHTSA narratives contain both `[XXX]` placeholders (structural redaction, e.g. dates/locations) and
longer `REDACTED, MAY CONTAIN CONFIDENTIAL BUSINESS INFORMATION` spans. The prompt instructs the
model to treat both as intentionally withheld and never guess their content. Open question: should
a `[XXX]` immediately adjacent to an otherwise-clear sentence (e.g., "the vehicle was traveling at
[XXX] mph") cause the *whole* surrounding clause to be treated as evidentially weaker, or only the
specific redacted token? Not resolved — worth explicit testing in the first evaluation run rather
than guessing, since over-discounting redacted-but-otherwise-clear sentences would silently lower
recall for no real benefit.

## 4. Benchmark contamination discipline over time

`provider-neutral-prompt.md` explicitly avoids embedding real benchmark text in its own examples.
This discipline is easy to violate later — e.g., if a future engineer "improves" the prompt by
adding a worked example drawn from a benchmark case that turned out tricky, without realizing that
case is part of the scored set. Recommend: any future prompt revision that adds a new worked example
should be checked against the full `sameIncidentId` list in `benchmark-plan.md` before being
adopted, and any revision that touches examples should bump `promptVersion`
(`output-contract.md` §2.2) so every past evaluation run's results stay attributable to the exact
prompt text that produced them.

## 5. Data governance: sending NHTSA narrative text to a third-party provider

Per `CLAUDE.md`'s standing instruction to explain what data is sent to external services and why,
before wiring them up: NHTSA SGO narratives are U.S. government-mandated public disclosures,
already redacted by the filer before NHTSA publishes them, and already read into this project's own
local CSVs (no new collection). Sending this same, already-public, already-redacted text to a
third-party AI provider's API is a materially different exposure than keeping it local, even though
the content itself is public — it leaves an audit trail with that provider, may be subject to that
provider's own retention/training-data policies, and is a new "external service" under the
project's own rule. **This design does not decide whether that tradeoff is acceptable** — it
requires an explicit sign-off, per `CLAUDE.md`, before any real (not shadow-only-on-paper) API call
is made, including a check of the chosen provider's data-retention/training-opt-out terms for
API-submitted content specifically (distinct from consumer-product terms).

## 6. Long-term coexistence of deterministic patterns

If semantic evidence proves reliable for a given finding (e.g., finding 4's vocabulary-generalization
gap), should the corresponding deterministic regex be retired, or kept running permanently as a
free, fast, zero-cost redundant signal alongside the semantic layer? Not resolved. Leaning: keep
deterministic patterns running indefinitely regardless of semantic layer performance — they are
free, already validated, and provide a same-provider-independent baseline every future evaluation
can keep comparing against (per `evaluation-metrics.md`'s deterministic-wrong/AI-correct framing,
which requires the deterministic baseline to keep existing to remain meaningful) — but this is a
recommendation, not a decision made by this design.

## 7. Statistical power at n=96

96 cases (56 + 40) is small for any per-evidence-type, per-field metric with multiple possible
outcomes. A handful of cases can swing a percentage substantially. `evaluation-metrics.md` already
recommends treating every metric as directional rather than conclusive at this scale and reporting
raw counts rather than percentages for the smallest subsets (e.g., the 5-case clean-sample
false-negative list) — but it does not resolve how large a *follow-up* benchmark would need to be
before a promotion decision (moving any field from `output-contract.md` §6's "deterministic-only" to
"may use semantic evidence") could be made with real confidence. Left for whoever designs that
follow-up, once first-run results exist to estimate effect sizes from.

## 8. Governance for evolving the schema itself

`semantic-evidence-schema.md`'s 10 evidence types and their closed enums are a first design, derived
from 11 findings in one 96-case sample. As more cases are reviewed, new evidence-type needs will
likely surface (a new enum value, or an eleventh type). Open question: what is the process for
changing the schema without silently invalidating past evaluation runs? Recommend versioning the
schema itself (a `schemaVersion` alongside `promptVersion` in `providerMeta`) so that every stored
evaluation result is attributable to an exact schema+prompt pair — not designed in full here since
no runs exist yet to version.

## 9. `shared-or-multiple-factors` and other dead ontology values

`scale-up-eval/observations.md` finding 1/12 confirmed `causation_status`'s
`shared-or-multiple-factors` value is currently unreachable dead code. This design's schema gives it
a corresponding semantic evidence value (`causal_contribution_evidence: shared-or-multiple-factors`,
`semantic-evidence-schema.md` type 8) — but per `output-contract.md` §6, `causation_status` does not
consume any semantic evidence in this phase, so this design does not, by itself, make the value
reachable. Whether and how to eventually wire a genuine multi-actor causation signal into a real
classification remains a rulebook/curator decision, not resolved here.

## 10. Should shadow-mode evaluation run against 100% of future intake, or only flagged subsets?

Out of scope for this design (which only concerns the existing 96-case benchmark), but worth
recording as the natural next question once a first run exists: running semantic interpretation on
every future candidate has a real, ongoing cost; running it only on candidates the deterministic
layer already flags (the review-queue shape) would miss exactly the clean-sample-style false
negatives that are this design's core research interest. No sampling strategy is proposed here —
left for a follow-up design once `evaluation-metrics.md`'s clean-sample false-negative-detection
count exists as real data to reason from.

# Evaluation Metrics

Design only — no metric below has been computed; no provider has been run. This document defines
how shadow-mode output *would* be scored against (1) the deterministic-only result and (2) the
existing human review, once an actual provider run exists.

**Explicit non-goal, per instruction: there is no single blended "accuracy" percentage anywhere in
this design.** Every metric below is reported separately, per field where applicable, and per
benchmark subset (review-queue 56 vs. clean-sample 40) where applicable — collapsing them would
hide exactly the precision/recall tension this evaluation exists to expose.

## Inputs every metric is computed from

1. **Deterministic result** — already frozen, per candidate, in
   `scale-up-eval/scale-up-first-run-output.json` (`draft`/`validation`).
2. **Semantic-AI result** — the `SemanticEvidenceBundle` a provider run would produce (not yet
   produced), plus whatever downstream classification a later phase would derive from it under
   `output-contract.md` §6's permission table.
3. **Existing human review judgment** — `scale-up-eval/observations.md`'s 11 findings (each citing
   specific `sameIncidentId`s and describing the correct/faithful characterization) plus the
   per-case narrative material in `review-material-queue.md` / `review-material-clean-sample.md`.
   Where a case is not discussed in `observations.md` at all, the implicit human judgment is
   "deterministic output was not flagged as wrong" (i.e., presumed adequate) — this implicit case
   should be re-confirmed by a human reviewer at scoring time, not assumed silently, since
   `observations.md` was diagnostic sampling, not an exhaustive per-case verdict on all 96.

## Metric definitions

### Evidence-level metrics (tier C quality, independent of any classification)

- **Semantic evidence precision** — of all items a provider marks `supported`, the fraction whose
  citation actually and specifically supports the claimed `value`, on human spot-check. Computed
  per evidence type (10 types), not blended — a provider might be precise on `contact_occurrence`
  and imprecise on `causal_contribution_evidence`, and that difference is the point.
- **Semantic evidence recall** — of the evidence propositions `observations.md`'s findings already
  establish *are* present and findable in a given case's source text (e.g., finding G's citation
  that `3b95fade2333295` discloses a software defect), the fraction the provider actually surfaces
  as `supported` with a correct value. This is measured only against cases where a human reviewer
  has already confirmed the evidence exists — it is not a claim about cases nobody has checked.
- **Unsupported-claim rate** — of all `supported` items, the fraction where the cited span, on
  inspection, does not actually contain or reasonably support the claimed value (a stricter failure
  than low precision generally — this is confabulation: citing real text that doesn't say what's
  claimed). Target: this should be nearly zero for any provider considered further; a
  non-negligible rate here is disqualifying regardless of how good recall looks, because it means
  citations cannot be trusted at all, which breaks the entire evidence-grounding premise of the
  architecture.
- **False-certainty / overclaiming rate** — of all `supported` items, the fraction where the
  underlying source is, per human review, genuinely ambiguous, hedged, or contested (e.g., the
  source itself uses hedge language, or a second report disagrees) but the item asserts `supported`
  with no `conflicting`/`unknown` alternative offered. This is distinct from the unsupported-claim
  rate: the citation is real and roughly on-topic, but the confidence is unwarranted given the full
  evidence picture. This is the single most important metric for `causal_contribution_evidence`
  specifically, given the scale-up's confirmed misattribution case.
- **Unknown/abstention rate** — the fraction of applicable evidence-type slots returned as
  `unknown`/`unsupported`, reported per evidence type and per benchmark subset. High abstention on a
  type/subset where human review confirms clear evidence exists (e.g., `root_cause_disclosure` on
  the two confirmed self-disclosure cases) indicates under-triggering; high abstention on
  genuinely ambiguous cases (e.g., `causal_contribution_evidence` on the review-queue's 15 "own
  human driver, no category" cases) indicates *appropriate* caution. **This metric must always be
  read together with the recall metric above, never alone** — an abstention rate alone cannot
  distinguish "correctly declined" from "missed."

### Classification-level metrics (tier D, only for fields `output-contract.md` §6 permits)

- **Ontology-field agreement** — for each of `event_type`, `valence`, `automation_status` (the
  three fields §6 allows any semantic influence over at all), the fraction of benchmark cases where
  the deterministic+semantic combined classification matches the human-review-judged correct
  classification, reported separately per field. `causation_status` is **excluded from this metric
  by design** in this phase — per §6, no semantic evidence is permitted to influence it yet, so
  there is nothing to score at the classification level; causation is scored only at the
  evidence level (below).
- **Deterministic-wrong / AI-correct count** — cases where `observations.md` (or a fresh human
  check) judges the deterministic-only classification wrong or importantly incomplete, AND the
  deterministic+semantic combination is judged correct. This is the metric that most directly
  answers the research question.
- **Deterministic-correct / AI-wrong count** — cases where deterministic-only was fine, but adding
  semantic evidence would introduce a new wrong or overclaimed result. **This is the regression /
  safety metric.** Any non-trivial count here, on any field, is grounds to keep that field
  deterministic-only regardless of how good the aggregate numbers look elsewhere — a single
  confidently-wrong new claim on a previously-fine case is a worse outcome than several missed
  opportunities, given the project's evidentiary-integrity principles.
- **Both-wrong / ambiguous count** — cases where neither the deterministic-only nor the
  deterministic+semantic result reaches a human-judged-correct or faithful characterization. These
  are the cases most likely to indicate a genuine ontology/policy gap (Category C/D in
  `observations.md`'s taxonomy) rather than an extraction failure — worth listing individually for
  curator/rulebook attention regardless of what any AI does.

### Field-specific error rates

- **Causation-specific error rate** — computed only over `causal_contribution_evidence` items
  (never blended with other evidence types), split into two sub-rates that have very different
  severity:
  - *misattribution rate*: a confidently-supported, wrong actor (the cat-pileup shape of error —
    the worst outcome, since it is confident and wrong)
  - *under-classification rate*: `unsupported`/`unknown` where human review confirms a specific
    actor's contribution was actually well-evidenced (a missed opportunity, safe but incomplete)
  Given `causation_status` itself is not touched by semantic evidence in this phase (§6), this rate
  is measured purely as an evidence-quality signal — a leading indicator of whether the field
  should ever be considered for §6 promotion, not a live classification result.
- **Engagement-status error rate** — computed over `control_timeline` items resolved against the
  deterministic `automation_status` result, split into: *vocabulary-recovered* (deterministic
  `unknown`, semantic correctly resolves it — the target outcome for finding 4), *vocabulary-wrong*
  (semantic resolves it, but to the wrong state), and *no-change* (both agree or both are silent).

### Clean-sample-specific metric (the core research question, isolated)

- **False-negative detection among the 40 clean controls** — of the clean-sample cases
  `observations.md` already confirms contain a real error the deterministic diagnostics missed
  (`7bf2bd79eaff634`, `8c56b788577d262`, `e030f01d2992e85`, `1e1418541038c4a`, `1d1efbae9103870` —
  5 confirmed at time of writing), the count and fraction where the semantic layer surfaces
  evidence that would have flagged the case for review (e.g., `contact_occurrence: no-contact` on
  `8c56b788577d262`). Reported as a raw count (out of a small, named, enumerable set), not a
  percentage of the full 40 — percentaging a 5-item set invites false precision.
- **Symmetric check on the clean-sample's other ~35 cases**: rate of any `supported` item that
  contradicts the existing correct deterministic result (a false alarm on a genuinely clean case) —
  this is the same regression concern as "deterministic-correct/AI-wrong" above, isolated to the
  cases most likely to be truly unremarkable, where any false alarm is least excusable.

## Reporting format (no single number)

A finished evaluation report would present, at minimum, one table per benchmark subset (56 / 40)
with rows = evidence types, columns = {precision, recall, unsupported-claim rate, overclaiming
rate, abstention rate}; a second table with rows = {event_type, valence, automation_status} and the
four count-based classification metrics; and the causation-specific and clean-sample-specific
metrics reported as their own named, itemized lists (small enough, and important enough, to name
every case rather than only a count). No weighted composite of any of the above should be computed
— see `open-questions.md` on statistical power at n=96 for why even the per-metric numbers should
be treated as directional, not conclusive, at this sample size.

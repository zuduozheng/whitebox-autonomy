# Benchmark Plan

Design only. No new sample is selected. This reuses the already-completed human review rather than
creating another labeling exercise, per instruction.

## Benchmark corpus: reference, not copy

The benchmark set is defined **by reference** to two existing, frozen, already-reviewed files —
nothing here duplicates their content:

- `migration/nhtsa/normalization/scale-up-eval/review-queue.json` — 56 cases, each already carrying
  its `_reviewReasons` (why it was flagged) and the deterministic-only `draft`/`validation` result.
- `migration/nhtsa/normalization/scale-up-eval/clean-sample.json` — 40 cases, the reproducible
  random clean-case sample, each carrying the same `draft`/`validation` shape.

**Benchmark set = the union of the two files, keyed by `sameIncidentId`.** 56 + 40 = 96 unique
candidates (no overlap between the two files by construction — see
`scale-up-eval/SCALE-UP-REVIEW-PACKAGE.md` §3/§6/§7). The human-review judgment for each case
already exists in prose form in `scale-up-eval/observations.md` (the 11 numbered findings, each
citing specific `sameIncidentId`s) and in the compact per-case material in
`scale-up-eval/review-material-queue.md` / `review-material-clean-sample.md`. A future evaluation
run reads candidates from the two JSON files directly (by `sameIncidentId`) and reads the
corresponding human judgment from `observations.md`'s per-finding case citations — no new "gold
label" file is created by this design; the two already exist and this plan just states how they are
joined.

If a machine-readable join is ever wanted, it would be a **tiny, additive index** (candidateId →
finding numbers it evidences, +/- "no finding — apparently clean") — not attempted here, since the
prose citations in `observations.md` already serve this purpose and building a redundant index
without a concrete consumer would be scope creep for a design-only task.

## Two benchmark subsets test different things

- **Review-queue 56** — cases the deterministic pipeline already flagged as needing attention.
  These test **recall and correctness of interpretation**: given that something is already known to
  be uncertain, does semantic evidence correctly characterize *what* is uncertain and *why*,
  without overclaiming a resolution the deterministic layer correctly declined to make?
- **Clean-sample 40** — cases the deterministic pipeline did NOT flag. These test **recall of missed
  errors** (the core research question) and, symmetrically, **precision on cases that were actually
  fine** (a regression risk: introducing a *new* wrong claim on a candidate that had no problem is
  strictly worse than staying silent). `observations.md` already identifies several clean-sample
  cases with confirmed real errors (`7bf2bd79eaff634`, `8c56b788577d262`/`e030f01d2992e85`,
  `1e1418541038c4a`, `1d1efbae9103870`) — these are the highest-value individual test cases in the
  entire benchmark, because human review already independently confirmed what the "right" semantic
  read should surface.

## Part 4 — failure-specific capability tests, mapped to the 11 scale-up findings

Each capability below cites one or more **existing** benchmark cases (from the 96) where possible,
per instruction. "Expected semantic evidence" describes what a correct response should produce —
this is a specification for evaluation, not a set of test fixtures to build now.

| # | Capability | Benchmark case(s) | Expected semantic evidence (illustrative) |
|---|---|---|---|
| A | Chain-reaction / multi-vehicle causation | `7bf2bd79eaff634` (cat → 4-vehicle pileup), `1988e25397f633d` (5-vehicle pileup, hospitalization), `f0ae0f1d67d9a27` (3-vehicle swerve chain) | `contact_mechanism: multi-contact-chain` (supported); `causal_contribution_evidence: shared-or-multiple-factors` or per-actor items, never a single confident actor pinned to the *entire* chain |
| B | Explicit "no contact occurred" language | `8c56b788577d262` (Waymo insurance-claim dispute), `e030f01d2992e85` (PlusAI debris avoidance) | `contact_occurrence: no-contact` (supported), citing the literal disclaiming sentence |
| C | Branded/varied automation-engagement vocabulary | `49cddd631fa898b` (Polestar "Pilot Assist"), `31362e0be491cc1` (Kia "Highway Driving Assist"/"Smart Cruise Control") | `control_timeline` entry with correct `engagementState`, despite no "ADS"/"autonomous mode" phrase appearing anywhere |
| D | engaged → disengaged → re-engaged chronology | *(finding 4's table; no single existing benchmark case has a confirmed triple transition — see note below)* | `control_timeline` with 3 ordered entries, correct final `anchor: at-contact` state |
| E | "Aurora Driver" / equivalent branded system language | `40a6c193304ddb4`, `460289782aa5d13` (Aurora, prior-maneuver-then-handoff scenario) | `control_timeline` correctly resolving "Aurora Driver" as `actor: automation`; separately, `causal_contribution_evidence` populated only if the narrative independently describes automation initiating a response, not merely because it was engaged |
| F | Traffic-rule violations, varied wording incl. stop signs | `350127996a9c99d`, `919102c28fff2ca`, `b371438c0da79a5` ("failed to stop for the red light"), `67a8aed333e7a9d` (cyclist ran a stop sign) | `traffic_rule_infrastructure_context: { violationDescribed: true, violationType: "red-light"/"stop-sign" }` |
| G | Software defect / root-cause narratives | `3b95fade2333295` (May Mobility lidar-latency defect) | `root_cause_disclosure: software-defect-disclosed`, citing the "ground mapping module had fallen significantly behind" sentence |
| H | Hardware failure / root-cause narratives | `1d1efbae9103870` (Beep/Navya Xbox-controller failure, fleet stand-down) | `root_cause_disclosure: hardware-failure-disclosed` |
| I | Subject vehicle's own human driver overriding automation | `03ad388e6676c05` (May Mobility — automation would have stopped safely; human override caused the collision), plus the 14 other "own human driver" review-queue cases | `control_timeline` showing automation engaged, then human-operator engagement immediately before contact; `causal_contribution_evidence: subject-human-driver-contributed` only when the narrative itself describes the human's action as producing the contact (not merely "a human was driving") |
| J | Post-contact vs. pre-contact takeover | `b42deb39142d807`, `276c44175c4e6fa` (Motional — "following the impact, the safety driver assumed control," correctly `anchor: after-contact`) vs. `40a6c193304ddb4` (Aurora — handoff during/before the response) | Correct `anchor` value distinguishing the two; this is also a **negative test**: a provider that anchors every `human_took_control`-type phrase as `before-contact` regardless of narrative wording fails this capability even if it "finds" the phrase |
| K | Cross-report semantic inconsistency | `aeb0ef282584e35`-shaped cases (Pony.ai/Hyundai divergent-mechanism pattern from the original stress test) are the sharpest known example of this failure mode; within the 96-case benchmark, multi-report cases with differing narrative lengths (criterion 8 cases, e.g. `8910341f6eceb78`, `d1097c7706589a9`) are the closest available instances | Per-report items that genuinely differ resolve to `supportStatus: conflicting` at the harness level (see `semantic-evidence-schema.md`'s "cross-report disagreement" — a derived comparison, not a model assertion) |

**Note on capability D**: no case in the current 96-case benchmark was confirmed, during human
review, to contain a genuine triple engaged→disengaged→re-engaged transition — the closest
real-world analogue evaluated so far is the synthetic Scenario B used in the round-2 hardening
pass's own regression tests (`__tests__/narrative-engagement-resolution.test.mjs`), which is
deterministic-code-level, not part of this semantic benchmark. This capability should be evaluated
opportunistically if such a case is found in the 96, and explicitly flagged as **untested by this
benchmark** rather than silently assumed covered if none is found — see `open-questions.md`.

## Part 5 — First pilot: 40-case benchmark (20 challenge + 20 clean control)

*Revised per independent design review; supersedes any earlier recommendation to run the first
experiment against the 40 clean-case controls alone.* Both subsets below are drawn **by reference**
from the existing, frozen 96-case benchmark — no new candidate, no new sampling, no re-review of raw
NHTSA source text. Selection used only material that already existed before this task: the Part 4
capability table above, `scale-up-eval/observations.md`'s 11 numbered findings, and the compact
per-case material in `scale-up-eval/review-material-queue.md`.

**Why 20 + 20, not 40 clean alone**: the first pilot must test two different failure directions at
once. Running only clean controls would answer "does semantic AI stay quiet where it should?" but
say nothing about whether it can actually recover the evidence the deterministic layer misses —
which is the entire research question this design exists to answer. Running only challenge cases
would answer recovery but say nothing about regression risk. Twenty of each, drawn from cases
already reviewed by a human, answers both in one pass.

### 5.1 — 20 challenge cases (from the 56-case review-queue)

**Selection rule**: cases were chosen to give at least one representative per demonstrated semantic
failure family (Part 4's rows A–K above, plus the occupant/actor-misattribution and
failed-engagement-attempt patterns `observations.md` separately documents), preferring cases already
named in Part 4 or in `observations.md`'s findings over undocumented ones, and never selecting a case
by first previewing what a semantic model might say about it. Every ID below was mechanically
verified to be a `sameIncidentId` present in `scale-up-eval/review-queue.json` and absent from
`scale-up-eval/clean-sample.json`, so no challenge case can silently double as a clean control.

| # | `sameIncidentId` | Failure family (Part 4 row / observations.md finding) |
|---|---|---|
| 1 | `f0ae0f1d67d9a27` | A — multi-vehicle/chain-reaction (PlusAI 3-vehicle swerve) |
| 2 | `8c56b788577d262` | B — explicit no-contact language (Waymo insurance dispute) |
| 3 | `49cddd631fa898b` | C — branded automation vocabulary (Polestar "Pilot Assist") |
| 4 | `31362e0be491cc1` | C — branded automation vocabulary (Kia "Highway Driving Assist") |
| 5 | `2b3039c25836235` | C — branded/varied vocabulary (Apollo, "conventional mode") |
| 6 | `276c44175c4e6fa` | J — post-contact takeover chronology (Motional, "following the impact") |
| 7 | `3ba6e26d74e6f93` | J / round-2 positive control — pre-contact human control, curb contact |
| 8 | `40a6c193304ddb4` | E / J — "Aurora Driver" branded terminology, prior-maneuver-then-handoff |
| 9 | `460289782aa5d13` | E — "Aurora Driver" branded terminology (second instance) |
| 10 | `350127996a9c99d` | F — traffic-rule context outside fixed phrases (red-light) |
| 11 | `b371438c0da79a5` | F — traffic-rule context outside fixed phrases (red-light) |
| 12 | `919102c28fff2ca` | F — traffic-rule context outside fixed phrases, **stop-sign specifically** |
| 13 | `3b95fade2333295` | G — software root-cause narrative (May Mobility, lidar-latency) |
| 14 | `59d489f93e681d4` | observations.md finding 11 — novel edge case (TuSimple, failed engagement attempt) |
| 15 | `03ad388e6676c05` | I — subject vehicle's own human driver / override (May Mobility) |
| 16 | `1e1418541038c4a` | observations.md finding 7 — movement-heuristic / own-driver ontology gap (Zoox) |
| 17 | `469cd8d228115fc` | I / J — own human driver took control, moderate-injury case (Waymo semi-truck) |
| 18 | `8910341f6eceb78` | K — cross-report semantic inconsistency (multi-report length variance) |
| 19 | `d1097c7706589a9` | K — cross-report semantic inconsistency (multi-report evolution) |
| 20 | `157c3bf1bb69649` | observations.md finding 6 — occupant/actor-misattribution ("two Cruise AVs") |

Not every one of the 11 original failure families/letters has a single dedicated row above by
design — several cases cover more than one family at once (documented in the table), which is
consistent with using cases as they actually occurred rather than manufacturing one case per label.
Capability D (engaged→disengaged→re-engaged triple transition) is not represented, consistent with
`benchmark-plan.md`'s existing note that no confirmed case of it exists in the 96-case benchmark.

### 5.2 — 20 clean controls (from the 40-case clean sample)

**Selection rule**: deterministic and reproducible, with no inspection of any semantic-AI output
(none exists yet) and no re-review of source narratives — the first 12 entries of the existing
25-case systematic-clean stratum plus the first 8 entries of the existing 15-case targeted-clean
stratum, taken in the exact order already fixed by `clean-sample.json` (itself produced by the
fixed-seed mulberry32 shuffle documented in `scale-up-eval/select-clean-sample.mjs`). This preserves
the 25:15 (systematic:targeted) ratio of the parent 40-case sample at 12:8 and introduces no new
randomness or judgment calls. Mechanically verified: all 20 IDs are members of
`scale-up-eval/clean-sample.json`, all are absent from `scale-up-eval/review-queue.json` by
construction of that file, and none overlaps any of the 20 challenge-case IDs in 5.1.

*Systematic-clean (first 12 of 25):* `69dbcb440688427`, `5bb5073dab94bae`, `e6ab23dde26e260`,
`616f675a2e2ccb7`, `88117eda2bc6d2d`, `fa4569805b2287b`, `0004c97b78f8dcb`, `6fe30e73d1bb8d1`,
`2f23e4e3267584e`, `0cc12230f0d8e74`, `39987aac7f64fd3`, `b0f8952fe931b48`.

*Targeted-clean (first 8 of 15):* `1d1efbae9103870`, `17c618d238f493f`, `1988e25397f633d`,
`7e9b9cd2a74e8fc`, `45f715e92eb4757`, `3d8644dfd8c835e`, `f3f7d49a496c366`, `857232881f1c3c0`.

Two of these clean controls are worth flagging in advance because `observations.md` already
identified them as clean-sample cases with a *confirmed* real error the deterministic layer missed:
`1d1efbae9103870` (Beep/Navya hardware root-cause, Part 4 capability H) and, among the systematic
stratum, `88117eda2bc6d2d`/`0cc12230f0d8e74` and neighbors carry no such flag and serve as genuine
true-negative controls. This is expected and intentional — clean controls are not required to be
error-free to serve as regression tests; a clean control with a known missed error tests recovery
exactly like a challenge case would, while the genuinely error-free majority tests for
overclaiming/false-positive introduction. `evaluation-metrics.md`'s clean-sample false-negative
metric already treats these two differently by design.

### 5.3 — What this pilot evaluates, and how the two mechanisms stay comparable

Both the 20 challenge cases and the 20 clean controls are run through the **same** unmodified
pipeline: `evidence.mjs`'s existing deterministic EVIDENCE/DERIVED atoms are produced exactly as
today (unchanged, no regex retired or bypassed), and the semantic layer separately proposes
SEMANTIC-tier atoms from the same candidate + contributing-report input. The two atom sets are never
merged into one undifferentiated list — every atom keeps the tier/provenance tagging
`architecture.md` and `output-contract.md` §2.2 already specify, so a reviewer can always tell, for
any given fact in the eventual comparison output, whether it came from deterministic pattern-match or
semantic interpretation. This side-by-side design is what lets `evaluation-metrics.md` compute, per
case: semantic evidence that agrees with the deterministic atoms; semantic evidence that adds new,
supported information; semantic evidence that contradicts a deterministic atom (routes to
`curator-boundary.md` condition 7); deterministic evidence the semantic layer failed to also surface;
and unsupported semantic additions with no deterministic counterpart at all.

## What this plan deliberately does not do

- It does not draw a new sample (explicitly out of scope).
- It does not create a machine-readable "gold answer key" separate from the existing prose review —
  building one prematurely risks encoding a rigid, possibly wrong, interpretation of nuanced cases
  before any provider's actual behavior is seen; `evaluation-metrics.md` explains how metrics are
  computed against the existing human review directly instead.
- It does not run any provider — this document defines what *would* be evaluated, not results.

# Provider-Neutral Semantic Extraction Prompt (Draft)

Design only. Not tuned for, or tested against, OpenAI, Anthropic, Gemini, or any other vendor. No
call has been made with this or any prompt. Provided as plain instruction + schema text so it could
be adapted to any provider's calling convention (see `provider-abstraction.md`) without rewriting
its substance.

## A note on examples and benchmark contamination

The illustrative example embedded below uses **synthetic sentences invented for this document**,
not text drawn from the 96-case benchmark (`benchmark-plan.md`). This is deliberate: if this exact
prompt is later used to *evaluate* the 96 benchmark cases, any benchmark case's own text or its
"correct" answer appearing inside the prompt would leak the answer key into the input the provider
sees, contaminating every metric in `evaluation-metrics.md`. Any future revision of this prompt must
preserve this separation — see `open-questions.md`.

## Prompt structure

### 1. Role and scope framing

> You are extracting **evidence**, not conclusions, from a U.S. NHTSA Standing General Order crash
> report. You are not a legal, safety, or insurance investigator. You do not decide what happened —
> you identify what the provided report text does and does not say, and how confidently it says it.
>
> You will be given one or more **contributing reports** for a single incident. Some report only
> summarize; some may be duplicates filed by a different corporate entity than the vehicle operator;
> some may explicitly disclaim knowledge of the facts. Treat every report as a distinct, independent
> source of evidence — do not assume later reports supersede earlier ones, and do not assume reports
> from the vehicle's own operator are more reliable than reports from a co-filer, or vice versa.

### 2. Hard prohibitions (stated explicitly, not left implicit)

> - Do not use any knowledge you may have about this vehicle, developer, or incident from outside
>   the text provided in this request. If you recognize the incident, ignore that recognition
>   entirely and rely only on the text given here.
> - Do not guess. If the text does not clearly support a value from the given list, say so — do not
>   provide your best guess labeled as a fact.
> - Do not resolve a disagreement between reports by picking the one you find more credible, more
>   detailed, or more recent. Report the disagreement as a conflict.
> - Do not assign fault, blame, negligence, or legal responsibility to any person, vehicle, or
>   system, in any field, including free-text explanation fields. Describe only what is reported to
>   have physically happened.
> - Do not treat "A happened, then B happened" as evidence that A caused B. Temporal sequence is not
>   causation. Only report a causal or contributory relationship when the text itself describes one
>   (e.g., "as a result of," "which caused," "contributed to") — not merely a chronological
>   narrative.
> - Do not treat "the automated system was engaged" as evidence, by itself, that the automated
>   system contributed to what happened. Whether the system was ON at a given moment, and whether
>   the system's own action contributed to the outcome, are two separate questions. Answer them
>   separately, and do not let evidence for one substitute as evidence for the other.
> - Do not fill in, complete, or guess the content behind any redaction placeholder (for example
>   `[XXX]` or "REDACTED, MAY CONTAIN CONFIDENTIAL BUSINESS INFORMATION"). Treat these as
>   intentionally withheld, not as gaps to reason around.
> - Do not invent a category, value, or label that is not in the list provided for a given field. If
>   nothing in the list fits, say the field is unsupported or unknown — do not propose a new one.

### 3. What "observation" vs. "interpretation" means here (explicit worked framing, synthetic)

> Some fields ask you to restate what a report says (an **observation** — close paraphrase of the
> source, e.g., "the vehicle braked and came to a stop"). Others ask you to characterize a
> relationship the report describes (an **interpretation** — e.g., whether a described action
> counts as a traffic-rule violation). Interpretation is only allowed within the fixed list of
> values given for that field, and only when the source text itself, not your outside judgment,
> makes the characterization reasonably clear. When it is a close call, prefer the unsupported/
> unknown answer.
>
> Example (synthetic, not a real incident): *"The lead vehicle slowed suddenly. The following
> vehicle, which had been trailing closely, struck the rear of the lead vehicle."* — An observation
> is: "the following vehicle struck the rear of the lead vehicle." A supportable interpretation is
> a contact-mechanism value of "rear-end." An unsupportable interpretation would be concluding the
> following vehicle was "negligent" or "tailgating" — the text describes a following distance and a
> collision, not a violation of any specific rule, so a traffic-rule-violation field should be
> `unsupported`, not inferred from "trailing closely" alone.

### 4. Required output shape

> Respond with a single JSON object matching this shape exactly. Every item must include a
> `supportStatus` of exactly one of: `"supported"`, `"unsupported"`, `"conflicting"`, `"unknown"`.
> Every citation must quote the source report text verbatim (including any `[XXX]` placeholders
> exactly as written) and must name which specific report it came from.
>
> [Full schema reproduced from `semantic-evidence-schema.md` / `output-contract.md` §4 — omitted
> here to avoid duplicating the authoritative version in two places; the actual prompt sent to a
> provider would inline the schema text or a provider-appropriate structured-output/JSON-schema
> declaration, per `provider-abstraction.md`.]

### 5. Input framing

> Candidate incident (mechanically consolidated fields — for context only, not a fact to confirm or
> repeat back):
> `{consolidated structured fields, exactly as evidence.mjs / mapping.mjs already produce them}`
>
> Contributing reports (the ONLY evidence you may cite):
> `{for each report: report ID, reporting generation, and full narrative text verbatim}`
>
> Extract semantic evidence for each of the 10 evidence types defined below. If a type does not
> apply to this incident at all, return it with `supportStatus: "unsupported"` and a brief
> explanation — do not omit it from the response.

### 6. The 10 evidence types and their closed value lists

> [Inlined verbatim from `semantic-evidence-schema.md` at prompt-construction time — not
> re-authored here, to guarantee the prompt and the schema document can never silently drift apart.]

## Why this shape, provider-neutrally

- No provider-specific function-calling/tool syntax is assumed — the contract is plain JSON with an
  explicit shape description, which every major provider can produce either via a system-prompt
  instruction, a JSON-mode flag, or a structured-output schema declaration; `provider-abstraction.md`
  is where a specific provider's mechanism for *enforcing* this shape is chosen, not this document.
- The prohibitions section is deliberately verbose and repetitive of the schema's own constraints
  (e.g., "do not invent a category" restates what the schema's closed enums already try to enforce
  mechanically) — this is intentional defense in depth: the guardrails in
  `deterministic-guardrails.md` are the actual enforcement mechanism, but a clear, explicit prompt
  reduces how often a provider produces output that needs to be discarded in the first place.
- Nothing in this prompt asks for or permits an `event_type`/`valence`/`automation_status`/
  `causation_status` value — consistent with `architecture.md`'s "why atoms, not classifications."

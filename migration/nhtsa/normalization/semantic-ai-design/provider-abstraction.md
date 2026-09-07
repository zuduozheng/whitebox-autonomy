# Provider Abstraction Design

Design only. No network call, no SDK dependency, no implementation. This defines the minimal
interface shape so a later implementation could evaluate more than one provider without changing
anything upstream (the orchestration, the schema, the guardrails, or the prompt's substance).

## Why this matters now, before any provider is chosen

`CLAUDE.md`'s standing rule — "do not introduce dependencies unless genuinely needed," and "when
external services are added later, explain what data is sent to them and why, before wiring them
up" — applies directly here. Committing to one provider's SDK or calling convention at this stage
would (a) pull in a dependency before the project has decided whether semantic interpretation earns
its place at all, and (b) make `evaluation-metrics.md`'s explicit goal of comparing providers
structurally harder, since provider-specific code would leak into the parts of the system that
should not care which provider produced an answer.

## The interface (conceptual — no implementation)

```
interface SemanticProvider {
  name: string;              // e.g. "provider-a", never assumed by calling code beyond this string
  modelVersion: string;      // free-form, provider-defined, recorded verbatim in providerMeta

  interpret(request: SemanticInterpretRequest): Promise<SemanticInterpretResponse>;
}

SemanticInterpretRequest {
  candidateId:  string;
  candidate:    ConsolidatedCandidateFields;   // exactly what evidence.mjs already receives
  reports:      ContributingReport[];          // exactly what evidence.mjs already receives
  promptVersion: string;                       // which version of provider-neutral-prompt.md was used
}

SemanticInterpretResponse {
  raw:      unknown;                 // the provider's literal response, kept for audit, never trusted directly
  parsed:   SemanticEvidenceBundle | null;   // null if parsing/schema validation failed
  parseErrors: string[];             // populated when parsed is null or partially rejected
}

function semanticInterpret(
  candidate: ConsolidatedCandidateFields,
  reports: ContributingReport[],
  provider: SemanticProvider,
): Promise<GuardrailedSemanticEvidenceBundle>
```

`semanticInterpret` is the **only** function anything else in the system would ever call. Its
responsibilities, in order:

1. Build the request payload from `candidate`/`reports` — using the exact same input shape
   `evidence.mjs` already consumes, so nothing about candidate/report preparation is duplicated or
   allowed to drift from the deterministic path.
2. Render the provider-neutral prompt (`provider-neutral-prompt.md`) plus the current
   `promptVersion` tag.
3. Call `provider.interpret(request)` — the only place any provider-specific code runs at all.
4. Run the raw response through the structural checks in `output-contract.md` §2 and the guardrails
   in `deterministic-guardrails.md` (G1–G14) — **before** anything downstream ever sees an item.
5. Tag every surviving item with `providerMeta` (`output-contract.md` §2.2) for permanent
   attribution.
6. Return a `GuardrailedSemanticEvidenceBundle` — the only object type anything outside this module
   would ever handle; it carries no provider-specific shape.

## What a provider adapter looks like (conceptually, still no implementation)

Each provider gets exactly one small adapter satisfying `SemanticProvider`, responsible only for:
- translating the provider-neutral request into that provider's actual call shape (message format,
  structured-output/JSON-schema declaration if the provider supports one, temperature/sampling
  settings if applicable);
- translating that provider's raw response back into the plain-JSON shape `output-contract.md`
  defines, WITHOUT attempting to fix, reinterpret, or paper over anything the response gets wrong —
  a lossy or malformed response becomes `parsed: null` with `parseErrors` populated, not a "best
  effort" reconstruction.

No adapter is written by this design task. Writing one is the smallest unit of actual
implementation this design anticipates — see the Design Review Summary's "recommended smallest
first experiment" in `architecture.md`.

## Explicit non-goals of this abstraction

- It does not attempt to normalize *quality* differences between providers (a provider that is
  worse at following instructions is still evaluated honestly through `evaluation-metrics.md`, not
  compensated for at the interface level).
- It does not support streaming, multi-turn correction, or "ask the model to fix its own JSON"
  retry loops in this design — per `deterministic-guardrails.md` G12, malformed output is dropped,
  not repaired, so the interface has no retry-with-feedback concept to abstract.
- It does not specify a caching, batching, or cost-control layer — those are real operational
  concerns for a later phase, deliberately out of scope for a design that has not yet justified that
  semantic interpretation should run at all.
- It does not choose where API keys or credentials would live beyond restating the existing project
  convention (environment variables, never hardcoded, never committed) — no credential of any kind
  is needed or referenced by this design task, since no call is made.

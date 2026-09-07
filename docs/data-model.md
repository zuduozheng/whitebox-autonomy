# White Box Autonomy — conceptual data model

Status: **approved conceptual model.** No SQL yet. This records entities,
relationships, and what is V1 versus merely anticipated.

## Modelling decisions

1. **`event` is an anchor, not a fact.** It records *that something happened
   involving a putative AV*. Every contestable detail — autonomy state,
   causation, severity, ADS version, location — is a separate **`claim`** with
   its own evidence and its own verification standing.
2. **Provenance is a three-object chain:** `publisher → source → evidence`, where
   `evidence` is the associative object linking a `source` to a specific `claim`
   and stating how it bears on it (supports / contradicts / context).
3. **Verification is a history, not a column.** `assessment` rows are
   append-only, dated, and attributed. A claim carries a denormalised
   "current verification" pointer for convenience; the trail is the truth.
4. **Taxonomies are data.** One `taxonomy` / `taxonomy_term` pair holds every
   controlled vocabulary. Terms are deprecated and superseded, never deleted, so
   reclassification never destroys history.
5. **"Partially known" is representable** via a shared partial-date pattern
   (value + precision term) and a knowledge-level term on `ads_version` and
   `location`.
6. **One generic `revision` log** covers audit for all core entities; every table
   also carries created/updated/soft-delete metadata.
7. **Involvement ≠ causation.** `event.involvement_status` is distinct from a
   `claim` of type `causal_attribution`, which is absent or `undetermined`
   unless evidence is attached.

## Core entities (V1)

| Entity | Purpose |
| --- | --- |
| `event` | The real-world occurrence; the stable, citable anchor. Fields include slug, title, curator summary, occurrence date + precision, `involvement_status`, `event_type_term_id`, `valence_term_id`, `status`, `origin`, `review_status`, `merged_into_event_id`, audit. |
| `claim` | A typed, individually verifiable statement about an event. Fields: `event_id`, `claim_type_term_id`, statement, asserted value, `assertion_origin` (incl. `ai_extraction`), `current_verification_term_id`, disposition, audit. An AI-origin claim must have ≥1 `evidence` row pointing to a `source` with a URL. |
| `assessment` | Dated, attributed evaluation of a claim's evidential standing (the history). |
| `publisher` | Organisation/outlet responsible for a source. First-class (reused, provenance-weighted). |
| `source` | A discrete information artifact: URL, title, publisher, publication date + precision, retrieved-at, archive URL + captured-at, content hash, source type, retrieval method, `discovery_run_id` / `submission_id`. Full retrieved text is kept private, not served. |
| `evidence` | Associative: how one `source` bears on one `claim` (evidence type, stance, verbatim excerpt, locator). |
| `actor` | Any named party: AV developer, OEM, fleet operator, regulator, municipality, investigating body. Self-referential parent for corporate hierarchy. |
| `event_participant` | Associative: who/what took part and in what role — separate from fault. `is_subject_av` flag; optional best-known `ads_platform_id` / `ads_version_id` on the subject vehicle. |
| `ads_platform` | An automated-driving-system product line (e.g. "Waymo Driver"). `developer_actor_id`, nominal SAE-level term. |
| `ads_version` | A specific or partially specified build. `version_label` (verbatim), normalised parts, `knowledge_level_term_id` (exact / approximate / range / family_only / unknown), range note. |
| `location` | A place with explicit uncertainty: `precision_term_id`, point, uncertainty radius, area, place name, ISO country/region codes, derivation note. |
| `taxonomy` | A controlled vocabulary (key, name, hierarchical?). |
| `taxonomy_term` | One term: code, label, parent, status (active/deprecated), `replaced_by_term_id`, validity dates, external reference (e.g. SAE J3016). |
| `revision` | Append-only change log for every core entity (entity type + id, operation, revision no, actor, timestamp, diff, context). |
| `user_profile` | Maps the Supabase Auth identity to a role (curator / reviewer / admin). |

### Discovery / crowdsourcing entities (V1)

| Entity | Purpose |
| --- | --- |
| `discovery_query` | A configured recurring search: provider, query text or feed URL, recency filter, valence-bias note, enabled flag, interval, last run. |
| `discovery_run` | One execution, for transparency: query, provider, timing, status, counts (returned / new / duplicate / irrelevant / events created), cost estimate, error note. |
| `discovery_item` | One raw candidate hit + its pipeline state: raw URL / normalised URL / hash, HTTP status, retrieved-at, raw title/snippet, private raw-text ref, publisher + date guesses, `relevance_status`, `extraction_status`, `dedup_status` + `matched_event_id`, `outcome` + promoted ids, decision-by / at / note. Survives promotion or rejection as an audit trail. |
| `ai_extraction` | The AI's structured proposal for one item: `model_id`, `prompt_version`, run time, input hash, verbatim `output_json`, proposed fields (title, summary, event type, valence, date + precision, location text, country, operator / ADS platform / version strings, involvement status), per-field evidence quotes, `is_current`. |
| `submission` | Human crowdsourcing, quarantined: submitted-at, optional email / note, URL + normalised + hash, `status` (new / in_review / accepted / rejected / duplicate), `linked_event_id`, triage fields, abuse metadata (ip hash, UA hash, captcha passed). |
| `event_relationship` | Event↔event links: `duplicate_of`, `same_incident_as`, `merged_into`, `possible_duplicate_of`, `related_to`, `precursor_of`. `created_by` null = automated. |

**Total V1 tables: ~22.** Each new table is a thin log or association; none
carries business logic.

## Anticipated — designed for, not built

`event_classification` (multi-axis historised classification), `media_asset`
(first-class stored files), per-evidence assessment, polymorphic `claim` subject
(`subject_type` / `subject_id`), admin-area / ISO lookup tables, and the
`scenario → experiment → seeds_evaluation → benchmark` pipeline.

## Key relationships

- `publisher` 1—* `source`
- `source` *—* `claim` via `evidence`
- `event` 1—* `claim`; `claim` 1—* `assessment`
- `event` 1—* `event_participant` *—0..1 `actor`
- `actor` 1—* `ads_platform` (as developer); `actor` self 1—* (parent)
- `ads_platform` 1—* `ads_version`
- `event` *—0..1 `location` (primary); other locations via `location` claims
- `taxonomy` 1—* `taxonomy_term`; term self 1—* (hierarchy); terms referenced by
  most entities
- `revision` *—1 any core entity (polymorphic)
- `discovery_query` 1—* `discovery_run` 1—* `discovery_item` 1—* `ai_extraction`
- `discovery_item` / `submission` 0..1—1 `source` (on promotion)
- `event_relationship` *—* `event`

## Extension path

```
event → evidence → scenario → experiment → SEEDS evaluation → benchmark
```

`event` keeps a stable immutable id and a clean core so scenario extraction has
good inputs. Reaching later stages requires only additive tables.

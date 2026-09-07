# Data provenance and reproducibility

This document explains where White Box Autonomy's event data comes from,
what this repository does and does not contain, and what a researcher can
and cannot reproduce using only this repository.

## Two record origins

Every event in the Observatory carries an explicit **origin**, separate
from its verification status:

- **Curated** — individually discovered and authored from public evidence
  (news reporting, first-hand documentation, public video, etc.), with
  traceable sources and, where a curator has reviewed it, an explicit
  verification status. See `migration/legacy/` for the curated-event import
  pipeline and content.
- **Source-derived** — created through a validated, deterministic
  transformation of a structured third-party dataset, currently NHTSA's
  Standing General Order (SGO) crash-reporting data for automated driving
  systems. No AI involvement, no incident-by-incident curator review; see
  `docs/nhtsa-normalization-rulebook.md` for exactly what the transformation
  does and does not do.

## NHTSA source-derived records: what this repository contains and doesn't

**Upstream source:** NHTSA's Standing General Order crash-reporting
dataset, published at
<https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting>.

**This repository contains:**
- The complete transformation **pipeline code** (`migration/nhtsa/`):
  CSV parsing, field mapping, Same-Incident-ID grouping, the normalization
  rulebook's classification logic, and the SQL-generation/promotion/
  publication tooling, each with its own tests.
- The **rulebook** (`docs/nhtsa-normalization-rulebook.md`) that governs
  how a raw NHTSA candidate becomes a WBA event draft.
- A small number of already-public worked examples (e.g.
  `migration/nhtsa/wba-events/rehearse-promotion.sql`), scoped to
  individual events that are already public in the live Observatory.

**This repository deliberately does NOT contain:**
- NHTSA's raw CSV data, or any full-corpus generated artifact derived from
  it (import scripts, dry-run outputs, promotion SQL, verification
  projections). These are internal working artifacts of WBA's own
  development process, not something this code repository redistributes in
  bulk.
- Any record of which specific candidates were excluded from public
  promotion, or why — that classification lives in WBA's private
  development history, not in the public pipeline code.
- Historical normalization evaluation data: calibration sets, stress-test
  fixtures, scale-up evaluation batches, and their generated reports. These
  documented WBA's own internal validation process during development; the
  **rulebook** they validated is public, the validation data itself is not.
- Semantic AI-assisted discovery pilot data. Semantic AI discovery for
  curated events is a designed but not-yet-active capability (see
  `docs/discovery-pipeline.md`); its development pilot data is out of scope
  for this release.

**To reproduce the NHTSA transformation yourself:** download NHTSA's own
published SGO ADS incident-report CSVs from the URL above, place them where
`migration/nhtsa/pipeline.mjs` expects them (documented in that file — by
default `./data/nhtsa/`, or point `NHTSA_HISTORICAL_CSV` /
`NHTSA_CURRENT_CSV` at your own copies), and run the pipeline scripts in
`migration/nhtsa/`. The output should match the rulebook's documented
behaviour; it will not exactly match WBA's own historical working corpus,
since NHTSA's dataset is updated over time and WBA's production database
reflects a specific point-in-time import.

## Licensing of this material

See [`LICENSING.md`](./LICENSING.md) for the full breakdown; the short
version, specific to the material this document describes:

- WBA's Apache-2.0/CC BY 4.0 licensing (see `LICENSING.md`) covers WBA's
  own contribution on top of NHTSA's data — the transformation pipeline
  code, the normalization rulebook, and the classification/ontology
  structure it applies — **not** the underlying NHTSA source material
  itself. WBA does not claim ownership of, or an exclusive license over,
  NHTSA's own dataset.
- A source-derived event's facts remain traceable to their upstream NHTSA
  report; indexing, structuring, or classifying that information does not
  change who owns it.
- The same principle applies to curated events' third-party source
  material (news articles, videos, social-media posts, etc.): WBA's
  license covers WBA's own editorial description and its data model, not
  the linked/cited source material, which remains subject to its own
  applicable rights regardless of being indexed here.

## Curated events

`migration/legacy/manifest.ts` (in this repository) contains the public
content of WBA's curated events — the same information already visible on
each event's page in the live Observatory. Internal editorial working notes
that curators used during review are not part of this file; they were
never part of the published record and have been removed for this release.

## What the Observatory and map do and don't represent

- WBA provides a **structured research index of publicly available
  evidence**, not an authoritative determination of what occurred in any
  specific incident. Consult the linked source records for incident-level
  interpretation.
- The number of events associated with a developer, system, location, event
  type, or outcome reflects the composition and reporting characteristics
  of the underlying evidence sources — it is not a measure of relative
  safety or performance, and should not be read as statistically
  representative of real-world AV activity or incident rates.
- The interactive map's geographic distribution reflects where indexed
  evidence places events, at whatever precision (exact area, city, region,
  or country) the source actually supports — never assume it reflects the
  true underlying distribution of AV deployment or incidents, and never
  assume a point marks a precise incident location.

## Questions

For a question about a specific record, a data/privacy concern, or a
correction request, see [`SECURITY.md`](./SECURITY.md) or the contact
information on the live site's [Privacy](https://whiteboxautonomy.org/privacy)
page.

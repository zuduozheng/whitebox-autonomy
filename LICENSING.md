# Licensing

This repository contains more than one kind of material, and not everything
in it is covered by the same license. This document explains which license
applies to which part. It is a plain-language guide, not a substitute for
reading the actual license texts it points to.

## 1. WBA-authored software — Apache License 2.0

All WBA-authored software source code in this repository is licensed under
the **Apache License, Version 2.0** — see [`LICENSE`](./LICENSE) for the
full, unmodified license text.

This covers, where authored by White Box Autonomy:

- the application source code (`src/`);
- data-processing and migration scripts (`migration/`), including the
  NHTSA transformation/normalization pipeline code, the legacy-event
  import tooling, the map location-resolution logic, and the
  developer/operator canonicalization logic;
- database schema and security-policy definitions (`supabase/`);
- the public-release tooling itself (`scripts/`);
- other supporting software utilities in this repository.

This does **not** relicense any third-party software dependency (see
`package.json`) — each dependency remains under its own license, unchanged.

## 2. Eligible WBA-authored research/documentation content — CC BY 4.0

Eligible WBA-authored documentation and research content is licensed under
**Creative Commons Attribution 4.0 International (CC BY 4.0)**. The full
legal text is at <https://creativecommons.org/licenses/by/4.0/legalcode>
(human-readable summary: <https://creativecommons.org/licenses/by/4.0/>).
This repository references the official Creative Commons text rather than
reproducing or paraphrasing it.

This covers, where WBA authored the material and unless stated otherwise:

- the architecture, data-model, and discovery-pipeline documentation
  (`docs/architecture.md`, `docs/data-model.md`, `docs/discovery-pipeline.md`);
- the NHTSA normalization rulebook (`docs/nhtsa-normalization-rulebook.md`)
  and the semantic-AI design documentation
  (`migration/nhtsa/normalization/semantic-ai-design/`);
- WBA's ontology/taxonomy descriptions and event-type/outcome
  classifications (as described in code and documentation, not the
  underlying source facts they classify — see Section 3 and Section 4
  below);
- WBA's own methodology descriptions (`docs/`, `DATA_PROVENANCE.md`);
- eligible WBA-curated event content that WBA itself authored (e.g. the
  editorial description of a first-hand or public-evidence event) — not
  the third-party source material that content describes or links to.

## 3. Third-party and source material — not relicensed by WBA

WBA does not own, and does not purport to relicense, third-party or
externally authored material, including (as applicable) external news
content, third-party videos, social-media material, external reports, and
other source evidence that WBA links to, cites, quotes, or indexes. Linking
to, citing, extracting metadata from, or indexing such material does not
transfer ownership to WBA or bring it under Apache-2.0 or CC BY 4.0. Rights
in that material remain with its respective owners, or are governed by the
terms applicable to the original source.

## 4. NHTSA-derived material — provenance, not ownership

Source-derived event records in this repository are built from NHTSA's
Standing General Order (SGO) crash-reporting data, a U.S. federal
government source. Nothing in this repository's licensing is intended to
claim WBA ownership of, or an exclusive license over, that underlying
upstream NHTSA source material. What WBA licenses under Apache-2.0 and CC
BY 4.0 above is WBA's own original contribution on top of that source: the
transformation/normalization pipeline code, the classification and
ontology structure it applies, and the resulting organization of that
information into the WBA data model — not the underlying government
records themselves. See [`DATA_PROVENANCE.md`](./DATA_PROVENANCE.md) for
the full explanation of this boundary and where to obtain NHTSA's own
dataset directly.

## 5. Branding — excluded from both licenses

`public/branding/wba-logo.png` and `public/branding/m2cat.png` are project
branding assets, not software or research content, and are **not** licensed
under Apache-2.0 or CC BY 4.0. See [`TRADEMARKS.md`](./TRADEMARKS.md) for
what their inclusion in this repository does and does not permit.

## Licensing vs. academic citation

The licenses above describe what you may legally do with this repository's
material. They are a separate question from White Box Autonomy's preferred
academic citation (see the "Citation" section of [`README.md`](./README.md)
and [`CITATION.cff`](./CITATION.cff)): neither Apache-2.0 nor CC BY 4.0
requires citing WBA in a specific scholarly format — CC BY 4.0 does require
attribution for reuse of covered content, in whatever reasonable manner is
requested, and the preferred citation is one reasonable way to give it, but
the two obligations are not the same thing.

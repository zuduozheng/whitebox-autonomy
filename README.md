# White Box Autonomy

**Live site:** <https://whiteboxautonomy.org>

**Global AV Event Observatory** — a research platform that catalogues
real-world events involving automated-driving systems, with transparent
source provenance and explicit verification status.

White Box Autonomy is not a crash database, a safety ranking, or a
statistically representative sample of automated-vehicle performance. It is
a structured research index of publicly available evidence: every event
links to the sources it was built from, and the distribution of what's
indexed reflects what gets reported and discovered, not necessarily the
underlying distribution of real-world AV activity or incidents. See
[`DATA_PROVENANCE.md`](./DATA_PROVENANCE.md) for the full explanation, and
the in-app [Methodology](https://whiteboxautonomy.org/methodology) page for
how this is presented to readers.

## What's here

- **Observatory** — a browsable, filterable list of events (`/events`),
  each with its own detail page: sources, claims, verification status, and
  what remains unknown.
- **Interactive map** (`/map`) — an exploratory view of the rough spatial
  distribution of indexed events (city/region/country precision, never more
  precise than a source supports).
- **Curator workflow** — an authenticated admin area for reviewing
  community submissions and managing curated events, gated by Supabase Auth
  + Row-Level Security (no shared/static admin password).
- **NHTSA source-derived pipeline** (`migration/nhtsa/`) — a deterministic,
  non-AI transformation of NHTSA's Standing General Order ADS incident
  reports into WBA event records. See
  [`docs/nhtsa-normalization-rulebook.md`](./docs/nhtsa-normalization-rulebook.md)
  for the full rulebook and
  [`DATA_PROVENANCE.md`](./DATA_PROVENANCE.md) for what is and isn't
  reproducible from this repository alone.
- **Curated legacy events** (`migration/legacy/`) — the import pipeline and
  data for WBA's individually curated, first-hand and public-evidence
  events.

## Evidence philosophy

1. AI discovers and structures information; AI itself is never evidence.
2. Every machine-discovered event has traceable source provenance.
3. Missing facts are left unknown — never inferred or estimated.
4. An automated vehicle's involvement in an event is not the same as its
   being the cause.
5. Verification status is always explicit and stated in words.
6. AI-generated and curator-written text remain distinguishable.
7. Both failures and the successful handling of difficult situations are
   recorded, to reduce failure-only selection bias.

## Technology

| Concern | Choice |
| --- | --- |
| Framework | [Next.js](https://nextjs.org) 16 (App Router), React 19 |
| Language | TypeScript 5 (strict) |
| Database | [Supabase](https://supabase.com) / PostgreSQL, with Row-Level Security |
| Map | [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/) |
| Styling | Plain CSS + CSS Modules |
| Hosting (production) | [Vercel](https://vercel.com) |

## Getting started

Prerequisites: **Node.js 20+** and **npm** (developed against Node 24 LTS),
and a [Supabase](https://supabase.com) project (free tier is sufficient for
development).

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase project's values
npm run dev                  # http://localhost:3000
```

### Environment variables

See [`.env.example`](./.env.example) for the full, commented list. In
summary:

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Your Supabase project's REST endpoint. Public — sent with every request. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | The project's publishable/anon key. Constrained entirely by Row-Level Security; safe to expose to the browser. |
| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | Only for `/map` | A Mapbox **public** token (`pk.…`) from your own Mapbox account. Without it, `/map` renders a configuration notice instead of the map. |

Never add a Supabase **service-role** key to this project — it bypasses
Row-Level Security, must never reach the browser, and nothing here needs it.

### Database setup

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push                                    # applies every migration in supabase/migrations/
npx supabase db query --linked --file supabase/seed.sql # loads the small curated seed set
```

`supabase/migrations/` is the authoritative schema and security model:
every table, its Row-Level Security policies, and the curator/public access
boundary are defined there, in order, with an explanatory comment header on
each file.

### Available scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server (hot reload). |
| `npm run build` | Production build. |
| `npm run start` | Serve the production build locally. |
| `npm run lint` | Run ESLint. |
| `node --test <path-or-glob>` | Run a specific test file, e.g. `node --test src/lib/events/__tests__/repository.test.mjs`, or a directory's tests via a glob, e.g. `node --test "src/lib/events/__tests__/*.mjs"` (Node's built-in test runner; no separate test framework). |

## Project structure

```
whitebox-autonomy/
├── docs/                     Architecture, data model, discovery pipeline, and the
│                             NHTSA normalization rulebook
├── src/
│   ├── app/                  Next.js App Router: routes, layouts, page styles
│   │   ├── events/           Observatory: event list + /events/[slug] detail pages
│   │   ├── map/              Interactive map
│   │   ├── admin/            Curator/admin workflow (authenticated)
│   │   └── submit/           Public event-submission form
│   ├── components/           Shared UI
│   └── lib/
│       ├── events/           Event types, filters, canonicalization, data-access layer
│       ├── auth/             Curator authorization gate
│       └── supabase/         Supabase client construction (server + browser)
├── supabase/
│   ├── migrations/           Schema, RLS policies, and their explanatory history
│   └── seed.sql              The small curated seed dataset
└── migration/
    ├── nhtsa/                 NHTSA -> WBA transformation pipeline (code + rulebook)
    ├── legacy/                 Curated-event import pipeline + public event data
    ├── map/                    Map location-resolution reference data and logic
    └── developer-operator/     Developer/operator canonicalization audit + logic
```

The Observatory and Map read events only through
`src/lib/events/repository.ts` and `src/lib/events/map-repository.ts` — the
data-access boundary between the UI and Supabase.

## Reproducibility

This repository contains the complete application and the complete
NHTSA/legacy transformation **pipeline code**, but it does not mirror WBA's
internal working datasets, historical evaluation artifacts, or any
non-public event data. See [`DATA_PROVENANCE.md`](./DATA_PROVENANCE.md) for
exactly what you can and cannot reproduce from this repository alone, and
where to obtain the original public source data.

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) — target system architecture
- [`docs/data-model.md`](./docs/data-model.md) — conceptual data model
- [`docs/discovery-pipeline.md`](./docs/discovery-pipeline.md) — AI-assisted discovery design
- [`docs/nhtsa-normalization-rulebook.md`](./docs/nhtsa-normalization-rulebook.md) — the NHTSA transformation rulebook
- [`DATA_PROVENANCE.md`](./DATA_PROVENANCE.md) — what data this repository does and doesn't contain
- [`LICENSING.md`](./LICENSING.md) — the full software/content/branding licensing breakdown
- [`SECURITY.md`](./SECURITY.md) — how to report a vulnerability or a data/privacy concern
- [`TRADEMARKS.md`](./TRADEMARKS.md) — name/logo usage

## Status

**Beta 1.1.** The live Observatory, interactive map, curator workflow, and
NHTSA source-derived pipeline described above are implemented and running
in production. Semantic AI-assisted discovery for curated events is
designed (see `docs/discovery-pipeline.md`) but not yet active; curated
events are currently discovered and authored by a human curator.

## Citation

If you use White Box Autonomy, its event data, ontology, classifications,
methodology, or software in academic or research work, please cite:

> Zheng, Z. (2026). *White Box Autonomy: Global AV Event Observatory* (Beta
> 1.1). White Box Autonomy. <https://whiteboxautonomy.org>

Machine-readable citation metadata is also available in
[`CITATION.cff`](./CITATION.cff).

This citation is White Box Autonomy's preferred way to be credited in
research; it is separate from, and does not replace, the legal reuse
conditions in the licenses below.

## Licensing

- **Software** (application code, data-processing/migration scripts,
  database schema): [Apache License 2.0](./LICENSE).
- **Eligible WBA-authored research/documentation content** (methodology,
  ontology/taxonomy descriptions, WBA-authored documentation): [Creative
  Commons Attribution 4.0 International (CC BY
  4.0)](https://creativecommons.org/licenses/by/4.0/).
- **Third-party and source material** (news content, videos, social-media
  material, NHTSA's underlying source data, and other externally authored
  material this project links to, cites, or indexes) is **not** relicensed
  by WBA and remains subject to its own applicable rights — see
  [`DATA_PROVENANCE.md`](./DATA_PROVENANCE.md).
- **Project branding** (`public/branding/`) is excluded from both licenses
  above — see [`TRADEMARKS.md`](./TRADEMARKS.md).

See [`LICENSING.md`](./LICENSING.md) for the full breakdown.

## Who runs this

White Box Autonomy is developed and maintained by the M2CAT Lab at The
University of Queensland, with support from the Australian Research
Council Future Fellowship (FT250100337) and The University of Queensland.
The views expressed are those of the authors and do not necessarily reflect
the views of the Australian Research Council or the Australian Government.

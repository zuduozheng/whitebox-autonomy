# White Box Autonomy — target architecture

Status: **approved target.** Preserved here as the long-term direction. Only a
small subset is built at any given time; see "First public release" below.

## 1. Shape of the system

A **single Next.js application** deployed on Vercel, backed by a single Supabase
project (PostgreSQL + Auth + Storage). No monorepo, no separate backend service,
no Docker. The hard problems are editorial (taxonomy, provenance, verification)
and longevity (citable pages, exportable data), not scale — so the architecture
stays deliberately boring.

The app is split by route group, not by service:

| Component | Routes | Purpose |
| --- | --- | --- |
| Marketing / content | `/`, `/about`, `/methodology`, `/research`, `/how-discovery-works` | Static MDX-backed pages. |
| Observatory | `/events` | Filterable, searchable list of AV events. |
| Map | `/map` | Mapbox map, clustered markers, badge colour = review status. |
| Event detail | `/events/[slug]` | One citable page per event: labelled AI summary, full source list, "what we don't know", provenance/history. |
| Export / API | `/api/v1/events`, `/api/events.geojson`, `/export` | CSV / JSON / GeoJSON for researchers; always carries `origin` + `review_status`. |
| Admin / curation | `/admin/*` | Auth-gated. Event CRUD, discovery inbox, submission queue, review / correct / merge / reject / verify. |
| Public submission | `/submit` | URL + optional note + optional email; captcha + rate limit; writes to `submission`, never auto-public. |
| Discovery pipeline | scheduled (Vercel Cron) + `/api/cron/*` | See `discovery-pipeline.md`. |

## 2. What each part of the stack does

- **Next.js (on Vercel).** The entire application — public site *and* admin tool,
  one codebase, one deploy. Server Components and Route Handlers read/write
  Supabase directly. Static generation + on-demand revalidation for content and
  event pages (fast, cacheable, SEO-friendly, citable). Client components only
  where interactivity demands it (map, filters). Hosts export endpoints and the
  GeoJSON feed.
- **Supabase / PostgreSQL.** The single source of truth. Postgres holds
  relational event data, controlled vocabularies, provenance, and audit trail.
  PostGIS for geometry. Supabase Auth for the small set of internal users.
  Row-Level Security (RLS) puts authorization in the database. Storage holds
  evidence files. Migrations keep the schema versioned. **RLS is never disabled
  as a shortcut.**
- **Mapbox.** Client-side map rendering only — stores none of our data. Consumes
  a GeoJSON feed produced by Next.js from PostGIS. Its Geocoding API is also
  useful during curation.
- **Vercel.** Hosting and CI/CD for the Next.js app — Git-push deploys, preview
  deployments, edge CDN, serverless functions, cron, environment-variable
  management, domain + TLS.

## 3. Data flow (summary)

**Write / curation.** Curator signs in (Supabase Auth) → fills a form in `/admin`
→ Server Action validates with a shared Zod schema → writes to Postgres
server-side (RLS enforces role) → evidence files to Storage with hash → reviewer
sets status → every change writes a `revision` row → publish triggers path-scoped
revalidation.

**Read / public.** Content and event pages are pre-rendered and CDN-served. The
Observatory list is server-rendered per request against indexed Postgres queries
+ full-text search, with filter state in the URL. The map calls a GeoJSON
endpoint. Export streams query results.

**Discovery.** See `discovery-pipeline.md`.

**Public submission.** `/submit` → `submission` row (`status = new`) → curator
triage → promote into the normal draft → review → publish flow, keeping the
submission as provenance.

## 4. First public release — intended scope

Deliberately small:

- Homepage and key information pages.
- Observatory event list.
- Individual event pages.
- Interactive map.
- A small initial event dataset.
- Basic curator/admin workflow.
- Basic AI-assisted event discovery.
- Clear source provenance and unverified / curator-reviewed status.
- Basic public URL submission, if it does not materially delay launch.

## 5. Deferred (target capabilities, not for first release)

- Auto-extraction on human submissions; semantic (embedding) dedup and search.
- Multi-provider search fan-out; platform-specific ingestion (video, social).
- Contributor accounts, reputation, alerts, RSS-out.
- Per-claim verification UI, diff viewer, confidence-ranked review queue.
- Non-English source translation; batch re-extraction on model upgrades.
- Scenario extraction → experiment → SEEDS evaluation → benchmark.
- Entity-resolution tooling for operators / ADS versions.

## 6. Extension contract for the later pipeline

`event` keeps an immutable id and a clean structured core, and never absorbs
scenario-specific fields. A future `scenario` references `source_event_id`;
`experiment` references `scenario`; `seeds_evaluation` references `experiment`;
`benchmark` aggregates evaluations. Because taxonomies are already externalised
and claims/evidence are already first-class, reaching that stage requires only
additive tables — no rework.

## 7. Cross-cutting rules

- Configuration via environment variables, not source. A non-secret
  `.env.example` template is committed; real `.env*` files are git-ignored.
- When an external service is added, document what data is sent to it and why.
- Keep dependencies minimal; prefer the simplest maintainable solution.
- Small, reversible changes; clean Git history.

# NHTSA source-derived publication generator

Turns eligible private `origin='source-derived'` NHTSA events public, deterministically, without incident-by-incident curator review and without inventing content the source data doesn't support. Mirrors the private-promotion workflow's own discipline: generate → validate → review artifact → rehearsal → atomic apply → verify.

## Workflow

1. **Export production (read-only, not committed):**
   ```
   psql -v ON_ERROR_STOP=1 -t -A \
     -f migration/nhtsa/wba-events/publish/production-export-query.sql \
     -o migration/nhtsa/wba-events/publish/production-export.json
   ```
   `production-export.json` is a live database snapshot, not a deterministic build artifact — it is **not** committed to the repository (unlike `../wba-events-dry-run.jsonl`, which is derived purely from source code). Re-export immediately before generating `publish.sql`; do not reuse a stale export.

2. **Generate the reviewable artifacts:**
   ```
   node migration/nhtsa/wba-events/publish/build-publication-sql.mjs --emit
   node migration/nhtsa/wba-events/publish/build-verification-projection.mjs
   ```
   Writes `publish.sql`, `rollback-publish.sql`, `exception-report.json`, `publish-verification-projection.json`.

3. **Review** `publish.sql`, `rollback-publish.sql`, and `exception-report.json` before anything is applied.

4. **Rehearse** (a separate, later, independently-authorized step, not built by this slice) — `publish.sql` inside a `BEGIN...ROLLBACK`-only transaction. **Never** rehearse by committing and then unpublishing — see "first_published_at" below.

5. **Apply** (also a separate, later, independently-authorized step) via the same native `psql` connection already proven for `../promote.sql` / `../backfill-origin.sql`.

6. **Verify** the post-apply canonical hash against the pre-computed expected hash in `publish-verification-projection.json`.

## `first_published_at` is permanent

`enforce_event_publication_lifecycle` (`supabase/migrations/20260831003000_event_publication_lifecycle.sql`) stamps `first_published_at` the instant `is_public` first becomes `true`, and freezes it forever after — for every caller, including a trusted native-connection session. This is not suppressible and `rollback-publish.sql` does not attempt to. Concretely:

- A rehearsal of `publish.sql` must be `BEGIN...ROLLBACK`-only. If it ever commits, even briefly, the affected rows' `first_published_at` is permanently set — a later `rollback-publish.sql` run will correctly set them private again with a null title, but `first_published_at` stays populated, honestly reflecting that they *were* published.
- `rollback-publish.sql` is a recovery artifact for a real, already-committed problem — not a normal rehearsal mechanism.

## What this generator does not do

Does not touch `nhtsa_incident_candidate.status` anywhere. Does not generate `summary`, `observed_facts`, or `review_status` — a source-derived event publishes with exactly what it already has (per `20260908000000_event_origin.sql`). Does not reopen normalization, change the event-type taxonomy, or add any curator-review workflow. The authoritative event set is always `nhtsa_incident_candidate.linked_event_id -> event.id`; a slug pattern is never the write predicate (only ever a secondary consistency check).

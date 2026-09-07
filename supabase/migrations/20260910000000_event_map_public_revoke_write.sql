-- Defense-in-depth hardening for event_map_public — closes the one
-- discrepancy noted when 20260909000000_map_location_lookup.sql was
-- verified in production: that migration explicitly revoked
-- INSERT/UPDATE/DELETE on the two new tables (location_lookup,
-- curated_location_override) but omitted the matching revoke for the new
-- VIEW, event_map_public. Supabase's default privileges grant anon/
-- authenticated write access on every new relation in `public` (the same
-- behavior 20260829235332_observatory_core.sql's own comment describes for
-- `event`/`event_source`), so the view ended up with a nominal INSERT/
-- UPDATE/DELETE grant it was never meant to have.
--
-- Confirmed harmless before this migration was written: event_map_public is
-- a UNION ALL view with no INSTEAD OF trigger, so it is not automatically
-- updatable — Postgres itself rejects any INSERT/UPDATE/DELETE against it
-- regardless of the grant ("cannot insert into view ... Views containing
-- UNION, INTERSECT, or EXCEPT are not automatically updatable"), verified by
-- attempting exactly that as `anon` against production. This migration is
-- pure cleanup/consistency, not a fix for an exploitable gap.
--
-- SELECT is untouched. No table, trigger, function, or policy is touched.
-- ---------------------------------------------------------------------------

revoke insert, update, delete
  on public.event_map_public
  from anon, authenticated;

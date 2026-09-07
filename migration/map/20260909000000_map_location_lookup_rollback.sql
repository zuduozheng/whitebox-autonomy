-- Exact rollback for supabase/migrations/20260909000000_map_location_lookup.sql
--
-- NOT itself a Supabase migration — deliberately kept OUTSIDE
-- supabase/migrations/ (Supabase's migration runner treats every file in
-- that directory as a forward migration to apply in order; a rollback
-- script placed there could be auto-applied by mistake). Run by hand,
-- against the same project, only if a genuine rollback is needed.
--
-- WHAT THIS UNDOES, IN ORDER
--   1. The location_precision backfill — restored to 'unknown' for EXACTLY
--      the 86 curated event ids captured below (fetched from production via
--      the read-only anon key immediately before the migration was applied,
--      2026-09-09). Deliberately keyed by immutable event id, NOT by any
--      broader condition such as "origin = 'curated' AND location_precision
--      <> 'unknown'" — a condition like that would also revert any OTHER
--      curated event a curator has since correctly classified between the
--      migration and this rollback, which must never happen. Every id below
--      was confirmed, at the moment of capture, to currently read
--      location_precision = 'unknown' — i.e. this list is exactly and only
--      the set of rows the migration actually changed.
--   2. event_map_public (view)
--   3. curated_location_override (table — its RLS policies and grants are
--      dropped automatically with the table, no separate DROP POLICY needed)
--   4. location_lookup (table — same)
--
-- Dropped in dependency order: the view first (it reads the two tables),
-- then the tables. No CASCADE needed or used.
--
-- Does NOT touch: event_source, nhtsa_report, nhtsa_incident_candidate, any
-- publication-lifecycle trigger/function, or any event column other than
-- location_precision on the 86 rows listed below.
--
-- USAGE: run this file's statements as-is, in order, against the same
-- database the migration was applied to. Do not adapt the id list to a
-- different point in time — re-derive it fresh (the same way it was
-- captured here) if this rollback is ever needed against a database whose
-- curated-event population has since changed.
-- ---------------------------------------------------------------------------

-- 1. Restore location_precision to 'unknown' for exactly these 86 event ids.
update public.event
set location_precision = 'unknown'
where id in (
  '3b9ccf20-befd-46ee-b09f-9341479d3583',
  '73597eee-3471-45ed-aa4c-4bd800b284cb',
  '8326a0bd-4670-4fb0-b4df-0a5201fa7999',
  '4c383cd9-5fc3-4203-b135-bbeffe61f737',
  '75796eae-e620-49c7-a84b-c3eed2f3c827',
  '7336acc8-90d9-48e6-9ed0-4c88031e0119',
  '5c74c1d3-f499-434c-8d73-1b55af45d0a8',
  'e7da5cbd-21c1-4143-bf29-8d71beb2dd1e',
  '2365a191-76b3-4b65-8be6-8a83a71b6307',
  '8b8aeccf-a361-40cc-852e-19dddb787597',
  'd6a88b24-6255-4744-a651-7dad4d5eea8d',
  '3603f5f9-21e5-446e-8cac-c2baf4afe35a',
  '43c4fae6-1988-40f9-938f-868b073c520d',
  '0cd638fe-2f47-4052-aadd-eff9e7853e0b',
  '525dcb46-34ce-436b-8b90-a1bdca3ded18',
  '1ae34d10-a416-4835-b898-f6e0ac21d189',
  'ea29eada-45ec-4e3a-963e-76774e970c34',
  '91b43333-10ec-47aa-ba79-2a892424d4f0',
  '737f86ed-338d-47f7-a8b2-2e8b6351b8b8',
  '4e6c0410-2b01-475e-9960-75441c019848',
  'cf8f11f5-f26c-47a1-a0c6-4d3424e99ddf',
  '722d8bb4-b97e-47b2-b9fb-1e8bceeccdd6',
  '5dd0a270-c626-4e34-8164-cc936e4b0778',
  'e3056d7d-cd08-4edd-9c44-18e49abf0414',
  '68f6ede7-cfe1-4dfd-9dc9-667cb67a5c50',
  'a65fe827-11e7-4d48-842f-687c34162294',
  'f9f46dab-2936-4c52-879a-a914b9fe8880',
  '325ed38f-e8cd-4161-b959-fc475d7d6966',
  '7b695618-bbcf-41ae-9671-3588f310f9fb',
  'f13f9fbd-62ab-4716-ad1b-e2ed3e7eeb47',
  '59938d86-a96d-4d90-b3fd-61ae90f804b2',
  'fc3d337b-784c-41ba-be4c-36ace9963cd8',
  '71165778-24cd-43ee-9b60-ea9102d42e7e',
  '6a4d6f69-7cf2-46f6-8bd7-08f0ca7fcffd',
  '2288320b-12dc-46d1-8365-04b9cb09cd4f',
  '23811cd4-fa4c-4001-8349-7fbe934987ca',
  '003836bf-b2f1-4602-acfd-8e55b2849d13',
  'ecafccf1-99a8-479a-ba99-2466f59fd3a1',
  'fdbee022-dc19-44dc-93c9-20eb449f5b64',
  'b4e6846e-a051-4914-bc26-3746e5aab128',
  'e989c4ef-3237-468d-b9fa-d6e93542defe',
  '4b25b1e5-c385-45e6-8c01-105e38c6d1ce',
  '00ca8954-e8b3-4d10-9521-3b74fb300b7f',
  '508d41f0-9b93-4f78-8df4-6eeff377a980',
  '9f12df9b-56b1-4d0a-a235-7a139f32a852',
  '08835523-e6ee-41a0-af92-3cecdb50648f',
  '8ca47863-b239-46e3-8dee-4559e561918b',
  '22f7668c-6d36-4bb7-bb28-b97990373b9d',
  '382af891-d3bb-41b6-a31b-3271fec6377f',
  '30c092f2-2180-4c80-a664-72395e5db332',
  'b62ea99e-c6d9-4fc6-a483-57f29ef9298e',
  '0538c03b-73ac-4081-b4fa-3ceb7d4c02a0',
  '557c973a-3f21-4fd7-9cf1-3776a738b389',
  '9ca5b048-b0b5-4c75-b9c8-82a7fd621e5d',
  'fd8cfb9e-da0e-45cf-a8f2-bb4d47d124d0',
  '845ab51b-088b-4ca8-ad25-13401fd0caa5',
  '99c0f7aa-b1a6-4f74-a2ff-2508cdb032cd',
  '0464187c-6eb2-4e62-9024-f66589fad9ef',
  'e2bda56f-52d8-4e96-80af-110c87220861',
  'd3e84fb7-5625-4ab9-8b0c-8367913f300d',
  'a3f6b33a-703b-4818-b7db-db6d317fc29e',
  'b13eca6e-ffaa-4a1a-9b3c-db145d82beea',
  '4af1fd7d-860f-41f5-bde4-3d262139764a',
  '5540b31e-79bf-4ef6-a68d-dc2fa5170291',
  '32c10858-b0a5-44c4-a02f-817f3c0e4b22',
  '1d7bbbb9-c830-450e-b91b-9250177e27f7',
  'a7edff01-b863-4f82-a1ef-57cfe63da135',
  '1478049a-bc8d-444d-a5a3-e8b70377adc3',
  '71ac0a67-fb45-40dc-bf35-4a5147212418',
  '6c5b0c7e-3ff8-478e-be8c-f23df778cdb3',
  '476083a6-1480-4ce1-a59b-2656ffd24062',
  'd6048b48-44c6-4b9a-8718-2c13a4fc3fec',
  'cdd65262-b627-4e84-9620-44c5cff97a51',
  '41cd7e0d-5d19-496f-ab6a-929172cdaf0a',
  '4aa72468-32ce-4734-96bb-490ddef10c68',
  'cadbfc89-12d4-4576-89d1-6a619c6c00a1',
  '68e73eed-b5b8-4ed0-acd2-3ea32f0b9aae',
  '78ac9778-d04d-41ae-83b4-d0304bab9b8f',
  '00ddda52-90cf-47cb-aa0b-ee4bb591526a',
  '1d99fe1a-1f7f-4f43-9826-0fcfa5596693',
  '0fe70b85-9eb8-448a-b6e1-39e415f8e582',
  '93efab32-4511-4a76-bf5a-f369382e0d3a',
  '6012a9a2-da54-4440-9741-c51fba3dcbd6',
  'a011f873-902f-4e18-b001-683bc62ba25c',
  'bab49201-7965-4b85-8afa-4d6535df72bb',
  '62304026-f741-4247-b940-bbe90ff47284'
);
-- Expect: UPDATE 86 (all 86 ids exist and are currently affected). A lower
-- count means some of these events were deleted or already reverted since
-- capture — investigate before concluding the rollback is complete; do not
-- assume 86 or re-run.

-- 2. Drop the live-resolving view.
drop view if exists public.event_map_public;

-- 3. Drop the curated override table (RLS policies + grants go with it).
drop table if exists public.curated_location_override;

-- 4. Drop the location lookup table (RLS policies + grants go with it).
drop table if exists public.location_lookup;

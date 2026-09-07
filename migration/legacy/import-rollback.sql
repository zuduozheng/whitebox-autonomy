-- White Box Autonomy — legacy-event migration ROLLBACK.
--
-- GENERATED FILE. Regenerate with: node migration/legacy/build-import.mjs --emit
--
-- Removes ONLY the 76 events created by migration/legacy/import.sql, and
-- their event_source rows (via ON DELETE CASCADE). It references none of the
-- nine pre-existing Observatory events — their rows, sources, first_published_at
-- and audit columns are untouched.
--
-- The event_source_enforce_not_last trigger is cascade-safe: during the cascade
-- the parent event row is already gone from this transaction's view, so the
-- guard is skipped and the delete completes.
--
--     npx supabase db query --linked --file migration/legacy/import-rollback.sql
--
-- If a future policy ever grants event DELETE only to a role that must also
-- satisfy that trigger directly, run the belt-and-braces variant at the bottom
-- instead (unpublish -> delete sources -> delete events).

begin;

delete from event
 where slug in (
   'fsd-begins-a-right-turn-early-and-briefly-closes-on-an-oncoming-vehicle',
   'fsd-drives-through-a-narrow-crowded-local-street-without-incident',
   'fsd-moves-toward-a-parked-roadside-car-in-traffic-before-the-driver-intervenes',
   'fsd-completes-a-complex-multi-lane-roundabout',
   'fsd-stops-before-a-keep-clear-box-while-following-slow-traffic',
   'fsd-drifts-toward-oncoming-traffic-on-a-20-km-h-local-road',
   'fsd-waits-for-a-gap-before-merging-into-busy-main-road-traffic',
   'fsd-holds-40-km-h-in-a-70-km-h-zone-after-a-school-zone-period-ends',
   'fsd-does-not-stop-at-a-stop-line-and-the-driver-brakes-to-avoid-a-conflict',
   'fsd-exceeds-posted-speed-limits-on-a-curved-elevated-bypass',
   'fsd-performs-a-lane-change-the-driver-considered-aggressive',
   'fsd-interacts-with-a-pedestrian-who-addresses-the-vehicle',
   'fsd-changes-lanes-late-and-the-driver-intervenes-to-keep-the-intended-turn',
   'fsd-proceeds-through-a-signal-changing-to-amber-dilemma-zone-situation',
   'fsd-changes-lanes-without-signalling-in-heavy-afternoon-traffic',
   'fsd-departs-its-lane-while-merging-onto-the-bruce-highway',
   'fsd-departs-its-lane-on-a-local-road',
   'fsd-departs-its-lane-on-a-local-road-with-a-dashed-yellow-edge-line',
   'fsd-slows-and-drifts-near-a-side-road-where-a-stopped-car-was-not-visible-in',
   'fsd-changes-lanes-around-a-stopping-bus',
   'fsd-slows-almost-to-a-stop-for-a-puppy-near-the-roadway',
   'fsd-path-does-not-follow-road-markings-the-driver-does-not-intervene',
   'fsd-stops-over-a-bicycle-lane-while-waiting-at-a-traffic-light',
   'fsd-yields-to-a-truck-at-a-busy-intersection-and-does-not-proceed-on-its-green',
   'fsd-continues-to-accelerate-in-a-detected-school-zone-until-the-driver-brakes',
   'fsd-remains-stopped-while-a-motorcyclist-passes-in-slow-traffic',
   'fsd-stops-to-let-a-turning-car-through-at-an-uncontrolled-intersection',
   'fsd-slows-but-does-not-fully-stop-for-a-bus-encroaching-into-its-lane',
   'fsd-passes-a-cyclist-on-a-busy-road',
   'fsd-navigates-a-busy-roundabout-front-and-pillar-camera-views',
   'fsd-changes-lanes-twice-in-quick-succession-around-stopped-vehicles',
   'fsd-stops-ahead-of-a-marked-crossing-as-a-pedestrian-approaches',
   'fsd-passes-an-oncoming-vehicle-on-a-narrow-steep-unmarked-road',
   'in-car-display-shows-a-30-km-h-limit-on-a-50-km-h-road',
   'fsd-completes-a-u-turn-with-a-wrong-turn-signal',
   'fsd-begins-leaving-a-parking-space',
   'fsd-becomes-stuck-turning-left-onto-a-small-bridge',
   'fsd-moves-toward-oncoming-traffic-attempting-a-right-turn',
   'fsd-moves-to-the-far-lane-after-a-turn-when-the-near-lane-was-needed-for-an',
   'fsd-waits-for-young-pedestrians-at-night-and-shifts-its-path-away-from-an',
   'fsd-is-slow-to-reach-the-correct-lane-after-a-ramp-merge',
   'fsd-proceeds-through-an-intersection-as-the-signal-changes',
   'fsd-stops-mid-manoeuvre-in-a-parking-lot-after-another-car-yields',
   'fsd-moves-into-a-right-turn-only-lane-while-intending-to-turn-left',
   'fsd-travels-partly-on-the-shoulder-while-entering-a-freeway-via-an-on-ramp',
   'fsd-leaves-a-gap-for-a-merging-car-in-congested-traffic',
   'fsd-holds-on-a-green-light-to-avoid-stopping-in-the-intersection',
   'fsd-passes-a-stopped-car-on-a-narrow-busy-road',
   'fsd-crosses-into-the-oncoming-lane-while-making-a-right-turn',
   'fsd-moves-into-a-dedicated-right-turn-lane',
   'fsd-does-not-move-on-a-green-left-turn-arrow-until-the-driver-applies-the',
   'fsd-holds-position-in-a-parking-lot-a-car-ahead-then-begins-to-reverse',
   'fsd-delays-a-lane-change-and-signal-despite-the-driver-holding-the-indicator',
   'fsd-slows-for-an-ibis-on-the-roadway',
   'fsd-keeps-a-keep-clear-box-clear',
   'fsd-negotiates-a-face-to-face-situation-with-a-pick-up-truck-in-a-parking-lot',
   'fsd-leaves-the-carriageway-while-merging-not-following-the-lane-lines',
   'driverless-waymo-stops-between-active-train-tracks-as-a-train-passes',
   'waymo-obstructs-an-ambulance-and-police-vehicles-responding-to-an-incident-in',
   'tesla-on-fsd-is-struck-by-a-sliding-pickup-truck-on-a-snowy-highway',
   'tesla-on-fsd-does-not-visibly-change-speed-or-behaviour-in-heavy-fog-and-wet',
   'tesla-on-fsd-travels-well-above-the-posted-speed-limit-while-set-to-chill-mode',
   'tesla-on-fsd-leaves-the-road-onto-grass-to-pass-a-wrecked-bus',
   'waymo-crosses-into-an-oncoming-lane-in-austin',
   'waymo-edges-into-an-eight-lane-intersection-for-an-unprotected-left',
   'tesla-on-fsd-stops-in-a-construction-zone-then-proceeds-on-a-worker-hand-signal',
   'tesla-on-fsd-moves-left-after-a-construction-merge-sign-on-a-snowy-highway',
   'tesla-on-fsd-slows-for-a-pedestrian-approaching-a-crosswalk',
   'tesla-on-fsd-slows-at-a-green-light-for-a-wheelchair-user-crossing-in-heavy',
   'tesla-on-fsd-yields-space-to-a-signalling-semi-truck-then-passes',
   'tesla-on-fsd-trails-a-swaying-oversized-load',
   'waymo-stops-behind-a-manoeuvring-garbage-truck-on-a-narrow-street-and-traffic',
   'waymo-stops-for-a-scooter-that-falls-into-its-path',
   'waymo-steers-to-avoid-an-oncoming-wrong-way-driver-at-night',
   'tesla-on-fsd-drives-into-a-lane-closure-barrier-arm-on-ga-575',
   'zoox-and-a-waymo-stop-face-to-face-at-a-san-francisco-intersection-and-block'
 );

commit;

-- ---------------------------------------------------------------------------
-- Belt-and-braces variant (leave commented unless the plain delete is blocked):
--
-- begin;
--   update event set is_public = false
--    where slug in ( <the 76 slugs above> ) and is_public is true;
--   delete from event_source
--    where event_id in (select id from event where slug in ( <the 76 slugs> ));
--   delete from event
--    where slug in ( <the 76 slugs> );
-- commit;

/**
 * WBA Beta map — bounded query layer.
 *
 * Deliberately separate from `repository.ts` / `supabase-source.ts`: those
 * exist to load the ENTIRE public event corpus for the Observatory list
 * (`loadEvents()`, paginated past PostgREST's 1,000-row cap — see
 * supabase-source.ts's own comment on why that pagination exists). The map
 * must never do that; viewport + filters bound the query instead, capped at
 * MAP_QUERY_CAP regardless of how many events actually match.
 *
 * Reads from the `event_map_public` view (20260909000000_map_location_lookup
 * .sql), which already carries only public events (RLS-enforced, mirrored by
 * the view's own `is_public` filter) with a precomputed representative
 * DISPLAY point — no join, no full-corpus load, no PostGIS.
 *
 * NOT the /map page (not built yet) — just the data-access function it will
 * call.
 */

import { createClient } from "@supabase/supabase-js";

import { rawValuesForCanonicalDeveloper } from "./developer-operator.ts";
import type { EventType, Valence } from "./types";

// --- environment (same fail-fast contract as supabase-source.ts) ---------
const RAW_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!RAW_SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  const missing = [
    !RAW_SUPABASE_URL && "NEXT_PUBLIC_SUPABASE_URL",
    !SUPABASE_PUBLISHABLE_KEY && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ]
    .filter(Boolean)
    .join(", ");
  throw new Error(`Map data source is not configured: missing ${missing}. See .env.example.`);
}

const SUPABASE_URL = RAW_SUPABASE_URL.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Beta display cap: at most this many points are ever returned for one
 * query, however many match. Matches the product-approved "500-1000 events"
 * Beta range. Independent of PostgREST's own unrelated 1,000-row default cap
 * (supabase-source.ts) — the two happen to share a number, not a mechanism.
 */
export const MAP_QUERY_CAP = 1000;

export interface MapBounds {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

export interface MapQueryFilter {
  eventType?: EventType;
  valence?: Valence;
  /** A CANONICAL operator value (e.g. "Waymo") — see ./developer-operator.ts.
   *  The database has no notion of canonical grouping, so this is expanded
   *  to an `IN (...)` match over every raw value the canonical operator
   *  covers (rawValuesForCanonicalDeveloper) before the query is sent. */
  developerOrOperator?: string;
}

export interface MapPoint {
  slug: string;
  latitude: number;
  longitude: number;
  /** May be coarser than the event's own location_precision — see
   *  event_map_public's view comment (20260909000000_map_location_lookup.sql):
   *  this reflects what the map could actually resolve to a coordinate, not
   *  a claim about how precisely the location is known. */
  resolvedLevel: "city" | "region" | "country";
  eventType: EventType;
  valence: Valence;
  developerOrOperator: string;
}

export interface MapQueryResult {
  points: MapPoint[];
  /** Total events matching the viewport + filters, regardless of the cap. */
  matchedCount: number;
  /** Events actually returned in `points` — always <= MAP_QUERY_CAP. */
  returnedCount: number;
  cap: number;
}

interface MapPointRow {
  slug: string;
  latitude: number;
  longitude: number;
  resolved_level: string;
  event_type: string;
  valence: string;
  developer_or_operator: string;
}

function validateBounds(bounds: MapBounds): void {
  const { minLatitude, maxLatitude, minLongitude, maxLongitude } = bounds;
  for (const [name, value] of Object.entries(bounds)) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new Error(`Map query bounds.${name} must be a finite number, got ${JSON.stringify(value)}`);
    }
  }
  if (minLatitude > maxLatitude) {
    throw new Error(`Map query bounds: minLatitude (${minLatitude}) > maxLatitude (${maxLatitude})`);
  }
  if (minLatitude < -90 || maxLatitude > 90) {
    throw new Error("Map query bounds: latitude must be within [-90, 90]");
  }
  if (minLongitude < -180 || maxLongitude > 180) {
    throw new Error("Map query bounds: longitude must be within [-180, 180]");
  }
  // Antimeridian (date-line) crossing viewports are NOT handled in this Beta
  // pass — minLongitude > maxLongitude is treated as caller error rather than
  // silently returning an incomplete or wrapped result. Deferred: see
  // architecture report.
  if (minLongitude > maxLongitude) {
    throw new Error(
      "Map query bounds: minLongitude > maxLongitude (antimeridian-crossing viewports are not supported in Beta)",
    );
  }
}

function toMapPoint(row: MapPointRow): MapPoint {
  return {
    slug: row.slug,
    latitude: row.latitude,
    longitude: row.longitude,
    resolvedLevel: row.resolved_level as MapPoint["resolvedLevel"],
    eventType: row.event_type as EventType,
    valence: row.valence as Valence,
    developerOrOperator: row.developer_or_operator,
  };
}

/**
 * Bounded viewport + filter query: at most MAP_QUERY_CAP rows are ever
 * returned, however many match. `matchedCount` (from PostgREST's exact
 * count, via one `Prefer: count=exact` request — no second round trip) lets
 * the caller show "N events match this view. Showing <=1000."
 */
export async function queryMapEvents(
  bounds: MapBounds,
  filter: MapQueryFilter = {},
): Promise<MapQueryResult> {
  validateBounds(bounds);

  let query = supabase
    .from("event_map_public")
    .select("slug,latitude,longitude,resolved_level,event_type,valence,developer_or_operator", {
      count: "exact",
    })
    .gte("latitude", bounds.minLatitude)
    .lte("latitude", bounds.maxLatitude)
    .gte("longitude", bounds.minLongitude)
    .lte("longitude", bounds.maxLongitude);

  if (filter.eventType) query = query.eq("event_type", filter.eventType);
  if (filter.valence) query = query.eq("valence", filter.valence);
  // "IN" over every raw value the canonical operator covers, not "=" against
  // a single raw string — see MapQueryFilter.developerOrOperator's comment.
  // For an unmapped/unknown canonical value this degenerates to matching
  // only that literal string, the same as a plain equality would.
  if (filter.developerOrOperator) {
    query = query.in("developer_or_operator", rawValuesForCanonicalDeveloper(filter.developerOrOperator));
  }

  const { data, error, count } = await query.range(0, MAP_QUERY_CAP - 1);

  if (error) {
    throw new Error(`Failed to load map events (${error.code ?? "no code"}): ${error.message}`);
  }
  if (!data) {
    throw new Error("Supabase returned no data for the map query");
  }
  if (count === null) {
    throw new Error("Supabase did not return an exact count for the map query (Prefer: count=exact missing?)");
  }

  const points = (data as unknown as MapPointRow[]).map(toMapPoint);
  return {
    points,
    matchedCount: count,
    returnedCount: points.length,
    cap: MAP_QUERY_CAP,
  };
}

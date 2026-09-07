"use client";

/**
 * The Beta map's client-side view. Deliberately simple, per the approved
 * first-visual-milestone scope:
 *  - world map, pan/zoom, default Mapbox clustering;
 *  - queries the ALREADY-FROZEN `queryMapEvents()` bounded data layer
 *    (src/lib/events/map-repository.ts) by current viewport — never
 *    `loadEvents()`, never a full-corpus load;
 *  - re-queries on `moveend` (fires once movement has settled — a simple,
 *    adequate way to avoid refetching on every intermediate pan/zoom frame)
 *    AND whenever a filter changes, using whatever viewport is already
 *    showing (filters never reset pan/zoom);
 *  - the three shared Beta filters (event type, outcome, developer/
 *    operator) are the same model as Observatory's (lib/events/filter-
 *    params.ts) and drive the same `MapQueryFilter` queryMapEvents already
 *    accepted — no query-layer change;
 *  - no PostGIS, no heatmap, no custom GIS abstraction, no elaborate marker
 *    styling — one cluster layer, one point layer, both from Mapbox's own
 *    documented defaults.
 */

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Feature, FeatureCollection, Point } from "geojson";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { sharedFilterToQueryString, type SharedEventFilter } from "@/lib/events/filter-params";
import {
  EVENT_TYPE_OPTIONS,
  VALENCE_OPTIONS,
  eventTypeLabel,
  valenceLabel,
  valenceShortLabel,
} from "@/lib/events/labels";
import { queryMapEvents, type MapPoint } from "@/lib/events/map-repository";
import type { EventType, Valence } from "@/lib/events/types";

import styles from "./MapView.module.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

const SOURCE_ID = "events";
const CLUSTER_LAYER_ID = "clusters";
const CLUSTER_COUNT_LAYER_ID = "cluster-count";
const POINT_LAYER_ID = "unclustered-point";

const RESOLVED_LEVEL_LABEL: Record<MapPoint["resolvedLevel"], string> = {
  city: "city-level location",
  region: "region-level location",
  country: "country-level location",
};

function pointsToFeatureCollection(points: MapPoint[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: points.map(
      (point): Feature<Point> => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
        properties: {
          slug: point.slug,
          eventType: point.eventType,
          valence: point.valence,
          developerOrOperator: point.developerOrOperator,
          resolvedLevel: point.resolvedLevel,
        },
      }),
    ),
  };
}

/** Built via DOM APIs (not innerHTML) so no field — all sourced from public
 *  curator/regulatory data — can inject markup into the popup. */
function buildPopupContent(props: {
  slug: string;
  eventType: string;
  valence: string;
  developerOrOperator: string;
  resolvedLevel: string;
}): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = styles.popup;

  const title = document.createElement("strong");
  title.textContent = eventTypeLabel(props.eventType as Parameters<typeof eventTypeLabel>[0]);
  wrapper.appendChild(title);

  const meta = document.createElement("span");
  meta.className = styles.popupMeta;
  meta.textContent =
    `${props.developerOrOperator} · ${valenceShortLabel(props.valence as Parameters<typeof valenceShortLabel>[0])}`;
  wrapper.appendChild(meta);

  const precision = document.createElement("span");
  precision.className = styles.popupMeta;
  precision.textContent =
    `Approximate ${RESOLVED_LEVEL_LABEL[props.resolvedLevel as MapPoint["resolvedLevel"]] ?? "location"}`;
  wrapper.appendChild(precision);

  const link = document.createElement("a");
  link.href = `/events/${props.slug}`;
  link.textContent = "View event →";
  wrapper.appendChild(link);

  return wrapper;
}

interface QueryStatus {
  matched: number;
  returned: number;
  cap: number;
}

export default function MapView({
  initialFilter,
  developerOptions,
}: {
  initialFilter: SharedEventFilter;
  developerOptions: readonly string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const requestSeqRef = useRef(0);
  const [status, setStatus] = useState<QueryStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SharedEventFilter>(initialFilter);
  // Always holds the latest filter so `refetch` (stable via useCallback, so
  // the map-creation effect below never tears down/recreates the map) reads
  // current filters without needing to be recreated itself.
  const filterRef = useRef(filter);

  const refetch = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = map.getBounds();
    if (!bounds) return;

    // Mapbox GL can report longitudes outside [-180, 180] when the map is
    // zoomed out far enough to show repeated world copies. queryMapEvents()
    // rejects an out-of-range or antimeridian-crossing viewport (Beta
    // limitation documented on the frozen data layer) rather than silently
    // mishandling it, so this clamps to a valid range before querying —
    // falling back to the full longitude span on the rare wrapped case
    // instead of failing the whole view.
    let west = Math.max(-180, Math.min(180, bounds.getWest()));
    let east = Math.max(-180, Math.min(180, bounds.getEast()));
    if (west >= east) {
      west = -180;
      east = 180;
    }

    const seq = ++requestSeqRef.current;
    try {
      const result = await queryMapEvents(
        {
          minLatitude: Math.max(-90, bounds.getSouth()),
          maxLatitude: Math.min(90, bounds.getNorth()),
          minLongitude: west,
          maxLongitude: east,
        },
        filterRef.current,
      );
      if (seq !== requestSeqRef.current) return; // a newer request has since started

      setError(null);
      setStatus({ matched: result.matchedCount, returned: result.returnedCount, cap: result.cap });

      const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      source?.setData(pointsToFeatureCollection(result.points));
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load map data.");
    }
  }, []);

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      // Centered so the dominant North American event concentration is
      // visible on first load, while zoom stays low enough to keep a broad
      // global context (the rest of the world is still one small pan away).
      center: [-105, 27],
      zoom: 1.7,
    });
    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      // Simple default Mapbox clustering — step expressions copied from
      // Mapbox's own documented cluster example, not tuned further for Beta.
      map.addLayer({
        id: CLUSTER_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": ["step", ["get", "point_count"], "#a8c5dd", 25, "#6ea8d8", 100, "#1f4e79"],
          "circle-radius": ["step", ["get", "point_count"], 16, 25, 22, 100, 28],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.addLayer({
        id: CLUSTER_COUNT_LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
          "text-size": 12,
        },
        paint: { "text-color": "#ffffff" },
      });

      map.addLayer({
        id: POINT_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "#1f4e79",
          "circle-radius": 8,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
        },
      });

      // Clicking a cluster zooms/expands to it — the standard Mapbox pattern.
      map.on("click", CLUSTER_LAYER_ID, (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: [CLUSTER_LAYER_ID] });
        const clusterId = features[0]?.properties?.cluster_id;
        if (clusterId === undefined) return;
        const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err || zoom == null) return;
          const geometry = features[0].geometry as Point;
          map.easeTo({ center: geometry.coordinates as [number, number], zoom });
        });
      });

      // Clicking an individual point shows enough to identify the event and
      // a link to its full page.
      map.on("click", POINT_LAYER_ID, (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const geometry = feature.geometry as Point;
        const props = feature.properties as {
          slug: string;
          eventType: string;
          valence: string;
          developerOrOperator: string;
          resolvedLevel: string;
        };
        new mapboxgl.Popup({ closeButton: true, maxWidth: "260px" })
          .setLngLat(geometry.coordinates as [number, number])
          .setDOMContent(buildPopupContent(props))
          .addTo(map);
      });

      for (const layerId of [CLUSTER_LAYER_ID, POINT_LAYER_ID]) {
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      void refetch();
    });

    map.on("moveend", () => void refetch());

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [refetch]);

  // Reacts to every filter change: updates the URL and re-queries, using
  // whatever viewport is already showing (never resetting pan/zoom). Skips
  // the very first run (mount) — the URL already matches `filter` there
  // (it came from the server-parsed searchParams), and the map's own "load"
  // handler above already performs the initial fetch. `router.replace` and
  // `refetch` are deliberately called here, in an effect, rather than
  // inside `setFilter`'s updater in `updateFilter` below — calling a
  // side-effecting navigation update from inside a state updater function
  // is what produced React's "Cannot update a component (Router) while
  // rendering a different component (MapView)" warning during testing.
  const isFirstFilterEffect = useRef(true);
  useEffect(() => {
    filterRef.current = filter;
    if (isFirstFilterEffect.current) {
      isFirstFilterEffect.current = false;
      return;
    }
    const queryString = sharedFilterToQueryString(filter);
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    void refetch();
  }, [filter, refetch, pathname, router]);

  const updateFilter = useCallback((partial: Partial<SharedEventFilter>) => {
    setFilter((previous) => ({ ...previous, ...partial }));
  }, []);

  if (!MAPBOX_TOKEN) {
    return (
      <div className={styles.notice}>
        <h2>Mapbox access token needed</h2>
        <p>
          The map needs a Mapbox public access token to render. Add it to{" "}
          <code>.env.local</code> as <code>NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code>{" "}
          (a token starting with <code>pk.</code>, from{" "}
          <a href="https://account.mapbox.com/access-tokens/">
            account.mapbox.com/access-tokens
          </a>
          ), then restart the dev server.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <form className={styles.filters} aria-label="Filter map events">
        <div className={styles.field}>
          <label htmlFor="map-eventType">Event type</label>
          <select
            id="map-eventType"
            value={filter.eventType ?? ""}
            onChange={(e) =>
              updateFilter({ eventType: (e.target.value || undefined) as EventType | undefined })
            }
          >
            <option value="">All</option>
            {EVENT_TYPE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {eventTypeLabel(value)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="map-valence">Outcome</label>
          <select
            id="map-valence"
            value={filter.valence ?? ""}
            onChange={(e) =>
              updateFilter({ valence: (e.target.value || undefined) as Valence | undefined })
            }
          >
            <option value="">All</option>
            {VALENCE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {valenceLabel(value)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="map-developerOrOperator">Developer / operator</label>
          <select
            id="map-developerOrOperator"
            value={filter.developerOrOperator ?? ""}
            onChange={(e) => updateFilter({ developerOrOperator: e.target.value || undefined })}
          >
            <option value="">All</option>
            {developerOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        {filter.eventType || filter.valence || filter.developerOrOperator ? (
          <button
            type="button"
            className={styles.clear}
            onClick={() =>
              updateFilter({ eventType: undefined, valence: undefined, developerOrOperator: undefined })
            }
          >
            Clear
          </button>
        ) : null}
      </form>

      <div ref={containerRef} className={styles.map} />
      <div className={styles.statusBar}>
        {error ? (
          <p className={styles.error}>{error}</p>
        ) : status ? (
          <p>
            <strong>{status.matched.toLocaleString()}</strong>{" "}
            {status.matched === 1 ? "event matches" : "events match"} this
            view.
            {status.returned < status.matched
              ? ` Showing ${status.returned.toLocaleString()} (capped at ${status.cap.toLocaleString()}). Zoom in or pan to narrow the view.`
              : status.matched > 0
                ? ` Showing all ${status.returned.toLocaleString()}.`
                : ""}
          </p>
        ) : (
          <p>Loading map data&hellip;</p>
        )}
      </div>
    </div>
  );
}

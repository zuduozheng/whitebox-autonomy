import type { Metadata } from "next";

import prose from "@/components/prose.module.css";
import ViewSwitch from "@/components/ViewSwitch";
import { parseSharedFilterParams, sharedFilterToQueryString } from "@/lib/events/filter-params";
import { listDeveloperOrOperatorOptions } from "@/lib/events/repository";
import { socialMetadata } from "@/lib/seo";

import MapView from "./MapView";
import styles from "./page.module.css";

const description =
  "An exploratory map of the rough spatial distribution of Observatory " +
  "events. Not a precise geospatial record — see the note below the map.";

export const metadata: Metadata = {
  title: "Map",
  description,
  ...socialMetadata({ title: "Map", description, path: "/map" }),
};

export default async function MapPage({ searchParams }: PageProps<"/map">) {
  const params = (await searchParams) ?? {};
  // Same option list, same parsing rules as Observatory (lib/events/filter-
  // params.ts) — a URL built on either route is valid, unmodified, on the
  // other.
  const developerOptions = await listDeveloperOrOperatorOptions();
  const initialFilter = parseSharedFilterParams(params, developerOptions);
  const queryString = sharedFilterToQueryString(initialFilter);

  return (
    <main className={styles.page}>
      <header className={styles.intro}>
        <h1>Map</h1>
        <p className={prose.lede}>
          A rough, exploratory view of where Observatory events have been
          reported. Pan and zoom to explore; click a point or a cluster to
          look closer.
        </p>
        <p className={styles.caveat}>
          Map points are approximate. Depending on what a source reports, a
          point may represent an exact area, a city, a region, or only a
          country &mdash; never assume it marks the precise incident
          location. See <a href="/methodology">methodology</a> for how
          location precision is recorded.
        </p>
      </header>

      <ViewSwitch active="map" queryString={queryString} />

      <MapView initialFilter={initialFilter} developerOptions={developerOptions} />
    </main>
  );
}

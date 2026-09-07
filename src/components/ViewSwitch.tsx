import Link from "next/link";

import styles from "./ViewSwitch.module.css";

/**
 * The "List | Map" control shared by Observatory and Map. `queryString` is
 * the current filter state (from lib/events/filter-params.ts), carried over
 * to whichever view isn't active — never the map's own viewport/pan/zoom,
 * which this deliberately has no knowledge of.
 */
export default function ViewSwitch({
  active,
  queryString,
}: {
  active: "list" | "map";
  queryString: string;
}) {
  const suffix = queryString ? `?${queryString}` : "";

  return (
    <nav className={styles.switch} aria-label="Switch view">
      {active === "list" ? (
        <span className={`${styles.option} ${styles.active}`}>List</span>
      ) : (
        <Link href={`/events${suffix}`} className={styles.option}>
          List
        </Link>
      )}
      <span className={styles.separator} aria-hidden="true">
        |
      </span>
      {active === "map" ? (
        <span className={`${styles.option} ${styles.active}`}>Map</span>
      ) : (
        <Link href={`/map${suffix}`} className={styles.option}>
          Map
        </Link>
      )}
    </nav>
  );
}

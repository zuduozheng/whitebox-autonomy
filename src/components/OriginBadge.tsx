import { originLabel } from "@/lib/events/labels";
import type { Origin } from "@/lib/events/types";

import styles from "./ReviewStatusBadge.module.css";

/**
 * Text-first badge for how a WBA event record was created. Shown alongside
 * or instead of {@link ReviewStatusBadge} — origin (a fixed fact) and
 * review_status (an optional, independent curator judgement) are both
 * surfaced when both exist; neither replaces the other. Reuses
 * ReviewStatusBadge's CSS module: the visual treatment ("badge") is generic,
 * not review-status-specific.
 */
export default function OriginBadge({ origin }: { origin: Origin }) {
  return <span className={styles.badge}>{originLabel(origin)}</span>;
}

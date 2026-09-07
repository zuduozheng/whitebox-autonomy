import { reviewStatusLabel } from "@/lib/events/labels";
import type { ReviewStatus } from "@/lib/events/types";

import styles from "./ReviewStatusBadge.module.css";

/**
 * Text-first badge for the standing of an Observatory record. The wording alone
 * carries the meaning; the border and fill are decoration, not the signal, and
 * there is no colour coding.
 */
export default function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  return <span className={styles.badge}>{reviewStatusLabel(status)}</span>;
}

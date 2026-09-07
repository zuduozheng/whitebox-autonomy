import { formatPartialDate } from "@/lib/events/format";
import type { PartialDate } from "@/lib/events/types";

import styles from "./PartialDateText.module.css";

/**
 * Renders a {@link PartialDate} and, unless `withQualifier` is false, appends a
 * short note when the date is coarser than a single day, so a reader is never
 * misled about how precisely the date is known.
 */
const QUALIFIER: Record<PartialDate["precision"], string | null> = {
  day: null,
  month: "day not known",
  year: "month not known",
  unknown: null,
};

export default function PartialDateText({
  date,
  withQualifier = true,
}: {
  date: PartialDate;
  withQualifier?: boolean;
}) {
  const qualifier = QUALIFIER[date.precision];
  return (
    <span>
      {formatPartialDate(date)}
      {withQualifier && qualifier ? (
        <span className={styles.qualifier}> ({qualifier})</span>
      ) : null}
    </span>
  );
}

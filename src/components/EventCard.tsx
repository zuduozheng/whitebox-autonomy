import Link from "next/link";

import PartialDateText from "@/components/PartialDateText";
import {
  eventTypeLabel,
  originLabel,
  reviewStatusLabel,
  valenceShortLabel,
} from "@/lib/events/labels";
import type { EventSummary } from "@/lib/events/types";

import styles from "./EventCard.module.css";

/**
 * One entry in the Observatory list. Renders only {@link EventSummary} fields.
 *
 * The outcome/valence leads the card in a fixed position with its wording always
 * shown; the coloured dot and the coloured left edge are a supplementary cue
 * only, and nothing here is conveyed by colour alone. The event title is the
 * single link — the card is not clickable as a whole.
 */
export default function EventCard({ event }: { event: EventSummary }) {
  return (
    <article className={styles.card} data-valence={event.valence}>
      <p className={styles.outcome}>{valenceShortLabel(event.valence)}</p>
      <h2 className={styles.title}>
        <Link href={`/events/${event.slug}`}>{event.title}</Link>
      </h2>
      <p className={styles.meta}>
        <PartialDateText date={event.occurredOn} />
        {" · "}
        {event.developerOrOperator}
        {event.systemName ? ` · ${event.systemName}` : ""}
      </p>
      <p className={styles.facets}>
        <span className={styles.facetPrimary}>
          {eventTypeLabel(event.eventType)}
        </span>
        <span>
          {event.sourceCount} {event.sourceCount === 1 ? "source" : "sources"}
        </span>
        {/* A source-derived event may have no review_status; never render a
            misleading blank/invalid badge — show its origin instead. */}
        <span>
          {event.reviewStatus ? reviewStatusLabel(event.reviewStatus) : originLabel(event.origin)}
        </span>
      </p>
    </article>
  );
}

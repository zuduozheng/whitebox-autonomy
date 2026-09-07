import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import OriginBadge from "@/components/OriginBadge";
import PartialDateText from "@/components/PartialDateText";
import ReviewStatusBadge from "@/components/ReviewStatusBadge";
import SourceList from "@/components/SourceList";
import { formatIsoDate } from "@/lib/events/format";
import {
  automationStatusLabel,
  causationStatusLabel,
  eventTypeLabel,
  locationPrecisionLabel,
  originLabel,
  reviewStatusLabel,
  valenceLabel,
} from "@/lib/events/labels";
import { getEventBySlug, listEventSlugs } from "@/lib/events/repository";
import { socialMetadata } from "@/lib/seo";

import styles from "./page.module.css";

// Regenerate each event page from Supabase at most every 5 minutes (ISR).
export const revalidate = 300;

export async function generateStaticParams() {
  const slugs = await listEventSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/events/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return { title: "Event not found" };
  // A source-derived event may have no curator-written summary. This
  // fallback is computed only for the metadata description — never persisted
  // into event.summary, and never interpretive: it names no fact about the
  // incident beyond the title, which is already deterministic/structured.
  const description =
    event.summary ??
    `${event.title} — a source-derived WBA record. See structured details and sources below.`;
  return {
    title: event.title,
    description,
    ...socialMetadata({
      title: event.title,
      description,
      path: `/events/${slug}`,
    }),
  };
}

export default async function EventDetailPage({
  params,
}: PageProps<"/events/[slug]">) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  const hasVersion =
    event.systemVersion &&
    event.systemVersion.knowledge !== "unknown" &&
    event.systemVersion.value;

  return (
    <main className={styles.page}>
      <p className={styles.backlink}>
        <Link href="/events">&larr; Back to the Observatory</Link>
      </p>

      <header className={styles.header}>
        <h1>{event.title}</h1>
        <dl className={styles.meta}>
          <div>
            <dt>Date</dt>
            <dd>
              <PartialDateText date={event.occurredOn} />
            </dd>
          </div>
          <div>
            <dt>Developer / operator</dt>
            <dd>{event.developerOrOperator}</dd>
          </div>
          {event.systemName ? (
            <div>
              <dt>System</dt>
              <dd>{event.systemName}</dd>
            </div>
          ) : null}
          {event.location ? (
            <div>
              <dt>Location</dt>
              <dd>
                {event.location.text}
                {event.location.precision !== "unknown"
                  ? ` — ${locationPrecisionLabel(event.location.precision)}`
                  : ""}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Event type</dt>
            <dd>{eventTypeLabel(event.eventType)}</dd>
          </div>
          <div>
            <dt>Outcome</dt>
            <dd>{valenceLabel(event.valence)}</dd>
          </div>
          <div>
            <dt>Automation status</dt>
            <dd>{automationStatusLabel(event.automationStatus)}</dd>
          </div>
        </dl>
        <div className={styles.statusRow}>
          {/* Both facts are independent and both are shown when both exist —
              origin never replaces a genuine review status, or vice versa. */}
          {event.reviewStatus ? <ReviewStatusBadge status={event.reviewStatus} /> : null}
          {event.origin === "source-derived" ? <OriginBadge origin={event.origin} /> : null}
        </div>
      </header>

      <section aria-label="Evidence and assessment" className={styles.band}>
        {event.summary ? (
          <section className={styles.section}>
            <h2>Summary</h2>
            <p className={styles.summary}>{event.summary}</p>
            <p className={styles.attribution}>
              Written by White Box Autonomy from the sources listed below.
            </p>
          </section>
        ) : null}

        <section className={styles.section}>
          <h2>What is observable from the evidence</h2>
          {event.observedFacts.length > 0 ? (
            <ul>
              {event.observedFacts.map((fact, index) => (
                <li key={index}>{fact}</li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>
              No individually observed facts are recorded for this record; see
              its structured details and sources instead.
            </p>
          )}
        </section>

        <section className={styles.section}>
          <h2>Automation status</h2>
          <p>{automationStatusLabel(event.automationStatus)}</p>
          <p className={styles.attribution}>
            Whether the driving-automation feature was engaged is a separate
            question from whether it caused the event.
          </p>
        </section>

        <section className={styles.section}>
          <h2>System / software version</h2>
          {hasVersion ? (
            <p>
              {event.systemVersion?.value}
              {event.systemVersion?.knowledge === "approximate"
                ? " (approximate)"
                : null}
            </p>
          ) : (
            <p className={styles.muted}>
              Not identified in the available sources.
            </p>
          )}
        </section>

        <section className={styles.section}>
          <h2>Causal attribution</h2>
          <p>{causationStatusLabel(event.causation.status)}</p>
          {event.causation.status === "undetermined" ? (
            <p className={styles.muted}>
              The available evidence does not establish a cause. Involvement of a
              driving-automation system is not the same as its being a cause.
            </p>
          ) : null}
          {event.causation.note ? <p>{event.causation.note}</p> : null}
        </section>

        <section className={styles.section}>
          <h2>What remains unknown</h2>
          {event.unknowns.length > 0 ? (
            <ul>
              {event.unknowns.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>
              The available evidence does not leave anything specific
              unestablished for this event.
            </p>
          )}
        </section>
      </section>

      <section aria-label="Interpretation" className={styles.band}>
        <section className={styles.section}>
          <h2>Interpretation</h2>
          {event.interpretation ? (
            <div className={styles.interpretation}>
              <p className={styles.interpretationLabel}>
                Curator interpretation &mdash; this goes beyond what the evidence
                directly shows
              </p>
              <p>{event.interpretation}</p>
            </div>
          ) : (
            <p className={styles.muted}>
              No interpretation is offered for this event.
            </p>
          )}
        </section>
      </section>

      <section aria-label="Sources and provenance" className={styles.band}>
        <section className={styles.section}>
          <h2>Sources &amp; evidence</h2>
          <p className={styles.attribution}>
            The sources below are the evidence. The summary and any interpretation
            on this page are written by White Box Autonomy and are not themselves
            evidence.
          </p>
          <SourceList sources={event.sources} />
        </section>

        <section className={styles.section}>
          <h2>About this record</h2>
          {event.reviewStatus ? (
            <p>
              Review status: <strong>{reviewStatusLabel(event.reviewStatus)}</strong>.{" "}
              <Link href="/methodology">What the review statuses mean</Link>.
            </p>
          ) : null}
          {event.origin === "source-derived" ? (
            <p>
              Origin: <strong>{originLabel(event.origin)}</strong>.{" "}
              <Link href="/methodology">What this means</Link>.
            </p>
          ) : null}
          <p className={styles.muted}>
            Record last reviewed or updated: {formatIsoDate(event.recordUpdated)}.
          </p>
          <p className={styles.muted}>
            To report an error or raise a concern about this record, contact{" "}
            <a href="mailto:zuduo.zheng@uq.edu.au">zuduo.zheng@uq.edu.au</a>.
          </p>
        </section>
      </section>
    </main>
  );
}

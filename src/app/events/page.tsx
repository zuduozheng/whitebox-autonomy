import type { Metadata } from "next";
import Link from "next/link";

import EventCard from "@/components/EventCard";
import prose from "@/components/prose.module.css";
import ViewSwitch from "@/components/ViewSwitch";
import { sharedFilterToQueryString } from "@/lib/events/filter-params";
import {
  EVENT_TYPE_OPTIONS,
  VALENCE_OPTIONS,
  eventTypeLabel,
  valenceLabel,
} from "@/lib/events/labels";
import { getEventsPageData, OBSERVATORY_PAGE_SIZE } from "@/lib/events/repository";
import { socialMetadata } from "@/lib/seo";

import Pagination from "./Pagination";
import styles from "./page.module.css";

// Revalidate the Observatory list from Supabase at most every 5 minutes.
export const revalidate = 300;

const description =
  "A growing, multi-source collection of real-world driving-automation " +
  "events, each with traceable original sources.";

export const metadata: Metadata = {
  title: "Observatory",
  description,
  ...socialMetadata({ title: "Observatory", description, path: "/events" }),
};

export default async function EventsPage({
  searchParams,
}: PageProps<"/events">) {
  const params = (await searchParams) ?? {};
  // One loadEvents() call for the filter, one page of the filtered list, the
  // stats, and the developer-option list together — see getEventsPageData's
  // own doc comment on why this is one function rather than several calls.
  const { filter, events, matchedCount, page, totalPages, stats, developerOptions } =
    await getEventsPageData(params);
  const { eventType, valence, developerOrOperator } = filter;
  const isFiltered = Boolean(eventType || valence || developerOrOperator);
  // The shared filter query string — eventType/valence/developerOrOperator
  // only, deliberately never `page` (see Pagination.tsx and ViewSwitch: Map
  // has no notion of a page, and List<->Map switching must strip it).
  const queryString = sharedFilterToQueryString(filter);
  const rangeStart = matchedCount === 0 ? 0 : (page - 1) * OBSERVATORY_PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * OBSERVATORY_PAGE_SIZE, matchedCount);

  return (
    <main className={styles.page}>
      <header className={styles.intro}>
        <h1>Observatory</h1>
        <p className={prose.lede}>
          A growing, multi-source collection of real-world driving-automation
          events &mdash; individually curated public evidence alongside
          source-derived regulatory records. Each record links to its
          original sources.
        </p>
        <p className={styles.caveat}>
          This is a convenience collection built from the Observatory&rsquo;s
          defined evidence sources, not a systematic census, and it is{" "}
          <strong>not</strong> statistically representative of any
          system&rsquo;s performance. Event counts by developer, system, or
          outcome reflect the composition and reporting characteristics of
          those sources &mdash; they are not safety rates or rankings, and
          they are not evidence that any system is safer or less safe than
          another. See <Link href="/methodology">methodology</Link> for how
          curated and source-derived records differ.
        </p>
      </header>

      <ViewSwitch active="list" queryString={queryString} />

      <section className={styles.summary} aria-label="Sample composition">
        {stats.total === 0 ? (
          <p>
            <strong>0</strong> events recorded.
          </p>
        ) : (
          <p>
            <strong>{stats.total}</strong>{" "}
            {stats.total === 1 ? "event" : "events"} recorded &mdash;{" "}
            {stats.byValence["failure-or-challenging"]} failure / challenging,{" "}
            {stats.byValence["successful-handling"]} successful handling,{" "}
            {stats.byValence["neutral-or-unclear"]} neutral / unclear.
          </p>
        )}
        <p className={styles.filterCount}>
          {matchedCount === 0
            ? isFiltered
              ? "0 events match the current filter."
              : "0 events found."
            : `${matchedCount.toLocaleString()} ${matchedCount === 1 ? "event" : "events"} ${
                isFiltered ? "match the current filter" : "found"
              } · Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()}`}
        </p>
      </section>

      <form className={styles.filters} method="get" aria-label="Filter events">
        <div className={styles.field}>
          <label htmlFor="eventType">Event type</label>
          <select id="eventType" name="eventType" defaultValue={eventType ?? ""}>
            <option value="">All</option>
            {EVENT_TYPE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {eventTypeLabel(value)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="valence">Outcome</label>
          <select id="valence" name="valence" defaultValue={valence ?? ""}>
            <option value="">All</option>
            {VALENCE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {valenceLabel(value)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="developerOrOperator">Developer / operator</label>
          <select
            id="developerOrOperator"
            name="developerOrOperator"
            defaultValue={developerOrOperator ?? ""}
          >
            <option value="">All</option>
            {developerOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.actions}>
          <button type="submit">Apply</button>
          {isFiltered ? (
            <Link href="/events" className={styles.clear}>
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {events.length === 0 ? (
        <p className={styles.empty}>
          {stats.total === 0
            ? "No events have been added to the Observatory yet."
            : "No events match the current filter."}
        </p>
      ) : (
        <>
          <ul className={styles.list}>
            {events.map((event) => (
              <li key={event.slug}>
                <EventCard event={event} />
              </li>
            ))}
          </ul>
          <Pagination page={page} totalPages={totalPages} filterQueryString={queryString} />
        </>
      )}
    </main>
  );
}

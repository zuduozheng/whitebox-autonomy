import type { Metadata } from "next";
import Link from "next/link";

import { listAdminEvents } from "@/lib/admin/events";
import { requireCurator } from "@/lib/auth/require-curator";
import { formatIsoDate } from "@/lib/events/format";
import {
  automationStatusLabel,
  reviewStatusLabel,
} from "@/lib/events/labels";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Events",
  robots: { index: false, follow: false },
};

export default async function AdminEventsPage() {
  await requireCurator();
  const events = await listAdminEvents();

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Events</h1>
          <p className={styles.intro}>
            {events.length === 0
              ? "No events yet."
              : `${events.length} ${events.length === 1 ? "event" : "events"}, newest first.`}
          </p>
        </div>
        <Link href="/admin/events/new" className={styles.newButton}>
          New event
        </Link>
      </div>

      {events.length > 0 ? (
        <ul className={styles.list}>
          {events.map((event) => (
            <li key={event.id}>
              <Link
                href={`/admin/events/${event.id}/edit`}
                className={styles.row}
              >
                <span className={styles.title}>
                  {event.title || "(untitled draft)"}
                </span>
                <span className={styles.meta}>
                  <span
                    className={styles.badge}
                    data-variant={event.isPublic ? "public" : "draft"}
                  >
                    {event.isPublic ? "Public" : "Draft"}
                  </span>
                  <span>
                    {event.reviewStatus
                      ? reviewStatusLabel(event.reviewStatus)
                      : "Not yet reviewed"}
                  </span>
                  <span>{event.developerOrOperator || "Developer/operator —"}</span>
                  <span>{automationStatusLabel(event.automationStatus)}</span>
                  <span>Updated {formatIsoDate(event.recordUpdated)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <p className={styles.back}>
        <Link href="/admin">Back to dashboard</Link>
      </p>
    </main>
  );
}

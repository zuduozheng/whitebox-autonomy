import type { Metadata } from "next";
import Link from "next/link";

import { createEventAction } from "@/app/admin/(protected)/events/actions";
import EventForm from "@/app/admin/(protected)/events/EventForm";
import { requireCurator } from "@/lib/auth/require-curator";
import { emptyEventFormValues } from "@/lib/admin/event-form";

import styles from "../page.module.css";

export const metadata: Metadata = {
  title: "New event",
  robots: { index: false, follow: false },
};

export default async function NewEventPage() {
  await requireCurator();

  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>New event</h1>
          <p className={styles.intro}>
            Creates a <strong>draft</strong>. Nothing is published — a draft is
            private until it is published in a later step.
          </p>
        </div>
      </div>

      <EventForm
        mode="create"
        action={createEventAction}
        initialValues={emptyEventFormValues(today)}
        cancelHref="/admin/events"
      />

      <p className={styles.back}>
        <Link href="/admin/events">Back to events</Link>
      </p>
    </main>
  );
}

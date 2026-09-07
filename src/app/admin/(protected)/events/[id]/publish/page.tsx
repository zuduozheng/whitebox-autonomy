import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { publishEventAction } from "@/app/admin/(protected)/events/actions";
import { countEventSources, getAdminEvent } from "@/lib/admin/events";
import { missingPublicationRequirements } from "@/lib/admin/event-form";
import { requireCurator } from "@/lib/auth/require-curator";

import styles from "../../page.module.css";

export const metadata: Metadata = {
  title: "Publish event",
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PublishEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireCurator();

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const detail = await getAdminEvent(id);
  if (!detail) notFound();

  // Nothing to confirm for an event that is already public.
  if (detail.isPublic) {
    redirect(`/admin/events/${id}/edit`);
  }

  const sourceCount = await countEventSources(id);
  // Usability aid only — the database triggers (enforce_public_event_is_
  // complete, enforce_public_event_has_source) are the actual authority on
  // whether the publish below will succeed; this just tells the curator what
  // to fix first instead of letting them find out from a rejected write.
  const missing = missingPublicationRequirements(detail.values, sourceCount);
  const canPublish = missing.length === 0;

  const { error } = await searchParams;
  const slug = detail.values.slug;

  async function confirmPublish() {
    "use server";
    await publishEventAction(id);
  }

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Publish event</h1>
          <p className={styles.intro}>
            A deliberate step. Please read the points below, then confirm.
          </p>
        </div>
      </div>

      {error === "1" && canPublish ? (
        <p className={styles.formError} role="alert">
          The event could not be published. Return to the draft and try again.
        </p>
      ) : null}

      <div className={styles.confirmBox}>
        <p className={styles.confirmTitle}>
          {detail.values.title || "(untitled draft)"}
        </p>

        <p className={styles.sourceCount}>
          Currently attached sources: <strong>{sourceCount}</strong>
        </p>

        {!canPublish ? (
          <div className={styles.publishWarn} role="status">
            <p>
              <strong>This draft is not ready to publish.</strong> The
              following are required first:
            </p>
            <ul>
              {missing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p>
              Sources are added from the{" "}
              <Link href={`/admin/events/${id}/edit`}>event edit page</Link>;
              everything else is edited in the form on that same page.
            </p>
          </div>
        ) : null}

        <ul>
          <li>
            The event will become <strong>publicly visible</strong> on the
            Observatory.
          </li>
          <li>
            Its public URL will use the slug it has now &mdash;{" "}
            <code className={styles.slugCode}>/events/{slug}</code>. Publishing
            does not change the slug.
          </li>
          <li>
            First publication is a <strong>meaningful lifecycle transition</strong>
            : the database records the publication time.
          </li>
          <li>
            Once published, the <strong>slug is locked</strong> by the database
            publication rules and can no longer be changed.
          </li>
        </ul>
        <p className={styles.confirmNote}>
          If the slug is not right, cancel, correct it in the draft, then come
          back here.
        </p>

        <div className={styles.confirmActions}>
          {canPublish ? (
            <form action={confirmPublish}>
              <button type="submit" className={styles.confirmButton}>
                Confirm &mdash; publish this event
              </button>
            </form>
          ) : null}
          <Link href={`/admin/events/${id}/edit`} className={styles.cancel}>
            {canPublish ? "Cancel" : "Back to draft"}
          </Link>
        </div>
      </div>
    </main>
  );
}

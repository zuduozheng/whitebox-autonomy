import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { deleteSourceAction } from "@/app/admin/(protected)/events/source-actions";
import {
  countEventSources,
  getAdminEvent,
  getEventSource,
} from "@/lib/admin/events";
import { sourceTypeLabel } from "@/lib/events/labels";
import { requireCurator } from "@/lib/auth/require-curator";

import styles from "../../../../page.module.css";

export const metadata: Metadata = {
  title: "Delete source",
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The confirmation page owns the user-facing copy; the action only passes a
// short reason code. `last-public-source` is the database's decision, mapped to
// the exact guidance we want a curator to see — the app never claims to be the
// authority for it.
const ERROR_MESSAGES: Record<string, string> = {
  "last-public-source":
    "A public event must keep at least one source. Add another source or unpublish the event before deleting this one.",
  "not-found": "That source no longer exists.",
  error: "The source could not be deleted. Please try again.",
};

export default async function DeleteSourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; sourceId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireCurator();

  const { id, sourceId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(sourceId)) notFound();

  const detail = await getAdminEvent(id);
  if (!detail) notFound();

  const source = await getEventSource(id, sourceId);
  if (!source) notFound();

  const sourceCount = await countEventSources(id);
  const isLastOfPublic = detail.isPublic && sourceCount <= 1;

  const { error } = await searchParams;
  const errorMessage =
    typeof error === "string"
      ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.error)
      : null;

  async function confirmDelete() {
    "use server";
    await deleteSourceAction(id, sourceId);
  }

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Delete source</h1>
          <p className={styles.intro}>
            Removing a source from{" "}
            <strong>{detail.values.title || "(untitled draft)"}</strong>.
          </p>
        </div>
      </div>

      {errorMessage ? (
        <p className={styles.formError} role="alert">
          {errorMessage}
        </p>
      ) : null}

      <div className={styles.confirmBox}>
        <p className={styles.confirmTitle}>
          {source.values.sourceType
            ? sourceTypeLabel(source.values.sourceType)
            : "Source"}
        </p>
        <a
          href={source.values.url}
          target="_blank"
          rel="noreferrer"
          className={styles.sourceUrl}
        >
          {source.values.url}
        </a>

        <p className={styles.sourceCount}>
          This event is <strong>{detail.isPublic ? "public" : "a draft"}</strong>{" "}
          and currently has <strong>{sourceCount}</strong>{" "}
          {sourceCount === 1 ? "source" : "sources"}.
        </p>

        {isLastOfPublic ? (
          <p className={styles.publishWarn} role="status">
            This is the only source of a public event. The database requires
            every public event to keep at least one source, so this deletion
            will be refused. Add another source, or unpublish the event, first.
          </p>
        ) : null}

        <ul>
          <li>The source link is removed from this event.</li>
          <li>This does not delete the event or change its publication state.</li>
        </ul>

        <div className={styles.confirmActions}>
          <form action={confirmDelete}>
            <button type="submit" className={styles.confirmButton}>
              Confirm &mdash; delete this source
            </button>
          </form>
          <Link href={`/admin/events/${id}/edit`} className={styles.cancel}>
            Cancel
          </Link>
        </div>
      </div>

      <p className={styles.back}>
        <Link href={`/admin/events/${id}/edit`}>Back to the event</Link>
      </p>
    </main>
  );
}

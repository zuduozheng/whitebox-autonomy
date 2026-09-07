import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { updateEventAction } from "@/app/admin/(protected)/events/actions";
import EventForm from "@/app/admin/(protected)/events/EventForm";
import { getAdminEvent, listEventSources } from "@/lib/admin/events";
import type { EventFormState } from "@/lib/admin/event-form";
import { sourceTypeLabel } from "@/lib/events/labels";
import { requireCurator } from "@/lib/auth/require-curator";

import styles from "../../page.module.css";

export const metadata: Metadata = {
  title: "Edit event",
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditEventPage({
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

  const sources = await listEventSources(id);

  const { created, saved, published, sourceAdded, sourceUpdated, sourceDeleted } =
    await searchParams;
  const notice =
    published === "1"
      ? "Event published. It is now visible on the public Observatory."
      : sourceAdded === "1"
        ? "Source added to this event."
        : sourceUpdated === "1"
          ? "Source updated."
          : sourceDeleted === "1"
            ? "Source deleted."
            : created === "1"
              ? "Draft created. You can keep editing it below."
              : saved === "1"
                ? "Changes saved."
                : null;

  const slug = detail.values.slug;

  async function boundUpdate(
    prevState: EventFormState,
    formData: FormData,
  ): Promise<EventFormState> {
    "use server";
    return updateEventAction(id, prevState, formData);
  }

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Edit event</h1>
          <p className={styles.intro}>
            {detail.isPublic
              ? "This event is public. Its slug is locked by the database publication rules."
              : "This event is a draft — not visible to the public."}
          </p>
        </div>
      </div>

      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}

      <section className={styles.publishPanel}>
        {detail.isPublic ? (
          <>
            <h2>Public</h2>
            <p>
              Published and visible on the Observatory at{" "}
              <Link href={`/events/${slug}`} className={styles.publicUrl}>
                /events/{slug}
              </Link>
              .
            </p>
          </>
        ) : (
          <>
            <h2>Publication</h2>
            <p>
              This draft is private. Check the slug and content first &mdash;
              publishing locks the slug and records the publication time.
            </p>
            <Link
              href={`/admin/events/${id}/publish`}
              className={styles.publishLink}
            >
              Publish event…
            </Link>
          </>
        )}
      </section>

      <EventForm
        mode="edit"
        action={boundUpdate}
        initialValues={detail.values}
        slugLocked={detail.hasBeenPublished}
        cancelHref="/admin/events"
      />

      <section className={styles.sourcesPanel}>
        <div className={styles.sourcesHead}>
          <h2>Sources</h2>
          <Link
            href={`/admin/events/${id}/sources/new`}
            className={styles.publishLink}
          >
            Add source…
          </Link>
        </div>

        <p className={styles.sourcesIntro}>
          The sources are the evidence for this event. A public event must have
          at least one.
        </p>

        {sources.length === 0 ? (
          <p className={styles.sourcesEmpty}>No sources attached yet.</p>
        ) : (
          <ul className={styles.sourceList}>
            {sources.map((source) => (
              <li key={source.id} className={styles.sourceItem}>
                <div className={styles.sourceItemHead}>
                  <span className={styles.sourceType}>
                    {sourceTypeLabel(source.sourceType)}
                  </span>
                  <span className={styles.sourceActions}>
                    <Link
                      href={`/admin/events/${id}/sources/${source.id}/edit`}
                      className={styles.sourceEdit}
                    >
                      Edit
                    </Link>
                    <Link
                      href={`/admin/events/${id}/sources/${source.id}/delete`}
                      className={styles.sourceDelete}
                    >
                      Delete
                    </Link>
                  </span>
                </div>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.sourceUrl}
                >
                  {source.url}
                </a>
                {source.publisher ||
                source.label ||
                source.publishedOn ||
                source.retrievedOn ||
                source.note ? (
                  <dl className={styles.sourceMeta}>
                    {source.publisher ? (
                      <div>
                        <dt>Publisher</dt>
                        <dd>{source.publisher}</dd>
                      </div>
                    ) : null}
                    {source.label ? (
                      <div>
                        <dt>Link text</dt>
                        <dd>{source.label}</dd>
                      </div>
                    ) : null}
                    {source.publishedOn ? (
                      <div>
                        <dt>Published</dt>
                        <dd>{source.publishedOn}</dd>
                      </div>
                    ) : null}
                    {source.retrievedOn ? (
                      <div>
                        <dt>Retrieved</dt>
                        <dd>{source.retrievedOn}</dd>
                      </div>
                    ) : null}
                    {source.note ? (
                      <div>
                        <dt>Note</dt>
                        <dd>{source.note}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className={styles.back}>
        <Link href="/admin/events">Back to events</Link>
      </p>
    </main>
  );
}

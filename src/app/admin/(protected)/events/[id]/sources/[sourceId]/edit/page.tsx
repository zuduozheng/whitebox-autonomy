import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import SourceForm from "@/app/admin/(protected)/events/SourceForm";
import { updateSourceAction } from "@/app/admin/(protected)/events/source-actions";
import { getAdminEvent, getEventSource } from "@/lib/admin/events";
import type { SourceFormState } from "@/lib/admin/source-form";
import { requireCurator } from "@/lib/auth/require-curator";

import styles from "../../../../page.module.css";

export const metadata: Metadata = {
  title: "Edit source",
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditSourcePage({
  params,
}: {
  params: Promise<{ id: string; sourceId: string }>;
}) {
  await requireCurator();

  const { id, sourceId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(sourceId)) notFound();

  const detail = await getAdminEvent(id);
  if (!detail) notFound();

  const source = await getEventSource(id, sourceId);
  if (!source) notFound();

  async function boundUpdate(
    prevState: SourceFormState,
    formData: FormData,
  ): Promise<SourceFormState> {
    "use server";
    return updateSourceAction(id, sourceId, prevState, formData);
  }

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Edit source</h1>
          <p className={styles.intro}>
            Editing a source attached to{" "}
            <strong>{detail.values.title || "(untitled draft)"}</strong>.
          </p>
        </div>
      </div>

      <SourceForm
        action={boundUpdate}
        initialValues={source.values}
        submitLabel="Save source"
        pendingLabel="Saving…"
        cancelHref={`/admin/events/${id}/edit`}
      />

      <p className={styles.back}>
        <Link href={`/admin/events/${id}/edit`}>Back to the event</Link>
      </p>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import SourceForm from "@/app/admin/(protected)/events/SourceForm";
import { createSourceAction } from "@/app/admin/(protected)/events/source-actions";
import { getAdminEvent } from "@/lib/admin/events";
import {
  emptySourceFormValues,
  type SourceFormState,
} from "@/lib/admin/source-form";
import { requireCurator } from "@/lib/auth/require-curator";

import styles from "../../../page.module.css";

export const metadata: Metadata = {
  title: "Add source",
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewSourcePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCurator();

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const detail = await getAdminEvent(id);
  if (!detail) notFound();

  async function boundCreate(
    prevState: SourceFormState,
    formData: FormData,
  ): Promise<SourceFormState> {
    "use server";
    return createSourceAction(id, prevState, formData);
  }

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Add source</h1>
          <p className={styles.intro}>
            Attaching a source to{" "}
            <strong>{detail.values.title || "(untitled draft)"}</strong>. The
            sources are the evidence for this event.
          </p>
        </div>
      </div>

      <SourceForm
        action={boundCreate}
        initialValues={emptySourceFormValues()}
        submitLabel="Add source"
        pendingLabel="Adding…"
        cancelHref={`/admin/events/${id}/edit`}
      />

      <p className={styles.back}>
        <Link href={`/admin/events/${id}/edit`}>Back to the event</Link>
      </p>
    </main>
  );
}

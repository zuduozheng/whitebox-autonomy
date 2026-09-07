import type { Metadata } from "next";
import Link from "next/link";

import { listSubmissions } from "@/lib/admin/submissions";
import { requireCurator } from "@/lib/auth/require-curator";
import { formatIsoDate } from "@/lib/events/format";
import {
  SUBMISSION_LIST_FILTERS,
  isSubmissionListFilter,
  submissionStatusLabel,
  type SubmissionListFilter,
} from "@/lib/submissions/submission-review";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Submissions",
  robots: { index: false, follow: false },
};

const FILTER_LABELS: Record<SubmissionListFilter, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  spam: "Spam",
  all: "All",
};

export default async function AdminSubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireCurator();

  const { status } = await searchParams;
  const filter: SubmissionListFilter =
    typeof status === "string" && isSubmissionListFilter(status)
      ? status
      : "pending";

  const submissions = await listSubmissions(filter);

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Submissions</h1>
          <p className={styles.intro}>
            Community submissions to the event inbox. Review each one, then
            create any Observatory event separately through the existing event
            workflow.
          </p>
        </div>
      </div>

      <nav className={styles.filters} aria-label="Filter submissions by status">
        {SUBMISSION_LIST_FILTERS.map((value) => {
          const href =
            value === "pending"
              ? "/admin/submissions"
              : `/admin/submissions?status=${value}`;
          const active = value === filter;
          return (
            <Link
              key={value}
              href={href}
              className={styles.filter}
              aria-current={active ? "page" : undefined}
              data-active={active ? "" : undefined}
            >
              {FILTER_LABELS[value]}
            </Link>
          );
        })}
      </nav>

      <p className={styles.count}>
        {submissions.length === 0
          ? "No submissions in this view."
          : `${submissions.length} ${submissions.length === 1 ? "submission" : "submissions"}, newest first.`}
      </p>

      {submissions.length > 0 ? (
        <ul className={styles.list}>
          {submissions.map((submission) => (
            <li key={submission.id}>
              <Link
                href={`/admin/submissions/${submission.id}`}
                className={styles.row}
              >
                <span className={styles.rowTop}>
                  <span className={styles.badge}>
                    {submissionStatusLabel(submission.status)}
                  </span>
                  <span className={styles.date}>
                    Received {formatIsoDate(submission.createdAt.slice(0, 10))}
                  </span>
                </span>

                <span className={styles.url}>{submission.evidenceUrl}</span>

                <span className={styles.meta}>
                  <span>
                    {submission.developerOrOperator ?? "Developer / operator —"}
                  </span>
                  <span>{submission.locationText ?? "Location —"}</span>
                  <span>
                    {submission.eventDate
                      ? `Event ${formatIsoDate(submission.eventDate)}`
                      : "Event date —"}
                  </span>
                </span>

                <span className={styles.flags}>
                  {submission.hasCuratorNote ? <span>Curator note</span> : null}
                  {submission.hasSubmitterEmail ? (
                    <span>Contact email</span>
                  ) : null}
                  {submission.additionalUrlCount > 0 ? (
                    <span>
                      +{submission.additionalUrlCount} additional{" "}
                      {submission.additionalUrlCount === 1 ? "URL" : "URLs"}
                    </span>
                  ) : null}
                  {submission.reviewedAt ? (
                    <span>
                      Reviewed{" "}
                      {formatIsoDate(submission.reviewedAt.slice(0, 10))}
                    </span>
                  ) : null}
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

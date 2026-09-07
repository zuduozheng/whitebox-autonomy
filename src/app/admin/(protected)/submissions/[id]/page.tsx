import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  approveSubmissionAndCreateDraftAction,
  updateSubmissionReviewAction,
} from "@/app/admin/(protected)/submissions/actions";
import SubmissionReviewForm from "./SubmissionReviewForm";
import {
  formatTimestampUtc,
  getSubmission,
} from "@/lib/admin/submissions";
import { requireCurator } from "@/lib/auth/require-curator";
import { formatIsoDate } from "@/lib/events/format";
import {
  submissionStatusLabel,
  type SubmissionReviewFormState,
} from "@/lib/submissions/submission-review";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Review submission",
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReviewSubmissionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const curator = await requireCurator();

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const submission = await getSubmission(id);
  if (!submission) notFound();

  const { saved, approveError } = await searchParams;
  const notice = saved === "1" ? "Review saved." : null;

  const reviewedByLabel =
    submission.reviewedBy == null
      ? null
      : submission.reviewedBy === curator.userId
        ? "you"
        : "another curator";

  async function boundUpdate(
    prevState: SubmissionReviewFormState,
    formData: FormData,
  ): Promise<SubmissionReviewFormState> {
    "use server";
    return updateSubmissionReviewAction(id, prevState, formData);
  }

  async function boundApprove() {
    "use server";
    await approveSubmissionAndCreateDraftAction(id);
  }

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Review submission</h1>
          <p className={styles.intro}>
            Community submission — not yet curator reviewed. The information below
            was provided by a member of the public and has not been checked.
          </p>
        </div>
      </div>

      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}

      <section className={styles.submitted} aria-labelledby="submitted-heading">
        <h2 id="submitted-heading" className={styles.sectionHeading}>
          Submitted information
        </h2>

        <dl className={styles.detail}>
          <div>
            <dt>Evidence link</dt>
            <dd>
              <a
                href={submission.evidenceUrl}
                target="_blank"
                rel="noreferrer nofollow"
                className={styles.url}
              >
                {submission.evidenceUrl}
              </a>{" "}
              <span className={styles.newTab}>(opens in a new tab)</span>
            </dd>
          </div>

          <div>
            <dt>What happened</dt>
            <dd>
              {submission.whatHappened ?? (
                <span className={styles.empty}>Not provided</span>
              )}
            </dd>
          </div>

          <div>
            <dt>Developer / operator</dt>
            <dd>
              {submission.developerOrOperator ?? (
                <span className={styles.empty}>Not provided</span>
              )}
            </dd>
          </div>

          <div>
            <dt>Location</dt>
            <dd>
              {submission.locationText ?? (
                <span className={styles.empty}>Not provided</span>
              )}
            </dd>
          </div>

          <div>
            <dt>Event date</dt>
            <dd>
              {submission.eventDate ? (
                formatIsoDate(submission.eventDate)
              ) : (
                <span className={styles.empty}>Not provided</span>
              )}
            </dd>
          </div>

          <div>
            <dt>Additional URLs</dt>
            <dd>
              {submission.additionalUrls.length === 0 ? (
                <span className={styles.empty}>Not provided</span>
              ) : (
                <ul className={styles.urlList}>
                  {submission.additionalUrls.map((line, index) => (
                    <li key={`${index}-${line.text}`}>
                      {line.href ? (
                        <a
                          href={line.href}
                          target="_blank"
                          rel="noreferrer nofollow"
                          className={styles.url}
                        >
                          {line.text}
                        </a>
                      ) : (
                        <span className={styles.url}>{line.text}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className={styles.curatorOnly} aria-labelledby="contact-heading">
        <h2 id="contact-heading" className={styles.sectionHeading}>
          Submitter contact — curator-only
        </h2>
        <p className={styles.curatorOnlyNote}>
          Visible only to signed-in curators. Never shown publicly.
        </p>
        <dl className={styles.detail}>
          <div>
            <dt>Submitter email</dt>
            <dd>
              {submission.submitterEmail ? (
                <a href={`mailto:${submission.submitterEmail}`}>
                  {submission.submitterEmail}
                </a>
              ) : (
                <span className={styles.empty}>Not provided</span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className={styles.review} aria-labelledby="review-heading">
        <h2 id="review-heading" className={styles.sectionHeading}>
          Review status
        </h2>

        <dl className={styles.detail}>
          <div>
            <dt>Current status</dt>
            <dd>{submissionStatusLabel(submission.status)}</dd>
          </div>
          <div>
            <dt>Received</dt>
            <dd>{formatTimestampUtc(submission.createdAt)}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{formatTimestampUtc(submission.updatedAt)}</dd>
          </div>
          {submission.reviewedAt ? (
            <div>
              <dt>Reviewed</dt>
              <dd>
                {formatTimestampUtc(submission.reviewedAt)}
                {reviewedByLabel ? ` by ${reviewedByLabel}` : null}
              </dd>
            </div>
          ) : null}
        </dl>

        {approveError === "1" ? (
          <p className={styles.formError} role="alert">
            The draft event could not be created. Please try again.
          </p>
        ) : null}

        {submission.linkedEventId ? (
          <p className={styles.noBridge}>
            A private draft event has already been created from this
            submission. It stays private until a curator publishes it.{" "}
            <Link
              href={`/admin/events/${submission.linkedEventId}/edit`}
              className={styles.linkedDraftLink}
            >
              View linked draft
            </Link>
          </p>
        ) : (
          <>
            <p className={styles.noBridge}>
              Approving creates a <strong>private draft</strong> event,
              pre-populated with this submission&apos;s evidence link and any
              developer/operator, location and date it provided. Nothing is
              published — the draft stays private until a curator classifies
              it and explicitly publishes it through the usual event
              workflow.
            </p>
            <form action={boundApprove}>
              <button type="submit" className={styles.approveButton}>
                Approve &amp; create draft
              </button>
            </form>
          </>
        )}

        <SubmissionReviewForm
          action={boundUpdate}
          initialStatus={submission.status}
          initialCuratorNote={submission.curatorNote ?? ""}
        />
      </section>

      <p className={styles.back}>
        <Link href="/admin/submissions">Back to submissions</Link>
      </p>
    </main>
  );
}

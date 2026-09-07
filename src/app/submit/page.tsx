import type { Metadata } from "next";
import Link from "next/link";

import prose from "@/components/prose.module.css";
import { socialMetadata } from "@/lib/seo";

import SubmitForm from "./SubmitForm";
import { submitEventAction } from "./actions";
import styles from "./page.module.css";

const description =
  "Send the Global AV Event Observatory a public link to an autonomous-vehicle " +
  "event for curator review.";

export const metadata: Metadata = {
  title: "Submit an event",
  description,
  ...socialMetadata({
    title: "Submit an event",
    description,
    path: "/submit",
  }),
};

export default function SubmitPage() {
  return (
    <main className={prose.page}>
      <h1>Submit an event</h1>
      <p className={styles.lede}>
        Know of an autonomous-vehicle event that may be relevant to the
        Observatory? Send us a public link to it and a curator will review it.
      </p>

      <p>
        This form adds nothing to the Observatory automatically. Every submission
        goes to a private queue for a curator to check against its sources before
        anything is published, and not every submission results in an entry.
      </p>

      <div className={styles.notice}>
        <p>
          <strong>Share only publicly available links.</strong> Do not include
          private, personal, or confidential information &mdash; about yourself or
          anyone else &mdash; in any field.
        </p>
        <p>
          An email address is optional. If you provide one, it is used only so a
          curator can follow up on your submission, and it is never published.
        </p>
        <p>
          See the <Link href="/privacy">privacy information</Link> page for how
          submissions are handled.
        </p>
      </div>

      <SubmitForm action={submitEventAction} />

      <p className={styles.back}>
        <Link href="/events">Back to the Observatory</Link>
      </p>
    </main>
  );
}

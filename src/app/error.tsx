"use client";

import Link from "next/link";
import { useEffect } from "react";

import prose from "@/components/prose.module.css";

import styles from "./error.module.css";

/**
 * Route-level error boundary for the public site. It renders inside the root
 * layout, so the shared header and footer stay in place. No technical or
 * database detail is shown to the visitor; the underlying error is only logged
 * to the browser console for debugging.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className={prose.page}>
      <h1>Something went wrong</h1>
      <p className={prose.lede}>
        Sorry &mdash; this page didn&rsquo;t load correctly. This is usually
        temporary; please try again in a moment.
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.retry} onClick={() => reset()}>
          Try again
        </button>
        <Link href="/">Return to the homepage</Link>
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

import { signIn, signOut } from "@/app/admin/actions";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Curator sign in",
  robots: { index: false, follow: false },
};

// An auth page must never be statically prerendered or cached.
export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  invalid:
    "Sign-in failed. Check your email address and password, then try again.",
  "access-denied":
    "You are signed in, but this account does not have curator access.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const message = errorKey ? ERROR_MESSAGES[errorKey] : undefined;
  const accessDenied = errorKey === "access-denied";

  return (
    <main className={styles.page}>
      <h1>Curator sign in</h1>
      <p className={styles.intro}>
        Restricted area for White Box Autonomy curators. If you don&rsquo;t
        maintain Observatory records, there is nothing here for you &mdash;{" "}
        <Link href="/">return to the site</Link>.
      </p>

      {message ? (
        <p className={styles.error} role="alert">
          {message}
        </p>
      ) : null}

      {accessDenied ? (
        <form action={signOut}>
          <button type="submit" className={styles.secondaryButton}>
            Sign out
          </button>
        </form>
      ) : (
        <form action={signIn} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <button type="submit" className={styles.button}>
            Sign in
          </button>
        </form>
      )}
    </main>
  );
}

import Link from "next/link";

import { signOut } from "@/app/admin/actions";
import { requireCurator } from "@/lib/auth/require-curator";

import styles from "./page.module.css";

export default async function AdminHomePage() {
  const curator = await requireCurator();

  return (
    <main className={styles.page}>
      <h1>White Box Autonomy Admin</h1>
      <p className={styles.intro}>
        Curator workspace for the Global AV Event Observatory.
      </p>

      <nav className={styles.nav} aria-label="Admin sections">
        <Link href="/admin/events">Events</Link>
        <Link href="/admin/submissions">Submissions</Link>
      </nav>

      <dl className={styles.status}>
        <div>
          <dt>Signed in as</dt>
          <dd>{curator.email ?? "(no email on record)"}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{curator.role}</dd>
        </div>
      </dl>

      <form action={signOut}>
        <button type="submit" className={styles.signOut}>
          Sign out
        </button>
      </form>

      <p className={styles.back}>
        <Link href="/">Back to the public site</Link>
      </p>
    </main>
  );
}

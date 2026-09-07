import Link from "next/link";

import styles from "./SiteFooter.module.css";

/**
 * Site-wide footer: a one-line description of the platform and links to the
 * information pages.
 *
 * No licence statement is shown yet — the licence has not been decided. Any
 * institutional attribution added later should be factual and understated.
 */
export default function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p className={styles.description}>
          White Box Autonomy &mdash; Global AV Event Observatory. An open
          evidence observatory for real-world automated-driving events, with
          transparent source provenance.
        </p>
        <nav aria-label="Footer" className={styles.links}>
          <Link href="/events" className={styles.link}>
            Observatory
          </Link>
          <Link href="/map" className={styles.link}>
            Map
          </Link>
          <Link href="/submit" className={styles.link}>
            Submit an event
          </Link>
          <Link href="/about" className={styles.link}>
            About
          </Link>
          <Link href="/methodology" className={styles.link}>
            Methodology
          </Link>
          <Link href="/privacy" className={styles.link}>
            Privacy
          </Link>
          <a href="mailto:zuduo.zheng@uq.edu.au" className={styles.link}>
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}

import Image from "next/image";
import Link from "next/link";

import styles from "./page.module.css";

export default function HomePage() {
  return (
    <main className={styles.home}>
      <div className={styles.identity}>
        <Image
          src="/branding/wba-logo.png"
          alt="White Box Autonomy logo"
          width={1024}
          height={1024}
          className={styles.logo}
          priority
        />
        <div>
          <h1 className={styles.title}>White Box Autonomy</h1>
          <p className={styles.subtitle}>Global AV Event Observatory</p>
        </div>
      </div>

      <section className={styles.intro}>
        <p>
          White Box Autonomy is a research initiative of the M2CAT Lab at The
          University of Queensland, building an open, evidence-led record of how
          automated-driving systems behave on real roads.
        </p>
        <p>
          Over time, it aims to support structured scenario discovery and
          evidence-driven evaluation of automated driving.
        </p>
      </section>

      <section className={styles.about}>
        <p>
          The Observatory brings together a growing collection of real-world
          automated-driving events from curated public evidence and
          structured regulatory records &mdash; collisions, near misses,
          unusual behaviour, and the successful handling of difficult
          situations.
        </p>
        <p>
          Every record links to its original sources. Counts describe the
          evidence base; they are not safety rates or rankings.
        </p>
      </section>

      <div className={styles.enter}>
        <p className={styles.primaryLink}>
          <Link href="/events">Browse the Observatory</Link> to read
          individual event records.
        </p>
        <p className={styles.primaryLink}>
          <Link href="/map">Explore the map</Link> to see their rough spatial
          distribution.
        </p>
        <p className={styles.secondaryLinks}>
          <Link href="/about">About the project</Link>
          <Link href="/methodology">How events are recorded</Link>
        </p>
      </div>

      <p className={styles.status}>
        Current status: automated discovery for curated events is planned but
        not yet available. See <Link href="/methodology">methodology</Link>{" "}
        for how curated and source-derived records differ.
      </p>

      <section className={styles.support}>
        <h2 className={styles.supportHeading}>Developed and supported by</h2>
        <Image
          src="/branding/m2cat.png"
          alt="M2CAT Lab"
          width={824}
          height={654}
          className={styles.supportLogo}
        />
        <p className={styles.supportText}>
          Developed and maintained by the M2CAT Lab at The University of
          Queensland, with support from the Australian Research Council Future
          Fellowship (FT250100337) and The University of Queensland.
        </p>
      </section>
    </main>
  );
}

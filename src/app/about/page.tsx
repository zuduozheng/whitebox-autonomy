import type { Metadata } from "next";
import Link from "next/link";

import prose from "@/components/prose.module.css";
import { socialMetadata } from "@/lib/seo";

import styles from "./page.module.css";

const description =
  "What the Global AV Event Observatory is, the principles behind it, and " +
  "the scope of its first public release.";

export const metadata: Metadata = {
  title: "About",
  description,
  ...socialMetadata({ title: "About", description, path: "/about" }),
};

export default function AboutPage() {
  return (
    <main className={prose.page}>
      <h1>About</h1>
      <p className={styles.lede}>
        White Box Autonomy runs the Global AV Event Observatory: a structured,
        openly sourced catalogue of events involving automated-driving systems.
      </p>

      <h2>What we record</h2>
      <p>
        Each entry is an <strong>event</strong> &mdash; a record that something
        happened involving a putative automated vehicle. An event anchors one or
        more <strong>sources</strong> (the original reporting or documentation)
        and specific, individually checkable <strong>claims</strong> about what
        occurred. We record both failures and the successful handling of
        difficult situations, so the catalogue is not limited to things that went
        wrong.
      </p>

      <h2>How events enter the Observatory</h2>
      <p>
        Curated events are individually discovered from public evidence. AI is
        used only to <strong>discover and structure</strong> that evidence: it
        finds candidate reports and drafts a neutral summary. The AI&rsquo;s
        output is never treated as evidence &mdash; the evidence is always the
        original sources, linked from every event &mdash; and AI-written text
        and curator-written text are always shown distinctly.
      </p>
      <p>
        Source-derived events are created differently: through a validated,
        deterministic transformation of an identified structured source
        dataset (currently NHTSA&rsquo;s Standing General Order incident
        reports), without individual curator review or AI involvement. Both
        pathways are explained on the{" "}
        <Link href="/methodology">methodology</Link> page.
      </p>

      <h2>Principles</h2>
      <ul>
        <li>
          AI discovers and structures information; AI itself is never evidence.
        </li>
        <li>Every machine-discovered event has traceable source provenance.</li>
        <li>Missing facts are left unknown &mdash; we do not infer them.</li>
        <li>
          The involvement of an automated vehicle is not the same as its being
          the cause.
        </li>
        <li>Verification status is always explicit.</li>
        <li>AI-generated and curator-written text remain distinguishable.</li>
      </ul>

      <h2>First public release</h2>
      <p>
        The first release is deliberately focused: this set of information
        pages, a browsable and filterable Observatory, an interactive map
        for exploring the rough spatial distribution of events, individual
        event pages, a growing multi-source evidence base, and a basic
        curator workflow. Everything else in the long-term design &mdash;
        scenario extraction, benchmarking, contributor accounts, semantic
        search &mdash; comes later.
      </p>

      <p>
        The methods behind discovery, provenance, and verification status are
        described on the <Link href="/methodology">methodology</Link> page.
      </p>

      <h2>Who runs this</h2>
      <p>
        White Box Autonomy is developed and maintained by the M2CAT Lab at The
        University of Queensland, with support from the Australian Research
        Council Future Fellowship (FT250100337) and The University of
        Queensland.
      </p>
      <p>
        The views expressed on this website are those of the authors and do not
        necessarily reflect the views of the Australian Research Council or the
        Australian Government.
      </p>

      <h2>Contact and corrections</h2>
      <p>
        To report an error, request a correction, or raise a concern about a
        record or its source material, contact{" "}
        <a href="mailto:zuduo.zheng@uq.edu.au">zuduo.zheng@uq.edu.au</a>.
      </p>
    </main>
  );
}

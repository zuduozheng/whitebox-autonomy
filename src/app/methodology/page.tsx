import type { Metadata } from "next";
import Link from "next/link";

import prose from "@/components/prose.module.css";
import { socialMetadata } from "@/lib/seo";

import styles from "./page.module.css";

const description =
  "How the Global AV Event Observatory discovers events, records source " +
  "provenance, and assigns verification status.";

export const metadata: Metadata = {
  title: "Methodology",
  description,
  ...socialMetadata({ title: "Methodology", description, path: "/methodology" }),
};

/**
 * Verification statuses. Each label is self-describing text: colour, where it
 * is used elsewhere in the product, is only ever a secondary cue.
 */
const STATUSES = [
  {
    label: "AI-discovered · Unverified",
    meaning:
      "Found by automated discovery and summarised by AI. Not yet checked by " +
      "a curator. The linked sources are the evidence; the summary is not.",
  },
  {
    label: "Community-submitted · Unverified",
    meaning:
      "Sent in through the public form. Community submissions currently go to " +
      "a private curator queue and are not shown in the Observatory; an event " +
      "is added only if a curator separately reviews the submission and enters " +
      "it through the curator workflow.",
  },
  {
    label: "Curator-reviewed",
    meaning:
      "A curator has checked the record against its sources and corrected it " +
      "where needed. This is not an assertion that every detail is true.",
  },
  {
    label: "Verified",
    meaning:
      "A curator judges that the core facts are supported by strong sources.",
  },
  {
    label: "Disputed",
    meaning: "The sources conflict with each other on a material point.",
  },
];

export default function MethodologyPage() {
  return (
    <main className={prose.page}>
      <h1>Methodology</h1>
      <p className={prose.lede}>
        How events are discovered, how their sources are recorded, and what each
        verification status means.
      </p>

      <p className={styles.note}>
        Current status: automated discovery and AI-assisted extraction for
        curated events are part of the intended workflow but are not yet
        active. Source-derived records are already published
        through a separate, deterministic pipeline described under
        &ldquo;Record origin&rdquo; below &mdash; that pipeline does not use
        AI. Community submissions currently enter a private curator queue;
        they are not added to the Observatory unless a curator separately
        reviews them and enters them through the curator workflow.
      </p>

      <h2>Discovery of curated events</h2>
      <p>
        This section describes how <strong>curated</strong> events are found;
        source-derived records (see &ldquo;Record origin&rdquo; below) enter
        through a separate, deterministic pipeline that does not use AI
        discovery. Automated searches over public sources &mdash; web-search
        queries and
        RSS/Atom feeds &mdash; produce candidate reports. Each candidate is
        fetched, a snapshot is requested from a web archive, and a short excerpt
        plus a content hash are stored. A cheap relevance check discards items
        that are not about a specific real-world automated-driving event.
      </p>
      <p>
        A single structured AI step then extracts only facts stated explicitly in
        the source text. Anything not stated is left blank. The AI does not infer
        causation from involvement, and records a system version only when a
        version string appears verbatim. The full list of search queries will be
        published here.
      </p>

      <h2>Sources and evidence</h2>
      <p>
        Every event links to its sources with publisher, publication date,
        retrieval date, a live link, an archive link, and the verbatim quote that
        supports each claim. We store and serve only these excerpts and metadata,
        not full article text. Please cite the original sources rather than our
        summary.
      </p>

      <h2>What we don&rsquo;t know</h2>
      <p>
        Each event page lists the facts its sources do not establish. Blank
        fields are shown as unknown, never filled with an estimate.
      </p>

      <h2>Location precision</h2>
      <p>
        An event&rsquo;s location is recorded only to the precision its
        sources actually support &mdash; a specific area, a city, a region,
        or only a country &mdash; and that precision is stated explicitly
        rather than assumed. On the <Link href="/map">interactive map</Link>,
        each point is a representative location for that recorded precision,
        not a claim about the exact incident location; several events may
        therefore share the same point when only a coarse location is known.
        The map is an exploratory display aid for spatial distribution, not
        a precise geospatial record.
      </p>

      <h2>Involvement is not causation</h2>
      <p>
        Recording that an automated vehicle was involved in an event is separate
        from claiming it caused the event. Causal statements are made only where
        a source supports them, and are labelled as claims with their own
        verification status.
      </p>

      <h2>Verification status</h2>
      <p>
        Where a curator has reached one of the standings below, it is stated
        in words; any colour used with it elsewhere is a secondary cue only,
        and the status is understandable without it. A source-derived record
        may carry no verification status at all &mdash; see &ldquo;Record
        origin&rdquo; below for why that is a legitimate, not a missing,
        state.
      </p>
      <dl className={styles.statusList}>
        {STATUSES.map((status) => (
          <div key={status.label} className={styles.statusRow}>
            <dt>
              <span className={styles.badge}>{status.label}</span>
            </dt>
            <dd>{status.meaning}</dd>
          </div>
        ))}
      </dl>
      <p>
        Records merged into another event redirect to it. Records that are
        rejected leave the public listing, with a stated reason.
      </p>

      <h2>Record origin</h2>
      <p>
        Every event also carries an <strong>origin</strong>, separate from its
        verification status above: origin describes how the record was
        created, not a curator&rsquo;s judgement about it. An event is either{" "}
        <strong>Curated</strong> &mdash; authored or individually reviewed by
        a curator before publication &mdash; or{" "}
        <strong>Source-derived</strong>. The two pathways are complementary,
        not competing: curated evidence and source-derived regulatory records
        each cover ground the other cannot. A source-derived record
        is created instead through a validated, deterministic transformation
        of identified regulatory source records &mdash; currently records
        derived from NHTSA&rsquo;s Standing General Order incident reports,
        grouped using NHTSA&rsquo;s own source-defined &ldquo;Same Incident
        ID&rdquo; where present. It does not necessarily undergo
        incident-by-incident curator review: White Box Autonomy structures
        and classifies the source evidence but does not independently verify
        the underlying physical incident, and does not claim to have
        adjudicated NHTSA&rsquo;s own incident grouping. A source-derived
        record may therefore carry no verification status above, and its
        record page says so rather than showing one that was never assigned.
      </p>
      <p>
        Origin is not the same as a source&rsquo;s <strong>type</strong>
        (shown next to each link in a record&rsquo;s source list, e.g.
        &ldquo;Regulatory record&rdquo;): source type describes one piece of
        supporting evidence, while origin describes how the WBA record itself
        came to exist.
      </p>

      <h2>Selection bias</h2>
      <p>
        A catalogue built from news and regulator reporting is a convenience
        sample, weighted toward what gets reported. To reduce a failure-only
        skew, discovery also searches for the successful handling of difficult
        situations, and the distribution of outcomes is shown rather than hidden.
      </p>
      <p>
        WBA seeks to preserve eligible event-level observations from its
        defined evidence sources rather than construct a statistically
        representative sample of AV performance. The number of events
        associated with a developer, system, country, event type, outcome,
        or geographic location &mdash; including its distribution on the{" "}
        <Link href="/map">map</Link> &mdash; reflects the composition and
        reporting characteristics of the underlying evidence sources and
        should not be interpreted as a measure of relative safety or
        performance.
      </p>
      <p>
        WBA provides a structured research index of publicly available
        evidence rather than an authoritative determination of what occurred.
        Users should consult the underlying source records when making
        incident-level interpretations or safety-related conclusions.
      </p>

      <p>
        See <Link href="/about">About</Link> for the project&rsquo;s purpose and
        scope.
      </p>
    </main>
  );
}

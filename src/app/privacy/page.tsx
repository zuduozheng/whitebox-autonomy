import type { Metadata } from "next";
import Link from "next/link";

import prose from "@/components/prose.module.css";
import { socialMetadata } from "@/lib/seo";

const description =
  "What information White Box Autonomy collects through its public submission " +
  "form, and how that information is handled.";

export const metadata: Metadata = {
  title: "Privacy",
  description,
  ...socialMetadata({ title: "Privacy", description, path: "/privacy" }),
};

export default function PrivacyPage() {
  return (
    <main className={prose.page}>
      <h1>Privacy</h1>
      <p className={prose.lede}>
        This page describes what information White Box Autonomy collects and how
        it is handled. It reflects how the site currently works and will be
        updated if that changes.
      </p>

      <h2>Browsing</h2>
      <p>
        You can browse the public Observatory without creating an account or
        signing in.
      </p>

      <h2>The submission form</h2>
      <p>
        The public <Link href="/submit">submission form</Link> accepts:
      </p>
      <ul>
        <li>a public evidence URL (required)</li>
        <li>a short description of what happened (optional)</li>
        <li>the developer or operator (optional)</li>
        <li>a location (optional)</li>
        <li>an event date (optional)</li>
        <li>additional public URLs (optional)</li>
        <li>your email address (optional)</li>
      </ul>
      <p>
        Community submissions enter a private curator queue. They are not added
        to the Observatory automatically; a curator reviews each submission and
        decides separately whether to create a record.
      </p>
      <p>
        If you provide an email address, it is used only so a curator can follow
        up with you about your submission. It is not published as part of any
        Observatory record. Within White Box Autonomy, submitted information is
        accessible through the curator-protected administrative workflow.
      </p>
      <p>
        Please do not include private, personal, or confidential information
        &mdash; about yourself or anyone else &mdash; in the free-text fields.
      </p>

      <h2>Services we use</h2>
      <p>
        White Box Autonomy uses Supabase for its database and backend,
        Mapbox to render the <Link href="/map">interactive map</Link> (your
        browser requests map content directly from Mapbox for the area you
        are viewing), and Vercel for web application hosting.
      </p>

      <h2>Links to other sites</h2>
      <p>
        Event records link to third-party sources such as news articles and
        videos. Following those links takes you to services that have their own
        privacy practices, which White Box Autonomy does not control.
      </p>

      <h2>Contact</h2>
      <p>
        For questions about information submitted through White Box Autonomy,
        requests for access to or correction of that information, or any privacy
        concern, contact{" "}
        <a href="mailto:zuduo.zheng@uq.edu.au">zuduo.zheng@uq.edu.au</a>.
      </p>
    </main>
  );
}

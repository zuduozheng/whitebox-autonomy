import type { Metadata } from "next";
import Link from "next/link";

import prose from "@/components/prose.module.css";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <main className={prose.page}>
      <h1>Page not found</h1>
      <p className={prose.lede}>
        The page you were looking for doesn&rsquo;t exist, or it may have moved.
      </p>
      <p>
        <Link href="/events">Browse the Observatory</Link>
      </p>
      <p>
        <Link href="/">Return to the homepage</Link>
      </p>
    </main>
  );
}

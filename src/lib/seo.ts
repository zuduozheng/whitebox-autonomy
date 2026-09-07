import type { Metadata } from "next";

/**
 * Shared site identity + a helper for per-page social metadata.
 *
 * Next.js merges metadata only shallowly: a route that sets `openGraph` (or
 * `twitter`) fully replaces the parent's field rather than merging into it. So
 * every public page that wants a page-specific `og:title` / `og:url` must also
 * restate `type` / `siteName` / `locale` / `card`. `socialMetadata()` builds
 * that whole fragment from just the page's own title, description and path,
 * keeping the shared parts in one place.
 */

// Canonical production origin. www and .com permanently redirect here.
export const SITE_URL = "https://whiteboxautonomy.org";
export const SITE_NAME = "White Box Autonomy";
export const SITE_TITLE = "White Box Autonomy — Global AV Event Observatory";
export const SITE_DESCRIPTION =
  "An open evidence observatory for real-world automated-driving events, " +
  "combining curated public evidence and source-derived regulatory " +
  "records with transparent source provenance.";

/**
 * Open Graph + Twitter fields for one public page.
 *
 * `title` is used verbatim (Next does not apply the `title.template` to social
 * fields); pass the bare page title, since `og:site_name` already carries
 * "White Box Autonomy". `path` is the route's canonical path, e.g. "/about" or
 * "/events/some-slug"; "/" and "" both resolve to the bare origin.
 */
export function socialMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Pick<Metadata, "openGraph" | "twitter"> {
  const url = path && path !== "/" ? `${SITE_URL}${path}` : SITE_URL;

  return {
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      url,
      title,
      description,
      locale: "en_AU",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

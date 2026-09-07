import type { MetadataRoute } from "next";

import { listEventSlugs } from "@/lib/events/repository";

/**
 * /sitemap.xml — the public surface only.
 *
 * Static information pages plus every public event detail URL, taken from the
 * same event repository the Observatory reads. Admin routes are never listed.
 * Regenerated on the same cadence as the Observatory list.
 */
const SITE_URL = "https://whiteboxautonomy.org";

export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const slugs = await listEventSlugs();
  const lastModified = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: "monthly", priority: 1 },
    {
      url: `${SITE_URL}/events`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/about`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/methodology`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/submit`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];

  const eventEntries: MetadataRoute.Sitemap = slugs.map((slug) => ({
    url: `${SITE_URL}/events/${slug}`,
    lastModified,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticEntries, ...eventEntries];
}

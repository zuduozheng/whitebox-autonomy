import type { MetadataRoute } from "next";

/**
 * /robots.txt — generated at build time.
 *
 * Public content is open to indexing; the curator area under /admin is not.
 * The sitemap reference points crawlers at the generated /sitemap.xml.
 */
const SITE_URL = "https://whiteboxautonomy.org";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/admin",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

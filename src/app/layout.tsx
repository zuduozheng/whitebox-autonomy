import type { Metadata } from "next";

import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import {
  SITE_DESCRIPTION,
  SITE_TITLE,
  SITE_URL,
  socialMetadata,
} from "@/lib/seo";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s — White Box Autonomy",
  },
  description: SITE_DESCRIPTION,
  ...socialMetadata({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    path: "/",
  }),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        {/*
          The layout supplies the shared header and footer only. It deliberately
          does not wrap children in a max-width container, so data- and
          visual-heavy pages (e.g. the future /map) can go full-width.
        */}
        <div className="site-main">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}

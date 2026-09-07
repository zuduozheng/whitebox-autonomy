"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./SiteHeader.module.css";

/**
 * Site-wide header: wordmark + primary navigation.
 *
 * Only links to pages that exist. Observatory and Map entries are added here
 * when those routes are built, so there are never dead links in the nav.
 *
 * This component provides its own internal max-width; it does not impose a
 * content width on the pages it sits above.
 *
 * The wordmark carries a small version of the WBA logo beside the text, on
 * every page except the homepage — the homepage already has its own larger,
 * separately-approved logo treatment in its hero identity block, so showing
 * it again here too would duplicate that. `usePathname()` (hence "use
 * client") is the standard App Router way to make that one distinction from
 * a layout-level shared component without splitting the header into two
 * near-duplicate variants.
 */
const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/events", label: "Observatory" },
  { href: "/map", label: "Map" },
  { href: "/methodology", label: "Methodology" },
  { href: "/about", label: "About" },
  { href: "/submit", label: "Submit an event" },
];

export default function SiteHeader() {
  const pathname = usePathname();
  const isHomepage = pathname === "/";

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.wordmark}>
          {!isHomepage && (
            <Image
              // Decorative: the link's own visible text already names the
              // brand, so an empty alt avoids a screen reader announcing it
              // twice.
              alt=""
              src="/branding/wba-logo.png"
              width={1024}
              height={1024}
              className={styles.wordmarkLogo}
            />
          )}
          White Box Autonomy
        </Link>
        <nav aria-label="Primary" className={styles.nav}>
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={styles.navLink}>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

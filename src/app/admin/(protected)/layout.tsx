import type { Metadata } from "next";
import type { ReactNode } from "react";

import { requireCurator } from "@/lib/auth/require-curator";

export const metadata: Metadata = {
  title: {
    default: "Admin",
    template: "%s — Admin — White Box Autonomy",
  },
  robots: { index: false, follow: false },
};

// Nothing behind the curator gate may be cached or statically prerendered.
// This route-segment config also applies to every nested protected page.
export const dynamic = "force-dynamic";

/**
 * Authorisation boundary for every /admin page EXCEPT the login route, which
 * lives in the sibling (auth) route group and is intentionally not wrapped by
 * this layout. requireCurator() redirects anyone who is not a signed-in
 * curator/admin, so `children` only ever renders for an authorised curator.
 *
 * Gating lives here — not in src/app/admin/layout.tsx — so it does not also
 * block the login page.
 */
export default async function ProtectedAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireCurator();
  return children;
}

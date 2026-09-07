import type { NextRequest } from "next/server";

import { updateProxySession } from "@/lib/supabase/proxy-session";

/**
 * Next.js 16 proxy — the renamed successor to `middleware` (the `middleware`
 * file convention is deprecated in this Next version).
 *
 * Its only job is to keep Supabase auth cookies fresh on admin navigations so
 * Server Components / Server Actions observe a valid session. It is NOT the
 * authorisation boundary: every protected page independently calls
 * requireCurator() on the server, and PostgreSQL RLS is the final boundary for
 * data access.
 */
export async function proxy(request: NextRequest) {
  return updateProxySession(request);
}

export const config = {
  // The admin area is the only place with an auth session to refresh.
  matcher: ["/admin", "/admin/:path*"],
};

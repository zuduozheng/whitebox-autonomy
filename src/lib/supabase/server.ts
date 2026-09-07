import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

/**
 * Request-scoped Supabase client for Server Components, Server Actions and
 * Route Handlers.
 *
 * Auth state lives entirely in cookies managed by @supabase/ssr. Its cookie
 * defaults in this version are `path=/`, `SameSite=Lax`, `httpOnly: false`
 * (the library keeps them script-readable so its browser client can read the
 * session; we run no browser client), no explicit `secure`, and a ~400-day
 * `max-age`. Nothing is kept in localStorage. The publishable (anon) key is the
 * only credential used; every query still runs under the caller's Row-Level
 * Security context, so a signed-in curator sees exactly what the curator
 * policies allow and no more.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `cookies()` is read-only when called during a Server Component
          // render. Writes from that context are safely ignored here; the proxy
          // (src/proxy.ts) persists refreshed auth cookies on the response.
        }
      },
    },
  });
}

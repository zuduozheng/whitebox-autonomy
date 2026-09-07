import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

/**
 * Refresh the Supabase auth session for a request passing through the proxy
 * (src/proxy.ts) and copy any rotated auth cookies — plus the cache-control
 * headers @supabase/ssr requires alongside them — onto the response.
 *
 * This ONLY keeps the session cookies fresh so Server Components / Actions see a
 * valid session. It performs no authorisation and MUST NOT be treated as the
 * access boundary — protected pages call requireCurator() on the server, and
 * PostgreSQL RLS is the final boundary for data. Deliberately no redirects.
 */
export async function updateProxySession(
  request: NextRequest,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      // @supabase/ssr 0.12.x calls setAll with (cookiesToSet, headers). Both the
      // request cookies (so this same request sees the new session) and the
      // response cookies (so the browser stores it) must be updated, and the
      // supplied headers — Cache-Control: private, no-store / Pragma / Expires —
      // must land on the response so a CDN or reverse proxy can never cache a
      // Set-Cookie carrying one user's rotated token and replay it to another.
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Refresh only. getClaims() verifies the access-token JWT (locally against the
  // project JWKS when asymmetric signing keys are used, otherwise via the Auth
  // server) and refreshes an about-to-expire token, emitting rotated cookies
  // through setAll above. The result is intentionally not inspected: the proxy
  // never gates or redirects. getSession() is never used as an auth source.
  await supabase.auth.getClaims();

  return response;
}

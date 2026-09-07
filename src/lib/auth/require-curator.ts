import { redirect } from "next/navigation";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export type CuratorRole = "curator" | "admin";

export interface Curator {
  userId: string;
  /** From the verified JWT claims when present; null if the token carries none. */
  email: string | null;
  role: CuratorRole;
}

/**
 * Server-side authorisation gate for the admin area. Call from every protected
 * layout and page — never rely on the proxy or on client-side checks.
 *
 *   1. build the request-scoped Supabase client (publishable key, RLS applies);
 *   2. verify identity with supabase.auth.getClaims(): it validates the
 *      access-token JWT (locally against the project JWKS when asymmetric
 *      signing keys are in use, otherwise via the Auth server) and returns its
 *      claims. Preferred over getUser() here because all we need is the verified
 *      subject and, if present, the email — not a freshly fetched Auth user
 *      record, which would add a guaranteed Auth-server round trip to every
 *      protected render. getSession() is never used as an authorisation source;
 *   3. no verified subject        → redirect to /admin/login;
 *   4. read public.user_profile for that subject — visible only through the
 *      `user_profile_self_read` RLS policy, so a user can see just their own row;
 *   5. require role in ('curator', 'admin');
 *   6. signed in but not a curator → redirect to /admin/login?error=access-denied
 *      (a plain "no access" state; no internal details are surfaced).
 *
 * Wrapped in React `cache` so a layout and its page share a single evaluation
 * per request. Never returns for an unauthorised caller — it always redirects.
 */
export const requireCurator = cache(async (): Promise<Curator> => {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub) {
    redirect("/admin/login");
  }

  const userId: string = claims.sub;
  // `email` is an optional JWT claim (a project's custom access-token hook may
  // omit it). Use it only when it is genuinely a string; never invent one, and
  // do not call getUser() just to obtain it.
  const email = typeof claims.email === "string" ? claims.email : null;

  const { data: profile, error: profileError } = await supabase
    .from("user_profile")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle<{ role: CuratorRole }>();

  if (
    profileError ||
    !profile ||
    (profile.role !== "curator" && profile.role !== "admin")
  ) {
    redirect("/admin/login?error=access-denied");
  }

  return { userId, email, role: profile.role };
});

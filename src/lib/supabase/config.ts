/**
 * Supabase connection parameters shared by the server-side auth clients:
 * the request-scoped client in ./server.ts and the proxy session refresher in
 * ./proxy-session.ts.
 *
 * Both values are the PUBLIC, browser-safe pair already used by the read-only
 * event source (src/lib/events/supabase-source.ts, .env.example):
 *
 *   NEXT_PUBLIC_SUPABASE_URL              — project REST/Auth origin; not a secret.
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  — anon / publishable key, constrained
 *                                          by PostgreSQL Row-Level Security.
 *
 * The service-role / secret key is deliberately NOT read here or anywhere in
 * the application. Curator authorisation is enforced by requireCurator() plus
 * RLS, never by a privileged key.
 *
 * This module imports nothing from `next/headers`, so it is safe to use from
 * the proxy (Edge) runtime as well as from Server Components / Server Actions.
 */
const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!rawUrl || !publishableKey) {
  const missing = [
    !rawUrl && "NEXT_PUBLIC_SUPABASE_URL",
    !publishableKey && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ]
    .filter(Boolean)
    .join(", ");
  throw new Error(
    `Supabase auth is not configured: missing ${missing}. Copy .env.example to ` +
      ".env.local and set the project URL and publishable key " +
      "(Supabase dashboard → Project Settings → API).",
  );
}

// supabase-js / @supabase/ssr want the bare project origin; tolerate a value
// that already carries the REST path (a common copy/paste), matching the
// normalisation in src/lib/events/supabase-source.ts.
export const SUPABASE_URL: string = rawUrl
  .replace(/\/+$/, "")
  .replace(/\/rest\/v1$/, "");

export const SUPABASE_PUBLISHABLE_KEY: string = publishableKey;

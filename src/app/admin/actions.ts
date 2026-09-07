"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Email + password sign-in (Server Action).
 *
 * On success the browser holds a fresh Supabase session cookie and is sent to
 * /admin, where requireCurator() decides whether this account may proceed. On
 * failure the user returns to the login page with a generic, non-sensitive
 * marker; the raw Supabase error is never rendered or logged, and success vs.
 * "no such user" vs. "wrong password" are deliberately indistinguishable.
 */
export async function signIn(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/admin/login?error=invalid");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect("/admin/login?error=invalid");
  }

  redirect("/admin");
}

/**
 * Sign out (Server Action). Safe to call whether or not a session exists.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}

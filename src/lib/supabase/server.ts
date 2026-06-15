import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

// Server client bound to the request's cookies — respects RLS as the logged-in user.
export async function createServerSupabase() {
  const env = serverEnv();
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet) {
        try {
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component where cookies are read-only — safe to ignore.
        }
      },
    },
  });
}

// Service-role client — bypasses RLS. Server-only, never expose. Used for the
// allow-list OTP gate and any privileged maintenance.
export function createAdminSupabase() {
  const env = serverEnv();
  return createAdmin(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Returns the authenticated user or null. */
export async function getUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

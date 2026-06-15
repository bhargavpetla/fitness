"use client";

import { createBrowserClient } from "@supabase/ssr";
import { PUBLIC_ENV } from "@/lib/env";

// Browser client — uses the anon key only. Safe to ship to the client.
export function createClient() {
  return createBrowserClient(PUBLIC_ENV.supabaseUrl, PUBLIC_ENV.supabaseAnonKey);
}

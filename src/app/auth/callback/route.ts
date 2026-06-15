import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

// OAuth redirect target. Google sends the user back here with a `code`; we exchange
// it for a session (cookies set via the SSR client), then send them into the app.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const errorDesc = url.searchParams.get("error_description");

  if (errorDesc) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(errorDesc)}`, url.origin));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", url.origin));
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?error=auth_failed", url.origin));
  }

  // page.tsx decides onboarding vs. main app based on the profile.
  return NextResponse.redirect(new URL("/", url.origin));
}

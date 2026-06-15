import { redirect } from "next/navigation";
import { getUser, createServerSupabase } from "@/lib/supabase/server";
import { hasSupabase } from "@/lib/env";
import { MainApp } from "@/components/MainApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  // If Supabase isn't configured yet, show a friendly setup notice instead of crashing.
  if (!hasSupabase()) {
    return (
      <div className="app-shell">
        <div className="center-screen">
          <div style={{ fontSize: 40 }}>🍃</div>
          <h1 style={{ fontSize: 22 }}>Almost there</h1>
          <p className="muted" style={{ maxWidth: 320 }}>
            Add your Supabase URL and keys to <code>.env</code>, run the SQL in{" "}
            <code>supabase/schema.sql</code>, then restart. See the README.
          </p>
        </div>
      </div>
    );
  }

  const user = await getUser();
  if (!user) redirect("/login");

  const supabase = await createServerSupabase();
  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarded, name, start_date")
    .maybeSingle();

  if (!profile?.onboarded) redirect("/onboarding");

  return <MainApp />;
}

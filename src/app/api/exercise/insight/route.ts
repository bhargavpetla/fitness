import { NextResponse } from "next/server";
import { getUser, createServerSupabase } from "@/lib/supabase/server";
import { exerciseInsight } from "@/lib/ai/gemini";

export const runtime = "nodejs";
export const maxDuration = 30;

// Earned insight: only after 7+ days of exercise data exist.
export async function POST() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createServerSupabase();
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const sinceStr = since.toISOString().slice(0, 10);

  const { data: logs, error } = await supabase
    .from("exercise_logs")
    .select("date, type, parsed_json")
    .gte("date", sinceStr)
    .order("date", { ascending: true });

  if (error) return NextResponse.json({ error: "Could not load logs." }, { status: 500 });

  // Gate: require at least 7 distinct logged days overall before insights unlock.
  const { count } = await supabase
    .from("exercise_logs")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) < 7) {
    return NextResponse.json(
      { error: "Insights unlock after 7 days of logs.", locked: true },
      { status: 403 }
    );
  }

  try {
    const text = await exerciseInsight(JSON.stringify(logs ?? []));
    return NextResponse.json({ insight: text });
  } catch (e) {
    console.error("exercise/insight failed:", e);
    return NextResponse.json({ error: "Could not generate insight." }, { status: 502 });
  }
}

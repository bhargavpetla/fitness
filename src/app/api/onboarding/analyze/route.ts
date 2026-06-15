import { NextResponse } from "next/server";
import { getUser, createServerSupabase } from "@/lib/supabase/server";
import { analyzeBody } from "@/lib/ai/anthropic";

export const runtime = "nodejs";
export const maxDuration = 45;

// Onboarding body analysis -> writes profile + an active versioned goal row.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    name?: string;
    first_name?: string;
    last_name?: string;
    age?: number;
    height_cm?: number;
    weight_kg?: number;
    sex?: string;
    build_note?: string;
    unit_pref?: string;
    activity_level?: string;
    daily_steps?: number;
    goal_type?: string;
    goal_note?: string;
    photos?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!body.weight_kg) {
    return NextResponse.json({ error: "Weight is required." }, { status: 400 });
  }

  let analysis;
  try {
    analysis = await analyzeBody({
      age: body.age ?? null,
      height_cm: body.height_cm ?? null,
      weight_kg: body.weight_kg,
      sex: body.sex ?? null,
      build_note: body.build_note ?? null,
      activity_level: body.activity_level ?? null,
      daily_steps: body.daily_steps ?? null,
      goal_type: body.goal_type ?? "auto",
      goal_note: body.goal_note ?? null,
      photos: body.photos ?? [],
    });
  } catch (e) {
    console.error("onboarding/analyze failed:", e);
    return NextResponse.json({ error: "Analysis failed. Try again." }, { status: 502 });
  }

  const supabase = await createServerSupabase();

  // Upsert profile and mark onboarded.
  const { error: pErr } = await supabase.from("profiles").upsert({
    user_id: user.id,
    name: body.name ?? null,
    first_name: body.first_name ?? null,
    last_name: body.last_name ?? null,
    age: body.age ?? null,
    height_cm: body.height_cm ?? null,
    sex: body.sex ?? "unspecified",
    build_note: body.build_note ?? null,
    activity_level: body.activity_level ?? null,
    daily_steps: body.daily_steps ?? null,
    unit_pref: body.unit_pref ?? "metric",
    onboarded: false, // flipped true only after the user confirms the (editable) goal
  });
  if (pErr) {
    console.error(pErr);
    return NextResponse.json({ error: "Could not save profile." }, { status: 500 });
  }

  // Record the starting weigh-in.
  await supabase.from("weigh_ins").insert({ user_id: user.id, weight_kg: body.weight_kg });

  // Return the analysis for the user to review/edit. The goal is written by
  // /api/onboarding/save-goal once they confirm — so they can tweak the numbers.
  return NextResponse.json({ analysis });
}

import { NextResponse } from "next/server";
import { getUser, createServerSupabase } from "@/lib/supabase/server";
import { analyzeBody } from "@/lib/ai/anthropic";
import { loadStoredMedicalDocuments } from "@/lib/medical-docs";

export const runtime = "nodejs";
export const maxDuration = 45;

// 7-day check-in: returns a PROPOSED new goal. Never auto-applies — the client
// shows a compare screen and POSTs to /api/checkin/apply only on accept.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { weight_kg?: number; photos?: string[]; goal_note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!body.weight_kg) {
    return NextResponse.json({ error: "Current weight is required." }, { status: 400 });
  }

  const supabase = await createServerSupabase();

  const [{ data: profile }, { data: activeGoal }, { data: lastWeigh }] = await Promise.all([
    supabase.from("profiles").select("*").eq("user_id", user.id).single(),
    supabase.from("goals").select("*").eq("user_id", user.id).eq("is_active", true).single(),
    supabase
      .from("weigh_ins")
      .select("weight_kg, date")
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!activeGoal) {
    return NextResponse.json({ error: "No active goal to compare against." }, { status: 400 });
  }

  // Average daily intake over the last 7 days.
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const { data: foods } = await supabase
    .from("food_logs")
    .select("date, calories, protein_g")
    .gte("date", since.toISOString().slice(0, 10));

  const byDay = new Map<string, { cal: number; p: number }>();
  for (const f of foods ?? []) {
    const cur = byDay.get(f.date) ?? { cal: 0, p: 0 };
    cur.cal += Number(f.calories);
    cur.p += Number(f.protein_g);
    byDay.set(f.date, cur);
  }
  const dayCount = byDay.size || 1;
  const avgCal = Math.round([...byDay.values()].reduce((a, d) => a + d.cal, 0) / dayCount);
  const avgP = Math.round([...byDay.values()].reduce((a, d) => a + d.p, 0) / dayCount);

  // Record the new weigh-in.
  await supabase.from("weigh_ins").insert({ user_id: user.id, weight_kg: body.weight_kg });

  try {
    const medicalDocs = await loadStoredMedicalDocuments(supabase, user.id);
    const analysis = await analyzeBody({
      age: profile?.age ?? null,
      height_cm: profile?.height_cm ?? null,
      weight_kg: body.weight_kg,
      sex: profile?.sex ?? null,
      build_note: profile?.build_note ?? null,
      goal_type: activeGoal.goal_type,
      goal_note: body.goal_note ?? null,
      photos: body.photos ?? [],
      medical_docs: medicalDocs,
      checkin: {
        prev_weight_kg: lastWeigh?.weight_kg ?? null,
        avg_daily_calories: avgCal || null,
        avg_daily_protein_g: avgP || null,
        current_target: {
          calories: Number(activeGoal.calories),
          protein_g: Number(activeGoal.protein_g),
          carbs_g: Number(activeGoal.carbs_g),
          fat_g: Number(activeGoal.fat_g),
        },
        days: 7,
      },
    });

    return NextResponse.json({
      current: {
        calories: Number(activeGoal.calories),
        protein_g: Number(activeGoal.protein_g),
        carbs_g: Number(activeGoal.carbs_g),
        fat_g: Number(activeGoal.fat_g),
      },
      proposed: analysis,
    });
  } catch (e) {
    console.error("checkin/analyze failed:", e);
    return NextResponse.json({ error: "Check-in analysis failed." }, { status: 502 });
  }
}

import { NextResponse } from "next/server";
import { getUser, createServerSupabase } from "@/lib/supabase/server";
import { progressSummary } from "@/lib/ai/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

// "Where am I / what to adjust" for the current week or month, grounded in the
// user's actual averaged intake vs their active goal + weight trend.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let period: "week" | "month" = "week";
  try {
    ({ period = "week" } = await req.json());
  } catch {
    /* default week */
  }

  const supabase = await createServerSupabase();
  const now = new Date();
  const start = new Date(now);
  if (period === "week") start.setDate(now.getDate() - 6);
  else start.setDate(now.getDate() - 29);
  const startStr = start.toLocaleDateString("en-CA");
  const totalDays = period === "week" ? 7 : 30;

  const [{ data: goal }, { data: foods }, { data: weighIns }] = await Promise.all([
    supabase.from("goals").select("*").eq("is_active", true).maybeSingle(),
    supabase.from("food_logs").select("date,calories,protein_g,carbs_g,fat_g").gte("date", startStr),
    supabase.from("weigh_ins").select("date,weight_kg").gte("date", startStr).order("date", { ascending: true }),
  ]);

  if (!goal) {
    return NextResponse.json({ error: "Set a goal first." }, { status: 400 });
  }

  // Aggregate per day, then average over the days that have any log.
  const byDay = new Map<string, { c: number; p: number; cb: number; f: number }>();
  for (const f of foods ?? []) {
    const cur = byDay.get(f.date) ?? { c: 0, p: 0, cb: 0, f: 0 };
    cur.c += Number(f.calories);
    cur.p += Number(f.protein_g);
    cur.cb += Number(f.carbs_g);
    cur.f += Number(f.fat_g);
    byDay.set(f.date, cur);
  }
  const daysLogged = byDay.size || 1;
  const sum = [...byDay.values()].reduce(
    (a, d) => ({ c: a.c + d.c, p: a.p + d.p, cb: a.cb + d.cb, f: a.f + d.f }),
    { c: 0, p: 0, cb: 0, f: 0 }
  );
  const avg = {
    calories: Math.round(sum.c / daysLogged),
    protein_g: Math.round(sum.p / daysLogged),
    carbs_g: Math.round(sum.cb / daysLogged),
    fat_g: Math.round(sum.f / daysLogged),
  };

  const weightChange =
    weighIns && weighIns.length >= 2
      ? Number(weighIns[weighIns.length - 1].weight_kg) - Number(weighIns[0].weight_kg)
      : null;

  try {
    const summary = await progressSummary({
      period,
      goal: {
        calories: Number(goal.calories),
        protein_g: Number(goal.protein_g),
        carbs_g: Number(goal.carbs_g),
        fat_g: Number(goal.fat_g),
        goal_type: goal.goal_type,
      },
      avg,
      days_logged: byDay.size,
      total_days: totalDays,
      weight_change_kg: weightChange,
    });
    return NextResponse.json({
      summary,
      avg,
      goal: {
        calories: Number(goal.calories),
        protein_g: Number(goal.protein_g),
        carbs_g: Number(goal.carbs_g),
        fat_g: Number(goal.fat_g),
      },
      days_logged: byDay.size,
      total_days: totalDays,
      weight_change_kg: weightChange,
    });
  } catch (e) {
    console.error("progress failed:", e);
    return NextResponse.json({ error: "Could not summarize." }, { status: 502 });
  }
}

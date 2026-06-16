import { NextResponse } from "next/server";
import { getUser, createServerSupabase } from "@/lib/supabase/server";
import { analyzeBody, estimateGoalTimeframe } from "@/lib/ai/anthropic";
import { loadStoredMedicalDocuments } from "@/lib/medical-docs";

export const runtime = "nodejs";
export const maxDuration = 60;

// Settings "End goal": the user types the body/target they want — a goal weight
// for weight loss, a target body-fat % for recomp, etc. (optional). Setting it
// does two AI things in one go:
//   1) RECOMPUTES the daily macro target with this end goal as the objective, so
//      the plan actually points at where they want to be, and
//   2) the AI — not the user — picks a healthy, efficient timeframe to get there.
// We then store the goal text, the AI target date, and stamp day 0 (set_at) so
// the home-screen countdown has a stable origin.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { end_goal?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const endGoal = (body.end_goal ?? "").trim();
  if (!endGoal) {
    return NextResponse.json({ error: "Describe the goal you want to reach." }, { status: 400 });
  }
  if (endGoal.length > 300) {
    return NextResponse.json({ error: "Keep the goal under 300 characters." }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const [{ data: profile }, { data: prevGoal }, { data: lastWeigh }] = await Promise.all([
    supabase.from("profiles").select("*").eq("user_id", user.id).single(),
    supabase.from("goals").select("*").eq("user_id", user.id).eq("is_active", true).maybeSingle(),
    supabase
      .from("weigh_ins")
      .select("weight_kg")
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const weight = lastWeigh?.weight_kg;
  if (!weight) {
    return NextResponse.json(
      { error: "Run a check-in or recompute once so we have your current weight, then set your end goal." },
      { status: 400 }
    );
  }

  // 1) Recompute macros with the end goal as the objective.
  let analysis;
  try {
    const medicalDocs = await loadStoredMedicalDocuments(supabase, user.id);
    analysis = await analyzeBody({
      age: profile?.age ?? null,
      height_cm: profile?.height_cm ?? null,
      weight_kg: Number(weight),
      sex: profile?.sex ?? null,
      build_note: profile?.build_note ?? null,
      activity_level: profile?.activity_level ?? null,
      daily_steps: profile?.daily_steps ?? null,
      goal_type: prevGoal?.goal_type ?? "auto",
      goal_note: `Target the user wants to reach: ${endGoal}`,
      medical_docs: medicalDocs,
    });

    await supabase.from("goals").update({ is_active: false }).eq("user_id", user.id);
    const { error: goalErr } = await supabase.from("goals").insert({
      user_id: user.id,
      calories: analysis.calories,
      protein_g: analysis.protein_g,
      carbs_g: analysis.carbs_g,
      fat_g: analysis.fat_g,
      goal_type: analysis.goal_type,
      source: "manual_settings",
      activity_level: analysis.activity_level ?? null,
      body_fat_estimate: analysis.body_fat_estimate,
      body_type_read: analysis.body_type_read,
      notes: analysis.rationale,
      is_active: true,
    });
    if (goalErr) return NextResponse.json({ error: "Could not save the new target." }, { status: 500 });
  } catch (e) {
    console.error("end-goal macro recompute failed:", e);
    return NextResponse.json({ error: "Could not recompute your plan. Try again." }, { status: 502 });
  }

  // 2) AI picks a healthy, efficient timeframe.
  let estimatedDays = 84;
  let rationale = "A steady, healthy pace.";
  try {
    const tf = await estimateGoalTimeframe({
      end_goal: endGoal,
      age: profile?.age ?? null,
      height_cm: profile?.height_cm ?? null,
      sex: profile?.sex ?? null,
      build_note: profile?.build_note ?? null,
      goal_type: analysis.goal_type,
      body_fat_estimate: analysis.body_fat_estimate,
      calories: analysis.calories,
      protein_g: analysis.protein_g,
    });
    estimatedDays = tf.estimated_days;
    rationale = tf.rationale;
  } catch (e) {
    console.warn("estimateGoalTimeframe failed, using default horizon:", e);
  }

  const today = new Date();
  const target = new Date(today);
  target.setDate(target.getDate() + estimatedDays);
  const targetDate = target.toISOString().slice(0, 10);
  const setAt = profile?.end_goal_set_at ?? today.toISOString().slice(0, 10);

  const { error } = await supabase
    .from("profiles")
    .update({
      end_goal: endGoal,
      end_goal_target_date: targetDate,
      end_goal_set_at: setAt,
    })
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Could not save goal." }, { status: 500 });

  return NextResponse.json({
    end_goal: endGoal,
    estimated_days: estimatedDays,
    target_date: targetDate,
    rationale,
    analysis,
  });
}

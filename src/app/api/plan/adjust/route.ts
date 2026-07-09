import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { generateMealPlan, generateWorkoutPlan } from "@/lib/ai/gemini";
import { indbPromptTable } from "@/lib/server/foodLibrary";
import {
  dstr,
  buildMealContext,
  buildWorkoutContext,
  buildProfileNote,
  prefsNoteOf,
  feedbackNoteOf,
  mapMealDays,
  mapWorkoutDays,
} from "@/lib/server/planBuilder";
import type { AiPlan, AiPlanDay, MealDayPayload, WorkoutDayPayload } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Life happens: an unexpected rest day, a missed workout, a skipped meal day.
// This route re-plans a plan's REMAINING days (date > today) around what
// actually happened so far — a missed leg day gets reshuffled forward, not
// dropped. Past days are never touched.

export async function POST(req: Request) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let planId = "";
  try {
    const body = await req.json();
    planId = String(body?.plan_id ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!planId) return NextResponse.json({ error: "plan_id required." }, { status: 400 });

  const { data: planData } = await sb.from("ai_plans").select("*").eq("id", planId).maybeSingle();
  const plan = planData as AiPlan | null;
  if (!plan || plan.status !== "active") {
    return NextResponse.json({ error: "Active plan not found." }, { status: 404 });
  }

  const { data: dayData } = await sb
    .from("ai_plan_days")
    .select("*")
    .eq("plan_id", plan.id)
    .order("day_index", { ascending: true });
  const days = (dayData ?? []) as AiPlanDay[];
  const today = dstr(new Date());
  const past = days.filter((d) => d.date <= today);
  const future = days.filter((d) => d.date > today);
  if (future.length === 0) {
    return NextResponse.json({ error: "The week is over — nothing left to adjust. Generate a new week instead." }, { status: 400 });
  }

  // What actually happened, day by day, for the planner to reshuffle around.
  const happened = past
    .map((d) => {
      if (plan.kind === "workout") {
        const p = d.payload as WorkoutDayPayload;
        const status = d.actual?.unexpected_rest
          ? "took an UNEXPECTED REST instead"
          : d.completed
            ? "completed"
            : p.kind === "rest"
              ? "rest day"
              : "MISSED (not done)";
        return `Day ${d.day_index} (planned: ${p.name}): ${status}`;
      }
      const p = d.payload as MealDayPayload;
      const status = d.completed ? "completed" : "not fully followed";
      return `Day ${d.day_index} (${p.meals.map((m) => m.name).join(", ")}): ${status}`;
    })
    .join("\n");

  const stillPlanned = future
    .map((d) => {
      if (plan.kind === "workout") {
        const p = d.payload as WorkoutDayPayload;
        return `Day ${d.day_index}: ${p.name}`;
      }
      const p = d.payload as MealDayPayload;
      return `Day ${d.day_index}: ${p.meals.map((m) => m.name).join(", ")}`;
    })
    .join("\n");

  const continuityNote = `WHAT HAPPENED SO FAR:\n${happened || "(week just started)"}\n\nCURRENTLY PLANNED FOR THE REMAINING DAYS (you are replacing these):\n${stillPlanned}`;

  const since = new Date();
  since.setDate(since.getDate() - 30);
  const dayFrom = future[0].day_index;
  const dayTo = future[future.length - 1].day_index;

  try {
    const profileNote = await buildProfileNote(sb);
    const prefsNote = prefsNoteOf(plan.kind, plan.meta?.prefs);
    const feedbackNote = feedbackNoteOf(plan.kind, plan.meta?.feedback);
    let payloads: Array<MealDayPayload | WorkoutDayPayload> = [];

    if (plan.kind === "meal") {
      const ctx = await buildMealContext(sb, dstr(since));
      const raw = await generateMealPlan({
        dayFrom,
        dayTo,
        totalDays: days.length,
        historyDigest: ctx.digest,
        goalText: ctx.goalText,
        profileNote,
        indbTable: indbPromptTable(),
        prefsNote,
        feedbackNote,
        continuityNote,
      });
      payloads = mapMealDays(raw, future.length);
    } else {
      const ctx = await buildWorkoutContext(sb, dstr(since));
      const raw = await generateWorkoutPlan({
        dayFrom,
        dayTo,
        totalDays: days.length,
        historyDigest: ctx.digest,
        configText: ctx.configText,
        profileNote,
        prefsNote,
        feedbackNote,
        continuityNote,
      });
      payloads = mapWorkoutDays(raw, future.length);
    }

    if (payloads.length < future.length) {
      return NextResponse.json({ error: "The coach returned an incomplete adjustment. Try again." }, { status: 502 });
    }

    // Replace only the remaining days' payloads, in day order.
    for (let i = 0; i < future.length; i++) {
      const { error } = await sb
        .from("ai_plan_days")
        .update({ payload: payloads[i], completed: false, completed_at: null, actual: null })
        .eq("id", future[i].id);
      if (error) throw new Error(error.message);
    }
    await sb
      .from("ai_plans")
      .update({ meta: { ...(plan.meta ?? {}), adjusted_at: new Date().toISOString() } })
      .eq("id", plan.id);

    return NextResponse.json({ ok: true, adjusted: future.length });
  } catch (e) {
    console.error("plan/adjust failed:", e);
    return NextResponse.json({ error: "Could not adjust the plan. Try again in a minute." }, { status: 502 });
  }
}

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
import type { AiPlan, MealDayPayload, WorkoutDayPayload, PlanKind, PlanPrefs } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Generates a 7-day AI Coach plan from the user's last 30 days of real logs,
// their stated preferences (cheat meals / rest days), and — from week two
// onward — their feedback on the previous week. One AI call (~20s).

const PLAN_DAYS = 7;

export async function POST(req: Request) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let kind: PlanKind;
  let prefs: PlanPrefs = {};
  try {
    const body = await req.json();
    kind = body?.kind === "workout" ? "workout" : "meal";
    if (body?.prefs && typeof body.prefs === "object") {
      const cm = Number(body.prefs.cheat_meals);
      const rd = Number(body.prefs.rest_days);
      if (Number.isFinite(cm)) prefs.cheat_meals = Math.max(0, Math.min(7, Math.round(cm)));
      if (Number.isFinite(rd)) prefs.rest_days = Math.max(0, Math.min(6, Math.round(rd)));
    }
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceStr = dstr(since);

  // The plan starts tomorrow — today is already half-lived.
  const start = new Date();
  start.setDate(start.getDate() + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + PLAN_DAYS - 1);

  // Feedback from the most recent finished week shapes this one.
  const { data: prevData } = await sb
    .from("ai_plans")
    .select("*")
    .eq("kind", kind)
    .neq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const prev = prevData as AiPlan | null;
  const feedbackNote = feedbackNoteOf(kind, prev?.meta?.feedback);

  try {
    const profileNote = await buildProfileNote(sb);
    let contextSummary = "";
    let payloads: Array<MealDayPayload | WorkoutDayPayload> = [];

    if (kind === "meal") {
      const ctx = await buildMealContext(sb, sinceStr);
      if (ctx.logCount < 5) {
        return NextResponse.json(
          { error: "Log a few more days of meals first — the coach plans from what you actually eat." },
          { status: 400 }
        );
      }
      const raw = await generateMealPlan({
        dayFrom: 1,
        dayTo: PLAN_DAYS,
        totalDays: PLAN_DAYS,
        historyDigest: ctx.digest,
        goalText: ctx.goalText,
        profileNote,
        indbTable: indbPromptTable(),
        prefsNote: prefsNoteOf("meal", prefs),
        feedbackNote,
      });
      contextSummary = String(raw.context_summary ?? "");
      payloads = mapMealDays(raw, PLAN_DAYS);
    } else {
      const ctx = await buildWorkoutContext(sb, sinceStr);
      const raw = await generateWorkoutPlan({
        dayFrom: 1,
        dayTo: PLAN_DAYS,
        totalDays: PLAN_DAYS,
        historyDigest: ctx.digest,
        configText: ctx.configText,
        profileNote,
        prefsNote: prefsNoteOf("workout", prefs),
        feedbackNote,
      });
      contextSummary = String(raw.context_summary ?? "");
      payloads = mapWorkoutDays(raw, PLAN_DAYS);
    }

    if (payloads.length < PLAN_DAYS) {
      return NextResponse.json({ error: "The coach returned an incomplete plan. Try again." }, { status: 502 });
    }

    // Retire any currently-active plan of this kind, then create the new one.
    await sb.from("ai_plans").update({ status: "stopped" }).eq("kind", kind).eq("status", "active");
    const { data: plan, error: planErr } = await sb
      .from("ai_plans")
      .insert({
        user_id: user.id,
        kind,
        status: "active",
        start_date: dstr(start),
        end_date: dstr(end),
        context_summary: contextSummary,
        meta: { prefs },
      })
      .select()
      .single();
    if (planErr || !plan) throw new Error(planErr?.message ?? "insert failed");

    const rows = payloads.map((payload, i) => {
      const date = new Date(start);
      date.setDate(date.getDate() + i);
      return { plan_id: plan.id, user_id: user.id, date: dstr(date), day_index: i + 1, payload };
    });
    const { error: daysErr } = await sb.from("ai_plan_days").insert(rows);
    if (daysErr) {
      await sb.from("ai_plans").delete().eq("id", plan.id);
      throw new Error(daysErr.message);
    }

    return NextResponse.json({ plan_id: plan.id });
  } catch (e) {
    console.error("plan/generate failed:", e);
    return NextResponse.json({ error: "Could not generate the plan. Try again in a minute." }, { status: 502 });
  }
}

import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { generateMealPlan, generateWorkoutPlan } from "@/lib/ai/gemini";
import { indbPromptTable, matchRecipe, imageKeyOf } from "@/lib/server/foodLibrary";
import { matchExercise } from "@/lib/server/exerciseMatch";
import type {
  FoodLog,
  ExerciseLog,
  Goal,
  Profile,
  ExerciseConfig,
  MealDayPayload,
  WorkoutDayPayload,
  PlanKind,
  AiPlan,
  AiPlanDay,
  PlanMeal,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Generates a 30-day AI Coach plan from the user's last 30 days of real logs,
// grounded in the Indian food / exercise datasets. A full month in one AI call
// takes ~70s — past the serverless limit — so the client asks for it in two
// halves: part 1 (days 1-15) creates the plan, part 2 (days 16-30) completes
// it with visibility into part 1 for variety/overload continuity. A plan whose
// meta.partial is true can always be finished by re-calling part 2.

const PLAN_DAYS = 30;
const HALF = 15;

function dstr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const r1 = (n: unknown) => Math.round(Number(n) * 10) / 10 || 0;

export async function POST(req: Request) {
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let kind: PlanKind;
  let part: 1 | 2;
  let planId: string | null;
  try {
    const body = await req.json();
    kind = body?.kind === "workout" ? "workout" : "meal";
    part = body?.part === 2 ? 2 : 1;
    planId = body?.plan_id ? String(body.plan_id) : null;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Part 2 continues an existing partial plan.
  let plan: AiPlan | null = null;
  let existingDays: AiPlanDay[] = [];
  if (part === 2) {
    if (!planId) return NextResponse.json({ error: "plan_id required for part 2." }, { status: 400 });
    const { data } = await sb.from("ai_plans").select("*").eq("id", planId).maybeSingle();
    plan = data as AiPlan | null;
    if (!plan || plan.kind !== kind) {
      return NextResponse.json({ error: "Plan not found." }, { status: 404 });
    }
    const { data: dayData } = await sb
      .from("ai_plan_days")
      .select("*")
      .eq("plan_id", plan.id)
      .order("day_index", { ascending: true });
    existingDays = (dayData ?? []) as AiPlanDay[];
    if (existingDays.length >= PLAN_DAYS) {
      return NextResponse.json({ plan_id: plan.id, partial: false });
    }
  }

  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceStr = dstr(since);

  // New plans start tomorrow — today is already half-lived.
  const start = part === 2 && plan ? new Date(plan.start_date + "T00:00:00") : new Date();
  if (part === 1) start.setDate(start.getDate() + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + PLAN_DAYS - 1);

  const dayFrom = part === 1 ? 1 : existingDays.length + 1;
  const dayTo = part === 1 ? HALF : PLAN_DAYS;

  const [{ data: profile }, { data: goal }] = await Promise.all([
    sb.from("profiles").select("*").maybeSingle(),
    sb.from("goals").select("*").eq("is_active", true).maybeSingle(),
  ]);
  const p = profile as Profile | null;
  const g = goal as Goal | null;
  const profileNote = [
    p?.first_name ? `Name: ${p.first_name}.` : "",
    p?.age ? `Age ${p.age}.` : "",
    p?.sex && p.sex !== "unspecified" ? p.sex : "",
    g?.goal_type ? `Goal type: ${g.goal_type}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  try {
    let contextSummary = "";
    let dayRows: Array<MealDayPayload | WorkoutDayPayload> = [];

    if (kind === "meal") {
      const { data } = await sb
        .from("food_logs")
        .select("date, meal_label, items_json, calories, protein_g")
        .gte("date", sinceStr)
        .order("date", { ascending: true });
      const logs = (data ?? []) as Pick<FoodLog, "date" | "meal_label" | "items_json" | "calories" | "protein_g">[];
      if (part === 1 && logs.length < 5) {
        return NextResponse.json(
          { error: "Log a few more days of meals first — the coach plans from what you actually eat." },
          { status: 400 }
        );
      }

      const digest = logs
        .map((l) => {
          const items = (l.items_json ?? []).map((i) => i.name).slice(0, 5).join(", ");
          return `${l.date} ${l.meal_label ?? "meal"}: ${items || "?"} (${Math.round(Number(l.calories))} kcal, P${Math.round(Number(l.protein_g))})`;
        })
        .join("\n");

      const goalText = g
        ? `${Math.round(g.calories)} kcal, protein ${Math.round(g.protein_g)}g, carbs ${Math.round(g.carbs_g)}g, fat ${Math.round(g.fat_g)}g per day (${g.goal_type}).`
        : "No explicit goal set — keep days around their recent average intake, protein-forward.";

      // Part 2 sees the tail of part 1 so the variety window holds at the seam.
      const continuityNote =
        part === 2
          ? existingDays
              .slice(-5)
              .map((d) => {
                const meals = (d.payload as MealDayPayload).meals.map((m) => m.name).join(", ");
                return `Day ${d.day_index}: ${meals}`;
              })
              .join("\n")
          : undefined;

      const raw = await generateMealPlan({
        dayFrom,
        dayTo,
        historyDigest: digest,
        goalText,
        profileNote,
        indbTable: indbPromptTable(),
        continuityNote,
      });
      contextSummary = String(raw.context_summary ?? "");

      dayRows = (raw.days ?? []).slice(0, dayTo - dayFrom + 1).map((d) => {
        const meals: PlanMeal[] = (d.meals ?? []).map((m) => {
          const rec = matchRecipe(m.name);
          return {
            slot: String(m.slot ?? "meal"),
            name: String(m.name ?? "Meal"),
            desc: String(m.desc ?? ""),
            portion: String(m.portion ?? ""),
            calories: r1(m.calories),
            protein_g: r1(m.protein_g),
            carbs_g: r1(m.carbs_g),
            fat_g: r1(m.fat_g),
            verified: Boolean(m.verified),
            image_key: rec ? imageKeyOf(rec) : null,
            image_src: rec?.image ?? null,
            recipe: rec && rec.steps.length ? { steps: rec.steps, time_min: rec.time_min } : null,
          };
        });
        const totals = meals.reduce(
          (a, m) => ({
            calories: r1(a.calories + m.calories),
            protein_g: r1(a.protein_g + m.protein_g),
            carbs_g: r1(a.carbs_g + m.carbs_g),
            fat_g: r1(a.fat_g + m.fat_g),
          }),
          { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
        );
        return { meals, totals, note: d.note ? String(d.note) : null } satisfies MealDayPayload;
      });
    } else {
      const { data } = await sb
        .from("exercise_logs")
        .select("date, type, parsed_json")
        .gte("date", sinceStr)
        .order("date", { ascending: true });
      const logs = (data ?? []) as Pick<ExerciseLog, "date" | "type" | "parsed_json">[];
      const { data: cfgData } = await sb.from("exercise_config").select("*").maybeSingle();
      const cfg = cfgData as ExerciseConfig | null;

      const digest = logs
        .map((l) => {
          if (l.type !== "strength" || !l.parsed_json) return `${l.date}: ${l.type}`;
          const exs = (l.parsed_json.exercises ?? [])
            .map((e) => {
              const sets = e.set_list ?? [];
              const w = sets.find((s) => s.weight_kg != null)?.weight_kg;
              return `${e.name} ${sets.length}×${sets[0]?.reps ?? "?"}${w != null ? `@${w}` : ""}`;
            })
            .join(", ");
          return `${l.date} ${l.parsed_json.workout_name ?? "Strength"}: ${exs}`;
        })
        .join("\n");

      const configText = `Weekly session target: ${cfg?.weekly_target_sessions ?? 4}. ${cfg?.split_pattern ? `Preferred split: ${cfg.split_pattern}.` : ""} ${logs.length === 0 ? "No workout history — start conservative, beginner-friendly weights (or bodyweight), full-body 3×/week." : ""}`;

      const continuityNote =
        part === 2
          ? existingDays
              .map((d) => {
                const pl = d.payload as WorkoutDayPayload;
                if (pl.kind === "rest") return `Day ${d.day_index}: Rest`;
                const exs = pl.exercises.map((e) => `${e.name} ${e.sets}×${e.reps}${e.weight_kg != null ? `@${e.weight_kg}` : ""}`).join(", ");
                return `Day ${d.day_index} ${pl.name}: ${exs}`;
              })
              .join("\n")
          : undefined;

      const raw = await generateWorkoutPlan({
        dayFrom,
        dayTo,
        historyDigest: digest || "(no workouts logged yet)",
        configText,
        profileNote,
        continuityNote,
      });
      contextSummary = String(raw.context_summary ?? "");

      dayRows = (raw.days ?? []).slice(0, dayTo - dayFrom + 1).map((d) => {
        const isRest = d.kind === "rest" || !(d.exercises ?? []).length;
        const exercises = isRest
          ? []
          : (d.exercises ?? []).map((e) => {
              const m = matchExercise(String(e.name ?? ""));
              return {
                name: String(e.name ?? "Exercise"),
                sets: Math.max(1, Math.round(Number(e.sets) || 3)),
                reps: Math.max(1, Math.round(Number(e.reps) || 10)),
                weight_kg: e.weight_kg == null ? null : r1(e.weight_kg),
                note: e.note ? String(e.note) : null,
                media: m?.media ?? null,
                primary_muscle: m?.target ?? null,
                steps: m?.steps ?? [],
              };
            });
        return {
          kind: isRest ? "rest" : "workout",
          name: String(d.name ?? (isRest ? "Rest" : "Workout")),
          focus: Array.isArray(d.focus) ? d.focus.map(String) : [],
          exercises,
          note: d.note ? String(d.note) : null,
        } satisfies WorkoutDayPayload;
      });
    }

    if (dayRows.length < dayTo - dayFrom + 1) {
      return NextResponse.json({ error: "The coach returned an incomplete plan. Try again." }, { status: 502 });
    }

    if (part === 1) {
      // Retire any currently-active plan of this kind, then create the new one.
      await sb.from("ai_plans").update({ status: "stopped" }).eq("kind", kind).eq("status", "active");
      const { data: created, error: planErr } = await sb
        .from("ai_plans")
        .insert({
          user_id: user.id,
          kind,
          status: "active",
          start_date: dstr(start),
          end_date: dstr(end),
          context_summary: contextSummary,
          meta: {
            partial: true,
            ...(g ? { goal_snapshot: { calories: g.calories, protein_g: g.protein_g } } : {}),
          },
        })
        .select()
        .single();
      if (planErr || !created) throw new Error(planErr?.message ?? "insert failed");
      plan = created as AiPlan;
    }
    if (!plan) throw new Error("no plan");

    const rows = dayRows.map((payload, i) => {
      const date = new Date(start);
      date.setDate(date.getDate() + (dayFrom - 1) + i);
      return {
        plan_id: plan!.id,
        user_id: user.id,
        date: dstr(date),
        day_index: dayFrom + i,
        payload,
      };
    });
    const { error: daysErr } = await sb.from("ai_plan_days").insert(rows);
    if (daysErr) {
      if (part === 1) await sb.from("ai_plans").delete().eq("id", plan.id);
      throw new Error(daysErr.message);
    }

    if (part === 2) {
      await sb
        .from("ai_plans")
        .update({ meta: { ...(plan.meta ?? {}), partial: false } })
        .eq("id", plan.id);
    }

    return NextResponse.json({ plan_id: plan.id, partial: part === 1 });
  } catch (e) {
    console.error("plan/generate failed:", e);
    return NextResponse.json({ error: "Could not generate the plan. Try again in a minute." }, { status: 502 });
  }
}

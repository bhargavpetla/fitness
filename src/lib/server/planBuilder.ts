import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { matchRecipe, imageKeyOf } from "@/lib/server/foodLibrary";
import { matchExercise } from "@/lib/server/exerciseMatch";
import type { RawMealPlan, RawWorkoutPlan } from "@/lib/ai/gemini";
import type {
  FoodLog,
  ExerciseLog,
  Goal,
  Profile,
  ExerciseConfig,
  MealDayPayload,
  WorkoutDayPayload,
  PlanMeal,
  PlanPrefs,
  PlanFeedback,
} from "@/lib/types";

// Shared plumbing for the AI Coach plan routes: history digests fed to the
// planner, and mapping of raw AI output into stored day payloads (with the
// recipe/exercise datasets matched in).

const r1 = (n: unknown) => Math.round(Number(n) * 10) / 10 || 0;

// A storage-safe key from a dish name (matches the sanitising the meal-image
// route does), so unmatched dishes get a stable slot for their generated photo.
const slugifyName = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "dish";

export function dstr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface MealContext {
  digest: string;
  goalText: string;
  logCount: number;
}

export async function buildMealContext(sb: SupabaseClient, sinceStr: string): Promise<MealContext> {
  const [{ data }, { data: goal }] = await Promise.all([
    sb
      .from("food_logs")
      .select("date, meal_label, items_json, calories, protein_g")
      .gte("date", sinceStr)
      .order("date", { ascending: true }),
    sb.from("goals").select("*").eq("is_active", true).maybeSingle(),
  ]);
  const logs = (data ?? []) as Pick<FoodLog, "date" | "meal_label" | "items_json" | "calories" | "protein_g">[];
  const g = goal as Goal | null;
  const digest = logs
    .map((l) => {
      const items = (l.items_json ?? []).map((i) => i.name).slice(0, 5).join(", ");
      return `${l.date} ${l.meal_label ?? "meal"}: ${items || "?"} (${Math.round(Number(l.calories))} kcal, P${Math.round(Number(l.protein_g))})`;
    })
    .join("\n");
  const goalText = g
    ? `${Math.round(g.calories)} kcal, protein ${Math.round(g.protein_g)}g, carbs ${Math.round(g.carbs_g)}g, fat ${Math.round(g.fat_g)}g per day (${g.goal_type}).`
    : "No explicit goal set — keep days around their recent average intake, protein-forward.";
  return { digest, goalText, logCount: logs.length };
}

export interface WorkoutContext {
  digest: string;
  configText: string;
}

export async function buildWorkoutContext(sb: SupabaseClient, sinceStr: string): Promise<WorkoutContext> {
  const [{ data }, { data: cfgData }] = await Promise.all([
    sb.from("exercise_logs").select("date, type, parsed_json").gte("date", sinceStr).order("date", { ascending: true }),
    sb.from("exercise_config").select("*").maybeSingle(),
  ]);
  const logs = (data ?? []) as Pick<ExerciseLog, "date" | "type" | "parsed_json">[];
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

  // Spell out the rotation tail so day 1 of the plan continues it — after
  // Push → Legs → Rest, the next session is Pull, not a restart.
  const recent = logs
    .slice(-4)
    .map((l) => (l.type === "strength" ? (l.parsed_json?.workout_name ?? "Strength") : l.type))
    .join(" → ");
  const digestWithTail = digest
    ? `${digest}\n\nMOST RECENT DAYS, IN ORDER (continue this rotation): ${recent}`
    : "(no workouts logged yet)";
  return { digest: digestWithTail, configText };
}

export async function buildProfileNote(sb: SupabaseClient): Promise<string> {
  const [{ data: profile }, { data: goal }] = await Promise.all([
    sb.from("profiles").select("*").maybeSingle(),
    sb.from("goals").select("goal_type").eq("is_active", true).maybeSingle(),
  ]);
  const p = profile as Profile | null;
  const g = goal as Pick<Goal, "goal_type"> | null;
  return [
    p?.first_name ? `Name: ${p.first_name}.` : "",
    p?.age ? `Age ${p.age}.` : "",
    p?.sex && p.sex !== "unspecified" ? p.sex : "",
    g?.goal_type ? `Goal type: ${g.goal_type}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function prefsNoteOf(kind: "meal" | "workout", prefs: PlanPrefs | undefined): string | undefined {
  if (!prefs) return undefined;
  if (kind === "meal" && prefs.cheat_meals != null) {
    return prefs.cheat_meals === 0
      ? "No cheat meals — keep every meal on plan."
      : `${prefs.cheat_meals} cheat meal${prefs.cheat_meals > 1 ? "s" : ""} this week, please.`;
  }
  if (kind === "workout" && prefs.rest_days != null) {
    return `${prefs.rest_days} rest day${prefs.rest_days > 1 ? "s" : ""} this week.`;
  }
  return undefined;
}

export function feedbackNoteOf(kind: "meal" | "workout", fb: PlanFeedback | undefined): string | undefined {
  if (!fb) return undefined;
  const parts: string[] = [];
  if (fb.liked != null) parts.push(fb.liked ? "I liked last week's plan." : "Last week's plan didn't quite work for me.");
  if (kind === "workout" && fb.intensity && fb.intensity !== "same")
    parts.push(fb.intensity === "more" ? "I want MORE intensity this week." : "Take the intensity DOWN a notch.");
  if (kind === "meal" && fb.food && fb.food !== "same")
    parts.push(fb.food === "more" ? "I want more filling, bigger meals (within my goal)." : "I want lighter meals.");
  if (fb.note) parts.push(`Note: ${fb.note}`);
  return parts.length ? parts.join(" ") : undefined;
}

// ---- raw AI output -> stored payloads (datasets matched in) ----

export function mapMealDays(raw: RawMealPlan, expected: number): MealDayPayload[] {
  return (raw.days ?? []).slice(0, expected).map((d) => {
    const meals: PlanMeal[] = (d.meals ?? []).map((m) => {
      const name = String(m.name ?? "Meal");
      const rec = matchRecipe(name);
      return {
        slot: String(m.slot ?? "meal"),
        name,
        desc: String(m.desc ?? ""),
        portion: String(m.portion ?? ""),
        calories: r1(m.calories),
        protein_g: r1(m.protein_g),
        carbs_g: r1(m.carbs_g),
        fat_g: r1(m.fat_g),
        verified: Boolean(m.verified),
        // Every meal gets a stable key. Matched dishes carry the dataset image
        // as `image_src`; unmatched ones fall back to an AI-generated photo
        // (the route caches both under this key).
        image_key: rec ? imageKeyOf(rec) : slugifyName(name),
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
    return { meals, totals, note: d.note ? String(d.note) : null };
  });
}

export function mapWorkoutDays(raw: RawWorkoutPlan, expected: number): WorkoutDayPayload[] {
  return (raw.days ?? []).slice(0, expected).map((d) => {
    const isRest = d.kind === "rest" || !(d.exercises ?? []).length;
    const exercises = isRest
      ? []
      : (d.exercises ?? []).map((e) => {
          const m = matchExercise(String(e.name ?? ""));
          const reps = Math.max(1, Math.round(Number(e.reps) || 10));
          // Progressive-overload rep range. Prefer the coach's explicit range;
          // otherwise derive a window around the target so heavy lifts land
          // ~6–8, accessories ~8–10, isolation ~10–12 — never a flat number.
          const repHigh = e.rep_high != null ? Math.max(1, Math.round(Number(e.rep_high))) : reps;
          const repLowRaw = e.rep_low != null ? Math.round(Number(e.rep_low)) : reps - 2;
          const repLow = Math.max(1, Math.min(repLowRaw, repHigh));
          return {
            name: String(e.name ?? "Exercise"),
            sets: Math.max(1, Math.round(Number(e.sets) || 3)),
            reps: repHigh,
            rep_low: repLow,
            rep_high: repHigh,
            weight_kg: e.weight_kg == null ? null : r1(e.weight_kg),
            note: e.note ? String(e.note) : null,
            media: m?.media ?? null,
            primary_muscle: m?.target ?? null,
            steps: m?.steps ?? [],
          };
        });
    return {
      kind: isRest ? ("rest" as const) : ("workout" as const),
      name: String(d.name ?? (isRest ? "Rest" : "Workout")),
      focus: Array.isArray(d.focus) ? d.focus.map(String) : [],
      exercises,
      note: d.note ? String(d.note) : null,
    };
  });
}

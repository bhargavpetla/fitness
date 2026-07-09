"use client";

import { createClient } from "@/lib/supabase/client";
import { bumpStreak } from "@/lib/streak";
import { todayStr } from "@/lib/date";
import type {
  Profile,
  Goal,
  FoodLog,
  FoodItem,
  Vitamins,
  ExerciseLog,
  ParsedExercise,
  ExerciseConfig,
  Streak,
  CustomExercise,
  AiPlan,
  AiPlanDay,
  PlanKind,
} from "@/lib/types";

// Thin client-side data layer over Supabase. RLS guarantees rows belong to the user.

export async function fetchProfile(): Promise<Profile | null> {
  const sb = createClient();
  const { data } = await sb.from("profiles").select("*").maybeSingle();
  return (data as Profile) ?? null;
}

export async function fetchActiveGoal(): Promise<Goal | null> {
  const sb = createClient();
  const { data } = await sb.from("goals").select("*").eq("is_active", true).maybeSingle();
  return (data as Goal) ?? null;
}

export async function fetchFoodLogs(date: string): Promise<FoodLog[]> {
  const sb = createClient();
  const { data } = await sb
    .from("food_logs")
    .select("*")
    .eq("date", date)
    .order("created_at", { ascending: false });
  return (data as FoodLog[]) ?? [];
}

export interface RecentFoodInput {
  raw_input: string;
  meal_label: string;
  date: string;
  calories: number;
}

// Recent meals the user logged, de-duplicated by their typed text, newest first.
// Powers the "log it again" quick-pick chips on the add screen. Excludes today so
// the suggestions are genuinely "what you ate before", and photo-only entries
// (no typed text) since there's nothing to re-fill.
export async function fetchRecentFoodInputs(limit = 6): Promise<RecentFoodInput[]> {
  const sb = createClient();
  const { data } = await sb
    .from("food_logs")
    .select("raw_input, meal_label, date, calories")
    .lt("date", todayStr())
    .order("created_at", { ascending: false })
    .limit(40);
  const seen = new Set<string>();
  const out: RecentFoodInput[] = [];
  for (const row of data ?? []) {
    const text = (row.raw_input ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      raw_input: text,
      meal_label: row.meal_label ?? "",
      date: row.date,
      calories: Number(row.calories) || 0,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// Per-day calorie + protein totals over a date range (inclusive), summed across
// all of a day's meals. Powers the goal-progress "days to goal" estimate, which
// counts days the user actually hit their targets.
export async function fetchDailyTotals(
  fromDate: string,
  toDate: string
): Promise<Array<{ date: string; calories: number; protein_g: number }>> {
  const sb = createClient();
  const { data } = await sb
    .from("food_logs")
    .select("date, calories, protein_g")
    .gte("date", fromDate)
    .lte("date", toDate);
  const byDay = new Map<string, { date: string; calories: number; protein_g: number }>();
  for (const row of data ?? []) {
    const d = byDay.get(row.date) ?? { date: row.date, calories: 0, protein_g: 0 };
    d.calories += Number(row.calories);
    d.protein_g += Number(row.protein_g);
    byDay.set(row.date, d);
  }
  return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function addFoodLog(input: {
  date: string;
  meal_label: string;
  raw_input: string;
  items: FoodItem[];
  totals: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  vitamins?: Vitamins;
  photo_url?: string | null;
}): Promise<FoodLog | null> {
  const sb = createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return null;
  const { data, error } = await sb
    .from("food_logs")
    .insert({
      user_id: u.user.id,
      date: input.date,
      meal_label: input.meal_label,
      raw_input: input.raw_input,
      photo_url: input.photo_url ?? null,
      calories: input.totals.calories,
      protein_g: input.totals.protein_g,
      carbs_g: input.totals.carbs_g,
      fat_g: input.totals.fat_g,
      items_json: input.items,
      vitamins_json: input.vitamins ?? null,
    })
    .select()
    .single();
  if (error) {
    console.error(error);
    return null;
  }
  await touchStreak(input.date);
  return data as FoodLog;
}

export async function deleteFoodLog(id: string): Promise<void> {
  const sb = createClient();
  await sb.from("food_logs").delete().eq("id", id);
}

export async function updateFoodTotals(
  id: string,
  totals: { calories: number; protein_g: number; carbs_g: number; fat_g: number },
  items: FoodItem[]
): Promise<void> {
  const sb = createClient();
  await sb.from("food_logs").update({ ...totals, items_json: items }).eq("id", id);
}

export async function fetchExerciseLogs(date: string): Promise<ExerciseLog[]> {
  const sb = createClient();
  const { data } = await sb
    .from("exercise_logs")
    .select("*")
    .eq("date", date)
    .order("created_at", { ascending: false });
  return (data as ExerciseLog[]) ?? [];
}

// One workout by id (RLS scopes it to the owner). Powers the detail screen.
export async function fetchExerciseLogById(id: string): Promise<ExerciseLog | null> {
  const sb = createClient();
  const { data } = await sb.from("exercise_logs").select("*").eq("id", id).maybeSingle();
  return (data as ExerciseLog) ?? null;
}

// All exercise logs since a date — powers the analytics trends.
export async function fetchExerciseSince(fromDate: string): Promise<ExerciseLog[]> {
  const sb = createClient();
  const { data } = await sb
    .from("exercise_logs")
    .select("*")
    .gte("date", fromDate)
    .order("date", { ascending: true });
  return (data as ExerciseLog[]) ?? [];
}

// Weigh-ins since a date, oldest first — the analytics weight trend.
export async function fetchWeighInsSince(fromDate: string): Promise<Array<{ date: string; weight_kg: number }>> {
  const sb = createClient();
  const { data } = await sb
    .from("weigh_ins")
    .select("date, weight_kg")
    .gte("date", fromDate)
    .order("date", { ascending: true });
  return (data ?? []).map((r) => ({ date: r.date as string, weight_kg: Number(r.weight_kg) }));
}

// All strength workouts, newest first — used for PRs and today-vs-last history.
export async function fetchStrengthHistory(limit = 60): Promise<ExerciseLog[]> {
  const sb = createClient();
  const { data } = await sb
    .from("exercise_logs")
    .select("*")
    .eq("type", "strength")
    .order("date", { ascending: false })
    .limit(limit);
  return (data as ExerciseLog[]) ?? [];
}

export async function fetchWeekExerciseCount(weekStartStr: string): Promise<number> {
  const sb = createClient();
  // Count distinct non-rest days logged this week.
  const { data } = await sb
    .from("exercise_logs")
    .select("date, type")
    .gte("date", weekStartStr)
    .neq("type", "rest");
  const days = new Set((data ?? []).map((r) => r.date));
  return days.size;
}

export async function addExerciseLog(input: {
  date: string;
  parsed: ParsedExercise;
  raw_input: string;
}): Promise<ExerciseLog | null> {
  const sb = createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return null;
  const { data, error } = await sb
    .from("exercise_logs")
    .insert({
      user_id: u.user.id,
      date: input.date,
      type: input.parsed.type,
      raw_input: input.raw_input,
      parsed_json: input.parsed,
      est_calories: input.parsed.est_calories,
    })
    .select()
    .single();
  if (error) {
    console.error(error);
    return null;
  }
  await touchStreak(input.date);
  return data as ExerciseLog;
}

export async function deleteExerciseLog(id: string): Promise<void> {
  const sb = createClient();
  await sb.from("exercise_logs").delete().eq("id", id);
}

export async function fetchExerciseConfig(): Promise<ExerciseConfig | null> {
  const sb = createClient();
  const { data } = await sb.from("exercise_config").select("*").maybeSingle();
  return (data as ExerciseConfig) ?? null;
}

export async function saveExerciseConfig(cfg: Partial<ExerciseConfig>): Promise<void> {
  const sb = createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return;
  await sb.from("exercise_config").upsert({
    user_id: u.user.id,
    weekly_target_sessions: cfg.weekly_target_sessions ?? 4,
    split_pattern: cfg.split_pattern ?? null,
    cardio_target_per_week: cfg.cardio_target_per_week ?? null,
    updated_at: new Date().toISOString(),
  });
}

// ---- custom exercises (user's own additions to the exercise library) ----

export async function fetchCustomExercises(): Promise<CustomExercise[]> {
  const sb = createClient();
  const { data } = await sb.from("custom_exercises").select("*").order("created_at", { ascending: false });
  return (data as CustomExercise[]) ?? [];
}

export async function addCustomExercise(input: {
  name: string;
  body_part: string;
  equipment: string;
  target: string;
}): Promise<CustomExercise | null> {
  const sb = createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return null;
  const { data, error } = await sb
    .from("custom_exercises")
    .insert({ user_id: u.user.id, ...input })
    .select()
    .single();
  if (error) {
    console.error(error);
    return null;
  }
  return data as CustomExercise;
}

// ---- AI Coach plans ----

export async function fetchActivePlan(kind: PlanKind): Promise<AiPlan | null> {
  const sb = createClient();
  const { data } = await sb
    .from("ai_plans")
    .select("*")
    .eq("kind", kind)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as AiPlan) ?? null;
}

export async function fetchPlanDays(planId: string): Promise<AiPlanDay[]> {
  const sb = createClient();
  const { data } = await sb
    .from("ai_plan_days")
    .select("*")
    .eq("plan_id", planId)
    .order("day_index", { ascending: true });
  return (data as AiPlanDay[]) ?? [];
}

export async function updatePlanDay(
  id: string,
  patch: Partial<Pick<AiPlanDay, "completed" | "completed_at" | "photo_url" | "actual">>
): Promise<void> {
  const sb = createClient();
  await sb.from("ai_plan_days").update(patch).eq("id", id);
}

// Stop keeps the plan (and its history) around; delete removes it entirely
// (ai_plan_days cascade).
export async function setPlanStatus(id: string, status: "stopped" | "completed"): Promise<void> {
  const sb = createClient();
  await sb.from("ai_plans").update({ status }).eq("id", id);
}

export async function updatePlanMeta(id: string, meta: AiPlan["meta"]): Promise<void> {
  const sb = createClient();
  await sb.from("ai_plans").update({ meta }).eq("id", id);
}

// Most recent plan of a kind that isn't the active one — its feedback shapes
// the next week's generation.
export async function fetchLatestEndedPlan(kind: PlanKind): Promise<AiPlan | null> {
  const sb = createClient();
  const { data } = await sb
    .from("ai_plans")
    .select("*")
    .eq("kind", kind)
    .neq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as AiPlan) ?? null;
}

export async function deletePlan(id: string): Promise<void> {
  const sb = createClient();
  await sb.from("ai_plans").delete().eq("id", id);
}

export async function fetchStreak(): Promise<Streak | null> {
  const sb = createClient();
  const { data } = await sb.from("streaks").select("*").maybeSingle();
  return (data as Streak) ?? null;
}

// Recompute + persist streak after a log. Counts any log day (food or exercise).
async function touchStreak(logDate: string): Promise<void> {
  const sb = createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return;
  const { data } = await sb.from("streaks").select("*").maybeSingle();
  const next = bumpStreak((data as Streak) ?? null, logDate);
  await sb.from("streaks").upsert({ ...next, user_id: u.user.id });
}

export const TODAY = todayStr;

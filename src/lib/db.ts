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

// Clears the end goal entirely. Setting/estimating a goal goes through the
// /api/goals/end-goal route, which also asks the AI for a healthy target date.
export async function clearEndGoal(): Promise<void> {
  const sb = createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return;
  await sb
    .from("profiles")
    .update({ end_goal: null, end_goal_target_date: null, end_goal_set_at: null })
    .eq("user_id", u.user.id);
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

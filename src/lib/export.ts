"use client";

import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import type { FoodLog, ExerciseLog, WeighIn, Goal } from "@/lib/types";
import { normalizeWorkout } from "@/lib/workout";

// Builds a multi-sheet workbook from all the user's logs and triggers a download.
// Fully client-side (SheetJS). On iPhone this opens the share sheet.
export async function exportEverything() {
  const sb = createClient();
  const [{ data: foods }, { data: exercises }, { data: weighIns }, { data: goals }] =
    await Promise.all([
      sb.from("food_logs").select("*").order("date", { ascending: true }),
      sb.from("exercise_logs").select("*").order("date", { ascending: true }),
      sb.from("weigh_ins").select("*").order("date", { ascending: true }),
      sb.from("goals").select("*").order("effective_from", { ascending: true }),
    ]);

  const wb = XLSX.utils.book_new();

  // --- Food: one row per entry ---
  const foodRows = ((foods as FoodLog[]) ?? []).map((f) => ({
    Date: f.date,
    Meal: f.meal_label ?? "",
    Input: f.raw_input ?? "",
    Calories: Number(f.calories),
    Protein_g: Number(f.protein_g),
    Carbs_g: Number(f.carbs_g),
    Fat_g: Number(f.fat_g),
    Vitamins: f.vitamins_json
      ? Object.entries(f.vitamins_json).map(([k, v]) => `${k}: ${v}`).join("; ")
      : "",
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(foodRows), "Food");

  // --- Food daily totals vs goal ---
  const goalForDate = makeGoalResolver((goals as Goal[]) ?? []);
  const byDay = new Map<string, { cal: number; p: number; c: number; f: number }>();
  for (const f of (foods as FoodLog[]) ?? []) {
    const cur = byDay.get(f.date) ?? { cal: 0, p: 0, c: 0, f: 0 };
    cur.cal += Number(f.calories);
    cur.p += Number(f.protein_g);
    cur.c += Number(f.carbs_g);
    cur.f += Number(f.fat_g);
    byDay.set(f.date, cur);
  }
  const dailyRows = [...byDay.entries()].sort().map(([date, t]) => {
    const g = goalForDate(date);
    return {
      Date: date,
      Calories: Math.round(t.cal),
      Calorie_Goal: g?.calories ?? "",
      Vs_Goal: g ? Math.round(t.cal - Number(g.calories)) : "",
      Protein_g: Math.round(t.p),
      Protein_Goal: g?.protein_g ?? "",
      Carbs_g: Math.round(t.c),
      Fat_g: Math.round(t.f),
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyRows), "Daily Totals");

  // --- Exercise: one row per session ---
  const exRows = ((exercises as ExerciseLog[]) ?? []).map((e) => {
    const strength = normalizeWorkout(e.parsed_json)
      .map((x) => {
        const setsStr = x.sets
          .map((s) => `${s.weight_kg == null ? "BW" : s.weight_kg + (s.each_side ? "ea" : "")}x${s.reps}`)
          .join(", ");
        return `${x.name} [${setsStr}]${x.volume ? ` (vol ${Math.round(x.volume)})` : ""}`;
      })
      .join("; ");
    const cardio = e.parsed_json?.cardio
      ? `${e.parsed_json.cardio.activity} ${e.parsed_json.cardio.duration_min ?? ""}min ${e.parsed_json.cardio.distance_km ?? ""}km`
      : "";
    return {
      Date: e.date,
      Type: e.type,
      Input: e.raw_input ?? "",
      Exercises: strength,
      Cardio: cardio,
      Est_Calories: e.est_calories ?? "",
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exRows), "Exercise");

  // --- Weigh-ins + goal history ---
  const wRows = ((weighIns as WeighIn[]) ?? []).map((w) => ({
    Date: w.date,
    Weight_kg: Number(w.weight_kg),
    Note: w.note ?? "",
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(wRows), "Weigh-ins");

  const gRows = ((goals as Goal[]) ?? []).map((g) => ({
    Effective_From: g.effective_from,
    Goal_Type: g.goal_type,
    Source: g.source,
    Calories: Number(g.calories),
    Protein_g: Number(g.protein_g),
    Carbs_g: Number(g.carbs_g),
    Fat_g: Number(g.fat_g),
    Body_Fat: g.body_fat_estimate ?? "",
    Active: g.is_active ? "yes" : "",
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gRows), "Goal History");

  const fname = `fitness-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, fname);
}

// Resolves which goal was active on a given date (latest effective_from <= date).
function makeGoalResolver(goals: Goal[]) {
  const sorted = [...goals].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  return (date: string): Goal | null => {
    let chosen: Goal | null = null;
    for (const g of sorted) {
      if (g.effective_from <= date) chosen = g;
    }
    return chosen;
  };
}

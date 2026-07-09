import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { finishLiveWorkout, type LiveFinishInput } from "@/lib/ai/gemini";
import type { ExerciseSet, ParsedExercise, ParsedStrengthExercise } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

// Turns a finished live-logging session into a ParsedExercise. The user's set
// data is authoritative and assembled locally; the AI only contributes naming,
// muscle mapping, and a calorie estimate. If the AI call fails we still return
// a fully usable workout from the deterministic fallback — finishing a session
// must never lose data.

interface LiveEntryPayload {
  name?: unknown;
  body_part?: unknown;
  equipment?: unknown;
  target?: unknown;
  secondary?: unknown;
  media?: unknown;
  sets?: Array<{ weight_kg?: unknown; reps?: unknown; each_side?: unknown }>;
}

// Dataset target vocabulary -> the muscle names lib/workout.ts groups on.
const TARGET_TO_MUSCLE: Record<string, string> = {
  pectorals: "Chest",
  "serratus anterior": "Chest",
  delts: "Front Delts",
  triceps: "Triceps",
  biceps: "Biceps",
  lats: "Lats",
  "upper back": "Upper Back",
  spine: "Back",
  traps: "Traps",
  "levator scapulae": "Traps",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  adductors: "Quads",
  abductors: "Glutes",
  calves: "Calves",
  abs: "Core",
  forearms: "Forearms",
  "cardiovascular system": "Cardio",
};

function toMuscle(target: string): string {
  const mapped = TARGET_TO_MUSCLE[target.trim().toLowerCase()];
  if (mapped) return mapped;
  return target.replace(/\b\w/g, (c) => c.toUpperCase()).trim() || "Other";
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let entries: LiveEntryPayload[] = [];
  let duration_min = 0;
  try {
    const body = await req.json();
    entries = Array.isArray(body?.entries) ? body.entries : [];
    duration_min = Math.max(1, Math.round(Number(body?.duration_min) || 0));
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const clean = entries
    .map((e) => ({
      name: String(e.name ?? "").trim(),
      body_part: String(e.body_part ?? ""),
      equipment: String(e.equipment ?? ""),
      target: String(e.target ?? ""),
      secondary: Array.isArray(e.secondary) ? e.secondary.map(String) : [],
      media: e.media ? String(e.media) : null,
      sets: (Array.isArray(e.sets) ? e.sets : [])
        .map((s) => ({
          weight_kg: s.weight_kg == null || s.weight_kg === "" ? null : num(s.weight_kg),
          reps: Math.max(0, Math.round(Number(s.reps) || 0)),
          each_side: Boolean(s.each_side),
        }))
        .filter((s) => s.reps > 0),
    }))
    .filter((e) => e.name && e.sets.length > 0);

  if (clean.length === 0) {
    return NextResponse.json({ error: "No completed sets to save." }, { status: 400 });
  }

  // Deterministic base: exercises with verbatim sets, volume, dataset muscles.
  const exercises: ParsedStrengthExercise[] = clean.map((e) => {
    const volume = e.sets.reduce((sum, s: ExerciseSet) => {
      const load = s.weight_kg == null ? 0 : s.weight_kg * (s.each_side ? 2 : 1);
      return sum + load * s.reps;
    }, 0);
    return {
      name: e.name.replace(/\b\w/g, (c) => c.toUpperCase()),
      primary_muscle: toMuscle(e.target),
      secondary_muscles: e.secondary.map(toMuscle),
      set_list: e.sets,
      volume: num(volume),
      media: e.media,
    };
  });

  const fallbackGroups = [...new Set(exercises.map((e) => e.primary_muscle!))];
  const parsed: ParsedExercise = {
    type: "strength",
    workout_name: fallbackGroups.slice(0, 2).join(" & ") || "Workout",
    muscle_groups: fallbackGroups,
    exercises,
    cardio: null,
    est_calories: null,
    est_duration_min: duration_min,
    summary: `${exercises.length} exercises, logged live.`,
  };

  // AI enrichment — naming, app-vocabulary muscles, calories. Best-effort.
  try {
    const input: LiveFinishInput = {
      duration_min,
      exercises: clean.map((e) => ({
        name: e.name,
        body_part: e.body_part,
        equipment: e.equipment,
        target: e.target,
        secondary: e.secondary,
        sets: e.sets,
      })),
    };
    const ai = await finishLiveWorkout(input);
    if (ai.workout_name) parsed.workout_name = ai.workout_name;
    if (ai.muscle_groups.length) parsed.muscle_groups = ai.muscle_groups;
    if (ai.est_calories != null) parsed.est_calories = ai.est_calories;
    if (ai.summary) parsed.summary = ai.summary;
    for (const ex of parsed.exercises) {
      const m =
        ai.exercise_muscles[ex.name] ??
        ai.exercise_muscles[
          Object.keys(ai.exercise_muscles).find((k) => k.toLowerCase() === ex.name.toLowerCase()) ?? ""
        ];
      if (m?.primary_muscle) {
        ex.primary_muscle = m.primary_muscle;
        ex.secondary_muscles = m.secondary_muscles;
      }
    }
  } catch (e) {
    console.warn("exercise/finish AI enrichment failed, using fallback:", e);
  }

  return NextResponse.json(parsed);
}

import type { ExerciseLog, ExerciseSet, ParsedExercise, ParsedStrengthExercise } from "@/lib/types";

// Deterministic workout intelligence — everything here is computed locally from
// logged data, so it's free, instant, and always accurate. The AI layer only
// adds narrative on top (see lib/ai). This module powers the Workout Detail
// screen: volume, strength score, intensity, progressive overload, muscle
// activation, personal records, and today-vs-last comparisons.

// ---- normalization (handles both new per-set logs and legacy aggregate logs) ----

// Canonical view of one exercise with a guaranteed set_list and computed volume.
export interface NormalizedExercise {
  name: string;
  primaryMuscle: string;
  secondaryMuscles: string[];
  sets: ExerciseSet[];
  volume: number;
  media: string | null; // exercise-library media key for live-logged workouts
}

// Effective load moved for one rep of a set (dumbbell "each side" loads both).
export function setLoad(s: ExerciseSet): number {
  if (s.weight_kg == null) return 0;
  return s.weight_kg * (s.each_side ? 2 : 1);
}

export function setVolume(s: ExerciseSet): number {
  return setLoad(s) * (s.reps || 0);
}

export function normalizeExercise(e: ParsedStrengthExercise): NormalizedExercise {
  const sets: ExerciseSet[] = Array.isArray(e.set_list) && e.set_list.length
    ? e.set_list
    : Array.from({ length: Number(e.sets) || 0 }, () => ({
        weight_kg: e.weight_kg ?? null,
        reps: Number(e.reps) || 0,
        each_side: false,
      }));
  const volume = e.volume != null ? Number(e.volume) : sets.reduce((a, s) => a + setVolume(s), 0);
  return {
    name: e.name || "Exercise",
    primaryMuscle: e.primary_muscle || "Other",
    secondaryMuscles: e.secondary_muscles ?? [],
    sets,
    volume: Math.round(volume),
    media: e.media ?? null,
  };
}

export function normalizeWorkout(parsed: ParsedExercise | null): NormalizedExercise[] {
  return (parsed?.exercises ?? []).map(normalizeExercise);
}

export function totalVolume(exercises: NormalizedExercise[]): number {
  return Math.round(exercises.reduce((a, e) => a + e.volume, 0));
}

export function totalSets(exercises: NormalizedExercise[]): number {
  return exercises.reduce((a, e) => a + e.sets.length, 0);
}

export function totalReps(exercises: NormalizedExercise[]): number {
  return exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + (s.reps || 0), 0), 0);
}

// ---- muscle activation ----

// Maps the detailed muscle names the parser emits into the high-level groups we
// show on the body map and the focus list.
const MUSCLE_GROUP: Record<string, string> = {
  chest: "Chest",
  "upper chest": "Chest",
  "lower chest": "Chest",
  "front delts": "Front Delts",
  "side delts": "Side Delts",
  "rear delts": "Rear Delts",
  shoulders: "Front Delts",
  triceps: "Triceps",
  biceps: "Biceps",
  lats: "Back",
  "upper back": "Back",
  back: "Back",
  traps: "Traps",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  core: "Core",
  abs: "Core",
  forearms: "Forearms",
};

export function muscleGroupOf(name: string): string {
  return MUSCLE_GROUP[name.trim().toLowerCase()] ?? name.trim();
}

export interface MuscleActivation {
  muscle: string;
  volume: number;
  pct: number; // 0..100 relative to the most-worked muscle
}

// Activation weights volume by role: primary muscle gets full set volume,
// secondaries get a share. Result is normalized so the top muscle is 100%.
export function muscleActivation(exercises: NormalizedExercise[]): MuscleActivation[] {
  const byMuscle = new Map<string, number>();
  const add = (muscle: string, v: number) => {
    const g = muscleGroupOf(muscle);
    byMuscle.set(g, (byMuscle.get(g) ?? 0) + v);
  };
  for (const e of exercises) {
    add(e.primaryMuscle, e.volume || e.sets.length * 50);
    for (const sec of e.secondaryMuscles) add(sec, (e.volume || e.sets.length * 50) * 0.4);
  }
  const entries = Array.from(byMuscle.entries()).sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] || 1;
  return entries.map(([muscle, volume]) => ({
    muscle,
    volume: Math.round(volume),
    pct: Math.round((volume / max) * 100),
  }));
}

// ---- intensity & strength score ----

export type Intensity = "Light" | "Moderate" | "High";

// Intensity from total working volume + set count. Tuned for typical hypertrophy
// sessions; deliberately simple and explainable.
export function intensity(exercises: NormalizedExercise[]): Intensity {
  const vol = totalVolume(exercises);
  const sets = totalSets(exercises);
  if (vol >= 5000 || sets >= 18) return "High";
  if (vol >= 2000 || sets >= 10) return "Moderate";
  return "Light";
}

// Strength score (0-100): a blended, bounded read of session quality from
// volume, working sets, and average reps. Not a clinical metric — a motivating,
// consistent number that rewards showing up and doing the work.
export function strengthScore(exercises: NormalizedExercise[]): number {
  if (!exercises.length) return 0;
  const vol = totalVolume(exercises);
  const sets = totalSets(exercises);
  const reps = totalReps(exercises);
  const volScore = Math.min(60, (vol / 6000) * 60);
  const setScore = Math.min(25, (sets / 20) * 25);
  const repScore = Math.min(15, (reps / 200) * 15);
  return Math.max(1, Math.min(100, Math.round(volScore + setScore + repScore)));
}

// ---- progressive overload (this workout vs the previous strength session) ----

export interface OverloadResult {
  pct: number | null; // volume change vs previous session, null if no prior
  prevVolume: number | null;
}

export function progressiveOverload(
  current: NormalizedExercise[],
  previous: NormalizedExercise[] | null
): OverloadResult {
  if (!previous || !previous.length) return { pct: null, prevVolume: null };
  const cur = totalVolume(current);
  const prev = totalVolume(previous);
  if (!prev) return { pct: null, prevVolume: null };
  return { pct: Math.round(((cur - prev) / prev) * 100), prevVolume: prev };
}

// ---- per-exercise today-vs-last comparison ----

export interface ExerciseComparison {
  found: boolean;
  prevBestSet: ExerciseSet | null;
  curBestSet: ExerciseSet | null;
  repDelta: number | null;
  weightDelta: number | null;
  volumeDelta: number | null; // current volume - previous volume for this exercise
  improved: boolean;
}

function bestSet(sets: ExerciseSet[]): ExerciseSet | null {
  if (!sets.length) return null;
  return [...sets].sort((a, b) => setLoad(b) - setLoad(a) || b.reps - a.reps)[0];
}

// Compares one exercise against the same exercise in a prior session (matched by
// normalized name). Drives the green "+1 rep" style indicators.
export function compareExercise(
  current: NormalizedExercise,
  history: NormalizedExercise[]
): ExerciseComparison {
  const key = current.name.trim().toLowerCase();
  const prev = history.find((h) => h.name.trim().toLowerCase() === key);
  if (!prev) {
    return {
      found: false,
      prevBestSet: null,
      curBestSet: bestSet(current.sets),
      repDelta: null,
      weightDelta: null,
      volumeDelta: null,
      improved: false,
    };
  }
  const curBest = bestSet(current.sets);
  const prevBest = bestSet(prev.sets);
  const repDelta = curBest && prevBest ? curBest.reps - prevBest.reps : null;
  const weightDelta = curBest && prevBest ? setLoad(curBest) - setLoad(prevBest) : null;
  const volumeDelta = current.volume - prev.volume;
  return {
    found: true,
    prevBestSet: prevBest,
    curBestSet: curBest,
    repDelta,
    weightDelta,
    volumeDelta,
    improved: volumeDelta > 0 || (weightDelta ?? 0) > 0 || (repDelta ?? 0) > 0,
  };
}

// ---- personal records (across all history) ----

export interface PersonalRecord {
  label: string; // e.g. "Heaviest set", "Best volume", "Most reps"
  exercise: string;
  value: string;
}

// Scans the whole strength history for headline PRs achieved in the CURRENT
// workout (so we only celebrate fresh ones).
export function personalRecords(
  current: NormalizedExercise[],
  history: NormalizedExercise[][]
): PersonalRecord[] {
  const prs: PersonalRecord[] = [];
  const pastFlat = history.flat();

  // Heaviest single set in this workout that beats all history.
  let heaviest: { ex: string; load: number; raw: ExerciseSet } | null = null;
  let mostReps: { ex: string; reps: number } | null = null;
  let bestVol: { ex: string; vol: number } | null = null;

  for (const e of current) {
    for (const s of e.sets) {
      const load = setLoad(s);
      if (load > 0 && (!heaviest || load > heaviest.load)) heaviest = { ex: e.name, load, raw: s };
      if (!mostReps || s.reps > mostReps.reps) mostReps = { ex: e.name, reps: s.reps };
    }
    if (!bestVol || e.volume > bestVol.vol) bestVol = { ex: e.name, vol: e.volume };
  }

  const beatsHistory = (pred: (s: ExerciseSet, exName: string) => boolean) =>
    pastFlat.every((pe) => pe.sets.every((ps) => pred(ps, pe.name)));

  if (heaviest) {
    const isPR = beatsHistory((ps) => setLoad(ps) < heaviest!.load);
    if (isPR) {
      const w = heaviest.raw.weight_kg;
      prs.push({
        label: "Heaviest set",
        exercise: heaviest.ex,
        value: w == null ? `${heaviest.load} kg` : `${w} kg${heaviest.raw.each_side ? " each" : ""}`,
      });
    }
  }
  if (mostReps && mostReps.reps > 0) {
    const isPR = beatsHistory((ps) => ps.reps < mostReps!.reps);
    if (isPR) prs.push({ label: "Most reps", exercise: mostReps.ex, value: `${mostReps.reps} reps` });
  }
  if (bestVol && bestVol.vol > 0) {
    const pastBestVol = Math.max(0, ...pastFlat.map((pe) => pe.volume));
    if (bestVol.vol > pastBestVol) {
      prs.push({ label: "Best volume", exercise: bestVol.ex, value: `${bestVol.vol.toLocaleString()} kg` });
    }
  }
  return prs;
}

// ---- helpers to pull normalized strength workouts out of raw logs ----

export function strengthLogsToWorkouts(logs: ExerciseLog[]): { id: string; date: string; exercises: NormalizedExercise[] }[] {
  return logs
    .filter((l) => l.type === "strength" && l.parsed_json)
    .map((l) => ({ id: l.id, date: l.date, exercises: normalizeWorkout(l.parsed_json) }));
}

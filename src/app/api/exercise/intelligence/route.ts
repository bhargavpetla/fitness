import { NextResponse } from "next/server";
import { getUser, createServerSupabase } from "@/lib/supabase/server";
import { workoutIntelligence } from "@/lib/ai/gemini";
import {
  normalizeWorkout,
  totalVolume,
  progressiveOverload,
  compareExercise,
} from "@/lib/workout";
import type { ExerciseLog, ParsedExercise } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 45;

// Generates (and caches) the AI intelligence for one workout: per-exercise
// insights, the "Explain My Workout" narrative, and a recovery suggestion. The
// deterministic numbers (volume, deltas) are computed server-side and handed to
// the model so it reasons over facts. Cached into parsed_json.intelligence so a
// second open returns instantly with no AI cost. Pass { force: true } to refresh.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let logId = "", force = false;
  try {
    ({ logId = "", force = false } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!logId) return NextResponse.json({ error: "Missing logId." }, { status: 400 });

  const supabase = await createServerSupabase();
  const { data: log } = await supabase
    .from("exercise_logs")
    .select("*")
    .eq("id", logId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!log) return NextResponse.json({ error: "Workout not found." }, { status: 404 });

  const parsed = (log as ExerciseLog).parsed_json as ParsedExercise | null;
  if (!parsed || parsed.type !== "strength") {
    return NextResponse.json({ error: "No strength workout to analyze." }, { status: 400 });
  }

  // Return the cached intelligence unless a refresh is requested.
  if (!force && parsed.intelligence?.narrative) {
    return NextResponse.json({ intelligence: parsed.intelligence, cached: true });
  }

  const current = normalizeWorkout(parsed);

  // Previous strength session (strictly before this log's date) for deltas.
  const { data: prevLogs } = await supabase
    .from("exercise_logs")
    .select("*")
    .eq("user_id", user.id)
    .eq("type", "strength")
    .lt("date", log.date)
    .order("date", { ascending: false })
    .limit(1);
  const prev = prevLogs?.[0] ? normalizeWorkout((prevLogs[0] as ExerciseLog).parsed_json) : null;

  // Today's nutrition for the recovery suggestion.
  const [{ data: foods }, { data: goal }] = await Promise.all([
    supabase.from("food_logs").select("calories, protein_g").eq("user_id", user.id).eq("date", log.date),
    supabase.from("goals").select("calories, protein_g").eq("user_id", user.id).eq("is_active", true).maybeSingle(),
  ]);
  const consumed = (foods ?? []).reduce(
    (a, f) => ({ calories: a.calories + Number(f.calories), protein: a.protein + Number(f.protein_g) }),
    { calories: 0, protein: 0 }
  );

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, name")
    .eq("user_id", user.id)
    .maybeSingle();

  try {
    const intel = await workoutIntelligence({
      workoutName: parsed.workout_name ?? "Workout",
      muscleGroups: parsed.muscle_groups ?? [],
      totalVolume: totalVolume(current),
      overloadPct: progressiveOverload(current, prev).pct,
      exercises: current.map((e) => ({
        name: e.name,
        primaryMuscle: e.primaryMuscle,
        volume: e.volume,
        sets: e.sets,
        comparison: prev ? pickComparison(compareExercise(e, prev)) : undefined,
      })),
      nutrition: {
        calories_consumed: Math.round(consumed.calories),
        protein_consumed: Math.round(consumed.protein),
        calorie_goal: goal?.calories != null ? Number(goal.calories) : null,
        protein_goal: goal?.protein_g != null ? Number(goal.protein_g) : null,
      },
      name: profile?.first_name ?? profile?.name ?? null,
    });

    const intelligence = { ...intel, generated_at: new Date().toISOString() };
    const nextParsed: ParsedExercise = { ...parsed, intelligence };
    await supabase.from("exercise_logs").update({ parsed_json: nextParsed }).eq("id", logId).eq("user_id", user.id);

    return NextResponse.json({ intelligence, cached: false });
  } catch (e) {
    console.error("exercise/intelligence failed:", e);
    return NextResponse.json({ error: "Could not analyze this workout. Try again." }, { status: 502 });
  }
}

function pickComparison(c: ReturnType<typeof compareExercise>) {
  return { found: c.found, repDelta: c.repDelta, weightDelta: c.weightDelta, volumeDelta: c.volumeDelta };
}

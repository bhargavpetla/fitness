import { NextResponse } from "next/server";
import { getUser, createServerSupabase } from "@/lib/supabase/server";
import { generateIllustration } from "@/lib/ai/gemini";
import { normalizeWorkout } from "@/lib/workout";
import type { ExerciseLog } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Batch pre-generation of exercise illustrations from the user's WHOLE workout
// history. Collects every distinct exercise, skips the ones already cached, and
// generates a few uncached ones per call (image gen is ~10s each, so we stay
// under the serverless limit and let the client loop until remaining === 0).
// Common exercises are generated once and reused forever; only brand-new ones in
// future workouts trigger a fresh generation.
const STYLE =
  "flat minimalist vector illustration, pure white background, single matcha-green (#2F7A4D) accent with soft grey line work, a single person performing the exercise, calm and clean, no text, centered, generous negative space";

const BATCH = 4;

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

export async function POST() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createServerSupabase();

  // Every distinct exercise across all strength logs (name + a muscle for the prompt).
  const { data: logs } = await supabase
    .from("exercise_logs")
    .select("*")
    .eq("user_id", user.id)
    .eq("type", "strength");

  const wanted = new Map<string, { name: string; muscle: string }>();
  for (const log of (logs ?? []) as ExerciseLog[]) {
    for (const e of normalizeWorkout(log.parsed_json)) {
      const slug = slugify(e.name);
      if (slug && !wanted.has(slug)) wanted.set(slug, { name: e.name, muscle: e.primaryMuscle });
    }
  }

  // Which are already cached? List the folder once.
  const { data: existing } = await supabase.storage.from("photos").list(`${user.id}/exercises`, { limit: 1000 });
  const cachedSlugs = new Set((existing ?? []).map((f) => f.name.replace(/\.png$/, "")));

  const total = wanted.size;
  const uncached = [...wanted.entries()].filter(([slug]) => !cachedSlugs.has(slug));

  let generatedNow = 0;
  for (const [slug, info] of uncached.slice(0, BATCH)) {
    const prompt = `${STYLE}. The exercise is "${info.name}", which trains the ${info.muscle}. Show correct form in a simple side or three-quarter view.`;
    const b64 = await generateIllustration(prompt);
    if (!b64) continue;
    const bytes = Buffer.from(b64, "base64");
    const { error } = await supabase.storage
      .from("photos")
      .upload(`${user.id}/exercises/${slug}.png`, bytes, { contentType: "image/png", upsert: true });
    if (!error) generatedNow++;
  }

  const cachedCount = total - uncached.length + generatedNow;
  const remaining = Math.max(0, uncached.length - generatedNow);
  return NextResponse.json({ total, cached: cachedCount, remaining, generatedNow });
}

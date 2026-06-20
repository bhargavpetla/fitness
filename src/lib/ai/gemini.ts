import { GoogleGenAI } from "@google/genai";
import { serverEnv } from "@/lib/env";
import { extractJson } from "@/lib/ai/anthropic";
import type { FoodParseResult, ParsedExercise, ParsedStrengthExercise } from "@/lib/types";

function genai() {
  return new GoogleGenAI({ apiKey: serverEnv().geminiKey });
}

const FOOD_SYSTEM = `You are a nutrition resolver. Given a user's plain-English food log and an optional photo, identify each food and quantity, use search grounding to get accurate macros, and return STRICT JSON only.
If a quantity is ambiguous, make the most reasonable assumption and note it in "notes".
Never invent foods not implied by the input.
Numbers are grams for macros and kcal for calories. Round to one decimal.
Also estimate the notable vitamins and minerals for the whole entry (only ones meaningfully present), as a flat map of name -> amount with unit.
Return JSON shaped exactly:
{
  "items": [{"name": string, "grams": number|null, "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number, "assumption": string|null}],
  "totals": {"calories": number, "protein_g": number, "carbs_g": number, "fat_g": number},
  "vitamins": {"Vitamin C": "45mg", "Iron": "2.1mg"},
  "notes": [string]
}`;

const EXERCISE_SYSTEM = `You are a strength coach parsing a plain-English workout log into clean structure. Return STRICT JSON only.

For each strength exercise, capture EVERY set individually with its own weight and reps — do not collapse sets. If the user repeats the exercise name per set, group them under one exercise with multiple sets.
- weight_kg: the number the user stated for that set (convert lb→kg if stated in lb).
- each_side: true if the user said "each side"/"each"/"per side" (dumbbell loaded both sides). Otherwise false.
- Map each exercise to its primary muscle and secondary muscles using real anatomy. Use clear muscle names like: Chest, Upper Chest, Lower Chest, Front Delts, Side Delts, Rear Delts, Triceps, Biceps, Lats, Upper Back, Traps, Quads, Hamstrings, Glutes, Calves, Core, Forearms.
  Examples: Incline Dumbbell Press → primary "Upper Chest", secondary ["Front Delts","Triceps"]. Arnold Press → primary "Front Delts", secondary ["Side Delts","Triceps"]. Lateral Raise → primary "Side Delts". Tricep Pushdown → primary "Triceps". Bench Dips → primary "Triceps", secondary ["Lower Chest"]. Skull Crushers → primary "Triceps".
- Fix obvious typos in exercise names ("dumbell"→"Dumbbell", "Sholder"→"Shoulder", "skill crushers"→"Skull Crushers"). Use proper Title Case.

Also infer:
- workout_name: a SHORT punchy name (1-2 words), preferring the classic training split when it fits — "Push Day" (chest/shoulders/triceps), "Pull Day" (back/biceps), "Leg Day", "Upper Body", "Full Body". Avoid long descriptive names like "Chest, Shoulders and Triceps".
- muscle_groups: the top-level muscle groups trained, ordered by emphasis (e.g. ["Chest","Shoulders","Triceps"]).
- est_duration_min: a reasonable estimate of session length from set count.
- est_calories: a rough calorie burn.

For cardio: activity, duration_min, distance_km, est_calories. If it's just a rest day, set type "rest" with empty exercises.

Return JSON shaped exactly:
{
  "type": "strength"|"cardio"|"rest"|"other",
  "workout_name": string,
  "muscle_groups": [string],
  "exercises": [{
    "name": string,
    "primary_muscle": string,
    "secondary_muscles": [string],
    "set_list": [{"weight_kg": number|null, "reps": number, "each_side": boolean}]
  }],
  "cardio": {"activity": string, "duration_min": number|null, "distance_km": number|null}|null,
  "est_calories": number|null,
  "est_duration_min": number|null,
  "summary": string
}`;

// Builds a parts array, attaching a base64 data-URL photo when present.
function partsWithPhoto(text: string, photo?: string) {
  const parts: Array<Record<string, unknown>> = [{ text }];
  if (photo) {
    const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(photo);
    if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }
  return parts;
}

export async function parseFood(rawInput: string, photo?: string): Promise<FoodParseResult> {
  const env = serverEnv();
  const ai = genai();
  const parts = partsWithPhoto(rawInput || "(photo only, identify the meal)", photo);

  // Primary attempt: Google Search grounding for accurate macros. Thinking is
  // disabled — it tripled latency (≈28s → ≈6s) without improving macro accuracy,
  // and the extra time was pushing the request past the serverless timeout, which
  // is what produced "Could not analyze". Grounding can still wrap the JSON in
  // prose, so parsing is best-effort here.
  try {
    const res = await ai.models.generateContent({
      model: env.geminiFoodModel,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: FOOD_SYSTEM,
        tools: [{ googleSearch: {} }],
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    return normalizeFood(JSON.parse(extractJson(res.text ?? "")) as FoodParseResult);
  } catch (e) {
    console.warn("parseFood grounded attempt failed, retrying with JSON mode:", e);
  }

  // Fallback: no grounding, force a JSON response. Less precise macros, but
  // reliably parseable so the user always gets a usable estimate.
  const res = await ai.models.generateContent({
    model: env.geminiFoodModel,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: FOOD_SYSTEM,
      responseMimeType: "application/json",
      temperature: 0.2,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  return normalizeFood(JSON.parse(extractJson(res.text ?? "")) as FoodParseResult);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

function normalizeFood(p: FoodParseResult): FoodParseResult {
  const items = (p.items ?? []).map((i) => ({
    name: String(i.name ?? "item"),
    grams: i.grams == null ? null : num(i.grams),
    calories: num(i.calories),
    protein_g: num(i.protein_g),
    carbs_g: num(i.carbs_g),
    fat_g: num(i.fat_g),
    assumption: i.assumption ? String(i.assumption) : null,
  }));
  // Trust the model's totals if present, else sum the items.
  const sum = items.reduce(
    (a, i) => ({
      calories: a.calories + i.calories,
      protein_g: a.protein_g + i.protein_g,
      carbs_g: a.carbs_g + i.carbs_g,
      fat_g: a.fat_g + i.fat_g,
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
  const totals = p.totals
    ? {
        calories: num(p.totals.calories) || num(sum.calories),
        protein_g: num(p.totals.protein_g) || num(sum.protein_g),
        carbs_g: num(p.totals.carbs_g) || num(sum.carbs_g),
        fat_g: num(p.totals.fat_g) || num(sum.fat_g),
      }
    : { calories: num(sum.calories), protein_g: num(sum.protein_g), carbs_g: num(sum.carbs_g), fat_g: num(sum.fat_g) };
  // Keep only string-valued vitamin entries.
  const vitamins: Record<string, string> = {};
  if (p.vitamins && typeof p.vitamins === "object") {
    for (const [k, v] of Object.entries(p.vitamins)) {
      if (v != null) vitamins[String(k)] = String(v);
    }
  }
  return { items, totals, vitamins, notes: Array.isArray(p.notes) ? p.notes.map(String) : [] };
}

export async function parseExercise(rawInput: string): Promise<ParsedExercise> {
  const env = serverEnv();
  const ai = genai();
  const res = await ai.models.generateContent({
    model: env.geminiExerciseModel,
    contents: [{ role: "user", parts: [{ text: rawInput }] }],
    config: {
      systemInstruction: EXERCISE_SYSTEM,
      responseMimeType: "application/json",
      temperature: 0.1,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const raw = JSON.parse(extractJson(res.text ?? "")) as ParsedExercise & {
    exercises?: Array<ParsedStrengthExercise & { set_list?: Array<{ weight_kg?: unknown; reps?: unknown; each_side?: unknown }> }>;
  };

  const exercises = (raw.exercises ?? []).map((e) => {
    // Prefer the new per-set list; fall back to legacy aggregate if present.
    const setList = Array.isArray(e.set_list)
      ? e.set_list.map((s) => ({
          weight_kg: s.weight_kg == null ? null : num(s.weight_kg),
          reps: Number(s.reps) || 0,
          each_side: Boolean(s.each_side),
        }))
      : legacyToSetList(e);

    // Volume = sum over sets of (effective per-rep load × reps). "each side"
    // doubles the per-rep load since both dumbbells are loaded.
    const volume = setList.reduce((sum, s) => {
      const load = s.weight_kg == null ? 0 : s.weight_kg * (s.each_side ? 2 : 1);
      return sum + load * s.reps;
    }, 0);

    return {
      name: String(e.name ?? "Exercise"),
      primary_muscle: e.primary_muscle ? String(e.primary_muscle) : undefined,
      secondary_muscles: Array.isArray(e.secondary_muscles) ? e.secondary_muscles.map(String) : [],
      set_list: setList,
      volume: num(volume),
    } as ParsedStrengthExercise;
  });

  return {
    type: (raw.type as ParsedExercise["type"]) ?? "other",
    workout_name: raw.workout_name ? String(raw.workout_name) : undefined,
    muscle_groups: Array.isArray(raw.muscle_groups) ? raw.muscle_groups.map(String) : [],
    exercises,
    cardio: raw.cardio ?? null,
    est_calories: raw.est_calories == null ? null : num(raw.est_calories),
    est_duration_min: raw.est_duration_min == null ? null : num(raw.est_duration_min),
    summary: String(raw.summary ?? ""),
  };
}

// Converts a legacy aggregate exercise ({sets, reps, weight_kg}) into a set list.
function legacyToSetList(e: ParsedStrengthExercise) {
  const count = Number(e.sets) || 0;
  const reps = Number(e.reps) || 0;
  const w = e.weight_kg == null ? null : num(e.weight_kg);
  return Array.from({ length: count }, () => ({ weight_kg: w, reps, each_side: false }));
}

// Single-call workout intelligence: per-exercise insights + an "Explain My
// Workout" narrative + a recovery suggestion, generated together for coherence
// and to bill once. The caller passes a compact, already-computed summary so the
// model reasons over facts (volumes, deltas, today's nutrition) rather than
// re-deriving them. Cached by the route into the log so re-opens are free.
export interface WorkoutIntelligenceInput {
  workoutName: string;
  muscleGroups: string[];
  exercises: Array<{
    name: string;
    primaryMuscle: string;
    volume: number;
    sets: Array<{ weight_kg: number | null; reps: number; each_side?: boolean }>;
    comparison?: { repDelta: number | null; weightDelta: number | null; volumeDelta: number | null; found: boolean };
  }>;
  totalVolume: number;
  overloadPct: number | null;
  nutrition?: {
    calories_consumed: number;
    protein_consumed: number;
    calorie_goal: number | null;
    protein_goal: number | null;
  } | null;
  name?: string | null;
}

export interface WorkoutIntelligenceResult {
  exercise_insights: Record<string, string>;
  narrative: string;
  recovery: string;
}

export async function workoutIntelligence(input: WorkoutIntelligenceInput): Promise<WorkoutIntelligenceResult> {
  const env = serverEnv();
  const ai = genai();

  const system = `You are a warm, sharp strength coach. Given a parsed workout (with per-exercise volume and today-vs-last deltas) and the user's nutrition so far today, return STRICT JSON only.
For each exercise, write ONE short insight (max ~16 words) about consistency, progression, fatigue, or a concrete next-session cue (e.g. "Strong consistency across all sets. Next time try 13 kg or 12 reps."). Reference the deltas when present.
Write a "narrative" ("Explain My Workout"): 2-3 short paragraphs, friendly and specific, summarizing stimulus by muscle and notable progress. No fluff, no medical claims.
Write a "recovery" line using remaining protein/calories: suggest a concrete meal in grams (e.g. "You have 68g protein left — try 200g chicken, 180g rice, 200g curd.") If no nutrition data, give a simple protein-focused tip.
Return JSON shaped exactly:
{ "exercise_insights": { "<exercise name>": "<insight>" }, "narrative": "<text>", "recovery": "<text>" }`;

  const res = await ai.models.generateContent({
    model: env.geminiExerciseModel,
    contents: [{ role: "user", parts: [{ text: JSON.stringify(input) }] }],
    config: {
      systemInstruction: system,
      responseMimeType: "application/json",
      temperature: 0.5,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const raw = JSON.parse(extractJson(res.text ?? "")) as Partial<WorkoutIntelligenceResult>;
  const insights: Record<string, string> = {};
  if (raw.exercise_insights && typeof raw.exercise_insights === "object") {
    for (const [k, v] of Object.entries(raw.exercise_insights)) insights[String(k)] = String(v);
  }
  return {
    exercise_insights: insights,
    narrative: String(raw.narrative ?? ""),
    recovery: String(raw.recovery ?? ""),
  };
}

// Weekly insight over the last 7 days of parsed logs.
export async function exerciseInsight(logsJson: string): Promise<string> {
  const env = serverEnv();
  const ai = genai();
  const res = await ai.models.generateContent({
    model: env.geminiExerciseModel,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `Here are my parsed workout logs for the last week as JSON:\n${logsJson}\n\n` +
              `Give grounded observations: volume trends per muscle group, any imbalance (e.g. push vs pull), ` +
              `and ONE gentle progression nudge based only on what I actually did (e.g. a stalled lift). ` +
              `Refer only to exercises present in the data. No generic advice, no targets, no "you failed" framing. ` +
              `Reply as 2-4 short bullet lines in plain text, warm and brief.`,
          },
        ],
      },
    ],
    config: { temperature: 0.4 },
  });
  return (res.text ?? "").trim();
}

// AI Guru: a context-aware diet Q&A. Gets today's intake + goal so answers like
// "how much rice should I eat?" account for the user's remaining macros.
export interface GuruContext {
  goal: { calories: number; protein_g: number; carbs_g: number; fat_g: number } | null;
  consumed: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  name?: string | null;
}

export async function askGuru(
  question: string,
  ctx: GuruContext,
  history: Array<{ role: "user" | "model"; text: string }> = []
): Promise<string> {
  const env = serverEnv();
  const ai = genai();

  const remaining = ctx.goal
    ? {
        calories: Math.max(0, Math.round(ctx.goal.calories - ctx.consumed.calories)),
        protein_g: Math.max(0, Math.round(ctx.goal.protein_g - ctx.consumed.protein_g)),
        carbs_g: Math.max(0, Math.round(ctx.goal.carbs_g - ctx.consumed.carbs_g)),
        fat_g: Math.max(0, Math.round(ctx.goal.fat_g - ctx.consumed.fat_g)),
      }
    : null;

  const system =
    `You are a friendly, practical nutrition coach ("Guru") for ${ctx.name || "the user"}. ` +
    `Answer diet questions concretely with grams/portions, using Google Search grounding for accurate macros. ` +
    `Be concise (2-5 short sentences), warm, no medical claims. ` +
    (ctx.goal
      ? `Their daily target: ${Math.round(ctx.goal.calories)} cal, ${Math.round(ctx.goal.protein_g)}g protein, ${Math.round(
          ctx.goal.carbs_g
        )}g carbs, ${Math.round(ctx.goal.fat_g)}g fat. ` +
        `So far today they've eaten ${Math.round(ctx.consumed.calories)} cal, ${Math.round(
          ctx.consumed.protein_g
        )}g protein. ` +
        (remaining
          ? `Remaining today: ${remaining.calories} cal, ${remaining.protein_g}g protein, ${remaining.carbs_g}g carbs, ${remaining.fat_g}g fat. ` +
            `When suggesting portions, fit them to what's remaining.`
          : "")
      : "They have no goal set yet; give general guidance.");

  const contents = [
    ...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: "user" as const, parts: [{ text: question }] },
  ];

  const res = await ai.models.generateContent({
    model: env.geminiFoodModel,
    contents,
    config: {
      systemInstruction: system,
      tools: [{ googleSearch: {} }],
      temperature: 0.5,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  return (res.text ?? "").trim();
}

// One-time illustration generation (Nano Banana / Gemini image model).
// Returns base64 PNG data (no data: prefix) or null if the model returned no image.
export async function generateIllustration(prompt: string): Promise<string | null> {
  const env = serverEnv();
  const ai = genai();
  const res = await ai.models.generateContent({
    model: env.geminiImageModel,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const data = (p as { inlineData?: { data?: string } }).inlineData?.data;
    if (data) return data;
  }
  return null;
}

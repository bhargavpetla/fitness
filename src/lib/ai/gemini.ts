import { GoogleGenAI } from "@google/genai";
import { serverEnv } from "@/lib/env";
import { extractJson } from "@/lib/ai/anthropic";
import type { FoodParseResult, ParsedExercise } from "@/lib/types";

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

const EXERCISE_SYSTEM = `You parse a plain-English workout log into structure. Return STRICT JSON only.
For strength: each exercise with sets, reps, weight_kg (convert lb to kg if stated in lb), and volume = sets*reps*weight_kg.
For cardio: activity, duration_min, distance_km, and a rough est_calories.
If the input is just a rest day, set type "rest" with empty exercises.
Return JSON shaped exactly:
{
  "type": "strength"|"cardio"|"rest"|"other",
  "exercises": [{"name": string, "sets": number, "reps": number, "weight_kg": number|null, "volume": number|null}],
  "cardio": {"activity": string, "duration_min": number|null, "distance_km": number|null}|null,
  "est_calories": number|null,
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
  const res = await ai.models.generateContent({
    model: env.geminiFoodModel,
    contents: [{ role: "user", parts: partsWithPhoto(rawInput || "(photo only, identify the meal)", photo) }],
    config: {
      systemInstruction: FOOD_SYSTEM,
      // Google Search grounding — "look up the real macros".
      tools: [{ googleSearch: {} }],
      temperature: 0.2,
    },
  });

  const parsed = JSON.parse(extractJson(res.text ?? "")) as FoodParseResult;
  return normalizeFood(parsed);
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
    config: { systemInstruction: EXERCISE_SYSTEM, temperature: 0.1 },
  });

  const raw = JSON.parse(extractJson(res.text ?? "")) as ParsedExercise;
  const exercises = (raw.exercises ?? []).map((e) => {
    const weight = e.weight_kg == null ? null : num(e.weight_kg);
    const volume =
      weight != null && e.sets && e.reps ? num(e.sets * e.reps * weight) : e.volume != null ? num(e.volume) : null;
    return {
      name: String(e.name ?? "exercise"),
      sets: Number(e.sets) || 0,
      reps: Number(e.reps) || 0,
      weight_kg: weight,
      volume,
    };
  });
  return {
    type: (raw.type as ParsedExercise["type"]) ?? "other",
    exercises,
    cardio: raw.cardio ?? null,
    est_calories: raw.est_calories == null ? null : num(raw.est_calories),
    summary: String(raw.summary ?? ""),
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
    config: { systemInstruction: system, tools: [{ googleSearch: {} }], temperature: 0.5 },
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

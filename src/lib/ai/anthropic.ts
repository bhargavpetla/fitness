import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";
import type { PreparedMedicalDocument } from "@/lib/medical-docs";
import type { BodyAnalysis } from "@/lib/types";

// ---- Claude Sonnet 4.6: body analysis + macro target generation ----

export interface BodyAnalysisInput {
  age: number | null;
  height_cm: number | null;
  weight_kg: number;
  sex: string | null;
  build_note: string | null;
  activity_level?: string | null; // sedentary | light | moderate | very
  daily_steps?: number | null;
  goal_type: string;
  goal_note?: string | null;
  // base64 data URLs (data:image/jpeg;base64,...) — front and optional side.
  photos?: string[];
  // Optional onboarding-only medical context. Not persisted by the app.
  medical_docs?: PreparedMedicalDocument[];
  // check-in extras
  checkin?: {
    prev_weight_kg: number | null;
    avg_daily_calories: number | null;
    avg_daily_protein_g: number | null;
    current_target: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
    days: number;
  };
}

const GUARDRAILS = `
GUARDRAILS (non-negotiable):
- Body fat is an ESTIMATE from limited inputs, presented as a RANGE (e.g. "14-17%"), never a single false-precision number, never framed as a medical/clinical reading.
- Protein target: aim for 1.6 to 2.0 g per kg bodyweight. Treat 2.0 g/kg as a HARD CEILING — never exceed double the person's bodyweight in grams of protein (e.g. a 63.5 kg person gets at most ~127 g, ideally ~100-115 g). Higher protein is wasteful and unrealistic to eat; do not pad it.
- DIET CONTEXT: assume an Indian/South-Asian diet unless the inputs say otherwise. Indian meals are predominantly carbohydrate-based (rice, roti, dal, idli, dosa, poha). Set carbohydrates as the LARGEST macro — roughly 45-55% of calories — and keep protein realistic for vegetarian-leaning Indian eating. Do NOT prescribe a Western high-protein/low-carb split.
- Calorie split guide for an Indian diet: ~45-55% carbs, ~20-25% protein (within the g/kg cap above), ~25-30% fat. Carbs in grams should clearly exceed protein in grams.
- Never recommend an aggressive caloric deficit. Never suggest calories below a safe floor (about 1500 for most adults; scale up for larger/active people).
- Macros must sum sensibly to calories (protein 4 kcal/g, carbs 4 kcal/g, fat 9 kcal/g) within ~5%.
- If uploaded medical documents mention conditions, medications, allergies, lab results, injuries, pregnancy, eating-disorder history, kidney/liver/cardiac/metabolic issues, or physician instructions, use them only as safety context for conservative fitness/nutrition planning.
- Do not diagnose, interpret labs as medical advice, change medication guidance, or override a clinician. If the documents imply medical risk, note that the user should confirm the plan with their clinician in the rationale.
- Be warm and concise. This is motivation and trend tracking, not diagnosis.
`;

function buildSchemaInstruction(isCheckin: boolean): string {
  return `Return STRICT JSON only, no prose, matching exactly:
{
  "body_fat_estimate": "string range like 14-17%",
  "confidence_note": "one short line on confidence",
  "body_type_read": "one short sentence",
  "calories": number,
  "protein_g": number,
  "carbs_g": number,
  "fat_g": number,
  "goal_type": "recomp" | "bulk" | "cut" | "maintain",
  "activity_level": "sedentary" | "light" | "moderate" | "very",
  ${isCheckin ? '"assessment": "is the plan working for the stated goal? one or two sentences",' : ""}
  "rationale": "one or two sentences explaining the macro choice, noting how activity affected calories"
}`;
}

export async function analyzeBody(input: BodyAnalysisInput): Promise<BodyAnalysis> {
  const env = serverEnv();
  const client = new Anthropic({ apiKey: env.anthropicKey });
  const isCheckin = Boolean(input.checkin);

  const facts = [
    `Age: ${input.age ?? "unknown"}`,
    `Height: ${input.height_cm ? input.height_cm + " cm" : "unknown"}`,
    `Current weight: ${input.weight_kg} kg`,
    `Sex/build: ${input.sex ?? "unspecified"}`,
    `Build note: ${input.build_note ?? "none"}`,
    `Activity level: ${input.activity_level ?? "moderate (assume)"}`,
    `Typical daily steps: ${input.daily_steps ?? "unknown"}`,
    `Goal: ${input.goal_type}${input.goal_note ? " — " + input.goal_note : ""}`,
    `IMPORTANT: scale total daily calories to the activity level and step count — a more active person needs more calories. Reflect this in the calorie target.`,
  ];
  if (input.checkin) {
    const c = input.checkin;
    facts.push(
      `--- WEEKLY CHECK-IN CONTEXT ---`,
      `Days elapsed: ${c.days}`,
      `Previous weight: ${c.prev_weight_kg ?? "unknown"} kg (so trend = ${
        c.prev_weight_kg != null ? (input.weight_kg - c.prev_weight_kg).toFixed(1) + " kg" : "unknown"
      })`,
      `Avg daily intake this period: ${c.avg_daily_calories ?? "?"} kcal, ${c.avg_daily_protein_g ?? "?"} g protein`,
      `Current target: ${c.current_target.calories} kcal, ${c.current_target.protein_g}g P, ${c.current_target.carbs_g}g C, ${c.current_target.fat_g}g F`,
      `Judge whether progress matches the goal and propose adjusted macros only if warranted.`
    );
  }

  const content: Anthropic.MessageParam["content"] = [];
  for (const photo of input.photos ?? []) {
    const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(photo);
    if (!match) continue;
    content.push({
      type: "image",
      source: { type: "base64", media_type: match[1] as never, data: match[2] },
    });
  }
  for (const doc of input.medical_docs ?? []) {
    const context =
      "Medical background uploaded during first-time onboarding. Use this only for safety constraints, contraindications, allergies, medications, conditions, injuries, and nutrition/exercise considerations. Do not provide diagnosis or medication advice.";
    content.push({
      type: "document",
      title: doc.name,
      context,
      source:
        doc.kind === "pdf"
          ? { type: "base64", media_type: "application/pdf", data: doc.base64 }
          : { type: "text", media_type: "text/plain", data: doc.text },
    });
  }
  content.push({
    type: "text",
    text: `${isCheckin ? "Re-assess and propose macros." : "Analyze body and generate daily macro targets."}\n\n${facts.join(
      "\n"
    )}\n\n${buildSchemaInstruction(isCheckin)}`,
  });

  const msg = await client.messages.create({
    model: env.anthropicModel,
    max_tokens: 1024,
    system:
      "You are a careful, encouraging fitness coach and nutrition planner who reasons from photos and basic metrics. " +
      GUARDRAILS,
    messages: [{ role: "user", content }],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return parseBodyJson(text);
}

function parseBodyJson(text: string): BodyAnalysis {
  const jsonStr = extractJson(text);
  const raw = JSON.parse(jsonStr);
  return {
    body_fat_estimate: String(raw.body_fat_estimate ?? "unknown"),
    confidence_note: String(raw.confidence_note ?? "Estimate from limited inputs."),
    body_type_read: String(raw.body_type_read ?? ""),
    calories: Number(raw.calories),
    protein_g: Number(raw.protein_g),
    carbs_g: Number(raw.carbs_g),
    fat_g: Number(raw.fat_g),
    goal_type: raw.goal_type ?? "maintain",
    activity_level: raw.activity_level ?? undefined,
    assessment: raw.assessment ? String(raw.assessment) : undefined,
    rationale: String(raw.rationale ?? ""),
  };
}

// Grounded "where am I / what to adjust" read over a week or month of intake.
export interface ProgressInput {
  period: "week" | "month";
  goal: { calories: number; protein_g: number; carbs_g: number; fat_g: number; goal_type: string };
  avg: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  days_logged: number;
  total_days: number;
  weight_change_kg: number | null;
}

export async function progressSummary(input: ProgressInput): Promise<string> {
  const env = serverEnv();
  const client = new Anthropic({ apiKey: env.anthropicKey });

  const facts = [
    `Period: this ${input.period}`,
    `Goal type: ${input.goal.goal_type}`,
    `Daily target: ${input.goal.calories} cal, ${input.goal.protein_g}g protein, ${input.goal.carbs_g}g carbs, ${input.goal.fat_g}g fat`,
    `Average daily intake: ${input.avg.calories} cal, ${input.avg.protein_g}g protein, ${input.avg.carbs_g}g carbs, ${input.avg.fat_g}g fat`,
    `Days logged: ${input.days_logged} of ${input.total_days}`,
    `Weight change over period: ${input.weight_change_kg != null ? input.weight_change_kg.toFixed(1) + " kg" : "unknown"}`,
  ].join("\n");

  const msg = await client.messages.create({
    model: env.anthropicModel,
    max_tokens: 400,
    system:
      "You are a concise, encouraging fitness coach. Given a week or month of nutrition data vs a goal, tell the user " +
      "in 3-4 short bullet lines: (1) where they are relative to the goal, (2) the single most useful adjustment, " +
      "(3) one thing going well. Be specific with numbers. No medical claims, no shaming, no generic filler.",
    messages: [{ role: "user", content: facts }],
  });

  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// Estimates a healthy, realistic timeframe (in days) for a user's free-text body
// goal, given their stats and current macro target. The AI decides the date — the
// user never picks it — favouring the safest pace that still makes steady progress.
export interface GoalTimeframeInput {
  end_goal: string;
  age: number | null;
  height_cm: number | null;
  sex: string | null;
  build_note: string | null;
  goal_type: string;
  body_fat_estimate: string | null;
  calories: number;
  protein_g: number;
}

export interface GoalTimeframe {
  estimated_days: number; // healthy realistic horizon
  rationale: string; // one short, warm sentence
}

export async function estimateGoalTimeframe(input: GoalTimeframeInput): Promise<GoalTimeframe> {
  const env = serverEnv();
  const client = new Anthropic({ apiKey: env.anthropicKey });

  const facts = [
    `User's stated goal: "${input.end_goal}"`,
    `Age: ${input.age ?? "unknown"}`,
    `Height: ${input.height_cm ? input.height_cm + " cm" : "unknown"}`,
    `Sex/build: ${input.sex ?? "unspecified"}${input.build_note ? " — " + input.build_note : ""}`,
    `Programme type: ${input.goal_type}`,
    `Current body-fat estimate: ${input.body_fat_estimate ?? "unknown"}`,
    `Daily target: ${input.calories} kcal, ${input.protein_g} g protein`,
  ].join("\n");

  const msg = await client.messages.create({
    model: env.anthropicModel,
    max_tokens: 300,
    system:
      "You are a careful fitness coach. Given someone's body goal and stats, estimate the SHORTEST timeframe that is still HEALTHY and SUSTAINABLE to reach it — never crash diets, never unsafe rates. " +
      "Use evidence-based rates: fat loss ~0.5-0.75 kg/week, muscle/recomp changes are slow (visible change over 8-16 weeks). " +
      "Assume the person trains and stays consistent. If the goal is vague, assume a sensible interpretation. " +
      'Return STRICT JSON only: {"estimated_days": <integer 21-365>, "rationale": "<one short, warm, encouraging sentence naming the healthy pace>"}',
    messages: [{ role: "user", content: facts }],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const raw = JSON.parse(extractJson(text));
  const days = Math.max(21, Math.min(365, Math.round(Number(raw.estimated_days) || 84)));
  return { estimated_days: days, rationale: String(raw.rationale ?? "A steady, healthy pace.") };
}

// Pulls a JSON object out of a model reply, tolerating code fences and any
// surrounding prose (e.g. Google Search grounding text appended around the JSON,
// which can itself contain `{` or `}` and break a naive first-brace/last-brace
// slice). Scans for the first balanced `{...}` object, respecting string
// literals and escapes so braces inside strings don't throw off the depth count.
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;

  const start = body.indexOf("{");
  if (start === -1) throw new Error("No JSON found in model response");

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  throw new Error("No complete JSON object found in model response");
}
